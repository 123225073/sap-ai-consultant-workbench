export type CaseStatus = "active" | "solved" | "archived";
export type ConfigStatus = "not-configured" | "saved" | "pending-verification" | "failed";

export interface SecretHandle {
  secretRef: string | null;
  state: "not-set" | "secure-store-required";
}

export interface AdtConfig {
  alias: string;
  url: string;
  client: string;
  username: string;
  language: string;
  sslMode: "strict" | "skip-certificate";
  readOnly: true;
  credential: SecretHandle;
  configStatus: ConfigStatus;
  connectionStatus: ConfigStatus;
  minimalReadStatus: ConfigStatus;
  lastCheckedAt: string | null;
}

export interface FeishuConfig {
  profile: string;
  cliPath: string;
  credential: SecretHandle;
  authStatus: ConfigStatus;
  docPermissionStatus: ConfigStatus;
  lastCheckedAt: string | null;
}

export interface ApiProviderConfig {
  id: string;
  name: string;
  providerType: "openai-compatible" | "deepseek" | "custom";
  baseUrl: string;
  enabled: boolean;
  credential: SecretHandle;
  modelSyncStatus: ConfigStatus;
  chatTestStatus: ConfigStatus;
  lastCheckedAt: string | null;
}

export interface CodexConfig {
  integrationType: "cli" | "sdk";
  executablePath: string;
  credential: SecretHandle;
  cliStatus: ConfigStatus;
  version: string;
  loginStatus: ConfigStatus;
  readonlyTaskStatus: ConfigStatus;
  lastCheckedAt: string | null;
}

export interface LocalStorageConfig {
  storageMode: "json";
  workspaceRoot: string;
  stateJsonPath: string;
  projectDir: string;
  casesDir: string;
  databasePath: string | null;
  indexesDir: string;
  logsDir: string;
  tempDir: string;
  status: ConfigStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface ProjectConfig {
  schemaVersion: 2;
  projectId: string;
  updatedAt: string;
  adt: AdtConfig;
  feishu: FeishuConfig;
  apiProviders: ApiProviderConfig[];
  codex: CodexConfig;
  localStorage: LocalStorageConfig;
}

export interface CaseMessage {
  id: string;
  caseId: string;
  role: "user" | "assistant";
  content: string;
  taskMode: "problem-analysis" | "abap-development" | "document-generation" | "flow-diagram";
  modelId: string;
  linkedFileIds: string[];
  createdAt: string;
}

export interface CaseSummary {
  id: string;
  projectId: string;
  title: string;
  status: CaseStatus;
  caseDir: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  folderName: string;
  currentSummary: string;
  messages: CaseMessage[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  sapVersion: "S4" | "ECC" | "UNKNOWN";
  systemLabel: string;
  projectDir: string;
  isVisible: boolean;
  visibleOrder: number;
  connectionState: "local-demo" | "not-configured" | "not-checked";
  createdAt: string;
  updatedAt: string;
  config: ProjectConfig;
  cases: CaseSummary[];
}

export interface CaseFileNode {
  id: string;
  caseId: string;
  name: string;
  relativePath: string;
  displayName: string;
  kind: "file" | "directory";
  fileType: string;
  purpose: "summary" | "conversation" | "output" | "candidate_knowledge" | "technical" | "evidence" | "snapshot" | "metadata" | "other";
  size: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  indexedAt: string;
  children?: CaseFileNode[];
}

export interface SearchResult {
  id: string;
  title: string;
  type: "project" | "case" | "file";
  location: string;
  snippet: string;
}

export interface WorkbenchState {
  schemaVersion: number;
  workspaceRoot: string;
  activeProjectId: string;
  activeCaseId: string;
  projects: ProjectSummary[];
  activeCaseFiles: CaseFileNode[];
}

export interface WorkbenchResult<T> {
  ok: true;
  data: T;
}

export interface WorkbenchError {
  ok: false;
  error: string;
}

export type WorkbenchResponse<T> = WorkbenchResult<T> | WorkbenchError;
