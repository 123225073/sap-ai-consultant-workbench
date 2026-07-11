import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceBackupResult, WorkspaceImportResult } from "../shared/workbenchTypes";

const IMPORTABLE_ENTRIES = ["app-state.json", "app-state.backup.json", "projects", "secure-store"];
const MAX_IMPORT_FILES = 50_000;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024 * 1024;
const SUPPORTED_SCHEMA_VERSION = 2;

interface ManifestFile {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}

async function resolveWorkspaceSource(selection: string): Promise<string> {
  const candidates = [path.resolve(selection), path.resolve(selection, "local-data", "workbench")];
  for (const candidate of candidates) {
    try {
      const state = await fs.lstat(path.join(candidate, "app-state.json"));
      if (state.isFile() && !state.isSymbolicLink()) return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("所选目录中没有找到可导入的 app-state.json。请选择旧工作台目录或包含 local-data/workbench 的项目目录。");
}

async function assertSupportedState(workspaceRoot: string): Promise<void> {
  const raw = await fs.readFile(path.join(workspaceRoot, "app-state.json"), "utf8");
  const parsed = JSON.parse(raw) as { schemaVersion?: unknown; projects?: unknown };
  const version = parsed.schemaVersion === undefined ? 1 : Number(parsed.schemaVersion);
  if (!Number.isInteger(version) || version < 1) throw new Error("旧工作台的状态版本无效，已停止导入。");
  if (version > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`旧工作台数据版本 ${version} 高于当前应用支持的版本 ${SUPPORTED_SCHEMA_VERSION}，请先升级应用。`);
  }
  if (!Array.isArray(parsed.projects)) throw new Error("旧工作台状态缺少项目列表，已停止导入。");
}

async function collectManifestFiles(root: string): Promise<ManifestFile[]> {
  const files: ManifestFile[] = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const stats = await fs.lstat(fullPath);
      if (stats.isSymbolicLink()) throw new Error("工作台数据包含符号链接，已停止备份或导入。");
      if (stats.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!stats.isFile()) throw new Error("工作台数据包含不支持的文件类型，已停止备份或导入。");
      totalBytes += stats.size;
      if (files.length >= MAX_IMPORT_FILES || totalBytes > MAX_IMPORT_BYTES) {
        throw new Error("工作台数据超出受控导入上限，请先清理无关大文件后重试。");
      }
      const buffer = await fs.readFile(fullPath);
      files.push({
        relativePath: path.relative(root, fullPath).replaceAll("\\", "/"),
        sizeBytes: stats.size,
        sha256: createHash("sha256").update(buffer).digest("hex")
      });
    }
  };
  await visit(root);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
}

async function copyKnownWorkspaceEntries(sourceRoot: string, targetRoot: string): Promise<void> {
  await fs.mkdir(targetRoot, { recursive: true });
  for (const entry of IMPORTABLE_ENTRIES) {
    const source = path.join(sourceRoot, entry);
    const target = path.join(targetRoot, entry);
    try {
      const stats = await fs.lstat(source);
      if (stats.isSymbolicLink()) throw new Error("工作台数据包含符号链接，已停止导入。");
      await fs.cp(source, target, { recursive: stats.isDirectory(), errorOnExist: true });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
      if (code !== "ENOENT") throw error;
    }
  }
}

async function writeManifest(root: string, kind: "backup" | "import-staging", sourceRoot: string, files: ManifestFile[]): Promise<void> {
  await fs.writeFile(path.join(root, "workspace-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    kind,
    createdAt: new Date().toISOString(),
    sourceRoot,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    encryptedSecretsOnly: true,
    files
  }, null, 2)}\n`, "utf8");
}

export async function createWorkspaceBackup(workspaceRoot: string): Promise<WorkspaceBackupResult> {
  await assertSupportedState(workspaceRoot);
  const backupRoot = path.join(path.dirname(workspaceRoot), "workbench-backups", `manual-${stamp()}`);
  await copyKnownWorkspaceEntries(workspaceRoot, backupRoot);
  const files = await collectManifestFiles(backupRoot);
  await writeManifest(backupRoot, "backup", workspaceRoot, files);
  return {
    status: "created",
    backupPath: backupRoot,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0)
  };
}

export async function importWorkspace(selection: string, workspaceRoot: string): Promise<WorkspaceImportResult> {
  const sourceRoot = await resolveWorkspaceSource(selection);
  if (path.resolve(sourceRoot).toLowerCase() === path.resolve(workspaceRoot).toLowerCase()) {
    throw new Error("所选目录就是当前工作台，无需重复导入。");
  }
  await assertSupportedState(sourceRoot);
  const parent = path.dirname(workspaceRoot);
  const operationStamp = stamp();
  const stagingRoot = path.join(parent, `workbench-import-staging-${operationStamp}`);
  const backupRoot = path.join(parent, "workbench-backups", `pre-import-${operationStamp}`);
  await copyKnownWorkspaceEntries(sourceRoot, stagingRoot);
  const files = await collectManifestFiles(stagingRoot);
  await writeManifest(stagingRoot, "import-staging", sourceRoot, files);

  await fs.mkdir(path.dirname(backupRoot), { recursive: true });
  await fs.rename(workspaceRoot, backupRoot);
  try {
    await fs.rename(stagingRoot, workspaceRoot);
  } catch (error) {
    await fs.rename(backupRoot, workspaceRoot).catch(() => undefined);
    throw error;
  }
  return {
    status: "imported",
    sourcePath: sourceRoot,
    backupPath: backupRoot,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    restartRequired: true
  };
}
