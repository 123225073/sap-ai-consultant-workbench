import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CapabilitySkillDiscoveryItem,
  CapabilitySkillDiscoveryReport,
  CapabilitySkillDiscoveryRoot,
  CapabilitySkillDiscoverySource
} from "../shared/capabilityCenterTypes";
import { parseSkillPackageScope, skillPackageScopeKey, type SkillPackageScope } from "../shared/skillTypes";
import { parseSkillMarkdown, SkillPackageService } from "./skillPackageService";

interface DiscoveryRootDefinition {
  source: CapabilitySkillDiscoverySource;
  label: string;
  directory: string;
}

interface DiscoverySessionItem {
  absolutePath: string;
  canonicalRoot: string;
  name: string;
  valid: boolean;
}

interface DiscoverySession {
  createdAt: number;
  scopeKey: string;
  items: Map<string, DiscoverySessionItem>;
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SCANNED_DIRECTORIES_PER_ROOT = 800;
const MAX_SKILLS = 500;
const MAX_DEPTH = 4;
const MAX_SKILL_MARKDOWN_BYTES = 512 * 1024;
const SKIPPED_DIRECTORY_NAMES = new Set([".git", ".cache", ".venv", "__pycache__", "dist", "node_modules", "target", "venv"]);

export class SkillDiscoveryService {
  private readonly roots: DiscoveryRootDefinition[];
  private readonly sessions = new Map<string, DiscoverySession>();

  constructor(
    private readonly skills: SkillPackageService,
    options: { homeDirectory?: string; roots?: DiscoveryRootDefinition[] } = {}
  ) {
    const home = options.homeDirectory ?? os.homedir();
    this.roots = options.roots ?? [
      { source: "agents", label: "Codex 通用目录", directory: path.join(home, ".agents", "skills") },
      { source: "codex", label: "Codex 兼容目录", directory: path.join(home, ".codex", "skills") },
      { source: "claude", label: "Claude Code 目录", directory: path.join(home, ".claude", "skills") },
      { source: "skills-manager", label: "Skills Manager 目录", directory: path.join(home, ".skills-manager") },
      { source: "workbench-inbox", label: "工作台 Skills 收件箱", directory: path.join(home, ".sap-ai-workbench", "skills") }
    ];
  }

  async discover(scopeInput: SkillPackageScope): Promise<CapabilitySkillDiscoveryReport> {
    const scope = parseSkillPackageScope(scopeInput);
    this.pruneSessions();
    const installed = await this.skills.listInstalled();
    const installedNames = new Set(installed
      .filter((item) => skillPackageScopeKey(item.scope) === skillPackageScopeKey(scope))
      .map((item) => item.name.toLocaleLowerCase()));
    const sessionId = randomUUID();
    const sessionItems = new Map<string, DiscoverySessionItem>();
    const reportItems: CapabilitySkillDiscoveryItem[] = [];
    const rootReports: CapabilitySkillDiscoveryRoot[] = [];
    const seenPaths = new Set<string>();
    let skippedSymlinkCount = 0;

    for (const root of this.roots) {
      if (root.source === "workbench-inbox") await fs.mkdir(root.directory, { recursive: true });
      const rootStats = await fs.lstat(root.directory).catch(() => null);
      if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
        rootReports.push({ source: root.source, label: root.label, available: false, skillCount: 0 });
        continue;
      }
      const canonicalRoot = await fs.realpath(root.directory);
      const beforeCount = reportItems.length;
      const queue: Array<{ directory: string; depth: number }> = [{ directory: canonicalRoot, depth: 0 }];
      let scannedDirectories = 0;
      while (queue.length && scannedDirectories < MAX_SCANNED_DIRECTORIES_PER_ROOT && reportItems.length < MAX_SKILLS) {
        const current = queue.shift()!;
        scannedDirectories += 1;
        const entries = await fs.readdir(current.directory, { withFileTypes: true }).catch(() => []);
        const skillEntry = entries.find((entry) => entry.name.toLocaleLowerCase() === "skill.md");
        if (skillEntry?.isSymbolicLink()) {
          skippedSymlinkCount += 1;
        } else if (skillEntry?.isFile()) {
          const canonicalDirectory = await fs.realpath(current.directory);
          if (isInside(canonicalRoot, canonicalDirectory) && !seenPaths.has(canonicalDirectory)) {
            seenPaths.add(canonicalDirectory);
            const discovered = await this.readCandidate(root, canonicalRoot, canonicalDirectory, entries);
            const id = randomUUID();
            reportItems.push({ ...discovered.item, id, alreadyInstalled: installedNames.has(discovered.item.name.toLocaleLowerCase()) });
            sessionItems.set(id, { absolutePath: canonicalDirectory, canonicalRoot, name: discovered.item.name, valid: discovered.item.validationStatus === "valid" });
          }
          continue;
        }
        if (current.depth >= MAX_DEPTH) continue;
        for (const entry of entries) {
          if (entry.isSymbolicLink()) {
            skippedSymlinkCount += 1;
            continue;
          }
          if (!entry.isDirectory() || SKIPPED_DIRECTORY_NAMES.has(entry.name.toLocaleLowerCase())) continue;
          queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
        }
      }
      rootReports.push({ source: root.source, label: root.label, available: true, skillCount: reportItems.length - beforeCount });
    }

    this.sessions.set(sessionId, { createdAt: Date.now(), scopeKey: skillPackageScopeKey(scope), items: sessionItems });
    return { sessionId, scannedAt: new Date().toISOString(), roots: rootReports, items: reportItems, skippedSymlinkCount };
  }

  async resolveSelection(sessionId: unknown, skillIds: unknown, scopeInput: SkillPackageScope): Promise<string[]> {
    const scope = parseSkillPackageScope(scopeInput);
    if (typeof sessionId !== "string" || !Array.isArray(skillIds) || skillIds.length === 0 || skillIds.length > 100) {
      throw new Error("请选择至少一个、最多 100 个待导入 Skill。");
    }
    this.pruneSessions();
    const session = this.sessions.get(sessionId);
    if (!session || session.scopeKey !== skillPackageScopeKey(scope)) throw new Error("Skills 搜索结果已过期，请重新扫描。");
    const uniqueIds = [...new Set(skillIds)];
    const selected = uniqueIds.map((id) => typeof id === "string" ? session.items.get(id) : undefined);
    if (selected.some((item) => !item?.valid)) throw new Error("选择中包含无效或已失效的 Skill，请重新扫描。");
    const names = selected.map((item) => item!.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) throw new Error("所选 Skills 中存在同名项目，请每个名称只选择一个来源。");
    const paths: string[] = [];
    for (const item of selected as DiscoverySessionItem[]) {
      const stats = await fs.lstat(item.absolutePath).catch(() => null);
      if (!stats?.isDirectory() || stats.isSymbolicLink()) throw new Error(`Skill “${item.name}” 的来源已经变化，请重新扫描。`);
      const canonicalDirectory = await fs.realpath(item.absolutePath);
      if (!isInside(item.canonicalRoot, canonicalDirectory)) throw new Error(`Skill “${item.name}” 已越出允许的扫描目录。`);
      paths.push(canonicalDirectory);
    }
    return paths;
  }

  private async readCandidate(root: DiscoveryRootDefinition, canonicalRoot: string, directory: string, entries: import("node:fs").Dirent[]) {
    const relativePath = path.relative(canonicalRoot, directory).split(path.sep).join("/") || path.basename(directory);
    const fallbackName = path.basename(directory);
    try {
      const markdownPath = path.join(directory, "SKILL.md");
      const stats = await fs.stat(markdownPath);
      if (stats.size > MAX_SKILL_MARKDOWN_BYTES) throw new Error("SKILL.md 超过 512 KB 限制");
      const parsed = parseSkillMarkdown(await fs.readFile(markdownPath, "utf8"));
      return { item: {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        source: root.source,
        sourceLabel: root.label,
        relativePath,
        hasScripts: entries.some((entry) => entry.isDirectory() && entry.name.toLocaleLowerCase() === "scripts"),
        validationStatus: "valid" as const,
        validationMessage: null
      } };
    } catch (error) {
      return { item: {
        name: fallbackName,
        description: "该目录包含 SKILL.md，但格式校验未通过。",
        source: root.source,
        sourceLabel: root.label,
        relativePath,
        hasScripts: entries.some((entry) => entry.isDirectory() && entry.name.toLocaleLowerCase() === "scripts"),
        validationStatus: "invalid" as const,
        validationMessage: safeCandidateError(error)
      } };
    }
  }

  private pruneSessions(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, session] of this.sessions) if (session.createdAt < cutoff) this.sessions.delete(id);
    while (this.sessions.size > 4) this.sessions.delete(this.sessions.keys().next().value!);
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeCandidateError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) return "SKILL.md 无法读取或扫描期间已发生变化。";
  if (!(error instanceof Error)) return "SKILL.md 无法读取。";
  return error.message.replace(/[\r\n]+/g, " ").slice(0, 300);
}
