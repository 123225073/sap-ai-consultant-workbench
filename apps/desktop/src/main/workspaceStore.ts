import fs from "node:fs/promises";
import path from "node:path";
import {
  assertNoSensitiveCaseContent,
  buildAssistantContent,
  buildCaseMaintenanceArtifacts,
  buildCaseWorkflowArtifacts,
  createCaseMessage,
  normalizeActionPermissionMode,
  normalizeCaseActionId,
  normalizeTaskMode,
  parseCaseWorkflowInput,
  TASK_MODE_LABELS,
  type CaseWorkflowArtifacts
} from "./caseWorkflowService";
import {
  copyProjectStandardsFromProject,
  createProjectStandards,
  normalizeProjectStandards,
  parseCopyProjectStandardsFromProjectInput,
  parseCopyProjectStandardsInput,
  parseSaveProjectStandardsInput,
  projectStandardsView,
  renderProjectStandardsJson,
  renderProjectStandardsMarkdown,
  standardsSummaryForTask,
  updateProjectStandards
} from "./standardsService";
import {
  appendKnowledgeCandidatesFromCase,
  createCaseKnowledgeReference,
  createImportedKnowledgeCandidate,
  createProjectKnowledge,
  editKnowledgeCandidate,
  expireKnowledgeItem,
  markKnowledgeItemConflicted,
  normalizeProjectKnowledge,
  parseKnowledgeCaseReferenceInput,
  parseKnowledgeEditInput,
  parseKnowledgeImportLocalTextInput,
  parseKnowledgeActionInput,
  parseKnowledgeReviewInput,
  projectKnowledgeView,
  publishKnowledgeItem,
  renderProjectKnowledgeJson,
  renderProjectKnowledgeMarkdown,
  reviewKnowledgeItemForPublish
} from "./knowledgeService";
import { DatabaseService } from "./databaseService";
import { buildSearchDocuments, searchWorkbench, type SafeOutputSummaryRecord } from "./searchService";
import { emptySecretHandle } from "../shared/secretHandle";
import type { AdtConfig, AdtVerificationMode, AdtVerificationReport, AppendDailyChatMessageInput, CaseFileNode, CaseFilePreview, CaseGeneratedFile, CaseKnowledgeReference, CaseMessage, CaseSummary, CaseWorkflowInput, CodexCaseAssistContext, CodexCaseAssistRun, CodexVerificationReport, ConfigStatus, ConversationThreadStatus, CreateDailyChatThreadInput, CreateLocalCaseInput, CreateLocalProjectInput, CreateWorkThreadInput, DailyChatMessage, DailyChatThread, FeishuHandoffResult, FeishuVerificationReport, HideProjectFromSidebarInput, KnowledgeImportLocalTextResult, ModelProviderVerificationReport, ModelSummary, ProjectConfig, ProjectKnowledgeView, ProjectSecretTarget, ProjectStandardsView, ProjectSummary, RestoreProjectToSidebarInput, SapObjectEvidenceResult, SecretHandle, SecretKind, SearchResult, SwitchCaseInput, SwitchDailyChatThreadInput, SwitchProjectInput, SwitchWorkThreadInput, UpdateConversationThreadStatusInput, WorkbenchState, WorkThread } from "../shared/workbenchTypes";
import type { AgentInterruptedTurnRecovery } from "../shared/agentRuntimeTypes";
import { buildSafeModelDraftContext, type SafeModelDraftContext, type SafeModelDraftRun } from "./safeModelCaseDraftService";
import { normalizeSapObjectEvidenceResult, renderSapObjectEvidenceFiles, sapObjectEvidenceBoundary, type SapObjectEvidenceConnectorResult } from "./sapObjectEvidenceService";
import { renderFeishuHandoffArtifacts } from "./feishuHandoffService";
import { decideInterruptedTurnProjection } from "./agentRecovery";

interface StoredState {
  schemaVersion: number;
  activeProjectId: string;
  activeCaseId: string;
  activeWorkThreadId: string;
  activeChatThreadId: string;
  projects: ProjectSummary[];
  workThreads: WorkThread[];
  chatThreads: DailyChatThread[];
}

interface TextBatchTransactionItem {
  targetPath: string;
  tempPath: string;
  backupPath: string;
  hadOriginal: boolean;
  snapshotPath?: string;
}

interface TextBatchTransactionJournal {
  version: 1;
  status: "preparing" | "committed";
  createdAt: string;
  items: TextBatchTransactionItem[];
}

export interface PreparedSafeModelDraftRequest {
  projectId: string;
  providerId: string;
  providerName: string;
  providerType: ProjectConfig["apiProviders"][number]["providerType"];
  baseUrl: string;
  modelId: string;
  context: SafeModelDraftContext;
}

export interface PreparedCodexCaseAssistRequest {
  projectId: string;
  caseId: string;
  integrationType: ProjectConfig["codex"]["integrationType"];
  executablePath: string;
  workspaceRoot: string;
  context: CodexCaseAssistContext;
}

export interface DailyChatAssistantReply {
  content: string;
  modelId: string;
  responseMode: "model-success" | "model-failed";
  projectId: string;
  providerId: string;
  providerName: string;
}

export interface LocalTaskFolderBindingInput {
  folderPath: string;
  folderName: string;
}

interface LocalTaskFolderBindingRecord {
  projectId: string;
  caseId: string;
  folderPath: string;
  folderName: string;
  createdAt: string;
}

interface LocalTaskFolderBindingRegistry {
  schemaVersion: 1;
  bindings: LocalTaskFolderBindingRecord[];
}

const DEMO_PROJECT_ID = "demo-s4hana";
const DEMO_CASE_ID = "demo001";
const STARTER_PROJECT_ID = "local-workspace";
const STARTER_CASE_ID = "inbox";
const DEFAULT_WORK_THREAD_ID = "work-inbox";
const DEFAULT_CHAT_THREAD_ID = "daily-chat-default";
const SCHEMA_VERSION = 3;
const MAX_PROJECT_CONFIG_BYTES = 16 * 1024 * 1024;

class IncompatibleStateVersionError extends Error {
  constructor(readonly foundVersion: number) {
    super(`本地数据版本 ${foundVersion} 高于当前应用支持的版本 ${SCHEMA_VERSION}。为避免旧版本覆盖新数据，应用已停止写入。请安装更新版本后重试。`);
    this.name = "IncompatibleStateVersionError";
  }
}

function storedStateVersion(value: unknown): number {
  if (!value || typeof value !== "object") throw new Error("本地状态结构无效。");
  const rawVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (rawVersion === undefined) return 1;
  if (!Number.isInteger(rawVersion) || Number(rawVersion) < 1) throw new Error("本地状态版本无效。");
  return Number(rawVersion);
}

function migrateStoredState(value: unknown): StoredState {
  const sourceVersion = storedStateVersion(value);
  if (sourceVersion > SCHEMA_VERSION) throw new IncompatibleStateVersionError(sourceVersion);
  let migrated = { ...(value as StoredState) };
  if (sourceVersion === 1) {
    migrated = { ...migrated, schemaVersion: 2 };
  }
  if (sourceVersion <= 2) {
    migrated = {
      ...migrated,
      schemaVersion: 3,
      activeWorkThreadId: "",
      workThreads: []
    };
  }
  return migrated;
}

const directories = [
  "outputs",
  "knowledge_candidates",
  "snapshots",
  "evidence",
  "technical"
];
const MAX_PREVIEW_FILE_BYTES = 256 * 1024;
const MAX_PREVIEW_BYTES = 64 * 1024;
const SAFE_PREVIEW_EXTENSIONS = new Set([".md", ".txt", ".csv", ".mmd"]);
const BLOCKED_PREVIEW_FILENAMES = new Set(["messages.json", "metadata.json", "project.json", "app-state.json"]);
const SAFE_INDEX_DIRECTORIES = new Set(["outputs"]);
const SAFE_INDEX_EXTENSIONS = new Set([".md", ".txt", ".csv", ".mmd"]);
const MAX_INDEX_FILE_BYTES = 128 * 1024;
const MAX_INDEX_READ_BYTES = 32 * 1024;
const MAX_INDEX_SUMMARY_CHARS = 600;

function redactPreviewContent(input: string): { content: string; redactions: number } {
  const patterns = [
    /authorization\s*[:=]\s*[^\n\r]+/gi,
    /bearer\s+[a-z0-9._~+/=-]{12,}/gi,
    /cookie\s*[:=]\s*[^\n\r]+/gi,
    new RegExp("SAP_" + "SESSIONID\\s*[:=]\\s*[^\\s]+", "gi"),
    new RegExp("MYSAP" + "SSO2\\s*[:=]\\s*[^\\s]+", "gi"),
    /secure-store:sec_[a-f0-9]{32}/gi,
    /sk-(?:proj-)?[a-z0-9_-]{20,}/gi,
    /github_pat_[a-z0-9_]{20,}/gi,
    /ghp_[a-z0-9]{20,}/gi,
    /xox[baprs]-[a-z0-9-]{20,}/gi,
    /akia[0-9a-z]{16}/gi,
    /api[_-]?key\s*[:=]\s*[^\s]+/gi,
    /client[_-]?secret\s*[:=]\s*[^\s]+/gi,
    /access[_-]?key\s*[:=]\s*[^\s]+/gi,
    /secret\s*[:=]\s*[^\s]+/gi,
    /tenant[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
    /user[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
    new RegExp("device_" + "code\\s*[:=]\\s*[^\\s]+", "gi"),
    new RegExp("verification_" + "uri\\s*[:=]\\s*[^\\s]+", "gi")
  ];
  let redactions = 0;
  let content = input;
  for (const pattern of patterns) {
    content = content.replace(pattern, () => {
      redactions += 1;
      return "[已脱敏]";
    });
  }
  return { content, redactions };
}

function redactIndexableText(input: string): { content: string; redactions: number } {
  const patterns = [
    /bearer\s+[a-z0-9._~+/=-]{12,}/gi,
    /authorization\s*[:=]\s*[^\n\r]+/gi,
    /cookie\s*[:=]\s*[^\n\r]+/gi,
    new RegExp("SAP_" + "SESSIONID\\s*[:=]\\s*[^\\s]+", "gi"),
    new RegExp("MYSAP" + "SSO2\\s*[:=]\\s*[^\\s]+", "gi"),
    /secure-store:sec_[a-f0-9]{32}/gi,
    /sk-(?:proj-)?[a-z0-9_-]{20,}/gi,
    /github_pat_[a-z0-9_]{20,}/gi,
    /ghp_[a-z0-9]{20,}/gi,
    /xox[baprs]-[a-z0-9-]{20,}/gi,
    /akia[0-9a-z]{16}/gi,
    /api[_-]?key\s*[:=]\s*[^\s]+/gi,
    /client[_-]?secret\s*[:=]\s*[^\s]+/gi,
    /access[_-]?key\s*[:=]\s*[^\s]+/gi,
    /secret\s*[:=]\s*[^\s]+/gi,
    /password\s*[:=]\s*[^\s]+/gi,
    /tenant[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
    /user[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
    /token\s*[:=]\s*[^\s]+/gi,
    new RegExp("device_" + "code\\s*[:=]\\s*[^\\s]+", "gi"),
    new RegExp("verification_" + "uri\\s*[:=]\\s*[^\\s]+", "gi"),
    /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gi
  ];
  let redactions = 0;
  let content = input;
  for (const pattern of patterns) {
    content = content.replace(pattern, () => {
      redactions += 1;
      return "[已脱敏]";
    });
  }
  return { content, redactions };
}

function hasUnsafeIndexableContent(input: string): boolean {
  const unsafePatterns = [
    /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    /secure-store:sec_[a-f0-9]{32}/i,
    /bearer\s+[a-z0-9._~+/=-]{12,}/i,
    /sk-(?:proj-)?[a-z0-9_-]{20,}/i,
    /github_pat_[a-z0-9_]{20,}/i,
    /ghp_[a-z0-9]{20,}/i,
    /xox[baprs]-[a-z0-9-]{20,}/i,
    /akia[0-9a-z]{16}/i,
    /authorization\s*[:=]/i,
    /cookie\s*[:=]/i,
    /sap_sessionid/i,
    /mysapsso2/i,
    /api[_-]?key\s*[:=]/i,
    /client[_-]?secret\s*[:=]/i,
    /access[_-]?key\s*[:=]/i,
    /secret\s*[:=]/i,
    /password\s*[:=]/i,
    /token\s*[:=]/i,
    /^\s*(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION)\s+[\w/]+/im,
    /^\s*(FORM|MODULE|METHOD)\s+[\w/]+/im,
    /\bENDCLASS\b|\bENDFUNCTION\b|\bENDFORM\b|\bENDMETHOD\b/i,
    /\bSELECT\s+[\s\S]{0,300}\s+FROM\s+[\w/]+/i,
    /\bCALL\s+(FUNCTION|TRANSACTION)\b/i,
    /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
  ];
  if (unsafePatterns.some((pattern) => pattern.test(input))) return true;

  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const structuredRows = lines.filter((line) => line.split(/\t|,|\|/).filter((cell) => cell.trim().length > 0).length >= 5);
  return structuredRows.length >= 6;
}

function safeIndexSummary(input: string): string {
  return input
    .replace(/[`*_>#|,[\]{}()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_INDEX_SUMMARY_CHARS);
}

function nowIso(): string {
  return new Date().toISOString();
}

function demoCase(): CaseSummary {
  const createdAt = "2026-07-02T10:20:00.000Z";
  return {
    id: DEMO_CASE_ID,
    projectId: DEMO_PROJECT_ID,
    title: "DEMO001 演示BOM清单",
    status: "active",
    caseDir: "demo001",
    summary: "演示BOM筛选口径与当前业务范围不一致，已生成本地样例输出。",
    createdAt,
    updatedAt: nowIso(),
    lastOpenedAt: nowIso(),
    folderName: "demo001",
    currentSummary: "演示BOM筛选口径与当前业务范围不一致，已生成本地样例输出。",
    knowledgeReferences: [],
    messages: [
      {
        id: "seed-user-1",
        caseId: DEMO_CASE_ID,
        role: "user",
        content: "帮我分析 DEMO001 演示BOM清单，确认为什么部分工厂没有数据。",
        taskMode: "problem-analysis",
        modelId: "demo-model",
        linkedFileIds: [],
        createdAt: "2026-07-02T10:24:00.000Z"
      },
      {
        id: "seed-assistant-1",
        caseId: DEMO_CASE_ID,
        role: "assistant",
        content: "已确认：问题来自演示BOM筛选口径与当前业务范围不一致。建议调整为当前业务口径，并增加异常工厂提示。",
        taskMode: "problem-analysis",
        modelId: "demo-model",
        linkedFileIds: ["outputs/演示BOM核对.md", "outputs/逻辑说明图.mmd", "outputs/开发说明书.md"],
        createdAt: "2026-07-02T10:26:00.000Z"
      }
    ]
  };
}

function demoChatThread(): DailyChatThread {
  const createdAt = "2026-07-02T10:16:00.000Z";
  return {
    id: DEFAULT_CHAT_THREAD_ID,
    title: "日常对话",
    status: "active",
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: nowIso(),
    archivedAt: null,
    removedAt: null,
    messages: [
      {
        id: "seed-chat-assistant-1",
        threadId: DEFAULT_CHAT_THREAD_ID,
        role: "assistant",
        content: "这里是独立日常对话，不关联项目、案件或文件夹。需要沉淀成果时，再新建正式案件。",
        modelId: "local-chat",
        createdAt
      }
    ]
  };
}

function demoProject(): ProjectSummary {
  const createdAt = "2026-07-02T10:18:00.000Z";
  const projectDir = DEMO_PROJECT_ID;
  return {
    id: DEMO_PROJECT_ID,
    name: "演示 S4HANA",
    sapVersion: "S4",
    systemLabel: "DEV/100",
    projectDir,
    isVisible: true,
    visibleOrder: 1,
    connectionState: "local-demo",
    createdAt,
    updatedAt: nowIso(),
    config: defaultProjectConfig(DEMO_PROJECT_ID, projectDir, "demo001", { demo: true }),
    standards: createProjectStandards(DEMO_PROJECT_ID, "S4", "s4-default"),
    knowledge: createProjectKnowledge(DEMO_PROJECT_ID, true),
    cases: [demoCase()]
  };
}

function starterCase(projectId = STARTER_PROJECT_ID): CaseSummary {
  const createdAt = nowIso();
  return {
    id: STARTER_CASE_ID,
    projectId,
    title: "收件箱",
    status: "active",
    caseDir: STARTER_CASE_ID,
    summary: "尚未生成案件成果。",
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
    folderName: STARTER_CASE_ID,
    currentSummary: "尚未生成案件成果。",
    knowledgeReferences: [],
    messages: []
  };
}

function starterChatThread(): DailyChatThread {
  const createdAt = nowIso();
  return {
    id: DEFAULT_CHAT_THREAD_ID,
    title: "日常对话",
    status: "active",
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
    archivedAt: null,
    removedAt: null,
    messages: []
  };
}

function createWorkThreadRecord(
  projectId: string,
  caseItem: CaseSummary,
  title: string,
  existingThreadIds: Iterable<string>,
  preferredId?: string
): WorkThread {
  const createdAt = nowIso();
  const availableIds = new Set(existingThreadIds);
  const id = preferredId && !availableIds.has(preferredId)
    ? preferredId
    : uniqueEntityId("work", availableIds);
  return {
    id,
    projectId,
    caseId: caseItem.id,
    title,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
    archivedAt: null,
    removedAt: null,
    messages: caseItem.messages.map((message) => ({ ...message }))
  };
}

function starterProject(): ProjectSummary {
  const createdAt = nowIso();
  const firstCase = starterCase();
  return {
    id: STARTER_PROJECT_ID,
    name: "我的工作",
    sapVersion: "UNKNOWN",
    systemLabel: "Local",
    projectDir: STARTER_PROJECT_ID,
    isVisible: true,
    visibleOrder: 1,
    connectionState: "not-configured",
    createdAt,
    updatedAt: createdAt,
    config: defaultProjectConfig(STARTER_PROJECT_ID, STARTER_PROJECT_ID, firstCase.folderName),
    standards: createProjectStandards(STARTER_PROJECT_ID, "UNKNOWN", "s4-default"),
    knowledge: createProjectKnowledge(STARTER_PROJECT_ID, false),
    cases: [firstCase]
  };
}

function localStorageConfigForCase(projectDir: string, caseDir: string, updatedAt = nowIso()): ProjectConfig["localStorage"] {
  return {
    storageMode: "json",
    workspaceRoot: "local-data/workbench",
    stateJsonPath: "local-data/workbench/app-state.json",
    projectDir: `local-data/workbench/projects/${projectDir}`,
    casesDir: `local-data/workbench/projects/${projectDir}/cases/${caseDir}`,
    databasePath: "local-data/workbench/app.db",
    indexesDir: "local-data/workbench/indexes",
    logsDir: "local-data/workbench/logs",
    tempDir: "local-data/workbench/temp",
    status: "saved",
    lastCheckedAt: updatedAt,
    lastError: null
  };
}

function syncProjectLocalStorage(project: ProjectSummary, caseItem: CaseSummary): void {
  const updatedAt = nowIso();
  const localStorage = localStorageConfigForCase(project.projectDir || project.id, caseItem.folderName || caseItem.id, updatedAt);
  if (
    project.config.localStorage.projectDir === localStorage.projectDir &&
    project.config.localStorage.casesDir === localStorage.casesDir
  ) {
    return;
  }
  project.config = {
    ...project.config,
    updatedAt,
    localStorage
  };
}

function defaultProjectConfig(projectId: string, projectDir: string, caseDir: string, options: { demo?: boolean } = {}): ProjectConfig {
  const updatedAt = nowIso();
  const demo = options.demo === true;
  const adt: ProjectConfig["adt"] = {
    id: "adt-default",
    alias: demo ? "演示开发系统" : "",
    systemId: demo ? "DEM" : "",
    instanceNumber: demo ? "00" : "",
    environment: demo ? "development" : "other",
    usage: "",
    routingKeywords: [],
    url: demo ? "https://sap-demo.example.com" : "",
    client: demo ? "100" : "",
    username: demo ? "DEMO_USER" : "",
    language: "ZH",
    sslMode: "skip-certificate",
    readOnly: true,
    credential: emptySecretHandle("adt-password"),
    configStatus: demo ? "saved" : "not-configured",
    connectionStatus: "pending-verification",
    minimalReadStatus: "pending-verification",
    lastVerificationMode: null,
    lastCheckedAt: null
  };
  return {
    schemaVersion: 3,
    projectId,
    updatedAt,
    adt,
    adtConnections: [{ ...adt }],
    activeAdtConnectionId: adt.id,
    feishu: {
      appId: "",
      profile: demo ? "demo-profile" : "",
      cliPath: "lark-cli",
      credential: emptySecretHandle("feishu-token"),
      authStatus: "pending-verification",
      docPermissionStatus: "pending-verification",
      lastCheckedAt: null
    },
    apiProviders: [
      {
        id: demo ? "demo-openai-compatible" : "openai-compatible-default",
        name: demo ? "演示 OpenAI 兼容渠道" : "OpenAI Compatible",
        providerType: "openai-compatible",
        baseUrl: demo ? "https://api-demo.example.com/v1" : "",
        enabled: false,
        credential: emptySecretHandle("api-key"),
        catalogMode: "remote",
        testModelId: "",
        manualModelIds: [],
        models: [],
        modelSyncStatus: "pending-verification",
        chatTestStatus: "pending-verification",
        lastVerificationMode: null,
        verifiedModelIds: [],
        lastVerifiedModelId: null,
        lastCheckedAt: null
      }
    ],
    codex: {
      integrationType: "cli",
      executablePath: "codex",
      credential: emptySecretHandle("codex-token"),
      cliStatus: "pending-verification",
      version: "",
      loginStatus: "pending-verification",
      readonlyTaskStatus: "pending-verification",
      lastCheckedAt: null
    },
    localStorage: localStorageConfigForCase(projectDir, caseDir, updatedAt)
  };
}

function assertSafeLifecycleText(label: string, value: unknown, maxLength = 96): string {
  if (typeof value !== "string") {
    throw new Error(`${label}必须是普通文本。`);
  }
  const textValue = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!textValue) {
    throw new Error(`${label}不能为空。`);
  }
  if (textValue.length > maxLength) {
    throw new Error(`${label}过长。`);
  }
  const lower = textValue.toLowerCase();
  const unsafeText = /(authorization|cookie|password|passwd|api[_-]?key|client[_-]?secret|access[_-]?key|secret|token|secure-store|sap_sessionid|mysapsso2)/i.test(textValue);
  const unsafePath = (
    textValue.includes("../") ||
    textValue.includes("..\\") ||
    textValue.includes("\\") ||
    textValue.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(textValue) ||
    /^[a-z][a-z0-9+.-]*:/i.test(textValue) ||
    lower.includes(".sap-adt-cli") ||
    lower.includes(".sap-abap-cli") ||
    lower.includes(".env") ||
    lower.includes("messages.json") ||
    lower.includes("metadata.json") ||
    lower.includes("app-state.json") ||
    lower.includes("project.json")
  );
  if (unsafeText || unsafePath) {
    throw new Error(`${label}包含不安全文本或疑似文件路径。`);
  }
  return textValue;
}

export function parseCreateLocalProjectInput(input: unknown): CreateLocalProjectInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("新建 Project 请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["name", "sapVersion", "systemLabel"].includes(key))) {
    throw new Error("新建 Project 请求包含不支持的字段。");
  }
  const candidate = input as Partial<CreateLocalProjectInput>;
  return {
    name: assertSafeLifecycleText("项目名称", candidate.name, 80),
    sapVersion: lifecycleSapVersion(candidate.sapVersion),
    systemLabel: assertSafeLifecycleText("系统标签", candidate.systemLabel, 40)
  };
}

function assertStrictLifecycleId(label: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`${label}必须是普通本地 ID。`);
  }
  if (value !== value.trim() || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error(`${label}包含不安全内容或疑似文件路径。`);
  }
  return value;
}

function assertSafeDailyChatContent(value: unknown): string {
  if (typeof value !== "string") return "";
  const content = value.trim();
  if (content.length > 8000) {
    throw new Error("单条日常对话过长。请先整理成 8000 字以内再发送。");
  }
  const secretLikePatterns = [
    /secure-store:sec_[a-f0-9]{32}/i,
    /sk-[a-z0-9]{20,}/i,
    /bearer\s+[a-z0-9._-]{12,}/i,
    /authorization\s*[:=]\s*[^\s]+/i,
    /cookie\s*[:=]\s*[^\s]+/i,
    /api[_-]?key\s*[:=]\s*["']?[^"'\s]{8,}/i,
    /password\s*[:=]\s*["']?[^"'\s]{6,}/i,
    /passwd\s*[:=]\s*["']?[^"'\s]{6,}/i,
    /token\s*[:=]\s*["']?[^"'\s]{8,}/i
  ];
  if (secretLikePatterns.some((pattern) => pattern.test(content))) {
    throw new Error("日常对话中包含疑似密码、Token、API Key 或授权信息。请删除敏感内容后再发送。");
  }
  return content;
}

export function parseCreateLocalCaseInput(input: unknown): CreateLocalCaseInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("新建工作文件夹请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["projectId", "title"].includes(key))) {
    throw new Error("新建工作文件夹请求包含不支持的字段。");
  }
  const candidate = input as Partial<CreateLocalCaseInput>;
  const projectId = assertStrictLifecycleId("项目 ID", candidate.projectId);
  return {
    projectId,
    title: assertSafeLifecycleText("工作文件夹名称", candidate.title, 120)
  };
}

export function parseCreateWorkThreadInput(input: unknown): CreateWorkThreadInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("新建任务请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["projectId", "title", "folderMode", "folderName", "caseId", "folderSelectionToken"].includes(key))) {
    throw new Error("新建任务请求包含不支持的字段。");
  }
  const candidate = input as Partial<CreateWorkThreadInput>;
  const folderMode = candidate.folderMode === "existing" ? "existing" : "new";
  const result: CreateWorkThreadInput = {
    projectId: assertStrictLifecycleId("Project ID", candidate.projectId),
    title: assertSafeLifecycleText("任务名称", candidate.title, 120),
    folderMode
  };
  if (folderMode === "existing") {
    if (candidate.folderSelectionToken) {
      result.folderSelectionToken = assertStrictLifecycleId("文件夹选择凭证", candidate.folderSelectionToken);
    } else {
      result.caseId = assertStrictLifecycleId("工作文件夹 ID", candidate.caseId);
    }
  } else {
    result.folderName = assertSafeLifecycleText("工作文件夹名称", candidate.folderName || candidate.title, 120);
  }
  return result;
}

function parseSwitchWorkThreadInput(input: unknown): SwitchWorkThreadInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("切换任务请求无效。");
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "threadId") throw new Error("切换任务请求只能包含 threadId。");
  return { threadId: assertStrictLifecycleId("任务会话 ID", (input as Partial<SwitchWorkThreadInput>).threadId) };
}

function parseUpdateConversationThreadStatusInput(input: unknown): UpdateConversationThreadStatusInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("会话状态请求无效。");
  const candidate = input as Partial<UpdateConversationThreadStatusInput>;
  if (candidate.scope !== "work" && candidate.scope !== "chat") throw new Error("会话类型无效。");
  if (candidate.status !== "active" && candidate.status !== "archived" && candidate.status !== "removed") throw new Error("会话状态无效。");
  return {
    scope: candidate.scope,
    threadId: assertStrictLifecycleId("会话 ID", candidate.threadId),
    status: candidate.status
  };
}

export function parseCreateDailyChatThreadInput(input: unknown): CreateDailyChatThreadInput {
  if (input === undefined || input === null) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("新建日常对话请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["title", "initialMessage"].includes(key))) {
    throw new Error("新建日常对话请求包含不支持的字段。");
  }
  const candidate = input as Partial<CreateDailyChatThreadInput>;
  return {
    title: typeof candidate.title === "string" && candidate.title.trim()
      ? assertSafeLifecycleText("日常对话标题", candidate.title, 80)
      : undefined,
    initialMessage: assertSafeDailyChatContent(candidate.initialMessage)
  };
}

function parseSwitchDailyChatThreadInput(input: unknown): SwitchDailyChatThreadInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("切换日常对话请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "threadId") {
    throw new Error("切换日常对话请求只能包含 threadId。");
  }
  return { threadId: assertStrictLifecycleId("日常对话 ID", (input as Partial<SwitchDailyChatThreadInput>).threadId) };
}

export function parseAppendDailyChatMessageInput(input: unknown): AppendDailyChatMessageInput {
  if (typeof input === "string") {
    return { content: assertSafeDailyChatContent(input) };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { content: "" };
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["threadId", "projectId", "providerId", "content", "modelId"].includes(key))) {
    throw new Error("发送日常对话请求包含不支持的字段。");
  }
  const candidate = input as Partial<AppendDailyChatMessageInput>;
  return {
    threadId: typeof candidate.threadId === "string" && candidate.threadId.trim()
      ? assertStrictLifecycleId("日常对话 ID", candidate.threadId)
      : undefined,
    projectId: typeof candidate.projectId === "string" && candidate.projectId.trim()
      ? assertStrictLifecycleId("项目 ID", candidate.projectId)
      : undefined,
    providerId: typeof candidate.providerId === "string" && candidate.providerId.trim()
      ? assertStrictLifecycleId("模型渠道 ID", candidate.providerId)
      : undefined,
    content: assertSafeDailyChatContent(candidate.content),
    modelId: safeMessageModelId(candidate.modelId)
  };
}

function parseSwitchProjectInput(input: unknown): SwitchProjectInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("切换 Project 请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "projectId") {
    throw new Error("切换 Project 请求只能包含 projectId。");
  }
  const projectId = assertStrictLifecycleId("项目 ID", (input as Partial<SwitchProjectInput>).projectId);
  return { projectId };
}

function parseHideProjectFromSidebarInput(input: unknown): HideProjectFromSidebarInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("隐藏 Project 请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "projectId") {
    throw new Error("隐藏 Project 请求只能包含 projectId。");
  }
  const projectId = assertStrictLifecycleId("项目 ID", (input as Partial<HideProjectFromSidebarInput>).projectId);
  return { projectId };
}

function parseRestoreProjectToSidebarInput(input: unknown): RestoreProjectToSidebarInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("恢复 Project 请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "projectId") {
    throw new Error("恢复 Project 请求只能包含 projectId。");
  }
  const projectId = assertStrictLifecycleId("项目 ID", (input as Partial<RestoreProjectToSidebarInput>).projectId);
  return { projectId };
}

function parseSwitchCaseInput(input: unknown): SwitchCaseInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("切换工作文件夹请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["projectId", "caseId"].includes(key))) {
    throw new Error("切换工作文件夹请求只能包含 projectId 和 caseId。");
  }
  const projectId = assertStrictLifecycleId("项目 ID", (input as Partial<SwitchCaseInput>).projectId);
  const caseId = assertStrictLifecycleId("工作文件夹 ID", (input as Partial<SwitchCaseInput>).caseId);
  return { projectId, caseId };
}

function timestampIdSegment(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
}

function uniqueEntityId(prefix: string, existingIds: Iterable<string>): string {
  const existing = new Set(existingIds);
  const base = `${prefix}-${timestampIdSegment()}`;
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("无法生成唯一的本地 ID。");
}

function safeKnowledgeImportFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "imported-knowledge";
  return `imported-knowledge-${slug}-${timestampIdSegment()}.md`;
}

function createLocalCaseRecord(projectId: string, title: string, existingCaseIds: Iterable<string>): CaseSummary {
  const createdAt = nowIso();
  const id = uniqueEntityId("case", existingCaseIds);
  return {
    id,
    projectId,
    title,
    status: "active",
    caseDir: id,
    summary: "尚未生成案件成果。",
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
    folderName: id,
    folderSource: "managed",
    linkedFolderName: null,
    currentSummary: "尚未生成案件成果。",
    knowledgeReferences: [],
    messages: []
  };
}

function chatTitleFromContent(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 36) || "新对话";
}

function createDailyChatMessage(
  role: DailyChatMessage["role"],
  threadId: string,
  content: string,
  modelId = "local-chat",
  provenance: Pick<DailyChatMessage, "responseMode" | "projectId" | "providerId" | "providerName"> = {},
  agentTurnId?: string
): DailyChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    threadId,
    agentTurnId,
    role,
    content,
    modelId: safeMessageModelId(modelId),
    ...provenance,
    createdAt: nowIso()
  };
}

function createLocalChatThreadRecord(input: CreateDailyChatThreadInput, existingThreadIds: Iterable<string>): DailyChatThread {
  const createdAt = nowIso();
  const id = uniqueEntityId("chat", existingThreadIds);
  const initialMessage = text(input.initialMessage);
  const title = assertSafeLifecycleText("日常对话标题", input.title || chatTitleFromContent(initialMessage) || "新对话", 80);
  const messages: DailyChatMessage[] = initialMessage
    ? [
        createDailyChatMessage("user", id, initialMessage),
        createDailyChatMessage("assistant", id, "已记录为独立日常对话。本对话不关联项目、案件或文件夹；需要正式交付时，请新建案件。")
      ]
    : [];
  return {
    id,
    title,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
    archivedAt: null,
    removedAt: null,
    messages
  };
}

function createLocalProjectRecord(input: CreateLocalProjectInput, existingProjectIds: Iterable<string>, visibleOrder: number): ProjectSummary {
  const createdAt = nowIso();
  const id = uniqueEntityId("project", existingProjectIds);
  const projectDir = id;
  const firstCase = createLocalCaseRecord(id, "收件箱", []);
  const templateId = input.sapVersion === "ECC" ? "ecc-default" : "s4-default";
  return {
    id,
    name: input.name,
    sapVersion: input.sapVersion,
    systemLabel: input.systemLabel,
    projectDir,
    isVisible: true,
    visibleOrder,
    connectionState: "not-configured",
    createdAt,
    updatedAt: createdAt,
    config: defaultProjectConfig(id, projectDir, firstCase.folderName),
    standards: createProjectStandards(id, input.sapVersion, templateId),
    knowledge: createProjectKnowledge(id, false),
    cases: [firstCase]
  };
}

function emptyState(): StoredState {
  const chatThread = starterChatThread();
  const project = starterProject();
  const workThread = createWorkThreadRecord(project.id, project.cases[0], "收件箱", [], DEFAULT_WORK_THREAD_ID);
  return {
    schemaVersion: SCHEMA_VERSION,
    activeProjectId: project.id,
    activeCaseId: project.cases[0].id,
    activeWorkThreadId: workThread.id,
    activeChatThreadId: chatThread.id,
    projects: [project],
    workThreads: [workThread],
    chatThreads: [chatThread]
  };
}

function purposeFor(relativePath: string, kind: "file" | "directory"): CaseFileNode["purpose"] {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized === "README.md") return "summary";
  if (normalized === "conversation.md") return "conversation";
  if (normalized === "metadata.json") return "metadata";
  if (normalized.startsWith("outputs/")) return "output";
  if (normalized.startsWith("knowledge_candidates/")) return "candidate_knowledge";
  if (normalized.startsWith("technical/")) return "technical";
  if (normalized.startsWith("evidence/")) return "evidence";
  if (normalized.startsWith("snapshots/")) return "snapshot";
  if (kind === "directory" && normalized === "outputs") return "output";
  if (kind === "directory" && normalized === "knowledge_candidates") return "candidate_knowledge";
  if (kind === "directory" && normalized === "technical") return "technical";
  if (kind === "directory" && normalized === "evidence") return "evidence";
  if (kind === "directory" && normalized === "snapshots") return "snapshot";
  return "other";
}

const INTERNAL_CASE_TREE_FILENAMES = new Set(["messages.json", "metadata.json", "project.json", "app-state.json"]);
const INTERNAL_CASE_TREE_PATH_NAMES = new Set([".env", ".sap-adt-cli", ".sap-abap-cli", ".lark-cli", ".feishu", "secure-store", "secrets", "credentials"]);

function isInternalCaseTreeEntry(relativePath: string, kind: "file" | "directory"): boolean {
  const parts = relativePath.split(/[\\/]/).map((part) => part.toLowerCase()).filter(Boolean);
  const basename = parts.at(-1) ?? path.basename(relativePath).toLowerCase();
  if (parts.some((part) => INTERNAL_CASE_TREE_PATH_NAMES.has(part) || part.includes("credential") || part.includes("secret"))) return true;
  if (INTERNAL_CASE_TREE_FILENAMES.has(basename)) return true;
  return kind === "file" && (basename.includes("credential") || basename.includes("secret"));
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function uniqueSecretTargetId(value: unknown, fallback: string, usedIds: Set<string>): string {
  const normalized = text(value, fallback).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 72) || fallback;
  let id = normalized;
  let suffix = 2;
  while (usedIds.has(id)) {
    const tail = `-${suffix}`;
    id = `${normalized.slice(0, 80 - tail.length)}${tail}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function adtVerificationIdentity(config: AdtConfig): string {
  return JSON.stringify({
    id: config.id,
    systemId: config.systemId,
    instanceNumber: config.instanceNumber,
    url: config.url,
    client: config.client,
    username: config.username,
    language: config.language,
    sslMode: config.sslMode,
    secretRef: config.credential.secretRef,
    secretUpdatedAt: config.credential.updatedAt
  });
}

function modelVerificationIdentity(provider: ProjectConfig["apiProviders"][number]): string {
  return JSON.stringify({
    id: provider.id,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    catalogMode: provider.catalogMode,
    testModelId: provider.testModelId,
    manualModelIds: provider.manualModelIds,
    secretRef: provider.credential.secretRef,
    secretUpdatedAt: provider.credential.updatedAt
  });
}

function safeId(value: unknown, fallback: string): string {
  const raw = text(value, fallback);
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function safeMessageModelId(value: unknown): string {
  if (typeof value !== "string") return "local-workflow";
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(trimmed)) return "local-workflow";
  if (/bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9_-]{16,}|api[_-]?key|token|secret|password|secure-store|https?:\/\//i.test(trimmed)) {
    return "local-workflow";
  }
  return trimmed;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function providerType(value: unknown): ProjectConfig["apiProviders"][number]["providerType"] {
  return value === "anthropic-compatible" || value === "deepseek" || value === "custom" ? value : "openai-compatible";
}

function modelCatalogMode(value: unknown): NonNullable<ProjectConfig["apiProviders"][number]["catalogMode"]> {
  void value;
  return "remote-with-manual-fallback";
}

export function isChatCapableModel(model: ModelSummary | undefined): boolean {
  if (!model?.capabilities.includes("chat")) return false;
  return !/(embedding|embed|rerank|moderation|image|imagine|video|sora|nano-banana|tts|speech|audio|whisper)/i.test(model.id);
}

function normalizedManualModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(normalized)) return null;
  if (/bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9_-]{16,}|api[_-]?key|token|secret|password/i.test(normalized)) return null;
  return normalized;
}

function normalizeManualModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizedManualModelId).filter((item): item is string => item !== null)));
}

function modelVerificationMode(value: unknown): ProjectConfig["apiProviders"][number]["lastVerificationMode"] {
  return value === "fake" || value === "http" ? value : null;
}

function adtVerificationMode(value: unknown): AdtVerificationMode | null {
  return value === "fake" || value === "adt" ? value : null;
}

function sslMode(value: unknown): ProjectConfig["adt"]["sslMode"] {
  return value === "strict" ? "strict" : "skip-certificate";
}

function sapEnvironment(value: unknown): ProjectConfig["adt"]["environment"] {
  return value === "development" || value === "quality" || value === "production" || value === "sandbox" ? value : "other";
}

function sapInstanceNumber(value: unknown): string {
  const normalized = text(value);
  if (!normalized) return "";
  if (!/^\d{2}$/.test(normalized)) throw new Error("SAP 实例编号必须是两位数字，例如 00 或 02。");
  return normalized;
}

function sapRoutingKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter(Boolean))]
    .slice(0, 20)
    .map((item) => item.slice(0, 40));
}

function sapConnectionIdentityComplete(systemId: string, instanceNumber: string, url: string): boolean {
  return /^[A-Z0-9]{3}$/.test(systemId) && (Boolean(instanceNumber) || /^https:\/\//i.test(url.trim()));
}

function codexIntegrationType(value: unknown): ProjectConfig["codex"]["integrationType"] {
  return value === "sdk" ? "sdk" : "cli";
}

function savedOrEmptyStatus(...values: string[]): ProjectConfig["adt"]["configStatus"] {
  return values.some((value) => value.length > 0) ? "saved" : "not-configured";
}

function normalizeConfigStatus(value: unknown, fallback: ConfigStatus): ConfigStatus {
  if (value === "not-configured" || value === "saved" || value === "pending-verification" || value === "verified" || value === "failed") {
    return value;
  }
  return fallback;
}

function nullableIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function normalizeLocalStorageConfig(
  project: ProjectSummary,
  input: unknown,
  fallback: ProjectConfig["localStorage"]
): ProjectConfig["localStorage"] {
  const candidate = input && typeof input === "object" ? input as Partial<ProjectConfig["localStorage"]> : {};
  const projectDir = `local-data/workbench/projects/${project.projectDir || project.id}`;
  const validCaseDirs = new Set(project.cases.map((caseItem) => {
    return `local-data/workbench/projects/${project.projectDir || project.id}/cases/${caseItem.folderName || caseItem.id}`;
  }));
  const candidateProjectDir = text(candidate.projectDir);
  const candidateCasesDir = text(candidate.casesDir);
  const canPreserveCaseDir = candidateProjectDir === projectDir && validCaseDirs.has(candidateCasesDir);
  return {
    ...fallback,
    projectDir,
    casesDir: canPreserveCaseDir ? candidateCasesDir : fallback.casesDir,
    status: normalizeConfigStatus(candidate.status, fallback.status),
    lastCheckedAt: nullableIso(candidate.lastCheckedAt) ?? fallback.lastCheckedAt,
    lastError: typeof candidate.lastError === "string" ? candidate.lastError.slice(0, 200) : null
  };
}

function adtConnectionFieldsChanged(previous: AdtConfig, next: AdtConfig): boolean {
  return (
    previous.systemId !== next.systemId ||
    previous.instanceNumber !== next.instanceNumber ||
    previous.url !== next.url ||
    previous.client !== next.client ||
    previous.username !== next.username ||
    previous.language !== next.language ||
    previous.sslMode !== next.sslMode
  );
}

function feishuConnectionFieldsChanged(previous: ProjectConfig, next: ProjectConfig): boolean {
  return (
    previous.feishu.appId !== next.feishu.appId ||
    previous.feishu.profile !== next.feishu.profile ||
    previous.feishu.cliPath !== next.feishu.cliPath
  );
}

function codexConnectionFieldsChanged(previous: ProjectConfig, next: ProjectConfig): boolean {
  return (
    previous.codex.integrationType !== next.codex.integrationType ||
    previous.codex.executablePath !== next.codex.executablePath
  );
}

function resetAdtConnectionVerification(adt: AdtConfig): void {
  adt.configStatus = savedOrEmptyStatus(adt.alias, adt.url, adt.client, adt.username);
  adt.connectionStatus = "pending-verification";
  adt.minimalReadStatus = "pending-verification";
  adt.lastVerificationMode = null;
  adt.lastCheckedAt = null;
}

function syncActiveAdtConnection(config: ProjectConfig): void {
  const active = config.adtConnections.find((item) => item.id === config.activeAdtConnectionId) ?? config.adtConnections[0];
  if (!active) {
    config.adtConnections = [{ ...config.adt }];
    config.activeAdtConnectionId = config.adt.id;
    return;
  }
  config.activeAdtConnectionId = active.id;
  config.adt = { ...active };
}

function resetAdtVerification(config: ProjectConfig, connectionId = config.activeAdtConnectionId): void {
  const target = config.adtConnections.find((item) => item.id === connectionId) ?? config.adt;
  resetAdtConnectionVerification(target);
  config.adtConnections = config.adtConnections.map((item) => item.id === target.id ? { ...target } : item);
  syncActiveAdtConnection(config);
}

function resetModelProviderVerification(provider: ProjectConfig["apiProviders"][number]): void {
  provider.models = [];
  provider.modelSyncStatus = "pending-verification";
  provider.chatTestStatus = "pending-verification";
  provider.lastVerificationMode = null;
  provider.verifiedModelIds = [];
  provider.lastVerifiedModelId = null;
  provider.lastCheckedAt = null;
}

function resetFeishuVerification(config: ProjectConfig): void {
  config.feishu.authStatus = "pending-verification";
  config.feishu.docPermissionStatus = "pending-verification";
  config.feishu.lastCheckedAt = null;
}

function resetCodexVerification(config: ProjectConfig): void {
  config.codex.cliStatus = "pending-verification";
  config.codex.version = "";
  config.codex.loginStatus = "pending-verification";
  config.codex.readonlyTaskStatus = "pending-verification";
  config.codex.lastCheckedAt = null;
}

function resetChangedVerification(previous: ProjectConfig | undefined, next: ProjectConfig): void {
  if (!previous) return;

  next.adtConnections.forEach((connection) => {
    const previousConnection = previous.adtConnections.find((item) => item.id === connection.id);
    if (!previousConnection || adtConnectionFieldsChanged(previousConnection, connection)) {
      resetAdtConnectionVerification(connection);
    }
  });
  syncActiveAdtConnection(next);

  next.apiProviders.forEach((provider) => {
    const previousProvider = previous.apiProviders.find((item) => item.id === provider.id);
    const manualCatalogChanged = JSON.stringify(previousProvider?.manualModelIds ?? []) !== JSON.stringify(provider.manualModelIds ?? []);
    if (
      !previousProvider ||
      previousProvider.baseUrl !== provider.baseUrl ||
      previousProvider.providerType !== provider.providerType ||
      (previousProvider.catalogMode ?? "remote") !== (provider.catalogMode ?? "remote") ||
      (previousProvider.testModelId ?? "") !== (provider.testModelId ?? "") ||
      manualCatalogChanged
    ) {
      resetModelProviderVerification(provider);
    }
  });

  if (feishuConnectionFieldsChanged(previous, next)) {
    resetFeishuVerification(next);
  }

  if (codexConnectionFieldsChanged(previous, next)) {
    resetCodexVerification(next);
  }
}

function preserveMainOwnedVerification(previous: ProjectConfig, next: ProjectConfig): void {
  next.adtConnections.forEach((connection) => {
    const previousConnection = previous.adtConnections.find((item) => item.id === connection.id);
    if (!previousConnection) {
      resetAdtConnectionVerification(connection);
      return;
    }
    connection.credential = previousConnection.credential;
    connection.configStatus = previousConnection.configStatus;
    connection.connectionStatus = previousConnection.connectionStatus;
    connection.minimalReadStatus = previousConnection.minimalReadStatus;
    connection.lastVerificationMode = previousConnection.lastVerificationMode;
    connection.lastCheckedAt = previousConnection.lastCheckedAt;
  });
  syncActiveAdtConnection(next);

  next.apiProviders.forEach((provider) => {
    const previousProvider = previous.apiProviders.find((item) => item.id === provider.id);
    if (!previousProvider) {
      resetModelProviderVerification(provider);
      return;
    }
    provider.credential = previousProvider.credential;
    provider.models = previousProvider.models;
    provider.modelSyncStatus = previousProvider.modelSyncStatus;
    provider.chatTestStatus = previousProvider.chatTestStatus;
    provider.lastVerificationMode = previousProvider.lastVerificationMode;
    provider.verifiedModelIds = previousProvider.verifiedModelIds ?? (previousProvider.lastVerifiedModelId ? [previousProvider.lastVerifiedModelId] : []);
    provider.lastVerifiedModelId = previousProvider.lastVerifiedModelId;
    provider.lastCheckedAt = previousProvider.lastCheckedAt;
  });

  next.feishu.credential = previous.feishu.credential;
  next.feishu.authStatus = previous.feishu.authStatus;
  next.feishu.docPermissionStatus = previous.feishu.docPermissionStatus;
  next.feishu.lastCheckedAt = previous.feishu.lastCheckedAt;

  next.codex.credential = previous.codex.credential;
  next.codex.cliStatus = previous.codex.cliStatus;
  next.codex.version = previous.codex.version;
  next.codex.loginStatus = previous.codex.loginStatus;
  next.codex.readonlyTaskStatus = previous.codex.readonlyTaskStatus;
  next.codex.lastCheckedAt = previous.codex.lastCheckedAt;
}

function resetSecretTargetVerification(config: ProjectConfig, target: ProjectSecretTarget): void {
  if (target.kind === "adt-password") {
    resetAdtVerification(config, target.connectionId);
    return;
  }
  if (target.kind === "api-key") {
    const provider = config.apiProviders.find((item) => item.id === target.providerId);
    if (provider) resetModelProviderVerification(provider);
    return;
  }
  if (target.kind === "feishu-token") {
    resetFeishuVerification(config);
    return;
  }
  resetCodexVerification(config);
}

function sapVersion(value: unknown): ProjectSummary["sapVersion"] {
  return value === "S4" || value === "ECC" ? value : "UNKNOWN";
}

function lifecycleSapVersion(value: unknown): CreateLocalProjectInput["sapVersion"] {
  if (value === "S4" || value === "ECC" || value === "UNKNOWN") {
    return value;
  }
  throw new Error("请选择 S4、ECC 或其他工作后再创建本地项目。");
}

function normalizeConnectionState(value: unknown): ProjectSummary["connectionState"] {
  const legacyLocalDemo = ["demo", "readonly"].join("-");
  const legacyNotChecked = ["not", ["ver", "ified"].join("")].join("-");
  if (value === legacyLocalDemo) return "local-demo";
  if (value === legacyNotChecked) return "not-checked";
  if (value === "local-demo" || value === "not-configured" || value === "not-checked") return value;
  return "not-checked";
}

function normalizeSecretHandle(value: unknown, kind: SecretKind): SecretHandle {
  if (value && typeof value === "object") {
    const candidate = value as Partial<SecretHandle>;
    if (candidate.state === "set-in-secure-store" && candidate.kind === kind) {
      return {
        secretRef: null,
        kind,
        store: "electron-safe-storage",
        state: "set-in-secure-store",
        updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null
      };
    }
  }
  return emptySecretHandle(kind);
}

function normalizeModels(value: unknown): ModelSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<ModelSummary>;
    const id = text(candidate.id);
    if (!id) return [];
    const capabilities = Array.isArray(candidate.capabilities)
      ? candidate.capabilities.filter((capability): capability is ModelSummary["capabilities"][number] => capability === "vision" || capability === "reasoning" || capability === "tools" || capability === "web" || capability === "free" || capability === "chat")
      : ["chat" as const];
    return [{
      id,
      displayName: text(candidate.displayName, id),
      capabilities,
      lastSeenAt: nullableIso(candidate.lastSeenAt) ?? nowIso()
    }];
  });
}

function isFakeModelExecutionHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api-demo.example.com" || host === "fake-models.local" || host === "fake-models.test";
  } catch {
    return false;
  }
}

function normalizeCaseStatus(value: unknown): CaseSummary["status"] {
  if (value === "solved" || value === "archived") return value;
  return "active";
}

function normalizeCaseMessage(value: unknown, caseId: string): CaseMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CaseMessage>;
  const role = candidate.role === "assistant" ? "assistant" : "user";
  const linkedFileIds = Array.isArray(candidate.linkedFileIds)
    ? candidate.linkedFileIds.filter((item): item is string => typeof item === "string" && item.length > 0 && !item.includes("..") && !/^[a-zA-Z]:[\\/]/.test(item))
    : [];
  return {
    id: safeId(candidate.id, `${role}-${Date.now()}`),
    caseId,
    agentTurnId: typeof candidate.agentTurnId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(candidate.agentTurnId) ? candidate.agentTurnId : undefined,
    role,
    content: text(candidate.content),
    taskMode: normalizeTaskMode(candidate.taskMode),
    modelId: safeMessageModelId(candidate.modelId),
    providerId: typeof candidate.providerId === "string" ? safeId(candidate.providerId, "") || undefined : undefined,
    actionId: normalizeCaseActionId(candidate.actionId),
    permissionModeUsed: normalizeActionPermissionMode(candidate.permissionModeUsed),
    linkedFileIds,
    createdAt: text(candidate.createdAt, nowIso())
  };
}

function normalizeDailyChatMessage(value: unknown, threadId: string): DailyChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DailyChatMessage>;
  const content = text(candidate.content);
  if (!content) return null;
  const role = candidate.role === "assistant" ? "assistant" : "user";
  return {
    id: safeId(candidate.id, `${role}-${Date.now()}`),
    threadId,
    agentTurnId: typeof candidate.agentTurnId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(candidate.agentTurnId) ? candidate.agentTurnId : undefined,
    role,
    content,
    modelId: safeMessageModelId(candidate.modelId),
    responseMode: candidate.responseMode === "model-success" || candidate.responseMode === "model-failed" ? candidate.responseMode : "local-record",
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : undefined,
    providerId: typeof candidate.providerId === "string" ? candidate.providerId : undefined,
    providerName: typeof candidate.providerName === "string" ? candidate.providerName : undefined,
    createdAt: text(candidate.createdAt, nowIso())
  };
}

function normalizeDailyChatThread(value: unknown, fallback: DailyChatThread): DailyChatThread {
  const candidate = value && typeof value === "object" ? value as Partial<DailyChatThread> : fallback;
  const id = safeId(candidate.id, fallback.id);
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.flatMap((message) => {
        const normalized = normalizeDailyChatMessage(message, id);
        return normalized ? [normalized] : [];
      })
    : fallback.messages.map((message) => ({ ...message, threadId: id }));
  return {
    id,
    title: text(candidate.title, fallback.title).slice(0, 80) || fallback.title,
    status: normalizeConversationThreadStatus(candidate.status),
    createdAt: text(candidate.createdAt, fallback.createdAt),
    updatedAt: text(candidate.updatedAt, fallback.updatedAt),
    lastOpenedAt: text(candidate.lastOpenedAt, fallback.lastOpenedAt),
    archivedAt: typeof candidate.archivedAt === "string" ? candidate.archivedAt : null,
    removedAt: typeof candidate.removedAt === "string" ? candidate.removedAt : null,
    messages
  };
}

function normalizeConversationThreadStatus(value: unknown): ConversationThreadStatus {
  if (value === "archived" || value === "removed") return value;
  return "active";
}

function normalizeWorkThread(value: unknown, fallback: WorkThread): WorkThread {
  const candidate = value && typeof value === "object" ? value as Partial<WorkThread> : fallback;
  const id = safeId(candidate.id, fallback.id);
  const caseId = safeId(candidate.caseId, fallback.caseId);
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.flatMap((message) => {
        const normalized = normalizeCaseMessage(message, caseId);
        return normalized ? [normalized] : [];
      })
    : fallback.messages.map((message) => ({ ...message, caseId }));
  return {
    id,
    projectId: safeId(candidate.projectId, fallback.projectId),
    caseId,
    title: text(candidate.title, fallback.title).slice(0, 120) || fallback.title,
    status: normalizeConversationThreadStatus(candidate.status),
    createdAt: text(candidate.createdAt, fallback.createdAt),
    updatedAt: text(candidate.updatedAt, fallback.updatedAt),
    lastOpenedAt: text(candidate.lastOpenedAt, fallback.lastOpenedAt),
    archivedAt: typeof candidate.archivedAt === "string" ? candidate.archivedAt : null,
    removedAt: typeof candidate.removedAt === "string" ? candidate.removedAt : null,
    messages
  };
}

function normalizeKnowledgeReferenceSourceType(value: unknown): CaseKnowledgeReference["sourceType"] {
  if (value === "document-import" || value === "qa-import" || value === "manual") return value;
  return "case-candidate";
}

function normalizeCaseKnowledgeReferences(value: unknown): CaseKnowledgeReference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const references: CaseKnowledgeReference[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<CaseKnowledgeReference>;
    const itemId = safeId(candidate.itemId, "");
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    references.push({
      itemId,
      title: text(candidate.title).slice(0, 120),
      summary: text(candidate.summary).slice(0, 500),
      sourceType: normalizeKnowledgeReferenceSourceType(candidate.sourceType),
      sourceCaseId: typeof candidate.sourceCaseId === "string" ? safeId(candidate.sourceCaseId, "") || null : null,
      sourceFilePath: null,
      sapObjects: Array.isArray(candidate.sapObjects)
        ? candidate.sapObjects.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20)
        : [],
      publishedAt: typeof candidate.publishedAt === "string" ? candidate.publishedAt : null,
      attachedAt: text(candidate.attachedAt, nowIso())
    });
  }
  return references;
}

function normalizeCaseSummary(value: unknown, projectId: string, fallback: CaseSummary): CaseSummary {
  const candidate = value && typeof value === "object" ? value as Partial<CaseSummary> : fallback;
  const id = safeId(candidate.id, fallback.id);
  const folderName = safeId(candidate.folderName || candidate.caseDir || id, id);
  const folderSource = candidate.folderSource === "linked-local" ? "linked-local" : "managed";
  const linkedFolderName = folderSource === "linked-local"
    ? text(candidate.linkedFolderName).replace(/[\\/]/g, "").trim().slice(0, 120) || null
    : null;
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.flatMap((message) => {
        const normalized = normalizeCaseMessage(message, id);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id,
    projectId,
    title: text(candidate.title, fallback.title),
    status: normalizeCaseStatus(candidate.status),
    caseDir: folderName,
    summary: text(candidate.summary, fallback.summary),
    createdAt: text(candidate.createdAt, fallback.createdAt),
    updatedAt: text(candidate.updatedAt, nowIso()),
    lastOpenedAt: text(candidate.lastOpenedAt, nowIso()),
    folderName,
    folderSource,
    linkedFolderName,
    currentSummary: text(candidate.currentSummary, text(candidate.summary, fallback.currentSummary)),
    knowledgeReferences: normalizeCaseKnowledgeReferences(candidate.knowledgeReferences),
    messages
  };
}

function reconcileCaseKnowledgeReferences(project: ProjectSummary): ProjectSummary {
  const knowledgeById = new Map(project.knowledge.items.map((item) => [item.id, item]));
  return {
    ...project,
    cases: project.cases.map((caseItem) => {
      const seen = new Set<string>();
      const knowledgeReferences: CaseKnowledgeReference[] = [];
      for (const persistedReference of caseItem.knowledgeReferences) {
        if (seen.has(persistedReference.itemId)) continue;
        const item = knowledgeById.get(persistedReference.itemId);
        if (!item || item.projectId !== project.id || item.status !== "published") continue;
        try {
          knowledgeReferences.push(createCaseKnowledgeReference(item, persistedReference.attachedAt));
          seen.add(persistedReference.itemId);
        } catch {
          continue;
        }
      }
      return {
        ...caseItem,
        knowledgeReferences
      };
    })
  };
}

function caseReferenceFingerprint(state: StoredState): unknown {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  return projects.map((project) => ({
    id: project.id,
    cases: Array.isArray(project.cases) ? project.cases.map((caseItem) => ({
      id: caseItem.id,
      knowledgeReferences: Array.isArray(caseItem.knowledgeReferences) ? caseItem.knowledgeReferences : []
    })) : []
  }));
}

function projectVisibilityFingerprint(state: StoredState): unknown {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  return projects.map((project) => ({
    id: project.id,
    isVisible: project.isVisible !== false,
    visibleOrder: typeof project.visibleOrder === "number" ? project.visibleOrder : 1
  }));
}

function chatThreadFingerprint(state: StoredState): unknown {
  const threads = Array.isArray(state.chatThreads) ? state.chatThreads : [];
  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    status: thread.status,
    messageCount: Array.isArray(thread.messages) ? thread.messages.length : 0
  }));
}

function workThreadFingerprint(state: StoredState): unknown {
  const threads = Array.isArray(state.workThreads) ? state.workThreads : [];
  return threads.map((thread) => ({
    id: thread.id,
    projectId: thread.projectId,
    caseId: thread.caseId,
    title: thread.title,
    status: thread.status,
    messageCount: Array.isArray(thread.messages) ? thread.messages.length : 0
  }));
}

function projectConfigMigrationFingerprint(state: StoredState): unknown {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  return projects.map((project) => ({
    id: project.id,
    schemaVersion: project.config?.schemaVersion,
    projectDir: project.config?.localStorage?.projectDir,
    casesDir: project.config?.localStorage?.casesDir,
    adtConnections: Array.isArray(project.config?.adtConnections) ? project.config.adtConnections.map((connection) => ({
      id: connection.id,
      systemId: connection.systemId,
      instanceNumber: connection.instanceNumber,
      url: connection.url,
      client: connection.client,
      connectionStatus: connection.connectionStatus,
      minimalReadStatus: connection.minimalReadStatus,
      lastVerificationMode: connection.lastVerificationMode
    })) : []
  }));
}

function selectAgentConversationHistory(
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>
): Array<{ ref: string; role: "user" | "assistant"; content: string; createdAt: string }> {
  const selected: Array<{ ref: string; role: "user" | "assistant"; content: string; createdAt: string }> = [];
  let totalChars = 0;
  for (const message of [...messages].reverse()) {
    const content = message.content.replace(/\u0000/g, "").trim().slice(0, 12_000);
    if (!content || selected.length >= 240 || totalChars + content.length > 160_000) continue;
    selected.unshift({
      ref: `message:${message.id}`,
      role: message.role,
      content,
      createdAt: message.createdAt
    });
    totalChars += content.length;
  }
  return selected;
}

export class WorkspaceStore {
  private readonly workspaceRoot: string;
  private readonly statePath: string;
  private readonly stateBackupPath: string;
  private readonly localFolderBindingsPath: string;
  private readonly database: DatabaseService;
  private databaseInitialized = false;
  private transactionRecoveryComplete = false;
  private stateWriteQueue: Promise<void> = Promise.resolve();
  private startupNotice: string | null = null;
  private readonly adtVerificationSequences = new Map<string, number>();
  private readonly modelVerificationSequences = new Map<string, number>();

  constructor(repoRoot: string) {
    this.workspaceRoot = path.join(repoRoot, "local-data", "workbench");
    this.statePath = path.join(this.workspaceRoot, "app-state.json");
    this.stateBackupPath = path.join(this.workspaceRoot, "app-state.backup.json");
    this.localFolderBindingsPath = path.join(this.workspaceRoot, "local-folder-bindings.json");
    this.database = new DatabaseService(this.workspaceRoot);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async inspectLocalTaskFolder(selectedPath: string): Promise<LocalTaskFolderBindingInput> {
    if (typeof selectedPath !== "string" || !path.isAbsolute(selectedPath) || selectedPath.startsWith("\\\\")) {
      throw new Error("请选择此电脑上的本地文件夹。网络共享目录暂不支持绑定。");
    }
    const resolvedPath = path.resolve(selectedPath);
    const stats = await fs.lstat(resolvedPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("所选路径不是普通本地文件夹，已停止绑定。");
    }
    const realPath = await fs.realpath(resolvedPath);
    if (realPath === path.parse(realPath).root) {
      throw new Error("不能把整个磁盘根目录绑定为任务文件夹，请选择一个具体目录。");
    }
    const workspaceRealPath = await fs.realpath(this.workspaceRoot).catch(() => path.resolve(this.workspaceRoot));
    const lowerRealPath = realPath.toLowerCase();
    const lowerWorkspacePath = workspaceRealPath.toLowerCase();
    if (
      lowerRealPath === lowerWorkspacePath ||
      lowerRealPath.startsWith(`${lowerWorkspacePath}${path.sep}`) ||
      lowerWorkspacePath.startsWith(`${lowerRealPath}${path.sep}`)
    ) {
      throw new Error("不能绑定工作台自身目录或其上级目录，请选择独立的业务文件夹。");
    }
    const sensitiveSegments = new Set([
      "windows",
      "system32",
      "program files",
      "program files (x86)",
      "programdata",
      "appdata",
      "$recycle.bin",
      "system volume information",
      ".ssh",
      ".aws",
      ".azure",
      ".gnupg"
    ]);
    const pathSegments = realPath.split(/[\\/]+/).map((segment) => segment.toLowerCase()).filter(Boolean);
    if (pathSegments.some((segment) => sensitiveSegments.has(segment))) {
      throw new Error("所选目录属于系统或凭据敏感位置，不能绑定到任务。");
    }
    const folderName = path.basename(realPath).trim();
    if (!folderName) throw new Error("无法识别所选文件夹名称，请重新选择。");
    return { folderPath: realPath, folderName: folderName.slice(0, 120) };
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.stateWriteQueue;
    let release: () => void = () => undefined;
    this.stateWriteQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  beginAdtVerification(projectId: string, connectionId: string): number {
    const key = `${projectId}\u0000${connectionId}`;
    const sequence = (this.adtVerificationSequences.get(key) ?? 0) + 1;
    this.adtVerificationSequences.set(key, sequence);
    return sequence;
  }

  beginModelProviderVerification(projectId: string, providerId: string): number {
    const key = `${projectId}\u0000${providerId}`;
    const sequence = (this.modelVerificationSequences.get(key) ?? 0) + 1;
    this.modelVerificationSequences.set(key, sequence);
    return sequence;
  }

  async getState(): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const state = await this.loadOrCreateState();
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async reconcileInterruptedAgentTurns(records: AgentInterruptedTurnRecovery[]): Promise<{ projected: string[]; committed: string[]; unmatched: string[] }> {
    return this.runExclusive(async () => {
      const state = await this.loadOrCreateState();
      const projected: string[] = [];
      const committed: string[] = [];
      const unmatched: string[] = [];
      const touchedWorkThreads = new Set<string>();

      for (const record of records.slice(0, 100)) {
        const messageId = `agent-recovery-${record.turnId}`;
        if (record.scope === "chat") {
          const thread = state.chatThreads.find((item) => item.id === record.legacyThreadId);
          if (!thread) {
            unmatched.push(record.turnId);
            continue;
          }
          const decision = decideInterruptedTurnProjection(thread.messages, record.turnId);
          if (!thread.messages.some((message) => message.id === messageId)) {
            thread.messages.push({
              ...createDailyChatMessage("assistant", thread.id, decision.notice, "runtime-recovery", { responseMode: "local-record" }),
              id: messageId,
              createdAt: record.startedAt
            });
            thread.updatedAt = nowIso();
          }
          (decision.committed ? committed : projected).push(record.turnId);
          continue;
        }

        const thread = state.workThreads.find((item) => item.id === record.legacyThreadId);
        const project = thread && record.projectId === thread.projectId
          ? state.projects.find((item) => item.id === thread.projectId)
          : undefined;
        const caseItem = project && record.caseId === thread?.caseId
          ? project.cases.find((item) => item.id === thread.caseId)
          : undefined;
        if (!thread || !project || !caseItem) {
          unmatched.push(record.turnId);
          continue;
        }
        const decision = decideInterruptedTurnProjection(thread.messages, record.turnId);
        if (!thread.messages.some((message) => message.id === messageId)) {
          thread.messages.push({
            ...createCaseMessage("assistant", caseItem.id, decision.notice, "problem-analysis", "runtime-recovery", [], null, "request_approval"),
            id: messageId,
            createdAt: record.startedAt
          });
          thread.updatedAt = nowIso();
          caseItem.messages = thread.messages.map((message) => ({ ...message, caseId: caseItem.id }));
          caseItem.updatedAt = thread.updatedAt;
          touchedWorkThreads.add(thread.id);
        }
        (decision.committed ? committed : projected).push(record.turnId);
      }

      if (projected.length > 0 || committed.length > 0) {
        await this.saveState(state);
        for (const threadId of touchedWorkThreads) {
          const thread = state.workThreads.find((item) => item.id === threadId);
          const project = thread ? state.projects.find((item) => item.id === thread.projectId) : undefined;
          const caseItem = project?.cases.find((item) => item.id === thread?.caseId);
          if (thread && project && caseItem) {
            await this.writeCaseMarkdown(state, caseItem, buildCaseMaintenanceArtifacts(project, caseItem), thread.id);
          }
        }
      }
      return { projected, committed, unmatched };
    });
  }

  async createDemoProject(): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const state = await this.loadOrCreateState();
      const existing = state.projects.find((project) => project.id === DEMO_PROJECT_ID);
      if (!existing) {
        state.projects.unshift(demoProject());
      }
      state.activeProjectId = DEMO_PROJECT_ID;
      state.activeCaseId = DEMO_CASE_ID;
      const project = state.projects.find((item) => item.id === DEMO_PROJECT_ID);
      const caseItem = project?.cases.find((item) => item.id === DEMO_CASE_ID);
      if (project && caseItem) {
        let thread = state.workThreads.find((item) => item.projectId === project.id && item.caseId === caseItem.id);
        if (!thread) {
          thread = createWorkThreadRecord(project.id, caseItem, caseItem.title, state.workThreads.map((item) => item.id));
          state.workThreads.unshift(thread);
        }
        state.activeWorkThreadId = thread.id;
        syncProjectLocalStorage(project, caseItem);
        await this.writeProjectMetadata(project);
      }
      await this.saveState(state);
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async createDemoCase(): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const state = await this.loadOrCreateState();
      const project = this.ensureDemoProject(state);
      if (!project.cases.some((item) => item.id === DEMO_CASE_ID)) {
        project.cases.unshift(demoCase());
      }
      state.activeProjectId = DEMO_PROJECT_ID;
      state.activeCaseId = DEMO_CASE_ID;
      const caseItem = project.cases.find((item) => item.id === DEMO_CASE_ID);
      if (caseItem) {
        let thread = state.workThreads.find((item) => item.projectId === project.id && item.caseId === caseItem.id);
        if (!thread) {
          thread = createWorkThreadRecord(project.id, caseItem, caseItem.title, state.workThreads.map((item) => item.id));
          state.workThreads.unshift(thread);
        }
        state.activeWorkThreadId = thread.id;
        syncProjectLocalStorage(project, caseItem);
        await this.writeProjectMetadata(project);
      }
      await this.saveState(state);
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async createLocalProject(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const projectInput = parseCreateLocalProjectInput(input);
      const state = await this.loadOrCreateState();
      const project = createLocalProjectRecord(
        projectInput,
        state.projects.map((item) => item.id),
        Math.max(0, ...state.projects.map((item) => item.visibleOrder)) + 1
      );
      const firstCase = project.cases[0];
      if (firstCase) {
        syncProjectLocalStorage(project, firstCase);
      }
      state.projects.unshift(project);
      const workThread = createWorkThreadRecord(project.id, project.cases[0], project.cases[0]?.title ?? "新任务", state.workThreads.map((item) => item.id));
      state.workThreads.unshift(workThread);
      state.activeProjectId = project.id;
      state.activeCaseId = project.cases[0]?.id ?? "";
      state.activeWorkThreadId = workThread.id;
      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async createLocalCase(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const caseInput = parseCreateLocalCaseInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === caseInput.projectId);
      if (!project) {
        throw new Error("目标 Project 已不存在。");
      }
      const caseItem = createLocalCaseRecord(project.id, caseInput.title, project.cases.map((item) => item.id));
      project.cases.unshift(caseItem);
      const workThread = createWorkThreadRecord(project.id, caseItem, caseInput.title, state.workThreads.map((item) => item.id));
      state.workThreads.unshift(workThread);
      project.updatedAt = nowIso();
      syncProjectLocalStorage(project, caseItem);
      state.activeProjectId = project.id;
      state.activeCaseId = caseItem.id;
      state.activeWorkThreadId = workThread.id;
      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async createWorkThread(input: unknown, localFolder?: LocalTaskFolderBindingInput): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const threadInput = parseCreateWorkThreadInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === threadInput.projectId);
      if (!project || project.isVisible === false) throw new Error("目标 Project 已不存在或已隐藏。");
      let caseItem: CaseSummary | undefined;
      if (threadInput.folderMode === "existing") {
        if (localFolder) {
          const registry = await this.readLocalTaskFolderBindingRegistry();
          const existingBinding = registry.bindings.find((item) =>
            item.projectId === project.id && item.folderPath.toLowerCase() === localFolder.folderPath.toLowerCase()
          );
          caseItem = existingBinding ? project.cases.find((item) => item.id === existingBinding.caseId) : undefined;
          if (!caseItem) {
            caseItem = createLocalCaseRecord(project.id, localFolder.folderName, project.cases.map((item) => item.id));
            caseItem.folderSource = "linked-local";
            caseItem.linkedFolderName = localFolder.folderName;
            project.cases.unshift(caseItem);
          }
        } else {
          caseItem = project.cases.find((item) => item.id === threadInput.caseId);
          if (!caseItem) throw new Error("选择的工作文件夹已不存在。");
        }
      } else {
        caseItem = createLocalCaseRecord(project.id, threadInput.folderName ?? threadInput.title, project.cases.map((item) => item.id));
        project.cases.unshift(caseItem);
      }
      const thread = createWorkThreadRecord(project.id, caseItem, threadInput.title, state.workThreads.map((item) => item.id));
      thread.messages = [];
      caseItem.messages = thread.messages.map((message) => ({ ...message }));
      state.workThreads.unshift(thread);
      state.activeProjectId = project.id;
      state.activeCaseId = caseItem.id;
      state.activeWorkThreadId = thread.id;
      project.updatedAt = nowIso();
      syncProjectLocalStorage(project, caseItem);
      await this.ensureCaseFiles(state);
      await this.writeCaseMarkdown(state, caseItem, buildCaseMaintenanceArtifacts(project, caseItem), thread.id);
      if (localFolder) {
        await this.upsertLocalTaskFolderBinding(project.id, caseItem.id, localFolder);
      }
      await this.saveState(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async switchWorkThread(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const { threadId } = parseSwitchWorkThreadInput(input);
      const state = await this.loadOrCreateState();
      const thread = state.workThreads.find((item) => item.id === threadId);
      if (!thread || thread.status !== "active") throw new Error("任务会话已归档、移除或不存在。");
      const project = state.projects.find((item) => item.id === thread.projectId);
      const caseItem = project?.cases.find((item) => item.id === thread.caseId);
      if (!project || !caseItem || project.isVisible === false) throw new Error("任务绑定的 Project 或工作文件夹已不可用。");
      thread.lastOpenedAt = nowIso();
      caseItem.messages = thread.messages.map((message) => ({ ...message, caseId: caseItem.id }));
      caseItem.lastOpenedAt = thread.lastOpenedAt;
      state.activeProjectId = project.id;
      state.activeCaseId = caseItem.id;
      state.activeWorkThreadId = thread.id;
      syncProjectLocalStorage(project, caseItem);
      await this.ensureCaseFiles(state);
      await this.writeCaseMarkdown(state, caseItem, buildCaseMaintenanceArtifacts(project, caseItem), thread.id);
      await this.saveState(state);
      return this.withFiles(state);
    });
  }

  async updateConversationThreadStatus(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const statusInput = parseUpdateConversationThreadStatusInput(input);
      const state = await this.loadOrCreateState();
      const threads = statusInput.scope === "work" ? state.workThreads : state.chatThreads;
      const thread = threads.find((item) => item.id === statusInput.threadId);
      if (!thread) throw new Error("会话已不存在。");
      const changedAt = nowIso();
      thread.status = statusInput.status;
      thread.updatedAt = changedAt;
      thread.archivedAt = statusInput.status === "archived" ? changedAt : null;
      thread.removedAt = statusInput.status === "removed" ? changedAt : null;

      if (statusInput.scope === "work" && state.activeWorkThreadId === thread.id && statusInput.status !== "active") {
        let next = state.workThreads.find((item) => item.id !== thread.id && item.status === "active");
        if (!next) {
          const current = thread as WorkThread;
          const project = state.projects.find((item) => item.id === current.projectId);
          const caseItem = project?.cases.find((item) => item.id === current.caseId);
          if (!project || !caseItem) throw new Error("无法为当前任务建立后续会话。");
          next = createWorkThreadRecord(project.id, caseItem, "新任务", state.workThreads.map((item) => item.id));
          next.messages = [];
          state.workThreads.unshift(next);
        }
        state.activeWorkThreadId = next.id;
        state.activeProjectId = next.projectId;
        state.activeCaseId = next.caseId;
        const nextCase = state.projects.find((item) => item.id === next!.projectId)?.cases.find((item) => item.id === next!.caseId);
        if (nextCase) nextCase.messages = (next as WorkThread).messages.map((message) => ({ ...message, caseId: nextCase.id }));
      }
      if (statusInput.scope === "chat" && state.activeChatThreadId === thread.id && statusInput.status !== "active") {
        let next = state.chatThreads.find((item) => item.id !== thread.id && item.status === "active");
        if (!next) {
          next = createLocalChatThreadRecord({}, state.chatThreads.map((item) => item.id));
          state.chatThreads.unshift(next);
        }
        state.activeChatThreadId = next.id;
      }
      if (statusInput.scope === "work") {
        const activeThread = state.workThreads.find((item) => item.id === state.activeWorkThreadId && item.status === "active");
        const activeProject = activeThread ? state.projects.find((item) => item.id === activeThread.projectId) : undefined;
        const activeCase = activeProject?.cases.find((item) => item.id === activeThread?.caseId);
        if (activeThread && activeProject && activeCase) {
          await this.writeCaseMarkdown(state, activeCase, buildCaseMaintenanceArtifacts(activeProject, activeCase), activeThread.id);
        }
      }
      await this.saveState(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async createDailyChatThread(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const chatInput = parseCreateDailyChatThreadInput(input);
      const state = await this.loadOrCreateState();
      const thread = createLocalChatThreadRecord(chatInput, state.chatThreads.map((item) => item.id));
      state.chatThreads.unshift(thread);
      state.activeChatThreadId = thread.id;
      await this.saveState(state);
      return this.withFiles(state);
    });
  }

  async switchDailyChatThread(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const { threadId } = parseSwitchDailyChatThreadInput(input);
      const state = await this.loadOrCreateState();
      const thread = state.chatThreads.find((item) => item.id === threadId);
      if (!thread || thread.status !== "active") {
        throw new Error("日常对话已归档、移除或不存在。");
      }
      thread.lastOpenedAt = nowIso();
      state.activeChatThreadId = thread.id;
      await this.saveState(state);
      return this.withFiles(state);
    });
  }

  async appendDailyChatMessage(input: unknown, assistantReply?: DailyChatAssistantReply, agentTurnId?: string): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const chatInput = parseAppendDailyChatMessageInput(input);
      if (!chatInput.content) {
        throw new Error("请输入日常对话内容。");
      }
      const state = await this.loadOrCreateState();
      const visibleThreadId = state.activeChatThreadId;
      let thread = state.chatThreads.find((item) => item.id === (chatInput.threadId ?? state.activeChatThreadId));
      if (!thread || thread.status !== "active") {
        if (chatInput.threadId) throw new Error("发送时选择的日常对话已归档、移除或不存在，回复未写入其他会话。");
        thread = createLocalChatThreadRecord({ title: chatTitleFromContent(chatInput.content) }, state.chatThreads.map((item) => item.id));
        state.chatThreads.unshift(thread);
      }
      const targetRemainsVisible = visibleThreadId === thread.id || !state.chatThreads.some((item) => item.id === visibleThreadId && item.status === "active");
      const hadUserMessages = thread.messages.some((item) => item.role === "user");
      const actualModelId = assistantReply?.responseMode === "model-success"
        ? assistantReply.modelId
        : chatInput.modelId ?? "local-chat";
      const actualProjectId = assistantReply?.responseMode === "model-success" ? assistantReply.projectId : chatInput.projectId;
      const actualProviderId = assistantReply?.responseMode === "model-success" ? assistantReply.providerId : chatInput.providerId;
      const userMessage = createDailyChatMessage(
        "user",
        thread.id,
        chatInput.content,
        actualModelId,
        actualProjectId && actualProviderId
          ? {
              projectId: actualProjectId,
              providerId: actualProviderId,
              providerName: assistantReply?.providerName
            }
          : { responseMode: "local-record" },
        agentTurnId
      );
      const assistantMessage = createDailyChatMessage(
        "assistant",
        thread.id,
        assistantReply?.content ?? "已作为独立日常对话回复：当前不会关联项目、案件或文件夹，也不会读取 SAP、生成案件文件或发布飞书。需要沉淀成果时，可以新建正式案件。",
        assistantReply?.modelId ?? "local-chat",
        assistantReply
          ? {
              responseMode: assistantReply.responseMode,
              projectId: assistantReply.projectId,
              providerId: assistantReply.providerId,
              providerName: assistantReply.providerName
            }
          : { responseMode: "local-record" },
        agentTurnId
      );
      thread.messages.push(userMessage, assistantMessage);
      if (!hadUserMessages) {
        thread.title = chatTitleFromContent(chatInput.content);
      }
      thread.updatedAt = nowIso();
      if (targetRemainsVisible) {
        thread.lastOpenedAt = thread.updatedAt;
        state.activeChatThreadId = thread.id;
      }
      await this.saveState(state);
      return this.withFiles(state);
    });
  }

  async getDailyChatModelHistory(
    threadId: string | undefined,
    projectId: string,
    providerId: string,
    modelId: string
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const state = await this.loadOrCreateState();
    const thread = state.chatThreads.find((item) => item.id === (threadId ?? state.activeChatThreadId));
    if (!thread) return [];
    void modelId;
    const candidates = thread.messages
      .filter((message) => (
        message.projectId === projectId
        && message.providerId === providerId
        && (message.role === "user" || (message.role === "assistant" && message.responseMode === "model-success"))
      ))
      .slice(-12);
    const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
    let totalLength = 0;
    for (const message of candidates.reverse()) {
      const content = message.content.trim().slice(0, 4000);
      if (!content || totalLength + content.length > 12000) continue;
      selected.unshift({ role: message.role, content });
      totalLength += content.length;
    }
    return selected;
  }

  async getDailyChatAgentContextHistory(
    threadId: string | undefined,
    projectId: string,
    providerId: string
  ): Promise<Array<{ ref: string; role: "user" | "assistant"; content: string; createdAt: string }>> {
    const state = await this.loadOrCreateState();
    const thread = state.chatThreads.find((item) => item.id === (threadId ?? state.activeChatThreadId));
    if (!thread) return [];
    return selectAgentConversationHistory(thread.messages.filter((message) => (
      message.projectId === projectId
      && message.providerId === providerId
      && (message.role === "user" || (message.role === "assistant" && message.responseMode === "model-success"))
    )));
  }

  async getWorkAgentContextHistory(
    threadId: string
  ): Promise<Array<{ ref: string; role: "user" | "assistant"; content: string; createdAt: string }>> {
    const state = await this.loadOrCreateState();
    const thread = state.workThreads.find((item) => item.id === threadId && item.status === "active");
    if (!thread) return [];
    return selectAgentConversationHistory(thread.messages);
  }

  async switchProject(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const { projectId } = parseSwitchProjectInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error("目标 Project 已不存在。");
      }
      if (project.isVisible === false) {
        throw new Error("目标 Project 已从左侧栏隐藏。");
      }
      const activeCase = [...project.cases].sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())[0];
      if (!activeCase) {
        throw new Error("目标 Project 没有可用的本地工作文件夹。");
      }
      const activeThread = state.workThreads.find((item) => item.projectId === project.id && item.caseId === activeCase.id && item.status === "active")
        ?? state.workThreads.find((item) => item.projectId === project.id && item.status === "active");
      const targetCase = activeThread ? project.cases.find((item) => item.id === activeThread.caseId) ?? activeCase : activeCase;
      targetCase.lastOpenedAt = nowIso();
      if (activeThread) {
        activeThread.lastOpenedAt = targetCase.lastOpenedAt;
        targetCase.messages = activeThread.messages.map((message) => ({ ...message, caseId: targetCase.id }));
        state.activeWorkThreadId = activeThread.id;
      }
      syncProjectLocalStorage(project, targetCase);
      state.activeProjectId = project.id;
      state.activeCaseId = targetCase.id;
      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async hideProjectFromSidebar(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const { projectId } = parseHideProjectFromSidebarInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error("目标 Project 已不存在。");
      }
      if (project.isVisible === false) {
        throw new Error("目标 Project 已经从左侧栏隐藏。");
      }
      const visibleProjects = state.projects.filter((item) => item.isVisible !== false);
      if (visibleProjects.length <= 1) {
        throw new Error("左侧栏至少需要保留一个可见 Project。");
      }

      project.isVisible = false;
      project.updatedAt = nowIso();

      if (state.activeProjectId === project.id) {
        const nextProject = state.projects
          .filter((item) => item.id !== project.id && item.isVisible !== false)
          .sort((a, b) => a.visibleOrder - b.visibleOrder || a.name.localeCompare(b.name, "zh-CN"))[0];
        if (!nextProject) {
          throw new Error("没有可切换的可见 Project。");
        }
        const nextCase = [...nextProject.cases].sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())[0];
        if (!nextCase) {
          throw new Error("目标 Project 没有可用的本地工作文件夹。");
        }
        nextCase.lastOpenedAt = nowIso();
        syncProjectLocalStorage(nextProject, nextCase);
        state.activeProjectId = nextProject.id;
        state.activeCaseId = nextCase.id;
        await this.writeProjectMetadata(nextProject);
      }

      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async restoreProjectToSidebar(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const { projectId } = parseRestoreProjectToSidebarInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error("目标 Project 已不存在。");
      }
      if (project.isVisible !== false) {
        throw new Error("目标 Project 已经显示在左侧栏中。");
      }
      project.isVisible = true;
      project.visibleOrder = Math.max(0, ...state.projects.filter((item) => item.isVisible !== false).map((item) => item.visibleOrder)) + 1;
      project.updatedAt = nowIso();
      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async switchCase(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const { projectId, caseId } = parseSwitchCaseInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error("目标 Project 已不存在。");
      }
      if (project.isVisible === false) {
        throw new Error("目标 Project 已从左侧栏隐藏。");
      }
      const caseItem = project.cases.find((item) => item.id === caseId);
      if (!caseItem) {
        throw new Error("目标工作文件夹不属于所选 Project。");
      }
      caseItem.lastOpenedAt = nowIso();
      const workThread = state.workThreads.find((item) => item.projectId === project.id && item.caseId === caseItem.id && item.status === "active");
      if (workThread) {
        workThread.lastOpenedAt = caseItem.lastOpenedAt;
        caseItem.messages = workThread.messages.map((message) => ({ ...message, caseId: caseItem.id }));
        state.activeWorkThreadId = workThread.id;
      }
      syncProjectLocalStorage(project, caseItem);
      state.activeProjectId = project.id;
      state.activeCaseId = caseItem.id;
      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async bindCaseWorkflowTarget(input: unknown): Promise<CaseWorkflowInput> {
    const workflowInput = parseCaseWorkflowInput(input);
    const state = await this.loadOrCreateState();
    const { project, caseItem, workThread } = this.resolveWorkflowTarget(state, workflowInput);
    return {
      ...workflowInput,
      projectId: project.id,
      caseId: caseItem.id,
      threadId: workThread.id
    };
  }

  async appendMessage(input: unknown, safeModelDraft?: SafeModelDraftRun, codexAssist?: CodexCaseAssistRun, agentTurnId?: string): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const workflowInput = parseCaseWorkflowInput(input);
    if (!workflowInput.content) {
      throw new Error("请输入案件问题或补充说明。");
    }
    assertNoSensitiveCaseContent(workflowInput.content);

    const state = await this.loadOrCreateState();
    const visibleSelection = {
      projectId: state.activeProjectId,
      caseId: state.activeCaseId,
      threadId: state.activeWorkThreadId
    };
    const { project, caseItem: currentCase, workThread } = this.resolveWorkflowTarget(state, workflowInput);
    const targetRemainsVisible = visibleSelection.threadId === workThread.id;
    currentCase.messages = workThread.messages.map((message) => ({ ...message, caseId: currentCase.id }));
    await this.ensureCaseFilesForCase(state, project, currentCase);
    const existingFiles = this.flattenCaseFileNodes(await this.readCaseTreeForCase(project, currentCase))
      .filter((node) => node.kind === "file")
      .map((node) => ({
        relativePath: node.relativePath,
        purpose: node.purpose,
        sizeBytes: node.sizeBytes,
        updatedAt: node.updatedAt
      }));
    const runtimeContext = { existingFiles };
    syncProjectLocalStorage(project, currentCase);
    const persistedModelId = safeModelDraft ? safeMessageModelId(safeModelDraft.modelId) : "local-workflow";
    const persistedProviderId = safeModelDraft ? workflowInput.providerId : undefined;
    const persistedModelDraft = safeModelDraft ? { ...safeModelDraft, modelId: persistedModelId } : undefined;
    const persistedInput = { ...workflowInput, modelId: persistedModelId };
    const previewFiles = buildCaseWorkflowArtifacts(project, currentCase, persistedInput, persistedModelDraft, codexAssist, runtimeContext).generatedFiles;
    const userMessage = createCaseMessage("user", currentCase.id, persistedInput.content, persistedInput.taskMode, persistedInput.modelId, [], persistedInput.actionId ?? null, persistedInput.permissionMode, persistedProviderId, agentTurnId);
    const assistantMessage = createCaseMessage(
      "assistant",
      currentCase.id,
      buildAssistantContent(persistedInput, previewFiles, persistedModelDraft, codexAssist),
      persistedInput.taskMode,
      persistedModelId,
      previewFiles.map((file) => file.relativePath),
      persistedInput.actionId ?? null,
      persistedInput.permissionMode,
      persistedProviderId,
      agentTurnId
    );

    currentCase.messages.push(userMessage, assistantMessage);
    currentCase.currentSummary = `已按「${persistedInput.taskMode === "abap-development" ? "ABAP 开发" : persistedInput.taskMode === "document-generation" ? "文档生成" : persistedInput.taskMode === "flow-diagram" ? "画流程图" : "问题分析"}」模式处理最新输入，并生成 ${previewFiles.length} 个本地案件文件。`;
    currentCase.summary = currentCase.currentSummary;
    currentCase.updatedAt = nowIso();
    currentCase.lastOpenedAt = nowIso();
    const artifacts = buildCaseWorkflowArtifacts(project, currentCase, persistedInput, persistedModelDraft, codexAssist, runtimeContext);
    currentCase.currentSummary = artifacts.currentSummary;
    currentCase.summary = artifacts.currentSummary;
    project.knowledge = appendKnowledgeCandidatesFromCase(project, currentCase, artifacts.generatedFiles);
    workThread.messages = currentCase.messages.map((message) => ({ ...message, caseId: currentCase.id }));
    workThread.updatedAt = nowIso();
    if (targetRemainsVisible) workThread.lastOpenedAt = workThread.updatedAt;
    project.updatedAt = nowIso();
    await this.writeCaseMarkdown(state, currentCase, artifacts, workThread.id);
    await this.writeProjectKnowledge(project);
    if (targetRemainsVisible) {
      state.activeWorkThreadId = workThread.id;
      state.activeProjectId = project.id;
      state.activeCaseId = currentCase.id;
    } else {
      const visibleThread = state.workThreads.find((thread) => thread.id === visibleSelection.threadId && thread.status === "active");
      const visibleProject = visibleThread
        ? state.projects.find((item) => item.id === visibleThread.projectId)
        : state.projects.find((item) => item.id === visibleSelection.projectId);
      const visibleCase = visibleProject?.cases.find((item) => item.id === (visibleThread?.caseId ?? visibleSelection.caseId));
      if (visibleThread && visibleProject && visibleCase) {
        visibleCase.messages = visibleThread.messages.map((message) => ({ ...message, caseId: visibleCase.id }));
        state.activeProjectId = visibleProject.id;
        state.activeCaseId = visibleCase.id;
        state.activeWorkThreadId = visibleThread.id;
      }
    }
    await this.saveState(state);
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async getCaseFiles(): Promise<CaseFileNode[]> {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    return this.readCaseTree(state);
  }

  async previewCurrentCaseFile(input: unknown): Promise<CaseFilePreview> {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    const relativePath = this.assertPreviewRelativePath(input);
    this.assertSafePreviewFileType(relativePath);

    const caseFiles = await this.readCaseTree(state);
    const node = this.findCaseFileNode(caseFiles, relativePath);
    if (!node || node.kind !== "file") {
      throw new Error("只能预览当前案件文件树中已经存在的文件。");
    }

    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureFallbackProject(state);
    const caseItem = this.getActiveCase(state);
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    const target = this.assertInsideWorkspace(path.join(caseRoot, relativePath));
    const resolvedCaseRoot = await fs.realpath(caseRoot);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("只能预览当前案件里的普通文本文件。");
    }
    if (stat.size > MAX_PREVIEW_FILE_BYTES) {
      throw new Error("文件超过预览大小限制，请在本地案件文件夹中打开。");
    }

    const realTarget = await fs.realpath(target);
    if (realTarget !== resolvedCaseRoot && !realTarget.startsWith(`${resolvedCaseRoot}${path.sep}`)) {
      throw new Error("文件真实路径超出当前案件目录，已阻止预览。");
    }

    const buffer = await fs.readFile(realTarget);
    const truncated = buffer.length > MAX_PREVIEW_BYTES;
    const previewBuffer = buffer.subarray(0, MAX_PREVIEW_BYTES);
    const redacted = redactPreviewContent(previewBuffer.toString("utf8"));
    return {
      relativePath,
      displayName: path.basename(relativePath),
      fileType: path.extname(relativePath).replace(".", "").toLowerCase() || "text",
      sizeBytes: stat.size,
      truncated,
      content: redacted.content,
      redactions: redacted.redactions
    };
  }

  async search(query: string): Promise<SearchResult[]> {
    const state = await this.loadOrCreateState();
    const files = await this.readCaseTree(state);
    const safeOutputSummaries = await this.readAllSafeOutputSummaries(state, files);
    const normalized = query.trim().toLowerCase();
    const threadResults: SearchResult[] = normalized ? [
      ...state.workThreads.flatMap((thread) => {
        const recentUserText = [...thread.messages].reverse().find((message) => message.role === "user")?.content.slice(0, 240) ?? "";
        const matchingMessage = [...thread.messages].reverse().find((message) => message.content.toLowerCase().includes(normalized));
        if (!thread.title.toLowerCase().includes(normalized) && !thread.id.toLowerCase().includes(normalized) && !matchingMessage) return [];
        const project = state.projects.find((item) => item.id === thread.projectId);
        const caseItem = project?.cases.find((item) => item.id === thread.caseId);
        return [{
          id: `work-thread-${thread.id}`,
          title: thread.title,
          type: "work-thread" as const,
          location: `${project?.name ?? "未知 Project"} · ${caseItem?.title ?? "未知工作文件夹"}`,
          snippet: matchingMessage?.content.slice(0, 240) || recentUserText || `任务会话 ID：${thread.id} · ${thread.status === "active" ? "使用中" : thread.status === "archived" ? "已归档" : "已移除"}`,
          projectId: thread.projectId,
          caseId: thread.caseId,
          threadId: thread.id,
          sourcePath: null
        }];
      }),
      ...state.chatThreads.flatMap((thread) => {
        const recentUserText = [...thread.messages].reverse().find((message) => message.role === "user")?.content.slice(0, 240) ?? "";
        const matchingMessage = [...thread.messages].reverse().find((message) => message.content.toLowerCase().includes(normalized));
        if (!thread.title.toLowerCase().includes(normalized) && !thread.id.toLowerCase().includes(normalized) && !matchingMessage) return [];
        return [{
          id: `chat-thread-${thread.id}`,
          title: thread.title,
          type: "chat-thread" as const,
          location: "独立日常对话",
          snippet: matchingMessage?.content.slice(0, 240) || recentUserText || `会话 ID：${thread.id} · ${thread.status === "active" ? "使用中" : thread.status === "archived" ? "已归档" : "已移除"}`,
          threadId: thread.id,
          caseId: null,
          sourcePath: null
        }];
      })
    ].slice(0, 6) : [];
    const indexedResults = await searchWorkbench(this.database, state.projects, files, safeOutputSummaries, query);
    return [...threadResults, ...indexedResults].slice(0, 12);
  }

  async prepareSafeModelDraftRequest(input: unknown, options: { allowFakeModelExecution?: boolean } = {}): Promise<PreparedSafeModelDraftRequest | null> {
    const workflowInput = parseCaseWorkflowInput(input);
    if (!workflowInput.content) return null;
    if (workflowInput.modelSelectionRejected) return null;
    assertNoSensitiveCaseContent(workflowInput.content);

    const state = await this.loadOrCreateState();
    const { project, caseItem: currentCase } = this.resolveWorkflowTarget(state, workflowInput);
    await this.ensureCaseFilesForCase(state, project, currentCase);
    const eligibleProviders = project.config.apiProviders.filter((item) => {
      const realEligible = item.lastVerificationMode === "http";
      const fakeEligible = options.allowFakeModelExecution === true && item.lastVerificationMode === "fake" && isFakeModelExecutionHost(item.baseUrl);
      return (
        item.enabled &&
        item.credential.state === "set-in-secure-store" &&
        item.modelSyncStatus === "verified" &&
        item.chatTestStatus === "verified" &&
        item.models.length > 0 &&
        (realEligible || fakeEligible)
      );
    });
    const provider = workflowInput.providerId
      ? eligibleProviders.find((item) => item.id === workflowInput.providerId)
      : eligibleProviders[0];
    const requestedModelId = workflowInput.modelId === "local-workflow" ? provider?.lastVerifiedModelId ?? provider?.models[0]?.id : workflowInput.modelId;
    const model = provider && requestedModelId
      ? provider.models.find((item) => item.id === requestedModelId) ?? null
      : null;
    if (!provider || !model || !isChatCapableModel(model)) return null;

    const files = await this.readCaseTreeForCase(project, currentCase);
    const safeOutputSummaries = await this.readSafeOutputSummariesForCase(project, currentCase, files);
    try {
      const context = buildSafeModelDraftContext({
        taskMode: workflowInput.taskMode,
        taskLabel: TASK_MODE_LABELS[workflowInput.taskMode],
        actionId: workflowInput.actionId,
        userInput: workflowInput.content,
        caseTitle: currentCase.title,
        caseSummary: currentCase.currentSummary,
        sapVersion: project.sapVersion,
        standardsSummary: standardsSummaryForTask(project.standards, workflowInput.taskMode),
        knowledgeReferences: currentCase.knowledgeReferences.map((reference) => ({
          title: reference.title,
          summary: reference.summary,
          sourceType: reference.sourceType,
          sapObjects: reference.sapObjects,
          publishedAt: reference.publishedAt,
          attachedAt: reference.attachedAt
        })),
        safeOutputSummaries: safeOutputSummaries.map((summary) => ({
          displayName: summary.displayName,
          fileType: summary.fileType,
          snippet: summary.snippet
        }))
      });

      return {
        projectId: project.id,
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.providerType,
        baseUrl: provider.baseUrl,
        modelId: model.id,
        context
      };
    } catch {
      return null;
    }
  }

  async prepareCodexCaseAssistRequest(input: unknown): Promise<PreparedCodexCaseAssistRequest | null> {
    const workflowInput = parseCaseWorkflowInput(input);
    if (!workflowInput.content || workflowInput.codexAssistEnabled !== true) return null;
    assertNoSensitiveCaseContent(workflowInput.content);

    const state = await this.loadOrCreateState();
    const { project, caseItem: currentCase } = this.resolveWorkflowTarget(state, workflowInput);
    await this.ensureCaseFilesForCase(state, project, currentCase);
    const codexConfig = project.config.codex;
    if (
      codexConfig.integrationType !== "cli" ||
      codexConfig.cliStatus !== "verified" ||
      codexConfig.loginStatus !== "verified"
    ) {
      throw new Error("Codex CLI 尚未完成安装与登录检查。请先到配置中心验证本机 Codex；工程试跑结果会在实际执行时单独提示。");
    }

    return {
      projectId: project.id,
      caseId: currentCase.id,
      integrationType: codexConfig.integrationType,
      executablePath: codexConfig.executablePath || "codex",
      workspaceRoot: this.workspaceRoot,
      context: {
        projectName: project.name,
        systemLabel: project.systemLabel,
        sapVersion: project.sapVersion,
        caseTitle: currentCase.title,
        caseSummary: currentCase.currentSummary,
        taskMode: workflowInput.taskMode,
        taskLabel: TASK_MODE_LABELS[workflowInput.taskMode],
        userInput: workflowInput.content,
        standardsSummary: standardsSummaryForTask(project.standards, workflowInput.taskMode)
      }
    };
  }

  async saveProjectConfig(projectId: string, config: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    if (Buffer.byteLength(JSON.stringify(config), "utf8") > MAX_PROJECT_CONFIG_BYTES) {
      throw new Error("项目配置超过 16 MB 安全预算，已停止保存；请减少异常模型目录或渠道数据后重试。");
    }
    this.assertNoRawSecretFields(config);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存配置。");
    }

    const previousConfig = project.config;
    const nextConfig = this.sanitizeProjectConfig(project, config, { preserveVerification: true });
    preserveMainOwnedVerification(previousConfig, nextConfig);
    resetChangedVerification(previousConfig, nextConfig);
    nextConfig.updatedAt = nowIso();
    project.config = nextConfig;
    const activeCase = project.id === state.activeProjectId
      ? project.cases.find((item) => item.id === state.activeCaseId) ?? project.cases[0]
      : project.cases[0];
    if (activeCase) {
      syncProjectLocalStorage(project, activeCase);
    }
    project.updatedAt = nowIso();

    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async getProjectConfig(projectId: string): Promise<ProjectConfig> {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法执行 ADT 只读验证。");
    }
    return project.config;
  }

  async getActiveProjectConfig(): Promise<{ projectId: string; caseId: string; threadId: string; config: ProjectConfig }> {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureFallbackProject(state);
    const caseItem = this.getActiveCase(state);
    return { projectId: project.id, caseId: caseItem.id, threadId: state.activeWorkThreadId, config: project.config };
  }

  async appendSapObjectEvidence(result: SapObjectEvidenceConnectorResult, targetCase?: { projectId: string; caseId: string; threadId: string }): Promise<SapObjectEvidenceResult> {
    return this.appendSapObjectEvidenceBatch([result], targetCase);
  }

  async appendSapObjectEvidenceBatch(results: SapObjectEvidenceConnectorResult[], targetCase?: { projectId: string; caseId: string; threadId: string }): Promise<SapObjectEvidenceResult> {
    if (results.length === 0 || results.length > 6) {
      throw new Error("SAP 只读证据批次必须包含 1 至 6 个已确认连接结果。");
    }
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    const fallbackCase = this.getActiveCase(state);
    const projectId = targetCase?.projectId ?? fallbackCase.projectId;
    const caseId = targetCase?.caseId ?? fallbackCase.id;
    const threadId = targetCase?.threadId ?? state.activeWorkThreadId;
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("SAP 证据目标 Project 已不存在。");
    }
    const currentCase = project.cases.find((item) => item.id === caseId);
    if (!currentCase) {
      throw new Error("SAP 证据目标工作文件夹已不存在。");
    }
    const targetThread = state.workThreads.find((thread) => thread.id === threadId && thread.status === "active");
    if (!targetThread || targetThread.projectId !== project.id || targetThread.caseId !== currentCase.id) {
      throw new Error("SAP 证据目标任务已归档、移除或与工作文件夹不一致，证据未写入其他任务。");
    }
    const visibleSelection = {
      projectId: state.activeProjectId,
      caseId: state.activeCaseId,
      threadId: state.activeWorkThreadId
    };
    currentCase.messages = targetThread.messages.map((message) => ({ ...message, caseId: currentCase.id }));
    syncProjectLocalStorage(project, currentCase);
    const records = results.map(normalizeSapObjectEvidenceResult);
    const generatedFiles = records.flatMap(renderSapObjectEvidenceFiles);
    const generatedPaths = generatedFiles.map((file) => file.relativePath);
    const summaries = records.map((record) => record.summary);
    const firstSummary = summaries[0];

    const assistantMessage = createCaseMessage(
      "assistant",
      currentCase.id,
      [
        `已补充 SAP 只读证据：${firstSummary.objectType} ${firstSummary.objectName}。`,
        "",
        `读取范围：${summaries.map((summary) => `${summary.systemId || summary.systemAlias} / Client ${summary.client}`).join("、")}。`,
        `读取时间：${summaries.map((summary) => summary.readAt).join("、")}。`,
        "",
        sapObjectEvidenceBoundary,
        "",
        "已生成文件：",
        ...generatedPaths.map((file) => `- ${file}`)
      ].join("\n"),
      "problem-analysis",
      "sap-readonly-evidence",
      generatedPaths
    );

    currentCase.messages.push(assistantMessage);
    targetThread.messages = currentCase.messages.map((message) => ({ ...message, caseId: currentCase.id }));
    targetThread.updatedAt = nowIso();
    currentCase.currentSummary = `已从 ${summaries.length} 个 SAP 登录连接加入 ${firstSummary.objectType} ${firstSummary.objectName} 的只读证据；用户审核后，案件结论可以引用这些证据。`;
    currentCase.summary = currentCase.currentSummary;
    currentCase.updatedAt = nowIso();
    currentCase.lastOpenedAt = nowIso();
    project.updatedAt = nowIso();

    const maintenance = buildCaseMaintenanceArtifacts(project, currentCase);
    const metadata = {
      ...(maintenance.metadata && typeof maintenance.metadata === "object" ? maintenance.metadata as Record<string, unknown> : {}),
      sapObjectEvidence: summaries,
      generatedFiles: generatedFiles.map((file) => ({ relativePath: file.relativePath, purpose: file.purpose })),
      workflowBoundary: sapObjectEvidenceBoundary,
      safety: {
        localOnly: true,
        sapWrite: "disabled",
        sapEvidenceRead: summaries.length > 1 ? "single-object-cross-system-readonly" : "single-object-readonly",
        externalModelCall: "not-run",
        feishuPublish: "not-run",
        secretsStoredInCaseFiles: false
      }
    };
    const artifacts: CaseWorkflowArtifacts = {
      ...maintenance,
      currentSummary: currentCase.currentSummary,
      generatedFiles,
      readme: [
        maintenance.readme,
        "",
        "## SAP 只读证据",
        "",
        ...generatedPaths.map((file) => `- ${file}`)
      ].join("\n"),
      timeline: [
        maintenance.timeline,
        ...summaries.map((summary) => `- ${summary.readAt}：已从 ${summary.systemId || summary.systemAlias} / Client ${summary.client} 加入 ${summary.objectType} ${summary.objectName} 的 SAP 只读证据。`)
      ].join("\n"),
      contextPack: [
        maintenance.contextPack,
        "",
        "## SAP 只读证据",
        "",
        ...summaries.map((summary) => `- ${summary.objectType} ${summary.objectName}，来源 ${summary.systemId || summary.systemAlias} / Client ${summary.client}，证据时间 ${summary.readAt}。`),
        "- 完整证据保留在受限的工作文件夹证据文件中，默认不发送给模型。"
      ].join("\n"),
      metadata
    };

    await this.writeCaseMarkdown(state, currentCase, artifacts, targetThread.id, true);
    const visibleThread = state.workThreads.find((thread) => thread.id === visibleSelection.threadId && thread.status === "active");
    const visibleProject = visibleThread ? state.projects.find((item) => item.id === visibleThread.projectId) : undefined;
    const visibleCase = visibleProject?.cases.find((item) => item.id === visibleThread?.caseId);
    if (visibleThread && visibleProject && visibleCase) {
      visibleCase.messages = visibleThread.messages.map((message) => ({ ...message, caseId: visibleCase.id }));
      state.activeProjectId = visibleProject.id;
      state.activeCaseId = visibleCase.id;
      state.activeWorkThreadId = visibleThread.id;
    }
    await this.refreshSearchIndex(state);
    return {
      state: await this.withFiles(state),
      summary: firstSummary,
      summaries,
      generatedFiles: generatedPaths
    };
    });
  }

  async prepareFeishuHandoff(): Promise<FeishuHandoffResult> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    const currentCase = this.getActiveCase(state);
    const project = state.projects.find((item) => item.id === currentCase.projectId) ?? this.ensureFallbackProject(state);
    syncProjectLocalStorage(project, currentCase);
    const files = await this.readCaseTree(state);
    const safeOutputSummaries = await this.readSafeOutputSummariesForCase(project, currentCase, files);
    if (safeOutputSummaries.length === 0) {
      throw new Error("当前工作文件夹还没有安全输出摘要。请先生成本地成果，再准备飞书交接草稿。");
    }

    const handoff = renderFeishuHandoffArtifacts({
      project,
      caseItem: currentCase,
      feishu: project.config.feishu,
      safeOutputSummaries
    });
    const generatedPaths = handoff.generatedFiles.map((file) => file.relativePath);

    await this.writeCaseGeneratedFiles(project, currentCase, handoff.generatedFiles);
    return {
      state: await this.withFiles(state),
      publishStatus: handoff.publishStatus,
      createdAt: handoff.createdAt,
      generatedFiles: generatedPaths,
      sourceFiles: handoff.sourceFiles,
      blockedActions: handoff.blockedActions
    };
    });
  }

  async getProjectStandards(projectId: string): Promise<ProjectStandardsView> {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法读取项目规范。");
    }
    return projectStandardsView(project.standards, project.sapVersion);
  }

  async getProjectKnowledge(projectId: string): Promise<ProjectKnowledgeView> {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法读取项目知识库。");
    }
    return projectKnowledgeView(project.knowledge);
  }

  async importKnowledgeLocalText(input: unknown): Promise<KnowledgeImportLocalTextResult> {
    return this.runExclusive(async () => {
    const importInput = parseKnowledgeImportLocalTextInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === importInput.projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法导入知识候选。");
    }
    const caseItem = project.cases.find((item) => item.id === state.activeCaseId && item.projectId === project.id) ?? project.cases[0];
    if (!caseItem) {
      throw new Error("当前项目没有可写入候选文件的本地案件。");
    }

    state.activeProjectId = project.id;
    state.activeCaseId = caseItem.id;
    caseItem.lastOpenedAt = nowIso();
    syncProjectLocalStorage(project, caseItem);
    const relativePath = `knowledge_candidates/${safeKnowledgeImportFileName(importInput.title)}`;
    const candidate = createImportedKnowledgeCandidate(project.id, importInput, relativePath);
    const item = { ...candidate.item, sourceCaseId: caseItem.id };
    await this.writeCaseGeneratedFiles(project, caseItem, [candidate.artifact]);
    const updatedAt = nowIso();
    project.knowledge = {
      ...project.knowledge,
      items: [item, ...project.knowledge.items],
      documentJobs: [candidate.job, ...project.knowledge.documentJobs].slice(0, 100),
      updatedAt
    };
    project.updatedAt = updatedAt;

    await this.saveState(state);
    await this.writeProjectKnowledge(project);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    await this.refreshSearchIndex(state);
    return {
      state: await this.withFiles(state),
      documentJobId: candidate.job.id,
      knowledgeItemId: item.id,
      generatedFiles: [relativePath]
    };
    });
  }

  async copyProjectStandardsTemplate(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const copyInput = parseCopyProjectStandardsInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法复制规范模板。");
    }

    project.standards = createProjectStandards(project.id, project.sapVersion, copyInput.templateId);
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectStandards(project);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  async copyProjectStandardsFromProject(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const copyInput = parseCopyProjectStandardsFromProjectInput(input);
    const state = await this.loadOrCreateState();
    const targetProject = state.projects.find((item) => item.id === projectId);
    const sourceProject = state.projects.find((item) => item.id === copyInput.sourceProjectId);
    if (!targetProject) {
      throw new Error("未找到当前项目，无法复制其他项目规范。");
    }
    if (!sourceProject) {
      throw new Error("未找到来源项目，无法复制规范。");
    }
    if (sourceProject.isVisible === false) {
      throw new Error("来源 Project 已从工作区隐藏。请先恢复后再复制规范。");
    }

    targetProject.standards = copyProjectStandardsFromProject(targetProject, sourceProject);
    targetProject.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectStandards(targetProject);
    await this.writeProjectMetadata(targetProject);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  async saveProjectStandards(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const saveInput = parseSaveProjectStandardsInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存项目规范。");
    }

    const nextStandards = updateProjectStandards(project.standards, saveInput);
    const changed = nextStandards !== project.standards;
    project.standards = nextStandards;
    if (changed) {
      project.updatedAt = nowIso();
    }
    await this.saveState(state);
    if (changed) {
      await this.writeProjectStandards(project);
      await this.writeProjectMetadata(project);
    }
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  async publishKnowledge(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const actionInput = parseKnowledgeActionInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法确认知识入库。");
    }

    project.knowledge = publishKnowledgeItem(project.knowledge, actionInput);
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectKnowledge(project);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async reviewKnowledgeForPublish(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const reviewInput = parseKnowledgeReviewInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法记录知识审核。");
    }

    project.knowledge = reviewKnowledgeItemForPublish(project.knowledge, reviewInput);
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectKnowledge(project);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async editKnowledgeCandidate(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const editInput = parseKnowledgeEditInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法编辑知识候选。");
    }

    project.knowledge = editKnowledgeCandidate(project.knowledge, editInput);
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectKnowledge(project);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async attachPublishedKnowledgeToCurrentCase(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const referenceInput = parseKnowledgeCaseReferenceInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project || project.id !== state.activeProjectId) {
      throw new Error("只能把当前项目的已发布知识加入当前案件上下文。");
    }
    const currentCase = this.getActiveCase(state);
    if (currentCase.projectId !== project.id) {
      throw new Error("当前案件不属于当前项目，无法引用知识。");
    }
    const knowledgeItem = project.knowledge.items.find((item) => item.id === referenceInput.itemId);
    if (!knowledgeItem) {
      throw new Error("未在当前项目中找到该知识项。");
    }
    if (knowledgeItem.projectId !== project.id) {
      throw new Error("该知识项不属于当前项目，无法加入当前案件上下文。");
    }
    const attachedAt = nowIso();
    const reference = createCaseKnowledgeReference(knowledgeItem, attachedAt);
    const existingReference = currentCase.knowledgeReferences.find((item) => item.itemId === reference.itemId);
    currentCase.knowledgeReferences = existingReference
      ? currentCase.knowledgeReferences.map((item) => item.itemId === reference.itemId ? { ...item, attachedAt: reference.attachedAt } : item)
      : [...currentCase.knowledgeReferences, reference];
    if (!existingReference) {
      currentCase.currentSummary = `${currentCase.currentSummary} 已引用已发布知识：${reference.title}。`.slice(0, 500);
      currentCase.summary = currentCase.currentSummary;
    }
    currentCase.updatedAt = attachedAt;
    currentCase.lastOpenedAt = attachedAt;
    project.updatedAt = attachedAt;
    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.writeCaseMarkdown(state, currentCase, buildCaseMaintenanceArtifacts(project, currentCase));
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async detachPublishedKnowledgeFromCurrentCase(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const referenceInput = parseKnowledgeCaseReferenceInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project || project.id !== state.activeProjectId) {
        throw new Error("只能调整当前 Project 的案件知识引用。");
      }
      const currentCase = this.getActiveCase(state);
      if (currentCase.projectId !== project.id) {
        throw new Error("当前工作文件夹不属于该 Project，无法解除知识引用。");
      }
      const existingReference = currentCase.knowledgeReferences.find((item) => item.itemId === referenceInput.itemId);
      if (!existingReference) return this.withFiles(state);

      currentCase.knowledgeReferences = currentCase.knowledgeReferences.filter((item) => item.itemId !== referenceInput.itemId);
      const changedAt = nowIso();
      currentCase.currentSummary = `${currentCase.currentSummary} 已解除知识引用：${existingReference.title}。`.slice(0, 500);
      currentCase.summary = currentCase.currentSummary;
      currentCase.updatedAt = changedAt;
      currentCase.lastOpenedAt = changedAt;
      project.updatedAt = changedAt;
      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.writeCaseMarkdown(state, currentCase, buildCaseMaintenanceArtifacts(project, currentCase));
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
    });
  }

  async markKnowledgeConflicted(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const actionInput = parseKnowledgeActionInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法标记知识冲突。");
    }

    project.knowledge = markKnowledgeItemConflicted(project.knowledge, actionInput);
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectKnowledge(project);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async expireKnowledge(projectId: string, input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const actionInput = parseKnowledgeActionInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法标记知识失效。");
    }

    project.knowledge = expireKnowledgeItem(project.knowledge, actionInput);
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectKnowledge(project);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
    });
  }

  async updateAdtVerification(projectId: string, connectionId: string, verificationSequence: number, expectedConnection: AdtConfig, report: AdtVerificationReport): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存 ADT 验证结果。");
    }

    const connection = project.config.adtConnections.find((item) => item.id === connectionId);
    if (!connection) {
      throw new Error("未找到本次验证对应的 SAP 连接，已停止保存验证结果。");
    }
    if (adtVerificationIdentity(connection) !== adtVerificationIdentity(expectedConnection)) {
      throw new Error("SAP 连接在验证期间已发生变化，本次旧验证结果未保存；请重新测试当前配置。");
    }
    if (this.adtVerificationSequences.get(`${projectId}\u0000${connectionId}`) !== verificationSequence) {
      throw new Error("当前 SAP 连接已有更新的验证请求，本次较早结果未保存。");
    }
    const configPassed = report.steps.some((item) => item.id === "config" && item.status === "passed");
    const verifiedConnection: AdtConfig = {
      ...connection,
      configStatus: configPassed ? "verified" : "failed",
      connectionStatus: report.connectionStatus,
      minimalReadStatus: report.minimalReadStatus,
      lastVerificationMode: report.mode,
      lastCheckedAt: report.checkedAt
    };
    if (report.ok && report.system.sslMode === "skip-certificate") {
      verifiedConnection.sslMode = "skip-certificate";
    }
    project.config.adtConnections = project.config.adtConnections.map((item) => item.id === connectionId ? verifiedConnection : item);
    if (project.config.activeAdtConnectionId === connectionId) {
      project.config.adt = { ...verifiedConnection };
    }
    project.config.updatedAt = nowIso();
    project.updatedAt = nowIso();

    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  async updateFeishuVerification(projectId: string, report: FeishuVerificationReport): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存飞书验证结果。");
    }

    project.config.feishu.authStatus = report.authStatus;
    project.config.feishu.docPermissionStatus = report.docPermissionStatus;
    project.config.feishu.lastCheckedAt = report.checkedAt;
    if (report.cli.cliPath && report.cli.cliPath !== "未检测到") {
      project.config.feishu.cliPath = report.cli.cliPath;
    }
    project.config.updatedAt = nowIso();
    project.updatedAt = nowIso();

    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  async getApiProviderConfig(projectId: string, providerId: string): Promise<ProjectConfig["apiProviders"][number]> {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法验证模型渠道。");
    }
    const provider = project.config.apiProviders.find((item) => item.id === providerId);
    if (!provider) {
      throw new Error("未找到当前 API 渠道，无法验证模型。");
    }
    return provider;
  }

  async updateModelProviderVerification(projectId: string, providerId: string, verificationSequence: number, expectedProvider: ProjectConfig["apiProviders"][number], report: ModelProviderVerificationReport): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存模型验证结果。");
    }
    const provider = project.config.apiProviders.find((item) => item.id === providerId);
    if (!provider) {
      throw new Error("未找到当前 API 渠道，无法保存模型验证结果。");
    }
    if (modelVerificationIdentity(provider) !== modelVerificationIdentity(expectedProvider)) {
      throw new Error("模型渠道在验证期间已发生变化，本次旧验证结果未保存；请重新测试当前配置。");
    }
    if (this.modelVerificationSequences.get(`${projectId}\u0000${providerId}`) !== verificationSequence) {
      throw new Error("当前模型渠道已有更新的验证请求，本次较早结果未保存。");
    }

    provider.models = report.models;
    provider.modelSyncStatus = report.modelSyncStatus;
    provider.chatTestStatus = report.chatTestStatus;
    provider.lastVerificationMode = report.mode;
    const availableModelIds = new Set(report.models.map((model) => model.id));
    const previouslyVerified = (provider.verifiedModelIds ?? []).filter((modelId) => availableModelIds.has(modelId));
    if (report.selectedModelId) {
      provider.verifiedModelIds = report.chatTestStatus === "verified"
        ? [...new Set([...previouslyVerified, report.selectedModelId])]
        : previouslyVerified.filter((modelId) => modelId !== report.selectedModelId);
    } else {
      provider.verifiedModelIds = previouslyVerified;
    }
    provider.lastVerifiedModelId = report.chatTestStatus === "verified" ? report.selectedModelId : provider.verifiedModelIds[0] ?? null;
    provider.lastCheckedAt = report.checkedAt;
    project.config.updatedAt = nowIso();
    project.updatedAt = nowIso();

    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  async updateCodexVerification(projectId: string, report: CodexVerificationReport): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存 Codex 验证结果。");
    }

    project.config.codex.integrationType = report.cli.integrationType;
    project.config.codex.executablePath = report.cli.executablePath && report.cli.executablePath !== "未检测到"
      ? report.cli.executablePath
      : project.config.codex.executablePath;
    project.config.codex.cliStatus = report.cliStatus;
    project.config.codex.version = report.cli.version;
    project.config.codex.loginStatus = report.loginStatus;
    project.config.codex.readonlyTaskStatus = report.readonlyTaskStatus;
    project.config.codex.lastCheckedAt = report.checkedAt;
    project.config.updatedAt = nowIso();
    project.updatedAt = nowIso();

    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  async prepareProjectSecret(projectId: string, targetInput: unknown): Promise<{ target: ProjectSecretTarget; existingRef: string | null }> {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存密钥。");
    }
    return this.resolveSecretTarget(project, targetInput);
  }

  async attachProjectSecret(projectId: string, targetInput: unknown, handle: SecretHandle): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存密钥引用。");
    }
    const { target } = this.resolveSecretTarget(project, targetInput);
    const safeHandle = normalizeSecretHandle(handle, target.kind);
    if (safeHandle.state !== "set-in-secure-store") {
      throw new Error("安全存储未返回有效密钥引用。");
    }

    if (target.kind === "adt-password") {
      const connectionId = target.connectionId ?? project.config.activeAdtConnectionId;
      project.config.adtConnections = project.config.adtConnections.map((item) => item.id === connectionId ? { ...item, credential: safeHandle } : item);
      syncActiveAdtConnection(project.config);
    } else if (target.kind === "api-key") {
      const provider = project.config.apiProviders.find((item) => item.id === target.providerId);
      if (!provider) {
        throw new Error("未找到当前 API 渠道，无法保存密钥引用。");
      }
      provider.credential = safeHandle;
    } else if (target.kind === "feishu-token") {
      project.config.feishu.credential = safeHandle;
    } else {
      project.config.codex.credential = safeHandle;
    }

    project.config = this.sanitizeProjectConfig(project, project.config, { preserveVerification: true });
    resetSecretTargetVerification(project.config, target);
    const activeCase = project.id === state.activeProjectId
      ? project.cases.find((item) => item.id === state.activeCaseId) ?? project.cases[0]
      : project.cases[0];
    if (activeCase) {
      syncProjectLocalStorage(project, activeCase);
    }
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
    });
  }

  private async loadOrCreateState(): Promise<StoredState> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    if (!this.transactionRecoveryComplete) {
      await this.recoverInterruptedTextBatchTransactions();
      this.transactionRecoveryComplete = true;
    }
    let raw: string;
    try {
      raw = await fs.readFile(this.statePath, "utf8");
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      const state = emptyState();
      await this.saveState(state);
      await this.initializeDatabase();
      return state;
    }
    let parsed: StoredState;
    let normalized: StoredState;
    try {
      const decoded = JSON.parse(raw) as unknown;
      const sourceVersion = storedStateVersion(decoded);
      if (sourceVersion < SCHEMA_VERSION) {
        await this.createPreUpgradeSnapshot(sourceVersion);
      }
      parsed = migrateStoredState(decoded);
      normalized = this.normalizeState(parsed);
      if (sourceVersion < SCHEMA_VERSION) {
        this.startupNotice = `本地数据已从版本 ${sourceVersion} 安全升级到版本 ${SCHEMA_VERSION}，升级前快照已保留在 backups 目录。`;
      }
    } catch (error) {
      if (error instanceof IncompatibleStateVersionError) throw error;
      const recoveryStamp = new Date().toISOString().replace(/[:.]/g, "-");
      const preservedPath = this.assertInsideWorkspace(path.join(this.workspaceRoot, `app-state.corrupt-${recoveryStamp}.json`));
      await fs.writeFile(preservedPath, raw, "utf8");
      try {
        const backupRaw = await fs.readFile(this.stateBackupPath, "utf8");
        const recovered = this.normalizeState(migrateStoredState(JSON.parse(backupRaw) as unknown));
        await this.writeJsonAtomic(this.statePath, recovered);
        this.startupNotice = `检测到本地状态文件损坏，已从有效备份恢复。原文件保留为 ${path.basename(preservedPath)}。`;
        await this.initializeDatabase();
        return recovered;
      } catch {
        throw new Error(`本地状态文件无法读取，原文件已保留为 ${path.basename(preservedPath)}。未找到可用备份，已停止写入以避免覆盖真实工作。`);
      }
    }
    const shouldPersistState = raw.includes("secure-store:sec_") || this.shouldPersistNormalizedState(parsed, normalized);
    if (shouldPersistState) {
      await this.saveState(normalized);
      await Promise.all(normalized.projects.map((project) => this.writeProjectMetadata(project)));
    } else {
      const activeProject = this.activeProjectFromState(normalized);
      if (await this.shouldPersistActiveProjectMetadata(activeProject)) {
        await this.writeProjectMetadata(activeProject);
      }
    }
    await this.initializeDatabase();
    return normalized;
  }

  private async createPreUpgradeSnapshot(sourceVersion: number): Promise<void> {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const snapshotRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "backups", `pre-upgrade-v${sourceVersion}-to-v${SCHEMA_VERSION}-${stamp}`));
    await fs.mkdir(snapshotRoot, { recursive: true });
    const entries = ["app-state.json", "app-state.backup.json", "app.db", "projects", "secure-store"];
    for (const entry of entries) {
      const source = this.assertInsideWorkspace(path.join(this.workspaceRoot, entry));
      const target = this.assertInsideWorkspace(path.join(snapshotRoot, entry));
      try {
        await fs.cp(source, target, { recursive: true, errorOnExist: true });
      } catch (error) {
        if (!isFileNotFound(error)) throw error;
      }
    }
    await this.writeJsonAtomic(path.join(snapshotRoot, "snapshot.json"), {
      schemaVersion: 1,
      kind: "pre-upgrade",
      sourceVersion,
      targetVersion: SCHEMA_VERSION,
      createdAt: nowIso(),
      containsEncryptedSecrets: true,
      note: "密钥仅以 Electron safeStorage 加密 blob 形式保留；没有导出明文。"
    });
  }

  private activeProjectFromState(state: StoredState): ProjectSummary {
    const requestedProject = state.projects.find((project) => project.id === state.activeProjectId);
    if (requestedProject && requestedProject.isVisible !== false) return requestedProject;
    return state.projects.find((project) => project.isVisible !== false) ?? state.projects[0] ?? starterProject();
  }

  private async shouldPersistActiveProjectMetadata(project: ProjectSummary): Promise<boolean> {
    const metadataPath = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id, "project.json"));
    try {
      const raw = await fs.readFile(metadataPath, "utf8");
      const parsed = JSON.parse(raw) as { id?: unknown; config?: Partial<ProjectConfig> };
      return parsed.id !== project.id ||
        parsed.config?.localStorage?.projectDir !== project.config.localStorage.projectDir ||
        parsed.config?.localStorage?.casesDir !== project.config.localStorage.casesDir;
    } catch (error) {
      if (isFileNotFound(error) || error instanceof SyntaxError) {
        return true;
      }
      throw error;
    }
  }

  private shouldPersistNormalizedState(parsed: StoredState, normalized: StoredState): boolean {
    if (parsed.schemaVersion !== normalized.schemaVersion) return true;
    if (parsed.activeProjectId !== normalized.activeProjectId || parsed.activeCaseId !== normalized.activeCaseId) return true;
    if (parsed.activeWorkThreadId !== normalized.activeWorkThreadId) return true;
    if (parsed.activeChatThreadId !== normalized.activeChatThreadId) return true;
    if (JSON.stringify(caseReferenceFingerprint(parsed)) !== JSON.stringify(caseReferenceFingerprint(normalized))) return true;
    if (JSON.stringify(projectVisibilityFingerprint(parsed)) !== JSON.stringify(projectVisibilityFingerprint(normalized))) return true;
    if (JSON.stringify(chatThreadFingerprint(parsed)) !== JSON.stringify(chatThreadFingerprint(normalized))) return true;
    if (JSON.stringify(workThreadFingerprint(parsed)) !== JSON.stringify(workThreadFingerprint(normalized))) return true;
    return JSON.stringify(projectConfigMigrationFingerprint(parsed)) !== JSON.stringify(projectConfigMigrationFingerprint(normalized));
  }

  private async saveState(state: StoredState): Promise<void> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    try {
      const currentRaw = await fs.readFile(this.statePath, "utf8");
      JSON.parse(currentRaw);
      await fs.copyFile(this.statePath, this.stateBackupPath);
    } catch (error) {
      if (!isFileNotFound(error) && !(error instanceof SyntaxError)) throw error;
    }
    await this.writeJsonAtomic(this.statePath, state);
    try {
      await fs.access(this.stateBackupPath);
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      await fs.copyFile(this.statePath, this.stateBackupPath);
    }
  }

  private async initializeDatabase(): Promise<void> {
    if (this.databaseInitialized) return;
    this.databaseInitialized = true;
    await this.database.initialize();
  }

  private async refreshSearchIndex(state: StoredState): Promise<void> {
    if (!this.database.getHealth().ok) return;
    try {
      const files = await this.readCaseTree(state);
      const safeOutputSummaries = await this.readAllSafeOutputSummaries(state, files);
      await this.database.replaceSearchDocuments(buildSearchDocuments(state.projects, files, safeOutputSummaries));
    } catch {
      return;
    }
  }

  private normalizeState(state: StoredState): StoredState {
    const fallbackChatThread = starterChatThread();
    const normalizedChatThreads = (Array.isArray(state.chatThreads) && state.chatThreads.length > 0 ? state.chatThreads : [fallbackChatThread])
      .map((thread, index) => normalizeDailyChatThread(thread, index === 0 ? fallbackChatThread : {
        ...fallbackChatThread,
        id: `chat-${index + 1}`,
        title: `日常对话 ${index + 1}`,
        messages: []
      }))
      .sort((a, b) => new Date(b.lastOpenedAt || b.updatedAt || b.createdAt).getTime() - new Date(a.lastOpenedAt || a.updatedAt || a.createdAt).getTime());
    if (!normalizedChatThreads.some((thread) => thread.status === "active")) {
      normalizedChatThreads.unshift(fallbackChatThread);
    }
    const requestedChatThreadId = safeId(state.activeChatThreadId, fallbackChatThread.id);
    const activeChatThread = normalizedChatThreads.find((thread) => thread.id === requestedChatThreadId && thread.status === "active")
      ?? normalizedChatThreads.find((thread) => thread.status === "active")
      ?? fallbackChatThread;
    const sourceProjects = Array.isArray(state.projects) ? state.projects : [];
    const normalizedProjects = (sourceProjects.length > 0 ? sourceProjects : [starterProject()]).map((project) => {
      const projectId = safeId(project.id, STARTER_PROJECT_ID);
      const projectDir = safeId(project.projectDir, projectId);
      const sourceCases = Array.isArray(project.cases) ? project.cases : [];
      const fallbackCase = starterCase(projectId);
      const cases = (sourceCases.length > 0 ? sourceCases : [fallbackCase]).map((caseItem, index) => normalizeCaseSummary(caseItem, projectId, index === 0 ? fallbackCase : {
        ...fallbackCase,
        id: `case-${index + 1}`,
        caseDir: `case-${index + 1}`,
        folderName: `case-${index + 1}`,
        title: `案件 ${index + 1}`
      }));
      const firstCase = cases[0] ?? normalizeCaseSummary(fallbackCase, projectId, fallbackCase);
      const normalizedProject: ProjectSummary = {
        id: projectId,
        name: text(project.name, "未命名 Project"),
        sapVersion: sapVersion(project.sapVersion),
        systemLabel: text(project.systemLabel, "Local"),
        projectDir,
        isVisible: typeof project.isVisible === "boolean" ? project.isVisible : true,
        visibleOrder: typeof project.visibleOrder === "number" ? project.visibleOrder : 1,
        connectionState: normalizeConnectionState(project.connectionState),
        createdAt: text(project.createdAt, nowIso()),
        updatedAt: text(project.updatedAt, nowIso()),
        config: project.config ?? defaultProjectConfig(projectId, projectDir, firstCase.folderName),
        standards: normalizeProjectStandards(projectId, sapVersion(project.sapVersion), (project as Partial<ProjectSummary>).standards),
        knowledge: normalizeProjectKnowledge(projectId, (project as Partial<ProjectSummary>).knowledge, projectId === DEMO_PROJECT_ID),
        cases
      };
      return reconcileCaseKnowledgeReferences({
        ...normalizedProject,
        config: this.sanitizeProjectConfig(normalizedProject, normalizedProject.config, { preserveVerification: true })
      });
    });
    const validCases = new Map(normalizedProjects.flatMap((project) => project.cases.map((caseItem) => [`${project.id}:${caseItem.id}`, { project, caseItem }] as const)));
    const sourceWorkThreads = Array.isArray(state.workThreads) ? state.workThreads : [];
    const normalizedWorkThreads = sourceWorkThreads.flatMap((thread, index) => {
      const raw = thread && typeof thread === "object" ? thread as Partial<WorkThread> : {};
      const target = typeof raw.projectId === "string" && typeof raw.caseId === "string"
        ? validCases.get(`${raw.projectId}:${raw.caseId}`)
        : undefined;
      if (!target) return [];
      const fallback = createWorkThreadRecord(
        target.project.id,
        target.caseItem,
        target.caseItem.title,
        [],
        index === 0 ? DEFAULT_WORK_THREAD_ID : `work-${index + 1}`
      );
      return [normalizeWorkThread(thread, fallback)];
    });
    const existingWorkIds = new Set(normalizedWorkThreads.map((thread) => thread.id));
    for (const project of normalizedProjects) {
      for (const caseItem of project.cases) {
        if (normalizedWorkThreads.some((thread) => thread.projectId === project.id && thread.caseId === caseItem.id)) continue;
        const preferredId = `work-${caseItem.id}`;
        const migrated = createWorkThreadRecord(project.id, caseItem, caseItem.title, existingWorkIds, preferredId);
        existingWorkIds.add(migrated.id);
        normalizedWorkThreads.push(migrated);
      }
    }
    if (!normalizedWorkThreads.some((thread) => thread.status === "active")) {
      const project = normalizedProjects[0];
      const caseItem = project?.cases[0];
      if (project && caseItem) {
        const fallback = createWorkThreadRecord(project.id, caseItem, "新任务", existingWorkIds);
        fallback.messages = [];
        normalizedWorkThreads.push(fallback);
      }
    }
    normalizedWorkThreads.sort((a, b) => new Date(b.lastOpenedAt || b.updatedAt || b.createdAt).getTime() - new Date(a.lastOpenedAt || a.updatedAt || a.createdAt).getTime());
    if (!normalizedProjects.some((project) => project.isVisible !== false) && normalizedProjects[0]) {
      normalizedProjects[0].isVisible = true;
    }
    const requestedProjectId = safeId(state.activeProjectId, STARTER_PROJECT_ID);
    const requestedProject = normalizedProjects.find((project) => project.id === requestedProjectId);
    const activeProject = requestedProject && requestedProject.isVisible !== false
      ? requestedProject
      : normalizedProjects
        .filter((project) => project.isVisible !== false)
        .sort((a, b) => a.visibleOrder - b.visibleOrder || a.name.localeCompare(b.name, "zh-CN"))[0] ?? requestedProject ?? normalizedProjects[0] ?? starterProject();
    const requestedCaseId = safeId(state.activeCaseId, activeProject.cases[0]?.id ?? STARTER_CASE_ID);
    const requestedWorkThreadId = safeId(state.activeWorkThreadId, "");
    const activeWorkThread = normalizedWorkThreads.find((thread) => thread.id === requestedWorkThreadId && thread.projectId === activeProject.id && thread.status === "active")
      ?? normalizedWorkThreads.find((thread) => thread.projectId === activeProject.id && thread.caseId === requestedCaseId && thread.status === "active")
      ?? normalizedWorkThreads.find((thread) => thread.projectId === activeProject.id && thread.status === "active")
      ?? normalizedWorkThreads.find((thread) => thread.status === "active");
    const effectiveProject = activeWorkThread
      ? normalizedProjects.find((project) => project.id === activeWorkThread.projectId) ?? activeProject
      : activeProject;
    const activeCase = effectiveProject.cases.find((caseItem) => caseItem.id === activeWorkThread?.caseId)
      ?? effectiveProject.cases.find((caseItem) => caseItem.id === requestedCaseId)
      ?? effectiveProject.cases[0]
      ?? starterCase(effectiveProject.id);
    if (activeWorkThread) activeCase.messages = activeWorkThread.messages.map((message) => ({ ...message, caseId: activeCase.id }));
    syncProjectLocalStorage(effectiveProject, activeCase);
    return {
      ...state,
      schemaVersion: SCHEMA_VERSION,
      activeProjectId: effectiveProject.id,
      activeCaseId: activeCase.id,
      activeWorkThreadId: activeWorkThread?.id ?? "",
      activeChatThreadId: activeChatThread.id,
      projects: normalizedProjects,
      workThreads: normalizedWorkThreads,
      chatThreads: normalizedChatThreads
    };
  }

  private assertNoRawSecretFields(value: unknown): void {
    const forbiddenKeys = new Set([
      "password",
      "passwd",
      "apikey",
      "api_key",
      "api-key",
      "apikeyvalue",
      "api_key_value",
      "api-key-value",
      "appsecret",
      "app_secret",
      "app-secret",
      "access_token",
      "accesstoken",
      "refreshtoken",
      "refresh_token",
      "token",
      "tokenvalue",
      "authorization",
      "cookie",
      "secretvalue"
    ]);
    const riskyValuePattern = /(bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9_-]{16,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{20,}|akia[0-9a-z]{16})/i;

    const visit = (current: unknown): void => {
      if (Array.isArray(current)) {
        current.forEach(visit);
        return;
      }
      if (current && typeof current === "object") {
        for (const [key, child] of Object.entries(current)) {
          const normalizedKey = key.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
          if (forbiddenKeys.has(normalizedKey)) {
            throw new Error("配置中包含疑似明文密钥字段，已阻止保存。");
          }
          visit(child);
        }
        return;
      }
      if (typeof current === "string" && riskyValuePattern.test(current)) {
        throw new Error("配置中包含疑似明文密钥内容，已阻止保存。");
      }
    };

    visit(value);
  }

  private resolveSecretTarget(project: ProjectSummary, targetInput: unknown): { target: ProjectSecretTarget; existingRef: string | null } {
    if (!targetInput || typeof targetInput !== "object") {
      throw new Error("密钥目标无效，无法保存。");
    }
    const target = targetInput as Partial<ProjectSecretTarget>;
    if (target.kind === "adt-password") {
      const connectionId = text(target.connectionId, project.config.activeAdtConnectionId);
      const connection = project.config.adtConnections.find((item) => item.id === connectionId);
      if (!connection) {
        throw new Error("未找到当前 SAP 连接，无法保存密码。");
      }
      return { target: { kind: "adt-password", connectionId }, existingRef: connection.credential.secretRef };
    }
    if (target.kind === "api-key") {
      const providerId = text(target.providerId);
      const provider = project.config.apiProviders.find((item) => item.id === providerId);
      if (!provider) {
        throw new Error("未找到当前 API 渠道，无法保存密钥。");
      }
      return { target: { kind: "api-key", providerId }, existingRef: provider.credential.secretRef };
    }
    if (target.kind === "feishu-token") {
      return { target: { kind: "feishu-token" }, existingRef: project.config.feishu.credential.secretRef };
    }
    if (target.kind === "codex-token") {
      return { target: { kind: "codex-token" }, existingRef: project.config.codex.credential.secretRef };
    }
    throw new Error("不支持的密钥类型，已阻止保存。");
  }

  private sanitizeProjectConfig(project: ProjectSummary, input: unknown, options: { preserveVerification?: boolean } = {}): ProjectConfig {
    const candidate = input && typeof input === "object" ? input as Partial<ProjectConfig> : {};
    const firstCase = project.cases[0] ?? starterCase(project.id);
    const fallback = defaultProjectConfig(project.id, project.projectDir || project.id, firstCase.folderName || firstCase.id);
    const candidateAdtConnections = Array.isArray(candidate.adtConnections) ? candidate.adtConnections : [];
    const usesLegacySingleAdt = candidateAdtConnections.length === 0;
    const rawAdtConnections = !usesLegacySingleAdt
      ? candidateAdtConnections.slice(0, 200)
      : [candidate.adt ?? fallback.adt];
    const feishu = candidate.feishu ?? fallback.feishu;
    const codex = candidate.codex ?? fallback.codex;
    const providers = Array.isArray(candidate.apiProviders) && candidate.apiProviders.length > 0 ? candidate.apiProviders : fallback.apiProviders;
    const existingConfig = project.config;

    const preserveVerification = options.preserveVerification === true;
    const configUpdatedAt = nullableIso(candidate.updatedAt) ?? nullableIso(existingConfig?.updatedAt) ?? fallback.updatedAt;
    const localStorage = normalizeLocalStorageConfig(project, candidate.localStorage, fallback.localStorage);
    const providerIds = new Set<string>();
    const adtIds = new Set<string>();
    const normalizedAdtIds = new Map<string, string>();
    const existingAdtConnections = existingConfig?.adtConnections?.length ? existingConfig.adtConnections : existingConfig?.adt ? [existingConfig.adt] : [];
    const adtConnections = rawAdtConnections.map((rawConnection, index): AdtConfig => {
      const id = uniqueSecretTargetId(rawConnection.id, index === 0 ? "adt-default" : `adt-${index + 1}`, adtIds);
      normalizedAdtIds.set(text(rawConnection.id, id), id);
      const existingConnection = existingAdtConnections.find((item) => item.id === id) ?? (usesLegacySingleAdt && index === 0 ? existingConfig?.adt : undefined);
      const alias = text(rawConnection.alias, fallback.adt.alias);
      const systemId = text(rawConnection.systemId).toUpperCase().slice(0, 3);
      const instanceNumber = sapInstanceNumber(rawConnection.instanceNumber);
      const url = text(rawConnection.url, fallback.adt.url);
      const client = text(rawConnection.client, fallback.adt.client);
      const username = text(rawConnection.username, fallback.adt.username);
      const language = text(rawConnection.language, fallback.adt.language).toUpperCase() || "ZH";
      const adtConfigStatus = savedOrEmptyStatus(alias, url, client, username);
      const preserveAdtVerification = preserveVerification && sapConnectionIdentityComplete(systemId, instanceNumber, url);
      return {
        id,
        alias,
        systemId,
        instanceNumber,
        environment: sapEnvironment(rawConnection.environment),
        usage: text(rawConnection.usage).slice(0, 80),
        routingKeywords: sapRoutingKeywords(rawConnection.routingKeywords),
        url,
        client,
        username,
        language,
        sslMode: sslMode(rawConnection.sslMode),
        readOnly: true,
        credential: normalizeSecretHandle(existingConnection?.credential, "adt-password"),
        configStatus: preserveAdtVerification ? normalizeConfigStatus(rawConnection.configStatus, adtConfigStatus) : adtConfigStatus,
        connectionStatus: preserveAdtVerification ? normalizeConfigStatus(rawConnection.connectionStatus, "pending-verification") : "pending-verification",
        minimalReadStatus: preserveAdtVerification ? normalizeConfigStatus(rawConnection.minimalReadStatus, "pending-verification") : "pending-verification",
        lastVerificationMode: preserveAdtVerification ? adtVerificationMode(rawConnection.lastVerificationMode) : null,
        lastCheckedAt: preserveAdtVerification ? nullableIso(rawConnection.lastCheckedAt) : null
      };
    });
    const requestedActiveAdtIdRaw = text(candidate.activeAdtConnectionId, text(candidate.adt?.id, adtConnections[0]?.id ?? "adt-default"));
    const requestedActiveAdtId = normalizedAdtIds.get(requestedActiveAdtIdRaw) ?? requestedActiveAdtIdRaw;
    const activeAdt = adtConnections.find((item) => item.id === requestedActiveAdtId) ?? adtConnections[0] ?? fallback.adt;

    return {
      schemaVersion: 3,
      projectId: project.id,
      updatedAt: configUpdatedAt,
      adt: { ...activeAdt },
      adtConnections,
      activeAdtConnectionId: activeAdt.id,
      feishu: {
        appId: text(feishu.appId, fallback.feishu.appId),
        profile: text(feishu.profile, fallback.feishu.profile),
        cliPath: text(feishu.cliPath, fallback.feishu.cliPath),
        credential: normalizeSecretHandle(existingConfig?.feishu?.credential, "feishu-token"),
        authStatus: preserveVerification ? normalizeConfigStatus(feishu.authStatus, "pending-verification") : "pending-verification",
        docPermissionStatus: preserveVerification ? normalizeConfigStatus(feishu.docPermissionStatus, "pending-verification") : "pending-verification",
        lastCheckedAt: preserveVerification ? nullableIso(feishu.lastCheckedAt) : null
      },
      apiProviders: providers.map((provider, index) => {
        const id = uniqueSecretTargetId(provider.id, `provider-${index + 1}`, providerIds);
        const name = text(provider.name, `API 渠道 ${index + 1}`);
        const baseUrl = text(provider.baseUrl);
        if (baseUrl) {
          let parsedBaseUrl: URL;
          try {
            parsedBaseUrl = new URL(baseUrl);
          } catch {
            throw new Error(`模型渠道“${name}”的 Base URL 格式无效。`);
          }
          if (parsedBaseUrl.protocol !== "https:") {
            throw new Error(`模型渠道“${name}”的 Base URL 必须使用 HTTPS。`);
          }
          if (parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
            throw new Error(`模型渠道“${name}”的 Base URL 不能包含账号、密码、查询参数或片段。`);
          }
        }
        const existingProvider = existingConfig?.apiProviders?.find((item) => item.id === id);
        const models = preserveVerification ? normalizeModels(provider.models) : [];
        const lastVerifiedModelId = preserveVerification && typeof provider.lastVerifiedModelId === "string" && models.some((model) => model.id === provider.lastVerifiedModelId)
          ? provider.lastVerifiedModelId
          : null;
        const verifiedModelIds = preserveVerification
          ? [...new Set([
              ...(Array.isArray(provider.verifiedModelIds) ? provider.verifiedModelIds : []),
              ...(lastVerifiedModelId ? [lastVerifiedModelId] : [])
            ])].filter((modelId): modelId is string => typeof modelId === "string" && models.some((model) => model.id === modelId))
          : [];
        return {
          id,
          name,
          providerType: providerType(provider.providerType),
          baseUrl,
          enabled: bool(provider.enabled, false),
          credential: normalizeSecretHandle(existingProvider?.credential, "api-key"),
          catalogMode: modelCatalogMode(provider.catalogMode),
          testModelId: normalizedManualModelId(provider.testModelId) ?? "",
          manualModelIds: normalizeManualModelIds(provider.manualModelIds),
          models,
          modelSyncStatus: preserveVerification ? normalizeConfigStatus(provider.modelSyncStatus, "pending-verification") : "pending-verification",
          chatTestStatus: preserveVerification ? normalizeConfigStatus(provider.chatTestStatus, "pending-verification") : "pending-verification",
          lastVerificationMode: preserveVerification ? modelVerificationMode(provider.lastVerificationMode) : null,
          verifiedModelIds,
          lastVerifiedModelId: lastVerifiedModelId ?? verifiedModelIds[0] ?? null,
          lastCheckedAt: preserveVerification ? nullableIso(provider.lastCheckedAt) : null
        };
      }),
      codex: {
        integrationType: codexIntegrationType(codex.integrationType),
        executablePath: text(codex.executablePath, fallback.codex.executablePath),
        credential: normalizeSecretHandle(existingConfig?.codex?.credential, "codex-token"),
        cliStatus: preserveVerification ? normalizeConfigStatus(codex.cliStatus, "pending-verification") : "pending-verification",
        version: text(codex.version),
        loginStatus: preserveVerification ? normalizeConfigStatus(codex.loginStatus, "pending-verification") : "pending-verification",
        readonlyTaskStatus: preserveVerification ? normalizeConfigStatus(codex.readonlyTaskStatus, "pending-verification") : "pending-verification",
        lastCheckedAt: preserveVerification ? nullableIso(codex.lastCheckedAt) : null
      },
      localStorage
    };
  }

  private async writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
    const safePath = this.assertInsideWorkspace(targetPath);
    const tempPath = `${safePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, safePath);
  }

  private async upsertLocalTaskFolderBinding(projectId: string, caseId: string, folder: LocalTaskFolderBindingInput): Promise<void> {
    const registry = await this.readLocalTaskFolderBindingRegistry();
    registry.bindings = registry.bindings.filter((item) => !(item.projectId === projectId && item.caseId === caseId));
    registry.bindings.push({
      projectId,
      caseId,
      folderPath: folder.folderPath,
      folderName: folder.folderName,
      createdAt: nowIso()
    });
    await this.writeJsonAtomic(this.localFolderBindingsPath, registry);
  }

  private async readLocalTaskFolderBindingRegistry(): Promise<LocalTaskFolderBindingRegistry> {
    let registry: LocalTaskFolderBindingRegistry = { schemaVersion: 1, bindings: [] };
    try {
      const parsed = JSON.parse(await fs.readFile(this.localFolderBindingsPath, "utf8")) as Partial<LocalTaskFolderBindingRegistry>;
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.bindings)) {
        registry = {
          schemaVersion: 1,
          bindings: parsed.bindings.filter((item): item is LocalTaskFolderBindingRecord => Boolean(
            item &&
            typeof item.projectId === "string" &&
            typeof item.caseId === "string" &&
            typeof item.folderPath === "string" &&
            typeof item.folderName === "string" &&
            typeof item.createdAt === "string"
          )).slice(-4999)
        };
      }
    } catch (error) {
      if (!isFileNotFound(error) && !(error instanceof SyntaxError)) throw error;
    }
    return registry;
  }

  private async writeTextAtomic(targetPath: string, content: string): Promise<void> {
    const safePath = this.assertInsideWorkspace(targetPath);
    const tempPath = `${safePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, safePath);
  }

  private ensureDemoProject(state: StoredState): ProjectSummary {
    let project = state.projects.find((item) => item.id === DEMO_PROJECT_ID);
    if (!project) {
      project = demoProject();
      state.projects.unshift(project);
    }
    return project;
  }

  private ensureFallbackProject(state: StoredState): ProjectSummary {
    const existing = state.projects.find((item) => item.id === state.activeProjectId) ?? state.projects[0];
    if (existing) return existing;
    const project = starterProject();
    state.projects.push(project);
    state.activeProjectId = project.id;
    state.activeCaseId = project.cases[0].id;
    return project;
  }

  private getActiveCase(state: StoredState): CaseSummary {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureFallbackProject(state);
    let caseItem = project.cases.find((item) => item.id === state.activeCaseId);
    if (!caseItem) {
      caseItem = starterCase(project.id);
      project.cases.unshift(caseItem);
      state.activeCaseId = caseItem.id;
    }
    return caseItem;
  }

  private resolveWorkflowTarget(state: StoredState, input: CaseWorkflowInput): { project: ProjectSummary; caseItem: CaseSummary; workThread: WorkThread } {
    const hasProjectId = Boolean(input.projectId);
    const hasCaseId = Boolean(input.caseId);
    if (hasProjectId !== hasCaseId) {
      throw new Error("案件请求必须同时指定 Project 和工作文件夹。");
    }

    const requestedThread = input.threadId
      ? state.workThreads.find((thread) => thread.id === input.threadId && thread.status === "active")
      : state.workThreads.find((thread) => thread.id === state.activeWorkThreadId && thread.status === "active");
    if (input.threadId && !requestedThread) throw new Error("发送时选择的任务会话已归档、移除或不存在。");

    if (!input.projectId || !input.caseId) {
      const workThread = requestedThread ?? state.workThreads.find((thread) => thread.status === "active");
      if (!workThread) throw new Error("当前没有可用任务会话，请先新建任务。");
      const project = state.projects.find((item) => item.id === workThread.projectId) ?? this.ensureFallbackProject(state);
      const caseItem = project.cases.find((item) => item.id === workThread.caseId) ?? this.getActiveCase(state);
      return { project, caseItem, workThread };
    }

    const project = state.projects.find((item) => item.id === input.projectId);
    if (!project) {
      throw new Error("发送时选择的 Project 已不存在，结果未写入其他位置。");
    }
    const caseItem = project.cases.find((item) => item.id === input.caseId && item.projectId === project.id);
    if (!caseItem) {
      throw new Error("发送时选择的工作文件夹已不存在，结果未写入其他位置。");
    }
    if (requestedThread && (requestedThread.projectId !== project.id || requestedThread.caseId !== caseItem.id)) {
      throw new Error("任务会话与发送时指定的 Project 或工作文件夹不一致，已阻止写入其他任务。");
    }
    const workThread = requestedThread
      ?? state.workThreads.find((thread) => thread.projectId === project.id && thread.caseId === caseItem.id && thread.status === "active");
    if (!workThread) throw new Error("发送时选择的任务会话已不存在，结果未写入其他位置。");
    return { project, caseItem, workThread };
  }

  private caseRoot(state: StoredState): string {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureFallbackProject(state);
    const caseItem = this.getActiveCase(state);
    return this.caseRootFor(project, caseItem);
  }

  private caseRootFor(project: ProjectSummary, caseItem: CaseSummary): string {
    const casesRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id, "cases"));
    return this.assertInsideCasesRoot(casesRoot, path.join(casesRoot, caseItem.folderName));
  }

  private assertInsideWorkspace(target: string): string {
    const resolvedRoot = path.resolve(this.workspaceRoot);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("文件路径超出本地工作区，已阻止。");
    }
    return resolvedTarget;
  }

  private assertInsideCasesRoot(casesRoot: string, target: string): string {
    const resolvedCasesRoot = path.resolve(casesRoot);
    const resolvedTarget = this.assertInsideWorkspace(target);
    if (resolvedTarget === resolvedCasesRoot || !resolvedTarget.startsWith(`${resolvedCasesRoot}${path.sep}`)) {
      throw new Error("案件目录超出当前项目 cases 目录，已阻止。");
    }
    return resolvedTarget;
  }

  private async assertRealPathInside(root: string, target: string, message: string): Promise<string> {
    const realRoot = await fs.realpath(root);
    const realTarget = await fs.realpath(target);
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(message);
    }
    return realTarget;
  }

  private async ensurePlainDirectory(directory: string, message: string): Promise<void> {
    try {
      const stats = await fs.lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(message);
      }
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      await fs.mkdir(directory, { recursive: true });
      const stats = await fs.lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(message);
      }
    }
  }

  private async safeCaseRootForAccess(project: ProjectSummary, caseItem: CaseSummary): Promise<string> {
    const projectRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id));
    await this.ensurePlainDirectory(projectRoot, "项目目录包含符号链接或非目录节点，已阻止访问。");
    const casesRoot = this.assertInsideWorkspace(path.join(projectRoot, "cases"));
    await this.ensurePlainDirectory(casesRoot, "项目 cases 目录包含符号链接或非目录节点，已阻止访问。");
    const caseRoot = this.assertInsideCasesRoot(casesRoot, path.join(casesRoot, caseItem.folderName));
    await this.ensurePlainDirectory(caseRoot, "案件目录包含符号链接或非目录节点，已阻止访问。");
    await this.assertRealPathInside(casesRoot, caseRoot, "案件目录真实路径超出当前项目 cases 目录，已阻止访问。");
    return caseRoot;
  }

  private assertPreviewRelativePath(input: unknown): string {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("文件预览请求无效。");
    }
    const keys = Object.keys(input);
    if (keys.length !== 1 || keys[0] !== "relativePath") {
      throw new Error("文件预览请求只允许包含 relativePath。");
    }
    const relativePath = (input as { relativePath?: unknown }).relativePath;
    if (typeof relativePath !== "string") {
      throw new Error("文件预览请求缺少相对路径。");
    }

    if (/[\u0000-\u001f\u007f]/.test(relativePath)) {
      throw new Error("文件预览路径包含不安全字符。");
    }
    const trimmed = relativePath.trim();
    if (
      !trimmed ||
      trimmed.includes("\\") ||
      trimmed.startsWith("/") ||
      /^[a-zA-Z]:\//.test(trimmed) ||
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ) {
      throw new Error("只能预览当前案件里的相对文件路径。");
    }

    const parts = trimmed.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("文件预览路径无效。");
    }
    if (parts.some((part) => part === ".sap-adt-cli" || part === ".sap-abap-cli" || part.toLowerCase().includes("secure-store"))) {
      throw new Error("该路径不允许在案件预览中读取。");
    }
    return trimmed;
  }

  private assertSafePreviewFileType(relativePath: string): void {
    const basename = path.basename(relativePath).toLowerCase();
    const extension = path.extname(relativePath).toLowerCase();
    if (BLOCKED_PREVIEW_FILENAMES.has(basename) || basename.includes("credential") || basename.includes("secret")) {
      throw new Error("该文件属于内部状态或凭据相关文件，不能在界面预览。");
    }
    if (!SAFE_PREVIEW_EXTENSIONS.has(extension)) {
      throw new Error("当前只支持预览 Markdown、文本、CSV 和 Mermaid 文件。");
    }
  }

  private async readAllSafeOutputSummaries(state: StoredState, activeFiles: CaseFileNode[]): Promise<SafeOutputSummaryRecord[]> {
    const summaries: SafeOutputSummaryRecord[] = [];
    for (const project of state.projects) {
      for (const caseItem of project.cases) {
        const files = project.id === state.activeProjectId && caseItem.id === state.activeCaseId
          ? activeFiles
          : await this.readCaseTreeForCase(project, caseItem).catch(() => []);
        summaries.push(...await this.readSafeOutputSummariesForCase(project, caseItem, files));
      }
    }
    return summaries;
  }

  private async readSafeOutputSummariesForCase(project: ProjectSummary, caseItem: CaseSummary, files: CaseFileNode[]): Promise<SafeOutputSummaryRecord[]> {
    const summaries: SafeOutputSummaryRecord[] = [];
    for (const node of this.flattenCaseFileNodes(files)) {
      if (node.kind !== "file") continue;
      const summary = await this.readSafeOutputSummary(project, caseItem, node);
      if (summary) summaries.push(summary);
    }
    return summaries;
  }

  private async readSafeOutputSummary(project: ProjectSummary, caseItem: CaseSummary, node: CaseFileNode): Promise<SafeOutputSummaryRecord | null> {
    try {
      const relativePath = this.assertPreviewRelativePath({ relativePath: node.relativePath });
      const parts = relativePath.split("/");
      if (parts.length !== 2 || !SAFE_INDEX_DIRECTORIES.has(parts[0])) return null;

      const extension = path.extname(relativePath).toLowerCase();
      const basename = path.basename(relativePath).toLowerCase();
      if (!SAFE_INDEX_EXTENSIONS.has(extension)) return null;
      if (BLOCKED_PREVIEW_FILENAMES.has(basename) || basename.includes("credential") || basename.includes("secret")) return null;

      const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
      const target = this.assertInsideWorkspace(path.join(caseRoot, relativePath));
      const resolvedCaseRoot = await fs.realpath(caseRoot);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_INDEX_FILE_BYTES) return null;

      const realTarget = await fs.realpath(target);
      if (realTarget !== resolvedCaseRoot && !realTarget.startsWith(`${resolvedCaseRoot}${path.sep}`)) return null;

      const handle = await fs.open(realTarget, "r");
      let raw = "";
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, MAX_INDEX_READ_BYTES));
        const readResult = await handle.read(buffer, 0, buffer.length, 0);
        raw = buffer.subarray(0, readResult.bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
      if (hasUnsafeIndexableContent(raw)) return null;

      const redacted = redactIndexableText(raw);
      if (redacted.redactions > 0 || hasUnsafeIndexableContent(redacted.content)) return null;

      const summary = safeIndexSummary(redacted.content);
      if (!summary) return null;

      return {
        projectId: project.id,
        caseId: caseItem.id,
        projectName: project.name,
        caseTitle: caseItem.title,
        relativePath,
        displayName: path.basename(relativePath),
        fileType: extension.replace(".", "") || "text",
        sizeBytes: stat.size,
        snippet: summary,
        content: summary,
        updatedAt: stat.mtime.toISOString()
      };
    } catch {
      return null;
    }
  }

  private flattenCaseFileNodes(nodes: CaseFileNode[]): CaseFileNode[] {
    const flattened: CaseFileNode[] = [];
    for (const node of nodes) {
      flattened.push(node);
      if (node.children) {
        flattened.push(...this.flattenCaseFileNodes(node.children));
      }
    }
    return flattened;
  }

  private findCaseFileNode(nodes: CaseFileNode[], relativePath: string): CaseFileNode | null {
    for (const node of nodes) {
      if (node.relativePath === relativePath) {
        return node;
      }
      if (node.children) {
        const child = this.findCaseFileNode(node.children, relativePath);
        if (child) return child;
      }
    }
    return null;
  }

  private generatedFileTarget(caseRoot: string, file: CaseGeneratedFile): string {
    const normalizedRelative = file.relativePath.replaceAll("\\", "/");
    if (
      normalizedRelative.startsWith("/") ||
      /^[a-zA-Z]:\//.test(normalizedRelative) ||
      normalizedRelative.split("/").some((part) => part === ".." || part.length === 0)
    ) {
      throw new Error("生成文件路径无效，已阻止写入当前案件目录之外。");
    }

    const allowedByPurpose: Record<CaseGeneratedFile["purpose"], string[]> = {
      output: ["outputs/"],
      candidate_knowledge: ["knowledge_candidates/"],
      technical: ["technical/"],
      evidence: ["evidence/"],
      snapshot: ["snapshots/"]
    };
    if (!allowedByPurpose[file.purpose].some((prefix) => normalizedRelative.startsWith(prefix))) {
      throw new Error("生成文件目录和文件用途不匹配，已阻止写入。");
    }

    const resolvedCaseRoot = path.resolve(caseRoot);
    const resolvedTarget = this.assertInsideWorkspace(path.join(caseRoot, normalizedRelative));
    if (resolvedTarget !== resolvedCaseRoot && !resolvedTarget.startsWith(`${resolvedCaseRoot}${path.sep}`)) {
      throw new Error("生成文件路径超出当前案件目录，已阻止。");
    }
    return resolvedTarget;
  }

  private async assertSafeGeneratedWriteTarget(caseRoot: string, target: string): Promise<string> {
    const resolvedCaseRoot = path.resolve(caseRoot);
    const resolvedTarget = this.assertInsideWorkspace(target);
    const parent = path.dirname(resolvedTarget);
    const relativeParent = path.relative(resolvedCaseRoot, parent);
    if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
      throw new Error("生成文件目录超出当前案件目录，已阻止写入。");
    }

    let cursor = resolvedCaseRoot;
    if (relativeParent) {
      for (const part of relativeParent.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        try {
          const stats = await fs.lstat(cursor);
          if (stats.isSymbolicLink() || !stats.isDirectory()) {
            throw new Error("生成文件目录包含符号链接或非目录节点，已阻止写入。");
          }
        } catch (error) {
          if (isFileNotFound(error)) break;
          throw error;
        }
      }
    }

    await fs.mkdir(parent, { recursive: true });
    cursor = resolvedCaseRoot;
    if (relativeParent) {
      for (const part of relativeParent.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        const stats = await fs.lstat(cursor);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error("生成文件目录包含符号链接或非目录节点，已阻止写入。");
        }
      }
    }

    try {
      const targetStats = await fs.lstat(resolvedTarget);
      if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
        throw new Error("生成文件目标包含符号链接或非文件节点，已阻止写入。");
      }
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }

    const realCaseRoot = await fs.realpath(resolvedCaseRoot);
    const realParent = await fs.realpath(parent);
    if (realParent !== realCaseRoot && !realParent.startsWith(`${realCaseRoot}${path.sep}`)) {
      throw new Error("生成文件真实目录超出当前案件目录，已阻止写入。");
    }
    return resolvedTarget;
  }

  private async writeGeneratedFile(caseRoot: string, file: CaseGeneratedFile): Promise<void> {
    const target = this.generatedFileTarget(caseRoot, file);
    const safeTarget = await this.assertSafeGeneratedWriteTarget(caseRoot, target);
    const tempPath = `${safeTarget}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempPath, file.content, "utf8");
    let archivedPath: string | null = null;
    try {
      const existing = await fs.lstat(safeTarget);
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error("生成文件目标不是普通文件，已阻止覆盖。");
      }
      const parsed = path.parse(file.relativePath.replaceAll("/", "-"));
      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
      archivedPath = this.assertInsideWorkspace(path.join(
        caseRoot,
        "snapshots",
        "versions",
        `${parsed.name}-${stamp}-${Math.random().toString(16).slice(2, 8)}${parsed.ext || ".txt"}`
      ));
      archivedPath = await this.assertSafeGeneratedWriteTarget(caseRoot, archivedPath);
      await fs.rename(safeTarget, archivedPath);
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
    try {
      await fs.rename(tempPath, safeTarget);
    } catch (error) {
      if (archivedPath) await fs.rename(archivedPath, safeTarget).catch(() => undefined);
      throw error;
    }
  }

  private async ensureCaseFiles(state: StoredState): Promise<void> {
    const caseItem = this.getActiveCase(state);
    const project = state.projects.find((item) => item.id === caseItem.projectId) ?? this.ensureFallbackProject(state);
    await this.ensureCaseFilesForCase(state, project, caseItem);
  }

  private async ensureCaseFilesForCase(state: StoredState, project: ProjectSummary, caseItem: CaseSummary): Promise<void> {
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    await Promise.all(state.projects.map((project) => this.ensureProjectStandardsFiles(project)));
    await Promise.all(state.projects.map((project) => this.ensureProjectKnowledgeFiles(project)));
    for (const directory of directories) {
      await fs.mkdir(this.assertInsideWorkspace(path.join(caseRoot, directory)), { recursive: true });
    }
    const requiredFiles = ["README.md", "conversation.md", "timeline.md", "context_pack.md", "metadata.json"];
    const missingRequired = await Promise.all(requiredFiles.map(async (file) => {
      try {
        await fs.access(this.assertInsideWorkspace(path.join(caseRoot, file)));
        return false;
      } catch {
        return true;
      }
    }));
    if (missingRequired.some(Boolean)) {
      await this.writeCaseMarkdown(state, caseItem, buildCaseMaintenanceArtifacts(project, caseItem));
    }
  }

  private async ensureProjectStandardsFiles(project: ProjectSummary): Promise<void> {
    const standardsRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id, "standards"));
    const jsonPath = this.assertInsideWorkspace(path.join(standardsRoot, "project-standards.json"));
    const markdownPath = this.assertInsideWorkspace(path.join(standardsRoot, "project-standards.md"));
    try {
      await Promise.all([fs.access(jsonPath), fs.access(markdownPath)]);
    } catch {
      await this.writeProjectStandards(project);
    }
  }

  private async writeProjectStandards(project: ProjectSummary): Promise<void> {
    const standardsRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id, "standards"));
    await fs.mkdir(standardsRoot, { recursive: true });
    await Promise.all([
      this.writeJsonAtomic(path.join(standardsRoot, "project-standards.json"), renderProjectStandardsJson(project.standards)),
      this.writeTextAtomic(path.join(standardsRoot, "project-standards.md"), renderProjectStandardsMarkdown(project.standards))
    ]);
  }

  private async ensureProjectKnowledgeFiles(project: ProjectSummary): Promise<void> {
    const knowledgeRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id, "knowledge"));
    const jsonPath = this.assertInsideWorkspace(path.join(knowledgeRoot, "project-knowledge.json"));
    const markdownPath = this.assertInsideWorkspace(path.join(knowledgeRoot, "project-knowledge.md"));
    try {
      await Promise.all([fs.access(jsonPath), fs.access(markdownPath)]);
    } catch {
      await this.writeProjectKnowledge(project);
    }
  }

  private async writeProjectKnowledge(project: ProjectSummary): Promise<void> {
    const knowledgeRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id, "knowledge"));
    await fs.mkdir(knowledgeRoot, { recursive: true });
    await Promise.all([
      this.writeJsonAtomic(path.join(knowledgeRoot, "project-knowledge.json"), renderProjectKnowledgeJson(project.knowledge)),
      this.writeTextAtomic(path.join(knowledgeRoot, "project-knowledge.md"), renderProjectKnowledgeMarkdown(project.knowledge))
    ]);
  }

  private async writeProjectMetadata(project: ProjectSummary): Promise<void> {
    const projectRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id));
    await fs.mkdir(projectRoot, { recursive: true });
    await this.writeJsonAtomic(path.join(projectRoot, "project.json"), {
      schemaVersion: SCHEMA_VERSION,
      id: project.id,
      name: project.name,
      sapVersion: project.sapVersion,
      systemLabel: project.systemLabel,
      isVisible: project.isVisible,
      visibleOrder: project.visibleOrder,
      connectionState: project.connectionState,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      config: project.config,
      standards: project.standards,
      knowledge: project.knowledge,
      safety: "no-secrets-local-project"
    });
  }

  private appendStartupNotice(message: string): void {
    this.startupNotice = this.startupNotice ? `${this.startupNotice} ${message}` : message;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.lstat(targetPath);
      return true;
    } catch (error) {
      if (isFileNotFound(error)) return false;
      throw error;
    }
  }

  private transactionDirectory(): string {
    return this.assertInsideWorkspace(path.join(this.workspaceRoot, "temp", "transactions"));
  }

  private async writeTransactionJournal(journalPath: string, journal: TextBatchTransactionJournal): Promise<void> {
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await this.writeJsonAtomic(journalPath, journal);
  }

  private parseTransactionJournal(value: unknown): TextBatchTransactionJournal {
    if (!value || typeof value !== "object") throw new Error("事务恢复记录结构无效。");
    const candidate = value as Partial<TextBatchTransactionJournal>;
    if (candidate.version !== 1 || (candidate.status !== "preparing" && candidate.status !== "committed")) {
      throw new Error("事务恢复记录版本或状态无效。");
    }
    if (!Array.isArray(candidate.items) || candidate.items.length === 0 || candidate.items.length > 256) {
      throw new Error("事务恢复记录的文件数量无效。");
    }
    const items = candidate.items.map((rawItem) => {
      if (!rawItem || typeof rawItem !== "object") throw new Error("事务恢复记录包含无效文件项。");
      const item = rawItem as Partial<TextBatchTransactionItem>;
      if (typeof item.targetPath !== "string" || typeof item.tempPath !== "string" || typeof item.backupPath !== "string" || typeof item.hadOriginal !== "boolean") {
        throw new Error("事务恢复记录缺少必要文件信息。");
      }
      const targetPath = this.assertInsideWorkspace(item.targetPath);
      const tempPath = this.assertInsideWorkspace(item.tempPath);
      const backupPath = this.assertInsideWorkspace(item.backupPath);
      if (!tempPath.startsWith(`${targetPath}.`) || !tempPath.endsWith(".txn.tmp")) throw new Error("事务临时文件路径无效。");
      if (!backupPath.startsWith(`${targetPath}.`) || !backupPath.endsWith(".txn.bak")) throw new Error("事务备份文件路径无效。");
      let snapshotPath: string | undefined;
      if (item.snapshotPath !== undefined) {
        if (typeof item.snapshotPath !== "string") throw new Error("事务快照路径无效。");
        snapshotPath = this.assertInsideWorkspace(item.snapshotPath);
        const relativeParts = path.relative(this.workspaceRoot, snapshotPath).split(path.sep).map((part) => part.toLowerCase());
        if (!relativeParts.includes("snapshots") || !relativeParts.includes("versions")) throw new Error("事务快照不在受控版本目录中。");
      }
      return { targetPath, tempPath, backupPath, hadOriginal: item.hadOriginal, ...(snapshotPath ? { snapshotPath } : {}) };
    });
    return {
      version: 1,
      status: candidate.status,
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso(),
      items
    };
  }

  private async rollbackPreparingTransaction(journal: TextBatchTransactionJournal): Promise<void> {
    const failures: unknown[] = [];
    for (const item of [...journal.items].reverse()) {
      try {
        if (item.hadOriginal) {
          if (await this.pathExists(item.backupPath)) {
            await fs.rm(item.targetPath, { force: true });
            await fs.rename(item.backupPath, item.targetPath);
          }
        } else {
          await fs.rm(item.targetPath, { force: true });
        }
        if (item.snapshotPath) await fs.rm(item.snapshotPath, { force: true });
        await fs.rm(item.tempPath, { force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new Error("未完成事务无法自动回滚，恢复记录已保留，请停止继续写入并检查本地磁盘状态。");
  }

  private async cleanupCommittedTransaction(journal: TextBatchTransactionJournal): Promise<boolean> {
    const results = await Promise.allSettled(journal.items.flatMap((item) => [
      fs.rm(item.backupPath, { force: true }),
      fs.rm(item.tempPath, { force: true })
    ]));
    return results.every((result) => result.status === "fulfilled");
  }

  private async recoverInterruptedTextBatchTransactions(): Promise<void> {
    const transactionDirectory = this.transactionDirectory();
    let entries;
    try {
      entries = await fs.readdir(transactionDirectory, { withFileTypes: true });
    } catch (error) {
      if (isFileNotFound(error)) return;
      throw error;
    }
    const journals = entries.filter((entry) => entry.isFile() && /^transaction-[A-Za-z0-9.-]+\.json$/.test(entry.name));
    if (journals.length > 20) throw new Error("检测到过多未清理事务记录，已停止写入以避免错误恢复。");

    let recoveredCount = 0;
    for (const entry of journals) {
      const journalPath = this.assertInsideWorkspace(path.join(transactionDirectory, entry.name));
      try {
        const metadata = await fs.lstat(journalPath);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) throw new Error("事务恢复记录不是受控普通文件。");
        const journal = this.parseTransactionJournal(JSON.parse(await fs.readFile(journalPath, "utf8")) as unknown);
        if (journal.status === "preparing") {
          await this.rollbackPreparingTransaction(journal);
          recoveredCount += 1;
        } else if (!await this.cleanupCommittedTransaction(journal)) {
          this.appendStartupNotice("上次已提交写入的临时备份尚未全部清理；正式文件不受影响，下次启动会继续清理。");
          continue;
        }
        await fs.rm(journalPath, { force: true });
      } catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error && error.message.includes("事务恢复记录"))) {
          const preservedPath = this.assertInsideWorkspace(`${journalPath}.invalid-${Date.now()}`);
          await fs.rename(journalPath, preservedPath);
          this.appendStartupNotice(`发现无效事务恢复记录，已保留为 ${path.basename(preservedPath)}，没有按其中路径执行文件操作。`);
          continue;
        }
        throw error;
      }
    }
    if (recoveredCount > 0) this.appendStartupNotice(`检测到 ${recoveredCount} 次未完成的案件写入，已恢复到写入前状态。`);
  }

  private async writeTextBatchAtomic(plans: Array<{ targetPath: string; content: string; snapshotPath?: string }>): Promise<void> {
    const normalized = plans.map((plan) => ({
      ...plan,
      targetPath: this.assertInsideWorkspace(plan.targetPath),
      ...(plan.snapshotPath ? { snapshotPath: this.assertInsideWorkspace(plan.snapshotPath) } : {})
    }));
    if (new Set(normalized.map((plan) => plan.targetPath.toLowerCase())).size !== normalized.length) {
      throw new Error("案件文件批次包含重复目标，已停止写入。");
    }
    const snapshotPaths = normalized.flatMap((plan) => plan.snapshotPath ? [plan.snapshotPath.toLowerCase()] : []);
    if (new Set(snapshotPaths).size !== snapshotPaths.length) throw new Error("案件文件批次包含重复快照，已停止写入。");

    const transactionId = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
    const staged: Array<TextBatchTransactionItem & { content: string }> = [];
    for (const plan of normalized) {
      let hadOriginal = false;
      try {
        const existing = await fs.lstat(plan.targetPath);
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("案件文件目标不是普通文件，已停止整批写入。");
        hadOriginal = true;
      } catch (error) {
        if (!isFileNotFound(error)) throw error;
      }
      if (plan.snapshotPath && await this.pathExists(plan.snapshotPath)) throw new Error("案件版本快照目标已存在，已停止整批写入。");
      staged.push({
        targetPath: plan.targetPath,
        content: plan.content,
        tempPath: `${plan.targetPath}.${transactionId}.txn.tmp`,
        backupPath: `${plan.targetPath}.${transactionId}.txn.bak`,
        hadOriginal,
        ...(plan.snapshotPath ? { snapshotPath: plan.snapshotPath } : {})
      });
    }
    const journalPath = this.assertInsideWorkspace(path.join(this.transactionDirectory(), `transaction-${transactionId}.json`));
    const journal: TextBatchTransactionJournal = {
      version: 1,
      status: "preparing",
      createdAt: nowIso(),
      items: staged.map(({ content: _content, ...item }) => item)
    };

    try {
      await Promise.all(staged.map(async (plan) => {
        await fs.mkdir(path.dirname(plan.targetPath), { recursive: true });
        await fs.writeFile(plan.tempPath, plan.content, "utf8");
      }));
      await this.writeTransactionJournal(journalPath, journal);

      for (const plan of staged) {
        if (plan.hadOriginal) await fs.rename(plan.targetPath, plan.backupPath);
        await fs.rename(plan.tempPath, plan.targetPath);
      }

      for (const item of staged) {
        if (!item.hadOriginal || !item.snapshotPath) continue;
        await fs.mkdir(path.dirname(item.snapshotPath), { recursive: true });
        await fs.copyFile(item.backupPath, item.snapshotPath);
      }
      journal.status = "committed";
      await this.writeTransactionJournal(journalPath, journal);
    } catch (error) {
      await this.rollbackPreparingTransaction(journal);
      await fs.rm(journalPath, { force: true });
      throw error;
    }

    if (await this.cleanupCommittedTransaction(journal)) {
      await fs.rm(journalPath, { force: true });
    } else {
      this.appendStartupNotice("案件内容已完整保存，但部分事务临时备份尚未清理；下次启动会自动继续清理。");
    }
  }

  private async writeCaseMarkdown(state: StoredState, caseItem: CaseSummary, artifacts: CaseWorkflowArtifacts, threadId?: string, persistState = false): Promise<void> {
    const project = state.projects.find((item) => item.id === caseItem.projectId) ?? this.ensureFallbackProject(state);
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    const thread = threadId
      ? state.workThreads.find((item) => item.id === threadId && item.projectId === project.id && item.caseId === caseItem.id)
      : state.workThreads.find((item) => item.id === state.activeWorkThreadId && item.projectId === project.id && item.caseId === caseItem.id);
    const threadRoot = thread
      ? this.assertInsideWorkspace(path.join(caseRoot, "technical", "conversations", thread.id))
      : null;
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const projectRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id));
    const plans: Array<{ targetPath: string; content: string; snapshotPath?: string }> = [
      {
        targetPath: path.join(projectRoot, "project.json"),
        content: json({
          schemaVersion: SCHEMA_VERSION,
          id: project.id,
          name: project.name,
          sapVersion: project.sapVersion,
          systemLabel: project.systemLabel,
          isVisible: project.isVisible,
          visibleOrder: project.visibleOrder,
          connectionState: project.connectionState,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          config: project.config,
          standards: project.standards,
          knowledge: project.knowledge,
          safety: "no-secrets-local-project"
        })
      },
      { targetPath: path.join(caseRoot, "messages.json"), content: json(caseItem.messages) },
      { targetPath: path.join(caseRoot, "README.md"), content: artifacts.readme },
      { targetPath: path.join(caseRoot, "conversation.md"), content: artifacts.conversation },
      { targetPath: path.join(caseRoot, "timeline.md"), content: artifacts.timeline },
      { targetPath: path.join(caseRoot, "context_pack.md"), content: artifacts.contextPack },
      { targetPath: path.join(caseRoot, "metadata.json"), content: json(artifacts.metadata) }
    ];
    if (thread && threadRoot) {
      plans.push(
        { targetPath: path.join(threadRoot, "messages.json"), content: json(thread.messages) },
        { targetPath: path.join(threadRoot, "conversation.md"), content: artifacts.conversation },
        { targetPath: path.join(threadRoot, "timeline.md"), content: artifacts.timeline },
        { targetPath: path.join(threadRoot, "metadata.json"), content: json({
        threadId: thread.id,
        title: thread.title,
        status: thread.status,
        projectId: thread.projectId,
        caseId: thread.caseId,
        updatedAt: thread.updatedAt
        }) }
      );
    }
    for (const file of artifacts.generatedFiles) {
      const targetPath = await this.assertSafeGeneratedWriteTarget(caseRoot, this.generatedFileTarget(caseRoot, file));
      const parsed = path.parse(file.relativePath.replaceAll("/", "-"));
      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
      const snapshotPath = this.assertInsideWorkspace(path.join(caseRoot, "snapshots", "versions", `${parsed.name}-${stamp}-${Math.random().toString(16).slice(2, 8)}${parsed.ext || ".txt"}`));
      plans.push({ targetPath, content: file.content, snapshotPath });
    }
    if (persistState) {
      let previousState = json(state);
      try {
        const existingState = await fs.readFile(this.statePath, "utf8");
        JSON.parse(existingState);
        previousState = existingState;
      } catch (error) {
        if (!isFileNotFound(error) && !(error instanceof SyntaxError)) throw error;
      }
      plans.push(
        { targetPath: this.stateBackupPath, content: previousState },
        { targetPath: this.statePath, content: json(state) }
      );
    }
    await this.writeTextBatchAtomic(plans);
  }

  private async writeCaseGeneratedFiles(project: ProjectSummary, caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[]): Promise<void> {
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    await Promise.all(generatedFiles.map(async (file) => {
      await this.writeGeneratedFile(caseRoot, file);
    }));
  }

  private async withFiles(state: StoredState): Promise<WorkbenchState> {
    const startupNotice = this.startupNotice ?? undefined;
    this.startupNotice = null;
    return {
      schemaVersion: state.schemaVersion,
      workspaceRoot: this.workspaceRoot,
      activeProjectId: state.activeProjectId,
      activeCaseId: state.activeCaseId,
      activeWorkThreadId: state.activeWorkThreadId,
      activeChatThreadId: state.activeChatThreadId,
      projects: state.projects,
      workThreads: state.workThreads,
      chatThreads: state.chatThreads,
      activeCaseFiles: await this.readCaseTree(state),
      ...(startupNotice ? { startupNotice } : {})
    };
  }

  private async readCaseTree(state: StoredState): Promise<CaseFileNode[]> {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureFallbackProject(state);
    const caseItem = this.getActiveCase(state);
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    return this.readDirectory(caseRoot, caseRoot, "", caseItem.id);
  }

  private async readCaseTreeForCase(project: ProjectSummary, caseItem: CaseSummary): Promise<CaseFileNode[]> {
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    return this.readDirectory(caseRoot, caseRoot, "", caseItem.id);
  }

  private async readDirectory(caseRoot: string, directory: string, relativeBase: string, caseId: string): Promise<CaseFileNode[]> {
    const entries = await fs.readdir(this.assertInsideWorkspace(directory), { withFileTypes: true });
    const nodes: CaseFileNode[] = [];

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
      const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      const absolutePath = this.assertInsideWorkspace(path.join(directory, entry.name));
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) continue;
      const isDirectory = stats.isDirectory();
      const isFile = stats.isFile();
      if (!isDirectory && !isFile) continue;
      try {
        await this.assertRealPathInside(caseRoot, absolutePath, "案件文件树包含越界文件，已阻止。");
      } catch {
        continue;
      }
      const kind = isDirectory ? "directory" : "file";
      if (isInternalCaseTreeEntry(relativePath, kind)) continue;
      const fileType = isDirectory ? "directory" : path.extname(entry.name).replace(".", "").toLowerCase() || "text";
      nodes.push({
        id: relativePath,
        caseId,
        name: isDirectory ? `${entry.name}/` : entry.name,
        relativePath,
        displayName: entry.name,
        kind,
        fileType,
        purpose: purposeFor(relativePath, kind),
        size: stats.size,
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        indexedAt: nowIso(),
        children: isDirectory ? await this.readDirectory(caseRoot, absolutePath, relativePath, caseId) : undefined
      });
    }

    return nodes;
  }
}
