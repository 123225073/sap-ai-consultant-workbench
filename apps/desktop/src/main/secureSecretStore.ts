import { safeStorage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { emptySecretHandle, isManagedSecretRef } from "../shared/secretHandle";
import type { ProjectSecretTarget, SecretHandle, SecretKind } from "../shared/workbenchTypes";
import { cleanSecretTargetSegment, secretTargetIdCandidates, secretTargetIdFor } from "./secretTargetIdentity";

interface SafeStorageProvider {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

interface StoredSecretBlob {
  schemaVersion: 1;
  ref: string;
  projectId: string;
  kind: SecretKind;
  targetId: string;
  encryptedValue: string;
  updatedAt: string;
}

const REF_PREFIX = "secure-store:";
const REF_PATTERN = /^secure-store:sec_[a-f0-9]{32}$/;
const MAX_SECRET_LENGTH = 8192;

function nowIso(): string {
  return new Date().toISOString();
}

function refToFileName(ref: string): string {
  if (!REF_PATTERN.test(ref)) {
    throw new Error("安全引用格式不正确，已阻止读取。");
  }
  return `${ref.slice(REF_PREFIX.length)}.json`;
}

export class SecureSecretStore {
  private readonly secureRoot: string;
  private readonly provider: SafeStorageProvider;

  constructor(repoRoot: string, provider: SafeStorageProvider = safeStorage) {
    this.secureRoot = path.join(repoRoot, "local-data", "workbench", "secure-store");
    this.provider = provider;
  }

  async save(projectId: string, target: ProjectSecretTarget, value: string, existingRef: string | null): Promise<SecretHandle> {
    this.assertProviderReady();
    const normalizedProjectId = cleanSecretTargetSegment(projectId, "project");
    const targetId = secretTargetIdFor(target);
    let existingTargetRef: string | null = null;
    for (const candidateTargetId of secretTargetIdCandidates(target)) {
      existingTargetRef = await this.findLatestRef(normalizedProjectId, target.kind, candidateTargetId);
      if (existingTargetRef) break;
    }
    const ref = isManagedSecretRef(existingRef) ? existingRef : existingTargetRef ?? this.createRef();
    const updatedAt = nowIso();
    const encryptedValue = this.encrypt(value);
    const blob: StoredSecretBlob = {
      schemaVersion: 1,
      ref,
      projectId: normalizedProjectId,
      kind: target.kind,
      targetId,
      encryptedValue,
      updatedAt
    };

    await fs.mkdir(this.secureRoot, { recursive: true });
    await this.writeJsonAtomic(path.join(this.secureRoot, refToFileName(ref)), blob);

    return {
      secretRef: ref,
      kind: target.kind,
      store: "electron-safe-storage",
      state: "set-in-secure-store",
      updatedAt
    };
  }

  async resolveValue(ref: string): Promise<string> {
    this.assertProviderReady();
    const blobPath = this.assertInsideSecureRoot(path.join(this.secureRoot, refToFileName(ref)));
    const raw = await fs.readFile(blobPath, "utf8");
    const blob = JSON.parse(raw) as StoredSecretBlob;
    if (blob.ref !== ref || !isManagedSecretRef(blob.ref)) {
      throw new Error("安全引用与本地记录不匹配。");
    }
    return this.provider.decryptString(Buffer.from(blob.encryptedValue, "base64"));
  }

  async resolveProjectSecret(projectId: string, target: ProjectSecretTarget): Promise<string> {
    this.assertProviderReady();
    const normalizedProjectId = cleanSecretTargetSegment(projectId, "project");
    let ref: string | null = null;
    for (const targetId of secretTargetIdCandidates(target)) {
      ref = await this.findLatestRef(normalizedProjectId, target.kind, targetId);
      if (ref) break;
    }
    if (!ref) {
      throw new Error("安全存储里没有找到当前目标的密钥。");
    }
    return this.resolveValue(ref);
  }

  async removeProjectTarget(projectId: string, target: ProjectSecretTarget): Promise<number> {
    const normalizedProjectId = cleanSecretTargetSegment(projectId, "project");
    const targetIds = new Set(secretTargetIdCandidates(target));
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.secureRoot);
    } catch {
      return 0;
    }

    let removed = 0;
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const blobPath = this.assertInsideSecureRoot(path.join(this.secureRoot, entry));
      let blob: StoredSecretBlob;
      try {
        blob = JSON.parse(await fs.readFile(blobPath, "utf8")) as StoredSecretBlob;
      } catch {
        continue;
      }
      if (blob.projectId === normalizedProjectId && blob.kind === target.kind && targetIds.has(blob.targetId) && isManagedSecretRef(blob.ref)) {
        try {
          await fs.unlink(blobPath);
          removed += 1;
        } catch (caught) {
          const code = caught && typeof caught === "object" && "code" in caught ? String((caught as { code?: unknown }).code ?? "") : "";
          if (code !== "ENOENT") throw new Error("清理已移除连接的加密密钥失败，请重试保存或检查本地文件权限。");
        }
      }
    }
    return removed;
  }

  private assertProviderReady(): void {
    if (!this.provider || !this.provider.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，请检查当前桌面环境的安全存储能力。");
    }
  }

  private encrypt(value: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("请输入需要保存到系统安全存储的密钥。");
    }
    if (value.length > MAX_SECRET_LENGTH) {
      throw new Error("密钥内容过长，已阻止保存。");
    }
    return this.provider.encryptString(value).toString("base64");
  }

  private createRef(): string {
    return `${REF_PREFIX}sec_${crypto.randomBytes(16).toString("hex")}`;
  }

  private async findLatestRef(projectId: string, kind: SecretKind, targetId: string): Promise<string | null> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.secureRoot);
    } catch {
      return null;
    }

    const matches: StoredSecretBlob[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const blobPath = this.assertInsideSecureRoot(path.join(this.secureRoot, entry));
        const raw = await fs.readFile(blobPath, "utf8");
        const blob = JSON.parse(raw) as StoredSecretBlob;
        if (blob.projectId === projectId && blob.kind === kind && blob.targetId === targetId && isManagedSecretRef(blob.ref)) {
          matches.push(blob);
        }
      } catch {
        continue;
      }
    }

    matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return matches[0]?.ref ?? null;
  }

  private assertInsideSecureRoot(target: string): string {
    const resolvedRoot = path.resolve(this.secureRoot);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("安全存储路径超出本地工作区，已阻止。");
    }
    return resolvedTarget;
  }

  private async writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
    const safePath = this.assertInsideSecureRoot(targetPath);
    const tempPath = `${safePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, safePath);
  }
}
