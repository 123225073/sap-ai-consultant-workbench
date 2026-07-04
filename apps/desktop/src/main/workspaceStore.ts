import fs from "node:fs/promises";
import path from "node:path";
import {
  assertNoSensitiveCaseContent,
  buildAssistantContent,
  buildCaseMaintenanceArtifacts,
  buildCaseWorkflowArtifacts,
  createCaseMessage,
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
import type { AdtVerificationMode, AdtVerificationReport, CaseFileNode, CaseFilePreview, CaseGeneratedFile, CaseKnowledgeReference, CaseMessage, CaseSummary, ConfigStatus, CreateLocalCaseInput, CreateLocalProjectInput, FeishuHandoffResult, FeishuVerificationReport, KnowledgeImportLocalTextResult, ModelProviderVerificationReport, ModelSummary, ProjectConfig, ProjectKnowledgeView, ProjectSecretTarget, ProjectStandardsView, ProjectSummary, SapObjectEvidenceResult, SecretHandle, SecretKind, SearchResult, SwitchCaseInput, SwitchProjectInput, WorkbenchState } from "../shared/workbenchTypes";
import { buildSafeModelDraftContext, type SafeModelDraftContext, type SafeModelDraftRun } from "./safeModelCaseDraftService";
import { normalizeSapObjectEvidenceResult, renderSapObjectEvidenceFiles, sapObjectEvidenceBoundary, type SapObjectEvidenceConnectorResult } from "./sapObjectEvidenceService";
import { renderFeishuHandoffArtifacts } from "./feishuHandoffService";

interface StoredState {
  schemaVersion: number;
  activeProjectId: string;
  activeCaseId: string;
  projects: ProjectSummary[];
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

const DEMO_PROJECT_ID = "demo-s4hana";
const DEMO_CASE_ID = "demo001";
const SCHEMA_VERSION = 1;

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
  return {
    schemaVersion: 2,
    projectId,
    updatedAt,
    adt: {
      alias: demo ? "演示开发系统" : "",
      url: demo ? "https://sap-demo.example.com" : "",
      client: demo ? "100" : "",
      username: demo ? "DEMO_USER" : "",
      language: "ZH",
      sslMode: "strict",
      readOnly: true,
      credential: emptySecretHandle("adt-password"),
      configStatus: demo ? "saved" : "not-configured",
      connectionStatus: "pending-verification",
      minimalReadStatus: "pending-verification",
      lastVerificationMode: null,
      lastCheckedAt: null
    },
    feishu: {
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
        models: [],
        modelSyncStatus: "pending-verification",
        chatTestStatus: "pending-verification",
        lastVerificationMode: null,
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
    throw new Error(`${label} must be plain text.`);
  }
  const textValue = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!textValue) {
    throw new Error(`${label} is required.`);
  }
  if (textValue.length > maxLength) {
    throw new Error(`${label} is too long.`);
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
    throw new Error(`${label} contains unsafe text or path-like content.`);
  }
  return textValue;
}

export function parseCreateLocalProjectInput(input: unknown): CreateLocalProjectInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Create project request is invalid.");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["name", "sapVersion", "systemLabel"].includes(key))) {
    throw new Error("Create project request contains unsupported fields.");
  }
  const candidate = input as Partial<CreateLocalProjectInput>;
  return {
    name: assertSafeLifecycleText("Project name", candidate.name, 80),
    sapVersion: lifecycleSapVersion(candidate.sapVersion),
    systemLabel: assertSafeLifecycleText("System label", candidate.systemLabel, 40)
  };
}

function assertStrictLifecycleId(label: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a plain local ID.`);
  }
  if (value !== value.trim() || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error(`${label} contains unsafe or path-like content.`);
  }
  return value;
}

export function parseCreateLocalCaseInput(input: unknown): CreateLocalCaseInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Create case request is invalid.");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["projectId", "title"].includes(key))) {
    throw new Error("Create case request contains unsupported fields.");
  }
  const candidate = input as Partial<CreateLocalCaseInput>;
  const projectId = candidate.projectId === undefined ? undefined : assertStrictLifecycleId("Project ID", candidate.projectId);
  return {
    ...(projectId ? { projectId } : {}),
    title: assertSafeLifecycleText("Case title", candidate.title, 120)
  };
}

function parseSwitchProjectInput(input: unknown): SwitchProjectInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Switch project request is invalid.");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "projectId") {
    throw new Error("Switch project request may only contain projectId.");
  }
  const projectId = assertStrictLifecycleId("Project ID", (input as Partial<SwitchProjectInput>).projectId);
  return { projectId };
}

function parseSwitchCaseInput(input: unknown): SwitchCaseInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Switch case request is invalid.");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["projectId", "caseId"].includes(key))) {
    throw new Error("Switch case request may only contain projectId and caseId.");
  }
  const projectId = assertStrictLifecycleId("Project ID", (input as Partial<SwitchCaseInput>).projectId);
  const caseId = assertStrictLifecycleId("Case ID", (input as Partial<SwitchCaseInput>).caseId);
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
  throw new Error("Unable to allocate a unique local ID.");
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
    summary: "New local case. No output has been generated yet.",
    createdAt,
    updatedAt: createdAt,
    lastOpenedAt: createdAt,
    folderName: id,
    currentSummary: "New local case. No output has been generated yet.",
    knowledgeReferences: [],
    messages: []
  };
}

function createLocalProjectRecord(input: CreateLocalProjectInput, existingProjectIds: Iterable<string>, visibleOrder: number): ProjectSummary {
  const createdAt = nowIso();
  const id = uniqueEntityId("project", existingProjectIds);
  const projectDir = id;
  const firstCase = createLocalCaseRecord(id, `${input.name} initial case`, []);
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
  return {
    schemaVersion: SCHEMA_VERSION,
    activeProjectId: DEMO_PROJECT_ID,
    activeCaseId: DEMO_CASE_ID,
    projects: [demoProject()]
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

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
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
  if (/bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{20,}|api[_-]?key|token|secret|password|secure-store|https?:\/\//i.test(trimmed)) {
    return "local-workflow";
  }
  return trimmed;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function providerType(value: unknown): ProjectConfig["apiProviders"][number]["providerType"] {
  return value === "deepseek" || value === "custom" ? value : "openai-compatible";
}

function modelVerificationMode(value: unknown): ProjectConfig["apiProviders"][number]["lastVerificationMode"] {
  return value === "fake" || value === "http" ? value : null;
}

function adtVerificationMode(value: unknown): AdtVerificationMode | null {
  return value === "fake" || value === "adt" ? value : null;
}

function sslMode(value: unknown): ProjectConfig["adt"]["sslMode"] {
  return value === "skip-certificate" ? "skip-certificate" : "strict";
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

function sapVersion(value: unknown): ProjectSummary["sapVersion"] {
  return value === "S4" || value === "ECC" ? value : "UNKNOWN";
}

function lifecycleSapVersion(value: unknown): CreateLocalProjectInput["sapVersion"] {
  if (value === "S4" || value === "ECC") {
    return value;
  }
  throw new Error("Choose S4 or ECC before creating a local project.");
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
  return value.slice(0, 200).flatMap((item) => {
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
    role,
    content: text(candidate.content),
    taskMode: normalizeTaskMode(candidate.taskMode),
    modelId: safeMessageModelId(candidate.modelId),
    linkedFileIds,
    createdAt: text(candidate.createdAt, nowIso())
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

export class WorkspaceStore {
  private readonly workspaceRoot: string;
  private readonly statePath: string;
  private readonly database: DatabaseService;
  private databaseInitialized = false;
  private stateWriteQueue: Promise<void> = Promise.resolve();

  constructor(repoRoot: string) {
    this.workspaceRoot = path.join(repoRoot, "local-data", "workbench");
    this.statePath = path.join(this.workspaceRoot, "app-state.json");
    this.database = new DatabaseService(this.workspaceRoot);
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

  async getState(): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const state = await this.loadOrCreateState();
      await this.ensureCaseFiles(state);
      await this.refreshSearchIndex(state);
      return this.withFiles(state);
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
      state.activeProjectId = project.id;
      state.activeCaseId = project.cases[0]?.id ?? "";
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
      const projectId = caseInput.projectId ?? state.activeProjectId;
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error("Target project is no longer available.");
      }
      const caseItem = createLocalCaseRecord(project.id, caseInput.title, project.cases.map((item) => item.id));
      project.cases.unshift(caseItem);
      project.updatedAt = nowIso();
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

  async switchProject(input: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
      const { projectId } = parseSwitchProjectInput(input);
      const state = await this.loadOrCreateState();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new Error("Target project is no longer available.");
      }
      const activeCase = [...project.cases].sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())[0];
      if (!activeCase) {
        throw new Error("Target project has no local case.");
      }
      activeCase.lastOpenedAt = nowIso();
      syncProjectLocalStorage(project, activeCase);
      state.activeProjectId = project.id;
      state.activeCaseId = activeCase.id;
      await this.saveState(state);
      await this.writeProjectMetadata(project);
      await this.ensureCaseFiles(state);
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
        throw new Error("Target project is no longer available.");
      }
      const caseItem = project.cases.find((item) => item.id === caseId);
      if (!caseItem) {
        throw new Error("Target case is not part of the selected project.");
      }
      caseItem.lastOpenedAt = nowIso();
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

  async appendMessage(input: unknown, safeModelDraft?: SafeModelDraftRun): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const workflowInput = parseCaseWorkflowInput(input);
    if (!workflowInput.content) {
      throw new Error("请输入案件问题或补充说明。");
    }
    assertNoSensitiveCaseContent(workflowInput.content);

    const state = await this.loadOrCreateState();
    const currentCase = this.getActiveCase(state);
    const project = state.projects.find((item) => item.id === currentCase.projectId) ?? this.ensureDemoProject(state);
    syncProjectLocalStorage(project, currentCase);
    const persistedModelId = safeModelDraft ? safeMessageModelId(safeModelDraft.modelId) : "local-workflow";
    const persistedModelDraft = safeModelDraft ? { ...safeModelDraft, modelId: persistedModelId } : undefined;
    const persistedInput = { ...workflowInput, modelId: persistedModelId };
    const previewFiles = buildCaseWorkflowArtifacts(project, currentCase, persistedInput, persistedModelDraft).generatedFiles;
    const userMessage = createCaseMessage("user", currentCase.id, persistedInput.content, persistedInput.taskMode, persistedInput.modelId);
    const assistantMessage = createCaseMessage(
      "assistant",
      currentCase.id,
      buildAssistantContent(persistedInput, previewFiles, persistedModelDraft),
      persistedInput.taskMode,
      persistedModelId,
      previewFiles.map((file) => file.relativePath)
    );

    currentCase.messages.push(userMessage, assistantMessage);
    currentCase.currentSummary = `已按「${persistedInput.taskMode === "abap-development" ? "ABAP 开发" : persistedInput.taskMode === "document-generation" ? "文档生成" : persistedInput.taskMode === "flow-diagram" ? "画流程图" : "问题分析"}」模式处理最新输入，并生成 ${previewFiles.length} 个本地案件文件。`;
    currentCase.summary = currentCase.currentSummary;
    currentCase.updatedAt = nowIso();
    currentCase.lastOpenedAt = nowIso();
    const artifacts = buildCaseWorkflowArtifacts(project, currentCase, persistedInput, persistedModelDraft);
    currentCase.currentSummary = artifacts.currentSummary;
    currentCase.summary = artifacts.currentSummary;
    project.knowledge = appendKnowledgeCandidatesFromCase(project, currentCase, artifacts.generatedFiles);
    project.updatedAt = nowIso();
    await this.saveState(state);
    await this.writeProjectKnowledge(project);
    await this.writeCaseMarkdown(state, currentCase, artifacts);
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

    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureDemoProject(state);
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
    await this.refreshSearchIndex(state);
    const files = await this.readCaseTree(state);
    const safeOutputSummaries = await this.readAllSafeOutputSummaries(state, files);
    return searchWorkbench(this.database, state.projects, files, safeOutputSummaries, query);
  }

  async prepareSafeModelDraftRequest(input: unknown, options: { allowFakeModelExecution?: boolean } = {}): Promise<PreparedSafeModelDraftRequest | null> {
    const workflowInput = parseCaseWorkflowInput(input);
    if (!workflowInput.content) return null;
    if (workflowInput.modelSelectionRejected) return null;
    assertNoSensitiveCaseContent(workflowInput.content);

    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    const currentCase = this.getActiveCase(state);
    const project = state.projects.find((item) => item.id === currentCase.projectId) ?? this.ensureDemoProject(state);
    const eligibleProviders = project.config.apiProviders.filter((item) => {
      const realEligible = item.lastVerificationMode === "http";
      const fakeEligible = options.allowFakeModelExecution === true && item.lastVerificationMode === "fake" && isFakeModelExecutionHost(item.baseUrl);
      return (
        item.enabled &&
        item.credential.state === "set-in-secure-store" &&
        item.modelSyncStatus === "verified" &&
        item.chatTestStatus === "verified" &&
        item.lastVerifiedModelId !== null &&
        item.models.length > 0 &&
        (realEligible || fakeEligible)
      );
    });
    const provider = workflowInput.providerId
      ? eligibleProviders.find((item) => item.id === workflowInput.providerId)
      : eligibleProviders[0];
    const model = provider
      ? (workflowInput.modelId === "local-workflow"
        ? provider.models.find((item) => item.id === provider.lastVerifiedModelId) ?? null
        : provider.models.find((item) => item.id === workflowInput.modelId && item.id === provider.lastVerifiedModelId) ?? null)
      : null;
    if (!provider || !model) return null;

    const files = await this.readCaseTree(state);
    const safeOutputSummaries = await this.readSafeOutputSummariesForCase(project, currentCase, files);
    try {
      const context = buildSafeModelDraftContext({
        taskMode: workflowInput.taskMode,
        taskLabel: TASK_MODE_LABELS[workflowInput.taskMode],
        userInput: workflowInput.content,
        caseTitle: currentCase.title,
        caseSummary: currentCase.currentSummary,
        sapVersion: project.sapVersion,
        standardsSummary: standardsSummaryForTask(project.standards),
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

  async saveProjectConfig(projectId: string, config: unknown): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    this.assertNoRawSecretFields(config);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存配置。");
    }

    project.config = this.sanitizeProjectConfig(project, config);
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

  async getActiveProjectConfig(): Promise<{ projectId: string; caseId: string; config: ProjectConfig }> {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureDemoProject(state);
    const caseItem = this.getActiveCase(state);
    return { projectId: project.id, caseId: caseItem.id, config: project.config };
  }

  async appendSapObjectEvidence(result: SapObjectEvidenceConnectorResult, targetCase?: { projectId: string; caseId: string }): Promise<SapObjectEvidenceResult> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    const fallbackCase = this.getActiveCase(state);
    const projectId = targetCase?.projectId ?? fallbackCase.projectId;
    const caseId = targetCase?.caseId ?? fallbackCase.id;
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("SAP evidence target project is no longer available.");
    }
    const currentCase = project.cases.find((item) => item.id === caseId);
    if (!currentCase) {
      throw new Error("SAP evidence target case is no longer available.");
    }
    syncProjectLocalStorage(project, currentCase);
    const record = normalizeSapObjectEvidenceResult(result);
    const generatedFiles = renderSapObjectEvidenceFiles(record);
    const generatedPaths = generatedFiles.map((file) => file.relativePath);

    const assistantMessage = createCaseMessage(
      "assistant",
      currentCase.id,
      [
        `SAP read-only evidence attached: ${record.summary.objectType} ${record.summary.objectName}.`,
        "",
        `System: ${record.summary.systemAlias} / client ${record.summary.client}.`,
        `Read time: ${record.summary.readAt}.`,
        "",
        sapObjectEvidenceBoundary,
        "",
        "Generated files:",
        ...generatedPaths.map((file) => `- ${file}`)
      ].join("\n"),
      "problem-analysis",
      "sap-readonly-evidence",
      generatedPaths
    );

    currentCase.messages.push(assistantMessage);
    currentCase.currentSummary = `SAP read-only evidence attached for ${record.summary.objectType} ${record.summary.objectName}; case conclusions can cite this evidence after user review.`;
    currentCase.summary = currentCase.currentSummary;
    currentCase.updatedAt = nowIso();
    currentCase.lastOpenedAt = nowIso();
    project.updatedAt = nowIso();

    const maintenance = buildCaseMaintenanceArtifacts(project, currentCase);
    const metadata = {
      ...(maintenance.metadata && typeof maintenance.metadata === "object" ? maintenance.metadata as Record<string, unknown> : {}),
      sapObjectEvidence: record.summary,
      generatedFiles: generatedFiles.map((file) => ({ relativePath: file.relativePath, purpose: file.purpose })),
      workflowBoundary: sapObjectEvidenceBoundary,
      safety: {
        localOnly: true,
        sapWrite: "disabled",
        sapEvidenceRead: "single-object-readonly",
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
        "## SAP Read-Only Evidence",
        "",
        ...generatedPaths.map((file) => `- ${file}`)
      ].join("\n"),
      timeline: [
        maintenance.timeline,
        `- ${record.summary.readAt}: SAP read-only evidence attached for ${record.summary.objectType} ${record.summary.objectName}.`
      ].join("\n"),
      contextPack: [
        maintenance.contextPack,
        "",
        "## SAP Read-Only Evidence",
        "",
        `- ${record.summary.objectType} ${record.summary.objectName} from ${record.summary.systemAlias} / ${record.summary.client}.`,
        `- Evidence time: ${record.summary.readAt}.`,
        "- Full evidence remains in restricted case evidence files and is not sent to the model by default."
      ].join("\n"),
      metadata
    };

    await this.saveState(state);
    await this.writeCaseMarkdown(state, currentCase, artifacts);
    await this.refreshSearchIndex(state);
    return {
      state: await this.withFiles(state),
      summary: record.summary,
      generatedFiles: generatedPaths
    };
    });
  }

  async prepareFeishuHandoff(): Promise<FeishuHandoffResult> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    const currentCase = this.getActiveCase(state);
    const project = state.projects.find((item) => item.id === currentCase.projectId) ?? this.ensureDemoProject(state);
    syncProjectLocalStorage(project, currentCase);
    const files = await this.readCaseTree(state);
    const safeOutputSummaries = await this.readSafeOutputSummariesForCase(project, currentCase, files);
    if (safeOutputSummaries.length === 0) {
      throw new Error("Current case has no safe output summary yet. Generate a local output first, then prepare the Feishu handoff draft.");
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
      items: [item, ...project.knowledge.items].slice(0, 500),
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

  async updateAdtVerification(projectId: string, report: AdtVerificationReport): Promise<WorkbenchState> {
    return this.runExclusive(async () => {
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存 ADT 验证结果。");
    }

    const configPassed = report.steps.some((item) => item.id === "config" && item.status === "passed");
    project.config.adt.configStatus = configPassed ? "verified" : "failed";
    project.config.adt.connectionStatus = report.connectionStatus;
    project.config.adt.minimalReadStatus = report.minimalReadStatus;
    project.config.adt.lastVerificationMode = report.mode;
    project.config.adt.lastCheckedAt = report.checkedAt;
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

  async updateModelProviderVerification(projectId: string, providerId: string, report: ModelProviderVerificationReport): Promise<WorkbenchState> {
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

    provider.models = report.models;
    provider.modelSyncStatus = report.modelSyncStatus;
    provider.chatTestStatus = report.chatTestStatus;
    provider.lastVerificationMode = report.mode;
    provider.lastVerifiedModelId = report.chatTestStatus === "verified" ? report.selectedModelId : null;
    provider.lastCheckedAt = report.checkedAt;
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
      project.config.adt.credential = safeHandle;
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

    project.config = this.sanitizeProjectConfig(project, project.config);
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
    await this.initializeDatabase();
    let raw: string;
    try {
      raw = await fs.readFile(this.statePath, "utf8");
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      const state = emptyState();
      await this.saveState(state);
      return state;
    }
    let parsed: StoredState;
    let normalized: StoredState;
    try {
      parsed = JSON.parse(raw) as StoredState;
      normalized = this.normalizeState(parsed);
    } catch {
      const state = emptyState();
      await this.saveState(state);
      return state;
    }
    const activeProject = this.activeProjectFromState(normalized);
    const shouldPersistState = raw.includes("secure-store:sec_") || this.shouldPersistNormalizedState(parsed, normalized);
    if (shouldPersistState) {
      await this.saveState(normalized);
    }
    if (shouldPersistState || await this.shouldPersistActiveProjectMetadata(activeProject)) {
      await this.writeProjectMetadata(activeProject);
    }
    return normalized;
  }

  private activeProjectFromState(state: StoredState): ProjectSummary {
    return state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0] ?? demoProject();
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
    if (JSON.stringify(caseReferenceFingerprint(parsed)) !== JSON.stringify(caseReferenceFingerprint(normalized))) return true;
    const parsedProject = Array.isArray(parsed.projects) ? parsed.projects.find((project) => project.id === normalized.activeProjectId) : undefined;
    const normalizedProject = normalized.projects.find((project) => project.id === normalized.activeProjectId);
    if (!parsedProject || !normalizedProject) return true;
    return parsedProject.config?.localStorage?.casesDir !== normalizedProject.config.localStorage.casesDir ||
      parsedProject.config?.localStorage?.projectDir !== normalizedProject.config.localStorage.projectDir;
  }

  private async saveState(state: StoredState): Promise<void> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    await this.writeJsonAtomic(this.statePath, state);
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
    const normalizedProjects = (state.projects.length > 0 ? state.projects : [demoProject()]).map((project) => {
      const projectId = safeId(project.id, DEMO_PROJECT_ID);
      const projectDir = safeId(project.projectDir, projectId);
      const sourceCases = Array.isArray(project.cases) ? project.cases : [];
      const cases = (sourceCases.length > 0 ? sourceCases : [demoCase()]).map((caseItem, index) => normalizeCaseSummary(caseItem, projectId, index === 0 ? demoCase() : {
        ...demoCase(),
        id: `case-${index + 1}`,
        caseDir: `case-${index + 1}`,
        folderName: `case-${index + 1}`,
        title: `案件 ${index + 1}`
      }));
      const firstCase = cases[0] ?? normalizeCaseSummary(demoCase(), projectId, demoCase());
      const normalizedProject: ProjectSummary = {
        id: projectId,
        name: text(project.name, "演示 S4HANA"),
        sapVersion: sapVersion(project.sapVersion),
        systemLabel: text(project.systemLabel, "DEV/100"),
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
    const requestedProjectId = safeId(state.activeProjectId, DEMO_PROJECT_ID);
    const activeProject = normalizedProjects.find((project) => project.id === requestedProjectId) ?? normalizedProjects[0] ?? demoProject();
    const requestedCaseId = safeId(state.activeCaseId, activeProject.cases[0]?.id ?? DEMO_CASE_ID);
    const activeCase = activeProject.cases.find((caseItem) => caseItem.id === requestedCaseId) ?? activeProject.cases[0] ?? demoCase();
    syncProjectLocalStorage(activeProject, activeCase);
    return {
      ...state,
      schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
      activeProjectId: activeProject.id,
      activeCaseId: activeCase.id,
      projects: normalizedProjects
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
    const riskyValuePattern = /(bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{20,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{20,}|akia[0-9a-z]{16})/i;

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
      return { target: { kind: "adt-password" }, existingRef: project.config.adt.credential.secretRef };
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
    const firstCase = project.cases[0] ?? demoCase();
    const fallback = defaultProjectConfig(project.id, project.projectDir || project.id, firstCase.folderName || firstCase.id);
    const adt = candidate.adt ?? fallback.adt;
    const feishu = candidate.feishu ?? fallback.feishu;
    const codex = candidate.codex ?? fallback.codex;
    const providers = Array.isArray(candidate.apiProviders) && candidate.apiProviders.length > 0 ? candidate.apiProviders : fallback.apiProviders;
    const existingConfig = project.config;

    const alias = text(adt.alias, fallback.adt.alias);
    const url = text(adt.url, fallback.adt.url);
    const client = text(adt.client, fallback.adt.client);
    const username = text(adt.username, fallback.adt.username);
    const language = text(adt.language, fallback.adt.language).toUpperCase() || "ZH";
    const preserveVerification = options.preserveVerification === true;
    const adtConfigStatus = savedOrEmptyStatus(alias, url, client, username);
    const configUpdatedAt = nullableIso(candidate.updatedAt) ?? nullableIso(existingConfig?.updatedAt) ?? fallback.updatedAt;
    const localStorage = normalizeLocalStorageConfig(project, candidate.localStorage, fallback.localStorage);

    return {
      schemaVersion: 2,
      projectId: project.id,
      updatedAt: configUpdatedAt,
      adt: {
        alias,
        url,
        client,
        username,
        language,
        sslMode: sslMode(adt.sslMode),
        readOnly: true,
        credential: normalizeSecretHandle(existingConfig?.adt?.credential, "adt-password"),
        configStatus: preserveVerification ? normalizeConfigStatus(adt.configStatus, adtConfigStatus) : adtConfigStatus,
        connectionStatus: preserveVerification ? normalizeConfigStatus(adt.connectionStatus, "pending-verification") : "pending-verification",
        minimalReadStatus: preserveVerification ? normalizeConfigStatus(adt.minimalReadStatus, "pending-verification") : "pending-verification",
        lastVerificationMode: preserveVerification ? adtVerificationMode(adt.lastVerificationMode) : null,
        lastCheckedAt: preserveVerification ? nullableIso(adt.lastCheckedAt) : null
      },
      feishu: {
        profile: text(feishu.profile, fallback.feishu.profile),
        cliPath: text(feishu.cliPath, fallback.feishu.cliPath),
        credential: normalizeSecretHandle(existingConfig?.feishu?.credential, "feishu-token"),
        authStatus: preserveVerification ? normalizeConfigStatus(feishu.authStatus, "pending-verification") : "pending-verification",
        docPermissionStatus: preserveVerification ? normalizeConfigStatus(feishu.docPermissionStatus, "pending-verification") : "pending-verification",
        lastCheckedAt: preserveVerification ? nullableIso(feishu.lastCheckedAt) : null
      },
      apiProviders: providers.slice(0, 6).map((provider, index) => {
        const id = text(provider.id, `provider-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "-") || `provider-${index + 1}`;
        const name = text(provider.name, `API 渠道 ${index + 1}`);
        const baseUrl = text(provider.baseUrl);
        const existingProvider = existingConfig?.apiProviders?.find((item) => item.id === id);
        const models = preserveVerification ? normalizeModels(provider.models) : [];
        const lastVerifiedModelId = preserveVerification && typeof provider.lastVerifiedModelId === "string" && models.some((model) => model.id === provider.lastVerifiedModelId)
          ? provider.lastVerifiedModelId
          : null;
        return {
          id,
          name,
          providerType: providerType(provider.providerType),
          baseUrl,
          enabled: bool(provider.enabled, false),
          credential: normalizeSecretHandle(existingProvider?.credential, "api-key"),
          models,
          modelSyncStatus: preserveVerification ? normalizeConfigStatus(provider.modelSyncStatus, "pending-verification") : "pending-verification",
          chatTestStatus: preserveVerification ? normalizeConfigStatus(provider.chatTestStatus, "pending-verification") : "pending-verification",
          lastVerificationMode: preserveVerification ? modelVerificationMode(provider.lastVerificationMode) : null,
          lastVerifiedModelId,
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

  private ensureDemoProject(state: StoredState): ProjectSummary {
    let project = state.projects.find((item) => item.id === DEMO_PROJECT_ID);
    if (!project) {
      project = demoProject();
      state.projects.unshift(project);
    }
    return project;
  }

  private getActiveCase(state: StoredState): CaseSummary {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureDemoProject(state);
    let caseItem = project.cases.find((item) => item.id === state.activeCaseId);
    if (!caseItem) {
      caseItem = demoCase();
      project.cases.unshift(caseItem);
      state.activeCaseId = caseItem.id;
    }
    return caseItem;
  }

  private caseRoot(state: StoredState): string {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureDemoProject(state);
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
    await fs.writeFile(safeTarget, file.content, "utf8");
  }

  private async ensureCaseFiles(state: StoredState): Promise<void> {
    const caseItem = this.getActiveCase(state);
    const project = state.projects.find((item) => item.id === caseItem.projectId) ?? this.ensureDemoProject(state);
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
      fs.writeFile(this.assertInsideWorkspace(path.join(standardsRoot, "project-standards.md")), renderProjectStandardsMarkdown(project.standards), "utf8")
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
      fs.writeFile(this.assertInsideWorkspace(path.join(knowledgeRoot, "project-knowledge.md")), renderProjectKnowledgeMarkdown(project.knowledge), "utf8")
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
      connectionState: project.connectionState,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      config: project.config,
      standards: project.standards,
      knowledge: project.knowledge,
      safety: "no-secrets-local-project"
    });
  }

  private async writeCaseMarkdown(state: StoredState, caseItem: CaseSummary, artifacts: CaseWorkflowArtifacts): Promise<void> {
    const project = state.projects.find((item) => item.id === caseItem.projectId) ?? this.ensureDemoProject(state);
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    const generatedWrites = artifacts.generatedFiles.map(async (file) => {
      await this.writeGeneratedFile(caseRoot, file);
    });

    await Promise.all([
      this.writeProjectMetadata(project),
      this.writeJsonAtomic(path.join(caseRoot, "messages.json"), caseItem.messages),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "README.md")), artifacts.readme, "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "conversation.md")), artifacts.conversation, "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "timeline.md")), artifacts.timeline, "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "context_pack.md")), artifacts.contextPack, "utf8"),
      this.writeJsonAtomic(path.join(caseRoot, "metadata.json"), artifacts.metadata),
      ...generatedWrites
    ]);
  }

  private async writeCaseGeneratedFiles(project: ProjectSummary, caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[]): Promise<void> {
    const caseRoot = await this.safeCaseRootForAccess(project, caseItem);
    await Promise.all(generatedFiles.map(async (file) => {
      await this.writeGeneratedFile(caseRoot, file);
    }));
  }

  private async withFiles(state: StoredState): Promise<WorkbenchState> {
    return {
      schemaVersion: state.schemaVersion,
      workspaceRoot: this.workspaceRoot,
      activeProjectId: state.activeProjectId,
      activeCaseId: state.activeCaseId,
      projects: state.projects,
      activeCaseFiles: await this.readCaseTree(state)
    };
  }

  private async readCaseTree(state: StoredState): Promise<CaseFileNode[]> {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureDemoProject(state);
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
