export type CaseStatus = "active" | "solved" | "archived";
export type ConfigStatus = "not-configured" | "saved" | "pending-verification" | "verified" | "failed";
export type SecretKind = "adt-password" | "api-key" | "feishu-token" | "codex-token";
export type SecretState = "not-set" | "set-in-secure-store" | "missing" | "failed" | "needs-rotation";
export type SecretStoreKind = "electron-safe-storage";
export type AdtVerificationStepId = "config" | "status" | "t000";
export type AdtVerificationStepStatus = "passed" | "failed" | "skipped";
export type AdtVerificationErrorCode =
  | "missing-config"
  | "invalid-url"
  | "missing-credential"
  | "secret-unavailable"
  | "readonly-disabled"
  | "status-failed"
  | "minimal-read-failed"
  | "unexpected-error";

export interface SecretHandle {
  secretRef: string | null;
  kind: SecretKind;
  store: SecretStoreKind | null;
  state: SecretState;
  updatedAt: string | null;
}

export interface ProjectSecretTarget {
  kind: SecretKind;
  providerId?: string;
}

export interface ProjectSecretInput {
  target: ProjectSecretTarget;
  value: string;
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

export interface AdtRedactedSystemInfo {
  alias: string;
  endpointHost: string;
  client: string;
  usernameMasked: string;
  language: string;
  sslMode: AdtConfig["sslMode"];
  readOnly: true;
  transportWriteMode: "disabled";
}

export interface AdtT000ProbeResult {
  objectName: "T000";
  attempted: boolean;
  ok: boolean;
  rowCount: number | null;
  sampleClient: string | null;
  source: "fake";
}

export interface AdtVerificationError {
  code: AdtVerificationErrorCode;
  message: string;
  suggestion: string;
}

export interface AdtVerificationStep {
  id: AdtVerificationStepId;
  title: string;
  status: AdtVerificationStepStatus;
  detail: string;
  checkedAt: string;
}

export interface AdtVerificationReport {
  ok: boolean;
  checkedAt: string;
  mode: "fake";
  system: AdtRedactedSystemInfo;
  steps: AdtVerificationStep[];
  connectionStatus: ConfigStatus;
  minimalReadStatus: ConfigStatus;
  t000: AdtT000ProbeResult;
  errors: AdtVerificationError[];
}

export interface AdtVerificationResult {
  report: AdtVerificationReport;
  state: WorkbenchState;
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
