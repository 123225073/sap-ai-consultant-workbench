export type CaseStatus = "active" | "solved" | "archived";
export type ConfigStatus = "not-configured" | "saved" | "pending-verification" | "verified" | "failed";
export type SecretKind = "adt-password" | "api-key" | "feishu-token" | "codex-token";
export type SecretState = "not-set" | "set-in-secure-store" | "missing" | "failed" | "needs-rotation";
export type SecretStoreKind = "electron-safe-storage";
export type TaskMode = "problem-analysis" | "abap-development" | "document-generation" | "flow-diagram";
export type CaseActionId = "read-source" | "capture-note" | "development-spec" | "draw-flow" | "candidate-knowledge" | "export-handoff";
export type ActionPermissionMode = "request_approval" | "approve_for_me" | "full_access";
export type CaseGeneratedFilePurpose = "output" | "candidate_knowledge" | "technical" | "evidence" | "snapshot";
export type AdtVerificationMode = "fake" | "adt";
export type SapObjectEvidenceType = "program" | "class" | "function" | "include" | "table" | "structure";
export type StandardsTemplateId = "s4-default" | "ecc-default";
export type StandardsCategoryId = "abap" | "comments" | "request" | "alv" | "interface" | "document" | "diagram" | "excel";
export type StandardsDiffStatus = "same" | "modified" | "project-only" | "template-only" | "not-applicable";
export type StandardsSourceType = "sap-version-template" | "copied-project";
export type KnowledgeItemType = "qa" | "doc" | "sap_object" | "case_note" | "timeline_fact";
export type KnowledgeItemStatus = "draft" | "pending" | "published" | "conflicted" | "expired";
export type KnowledgeSourceType = "case-candidate" | "document-import" | "qa-import" | "manual";
export type KnowledgeDocumentJobStatus = "queued" | "parsed" | "needs-review" | "blocked";
export type KnowledgeDocumentJobSource = "upload" | "local-text" | "qa-import";
export type KnowledgeImportSourceKind = "local-text" | "markdown-note" | "qa-text";
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
export type FeishuVerificationStepId = "cli" | "profile" | "auth" | "docs";
export type FeishuHandoffPublishStatus = "not-published";
export type FeishuVerificationErrorCode =
  | "missing-config"
  | "invalid-cli-path"
  | "cli-missing"
  | "install-failed"
  | "profile-missing"
  | "profile-save-failed"
  | "doctor-failed"
  | "auth-failed"
  | "missing-scope"
  | "permission-unknown"
  | "unexpected-error";
export type ModelCapability = "vision" | "reasoning" | "tools" | "web" | "free" | "chat";
export type ModelCatalogMode = "remote" | "manual" | "remote-with-manual-fallback";
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
export type CodexVerificationMode = "cli";
export type CodexVerificationStepId = "cli" | "login" | "readonly-task";
export type CodexCaseAssistStatus = "success" | "failed";
export type CodexVerificationErrorCode =
  | "missing-config"
  | "invalid-cli-path"
  | "unsupported-integration"
  | "cli-missing"
  | "version-failed"
  | "login-failed"
  | "readonly-task-failed"
  | "unexpected-error";
export type CodexCapabilityId = "task-runner" | "mcp" | "plugins" | "skills";
export type LocalAiCapabilityId = "codex-cli";
export type LocalAiInstallStatus = "cancelled" | "installed" | "failed";
export type LocalAiCapabilityPathLabel = "npm 全局安装目录" | "系统命令目录";

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
  connectionId?: string;
}

export interface ProjectSecretInput {
  target: ProjectSecretTarget;
  value: string;
}

export interface AdtConfig {
  id: string;
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
  lastVerificationMode: AdtVerificationMode | null;
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
  source: AdtVerificationMode;
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
  mode: AdtVerificationMode;
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
  appId: string;
  profile: string;
  cliPath: string;
  credential: SecretHandle;
  authStatus: ConfigStatus;
  docPermissionStatus: ConfigStatus;
  lastCheckedAt: string | null;
}

export interface FeishuCliRedactedInfo {
  cliName: string;
  cliPath: string;
  installDir: string | null;
  version: string | null;
  profile: string;
  profileUser: string | null;
  profileTokenStatus: string | null;
  appIdMasked: string | null;
}

export interface FeishuCliProfileSummary {
  name: string;
  appId: string;
  appIdMasked: string;
  brand: "feishu" | "lark" | string;
  active: boolean;
  user: string | null;
  tokenStatus: string | null;
}

export interface FeishuCliDiscoveryReport {
  checkedAt: string;
  installed: boolean;
  cliPath: string | null;
  installDir: string | null;
  commandName: string | null;
  version: string | null;
  profiles: FeishuCliProfileSummary[];
  recommendedProfile: string | null;
  message: string;
}

export interface FeishuCliInstallResult {
  checkedAt: string;
  ok: boolean;
  cliPath: string | null;
  installDir: string | null;
  version: string | null;
  message: string;
  errors: FeishuVerificationError[];
}

export interface FeishuCliProfileSetupResult {
  checkedAt: string;
  ok: boolean;
  profile: string;
  appIdMasked: string;
  message: string;
  errors: FeishuVerificationError[];
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

export interface FeishuAuthAction {
  status: "not-needed" | "opened" | "completed" | "failed";
  message: string;
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
  authAction?: FeishuAuthAction;
}

export interface FeishuVerificationResult {
  report: FeishuVerificationReport;
  state: WorkbenchState;
}

export interface FeishuHandoffResult {
  state: WorkbenchState;
  publishStatus: FeishuHandoffPublishStatus;
  createdAt: string;
  generatedFiles: string[];
  sourceFiles: string[];
  blockedActions: string[];
}

export interface ApiProviderConfig {
  id: string;
  name: string;
  providerType: "openai-compatible" | "anthropic-compatible" | "deepseek" | "custom";
  baseUrl: string;
  enabled: boolean;
  credential: SecretHandle;
  catalogMode?: ModelCatalogMode;
  testModelId?: string;
  manualModelIds?: string[];
  models: ModelSummary[];
  modelSyncStatus: ConfigStatus;
  chatTestStatus: ConfigStatus;
  lastVerificationMode: "fake" | "http" | null;
  verifiedModelIds: string[];
  lastVerifiedModelId: string | null;
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

export interface CodexCapabilitySummary {
  id: CodexCapabilityId;
  label: string;
  status: ConfigStatus;
  detail: string;
}

export interface CodexRedactedInfo {
  integrationType: CodexConfig["integrationType"];
  executablePath: string;
  installDir: string | null;
  cliName: string;
  version: string;
}

export interface CodexVerificationError {
  code: CodexVerificationErrorCode;
  message: string;
  suggestion: string;
}

export interface CodexVerificationStep {
  id: CodexVerificationStepId;
  title: string;
  status: AdtVerificationStepStatus;
  detail: string;
  checkedAt: string;
}

export interface CodexVerificationReport {
  ok: boolean;
  checkedAt: string;
  mode: CodexVerificationMode;
  cli: CodexRedactedInfo;
  steps: CodexVerificationStep[];
  cliStatus: ConfigStatus;
  loginStatus: ConfigStatus;
  readonlyTaskStatus: ConfigStatus;
  capabilities: CodexCapabilitySummary[];
  errors: CodexVerificationError[];
}

export interface CodexVerificationResult {
  report: CodexVerificationReport;
  state: WorkbenchState;
}

export interface LocalAiCapability {
  capabilityId: LocalAiCapabilityId;
  label: "Codex CLI";
  installed: boolean;
  version: string | null;
  pathLabel: LocalAiCapabilityPathLabel | null;
}

export interface LocalAiScanResult {
  checkedAt: string;
  capabilities: LocalAiCapability[];
  message: string;
}

export interface LocalAiInstallInput {
  capabilityId: LocalAiCapabilityId;
}

export interface LocalAiInstallResult {
  checkedAt: string;
  capabilityId: LocalAiCapabilityId;
  status: LocalAiInstallStatus;
  installed: boolean;
  version: string | null;
  pathLabel: LocalAiCapabilityPathLabel | null;
  message: string;
}

export interface CodexCaseAssistContext {
  projectName: string;
  systemLabel: string;
  sapVersion: ProjectSummary["sapVersion"];
  caseTitle: string;
  caseSummary: string;
  taskMode: TaskMode;
  taskLabel: string;
  userInput: string;
  standardsSummary: string;
}

export interface CodexCaseAssistRun {
  status: CodexCaseAssistStatus;
  generatedAt: string;
  executorLabel: string;
  content?: string;
  errorMessage?: string;
  outputCharCount: number;
}

export interface SapObjectEvidenceRequest {
  objectType: SapObjectEvidenceType;
  objectName: string;
  functionGroup?: string;
}

export interface SapObjectEvidenceSummary {
  objectType: SapObjectEvidenceType;
  objectName: string;
  functionGroup: string | null;
  systemAlias: string;
  endpointHost: string;
  client: string;
  usernameMasked: string;
  sourceMode: AdtVerificationMode;
  readAt: string;
  contentLength: number;
  digest: string;
}

export interface SapObjectEvidenceResult {
  state: WorkbenchState;
  summary: SapObjectEvidenceSummary;
  generatedFiles: string[];
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
  action: "created" | "reviewed" | "published" | "marked-conflicted" | "expired" | "edited" | "parsed";
  note: string;
}

export interface KnowledgeReviewChecklist {
  sourceAndScopeConfirmed: boolean;
  noSecretsConfirmed: boolean;
  noSapSourceOrWriteOpsConfirmed: boolean;
  noCustomerDetailsConfirmed: boolean;
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
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewedContentHash: string | null;
  reviewChecklist: KnowledgeReviewChecklist | null;
  conflictWithIds: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  timeline: KnowledgeTimelineEvent[];
}

export interface CaseKnowledgeReference {
  itemId: string;
  title: string;
  summary: string;
  sourceType: KnowledgeSourceType;
  sourceCaseId: string | null;
  sourceFilePath: string | null;
  sapObjects: string[];
  publishedAt: string | null;
  attachedAt: string;
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

export interface KnowledgeReviewInput {
  itemId: string;
  note: string;
  checklist: KnowledgeReviewChecklist;
}

export interface KnowledgeEditInput {
  itemId: string;
  title: string;
  summary: string;
  content: string;
  sapObjects?: string[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  note: string;
}

export interface KnowledgeCaseReferenceInput {
  itemId: string;
  note?: string;
}

export interface KnowledgeImportLocalTextInput {
  projectId: string;
  title: string;
  sourceKind: KnowledgeImportSourceKind;
  sourceName: string;
  body: string;
  sapObjects?: string[];
}

export interface KnowledgeImportLocalTextResult {
  state: WorkbenchState;
  documentJobId: string;
  knowledgeItemId: string;
  generatedFiles: string[];
}

export interface KnowledgeImportTextFileInput {
  projectId: string;
}

export interface KnowledgeImportTextFileMetadata {
  sourceName: string;
  extension: ".md" | ".markdown" | ".txt";
  sizeBytes: number;
  characterCount: number;
}

export type KnowledgeImportTextFileResult =
  | {
      cancelled: true;
      message: string;
    }
  | ({
      cancelled: false;
      file: KnowledgeImportTextFileMetadata;
    } & KnowledgeImportLocalTextResult);

export interface CreateLocalProjectInput {
  name: string;
  sapVersion: ProjectSummary["sapVersion"];
  systemLabel: string;
}

export interface CreateLocalCaseInput {
  projectId: string;
  title: string;
}

export interface DailyChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  modelId: string;
  responseMode?: "model-success" | "model-failed" | "local-record";
  projectId?: string;
  providerId?: string;
  providerName?: string;
  createdAt: string;
}

export interface DailyChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  messages: DailyChatMessage[];
}

export interface CreateDailyChatThreadInput {
  title?: string;
  initialMessage?: string;
}

export interface SwitchDailyChatThreadInput {
  threadId: string;
}

export interface AppendDailyChatMessageInput {
  threadId?: string;
  projectId?: string;
  providerId?: string;
  content: string;
  modelId?: string;
}

export type AiConversationStreamScope = "daily-chat" | "case";
export type AiConversationStreamPhase = "started" | "delta" | "completed";

export interface AiConversationStreamEvent {
  requestId: string;
  scope: AiConversationStreamScope;
  phase: AiConversationStreamPhase;
  delta?: string;
  providerName?: string;
  modelId?: string;
}

export interface SwitchProjectInput {
  projectId: string;
}

export interface HideProjectFromSidebarInput {
  projectId: string;
}

export interface RestoreProjectToSidebarInput {
  projectId: string;
}

export interface SwitchCaseInput {
  projectId: string;
  caseId: string;
}

export interface ProjectConfig {
  schemaVersion: 2;
  projectId: string;
  updatedAt: string;
  adt: AdtConfig;
  adtConnections: AdtConfig[];
  activeAdtConnectionId: string;
  feishu: FeishuConfig;
  apiProviders: ApiProviderConfig[];
  codex: CodexConfig;
  localStorage: LocalStorageConfig;
}

export interface CaseWorkflowInput {
  projectId?: string;
  caseId?: string;
  content: string;
  taskMode: TaskMode;
  modelId: string;
  actionId?: CaseActionId | null;
  permissionMode: ActionPermissionMode;
  providerId?: string;
  codexAssistEnabled?: boolean;
  modelSelectionRejected?: boolean;
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
  providerId?: string;
  actionId?: CaseActionId | null;
  permissionModeUsed?: ActionPermissionMode;
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
  knowledgeReferences: CaseKnowledgeReference[];
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

export interface CaseFilePreviewInput {
  relativePath: string;
}

export interface CaseFilePreview {
  relativePath: string;
  displayName: string;
  fileType: string;
  sizeBytes: number;
  truncated: boolean;
  content: string;
  redactions: number;
}

export interface SearchResult {
  id: string;
  title: string;
  type: "project" | "case" | "file" | "knowledge";
  location: string;
  snippet: string;
  projectId?: string;
  caseId?: string | null;
  sourcePath?: string | null;
}

export interface WorkbenchState {
  schemaVersion: number;
  workspaceRoot: string;
  activeProjectId: string;
  activeCaseId: string;
  activeChatThreadId: string;
  projects: ProjectSummary[];
  chatThreads: DailyChatThread[];
  activeCaseFiles: CaseFileNode[];
  startupNotice?: string;
}

export interface WorkspaceBackupResult {
  status: "created";
  backupPath: string;
  fileCount: number;
  totalBytes: number;
}

export interface WorkspaceImportResult {
  status: "cancelled" | "imported";
  sourcePath?: string;
  backupPath?: string;
  fileCount?: number;
  totalBytes?: number;
  restartRequired: boolean;
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
