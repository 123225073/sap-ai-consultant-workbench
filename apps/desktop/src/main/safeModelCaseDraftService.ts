import type { CaseGeneratedFile, ProjectSummary, TaskMode } from "../shared/workbenchTypes";

export const SAFE_MODEL_CONTEXT_ALLOWED_FIELDS = [
  "taskMode",
  "taskLabel",
  "userInputSummary",
  "caseTitle",
  "caseSummary",
  "sapVersion",
  "standardsSummary",
  "knowledgeReferences",
  "safeOutputSummaries",
  "boundary"
] as const;

export const safeModelDraftBoundary = "安全模型草稿：只使用当前输入、案件摘要、项目规范摘要、已引用已发布知识摘要和安全输出摘要；只生成本地草稿，不读取 SAP、不写 SAP、不发布飞书、不保存密钥。";

const MAX_USER_INPUT_CHARS = 1200;
const MAX_CASE_TITLE_CHARS = 160;
const MAX_CASE_SUMMARY_CHARS = 500;
const MAX_STANDARDS_SUMMARY_CHARS = 300;
const MAX_KNOWLEDGE_REFERENCES = 5;
const MAX_KNOWLEDGE_TITLE_CHARS = 140;
const MAX_KNOWLEDGE_SUMMARY_CHARS = 420;
const MAX_KNOWLEDGE_SAP_OBJECTS = 8;
const MAX_SAFE_SUMMARIES = 5;
const MAX_SAFE_SUMMARY_CHARS = 360;
const MAX_MODEL_CONTEXT_CHARS = 5200;
const MAX_MODEL_DRAFT_CHARS = 5000;

const unsafeModelContextPatterns = [
  /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /secure-store:sec_[a-f0-9]{32}/i,
  /bearer\s+[a-z0-9._~+/=-]{12,}/i,
  /authorization\s*[:=]\s*[^\n\r]+/i,
  /cookie\s*[:=]\s*[^\n\r]+/i,
  /sap_sessionid/i,
  /mysapsso2/i,
  /sk-(?:proj-)?[a-z0-9_-]{20,}/i,
  /github_pat_[a-z0-9_]{20,}/i,
  /ghp_[a-z0-9]{20,}/i,
  /xox[baprs]-[a-z0-9-]{20,}/i,
  /akia[0-9a-z]{16}/i,
  /api[_-]?key\s*[:=]/i,
  /client[_-]?secret\s*[:=]/i,
  /access[_-]?key\s*[:=]/i,
  /secret\s*[:=]/i,
  /password\s*[:=]/i,
  /passwd\s*[:=]/i,
  /token\s*[:=]/i,
  /https?:\/\/[^\s)]+/i,
  /\b(metadata|messages|project|app-state)\.json\b/i,
  /(^|[\\/])(technical|evidence|snapshots)([\\/]|$)/i,
  /^\s*(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION|FORM|MODULE|METHOD)\s+[\w/]+/im,
  /^\s*(DATA|TYPES|CONSTANTS|SELECT-OPTIONS|PARAMETERS)\s*[:\s]/im,
  /\bLOOP\s+AT\b|\bREAD\s+TABLE\b|\bAPPEND\s+.+\s+TO\b/i,
  /\bENDCLASS\b|\bENDFUNCTION\b|\bENDFORM\b|\bENDMETHOD\b/i,
  /\bSELECT\s+[\s\S]{0,300}\s+FROM\s+[\w/]+/i,
  /\bCALL\s+(FUNCTION|TRANSACTION)\b/i,
  /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
];

export interface SafeModelOutputSummaryInput {
  displayName: string;
  fileType: string;
  snippet: string;
}

export interface SafeModelKnowledgeReferenceInput {
  title: string;
  summary: string;
  sourceType: string;
  sapObjects: string[];
  publishedAt: string | null;
  attachedAt: string;
}

export interface SafeModelDraftContextInput {
  taskMode: TaskMode;
  taskLabel: string;
  userInput: string;
  caseTitle: string;
  caseSummary: string;
  sapVersion: ProjectSummary["sapVersion"];
  standardsSummary: string;
  knowledgeReferences: SafeModelKnowledgeReferenceInput[];
  safeOutputSummaries: SafeModelOutputSummaryInput[];
}

export interface SafeModelDraftMessage {
  role: "system" | "user";
  content: string;
}

export interface SafeModelDraftContextAudit {
  allowedFields: typeof SAFE_MODEL_CONTEXT_ALLOWED_FIELDS;
  contextCharCount: number;
  referencedKnowledgeCount: number;
  safeOutputSummaryCount: number;
  maxContextChars: number;
  createdAt: string;
}

export interface SafeModelDraftContext {
  messages: SafeModelDraftMessage[];
  audit: SafeModelDraftContextAudit;
}

export interface SafeModelDraftRunSuccess {
  status: "success";
  providerName: string;
  modelId: string;
  generatedAt: string;
  content: string;
  contextAudit: SafeModelDraftContextAudit;
}

export interface SafeModelDraftRunFailed {
  status: "failed";
  providerName: string;
  modelId: string;
  generatedAt: string;
  errorMessage: string;
  contextAudit: SafeModelDraftContextAudit;
}

export type SafeModelDraftRun = SafeModelDraftRunSuccess | SafeModelDraftRunFailed;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hasTableLikeRows(value: string): boolean {
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const structuredRows = lines.filter((line) => line.split(/\t|,|\|/).filter((cell) => cell.trim().length > 0).length >= 4);
  return structuredRows.length >= 3;
}

export function assertNoUnsafeModelContextText(label: string, value: string): void {
  if (unsafeModelContextPatterns.some((pattern) => pattern.test(value)) || hasTableLikeRows(value)) {
    throw new Error(`模型上下文中的${label}未通过安全检查，已改用本地草稿边界。`);
  }
}

function safeField(label: string, value: string, maxLength: number): string {
  const normalized = normalizeText(value, maxLength);
  assertNoUnsafeModelContextText(label, normalized);
  return normalized || "未提供";
}

export function safeModelDraftDisplayValue(label: string, value: string, fallback = "已脱敏"): string {
  try {
    return safeField(label, value, 160);
  } catch {
    return fallback;
  }
}

function safeSummary(item: SafeModelOutputSummaryInput): SafeModelOutputSummaryInput {
  return {
    displayName: safeField("安全输出文件名", item.displayName, 120),
    fileType: safeField("安全输出文件类型", item.fileType, 24).replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "text",
    snippet: safeField("安全输出摘要", item.snippet, MAX_SAFE_SUMMARY_CHARS)
  };
}

function safeKnowledgeReference(item: SafeModelKnowledgeReferenceInput): SafeModelKnowledgeReferenceInput {
  return {
    title: safeField("已引用知识标题", item.title, MAX_KNOWLEDGE_TITLE_CHARS),
    summary: safeField("已引用知识摘要", item.summary, MAX_KNOWLEDGE_SUMMARY_CHARS),
    sourceType: safeField("已引用知识来源类型", item.sourceType, 40).replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "knowledge",
    sapObjects: item.sapObjects
      .slice(0, MAX_KNOWLEDGE_SAP_OBJECTS)
      .map((sapObject) => safeField("已引用知识 SAP 对象", sapObject, 80))
      .filter((sapObject) => sapObject !== "未提供"),
    publishedAt: item.publishedAt ? safeField("已引用知识发布时间", item.publishedAt, 40) : null,
    attachedAt: safeField("已引用知识加入时间", item.attachedAt, 40)
  };
}

export function buildSafeModelDraftContext(input: SafeModelDraftContextInput): SafeModelDraftContext {
  const safeSummaries = input.safeOutputSummaries.slice(0, MAX_SAFE_SUMMARIES).map(safeSummary);
  const safeKnowledgeReferences = input.knowledgeReferences.slice(0, MAX_KNOWLEDGE_REFERENCES).map(safeKnowledgeReference);
  const userInputSummary = safeField("用户输入摘要", input.userInput, MAX_USER_INPUT_CHARS);
  const caseTitle = safeField("案件标题", input.caseTitle, MAX_CASE_TITLE_CHARS);
  const caseSummary = safeField("案件摘要", input.caseSummary, MAX_CASE_SUMMARY_CHARS);
  const standardsSummary = safeField("项目规范摘要", input.standardsSummary, MAX_STANDARDS_SUMMARY_CHARS);
  const taskLabel = safeField("任务模式", input.taskLabel, 40);
  const sapVersion = input.sapVersion === "S4" || input.sapVersion === "ECC" ? input.sapVersion : "UNKNOWN";

  const summaryLines = safeSummaries.length > 0
    ? safeSummaries.map((item, index) => `${index + 1}. ${item.displayName}（${item.fileType}）：${item.snippet}`)
    : ["无可用安全输出摘要。"];
  const knowledgeReferenceLines = safeKnowledgeReferences.length > 0
    ? safeKnowledgeReferences.map((item, index) => {
        const sapObjects = item.sapObjects.length > 0 ? item.sapObjects.join("、") : "未提供";
        return `${index + 1}. ${item.title}：${item.summary}；SAP对象：${sapObjects}；来源：${item.sourceType}；发布时间：${item.publishedAt ?? "未提供"}；引用时间：${item.attachedAt}`;
      })
    : ["当前案件未加入已发布知识摘要。"];

  const userContext = [
    "请基于以下安全上下文生成一份当前案件的本地草稿回复。",
    "",
    `任务模式：${taskLabel}`,
    `用户输入摘要：${userInputSummary}`,
    `案件标题：${caseTitle}`,
    `案件当前摘要：${caseSummary}`,
    `SAP 版本：${sapVersion}`,
    `项目规范摘要：${standardsSummary}`,
    "",
    "已引用已发布知识摘要：",
    ...knowledgeReferenceLines,
    "",
    "安全输出摘要：",
    ...summaryLines,
    "",
    `边界：${safeModelDraftBoundary}`,
    "",
    "输出要求：",
    "1. 只写可编辑的本地草稿，不声称已经读取 SAP。",
    "2. 不输出 SAP 写入、激活、传输释放或飞书发布动作。",
    "3. 如果证据不足，明确写“待用户确认”。",
    "4. 用简洁中文输出结论、建议和下一步。"
  ].join("\n").slice(0, MAX_MODEL_CONTEXT_CHARS);

  assertNoUnsafeModelContextText("完整模型上下文", userContext);

  const systemContent = [
    "你是 SAP AI 顾问工作台的本地草稿助手。",
    "你只能使用用户提供的安全上下文生成回复。",
    "不要要求或推断密钥，不要编造已读取 SAP、已发布飞书或已写入外部系统。",
    safeModelDraftBoundary
  ].join("\n");

  const messages: SafeModelDraftMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContext }
  ];
  const contextCharCount = messages.reduce((total, message) => total + message.content.length, 0);

  return {
    messages,
    audit: {
      allowedFields: SAFE_MODEL_CONTEXT_ALLOWED_FIELDS,
      contextCharCount,
      referencedKnowledgeCount: safeKnowledgeReferences.length,
      safeOutputSummaryCount: safeSummaries.length,
      maxContextChars: MAX_MODEL_CONTEXT_CHARS,
      createdAt: nowIso()
    }
  };
}

export function assertSafeModelDraftResponseText(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim().slice(0, MAX_MODEL_DRAFT_CHARS);
  if (!normalized) {
    throw new Error("模型没有返回可保存的草稿内容。");
  }
  assertNoUnsafeModelContextText("模型草稿回复", normalized);
  return normalized;
}

function csvLine(label: string, value: string | number): string {
  const safe = String(value).replaceAll("\"", "\"\"");
  return `"${label}","${safe}"`;
}

export function renderSafeModelDraftFiles(run: SafeModelDraftRun): CaseGeneratedFile[] {
  const providerName = safeModelDraftDisplayValue("模型渠道", run.providerName, "已验证模型渠道");
  const modelId = safeModelDraftDisplayValue("模型名称", run.modelId, "已验证模型");
  if (run.status === "failed") {
    const errorMessage = safeModelDraftDisplayValue("模型失败原因", run.errorMessage, "模型调用失败，未保存原始错误。");
    return [
      {
        relativePath: "outputs/安全模型执行说明.md",
        purpose: "output",
        content: [
          "# 安全模型执行说明",
          "",
          "状态：模型草稿未生成",
          "",
          `模型：${modelId}`,
          `渠道：${providerName}`,
          `时间：${run.generatedAt}`,
          "",
          "## 失败原因",
          "",
          errorMessage,
          "",
          "## 安全边界",
          "",
          `- ${safeModelDraftBoundary}`,
          "- 本次未写入 SAP，未发布飞书，未保存原始模型请求或响应。"
        ].join("\n")
      }
    ];
  }

  return [
    {
      relativePath: "outputs/安全模型回复草稿.md",
      purpose: "output",
      content: [
        "# 安全模型回复草稿",
        "",
        "状态：本地草稿，待用户确认",
        "",
        `模型：${modelId}`,
        `渠道：${providerName}`,
        `时间：${run.generatedAt}`,
        "",
        "## 草稿内容",
        "",
        run.content,
        "",
        "## 安全边界",
        "",
        `- ${safeModelDraftBoundary}`,
        "- 本文件不包含原始 prompt、完整上下文、密钥、SAP 写入动作或飞书发布动作。"
      ].join("\n")
    },
    {
      relativePath: "outputs/安全模型上下文摘要.csv",
      purpose: "output",
      content: [
        csvLine("模型", modelId),
        csvLine("渠道", providerName),
        csvLine("上下文字数", run.contextAudit.contextCharCount),
        csvLine("已引用知识摘要数量", run.contextAudit.referencedKnowledgeCount),
        csvLine("安全输出摘要数量", run.contextAudit.safeOutputSummaryCount),
        csvLine("允许字段", run.contextAudit.allowedFields.join(";")),
        csvLine("生成时间", run.generatedAt)
      ].join("\n") + "\n"
    }
  ];
}
