export type PluginPackageScope =
  | { kind: "global" }
  | { kind: "project"; projectId: string };

export interface PluginPackageSource {
  kind: "folder";
  label: string;
}

export interface PluginSkillReference {
  kind: "reference";
  name: string;
  version: string | null;
  sha256: string | null;
}

export interface PluginInlineSkill {
  kind: "inline";
  path: string;
}

export type PluginSkillDeclaration = PluginSkillReference | PluginInlineSkill;

export interface PluginMcpStdioPreset {
  type: "stdio";
  command: string;
  args: string[];
  environmentRefs: Record<string, string>;
}

export interface PluginMcpHttpPreset {
  type: "streamable-http";
  endpoint: string;
  headerRefs: Record<string, string>;
}

export type PluginMcpTransportPreset = PluginMcpStdioPreset | PluginMcpHttpPreset;

export interface PluginMcpPreset {
  id: string;
  name: string;
  description: string;
  transport: PluginMcpTransportPreset;
}

export interface PluginPromptFragment {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface PluginTemplateDeclaration {
  id: string;
  name: string;
  description: string;
  path: string;
  mediaType: string;
}

export interface PluginManifest {
  schemaVersion: 1;
  name: string;
  displayName: string;
  version: string;
  description: string;
  publisher: string | null;
  metadata: Record<string, string>;
  skills: PluginSkillDeclaration[];
  mcpPresets: PluginMcpPreset[];
  promptFragments: PluginPromptFragment[];
  templates: PluginTemplateDeclaration[];
}

export type PluginResourceKind =
  | "manifest"
  | "skill-instructions"
  | "skill-resource"
  | "skill-script"
  | "prompt-fragment"
  | "template";

export interface PluginResourceDescriptor {
  relativePath: string;
  kind: PluginResourceKind;
  sizeBytes: number;
  sha256: string;
  depth: number;
  executionPolicy: "declarative-only" | "listed-not-executable";
}

export interface PluginPackageStats {
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  maxDepth: number;
}

export interface PluginPackageLimits {
  maxFiles: number;
  maxDirectories: number;
  maxSingleFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  maxManifestBytes: number;
  maxTextResourceBytes: number;
}

export interface PluginValidationDiagnostic {
  code: string;
  level: "warning" | "error";
  message: string;
  relativePath: string | null;
}

export interface PluginValidationResult {
  status: "valid" | "warning" | "invalid";
  checkedAt: string;
  diagnostics: PluginValidationDiagnostic[];
}

export interface PluginComponentSummary {
  skillReferences: number;
  inlineSkills: number;
  mcpPresets: number;
  promptFragments: number;
  templates: number;
}

export interface PluginRiskSummary {
  scriptsPresent: boolean;
  scriptsExecution: "disabled";
  rendererCode: "forbidden";
  automaticExecution: "forbidden";
  plaintextSecrets: "forbidden";
  pluginExecution: "none";
}

export interface PluginPackagePreview {
  importId: string;
  operation: "install" | "upgrade";
  previousVersion: string | null;
  name: string;
  displayName: string;
  description: string;
  version: string;
  source: PluginPackageSource;
  scope: PluginPackageScope;
  sha256: string;
  enabled: false;
  manifest: PluginManifest;
  validation: PluginValidationResult;
  components: PluginComponentSummary;
  risks: PluginRiskSummary;
  resources: PluginResourceDescriptor[];
  stats: PluginPackageStats;
  limits: PluginPackageLimits;
}

export interface PluginPackageRecord {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  source: PluginPackageSource;
  scope: PluginPackageScope;
  sha256: string;
  enabled: boolean;
  manifest: PluginManifest;
  validation: PluginValidationResult;
  components: PluginComponentSummary;
  risks: PluginRiskSummary;
  resources: PluginResourceDescriptor[];
  stats: PluginPackageStats;
  installedAt: string;
  versionInstalledAt: string;
  updatedAt: string;
  rollbackAvailable: boolean;
  previousVersion: string | null;
}

export interface PluginPackagePreflightInput {
  sourcePath: string;
  scope: PluginPackageScope;
}

export function parsePluginPackageScope(input: unknown): PluginPackageScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Plugin 安装范围无效。");
  }
  const value = input as { kind?: unknown; projectId?: unknown };
  if (value.kind === "global") return { kind: "global" };
  if (value.kind !== "project") throw new Error("Plugin 安装范围必须是全局或 Project。");
  if (typeof value.projectId !== "string") throw new Error("Project ID 无效。");
  const projectId = value.projectId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(projectId)) {
    throw new Error("Project ID 格式无效。");
  }
  return { kind: "project", projectId };
}

export function pluginPackageScopeKey(scope: PluginPackageScope): string {
  return scope.kind === "global" ? "global" : `project:${scope.projectId}`;
}
