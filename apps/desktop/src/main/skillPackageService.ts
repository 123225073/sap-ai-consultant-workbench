import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import { parseDocument } from "yaml";
import type {
  ActivatedSkill,
  ParsedSkillMarkdown,
  SkillCatalogEntry,
  SkillFrontmatter,
  SkillPackageLimits,
  SkillPackagePreflightInput,
  SkillPackagePreview,
  SkillPackageRecord,
  SkillPackageScope,
  SkillPackageStats,
  SkillResourceDescriptor,
  SkillScriptStatus,
  SkillTextResource,
  SkillValidationDiagnostic,
  SkillValidationResult
} from "../shared/skillTypes";
import { parseSkillPackageScope, skillPackageScopeKey } from "../shared/skillTypes";

const REGISTRY_SCHEMA_VERSION = 1;
const FRONTMATTER_MAX_BYTES = 64 * 1024;
const INSTRUCTION_SUMMARY_CHARS = 800;

export const DEFAULT_SKILL_PACKAGE_LIMITS: Readonly<SkillPackageLimits> = Object.freeze({
  maxFiles: 500,
  maxDirectories: 200,
  maxSingleFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxDepth: 8,
  maxSkillMarkdownBytes: 512 * 1024
});

export type SkillPackageErrorCode =
  | "invalid-request"
  | "unsafe-path"
  | "unsafe-link"
  | "package-limit"
  | "invalid-skill"
  | "duplicate-name"
  | "zip-extractor-unavailable"
  | "preflight-not-found"
  | "skill-not-found"
  | "skill-disabled"
  | "package-tampered"
  | "storage-failure";

export class SkillPackageError extends Error {
  readonly code: SkillPackageErrorCode;

  constructor(code: SkillPackageErrorCode, message: string) {
    super(message);
    this.name = "SkillPackageError";
    this.code = code;
  }
}

interface StoredSkillPackageRecord extends SkillPackageRecord {
  rootRef: string;
  enablementConfirmed?: boolean;
}

interface SkillRegistryFile {
  schemaVersion: number;
  packages: StoredSkillPackageRecord[];
}

interface PendingSkillImport {
  preview: SkillPackagePreview;
  stagingPath: string;
}

interface ScanResult {
  resources: SkillResourceDescriptor[];
  directoryPaths: string[];
  stats: SkillPackageStats;
  sha256: string;
  hasScriptsDirectory: boolean;
}

interface InspectedPackage extends ScanResult {
  markdown: ParsedSkillMarkdown;
  validation: SkillValidationResult;
  scriptStatus: SkillScriptStatus;
}

type ParsedYamlValue = string | Record<string, string>;

export class SkillPackageService {
  private readonly requestedStorageRoot: string;
  private readonly limits: SkillPackageLimits;
  private storageRoot = "";
  private packagesRoot = "";
  private stagingRoot = "";
  private registryPath = "";
  private initialization: Promise<void> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private records: StoredSkillPackageRecord[] = [];
  private readonly pending = new Map<string, PendingSkillImport>();

  constructor(storageRoot: string, options: { limits?: Partial<SkillPackageLimits> } = {}) {
    if (typeof storageRoot !== "string" || !storageRoot.trim()) {
      throw new SkillPackageError("invalid-request", "Skill 存储目录无效。");
    }
    this.requestedStorageRoot = path.resolve(storageRoot);
    this.limits = normalizeLimits(options.limits);
  }

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  async preflightImport(input: SkillPackagePreflightInput): Promise<SkillPackagePreview> {
    await this.ensureInitialized();
    const request = normalizePreflightInput(input);
    if (request.sourceKind === "zip") {
      throw new SkillPackageError(
        "zip-extractor-unavailable",
        "当前版本未安装受控 zip 解压组件，无法安全预检 zip。请改用已解压的 Skill 文件夹。"
      );
    }

    return this.withOperationLock(async () => {
      let stagingPath: string | null = null;
      try {
        stagingPath = await fs.mkdtemp(path.join(this.stagingRoot, "import-"));
        const sourcePath = path.resolve(request.sourcePath);
        const scan = await scanSkillDirectory(sourcePath, this.limits, stagingPath);
        const inspected = await inspectSkillPackage(stagingPath, scan, this.limits, path.basename(sourcePath));
        this.assertNameAvailable(inspected.markdown.frontmatter.name, request.scope);

        const importId = `skill-import-${randomUUID()}`;
        const preview: SkillPackagePreview = {
          importId,
          name: inspected.markdown.frontmatter.name,
          description: inspected.markdown.frontmatter.description,
          instructionSummary: summarizeInstructions(inspected.markdown),
          frontmatter: inspected.markdown.frontmatter,
          source: { kind: "folder", label: path.basename(sourcePath) || "Skill 文件夹" },
          scope: request.scope,
          sha256: inspected.sha256,
          enabled: false,
          validation: inspected.validation,
          scriptStatus: inspected.scriptStatus,
          resources: inspected.resources,
          stats: inspected.stats,
          limits: { ...this.limits }
        };
        this.pending.set(importId, { preview, stagingPath });
        return clonePreview(preview);
      } catch (error) {
        if (stagingPath) await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
        throw normalizeServiceError(error, "Skill 文件夹预检失败，请确认文件可访问且包内容有效。");
      }
    });
  }

  async confirmImport(importId: string): Promise<SkillPackageRecord> {
    await this.ensureInitialized();
    const normalizedImportId = normalizeId(importId, "预检 ID");
    return this.withOperationLock(async () => {
      const pending = this.pending.get(normalizedImportId);
      if (!pending) throw new SkillPackageError("preflight-not-found", "Skill 预检记录不存在或已经失效，请重新预检。");
      if (pending.preview.validation.status !== "valid" && pending.preview.validation.status !== "warning") {
        throw new SkillPackageError("invalid-skill", "Skill 未通过校验，不能安装。");
      }
      this.assertNameAvailable(pending.preview.name, pending.preview.scope, normalizedImportId);
      try {
        const stagedScan = await scanSkillDirectory(pending.stagingPath, this.limits);
        const stagedInspection = await inspectSkillPackage(pending.stagingPath, stagedScan, this.limits, pending.preview.name);
        if (stagedInspection.sha256 !== pending.preview.sha256
          || stagedInspection.markdown.frontmatter.name !== pending.preview.name
          || stagedInspection.markdown.frontmatter.description !== pending.preview.description) {
          throw new SkillPackageError("package-tampered", "Skill staging 内容在确认前发生变化，已拒绝安装。");
        }
      } catch (error) {
        await fs.rm(pending.stagingPath, { recursive: true, force: true }).catch(() => undefined);
        this.pending.delete(normalizedImportId);
        throw normalizeServiceError(error, "Skill staging 无法重新校验，已清理并拒绝安装。");
      }

      const targetPath = this.installedPackagePath(pending.preview.scope, pending.preview.name);
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      if (await pathExists(targetPath)) {
        throw new SkillPackageError("duplicate-name", "同一安装范围内已存在同名 Skill，不能覆盖安装。");
      }

      const now = new Date().toISOString();
      const stored: StoredSkillPackageRecord = {
        id: `skill-${randomUUID()}`,
        name: pending.preview.name,
        description: pending.preview.description,
        frontmatter: pending.preview.frontmatter,
        source: pending.preview.source,
        scope: pending.preview.scope,
        sha256: pending.preview.sha256,
        enabled: false,
        validation: pending.preview.validation,
        scriptStatus: pending.preview.scriptStatus,
        resources: pending.preview.resources,
        stats: pending.preview.stats,
        installedAt: now,
        updatedAt: now,
        rootRef: toPortableRelativePath(path.relative(this.storageRoot, targetPath)),
        enablementConfirmed: false
      };

      let movedToTarget = false;
      try {
        await fs.rename(pending.stagingPath, targetPath);
        movedToTarget = true;
        this.records.push(stored);
        await this.persistRegistry();
        this.pending.delete(normalizedImportId);
        return cloneRecord(stored);
      } catch (error) {
        this.records = this.records.filter((record) => record.id !== stored.id);
        if (movedToTarget) {
          try {
            await fs.rename(targetPath, pending.stagingPath);
          } catch {
            await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
          }
        }
        throw normalizeServiceError(error, "Skill 安装失败，staging 已回滚，未注册不完整包。");
      }
    });
  }

  async cancelImport(importId: string): Promise<boolean> {
    await this.ensureInitialized();
    const normalizedImportId = normalizeId(importId, "预检 ID");
    return this.withOperationLock(async () => {
      const pending = this.pending.get(normalizedImportId);
      if (!pending) return false;
      await fs.rm(pending.stagingPath, { recursive: true, force: true });
      this.pending.delete(normalizedImportId);
      return true;
    });
  }

  async listInstalled(): Promise<SkillPackageRecord[]> {
    await this.ensureInitialized();
    return this.records.map(cloneRecord).sort(compareRecords);
  }

  async listPendingPreviews(): Promise<SkillPackagePreview[]> {
    await this.ensureInitialized();
    return [...this.pending.values()].map((item) => clonePreview(item.preview)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async syncBuiltinSkills(sourceRoot: string): Promise<SkillPackageRecord[]> {
    await this.ensureInitialized();
    if (typeof sourceRoot !== "string" || !sourceRoot.trim()) {
      throw new SkillPackageError("invalid-request", "内置 Skills 目录无效。");
    }
    const requestedRoot = path.resolve(sourceRoot);
    return this.withOperationLock(async () => {
      const rootStats = await safeLstat(requestedRoot, "内置 Skills 目录无法访问。");
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new SkillPackageError("unsafe-link", "内置 Skills 目录必须是应用随附的真实目录。");
      }
      const canonicalRoot = await fs.realpath(requestedRoot);
      const entries = (await fs.readdir(canonicalRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .sort((a, b) => a.name.localeCompare(b.name));
      const synced: SkillPackageRecord[] = [];
      for (const entry of entries) {
        let stagingPath: string | null = null;
        try {
          stagingPath = await fs.mkdtemp(path.join(this.stagingRoot, "builtin-"));
          const sourcePath = path.join(canonicalRoot, entry.name);
          const scan = await scanSkillDirectory(sourcePath, this.limits, stagingPath);
          const inspected = await inspectSkillPackage(stagingPath, scan, this.limits, entry.name);
          if (inspected.validation.status !== "valid" && inspected.validation.status !== "warning") {
            throw new SkillPackageError("invalid-skill", `内置 Skill “${entry.name}” 未通过校验。`);
          }
          const scope: SkillPackageScope = { kind: "global" };
          const existingIndex = this.records.findIndex((record) => record.name === inspected.markdown.frontmatter.name
            && record.scope.kind === "global");
          const existing = existingIndex >= 0 ? this.records[existingIndex] : null;
          if (existing && existing.source.kind !== "builtin") {
            await fs.rm(stagingPath, { recursive: true, force: true });
            stagingPath = null;
            continue;
          }

          const targetPath = this.installedPackagePath(scope, inspected.markdown.frontmatter.name);
          const now = new Date().toISOString();
          const next: StoredSkillPackageRecord = {
            id: existing?.id ?? builtinSkillId(inspected.markdown.frontmatter.name),
            name: inspected.markdown.frontmatter.name,
            description: inspected.markdown.frontmatter.description,
            frontmatter: inspected.markdown.frontmatter,
            source: { kind: "builtin", label: "应用内置" },
            scope,
            sha256: inspected.sha256,
            enabled: existing?.enablementConfirmed === true ? existing.enabled : false,
            validation: inspected.validation,
            scriptStatus: inspected.scriptStatus,
            resources: inspected.resources,
            stats: inspected.stats,
            installedAt: existing?.installedAt ?? now,
            updatedAt: existing?.sha256 === inspected.sha256 ? existing.updatedAt : now,
            rootRef: toPortableRelativePath(path.relative(this.storageRoot, targetPath)),
            enablementConfirmed: existing?.enablementConfirmed === true
          };

          if (existing?.sha256 === inspected.sha256 && await pathExists(targetPath)) {
            const installedInspection = await this.inspectInstalled(existing);
            if (installedInspection.validation.status === "valid" || installedInspection.validation.status === "warning") {
              await fs.rm(stagingPath, { recursive: true, force: true });
              stagingPath = null;
              this.records[existingIndex] = next;
              synced.push(cloneRecord(next));
              continue;
            }
          }

          await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
          const quarantine = path.join(this.stagingRoot, `builtin-old-${randomUUID()}`);
          const hadExistingDirectory = await pathExists(targetPath);
          if (hadExistingDirectory) await fs.rename(targetPath, quarantine);
          try {
            await fs.rename(stagingPath, targetPath);
            stagingPath = null;
            if (existingIndex >= 0) this.records[existingIndex] = next;
            else this.records.push(next);
            await this.persistRegistry();
            await fs.rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
            synced.push(cloneRecord(next));
          } catch (error) {
            if (existingIndex >= 0 && existing) this.records[existingIndex] = existing;
            else this.records = this.records.filter((record) => record.id !== next.id);
            await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
            if (hadExistingDirectory) await fs.rename(quarantine, targetPath).catch(() => undefined);
            throw error;
          }
        } catch (error) {
          if (stagingPath) await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
          throw normalizeServiceError(error, `内置 Skill “${entry.name}” 安装失败。`);
        }
      }
      return synced.sort(compareRecords);
    });
  }

  async setEnabled(skillId: string, enabled: boolean): Promise<SkillPackageRecord> {
    await this.ensureInitialized();
    const id = normalizeId(skillId, "Skill ID");
    if (typeof enabled !== "boolean") throw new SkillPackageError("invalid-request", "Skill 启停状态无效。");
    return this.withOperationLock(async () => {
      const record = this.requireStoredRecord(id);
      if (enabled) {
        const inspection = await this.inspectInstalled(record);
        record.validation = inspection.validation;
        if (inspection.validation.status !== "valid" && inspection.validation.status !== "warning") {
          record.enabled = false;
          record.updatedAt = new Date().toISOString();
          await this.persistRegistry();
          throw new SkillPackageError("package-tampered", "Skill 当前校验未通过，已保持停用。请重新导入可信包。");
        }
      }
      record.enabled = enabled;
      record.enablementConfirmed = true;
      record.updatedAt = new Date().toISOString();
      await this.persistRegistry();
      return cloneRecord(record);
    });
  }

  async validateInstalled(skillId: string): Promise<SkillPackageRecord> {
    await this.ensureInitialized();
    const id = normalizeId(skillId, "Skill ID");
    return this.withOperationLock(async () => {
      const record = this.requireStoredRecord(id);
      const inspection = await this.inspectInstalled(record);
      record.validation = inspection.validation;
      if (inspection.validation.status === "invalid" || inspection.validation.status === "unsupported") record.enabled = false;
      record.updatedAt = new Date().toISOString();
      await this.persistRegistry();
      return cloneRecord(record);
    });
  }

  async getCatalog(projectId?: string | null): Promise<SkillCatalogEntry[]> {
    await this.ensureInitialized();
    const normalizedProjectId = normalizeOptionalProjectId(projectId);
    const effective = new Map<string, StoredSkillPackageRecord>();
    for (const record of this.records) {
      if (!record.enabled || (record.validation.status !== "valid" && record.validation.status !== "warning")) continue;
      if (record.scope.kind === "global") effective.set(record.name, record);
    }
    if (normalizedProjectId) {
      for (const record of this.records) {
        if (!record.enabled || (record.validation.status !== "valid" && record.validation.status !== "warning")) continue;
        if (record.scope.kind === "project" && record.scope.projectId === normalizedProjectId) effective.set(record.name, record);
      }
    }
    return [...effective.values()].sort(compareRecords).map((record) => ({
      id: record.id,
      name: record.name,
      description: record.description,
      scope: cloneScope(record.scope),
      sha256: record.sha256,
      validationStatus: record.validation.status as "valid" | "warning"
    }));
  }

  async activateSkill(name: string, projectId?: string | null): Promise<ActivatedSkill> {
    await this.ensureInitialized();
    const normalizedName = normalizeSkillName(name);
    const normalizedProjectId = normalizeOptionalProjectId(projectId);
    const record = this.findEffectiveRecord(normalizedName, normalizedProjectId);
    if (!record) throw new SkillPackageError("skill-not-found", "当前范围内没有可用的同名 Skill。");
    if (!record.enabled) throw new SkillPackageError("skill-disabled", "该 Skill 已停用，不能加载到当前任务。");
    if (record.validation.status !== "valid" && record.validation.status !== "warning") {
      throw new SkillPackageError("package-tampered", "该 Skill 校验未通过，不能加载到当前任务。");
    }

    try {
      const markdown = await this.readVerifiedSkillMarkdown(record);
      return {
        id: record.id,
        name: record.name,
        description: record.description,
        scope: cloneScope(record.scope),
        sha256: record.sha256,
        frontmatter: cloneFrontmatter(markdown.frontmatter),
        instructions: markdown.body,
        resources: record.resources.filter((resource) => resource.kind !== "instructions").map(cloneResource),
        allowedToolsPolicy: "advisory-only",
        scriptsExecution: "disabled"
      };
    } catch (error) {
      await this.markInvalid(record.id, "Skill 指令文件与安装时记录不一致，已自动停用。");
      throw normalizeServiceError(error, "Skill 指令文件已变化或无法安全读取，已自动停用。");
    }
  }

  async readTextResource(skillId: string, relativePath: string): Promise<SkillTextResource> {
    await this.ensureInitialized();
    const record = this.requireStoredRecord(normalizeId(skillId, "Skill ID"));
    if (!record.enabled) throw new SkillPackageError("skill-disabled", "该 Skill 已停用，不能读取资源。");
    if (record.validation.status !== "valid" && record.validation.status !== "warning") {
      throw new SkillPackageError("package-tampered", "该 Skill 校验未通过，不能读取资源。");
    }
    const safeRelativePath = validateSkillArchiveEntryPath(relativePath, this.limits);
    const descriptor = record.resources.find((resource) => resource.relativePath === safeRelativePath);
    if (!descriptor || descriptor.kind === "instructions") {
      throw new SkillPackageError("unsafe-path", "请求的 Skill 资源不在已校验清单中。");
    }
    if (descriptor.kind === "script") {
      throw new SkillPackageError("invalid-request", "scripts/ 只展示文件清单，不执行，也不载入模型上下文。");
    }

    let bytes: Uint8Array;
    try {
      const root = await this.resolveStoredRoot(record);
      bytes = await readVerifiedFile(root, safeRelativePath, descriptor, this.limits);
    } catch (error) {
      await this.markInvalid(record.id, "Skill 资源与安装时记录不一致，已自动停用。");
      throw normalizeServiceError(error, "Skill 资源已变化或无法安全读取，已自动停用。");
    }
    const content = decodeUtf8(bytes, "Skill 资源不是有效 UTF-8 文本，不能载入模型上下文。");
    return {
      skillId: record.id,
      relativePath: safeRelativePath,
      kind: descriptor.kind,
      sha256: descriptor.sha256,
      content
    };
  }

  async removeSkill(skillId: string): Promise<boolean> {
    await this.ensureInitialized();
    const id = normalizeId(skillId, "Skill ID");
    return this.withOperationLock(async () => {
      const index = this.records.findIndex((record) => record.id === id);
      if (index < 0) return false;
      const record = this.records[index];
      if (record.source.kind === "builtin") {
        throw new SkillPackageError("invalid-request", "内置 Skill 可以停用，但不能从应用中移除。");
      }
      const root = await this.resolveStoredRoot(record);
      const quarantine = path.join(this.stagingRoot, `remove-${randomUUID()}`);
      let moved = false;
      try {
        await fs.rename(root, quarantine);
        moved = true;
        this.records.splice(index, 1);
        await this.persistRegistry();
      } catch (error) {
        if (!this.records.some((item) => item.id === record.id)) this.records.splice(index, 0, record);
        if (moved) await fs.rename(quarantine, root).catch(() => undefined);
        throw normalizeServiceError(error, "Skill 移除失败，原安装已回滚保留。");
      }
      await fs.rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
      return true;
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeInternal().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
  }

  private async initializeInternal(): Promise<void> {
    try {
      await ensureControlledDirectory(this.requestedStorageRoot);
      this.storageRoot = await fs.realpath(this.requestedStorageRoot);
      this.packagesRoot = path.join(this.storageRoot, "packages");
      this.stagingRoot = path.join(this.storageRoot, ".staging");
      this.registryPath = path.join(this.storageRoot, "skill-packages.json");
      await ensureControlledDirectory(this.packagesRoot);
      await ensureControlledDirectory(this.stagingRoot);
      await fs.rm(this.stagingRoot, { recursive: true, force: true });
      await fs.mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
      this.records = await this.loadRegistry();
    } catch (error) {
      throw normalizeServiceError(error, "Skill 本地存储初始化失败。");
    }
  }

  private async loadRegistry(): Promise<StoredSkillPackageRecord[]> {
    const backupPath = `${this.registryPath}.previous`;
    if (!(await pathExists(this.registryPath)) && await pathExists(backupPath)) await fs.rename(backupPath, this.registryPath);
    let raw: string;
    try {
      raw = await fs.readFile(this.registryPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SkillPackageError("storage-failure", "Skill 注册表损坏，已停止加载以避免覆盖现有记录。");
    }
    const records = validateRegistryFile(parsed);
    for (const record of records) {
      const duplicate = records.find((candidate) => candidate !== record
        && candidate.name === record.name
        && skillPackageScopeKey(candidate.scope) === skillPackageScopeKey(record.scope));
      if (duplicate) throw new SkillPackageError("storage-failure", "Skill 注册表存在同一范围的重复名称，已停止加载。");
      this.assertRootRef(record.rootRef);
      const expectedRoot = this.installedPackagePath(record.scope, record.name);
      const recordedRoot = path.resolve(this.storageRoot, fromPortableRelativePath(record.rootRef));
      if (!pathsEqual(expectedRoot, recordedRoot)) {
        throw new SkillPackageError("storage-failure", "Skill 注册表中的安装路径与范围或名称不一致。");
      }
    }
    return records;
  }

  private async persistRegistry(): Promise<void> {
    const state: SkillRegistryFile = { schemaVersion: REGISTRY_SCHEMA_VERSION, packages: this.records };
    const tempPath = path.join(this.storageRoot, `.skill-packages-${process.pid}-${Date.now()}-${randomUUID()}.tmp`);
    const backupPath = `${this.registryPath}.previous`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    let movedCurrent = false;
    try {
      await fs.rm(backupPath, { force: true });
      try {
        await fs.rename(this.registryPath, backupPath);
        movedCurrent = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await fs.rename(tempPath, this.registryPath);
      if (movedCurrent) await fs.rm(backupPath, { force: true });
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      if (movedCurrent) await fs.rename(backupPath, this.registryPath).catch(() => undefined);
      throw error;
    }
  }

  private assertNameAvailable(name: string, scope: SkillPackageScope, ignoredImportId?: string): void {
    const scopeKey = skillPackageScopeKey(scope);
    if (this.records.some((record) => record.name === name && skillPackageScopeKey(record.scope) === scopeKey)) {
      throw new SkillPackageError("duplicate-name", "同一安装范围内已存在同名 Skill，请先移除旧版本或选择其他范围。");
    }
    for (const [importId, pending] of this.pending) {
      if (importId !== ignoredImportId && pending.preview.name === name && skillPackageScopeKey(pending.preview.scope) === scopeKey) {
        throw new SkillPackageError("duplicate-name", "同一安装范围内已有同名 Skill 正在等待确认，请先处理该预检。");
      }
    }
  }

  private installedPackagePath(scope: SkillPackageScope, name: string): string {
    const scopeDirectory = scope.kind === "global"
      ? "global"
      : path.join("project", createHash("sha256").update(scope.projectId, "utf8").digest("hex"));
    const target = path.resolve(this.packagesRoot, scopeDirectory, name);
    assertContained(this.packagesRoot, target, "Skill 安装目标超出受控存储范围。");
    return target;
  }

  private assertRootRef(rootRef: string): void {
    validateSkillArchiveEntryPath(rootRef, { ...this.limits, maxDepth: Math.max(this.limits.maxDepth, 4) });
    const target = path.resolve(this.storageRoot, fromPortableRelativePath(rootRef));
    assertContained(this.packagesRoot, target, "Skill 注册路径超出受控存储范围。");
  }

  private requireStoredRecord(id: string): StoredSkillPackageRecord {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new SkillPackageError("skill-not-found", "Skill 不存在或已经移除。");
    return record;
  }

  private findEffectiveRecord(name: string, projectId: string | null): StoredSkillPackageRecord | null {
    const isAvailable = (record: StoredSkillPackageRecord): boolean => record.enabled
      && (record.validation.status === "valid" || record.validation.status === "warning");
    let projectRecord: StoredSkillPackageRecord | undefined;
    if (projectId) {
      projectRecord = this.records.find((record) => record.name === name
        && record.scope.kind === "project"
        && record.scope.projectId === projectId);
      if (projectRecord && isAvailable(projectRecord)) return projectRecord;
    }
    const globalRecord = this.records.find((record) => record.name === name && record.scope.kind === "global");
    if (globalRecord && isAvailable(globalRecord)) return globalRecord;
    return projectRecord ?? globalRecord ?? null;
  }

  private async resolveStoredRoot(record: StoredSkillPackageRecord): Promise<string> {
    this.assertRootRef(record.rootRef);
    const root = path.resolve(this.storageRoot, fromPortableRelativePath(record.rootRef));
    const stats = await safeLstat(root, "Skill 安装目录无法访问。");
    if (stats.isSymbolicLink()) throw new SkillPackageError("unsafe-link", "Skill 安装目录不能是符号链接或目录联接。");
    if (!stats.isDirectory()) throw new SkillPackageError("package-tampered", "Skill 安装目录已损坏。");
    const realRoot = await fs.realpath(root);
    assertContained(this.packagesRoot, realRoot, "Skill 安装目录已逃逸受控存储范围。");
    return realRoot;
  }

  private async inspectInstalled(record: StoredSkillPackageRecord): Promise<InspectedPackage> {
    try {
      const root = await this.resolveStoredRoot(record);
      const scan = await scanSkillDirectory(root, this.limits);
      const inspected = await inspectSkillPackage(root, scan, this.limits, record.name);
      const diagnostics = [...inspected.validation.diagnostics];
      if (inspected.markdown.frontmatter.name !== record.name) {
        diagnostics.push(diagnostic("name-changed", "error", "SKILL.md 的 name 与安装记录不一致。", "SKILL.md"));
      }
      if (inspected.sha256 !== record.sha256) {
        diagnostics.push(diagnostic("hash-changed", "error", "Skill 文件 hash 与安装时记录不一致。", null));
      }
      return { ...inspected, validation: buildValidation(diagnostics) };
    } catch (error) {
      return {
        resources: record.resources,
        directoryPaths: [],
        stats: record.stats,
        sha256: record.sha256,
        hasScriptsDirectory: record.scriptStatus === "present-listed-not-executable",
        markdown: { frontmatter: record.frontmatter, body: "", lineCount: 0 },
        scriptStatus: record.scriptStatus,
        validation: buildValidation([
          diagnostic("installed-package-unreadable", "error", safeChineseMessage(error, "Skill 安装目录无法安全读取。"), null)
        ])
      };
    }
  }

  private async readVerifiedSkillMarkdown(record: StoredSkillPackageRecord): Promise<ParsedSkillMarkdown> {
    const descriptor = record.resources.find((resource) => resource.relativePath === "SKILL.md" && resource.kind === "instructions");
    if (!descriptor) throw new SkillPackageError("package-tampered", "Skill 安装记录缺少 SKILL.md。");
    const root = await this.resolveStoredRoot(record);
    const bytes = await readVerifiedFile(root, "SKILL.md", descriptor, this.limits);
    const markdown = parseSkillMarkdown(decodeUtf8(bytes, "SKILL.md 不是有效 UTF-8 文本。"));
    if (markdown.frontmatter.name !== record.name || markdown.frontmatter.description !== record.description) {
      throw new SkillPackageError("package-tampered", "SKILL.md 元数据与安装记录不一致。");
    }
    return markdown;
  }

  private async markInvalid(skillId: string, message: string): Promise<void> {
    await this.withOperationLock(async () => {
      const record = this.records.find((item) => item.id === skillId);
      if (!record) return;
      record.enabled = false;
      record.validation = buildValidation([diagnostic("package-tampered", "error", message, null)]);
      record.updatedAt = new Date().toISOString();
      await this.persistRegistry();
    }).catch(() => undefined);
  }

  private withOperationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function parseSkillMarkdown(source: string): ParsedSkillMarkdown {
  if (typeof source !== "string") throw new SkillPackageError("invalid-skill", "SKILL.md 内容无效。");
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (normalized.includes("\u0000")) throw new SkillPackageError("invalid-skill", "SKILL.md 包含非法空字符。");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") throw new SkillPackageError("invalid-skill", "SKILL.md 必须从 YAML frontmatter 的 --- 开始。");
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) throw new SkillPackageError("invalid-skill", "SKILL.md 缺少 YAML frontmatter 结束标记 ---。");
  const frontmatterSource = lines.slice(1, closingIndex).join("\n");
  if (Buffer.byteLength(frontmatterSource, "utf8") > FRONTMATTER_MAX_BYTES) {
    throw new SkillPackageError("invalid-skill", "SKILL.md 的 YAML frontmatter 超过 64 KB 安全上限。");
  }
  const values = parseControlledYamlFrontmatter(lines.slice(1, closingIndex));
  const name = requiredFrontmatterString(values, "name");
  const description = requiredFrontmatterString(values, "description");
  validateFrontmatterName(name);
  if (characterCount(description) > 4_096) throw new SkillPackageError("invalid-skill", "SKILL.md 的 description 不能超过 4096 个字符。");
  const compatibility = optionalFrontmatterString(values, "compatibility");
  if (compatibility !== null && (compatibility.length === 0 || characterCount(compatibility) > 500)) {
    throw new SkillPackageError("invalid-skill", "SKILL.md 的 compatibility 必须是 1 到 500 个字符。");
  }
  const metadataValue = values.get("metadata");
  if (metadataValue !== undefined && (typeof metadataValue !== "object" || Array.isArray(metadataValue))) {
    throw new SkillPackageError("invalid-skill", "SKILL.md 的 metadata 必须是字符串键值映射。");
  }
  const knownKeys = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  const additional: Record<string, string> = {};
  for (const [key, value] of values) {
    if (knownKeys.has(key)) continue;
    if (typeof value !== "string") throw new SkillPackageError("invalid-skill", `SKILL.md 的 ${key} 仅支持简单字符串值。`);
    additional[key] = value;
  }
  const frontmatter: SkillFrontmatter = {
    name,
    description,
    license: optionalFrontmatterString(values, "license"),
    compatibility,
    metadata: metadataValue && typeof metadataValue === "object" ? { ...metadataValue } : {},
    allowedTools: optionalFrontmatterString(values, "allowed-tools"),
    additional
  };
  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join("\n").trim(),
    lineCount: lines.length
  };
}

export function validateSkillArchiveEntryPath(entryPath: string, limits: Pick<SkillPackageLimits, "maxDepth"> = DEFAULT_SKILL_PACKAGE_LIMITS): string {
  if (typeof entryPath !== "string" || !entryPath.trim()) {
    throw new SkillPackageError("unsafe-path", "Skill 包含空文件路径，已拒绝。");
  }
  if (entryPath.includes("\u0000")) throw new SkillPackageError("unsafe-path", "Skill 文件路径包含非法空字符，已拒绝。");
  if (entryPath.includes("\\")) throw new SkillPackageError("unsafe-path", "Skill 文件路径包含不安全的反斜杠，已拒绝。");
  const withoutTrailingSlash = entryPath.endsWith("/") ? entryPath.slice(0, -1) : entryPath;
  if (!withoutTrailingSlash || withoutTrailingSlash.startsWith("/") || /^[A-Za-z]:/.test(withoutTrailingSlash)) {
    throw new SkillPackageError("unsafe-path", "Skill 包含绝对路径或磁盘路径，已拒绝。");
  }
  const segments = withoutTrailingSlash.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new SkillPackageError("unsafe-path", "Skill 包含路径穿越或无效路径段，已拒绝。");
  }
  if (segments.some((segment) => segment.includes(":"))) {
    throw new SkillPackageError("unsafe-path", "Skill 文件路径包含不安全的冒号，已拒绝。");
  }
  if (!Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 || segments.length > limits.maxDepth) {
    throw new SkillPackageError("package-limit", `Skill 文件路径超过最大 ${limits.maxDepth} 层限制。`);
  }
  return segments.join("/");
}

async function scanSkillDirectory(sourceRoot: string, limits: SkillPackageLimits, copyRoot?: string): Promise<ScanResult> {
  const rootStats = await safeLstat(sourceRoot, "无法读取所选 Skill 文件夹。");
  if (rootStats.isSymbolicLink()) throw new SkillPackageError("unsafe-link", "所选 Skill 文件夹不能是符号链接或目录联接。");
  if (!rootStats.isDirectory()) throw new SkillPackageError("invalid-request", "请选择包含 SKILL.md 的文件夹。");
  const canonicalRoot = await fs.realpath(sourceRoot);
  if (copyRoot) await fs.mkdir(copyRoot, { recursive: true, mode: 0o700 });

  const resources: SkillResourceDescriptor[] = [];
  const directoryPaths: string[] = [];
  const queue: Array<{ absolutePath: string; relativePath: string }> = [{ absolutePath: sourceRoot, relativePath: "" }];
  let directoryCount = 0;
  let totalBytes = 0;
  let maximumDepth = 0;
  let hasScriptsDirectory = false;

  while (queue.length > 0) {
    const current = queue.shift() as { absolutePath: string; relativePath: string };
    let entries;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      throw new SkillPackageError("invalid-request", "Skill 文件夹包含无法读取的目录。");
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.includes("/") || entry.name.includes("\\") || entry.name.includes("\u0000")) {
        throw new SkillPackageError("unsafe-path", "Skill 包含不安全的文件名，已拒绝。");
      }
      const relativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;
      const safeRelativePath = validateSkillArchiveEntryPath(relativePath, limits);
      const absolutePath = path.join(current.absolutePath, entry.name);
      const stats = await safeLstat(absolutePath, `Skill 文件 ${safeRelativePath} 无法读取。`);
      if (stats.isSymbolicLink()) {
        throw new SkillPackageError("unsafe-link", `Skill 包含符号链接或目录联接：${safeRelativePath}。为防止路径逃逸，已拒绝导入。`);
      }
      const realEntry = await fs.realpath(absolutePath);
      assertContained(canonicalRoot, realEntry, `Skill 文件 ${safeRelativePath} 逃逸了所选文件夹。`);
      const depth = safeRelativePath.split("/").length;
      maximumDepth = Math.max(maximumDepth, depth);

      if (stats.isDirectory()) {
        directoryCount += 1;
        directoryPaths.push(safeRelativePath);
        if (directoryCount > limits.maxDirectories) {
          throw new SkillPackageError("package-limit", `Skill 目录数超过 ${limits.maxDirectories} 个安全上限。`);
        }
        if (safeRelativePath === "scripts") hasScriptsDirectory = true;
        if (copyRoot) await fs.mkdir(path.join(copyRoot, fromPortableRelativePath(safeRelativePath)), { recursive: false, mode: 0o700 });
        queue.push({ absolutePath, relativePath: safeRelativePath });
        continue;
      }
      if (!stats.isFile()) throw new SkillPackageError("unsafe-path", `Skill 包含不支持的特殊文件：${safeRelativePath}。`);
      if (resources.length + 1 > limits.maxFiles) {
        throw new SkillPackageError("package-limit", `Skill 文件数超过 ${limits.maxFiles} 个安全上限。`);
      }
      if (stats.size > limits.maxSingleFileBytes) {
        throw new SkillPackageError("package-limit", `Skill 文件 ${safeRelativePath} 超过单文件大小上限。`);
      }
      if (safeRelativePath === "SKILL.md" && stats.size > limits.maxSkillMarkdownBytes) {
        throw new SkillPackageError("package-limit", "SKILL.md 超过专用大小上限，请拆分详细内容到 references/。");
      }

      const bytes = await readSourceFileSafely(absolutePath, canonicalRoot, safeRelativePath);
      if (bytes.byteLength > limits.maxSingleFileBytes) {
        throw new SkillPackageError("package-limit", `Skill 文件 ${safeRelativePath} 超过单文件大小上限。`);
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.maxTotalBytes) {
        throw new SkillPackageError("package-limit", `Skill 总大小超过 ${formatBytes(limits.maxTotalBytes)} 安全上限。`);
      }
      const kind = resourceKind(safeRelativePath);
      const descriptor: SkillResourceDescriptor = {
        relativePath: safeRelativePath,
        kind,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        depth,
        executable: kind === "script" || (stats.mode & 0o111) !== 0,
        executionPolicy: kind === "script" ? "listed-not-executable" : "not-applicable"
      };
      resources.push(descriptor);
      if (kind === "script") hasScriptsDirectory = true;
      if (copyRoot) {
        const target = path.resolve(copyRoot, fromPortableRelativePath(safeRelativePath));
        assertContained(copyRoot, target, "Skill staging 写入路径超出隔离目录。");
        await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      }
    }
  }

  resources.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  directoryPaths.sort((a, b) => a.localeCompare(b));
  if (!resources.some((resource) => resource.relativePath === "SKILL.md" && resource.kind === "instructions")) {
    const nestedSkills = resources
      .filter((resource) => resource.kind === "instructions" && resource.relativePath.endsWith("/SKILL.md"))
      .map((resource) => resource.relativePath.slice(0, -"/SKILL.md".length))
      .slice(0, 8);
    const guidance = nestedSkills.length > 0
      ? `检测到这是 Skill 合集。请重新导入其中一个具体目录：${nestedSkills.join("、")}。`
      : "请选择直接包含 SKILL.md 的单个 Skill 文件夹。";
    throw new SkillPackageError("invalid-skill", `所选文件夹根目录缺少名称完全匹配的 SKILL.md。${guidance}`);
  }
  return {
    resources,
    directoryPaths,
    stats: { fileCount: resources.length, directoryCount, totalBytes, maxDepth: maximumDepth },
    sha256: packageHash(resources, directoryPaths),
    hasScriptsDirectory
  };
}

async function inspectSkillPackage(
  root: string,
  scan: ScanResult,
  limits: SkillPackageLimits,
  sourceDirectoryName: string
): Promise<InspectedPackage> {
  const descriptor = scan.resources.find((resource) => resource.relativePath === "SKILL.md");
  if (!descriptor) throw new SkillPackageError("invalid-skill", "Skill 包缺少 SKILL.md。");
  const bytes = await readVerifiedFile(root, "SKILL.md", descriptor, limits);
  const markdown = parseSkillMarkdown(decodeUtf8(bytes, "SKILL.md 不是有效 UTF-8 文本。"));
  const diagnostics: SkillValidationDiagnostic[] = [];
  if (sourceDirectoryName !== markdown.frontmatter.name) {
    diagnostics.push(diagnostic(
      "directory-name-mismatch",
      "warning",
      `文件夹名称与 SKILL.md 的 name 不一致；安装后将使用 ${markdown.frontmatter.name}。`,
      "SKILL.md"
    ));
  }
  if (markdown.lineCount > 500) {
    diagnostics.push(diagnostic("long-skill-markdown", "warning", "SKILL.md 超过建议的 500 行，建议把细节拆到 references/。", "SKILL.md"));
  }
  if (markdown.frontmatter.allowedTools) {
    diagnostics.push(diagnostic(
      "allowed-tools-advisory-only",
      "warning",
      "allowed-tools 是实验字段，在本工作台中只作参考，不能覆盖 PolicyEngine 或获得权限。",
      "SKILL.md"
    ));
  }
  const scriptStatus: SkillScriptStatus = scan.hasScriptsDirectory ? "present-listed-not-executable" : "absent";
  if (scriptStatus !== "absent") {
    diagnostics.push(diagnostic("scripts-disabled", "warning", "检测到 scripts/；只展示清单，当前版本不会执行其中脚本。", "scripts"));
  }
  return { ...scan, markdown, validation: buildValidation(diagnostics), scriptStatus };
}

async function readSourceFileSafely(absolutePath: string, canonicalRoot: string, relativePath: string): Promise<Uint8Array> {
  const before = await safeLstat(absolutePath, `Skill 文件 ${relativePath} 无法读取。`);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new SkillPackageError("unsafe-link", `Skill 文件 ${relativePath} 在读取前发生了不安全变化。`);
  }
  const realPath = await fs.realpath(absolutePath);
  assertContained(canonicalRoot, realPath, `Skill 文件 ${relativePath} 逃逸了所选文件夹。`);
  let handle;
  try {
    handle = await fs.open(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") {
      throw new SkillPackageError("unsafe-link", `Skill 文件 ${relativePath} 无法安全打开。`);
    }
    handle = await fs.open(realPath, fsConstants.O_RDONLY);
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new SkillPackageError("unsafe-path", `Skill 文件 ${relativePath} 不是普通文件。`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readVerifiedFile(
  root: string,
  relativePath: string,
  descriptor: SkillResourceDescriptor,
  limits: SkillPackageLimits
): Promise<Uint8Array> {
  const safeRelativePath = validateSkillArchiveEntryPath(relativePath, limits);
  const target = path.resolve(root, fromPortableRelativePath(safeRelativePath));
  assertContained(root, target, "Skill 资源路径超出安装目录。");
  const stats = await safeLstat(target, "Skill 资源无法读取。");
  if (stats.isSymbolicLink()) throw new SkillPackageError("unsafe-link", "Skill 资源不能是符号链接或目录联接。");
  if (!stats.isFile()) throw new SkillPackageError("package-tampered", "Skill 资源不再是普通文件。");
  const realTarget = await fs.realpath(target);
  assertContained(root, realTarget, "Skill 资源已逃逸安装目录。");
  const bytes = await fs.readFile(realTarget);
  if (bytes.byteLength !== descriptor.sizeBytes || sha256(bytes) !== descriptor.sha256) {
    throw new SkillPackageError("package-tampered", "Skill 资源 hash 与安装时记录不一致。");
  }
  return bytes;
}

function parseControlledYamlFrontmatter(lines: string[]): Map<string, ParsedYamlValue> {
  const source = lines.join("\n");
  let parsed: unknown;
  try {
    const document = parseDocument(source, {
      schema: "core",
      merge: false,
      prettyErrors: false,
      uniqueKeys: true
    });
    if (document.errors.length > 0) throw document.errors[0];
    parsed = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").trim().slice(0, 180) : "格式无法解析";
    throw new SkillPackageError("invalid-skill", `SKILL.md 的 YAML frontmatter 格式损坏：${detail}。`);
  }
  if (!isPlainRecord(parsed)) {
    throw new SkillPackageError("invalid-skill", "SKILL.md 的 YAML frontmatter 必须是键值映射。");
  }

  const values = new Map<string, ParsedYamlValue>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
      throw new SkillPackageError("invalid-skill", `SKILL.md 的 YAML frontmatter 字段名 ${key} 无效。`);
    }
    if (key === "metadata") {
      if (!isPlainRecord(value) || Object.keys(value).length === 0) {
        throw new SkillPackageError("invalid-skill", "SKILL.md 的 metadata 必须包含至少一个键值。");
      }
      const metadata: Record<string, string> = {};
      for (const [metadataKey, metadataValue] of Object.entries(value)) {
        if (!/^[A-Za-z0-9_.-]+$/.test(metadataKey)) {
          throw new SkillPackageError("invalid-skill", `SKILL.md 的 metadata 字段名 ${metadataKey} 无效。`);
        }
        metadata[metadataKey] = metadataString(metadataValue, metadataKey);
      }
      values.set(key, metadata);
      continue;
    }
    if (key === "allowed-tools" && Array.isArray(value) && value.every((item) => typeof item === "string")) {
      values.set(key, value.join(" "));
      continue;
    }
    if (typeof value !== "string") {
      throw new SkillPackageError("invalid-skill", `SKILL.md 的 ${key} 必须是字符串。`);
    }
    values.set(key, value);
  }
  return values;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metadataString(value: unknown, key: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value) || isPlainRecord(value)) {
    const serialized = JSON.stringify(value);
    if (serialized.length > 8_192) throw new SkillPackageError("invalid-skill", `SKILL.md 的 metadata.${key} 内容过长。`);
    return serialized;
  }
  throw new SkillPackageError("invalid-skill", `SKILL.md 的 metadata.${key} 类型不受支持。`);
}

function requiredFrontmatterString(values: Map<string, ParsedYamlValue>, key: string): string {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) throw new SkillPackageError("invalid-skill", `SKILL.md 必须提供非空 ${key}。`);
  return value.trim();
}

function optionalFrontmatterString(values: Map<string, ParsedYamlValue>, key: string): string | null {
  const value = values.get(key);
  if (value === undefined) return null;
  if (typeof value !== "string") throw new SkillPackageError("invalid-skill", `SKILL.md 的 ${key} 必须是字符串。`);
  return value.trim();
}

function validateFrontmatterName(name: string): void {
  if (characterCount(name) > 64) throw new SkillPackageError("invalid-skill", "SKILL.md 的 name 不能超过 64 个字符。");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new SkillPackageError("invalid-skill", "SKILL.md 的 name 只能包含小写字母、数字和单个连字符，且不能以连字符开头或结尾。");
  }
}

function normalizeSkillName(name: string): string {
  if (typeof name !== "string") throw new SkillPackageError("invalid-request", "Skill 名称无效。");
  const normalized = name.trim();
  validateFrontmatterName(normalized);
  return normalized;
}

function normalizePreflightInput(input: SkillPackagePreflightInput): SkillPackagePreflightInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SkillPackageError("invalid-request", "Skill 预检请求无效。");
  if (input.sourceKind !== "folder" && input.sourceKind !== "zip") {
    throw new SkillPackageError("invalid-request", "Skill 来源必须是文件夹或 zip。");
  }
  if (typeof input.sourcePath !== "string" || !input.sourcePath.trim() || !path.isAbsolute(input.sourcePath)) {
    throw new SkillPackageError("invalid-request", "Skill 来源必须是通过系统选择器取得的绝对路径。");
  }
  return { sourceKind: input.sourceKind, sourcePath: input.sourcePath, scope: parseSkillPackageScope(input.scope) };
}

function normalizeOptionalProjectId(projectId?: string | null): string | null {
  if (projectId === null || projectId === undefined) return null;
  const scope = parseSkillPackageScope({ kind: "project", projectId });
  if (scope.kind !== "project") throw new SkillPackageError("invalid-request", "Project ID 无效。");
  return scope.projectId;
}

function normalizeLimits(overrides?: Partial<SkillPackageLimits>): SkillPackageLimits {
  const limits = { ...DEFAULT_SKILL_PACKAGE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new SkillPackageError("invalid-request", `Skill 安全限制 ${key} 无效。`);
  }
  if (limits.maxSkillMarkdownBytes > limits.maxSingleFileBytes) {
    throw new SkillPackageError("invalid-request", "SKILL.md 大小上限不能高于单文件大小上限。");
  }
  return limits;
}

function validateRegistryFile(value: unknown): StoredSkillPackageRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillPackageError("storage-failure", "Skill 注册表结构损坏。");
  }
  const registry = value as Partial<SkillRegistryFile>;
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(registry.packages)) {
    throw new SkillPackageError("storage-failure", "Skill 注册表版本不受支持或内容损坏。");
  }
  return registry.packages.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new SkillPackageError("storage-failure", "Skill 注册表包含无效记录。");
    }
    const record = candidate as StoredSkillPackageRecord;
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.rootRef !== "string"
      || typeof record.sha256 !== "string" || typeof record.enabled !== "boolean" || !Array.isArray(record.resources)) {
      throw new SkillPackageError("storage-failure", "Skill 注册表记录字段损坏。");
    }
    if (!record.source || !["folder", "zip", "builtin"].includes(record.source.kind)
      || typeof record.source.label !== "string" || !record.source.label.trim()) {
      throw new SkillPackageError("storage-failure", "Skill 注册表来源字段损坏。");
    }
    validateFrontmatterName(record.name);
    parseSkillPackageScope(record.scope);
    return record;
  });
}

function resourceKind(relativePath: string): SkillResourceDescriptor["kind"] {
  if (relativePath === "SKILL.md") return "instructions";
  if (relativePath.startsWith("scripts/")) return "script";
  if (relativePath.startsWith("references/")) return "reference";
  if (relativePath.startsWith("assets/")) return "asset";
  return "other";
}

function packageHash(resources: SkillResourceDescriptor[], directoryPaths: string[]): string {
  const hash = createHash("sha256");
  for (const directoryPath of directoryPaths) hash.update(`D\u0000${directoryPath}\n`, "utf8");
  for (const resource of resources) hash.update(`F\u0000${resource.relativePath}\u0000${resource.sizeBytes}\u0000${resource.sha256}\n`, "utf8");
  return hash.digest("hex");
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildValidation(diagnostics: SkillValidationDiagnostic[]): SkillValidationResult {
  const status = diagnostics.some((item) => item.level === "error")
    ? "invalid"
    : diagnostics.some((item) => item.level === "warning") ? "warning" : "valid";
  return { status, checkedAt: new Date().toISOString(), diagnostics };
}

function diagnostic(code: string, level: "warning" | "error", message: string, relativePath: string | null): SkillValidationDiagnostic {
  return { code, level, message, relativePath };
}

function summarizeInstructions(markdown: ParsedSkillMarkdown): string {
  const summary = markdown.body.replace(/\s+/g, " ").trim() || markdown.frontmatter.description;
  return characterSlice(summary, INSTRUCTION_SUMMARY_CHARS);
}

function decodeUtf8(bytes: Uint8Array, message: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new SkillPackageError("invalid-skill", message);
  }
}

async function ensureControlledDirectory(directoryPath: string): Promise<void> {
  try {
    const stats = await fs.lstat(directoryPath);
    if (stats.isSymbolicLink()) throw new SkillPackageError("unsafe-link", "Skill 受控存储目录不能是符号链接或目录联接。");
    if (!stats.isDirectory()) throw new SkillPackageError("storage-failure", "Skill 受控存储路径不是文件夹。");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  }
}

async function safeLstat(target: string, message: string) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error instanceof SkillPackageError) throw error;
    throw new SkillPackageError("invalid-request", message);
  }
}

function assertContained(root: string, candidate: string, message: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) return;
  throw new SkillPackageError("unsafe-path", message);
}

function pathsEqual(left: string, right: string): boolean {
  const normalize = (value: string): string => process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function toPortableRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function fromPortableRelativePath(value: string): string {
  return value.split("/").join(path.sep);
}

function normalizeId(value: string, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.trim())) {
    throw new SkillPackageError("invalid-request", `${label}格式无效。`);
  }
  return value.trim();
}

function normalizeServiceError(error: unknown, fallback: string): SkillPackageError {
  if (error instanceof SkillPackageError) return error;
  return new SkillPackageError("storage-failure", fallback);
}

function safeChineseMessage(error: unknown, fallback: string): string {
  return error instanceof SkillPackageError ? error.message : fallback;
}

function characterCount(value: string): number {
  return [...value].length;
}

function builtinSkillId(name: string): string {
  return `skill-builtin-${createHash("sha256").update(name, "utf8").digest("hex").slice(0, 24)}`;
}

function characterSlice(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join("");
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.floor(value / (1024 * 1024))} MB`;
  if (value >= 1024) return `${Math.floor(value / 1024)} KB`;
  return `${value} 字节`;
}

function compareRecords(a: Pick<SkillPackageRecord, "name" | "scope">, b: Pick<SkillPackageRecord, "name" | "scope">): number {
  return a.name.localeCompare(b.name) || skillPackageScopeKey(a.scope).localeCompare(skillPackageScopeKey(b.scope));
}

function cloneScope(scope: SkillPackageScope): SkillPackageScope {
  return scope.kind === "global" ? { kind: "global" } : { kind: "project", projectId: scope.projectId };
}

function cloneFrontmatter(frontmatter: SkillFrontmatter): SkillFrontmatter {
  return { ...frontmatter, metadata: { ...frontmatter.metadata }, additional: { ...frontmatter.additional } };
}

function cloneResource(resource: SkillResourceDescriptor): SkillResourceDescriptor {
  return { ...resource };
}

function cloneValidation(validation: SkillValidationResult): SkillValidationResult {
  return { ...validation, diagnostics: validation.diagnostics.map((item) => ({ ...item })) };
}

function cloneRecord(record: StoredSkillPackageRecord): SkillPackageRecord {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    frontmatter: cloneFrontmatter(record.frontmatter),
    source: { ...record.source },
    scope: cloneScope(record.scope),
    sha256: record.sha256,
    enabled: record.enabled,
    validation: cloneValidation(record.validation),
    scriptStatus: record.scriptStatus,
    resources: record.resources.map(cloneResource),
    stats: { ...record.stats },
    installedAt: record.installedAt,
    updatedAt: record.updatedAt
  };
}

function clonePreview(preview: SkillPackagePreview): SkillPackagePreview {
  return {
    ...preview,
    frontmatter: cloneFrontmatter(preview.frontmatter),
    source: { ...preview.source },
    scope: cloneScope(preview.scope),
    validation: cloneValidation(preview.validation),
    resources: preview.resources.map(cloneResource),
    stats: { ...preview.stats },
    limits: { ...preview.limits }
  };
}
