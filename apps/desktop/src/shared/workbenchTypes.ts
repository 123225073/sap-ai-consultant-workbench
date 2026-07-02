export type CaseStatus = "active" | "solved" | "archived";
export type ConfigStatus = "not-configured" | "saved" | "pending-verification" | "verified" | "failed";
export type SecretKind = "adt-password" | "api-key" | "feishu-token" | "codex-token";
export type SecretState = "not-set" | "set-in-secure-store" | "missing" | "failed" | "needs-rotation";
export type SecretStoreKind = "electron-safe-storage";
export type TaskMode = "problem-analysis" | "abap-development" | "document-generation" | "flow-diagram";
export type CaseGeneratedFilePurpose = "output" | "candidate_knowledge" | "technical" | "evidence" | "snapshot";
export type StandardsTemplateId = "s4-default" | "ecc-default";
export type StandardsCategoryId = "abap" | "comments" | "request" | "alv" | "interface" | "document" | "diagram" | "excel";
export type StandardsDiffStatus = "same" | "modified" | "project-only" | "template-only" | "not-applicable";
export type StandardsSourceType = "sap-version-template" | "copied-project";
export type KnowledgeItemType = "qa" | "doc" | "sap_object" | "case_note" | "timeline_fact";
export type KnowledgeItemStatus = "draft" | "pending" | "published" | "conflicted" | "expired";
export type KnowledgeSourceType = "case-candidate" | "document-import" | "qa-import" | "manual";
export type KnowledgeDocumentJobStatus = "queued" | "parsed" | "needs-review" | "blocked";
export type KnowledgeDocumentJobSource = "upload" | "qa-import";
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
export type FeishuVerificationStepId = "cli" | "auth" | "docs";
export type FeishuVerificationErrorCode =
  | "missing-config"
  | "invalid-cli-path"
  | "cli-missing"
  | "doctor-failed"
  | "auth-failed"
  | "missing-scope"
  | "permission-unknown"
  | "unexpected-error";
export type ModelCapability = "vision" | "reasoning" | "tools" | "web" | "free" | "chat";
export type ModelProviderVerificationStepId = "models" | "chat";
export type ModelProviderVerificationErrorCode =
  | "missing-config"
  | "invalid-base-url"
  | "missing-credential"
  | "secret-unavailable"
  | "models-failed"
  | "no-models"
  | "chat-failed"
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

export interface ModelSummary {
  id: string;
  displayName: string;
  capabilities: ModelCapability[];
  lastSeenAt: string;
}

export interface FeishuConfig {
  profile: string;
  cliPath: string;
  credential: SecretHandle;
  authStatus: ConfigStatus;
  docPermissionStatus: ConfigStatus;
  lastCheckedAt: string | null;
}

export interface FeishuCliRedactedInfo {
  cliName: string;
  profile: string;
}

export interface FeishuVerificationError {
  code: FeishuVerificationErrorCode;
  message: string;
  suggestion: string;
}

export interface FeishuVerificationStep {
  id: FeishuVerificationStepId;
  title: string;
  status: AdtVerificationStepStatus;
  detail: string;
  checkedAt: string;
}

export interface FeishuVerificationReport {
  ok: boolean;
  checkedAt: string;
  mode: "fake" | "cli";
  cli: FeishuCliRedactedInfo;
  steps: FeishuVerificationStep[];
  authStatus: ConfigStatus;
  docPermissionStatus: ConfigStatus;
  errors: FeishuVerificationError[];
}

export interface FeishuVerificationResult {
  report: FeishuVerificationReport;
  state: WorkbenchState;
}

export interface ApiProviderConfig {
  id: string;
  name: string;
  providerType: "openai-compatible" | "deepseek" | "custom";
  baseUrl: string;
  enabled: boolean;
  credential: SecretHandle;
  models: ModelSummary[];
  modelSyncStatus: ConfigStatus;
  chatTestStatus: ConfigStatus;
  lastCheckedAt: string | null;
}

export interface ModelProviderRedactedInfo {
  id: string;
  name: string;
  providerType: ApiProviderConfig["providerType"];
  endpointHost: string;
}

export interface ModelProviderVerificationError {
  code: ModelProviderVerificationErrorCode;
  message: string;
  suggestion: string;
}

export interface ModelProviderVerificationStep {
  id: ModelProviderVerificationStepId;
  title: string;
  status: AdtVerificationStepStatus;
  detail: string;
  checkedAt: string;
}

export interface ModelProviderVerificationReport {
  ok: boolean;
  checkedAt: string;
  mode: "fake" | "http";
  provider: ModelProviderRedactedInfo;
  steps: ModelProviderVerificationStep[];
  modelSyncStatus: ConfigStatus;
  chatTestStatus: ConfigStatus;
  models: ModelSummary[];
  selectedModelId: string | null;
  errors: ModelProviderVerificationError[];
}

export interface ModelProviderVerificationResult {
  report: ModelProviderVerificationReport;
  state: WorkbenchState;
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

export interface StandardsCategory {
  id: StandardsCategoryId;
  title: string;
  description: string;
  sourceContent: string;
  currentContent: string;
  applicableSapVersions: ProjectSummary["sapVersion"][];
  updatedAt: string;
}

export interface ProjectStandardsProfile {
  schemaVersion: 1;
  projectId: string;
  sourceType: StandardsSourceType;
  sourceTemplateId: StandardsTemplateId;
  sourceTemplateName: string;
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  version: number;
  copiedAt: string;
  updatedAt: string;
  categories: StandardsCategory[];
}

export interface StandardsTemplateSummary {
  id: StandardsTemplateId;
  name: string;
  sapVersion: ProjectSummary["sapVersion"];
  description: string;
}

export interface StandardsDiffItem {
  id: StandardsCategoryId;
  title: string;
  status: StandardsDiffStatus;
  sourceExcerpt: string;
  currentExcerpt: string;
}

export interface ProjectStandardsView {
  profile: ProjectStandardsProfile;
  templates: StandardsTemplateSummary[];
  diff: StandardsDiffItem[];
}

export interface StandardsCategoryInput {
  id: StandardsCategoryId;
  currentContent: string;
}

export interface SaveProjectStandardsInput {
  categories: StandardsCategoryInput[];
}

export interface CopyProjectStandardsInput {
  templateId: StandardsTemplateId;
}

export interface CopyProjectStandardsFromProjectInput {
  sourceProjectId: string;
}

export interface KnowledgeTimelineEvent {
  id: string;
  at: string;
  action: "created" | "published" | "marked-conflicted" | "expired" | "edited" | "parsed";
  note: string;
}

export interface KnowledgeItem {
  id: string;
  projectId: string;
  title: string;
  type: KnowledgeItemType;
  status: KnowledgeItemStatus;
  sourceType: KnowledgeSourceType;
  sourceCaseId: string | null;
  sourceFilePath: string | null;
  sapObjects: string[];
  summary: string;
  content: string;
  confidence: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reviewer: string | null;
  conflictWithIds: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  timeline: KnowledgeTimelineEvent[];
}

export interface KnowledgeDocumentJob {
  id: string;
  projectId: string;
  title: string;
  source: KnowledgeDocumentJobSource;
  status: KnowledgeDocumentJobStatus;
  detail: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectKnowledgeBase {
  schemaVersion: 1;
  projectId: string;
  items: KnowledgeItem[];
  documentJobs: KnowledgeDocumentJob[];
  updatedAt: string;
}

export interface KnowledgeStatusCounts {
  draft: number;
  pending: number;
  published: number;
  conflicted: number;
  expired: number;
  total: number;
}

export interface ProjectKnowledgeView {
  projectId: string;
  counts: KnowledgeStatusCounts;
  items: KnowledgeItem[];
  documentJobs: KnowledgeDocumentJob[];
}

export interface KnowledgeItemActionInput {
  itemId: string;
  note?: string;
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

export interface CaseWorkflowInput {
  content: string;
  taskMode: TaskMode;
  modelId: string;
}

export interface CaseGeneratedFile {
  relativePath: string;
  purpose: CaseGeneratedFilePurpose;
  content: string;
}

export interface CaseMessage {
  id: string;
  caseId: string;
  role: "user" | "assistant";
  content: string;
  taskMode: TaskMode;
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
  standards: ProjectStandardsProfile;
  knowledge: ProjectKnowledgeBase;
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
  type: "project" | "case" | "file" | "knowledge";
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
