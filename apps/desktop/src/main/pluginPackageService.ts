import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import { parseSkillMarkdown } from "./skillPackageService";
import type {
  PluginComponentSummary,
  PluginInlineSkill,
  PluginManifest,
  PluginMcpPreset,
  PluginMcpTransportPreset,
  PluginPackageLimits,
  PluginPackagePreflightInput,
  PluginPackagePreview,
  PluginPackageRecord,
  PluginPackageScope,
  PluginPackageSource,
  PluginPackageStats,
  PluginPromptFragment,
  PluginResourceDescriptor,
  PluginRiskSummary,
  PluginSkillDeclaration,
  PluginSkillReference,
  PluginTemplateDeclaration,
  PluginValidationDiagnostic,
  PluginValidationResult
} from "../shared/pluginTypes";
import { parsePluginPackageScope, pluginPackageScopeKey } from "../shared/pluginTypes";

const REGISTRY_SCHEMA_VERSION = 1;
const MANIFEST_FILE = "extension.json";
const SECURE_STORE_REF = /^secure-store:[A-Za-z0-9._:-]{1,220}$/;
const SAFE_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SAFE_HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const EXECUTABLE_EXTENSION = /\.(?:bat|cmd|com|cpl|dll|exe|hta|jar|js|jsx|mjs|cjs|msi|node|ps1|py|sh|ts|tsx|vbs|wsf)$/i;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SENSITIVE_KEY = /(?:api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;
const OBVIOUS_SECRET = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{12,}|\b(?:sk|pk)-[A-Za-z0-9_-]{16,})/i;

export const PLUGIN_TURN_CONTEXT_LIMITS = Object.freeze({
  maxPackages: 3,
  maxContributions: 6,
  maxChars: 12_000,
  maxCharsPerContribution: 4_000
});

export const DEFAULT_PLUGIN_PACKAGE_LIMITS: Readonly<PluginPackageLimits> = Object.freeze({
  maxFiles: 500,
  maxDirectories: 200,
  maxSingleFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxDepth: 10,
  maxManifestBytes: 256 * 1024,
  maxTextResourceBytes: 1024 * 1024
});

export type PluginPackageErrorCode =
  | "invalid-request"
  | "unsafe-path"
  | "unsafe-link"
  | "package-limit"
  | "invalid-manifest"
  | "unsupported-content"
  | "plaintext-secret"
  | "duplicate-name"
  | "version-conflict"
  | "preflight-not-found"
  | "plugin-not-found"
  | "package-tampered"
  | "rollback-unavailable"
  | "storage-failure";

export class PluginPackageError extends Error {
  readonly code: PluginPackageErrorCode;

  constructor(code: PluginPackageErrorCode, message: string) {
    super(message);
    this.name = "PluginPackageError";
    this.code = code;
  }
}

interface ScannedFile {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  depth: number;
}

interface ScannedPackage {
  files: ScannedFile[];
  directoryPaths: string[];
  stats: PluginPackageStats;
  sha256: string;
}

interface InspectedPackage extends ScannedPackage {
  manifest: PluginManifest;
  validation: PluginValidationResult;
  components: PluginComponentSummary;
  risks: PluginRiskSummary;
  resources: PluginResourceDescriptor[];
}

interface PendingPluginImport {
  preview: PluginPackagePreview;
  stagingPath: string;
}

interface StoredPluginVersion {
  version: string;
  displayName: string;
  description: string;
  source: PluginPackageSource;
  sha256: string;
  manifest: PluginManifest;
  validation: PluginValidationResult;
  components: PluginComponentSummary;
  risks: PluginRiskSummary;
  resources: PluginResourceDescriptor[];
  stats: PluginPackageStats;
  installedAt: string;
  rootRef: string;
}

interface StoredPluginPackageRecord {
  id: string;
  name: string;
  scope: PluginPackageScope;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  versions: StoredPluginVersion[];
}

interface PluginRegistryFile {
  schemaVersion: number;
  packages: StoredPluginPackageRecord[];
}

interface UpgradeDecision {
  operation: "install" | "upgrade";
  previousVersion: string | null;
  record: StoredPluginPackageRecord | null;
}

interface RankedPluginPackage {
  record: StoredPluginPackageRecord;
  version: StoredPluginVersion;
  score: number;
  packageLevelScore: number;
}

interface PluginContributionCandidate extends PluginTurnContextContribution {
  names: string[];
  description: string;
}

export interface PluginTurnContextContribution {
  ref: string;
  pluginId: string;
  pluginName: string;
  kind: "prompt-fragment" | "skill-instructions";
  content: string;
}

export class PluginPackageService {
  private readonly requestedStorageRoot: string;
  private readonly limits: PluginPackageLimits;
  private storageRoot = "";
  private packagesRoot = "";
  private stagingRoot = "";
  private registryPath = "";
  private initialization: Promise<void> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private records: StoredPluginPackageRecord[] = [];
  private readonly pending = new Map<string, PendingPluginImport>();

  constructor(storageRoot: string, options: { limits?: Partial<PluginPackageLimits> } = {}) {
    if (typeof storageRoot !== "string" || !storageRoot.trim()) {
      throw new PluginPackageError("invalid-request", "Plugin 存储目录无效。");
    }
    this.requestedStorageRoot = path.resolve(storageRoot);
    this.limits = normalizeLimits(options.limits);
  }

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  async preflightImport(input: PluginPackagePreflightInput): Promise<PluginPackagePreview> {
    await this.ensureInitialized();
    const request = normalizePreflightInput(input);
    return this.withOperationLock(async () => {
      let stagingPath: string | null = null;
      try {
        stagingPath = await fs.mkdtemp(path.join(this.stagingRoot, "import-"));
        const sourcePath = path.resolve(request.sourcePath);
        const scan = await scanPluginDirectory(sourcePath, this.limits, stagingPath);
        const inspected = await inspectPluginPackage(stagingPath, scan, this.limits);
        const decision = this.decideImport(inspected.manifest.name, inspected.manifest.version, request.scope);
        this.assertNoPendingDuplicate(inspected.manifest.name, request.scope);

        const importId = `plugin-import-${randomUUID()}`;
        const preview: PluginPackagePreview = {
          importId,
          operation: decision.operation,
          previousVersion: decision.previousVersion,
          name: inspected.manifest.name,
          displayName: inspected.manifest.displayName,
          description: inspected.manifest.description,
          version: inspected.manifest.version,
          source: { kind: "folder", label: path.basename(sourcePath) || "Plugin 文件夹" },
          scope: request.scope,
          sha256: inspected.sha256,
          enabled: false,
          manifest: inspected.manifest,
          validation: inspected.validation,
          components: inspected.components,
          risks: inspected.risks,
          resources: inspected.resources,
          stats: inspected.stats,
          limits: { ...this.limits }
        };
        this.pending.set(importId, { preview, stagingPath });
        return clonePreview(preview);
      } catch (error) {
        if (stagingPath) await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
        throw normalizeServiceError(error, "Plugin 文件夹预检失败，请确认目录可访问且 extension.json 有效。");
      }
    });
  }

  async confirmImport(importId: string): Promise<PluginPackageRecord> {
    await this.ensureInitialized();
    const normalizedImportId = normalizeId(importId, "预检 ID");
    return this.withOperationLock(async () => {
      const pending = this.pending.get(normalizedImportId);
      if (!pending) throw new PluginPackageError("preflight-not-found", "Plugin 预检记录不存在或已经失效，请重新预检。");
      if (pending.preview.validation.status === "invalid") {
        throw new PluginPackageError("invalid-manifest", "Plugin 未通过校验，不能安装。");
      }

      let inspected: InspectedPackage;
      try {
        const stagedScan = await scanPluginDirectory(pending.stagingPath, this.limits);
        inspected = await inspectPluginPackage(pending.stagingPath, stagedScan, this.limits);
        if (inspected.sha256 !== pending.preview.sha256
          || inspected.manifest.name !== pending.preview.name
          || inspected.manifest.version !== pending.preview.version
          || JSON.stringify(inspected.manifest) !== JSON.stringify(pending.preview.manifest)) {
          throw new PluginPackageError("package-tampered", "Plugin staging 内容在确认前发生变化，已拒绝安装。");
        }
      } catch (error) {
        await fs.rm(pending.stagingPath, { recursive: true, force: true }).catch(() => undefined);
        this.pending.delete(normalizedImportId);
        throw normalizeServiceError(error, "Plugin staging 无法重新校验，已清理并拒绝安装。");
      }

      const decision = this.decideImport(inspected.manifest.name, inspected.manifest.version, pending.preview.scope);
      if (decision.operation !== pending.preview.operation || decision.previousVersion !== pending.preview.previousVersion) {
        throw new PluginPackageError("version-conflict", "Plugin 当前版本在预检后发生变化，请重新预检升级内容。");
      }
      this.assertNoPendingDuplicate(inspected.manifest.name, pending.preview.scope, normalizedImportId);

      const targetPath = this.installedPackagePath(pending.preview.scope, inspected.manifest.name, inspected.sha256);
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      if (await pathExists(targetPath)) {
        throw new PluginPackageError("duplicate-name", "相同 Plugin 包内容已经存在，不能重复安装。");
      }

      const now = new Date().toISOString();
      const storedVersion: StoredPluginVersion = {
        version: inspected.manifest.version,
        displayName: inspected.manifest.displayName,
        description: inspected.manifest.description,
        source: pending.preview.source,
        sha256: inspected.sha256,
        manifest: inspected.manifest,
        validation: inspected.validation,
        components: inspected.components,
        risks: inspected.risks,
        resources: inspected.resources,
        stats: inspected.stats,
        installedAt: now,
        rootRef: toPortableRelativePath(path.relative(this.storageRoot, targetPath))
      };

      const existing = decision.record;
      const previousEnabled = existing?.enabled ?? false;
      const previousUpdatedAt = existing?.updatedAt ?? "";
      const created: StoredPluginPackageRecord | null = existing ? null : {
        id: `plugin-${randomUUID()}`,
        name: inspected.manifest.name,
        scope: pending.preview.scope,
        enabled: false,
        installedAt: now,
        updatedAt: now,
        versions: []
      };
      const targetRecord = existing ?? created as StoredPluginPackageRecord;
      let movedToTarget = false;
      try {
        await fs.rename(pending.stagingPath, targetPath);
        movedToTarget = true;
        targetRecord.versions.push(storedVersion);
        targetRecord.enabled = false;
        targetRecord.updatedAt = now;
        if (created) this.records.push(created);
        await this.persistRegistry();
        this.pending.delete(normalizedImportId);
        return toPublicRecord(targetRecord);
      } catch (error) {
        targetRecord.versions = targetRecord.versions.filter((item) => item.sha256 !== storedVersion.sha256);
        targetRecord.enabled = previousEnabled;
        targetRecord.updatedAt = previousUpdatedAt || targetRecord.installedAt;
        if (created) this.records = this.records.filter((item) => item.id !== created.id);
        if (movedToTarget) {
          try {
            await fs.rename(targetPath, pending.stagingPath);
          } catch {
            await fs.rm(targetPath, { recursive: true, force: true }).catch(() => undefined);
          }
        }
        throw normalizeServiceError(error, "Plugin 安装或升级失败，旧版本和启停状态已回滚保留。");
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

  async listPendingPreviews(): Promise<PluginPackagePreview[]> {
    await this.ensureInitialized();
    return [...this.pending.values()]
      .map((item) => clonePreview(item.preview))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listInstalled(): Promise<PluginPackageRecord[]> {
    await this.ensureInitialized();
    return this.records.map(toPublicRecord).sort(compareRecords);
  }

  async resolveTurnContextContributions(
    userContent: string,
    projectId?: string | null
  ): Promise<PluginTurnContextContribution[]> {
    await this.ensureInitialized();
    const normalizedInput = normalizeTurnInput(userContent);
    if (!normalizedInput) return [];
    const normalizedProjectId = normalizeContextProjectId(projectId);

    return this.withOperationLock(async () => {
      const effective = new Map<string, StoredPluginPackageRecord>();
      for (const record of this.records) {
        if (isPluginAvailableForTurn(record) && record.scope.kind === "global") effective.set(record.name, record);
      }
      if (normalizedProjectId) {
        for (const record of this.records) {
          if (isPluginAvailableForTurn(record)
            && record.scope.kind === "project"
            && record.scope.projectId === normalizedProjectId) {
            effective.set(record.name, record);
          }
        }
      }

      const ranked = [...effective.values()]
        .map((record): RankedPluginPackage => {
          const version = activeVersion(record);
          const scores = pluginPackageRelevance(normalizedInput, record, version);
          return { record, version, score: scores.score, packageLevelScore: scores.packageLevelScore };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.record.name.localeCompare(right.record.name))
        .slice(0, PLUGIN_TURN_CONTEXT_LIMITS.maxPackages * 2);

      const contributions: PluginTurnContextContribution[] = [];
      let remainingChars = PLUGIN_TURN_CONTEXT_LIMITS.maxChars;
      let contributingPackages = 0;
      for (const candidate of ranked) {
        if (contributingPackages >= PLUGIN_TURN_CONTEXT_LIMITS.maxPackages
          || contributions.length >= PLUGIN_TURN_CONTEXT_LIMITS.maxContributions
          || remainingChars < 1) break;

        const inspection = await this.inspectStoredVersion(candidate.record, candidate.version);
        if (inspection.validation.status === "invalid") {
          await this.disableAfterContextFailure(candidate.record, candidate.version, inspection.validation);
          continue;
        }

        let packageCandidates: PluginContributionCandidate[];
        try {
          const root = await this.resolveStoredRoot(candidate.version);
          packageCandidates = await readPluginContributionCandidates(
            root,
            candidate.record,
            inspection,
            this.limits
          );
        } catch {
          const validation = buildValidation([
            ...inspection.validation.diagnostics,
            diagnostic(
              "context-resource-unreadable",
              "error",
              "Plugin 上下文资源已变化或无法安全读取，已自动停用。",
              null
            )
          ]);
          await this.disableAfterContextFailure(candidate.record, candidate.version, validation);
          continue;
        }

        const selected = packageCandidates
          .map((item) => ({
            item,
            score: Math.max(
              contributionRelevance(normalizedInput, item),
              candidate.packageLevelScore > 0 ? Math.min(candidate.packageLevelScore, 500) : 0
            )
          }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score || left.item.ref.localeCompare(right.item.ref));

        let packageContributed = false;
        for (const { item } of selected) {
          if (contributions.length >= PLUGIN_TURN_CONTEXT_LIMITS.maxContributions || remainingChars < 1) break;
          const content = takeCharacters(
            item.content.trim(),
            Math.min(PLUGIN_TURN_CONTEXT_LIMITS.maxCharsPerContribution, remainingChars)
          );
          if (!content) continue;
          contributions.push({
            ref: item.ref,
            pluginId: item.pluginId,
            pluginName: item.pluginName,
            kind: item.kind,
            content
          });
          remainingChars -= countCharacters(content);
          packageContributed = true;
        }
        if (packageContributed) contributingPackages += 1;
      }
      return contributions;
    });
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginPackageRecord> {
    await this.ensureInitialized();
    const id = normalizeId(pluginId, "Plugin ID");
    if (typeof enabled !== "boolean") throw new PluginPackageError("invalid-request", "Plugin 启停状态无效。");
    return this.withOperationLock(async () => {
      const record = this.requireRecord(id);
      const active = activeVersion(record);
      const oldEnabled = record.enabled;
      const oldUpdatedAt = record.updatedAt;
      const oldValidation = active.validation;
      if (enabled) {
        const inspection = await this.inspectStoredVersion(record, active);
        active.validation = inspection.validation;
        if (inspection.validation.status === "invalid") {
          record.enabled = false;
          record.updatedAt = new Date().toISOString();
          try {
            await this.persistRegistry();
          } catch (error) {
            record.enabled = oldEnabled;
            record.updatedAt = oldUpdatedAt;
            active.validation = oldValidation;
            throw normalizeServiceError(error, "Plugin 校验失败状态无法保存，原启停记录已恢复。");
          }
          throw new PluginPackageError("package-tampered", "Plugin 当前校验未通过，已保持停用。请重新导入可信包。");
        }
      }
      record.enabled = enabled;
      record.updatedAt = new Date().toISOString();
      try {
        await this.persistRegistry();
      } catch (error) {
        record.enabled = oldEnabled;
        record.updatedAt = oldUpdatedAt;
        active.validation = oldValidation;
        throw normalizeServiceError(error, "Plugin 启停状态保存失败，原状态已保留。");
      }
      return toPublicRecord(record);
    });
  }

  async validateInstalled(pluginId: string): Promise<PluginPackageRecord> {
    await this.ensureInitialized();
    const id = normalizeId(pluginId, "Plugin ID");
    return this.withOperationLock(async () => {
      const record = this.requireRecord(id);
      const active = activeVersion(record);
      const oldEnabled = record.enabled;
      const oldUpdatedAt = record.updatedAt;
      const oldValidation = active.validation;
      const inspection = await this.inspectStoredVersion(record, active);
      active.validation = inspection.validation;
      if (inspection.validation.status === "invalid") record.enabled = false;
      record.updatedAt = new Date().toISOString();
      try {
        await this.persistRegistry();
      } catch (error) {
        record.enabled = oldEnabled;
        record.updatedAt = oldUpdatedAt;
        active.validation = oldValidation;
        throw normalizeServiceError(error, "Plugin 校验结果保存失败，原记录已保留。");
      }
      return toPublicRecord(record);
    });
  }

  async rollback(pluginId: string): Promise<PluginPackageRecord> {
    await this.ensureInitialized();
    const id = normalizeId(pluginId, "Plugin ID");
    return this.withOperationLock(async () => {
      const record = this.requireRecord(id);
      if (record.versions.length < 2) {
        throw new PluginPackageError("rollback-unavailable", "该 Plugin 没有可回滚的上一版本。");
      }
      const current = activeVersion(record);
      const previous = record.versions[record.versions.length - 2];
      const oldPreviousValidation = previous.validation;
      const previousInspection = await this.inspectStoredVersion(record, previous);
      if (previousInspection.validation.status === "invalid") {
        throw new PluginPackageError("package-tampered", "Plugin 上一版本校验失败，不能回滚到损坏内容。");
      }
      previous.validation = previousInspection.validation;

      const currentRoot = await this.resolveStoredRoot(current);
      const quarantine = path.join(this.stagingRoot, `rollback-${randomUUID()}`);
      const oldEnabled = record.enabled;
      const oldUpdatedAt = record.updatedAt;
      let moved = false;
      try {
        await fs.rename(currentRoot, quarantine);
        moved = true;
        record.versions.pop();
        record.enabled = false;
        record.updatedAt = new Date().toISOString();
        await this.persistRegistry();
      } catch (error) {
        if (!record.versions.some((item) => item.sha256 === current.sha256)) record.versions.push(current);
        record.enabled = oldEnabled;
        record.updatedAt = oldUpdatedAt;
        previous.validation = oldPreviousValidation;
        if (moved) await fs.rename(quarantine, currentRoot).catch(() => undefined);
        throw normalizeServiceError(error, "Plugin 回滚失败，当前版本和启停状态已恢复。");
      }
      await fs.rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
      return toPublicRecord(record);
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
      this.registryPath = path.join(this.storageRoot, "plugin-packages.json");
      await ensureControlledDirectory(this.packagesRoot);
      await ensureControlledDirectory(this.stagingRoot);
      await fs.rm(this.stagingRoot, { recursive: true, force: true });
      await fs.mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
      this.records = await this.loadRegistry();
    } catch (error) {
      throw normalizeServiceError(error, "Plugin 本地存储初始化失败。");
    }
  }

  private async loadRegistry(): Promise<StoredPluginPackageRecord[]> {
    const backupPath = `${this.registryPath}.previous`;
    if (!(await pathExists(this.registryPath)) && await pathExists(backupPath)) {
      await fs.rename(backupPath, this.registryPath);
    }
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
      throw new PluginPackageError("storage-failure", "Plugin 注册表损坏，已停止加载以避免覆盖现有记录。");
    }
    const records = validateRegistryFile(parsed);
    for (const record of records) {
      const duplicate = records.find((candidate) => candidate !== record
        && candidate.name === record.name
        && pluginPackageScopeKey(candidate.scope) === pluginPackageScopeKey(record.scope));
      if (duplicate) throw new PluginPackageError("storage-failure", "Plugin 注册表存在同一范围的重复名称，已停止加载。");
      for (const version of record.versions) {
        this.assertRootRef(version.rootRef);
        const expectedRoot = this.installedPackagePath(record.scope, record.name, version.sha256);
        const recordedRoot = path.resolve(this.storageRoot, fromPortableRelativePath(version.rootRef));
        if (!pathsEqual(expectedRoot, recordedRoot)) {
          throw new PluginPackageError("storage-failure", "Plugin 注册表中的版本路径与名称、范围或 hash 不一致。");
        }
      }
    }
    return records;
  }

  private async persistRegistry(): Promise<void> {
    const state: PluginRegistryFile = { schemaVersion: REGISTRY_SCHEMA_VERSION, packages: this.records };
    const tempPath = path.join(this.storageRoot, `.plugin-packages-${process.pid}-${Date.now()}-${randomUUID()}.tmp`);
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
      if (movedCurrent) await fs.rm(backupPath, { force: true }).catch(() => undefined);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      if (movedCurrent) await fs.rename(backupPath, this.registryPath).catch(() => undefined);
      throw error;
    }
  }

  private decideImport(name: string, version: string, scope: PluginPackageScope): UpgradeDecision {
    const scopeKey = pluginPackageScopeKey(scope);
    const record = this.records.find((item) => item.name === name && pluginPackageScopeKey(item.scope) === scopeKey) ?? null;
    if (!record) return { operation: "install", previousVersion: null, record: null };
    const currentVersion = activeVersion(record).version;
    const comparison = compareSemver(version, currentVersion);
    if (comparison === 0) {
      throw new PluginPackageError("duplicate-name", `同一安装范围内已存在 ${name} ${version}，不能重复安装。`);
    }
    if (comparison < 0) {
      throw new PluginPackageError("version-conflict", `Plugin 新版本 ${version} 不能低于当前版本 ${currentVersion}。`);
    }
    return { operation: "upgrade", previousVersion: currentVersion, record };
  }

  private assertNoPendingDuplicate(name: string, scope: PluginPackageScope, ignoredImportId?: string): void {
    const scopeKey = pluginPackageScopeKey(scope);
    for (const [importId, pending] of this.pending) {
      if (importId !== ignoredImportId
        && pending.preview.name === name
        && pluginPackageScopeKey(pending.preview.scope) === scopeKey) {
        throw new PluginPackageError("duplicate-name", "同一安装范围内已有同名 Plugin 正在等待确认，请先处理该预检。");
      }
    }
  }

  private installedPackagePath(scope: PluginPackageScope, name: string, packageHash: string): string {
    const scopeDirectory = scope.kind === "global"
      ? "global"
      : path.join("project", createHash("sha256").update(scope.projectId, "utf8").digest("hex"));
    const target = path.resolve(this.packagesRoot, scopeDirectory, name, packageHash);
    assertContained(this.packagesRoot, target, "Plugin 安装目标超出受控存储范围。");
    return target;
  }

  private assertRootRef(rootRef: string): void {
    validatePluginPackageEntryPath(rootRef, { maxDepth: Math.max(this.limits.maxDepth, 6) });
    const target = path.resolve(this.storageRoot, fromPortableRelativePath(rootRef));
    assertContained(this.packagesRoot, target, "Plugin 注册路径超出受控存储范围。");
  }

  private requireRecord(id: string): StoredPluginPackageRecord {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new PluginPackageError("plugin-not-found", "Plugin 不存在或已经移除。");
    return record;
  }

  private async resolveStoredRoot(version: StoredPluginVersion): Promise<string> {
    this.assertRootRef(version.rootRef);
    const root = path.resolve(this.storageRoot, fromPortableRelativePath(version.rootRef));
    const stats = await safeLstat(root, "Plugin 安装目录无法访问。");
    if (stats.isSymbolicLink()) throw new PluginPackageError("unsafe-link", "Plugin 安装目录不能是符号链接或目录联接。");
    if (!stats.isDirectory()) throw new PluginPackageError("package-tampered", "Plugin 安装目录已损坏。");
    const realRoot = await fs.realpath(root);
    assertContained(this.packagesRoot, realRoot, "Plugin 安装目录已逃逸受控存储范围。");
    return realRoot;
  }

  private async inspectStoredVersion(record: StoredPluginPackageRecord, version: StoredPluginVersion): Promise<InspectedPackage> {
    try {
      const root = await this.resolveStoredRoot(version);
      const scan = await scanPluginDirectory(root, this.limits);
      const inspected = await inspectPluginPackage(root, scan, this.limits);
      const diagnostics = [...inspected.validation.diagnostics];
      if (inspected.manifest.name !== record.name || inspected.manifest.version !== version.version) {
        diagnostics.push(diagnostic("identity-changed", "error", "extension.json 的名称或版本与安装记录不一致。", MANIFEST_FILE));
      }
      if (inspected.sha256 !== version.sha256) {
        diagnostics.push(diagnostic("hash-changed", "error", "Plugin 文件 hash 与安装时记录不一致。", null));
      }
      return { ...inspected, validation: buildValidation(diagnostics) };
    } catch (error) {
      return {
        files: version.resources.map((item) => ({
          relativePath: item.relativePath,
          sizeBytes: item.sizeBytes,
          sha256: item.sha256,
          depth: item.depth
        })),
        directoryPaths: [],
        stats: version.stats,
        sha256: version.sha256,
        manifest: version.manifest,
        validation: buildValidation([
          diagnostic("installed-package-unreadable", "error", safeChineseMessage(error, "Plugin 安装目录无法安全读取。"), null)
        ]),
        components: version.components,
        risks: version.risks,
        resources: version.resources
      };
    }
  }

  private async disableAfterContextFailure(
    record: StoredPluginPackageRecord,
    version: StoredPluginVersion,
    validation: PluginValidationResult
  ): Promise<void> {
    record.enabled = false;
    record.updatedAt = new Date().toISOString();
    version.validation = validation;
    await this.persistRegistry().catch(() => undefined);
  }

  private withOperationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function parsePluginManifest(source: string): PluginManifest {
  if (typeof source !== "string") throw new PluginPackageError("invalid-manifest", "extension.json 内容无效。");
  const normalized = source.replace(/^\uFEFF/, "");
  if (normalized.includes("\u0000")) throw new PluginPackageError("invalid-manifest", "extension.json 包含非法空字符。");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new PluginPackageError("invalid-manifest", "extension.json 不是有效 JSON。");
  }
  assertNoObviousSecrets(value);
  const manifest = requireObject(value, "extension.json");
  assertKnownKeys(manifest, [
    "schemaVersion",
    "name",
    "displayName",
    "version",
    "description",
    "publisher",
    "metadata",
    "skills",
    "mcpPresets",
    "promptFragments",
    "templates"
  ], "extension.json");
  if (manifest.schemaVersion !== 1) {
    throw new PluginPackageError("invalid-manifest", "extension.json 的 schemaVersion 必须是 1。");
  }
  const name = pluginName(manifest.name);
  const version = semver(manifest.version, "Plugin version");
  const displayName = optionalDisplayText(manifest.displayName, name, 100, "displayName");
  const description = requiredDisplayText(manifest.description, 1_000, "description");
  const publisher = optionalNullableDisplayText(manifest.publisher, 200, "publisher");
  const metadata = parseMetadata(manifest.metadata);
  const skills = parseSkills(manifest.skills);
  const mcpPresets = parseMcpPresets(manifest.mcpPresets);
  const promptFragments = parsePromptFragments(manifest.promptFragments);
  const templates = parseTemplates(manifest.templates);
  ensureUniqueIds(mcpPresets, "MCP preset");
  ensureUniqueIds(promptFragments, "Prompt fragment");
  ensureUniqueIds(templates, "模板");
  return {
    schemaVersion: 1,
    name,
    displayName,
    version,
    description,
    publisher,
    metadata,
    skills,
    mcpPresets,
    promptFragments,
    templates
  };
}

export function validatePluginPackageEntryPath(
  entryPath: string,
  limits: Pick<PluginPackageLimits, "maxDepth"> = DEFAULT_PLUGIN_PACKAGE_LIMITS
): string {
  if (typeof entryPath !== "string" || !entryPath.trim()) {
    throw new PluginPackageError("unsafe-path", "Plugin 包含空文件路径，已拒绝。");
  }
  if (entryPath.includes("\u0000")) throw new PluginPackageError("unsafe-path", "Plugin 文件路径包含非法空字符，已拒绝。");
  if (entryPath.includes("\\")) throw new PluginPackageError("unsafe-path", "Plugin 文件路径包含不安全的反斜杠，已拒绝。");
  const withoutTrailingSlash = entryPath.endsWith("/") ? entryPath.slice(0, -1) : entryPath;
  if (!withoutTrailingSlash || withoutTrailingSlash.startsWith("/") || /^[A-Za-z]:/.test(withoutTrailingSlash)) {
    throw new PluginPackageError("unsafe-path", "Plugin 包含绝对路径或磁盘路径，已拒绝。");
  }
  if (withoutTrailingSlash.length > 1_024) throw new PluginPackageError("unsafe-path", "Plugin 文件路径过长，已拒绝。");
  const segments = withoutTrailingSlash.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PluginPackageError("unsafe-path", "Plugin 包含路径穿越或无效路径段，已拒绝。");
  }
  if (segments.some((segment) => segment.includes(":") || segment.length > 128 || /[. ]$/.test(segment) || WINDOWS_RESERVED_NAME.test(segment))) {
    throw new PluginPackageError("unsafe-path", "Plugin 文件路径包含不安全或不兼容的路径段，已拒绝。");
  }
  if (!Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 || segments.length > limits.maxDepth) {
    throw new PluginPackageError("package-limit", `Plugin 文件路径超过最大 ${limits.maxDepth} 层限制。`);
  }
  return segments.join("/");
}

async function scanPluginDirectory(sourceRoot: string, limits: PluginPackageLimits, copyRoot?: string): Promise<ScannedPackage> {
  const rootStats = await safeLstat(sourceRoot, "无法读取所选 Plugin 文件夹。");
  if (rootStats.isSymbolicLink()) throw new PluginPackageError("unsafe-link", "所选 Plugin 文件夹不能是符号链接或目录联接。");
  if (!rootStats.isDirectory()) throw new PluginPackageError("invalid-request", "请选择包含 extension.json 的文件夹。");
  const canonicalRoot = await fs.realpath(sourceRoot);
  if (copyRoot) await fs.mkdir(copyRoot, { recursive: true, mode: 0o700 });

  const files: ScannedFile[] = [];
  const directoryPaths: string[] = [];
  const seenPaths = new Set<string>();
  const queue: Array<{ absolutePath: string; relativePath: string }> = [{ absolutePath: sourceRoot, relativePath: "" }];
  let directoryCount = 0;
  let totalBytes = 0;
  let maximumDepth = 0;

  while (queue.length > 0) {
    const current = queue.shift() as { absolutePath: string; relativePath: string };
    let entries;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      throw new PluginPackageError("invalid-request", "Plugin 文件夹包含无法读取的目录。");
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.includes("/") || entry.name.includes("\\") || entry.name.includes("\u0000")) {
        throw new PluginPackageError("unsafe-path", "Plugin 包含不安全的文件名，已拒绝。");
      }
      const relativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;
      const safeRelativePath = validatePluginPackageEntryPath(relativePath, limits);
      const foldedPath = safeRelativePath.toLocaleLowerCase("en-US");
      if (seenPaths.has(foldedPath)) throw new PluginPackageError("unsafe-path", "Plugin 包含大小写冲突的重复路径，已拒绝。");
      seenPaths.add(foldedPath);
      const absolutePath = path.join(current.absolutePath, entry.name);
      const stats = await safeLstat(absolutePath, `Plugin 文件 ${safeRelativePath} 无法读取。`);
      if (stats.isSymbolicLink()) {
        throw new PluginPackageError("unsafe-link", `Plugin 包含符号链接或目录联接：${safeRelativePath}。为防止路径逃逸，已拒绝导入。`);
      }
      const realEntry = await fs.realpath(absolutePath);
      assertContained(canonicalRoot, realEntry, `Plugin 文件 ${safeRelativePath} 逃逸了所选文件夹。`);
      const depth = safeRelativePath.split("/").length;
      maximumDepth = Math.max(maximumDepth, depth);

      if (stats.isDirectory()) {
        directoryCount += 1;
        directoryPaths.push(safeRelativePath);
        if (directoryCount > limits.maxDirectories) {
          throw new PluginPackageError("package-limit", `Plugin 目录数超过 ${limits.maxDirectories} 个安全上限。`);
        }
        if (copyRoot) {
          await fs.mkdir(path.join(copyRoot, fromPortableRelativePath(safeRelativePath)), { recursive: false, mode: 0o700 });
        }
        queue.push({ absolutePath, relativePath: safeRelativePath });
        continue;
      }
      if (!stats.isFile()) throw new PluginPackageError("unsafe-path", `Plugin 包含不支持的特殊文件：${safeRelativePath}。`);
      if (files.length + 1 > limits.maxFiles) {
        throw new PluginPackageError("package-limit", `Plugin 文件数超过 ${limits.maxFiles} 个安全上限。`);
      }
      if (stats.size > limits.maxSingleFileBytes) {
        throw new PluginPackageError("package-limit", `Plugin 文件 ${safeRelativePath} 超过单文件大小上限。`);
      }
      if (safeRelativePath === MANIFEST_FILE && stats.size > limits.maxManifestBytes) {
        throw new PluginPackageError("package-limit", "extension.json 超过专用大小上限。");
      }
      const bytes = await readSourceFileSafely(absolutePath, canonicalRoot, safeRelativePath);
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.maxTotalBytes) {
        throw new PluginPackageError("package-limit", `Plugin 总大小超过 ${formatBytes(limits.maxTotalBytes)} 安全上限。`);
      }
      const descriptor: ScannedFile = {
        relativePath: safeRelativePath,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
        depth
      };
      files.push(descriptor);
      if (copyRoot) {
        const target = path.resolve(copyRoot, fromPortableRelativePath(safeRelativePath));
        assertContained(copyRoot, target, "Plugin staging 写入路径超出隔离目录。");
        await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      }
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  directoryPaths.sort((a, b) => a.localeCompare(b));
  if (!files.some((item) => item.relativePath === MANIFEST_FILE)) {
    throw new PluginPackageError("invalid-manifest", "所选文件夹根目录缺少名称完全匹配的 extension.json。");
  }
  return {
    files,
    directoryPaths,
    stats: { fileCount: files.length, directoryCount, totalBytes, maxDepth: maximumDepth },
    sha256: packageHash(files, directoryPaths)
  };
}

async function inspectPluginPackage(root: string, scan: ScannedPackage, limits: PluginPackageLimits): Promise<InspectedPackage> {
  const manifestFile = requireScannedFile(scan, MANIFEST_FILE, "Plugin 包缺少 extension.json。");
  const manifestBytes = await readVerifiedFile(root, manifestFile, limits);
  const manifest = parsePluginManifest(decodeUtf8(manifestBytes, "extension.json 不是有效 UTF-8 文本。"));
  const diagnostics: PluginValidationDiagnostic[] = [];
  const resources: PluginResourceDescriptor[] = [];
  const inlineRoots = manifest.skills.filter((item): item is PluginInlineSkill => item.kind === "inline").map((item) => item.path);
  validateInlineRoots(inlineRoots);
  const exactClaims = new Map<string, "prompt-fragment" | "template">();
  for (const prompt of manifest.promptFragments) {
    if (!prompt.path.startsWith("prompts/") || !/\.(?:md|txt)$/i.test(prompt.path)) {
      throw new PluginPackageError("unsupported-content", "Prompt fragment 必须引用 prompts/ 下的 .md 或 .txt 文本文件。");
    }
    claimExactPath(exactClaims, prompt.path, "prompt-fragment");
  }
  for (const template of manifest.templates) {
    if (!template.path.startsWith("templates/") || EXECUTABLE_EXTENSION.test(template.path)) {
      throw new PluginPackageError("unsupported-content", "模板必须位于 templates/，且不能使用可执行脚本扩展名。");
    }
    claimExactPath(exactClaims, template.path, "template");
  }

  const skillNames = new Set<string>();
  for (const declaration of manifest.skills) {
    if (declaration.kind === "reference") addUniqueSkillName(skillNames, declaration.name);
  }
  let scriptsPresent = false;
  for (const file of scan.files) {
    let kind: PluginResourceDescriptor["kind"];
    let executionPolicy: PluginResourceDescriptor["executionPolicy"] = "declarative-only";
    if (file.relativePath === MANIFEST_FILE) {
      kind = "manifest";
    } else if (exactClaims.has(file.relativePath)) {
      kind = exactClaims.get(file.relativePath) as "prompt-fragment" | "template";
      if (file.sizeBytes > limits.maxTextResourceBytes) {
        throw new PluginPackageError("package-limit", `${file.relativePath} 超过文本资源大小上限。`);
      }
      decodeUtf8(await readVerifiedFile(root, file, limits), `${file.relativePath} 不是有效 UTF-8 文本。`);
    } else {
      const inlineRoot = inlineRoots.find((candidate) => file.relativePath.startsWith(`${candidate}/`));
      if (!inlineRoot) {
        throw new PluginPackageError("unsupported-content", `Plugin 包含 extension.json 未声明的额外文件：${file.relativePath}。`);
      }
      const skillRelativePath = file.relativePath.slice(inlineRoot.length + 1);
      if (skillRelativePath === "SKILL.md") {
        kind = "skill-instructions";
      } else if (skillRelativePath.startsWith("scripts/")) {
        kind = "skill-script";
        executionPolicy = "listed-not-executable";
        scriptsPresent = true;
      } else {
        if (EXECUTABLE_EXTENSION.test(skillRelativePath)) {
          throw new PluginPackageError(
            "unsupported-content",
            `内嵌 Skill 的可执行文件只能放在 scripts/ 并保持禁用：${file.relativePath}。`
          );
        }
        kind = "skill-resource";
      }
    }
    resources.push({ ...file, kind, executionPolicy });
  }

  for (const [claimedPath] of exactClaims) {
    if (!scan.files.some((item) => item.relativePath === claimedPath)) {
      throw new PluginPackageError("invalid-manifest", `extension.json 引用的文件不存在：${claimedPath}。`);
    }
  }
  for (const inlineRoot of inlineRoots) {
    const skillMarkdownPath = `${inlineRoot}/SKILL.md`;
    const descriptor = scan.files.find((item) => item.relativePath === skillMarkdownPath);
    if (!descriptor) throw new PluginPackageError("invalid-manifest", `内嵌 Skill 缺少 ${skillMarkdownPath}。`);
    if (descriptor.sizeBytes > limits.maxTextResourceBytes) {
      throw new PluginPackageError("package-limit", `${skillMarkdownPath} 超过文本资源大小上限。`);
    }
    let markdown;
    try {
      markdown = parseSkillMarkdown(decodeUtf8(
        await readVerifiedFile(root, descriptor, limits),
        `${skillMarkdownPath} 不是有效 UTF-8 文本。`
      ));
    } catch (error) {
      throw new PluginPackageError("invalid-manifest", safeChineseMessage(error, `内嵌 Skill ${skillMarkdownPath} 无效。`));
    }
    addUniqueSkillName(skillNames, markdown.frontmatter.name);
    if (markdown.frontmatter.allowedTools) {
      diagnostics.push(diagnostic(
        "allowed-tools-advisory-only",
        "warning",
        `${skillMarkdownPath} 的 allowed-tools 只作说明，不能授予 Plugin 权限。`,
        skillMarkdownPath
      ));
    }
  }
  validateDirectories(scan.directoryPaths, resources, inlineRoots);
  if (scriptsPresent) {
    diagnostics.push(diagnostic(
      "scripts-disabled",
      "warning",
      "检测到内嵌 Skill scripts/；文件只进入清单，Plugin 服务不会执行脚本。",
      "skills"
    ));
  }
  if (manifest.skills.some((item) => item.kind === "reference")) {
    diagnostics.push(diagnostic(
      "skill-references-declarative",
      "warning",
      "Skill 引用只保存名称、版本和 hash 声明，不会由 Plugin 自动安装或激活。",
      MANIFEST_FILE
    ));
  }
  const components = componentSummary(manifest);
  const risks: PluginRiskSummary = {
    scriptsPresent,
    scriptsExecution: "disabled",
    rendererCode: "forbidden",
    automaticExecution: "forbidden",
    plaintextSecrets: "forbidden",
    pluginExecution: "none"
  };
  return {
    ...scan,
    manifest,
    validation: buildValidation(diagnostics),
    components,
    risks,
    resources: resources.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  };
}

async function readPluginContributionCandidates(
  root: string,
  record: StoredPluginPackageRecord,
  inspection: InspectedPackage,
  limits: PluginPackageLimits
): Promise<PluginContributionCandidate[]> {
  const candidates: PluginContributionCandidate[] = [];
  for (const fragment of inspection.manifest.promptFragments) {
    const descriptor = inspection.resources.find((item) =>
      item.kind === "prompt-fragment" && item.relativePath === fragment.path);
    if (!descriptor) throw new PluginPackageError("package-tampered", "Plugin Prompt fragment 不在已校验资源清单中。");
    const content = decodeUtf8(
      await readVerifiedFile(root, descriptor, limits),
      "Plugin Prompt fragment 不是有效 UTF-8 文本。"
    ).trim();
    if (!content) continue;
    candidates.push({
      ref: `plugin:${record.id}:prompt:${descriptor.sha256}`,
      pluginId: record.id,
      pluginName: record.name,
      kind: "prompt-fragment",
      names: [fragment.id, fragment.name],
      description: fragment.description,
      content
    });
  }

  for (const declaration of inspection.manifest.skills) {
    if (declaration.kind !== "inline") continue;
    const skillPath = `${declaration.path}/SKILL.md`;
    const descriptor = inspection.resources.find((item) =>
      item.kind === "skill-instructions" && item.relativePath === skillPath);
    if (!descriptor) throw new PluginPackageError("package-tampered", "Plugin 内嵌 Skill 不在已校验资源清单中。");
    const markdown = parseSkillMarkdown(decodeUtf8(
      await readVerifiedFile(root, descriptor, limits),
      "Plugin 内嵌 Skill 不是有效 UTF-8 文本。"
    ));
    const content = markdown.body.trim();
    if (!content) continue;
    candidates.push({
      ref: `plugin:${record.id}:skill:${descriptor.sha256}`,
      pluginId: record.id,
      pluginName: record.name,
      kind: "skill-instructions",
      names: [path.posix.basename(declaration.path), markdown.frontmatter.name],
      description: markdown.frontmatter.description,
      content
    });
  }
  return candidates;
}

function isPluginAvailableForTurn(record: StoredPluginPackageRecord): boolean {
  if (!record.enabled) return false;
  const status = activeVersion(record).validation.status;
  return status === "valid" || status === "warning";
}

function pluginPackageRelevance(
  input: string,
  record: StoredPluginPackageRecord,
  version: StoredPluginVersion
): { score: number; packageLevelScore: number } {
  const packageLevelScore = textRelevanceScore(
    input,
    [record.name, version.displayName],
    [version.description]
  );
  const componentScore = textRelevanceScore(
    input,
    [
      ...version.manifest.promptFragments.flatMap((fragment) => [fragment.id, fragment.name]),
      ...version.manifest.skills
        .filter((declaration): declaration is PluginInlineSkill => declaration.kind === "inline")
        .map((declaration) => path.posix.basename(declaration.path))
    ],
    version.manifest.promptFragments.map((fragment) => fragment.description)
  );
  return { score: Math.max(packageLevelScore, componentScore), packageLevelScore };
}

function contributionRelevance(input: string, contribution: PluginContributionCandidate): number {
  return textRelevanceScore(input, contribution.names, [contribution.description]);
}

function textRelevanceScore(input: string, names: string[], descriptions: string[]): number {
  let score = 0;
  const normalizedNames = names.map(normalizeRelevanceText).filter(Boolean);
  for (const name of new Set(normalizedNames)) {
    if (input.includes(`@${name}`) || input.includes(`/${name}`)) {
      score = Math.max(score, 10_000 + Math.min(500, name.length));
    } else if (input.includes(name)) {
      score += 500 + Math.min(200, name.length * 4);
    }
  }

  const normalizedDescriptions = descriptions.map(normalizeRelevanceText).filter(Boolean);
  for (const description of new Set(normalizedDescriptions)) {
    if (input.includes(description)) score += 300 + Math.min(200, description.length * 2);
  }
  const terms = `${normalizedNames.join(" ")} ${normalizedDescriptions.join(" ")}`
    .split(/[\s,，。;；:：/\\|()（）\[\]{}<>《》_+.-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 64);
  for (const term of new Set(terms)) {
    if (input.includes(term)) score += Math.min(40, term.length * 3);
  }
  return score;
}

function normalizeRelevanceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

function normalizeTurnInput(value: unknown): string {
  if (typeof value !== "string") throw new PluginPackageError("invalid-request", "Plugin Turn 用户输入无效。");
  return normalizeRelevanceText(value.replace(/\u0000/g, ""));
}

function normalizeContextProjectId(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new PluginPackageError("invalid-request", "Plugin Turn Project ID 无效。");
  const projectId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(projectId)) {
    throw new PluginPackageError("invalid-request", "Plugin Turn Project ID 格式无效。");
  }
  return projectId;
}

function takeCharacters(value: string, maximum: number): string {
  if (maximum < 1) return "";
  let result = "";
  let count = 0;
  for (const character of value) {
    if (count >= maximum) break;
    result += character;
    count += 1;
  }
  return result;
}

function countCharacters(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

function parseSkills(value: unknown): PluginSkillDeclaration[] {
  const entries = optionalArray(value, "skills", 100);
  const declarations = entries.map((entry, index): PluginSkillDeclaration => {
    const object = requireObject(entry, `skills[${index}]`);
    if (object.kind === "reference") {
      assertKnownKeys(object, ["kind", "name", "version", "sha256"], `skills[${index}]`);
      const declaration: PluginSkillReference = {
        kind: "reference",
        name: skillName(object.name),
        version: object.version === undefined || object.version === null ? null : semver(object.version, `skills[${index}].version`),
        sha256: object.sha256 === undefined || object.sha256 === null ? null : hashValue(object.sha256, `skills[${index}].sha256`)
      };
      return declaration;
    }
    if (object.kind === "inline") {
      assertKnownKeys(object, ["kind", "path"], `skills[${index}]`);
      return { kind: "inline", path: validatePluginPackageEntryPath(requiredString(object.path, `skills[${index}].path`)) };
    }
    throw new PluginPackageError("invalid-manifest", `skills[${index}].kind 必须是 reference 或 inline。`);
  });
  const references = new Set<string>();
  for (const declaration of declarations) {
    if (declaration.kind === "reference") addUniqueSkillName(references, declaration.name);
  }
  return declarations;
}

function parseMcpPresets(value: unknown): PluginMcpPreset[] {
  return optionalArray(value, "mcpPresets", 50).map((entry, index) => {
    const object = requireObject(entry, `mcpPresets[${index}]`);
    assertKnownKeys(object, ["id", "name", "description", "transport"], `mcpPresets[${index}]`);
    return {
      id: componentId(object.id, `mcpPresets[${index}].id`),
      name: requiredDisplayText(object.name, 100, `mcpPresets[${index}].name`),
      description: optionalDisplayText(object.description, "", 500, `mcpPresets[${index}].description`),
      transport: parseMcpTransport(object.transport, index)
    };
  });
}

function parseMcpTransport(value: unknown, index: number): PluginMcpTransportPreset {
  const label = `mcpPresets[${index}].transport`;
  const object = requireObject(value, label);
  if (object.type === "stdio") {
    assertKnownKeys(object, ["type", "command", "args", "environmentRefs"], label);
    const command = requiredDisplayText(object.command, 500, `${label}.command`);
    const args = optionalArray(object.args, `${label}.args`, 100).map((item, argumentIndex) => {
      const argument = requiredDisplayText(item, 2_000, `${label}.args[${argumentIndex}]`);
      if (/(?:api[-_]?key|authorization|password|secret|token)\s*=/i.test(argument) || OBVIOUS_SECRET.test(argument)) {
        throw new PluginPackageError("plaintext-secret", "MCP STDIO 参数不能携带明文密钥，请改用 environmentRefs。");
      }
      return argument;
    });
    return {
      type: "stdio",
      command,
      args,
      environmentRefs: parseSecretRefMap(object.environmentRefs, SAFE_ENV_NAME, "MCP 环境变量")
    };
  }
  if (object.type === "streamable-http") {
    assertKnownKeys(object, ["type", "endpoint", "headerRefs"], label);
    const endpoint = requiredDisplayText(object.endpoint, 2_000, `${label}.endpoint`);
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new PluginPackageError("invalid-manifest", "MCP Streamable HTTP endpoint 无效。");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new PluginPackageError("invalid-manifest", "MCP 远程 endpoint 必须使用 HTTPS，且不能包含账号、密码或 URL fragment。");
    }
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) {
        throw new PluginPackageError("plaintext-secret", "MCP endpoint 查询参数不能携带密钥，请改用 headerRefs。");
      }
    }
    return {
      type: "streamable-http",
      endpoint: url.toString(),
      headerRefs: parseSecretRefMap(object.headerRefs, SAFE_HEADER_NAME, "MCP HTTP Header")
    };
  }
  throw new PluginPackageError("invalid-manifest", "MCP preset 仅支持 stdio 或 streamable-http。");
}

function parsePromptFragments(value: unknown): PluginPromptFragment[] {
  return optionalArray(value, "promptFragments", 100).map((entry, index) => {
    const object = requireObject(entry, `promptFragments[${index}]`);
    assertKnownKeys(object, ["id", "name", "description", "path"], `promptFragments[${index}]`);
    return {
      id: componentId(object.id, `promptFragments[${index}].id`),
      name: requiredDisplayText(object.name, 100, `promptFragments[${index}].name`),
      description: optionalDisplayText(object.description, "", 500, `promptFragments[${index}].description`),
      path: validatePluginPackageEntryPath(requiredString(object.path, `promptFragments[${index}].path`))
    };
  });
}

function parseTemplates(value: unknown): PluginTemplateDeclaration[] {
  return optionalArray(value, "templates", 100).map((entry, index) => {
    const object = requireObject(entry, `templates[${index}]`);
    assertKnownKeys(object, ["id", "name", "description", "path", "mediaType"], `templates[${index}]`);
    return {
      id: componentId(object.id, `templates[${index}].id`),
      name: requiredDisplayText(object.name, 100, `templates[${index}].name`),
      description: optionalDisplayText(object.description, "", 500, `templates[${index}].description`),
      path: validatePluginPackageEntryPath(requiredString(object.path, `templates[${index}].path`)),
      mediaType: optionalDisplayText(object.mediaType, "text/plain", 100, `templates[${index}].mediaType`)
    };
  });
}

function parseMetadata(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const object = requireObject(value, "metadata");
  const entries = Object.entries(object);
  if (entries.length > 100) throw new PluginPackageError("invalid-manifest", "metadata 条目超过 100 个上限。");
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key)) throw new PluginPackageError("invalid-manifest", `metadata 键无效：${key}。`);
    if (SENSITIVE_KEY.test(key)) throw new PluginPackageError("plaintext-secret", `metadata 不能保存敏感字段：${key}。`);
    result[key] = optionalDisplayText(item, "", 1_000, `metadata.${key}`);
  }
  return result;
}

function parseSecretRefMap(value: unknown, namePattern: RegExp, label: string): Record<string, string> {
  if (value === undefined) return {};
  const object = requireObject(value, label);
  const entries = Object.entries(object);
  if (entries.length > 50) throw new PluginPackageError("invalid-manifest", `${label}数量超过 50 个上限。`);
  const result: Record<string, string> = {};
  for (const [name, ref] of entries) {
    if (!namePattern.test(name)) throw new PluginPackageError("invalid-manifest", `${label}名称无效：${name}。`);
    if (typeof ref !== "string" || !SECURE_STORE_REF.test(ref)) {
      throw new PluginPackageError("plaintext-secret", `${label}只能保存 secure-store 引用，不能保存明文密钥。`);
    }
    result[name] = ref;
  }
  return result;
}

function validateInlineRoots(roots: string[]): void {
  const normalized = new Set<string>();
  for (const root of roots) {
    if (!/^skills\/[^/]+$/.test(root)) {
      throw new PluginPackageError("invalid-manifest", "内嵌 Skill 目录必须使用 skills/<目录名> 格式。");
    }
    const folded = root.toLocaleLowerCase("en-US");
    if (normalized.has(folded)) throw new PluginPackageError("invalid-manifest", `重复声明内嵌 Skill 目录：${root}。`);
    normalized.add(folded);
  }
}

function validateDirectories(
  directories: string[],
  resources: PluginResourceDescriptor[],
  inlineRoots: string[]
): void {
  for (const directory of directories) {
    const used = resources.some((resource) => resource.relativePath.startsWith(`${directory}/`))
      || inlineRoots.some((root) => directory === root || directory.startsWith(`${root}/`) || root.startsWith(`${directory}/`));
    if (!used) throw new PluginPackageError("unsupported-content", `Plugin 包含未声明的空目录：${directory}。`);
  }
}

async function readSourceFileSafely(absolutePath: string, canonicalRoot: string, relativePath: string): Promise<Uint8Array> {
  const before = await safeLstat(absolutePath, `Plugin 文件 ${relativePath} 无法读取。`);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new PluginPackageError("unsafe-link", `Plugin 文件 ${relativePath} 在读取前发生了不安全变化。`);
  }
  const realPath = await fs.realpath(absolutePath);
  assertContained(canonicalRoot, realPath, `Plugin 文件 ${relativePath} 逃逸了所选文件夹。`);
  let handle;
  try {
    handle = await fs.open(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") {
      throw new PluginPackageError("unsafe-link", `Plugin 文件 ${relativePath} 无法安全打开。`);
    }
    handle = await fs.open(realPath, fsConstants.O_RDONLY);
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new PluginPackageError("unsafe-path", `Plugin 文件 ${relativePath} 不是普通文件。`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readVerifiedFile(root: string, descriptor: ScannedFile, limits: PluginPackageLimits): Promise<Uint8Array> {
  const safeRelativePath = validatePluginPackageEntryPath(descriptor.relativePath, limits);
  const target = path.resolve(root, fromPortableRelativePath(safeRelativePath));
  assertContained(root, target, "Plugin 资源路径超出安装目录。");
  const stats = await safeLstat(target, "Plugin 资源无法读取。");
  if (stats.isSymbolicLink()) throw new PluginPackageError("unsafe-link", "Plugin 资源不能是符号链接或目录联接。");
  if (!stats.isFile()) throw new PluginPackageError("package-tampered", "Plugin 资源不再是普通文件。");
  const realTarget = await fs.realpath(target);
  assertContained(root, realTarget, "Plugin 资源已逃逸安装目录。");
  const bytes = await fs.readFile(realTarget);
  if (bytes.byteLength !== descriptor.sizeBytes || sha256(bytes) !== descriptor.sha256) {
    throw new PluginPackageError("package-tampered", "Plugin 资源 hash 与预检记录不一致。");
  }
  return bytes;
}

function normalizePreflightInput(input: PluginPackagePreflightInput): PluginPackagePreflightInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PluginPackageError("invalid-request", "Plugin 预检请求无效。");
  }
  if (typeof input.sourcePath !== "string" || !input.sourcePath.trim() || !path.isAbsolute(input.sourcePath)) {
    throw new PluginPackageError("invalid-request", "Plugin 来源必须是通过系统选择器取得的绝对文件夹路径。");
  }
  let scope: PluginPackageScope;
  try {
    scope = parsePluginPackageScope(input.scope);
  } catch (error) {
    throw new PluginPackageError("invalid-request", error instanceof Error ? error.message : "Plugin 安装范围无效。");
  }
  return { sourcePath: input.sourcePath, scope };
}

function normalizeLimits(overrides?: Partial<PluginPackageLimits>): PluginPackageLimits {
  const limits = { ...DEFAULT_PLUGIN_PACKAGE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new PluginPackageError("invalid-request", `Plugin 安全限制 ${key} 无效。`);
    }
  }
  if (limits.maxManifestBytes > limits.maxSingleFileBytes || limits.maxTextResourceBytes > limits.maxSingleFileBytes) {
    throw new PluginPackageError("invalid-request", "Plugin 专用文件大小上限不能高于单文件大小上限。");
  }
  return limits;
}

function validateRegistryFile(value: unknown): StoredPluginPackageRecord[] {
  const registry = requireObject(value, "Plugin 注册表");
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(registry.packages)) {
    throw new PluginPackageError("storage-failure", "Plugin 注册表版本不受支持或内容损坏。");
  }
  return registry.packages.map((candidate, index) => {
    const object = requireObject(candidate, `Plugin 注册表 packages[${index}]`);
    if (typeof object.id !== "string" || typeof object.name !== "string" || typeof object.enabled !== "boolean"
      || typeof object.installedAt !== "string" || typeof object.updatedAt !== "string" || !Array.isArray(object.versions)) {
      throw new PluginPackageError("storage-failure", "Plugin 注册表记录字段损坏。");
    }
    normalizeId(object.id, "Plugin ID");
    const name = pluginName(object.name);
    let scope: PluginPackageScope;
    try {
      scope = parsePluginPackageScope(object.scope);
    } catch {
      throw new PluginPackageError("storage-failure", "Plugin 注册表范围字段损坏。");
    }
    if (object.versions.length < 1) throw new PluginPackageError("storage-failure", "Plugin 注册表记录缺少可用版本。");
    const versions = object.versions.map((item, versionIndex) => validateStoredVersion(item, name, versionIndex));
    const versionSet = new Set(versions.map((item) => item.version));
    const hashSet = new Set(versions.map((item) => item.sha256));
    if (versionSet.size !== versions.length || hashSet.size !== versions.length) {
      throw new PluginPackageError("storage-failure", "Plugin 注册表包含重复版本或 hash。");
    }
    for (let versionIndex = 1; versionIndex < versions.length; versionIndex += 1) {
      if (compareSemver(versions[versionIndex].version, versions[versionIndex - 1].version) <= 0) {
        throw new PluginPackageError("storage-failure", "Plugin 注册表版本顺序损坏。");
      }
    }
    return {
      id: object.id,
      name,
      scope,
      enabled: object.enabled,
      installedAt: object.installedAt,
      updatedAt: object.updatedAt,
      versions
    };
  });
}

function validateStoredVersion(value: unknown, plugin: string, index: number): StoredPluginVersion {
  const object = requireObject(value, `Plugin 版本记录[${index}]`);
  if (typeof object.version !== "string" || typeof object.sha256 !== "string" || typeof object.rootRef !== "string"
    || typeof object.displayName !== "string" || typeof object.description !== "string" || typeof object.installedAt !== "string"
    || !Array.isArray(object.resources)) {
    throw new PluginPackageError("storage-failure", "Plugin 版本记录字段损坏。");
  }
  const manifest = parsePluginManifest(JSON.stringify(object.manifest));
  if (manifest.name !== plugin || manifest.version !== object.version) {
    throw new PluginPackageError("storage-failure", "Plugin 版本记录与 extension.json 不一致。");
  }
  hashValue(object.sha256, "Plugin hash");
  const source = requireObject(object.source, "Plugin source");
  if (source.kind !== "folder" || typeof source.label !== "string" || !source.label) {
    throw new PluginPackageError("storage-failure", "Plugin 来源记录损坏。");
  }
  const validation = object.validation as PluginValidationResult;
  const components = object.components as PluginComponentSummary;
  const risks = object.risks as PluginRiskSummary;
  const stats = object.stats as PluginPackageStats;
  if (!validation || !["valid", "warning", "invalid"].includes(validation.status) || !Array.isArray(validation.diagnostics)
    || !components || !risks || !stats) {
    throw new PluginPackageError("storage-failure", "Plugin 校验或摘要记录损坏。");
  }
  const resources = object.resources.map((resource) => {
    const descriptor = requireObject(resource, "Plugin 资源记录") as unknown as PluginResourceDescriptor;
    if (typeof descriptor.relativePath !== "string" || typeof descriptor.sha256 !== "string"
      || typeof descriptor.sizeBytes !== "number" || typeof descriptor.depth !== "number") {
      throw new PluginPackageError("storage-failure", "Plugin 资源记录损坏。");
    }
    validatePluginPackageEntryPath(descriptor.relativePath);
    hashValue(descriptor.sha256, "Plugin 资源 hash");
    return descriptor;
  });
  return {
    version: object.version,
    displayName: object.displayName,
    description: object.description,
    source: { kind: "folder", label: source.label },
    sha256: object.sha256,
    manifest,
    validation,
    components,
    risks,
    resources,
    stats,
    installedAt: object.installedAt,
    rootRef: object.rootRef
  };
}

function activeVersion(record: StoredPluginPackageRecord): StoredPluginVersion {
  const version = record.versions[record.versions.length - 1];
  if (!version) throw new PluginPackageError("storage-failure", "Plugin 记录缺少活动版本。");
  return version;
}

function toPublicRecord(record: StoredPluginPackageRecord): PluginPackageRecord {
  const current = activeVersion(record);
  const previous = record.versions.length > 1 ? record.versions[record.versions.length - 2] : null;
  return {
    id: record.id,
    name: record.name,
    displayName: current.displayName,
    description: current.description,
    version: current.version,
    source: { ...current.source },
    scope: cloneScope(record.scope),
    sha256: current.sha256,
    enabled: record.enabled,
    manifest: cloneManifest(current.manifest),
    validation: cloneValidation(current.validation),
    components: { ...current.components },
    risks: { ...current.risks },
    resources: current.resources.map((item) => ({ ...item })),
    stats: { ...current.stats },
    installedAt: record.installedAt,
    versionInstalledAt: current.installedAt,
    updatedAt: record.updatedAt,
    rollbackAvailable: previous !== null,
    previousVersion: previous?.version ?? null
  };
}

function clonePreview(preview: PluginPackagePreview): PluginPackagePreview {
  return {
    ...preview,
    source: { ...preview.source },
    scope: cloneScope(preview.scope),
    manifest: cloneManifest(preview.manifest),
    validation: cloneValidation(preview.validation),
    components: { ...preview.components },
    risks: { ...preview.risks },
    resources: preview.resources.map((item) => ({ ...item })),
    stats: { ...preview.stats },
    limits: { ...preview.limits }
  };
}

function cloneManifest(manifest: PluginManifest): PluginManifest {
  return JSON.parse(JSON.stringify(manifest)) as PluginManifest;
}

function cloneValidation(validation: PluginValidationResult): PluginValidationResult {
  return { ...validation, diagnostics: validation.diagnostics.map((item) => ({ ...item })) };
}

function cloneScope(scope: PluginPackageScope): PluginPackageScope {
  return scope.kind === "global" ? { kind: "global" } : { kind: "project", projectId: scope.projectId };
}

function componentSummary(manifest: PluginManifest): PluginComponentSummary {
  return {
    skillReferences: manifest.skills.filter((item) => item.kind === "reference").length,
    inlineSkills: manifest.skills.filter((item) => item.kind === "inline").length,
    mcpPresets: manifest.mcpPresets.length,
    promptFragments: manifest.promptFragments.length,
    templates: manifest.templates.length
  };
}

function claimExactPath(
  claims: Map<string, "prompt-fragment" | "template">,
  relativePath: string,
  kind: "prompt-fragment" | "template"
): void {
  if (claims.has(relativePath)) throw new PluginPackageError("invalid-manifest", `同一文件被重复声明：${relativePath}。`);
  claims.set(relativePath, kind);
}

function addUniqueSkillName(names: Set<string>, name: string): void {
  if (names.has(name)) throw new PluginPackageError("duplicate-name", `Plugin 重复声明 Skill 名称：${name}。`);
  names.add(name);
}

function ensureUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new PluginPackageError("duplicate-name", `${label} 重复声明 ID：${item.id}。`);
    ids.add(item.id);
  }
}

function requireScannedFile(scan: ScannedPackage, relativePath: string, message: string): ScannedFile {
  const descriptor = scan.files.find((item) => item.relativePath === relativePath);
  if (!descriptor) throw new PluginPackageError("invalid-manifest", message);
  return descriptor;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginPackageError("invalid-manifest", `${label} 必须是 JSON object。`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    const dangerous = unknown.some((key) => /(?:activate|code|entry|exec|hook|renderer|script|ui)/i.test(key));
    throw new PluginPackageError(
      dangerous ? "unsupported-content" : "invalid-manifest",
      `${label} 包含不允许的字段：${unknown.join(", ")}。Plugin 只支持声明式内容。`
    );
  }
}

function optionalArray(value: unknown, label: string, maximum: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PluginPackageError("invalid-manifest", `${label} 必须是 JSON array。`);
  if (value.length > maximum) throw new PluginPackageError("package-limit", `${label} 条目超过 ${maximum} 个上限。`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PluginPackageError("invalid-manifest", `${label} 必须是非空字符串。`);
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new PluginPackageError("invalid-manifest", `${label} 包含非法控制字符。`);
  return value.trim();
}

function requiredDisplayText(value: unknown, maximum: number, label: string): string {
  const text = requiredString(value, label);
  if ([...text].length > maximum) throw new PluginPackageError("invalid-manifest", `${label} 不能超过 ${maximum} 个字符。`);
  return text;
}

function optionalDisplayText(value: unknown, fallback: string, maximum: number, label: string): string {
  if (value === undefined) return fallback;
  return requiredDisplayText(value, maximum, label);
}

function optionalNullableDisplayText(value: unknown, maximum: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  return requiredDisplayText(value, maximum, label);
}

function pluginName(value: unknown): string {
  const name = requiredString(value, "Plugin name");
  if (name.length > 100 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)) {
    throw new PluginPackageError("invalid-manifest", "Plugin name 只能包含小写字母、数字、点、下划线和连字符，且不能连续或位于首尾。");
  }
  return name;
}

function skillName(value: unknown): string {
  const name = requiredString(value, "Skill name");
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new PluginPackageError("invalid-manifest", "Skill 引用名称只能包含小写字母、数字和单个连字符。");
  }
  return name;
}

function componentId(value: unknown, label: string): string {
  const id = requiredString(value, label);
  if (id.length > 100 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) {
    throw new PluginPackageError("invalid-manifest", `${label} 格式无效。`);
  }
  return id;
}

function semver(value: unknown, label: string): string {
  const version = requiredString(value, label);
  if (!SEMVER.test(version)) throw new PluginPackageError("invalid-manifest", `${label} 必须使用完整 SemVer，例如 1.2.3。`);
  return version;
}

function hashValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new PluginPackageError("invalid-manifest", `${label} 必须是 64 位小写 SHA-256。`);
  }
  return value;
}

function compareSemver(left: string, right: string): number {
  const a = parseSemverParts(left);
  const b = parseSemverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber && rightNumber) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseSemverParts(version: string): { core: number[]; prerelease: string[] } {
  const match = SEMVER.exec(version);
  if (!match) throw new PluginPackageError("invalid-manifest", "Plugin version 无效。");
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split(".") ?? [] };
}

function assertNoObviousSecrets(value: unknown): void {
  const visit = (item: unknown, key: string | null): void => {
    if (typeof item === "string") {
      if (OBVIOUS_SECRET.test(item)) throw new PluginPackageError("plaintext-secret", "extension.json 疑似包含明文密钥，已拒绝导入。");
      if (key && SENSITIVE_KEY.test(key) && !SECURE_STORE_REF.test(item)) {
        throw new PluginPackageError("plaintext-secret", `extension.json 的 ${key} 不能保存明文密钥。`);
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, key);
      return;
    }
    if (item && typeof item === "object") {
      for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) visit(child, childKey);
    }
  };
  visit(value, null);
}

function packageHash(files: ScannedFile[], directoryPaths: string[]): string {
  const hash = createHash("sha256");
  for (const directoryPath of directoryPaths) hash.update(`D\u0000${directoryPath}\n`, "utf8");
  for (const file of files) hash.update(`F\u0000${file.relativePath}\u0000${file.sizeBytes}\u0000${file.sha256}\n`, "utf8");
  return hash.digest("hex");
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildValidation(diagnostics: PluginValidationDiagnostic[]): PluginValidationResult {
  const status = diagnostics.some((item) => item.level === "error")
    ? "invalid"
    : diagnostics.some((item) => item.level === "warning") ? "warning" : "valid";
  return { status, checkedAt: new Date().toISOString(), diagnostics };
}

function diagnostic(
  code: string,
  level: "warning" | "error",
  message: string,
  relativePath: string | null
): PluginValidationDiagnostic {
  return { code, level, message, relativePath };
}

function decodeUtf8(bytes: Uint8Array, message: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new PluginPackageError("invalid-manifest", message);
  }
}

async function ensureControlledDirectory(directoryPath: string): Promise<void> {
  try {
    const stats = await fs.lstat(directoryPath);
    if (stats.isSymbolicLink()) throw new PluginPackageError("unsafe-link", "Plugin 受控存储目录不能是符号链接或目录联接。");
    if (!stats.isDirectory()) throw new PluginPackageError("storage-failure", "Plugin 受控存储路径不是文件夹。");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  }
}

async function safeLstat(target: string, message: string) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error instanceof PluginPackageError) throw error;
    throw new PluginPackageError("invalid-request", message);
  }
}

function assertContained(root: string, candidate: string, message: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) return;
  throw new PluginPackageError("unsafe-path", message);
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
    throw new PluginPackageError("invalid-request", `${label}格式无效。`);
  }
  return value.trim();
}

function normalizeServiceError(error: unknown, fallback: string): PluginPackageError {
  if (error instanceof PluginPackageError) return error;
  return new PluginPackageError("storage-failure", fallback);
}

function safeChineseMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.floor(value / (1024 * 1024))} MB`;
  if (value >= 1024) return `${Math.floor(value / 1024)} KB`;
  return `${value} 字节`;
}

function compareRecords(a: PluginPackageRecord, b: PluginPackageRecord): number {
  return a.name.localeCompare(b.name) || pluginPackageScopeKey(a.scope).localeCompare(pluginPackageScopeKey(b.scope));
}
