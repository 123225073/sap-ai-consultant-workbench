export type SkillPackageScope =
  | { kind: "global" }
  | { kind: "project"; projectId: string };

export type SkillPackageSourceKind = "folder" | "zip" | "builtin";
export type SkillPackageImportSourceKind = Exclude<SkillPackageSourceKind, "builtin">;
export type SkillValidationStatus = "valid" | "warning" | "invalid" | "unsupported";
export type SkillValidationLevel = "warning" | "error";
export type SkillResourceKind = "instructions" | "reference" | "asset" | "script" | "other";
export type SkillScriptStatus = "absent" | "present-listed-not-executable";

export interface SkillPackageLimits {
  maxFiles: number;
  maxDirectories: number;
  maxSingleFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  maxSkillMarkdownBytes: number;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, string>;
  allowedTools: string | null;
  additional: Record<string, string>;
}

export interface ParsedSkillMarkdown {
  frontmatter: SkillFrontmatter;
  body: string;
  lineCount: number;
}

export interface SkillValidationDiagnostic {
  code: string;
  level: SkillValidationLevel;
  message: string;
  relativePath: string | null;
}

export interface SkillValidationResult {
  status: SkillValidationStatus;
  checkedAt: string;
  diagnostics: SkillValidationDiagnostic[];
}

export interface SkillResourceDescriptor {
  relativePath: string;
  kind: SkillResourceKind;
  sizeBytes: number;
  sha256: string;
  depth: number;
  executable: boolean;
  executionPolicy: "not-applicable" | "listed-not-executable";
}

export interface SkillPackageSource {
  kind: SkillPackageSourceKind;
  label: string;
}

export interface SkillPackageStats {
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  maxDepth: number;
}

export interface SkillPackagePreview {
  importId: string;
  name: string;
  description: string;
  instructionSummary: string;
  frontmatter: SkillFrontmatter;
  source: SkillPackageSource;
  scope: SkillPackageScope;
  sha256: string;
  enabled: false;
  validation: SkillValidationResult;
  scriptStatus: SkillScriptStatus;
  resources: SkillResourceDescriptor[];
  stats: SkillPackageStats;
  limits: SkillPackageLimits;
}

export interface SkillPackageRecord {
  id: string;
  name: string;
  description: string;
  frontmatter: SkillFrontmatter;
  source: SkillPackageSource;
  scope: SkillPackageScope;
  sha256: string;
  enabled: boolean;
  validation: SkillValidationResult;
  scriptStatus: SkillScriptStatus;
  resources: SkillResourceDescriptor[];
  stats: SkillPackageStats;
  installedAt: string;
  updatedAt: string;
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  scope: SkillPackageScope;
  sha256: string;
  validationStatus: "valid" | "warning";
}

export interface ActivatedSkill {
  id: string;
  name: string;
  description: string;
  scope: SkillPackageScope;
  sha256: string;
  frontmatter: SkillFrontmatter;
  instructions: string;
  resources: SkillResourceDescriptor[];
  allowedToolsPolicy: "advisory-only";
  scriptsExecution: "disabled";
}

export interface SkillTextResource {
  skillId: string;
  relativePath: string;
  kind: "reference" | "asset" | "other";
  sha256: string;
  content: string;
}

export interface SkillPackagePreflightInput {
  sourceKind: SkillPackageImportSourceKind;
  sourcePath: string;
  scope: SkillPackageScope;
}

export function parseSkillPackageScope(input: unknown): SkillPackageScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Skill 安装范围无效。");
  const value = input as { kind?: unknown; projectId?: unknown };
  if (value.kind === "global") return { kind: "global" };
  if (value.kind !== "project") throw new Error("Skill 安装范围必须是全局或 Project。");
  if (typeof value.projectId !== "string") throw new Error("Project ID 无效。");
  const projectId = value.projectId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(projectId)) throw new Error("Project ID 格式无效。");
  return { kind: "project", projectId };
}

export function skillPackageScopeKey(scope: SkillPackageScope): string {
  return scope.kind === "global" ? "global" : `project:${scope.projectId}`;
}
