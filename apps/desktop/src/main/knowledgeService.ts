import { createHash } from "node:crypto";
import type {
  CaseKnowledgeReference,
  CaseGeneratedFile,
  CaseSummary,
  KnowledgeCaseReferenceInput,
  KnowledgeDocumentJob,
  KnowledgeEditInput,
  KnowledgeImportLocalTextInput,
  KnowledgeImportSourceKind,
  KnowledgeImportTextFileInput,
  KnowledgeImportTextFileMetadata,
  KnowledgeItem,
  KnowledgeItemActionInput,
  KnowledgeReviewChecklist,
  KnowledgeReviewInput,
  KnowledgeItemStatus,
  KnowledgeItemType,
  KnowledgeSourceType,
  KnowledgeStatusCounts,
  KnowledgeTimelineEvent,
  ProjectKnowledgeBase,
  ProjectKnowledgeView,
  ProjectSummary
} from "../shared/workbenchTypes";

const MAX_KNOWLEDGE_TIMELINE_EVENTS = 50;
const PHASE21_KNOWLEDGE_EDIT_REVIEW_MARKER = "phase21-knowledge-edit-conflict-resolution";
const PHASE24_CASE_KNOWLEDGE_CANDIDATE_PROJECTION_MARKER = "phase24-case-knowledge-candidate-projection";
export const PHASE22_PUBLISHED_KNOWLEDGE_CASE_CONTEXT_MARKER = "phase22-published-knowledge-case-context";
export const LOCAL_KNOWLEDGE_REVIEWER_LABEL = "本机用户";
export const KNOWLEDGE_IMPORT_ALLOWED_KEYS = new Set(["projectId", "title", "sourceKind", "sourceName", "body", "sapObjects"]);
export const KNOWLEDGE_EDIT_ALLOWED_KEYS = new Set(["itemId", "title", "summary", "content", "sapObjects", "effectiveFrom", "effectiveTo", "note"]);
export const MAX_KNOWLEDGE_IMPORT_BODY_LENGTH = 8000;
export const MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES = 32 * 1024;
export const KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_EXTENSIONS = [".md", ".markdown", ".txt"] as const;
const MAX_CASE_CANDIDATE_TITLE_LENGTH = 120;
const MAX_CASE_CANDIDATE_SUMMARY_LENGTH = 500;
const MAX_CASE_CANDIDATE_CONTENT_LENGTH = 1600;
const MAX_KNOWLEDGE_IMPORT_TITLE_LENGTH = 120;
const MAX_KNOWLEDGE_IMPORT_SOURCE_NAME_LENGTH = 160;
const MAX_KNOWLEDGE_IMPORT_SAP_OBJECTS = 12;
const KNOWLEDGE_IMPORT_ALLOWED_SOURCE_KINDS = new Set<KnowledgeImportSourceKind>(["local-text", "markdown-note", "qa-text"]);
const KNOWLEDGE_REVIEW_ALLOWED_KEYS = new Set(["itemId", "note", "checklist"]);
export const KNOWLEDGE_CASE_REFERENCE_ALLOWED_KEYS = new Set(["itemId", "note"]);
const KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_KEYS = new Set(["projectId"]);

const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeItemStatus, string> = {
  draft: "草稿",
  pending: "待确认",
  published: "已发布",
  conflicted: "有冲突",
  expired: "已失效"
};

const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeItemType, string> = {
  qa: "QA 问答",
  doc: "文档知识",
  sap_object: "SAP 对象说明",
  case_note: "案件经验",
  timeline_fact: "时间线事实"
};

const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSourceType, string> = {
  "case-candidate": "案件候选",
  "document-import": "文档导入",
  "qa-import": "QA 导入",
  manual: "人工维护"
};

function nowIso(): string {
  return new Date().toISOString();
}

function knowledgeDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

function localDateKey(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function hasKnowledgeEffectivePeriodEnded(item: Pick<KnowledgeItem, "effectiveTo">, at?: string): boolean {
  const effectiveTo = knowledgeDateKey(item.effectiveTo);
  const referenceDate = at ? knowledgeDateKey(at) : localDateKey();
  return Boolean(effectiveTo && referenceDate && effectiveTo < referenceDate);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeId(value: unknown, fallback: string): string {
  const raw = text(value, fallback);
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function safePersistedText(value: unknown, fallback = ""): string {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  assertNoSensitiveKnowledgeContent(raw);
  return raw;
}

function event(action: KnowledgeTimelineEvent["action"], note: string, at = nowIso()): KnowledgeTimelineEvent {
  return {
    id: `ke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at,
    action,
    note
  };
}

function knowledgeReviewContentHash(item: Pick<KnowledgeItem, "title" | "summary" | "content" | "sapObjects" | "effectiveFrom" | "effectiveTo" | "sourceFilePath">): string {
  return createHash("sha256").update(JSON.stringify({
    title: item.title,
    summary: item.summary,
    content: item.content,
    sapObjects: item.sapObjects,
    effectiveFrom: item.effectiveFrom,
    effectiveTo: item.effectiveTo,
    sourceFilePath: item.sourceFilePath
  }), "utf8").digest("hex");
}

function hasCompleteReviewChecklist(value: unknown): value is KnowledgeReviewChecklist {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KnowledgeReviewChecklist>;
  return candidate.sourceAndScopeConfirmed === true &&
    candidate.noSecretsConfirmed === true &&
    candidate.noSapSourceOrWriteOpsConfirmed === true &&
    candidate.noCustomerDetailsConfirmed === true;
}

function demoKnowledgeItems(projectId: string): KnowledgeItem[] {
  const createdAt = "2026-07-02T10:32:00.000Z";
  return [
    {
      id: "knowledge-demo-pending-bom",
      projectId,
      title: "演示BOM筛选规则",
      type: "case_note",
      status: "pending",
      sourceType: "case-candidate",
      sourceCaseId: "demo001",
      sourceFilePath: "knowledge_candidates/案件经验候选.md",
      sapObjects: ["DEMO001"],
      summary: "演示BOM清单筛选时，应以当前业务确认的工厂范围为准。",
      content: "演示BOM清单筛选时，应以当前业务确认的工厂范围为准，旧口径仅作为历史参考。该条仍需人工确认后才能成为正式知识。",
      confidence: 0.92,
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
      reviewer: null,
      reviewedAt: null,
      reviewNote: null,
      reviewedContentHash: null,
      reviewChecklist: null,
      conflictWithIds: [],
      createdAt,
      updatedAt: createdAt,
      publishedAt: null,
      timeline: [event("created", "从演示案件生成待确认知识。", createdAt)]
    },
    {
      id: "knowledge-demo-published-comment",
      projectId,
      title: "字段含义补充",
      type: "doc",
      status: "published",
      sourceType: "document-import",
      sourceCaseId: null,
      sourceFilePath: "knowledge/documents/字段说明.docx",
      sapObjects: ["DEMO_TABLE"],
      summary: "字段说明类知识已人工确认，可用于文档生成和检索。",
      content: "字段说明类知识应记录业务含义、适用范围和来源文档，不把未确认口径直接作为正式结论。",
      confidence: 0.95,
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
      reviewer: LOCAL_KNOWLEDGE_REVIEWER_LABEL,
      reviewedAt: "2026-07-01T09:00:00.000Z",
      reviewNote: "本机用户确认字段说明可作为正式知识。",
      reviewedContentHash: null,
      reviewChecklist: {
        sourceAndScopeConfirmed: true,
        noSecretsConfirmed: true,
        noSapSourceOrWriteOpsConfirmed: true,
        noCustomerDetailsConfirmed: true
      },
      conflictWithIds: [],
      createdAt: "2026-07-01T08:20:00.000Z",
      updatedAt: "2026-07-01T09:00:00.000Z",
      publishedAt: "2026-07-01T09:00:00.000Z",
      timeline: [
        event("created", "从演示文档解析为知识候选。", "2026-07-01T08:20:00.000Z"),
        event("published", "本机用户确认入库。", "2026-07-01T09:00:00.000Z")
      ]
    },
    {
      id: "knowledge-demo-conflict-interface",
      projectId,
      title: "演示接口口径",
      type: "qa",
      status: "conflicted",
      sourceType: "qa-import",
      sourceCaseId: null,
      sourceFilePath: "knowledge/imports/演示接口QA.xlsx",
      sapObjects: ["DEMO_API"],
      summary: "该接口口径与当前项目 SAP 版本存在冲突，不能直接覆盖正式知识。",
      content: "演示接口口径来自历史 QA，适用范围和当前项目存在差异，必须先确认冲突后才能继续处理。",
      confidence: 0.76,
      effectiveFrom: null,
      effectiveTo: null,
      reviewer: null,
      reviewedAt: null,
      reviewNote: null,
      reviewedContentHash: null,
      reviewChecklist: null,
      conflictWithIds: ["knowledge-demo-published-comment"],
      createdAt: "2026-07-01T11:00:00.000Z",
      updatedAt: "2026-07-01T11:30:00.000Z",
      publishedAt: null,
      timeline: [
        event("created", "从演示 QA 导入。", "2026-07-01T11:00:00.000Z"),
        event("marked-conflicted", "检测到适用范围冲突。", "2026-07-01T11:30:00.000Z")
      ]
    }
  ];
}

function demoDocumentJobs(projectId: string): KnowledgeDocumentJob[] {
  return [
    {
      id: "docjob-demo-dev-spec",
      projectId,
      title: "开发说明书_DEMO001.docx",
      source: "upload",
      status: "queued",
      detail: "当前只保留后续解析入口，尚未读取或解析真实 Word 文档。",
      createdAt: "2026-07-02T09:00:00.000Z",
      updatedAt: "2026-07-02T09:12:00.000Z"
    },
    {
      id: "docjob-demo-check",
      projectId,
      title: "演示BOM核对.xlsx",
      source: "qa-import",
      status: "blocked",
      detail: "QA 导入将在后续阶段启用，当前不读取真实表格。",
      createdAt: "2026-07-02T09:18:00.000Z",
      updatedAt: "2026-07-02T09:28:00.000Z"
    },
    {
      id: "docjob-demo-meeting",
      projectId,
      title: "历史会议纪要.pdf",
      source: "upload",
      status: "blocked",
      detail: "当前本地阶段不解析 PDF 正文，只记录待处理队列。",
      createdAt: "2026-07-02T09:30:00.000Z",
      updatedAt: "2026-07-02T09:30:00.000Z"
    }
  ];
}

function normalizeStatus(value: unknown): KnowledgeItemStatus {
  if (value === "draft" || value === "pending" || value === "published" || value === "conflicted" || value === "expired") return value;
  return "pending";
}

function normalizeType(value: unknown): KnowledgeItemType {
  if (value === "qa" || value === "doc" || value === "sap_object" || value === "case_note" || value === "timeline_fact") return value;
  return "case_note";
}

function normalizeSourceType(value: unknown): KnowledgeSourceType {
  if (value === "document-import" || value === "qa-import" || value === "manual") return value;
  return "case-candidate";
}

function normalizeTimeline(value: unknown, fallbackNote: string, fallbackAt: string): KnowledgeTimelineEvent[] {
  if (!Array.isArray(value)) return [event("created", fallbackNote, fallbackAt)];
  const normalized = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<KnowledgeTimelineEvent>;
    const action: KnowledgeTimelineEvent["action"] = candidate.action === "reviewed" || candidate.action === "published" || candidate.action === "marked-conflicted" || candidate.action === "expired" || candidate.action === "edited" || candidate.action === "parsed" ? candidate.action : "created";
    const at = typeof candidate.at === "string" ? candidate.at : fallbackAt;
    return [{
      id: safeId(candidate.id, `ke-${at.replace(/[^0-9]/g, "")}`),
      at,
      action,
      note: safePersistedText(candidate.note, fallbackNote)
    }];
  });
  return normalized.length > 0
    ? normalized.slice(-MAX_KNOWLEDGE_TIMELINE_EVENTS)
    : [event("created", fallbackNote, fallbackAt)];
}

function normalizeKnowledgeItem(projectId: string, value: unknown): KnowledgeItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<KnowledgeItem>;
  const id = safeId(candidate.id, `knowledge-${Date.now()}`);
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso();
  const title = safePersistedText(candidate.title, "未命名知识");
  const summary = safePersistedText(candidate.summary, title);
  const content = safePersistedText(candidate.content, summary);
  return {
    id,
    projectId,
    title,
    type: normalizeType(candidate.type),
    status: normalizeStatus(candidate.status),
    sourceType: normalizeSourceType(candidate.sourceType),
    sourceCaseId: typeof candidate.sourceCaseId === "string" ? safeId(candidate.sourceCaseId, candidate.sourceCaseId) : null,
    sourceFilePath: typeof candidate.sourceFilePath === "string" ? candidate.sourceFilePath.replaceAll("\\", "/") : null,
    sapObjects: Array.isArray(candidate.sapObjects) ? candidate.sapObjects.map((item) => text(item)).filter(Boolean) : [],
    summary,
    content,
    confidence: typeof candidate.confidence === "number" && candidate.confidence >= 0 && candidate.confidence <= 1 ? candidate.confidence : null,
    effectiveFrom: typeof candidate.effectiveFrom === "string" ? candidate.effectiveFrom : null,
    effectiveTo: typeof candidate.effectiveTo === "string" ? candidate.effectiveTo : null,
    reviewer: typeof candidate.reviewer === "string" ? candidate.reviewer : null,
    reviewedAt: typeof candidate.reviewedAt === "string" ? candidate.reviewedAt : null,
    reviewNote: typeof candidate.reviewNote === "string" ? safePersistedText(candidate.reviewNote, "") : null,
    reviewedContentHash: typeof candidate.reviewedContentHash === "string" && /^[a-f0-9]{64}$/i.test(candidate.reviewedContentHash) ? candidate.reviewedContentHash.toLowerCase() : null,
    reviewChecklist: hasCompleteReviewChecklist(candidate.reviewChecklist) ? {
      sourceAndScopeConfirmed: true,
      noSecretsConfirmed: true,
      noSapSourceOrWriteOpsConfirmed: true,
      noCustomerDetailsConfirmed: true
    } : null,
    conflictWithIds: Array.isArray(candidate.conflictWithIds) ? candidate.conflictWithIds.map((item) => safeId(item, "")).filter(Boolean) : [],
    createdAt,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt,
    publishedAt: typeof candidate.publishedAt === "string" ? candidate.publishedAt : null,
    timeline: normalizeTimeline(candidate.timeline, "知识项已创建。", createdAt)
  };
}

function normalizeDocumentJob(projectId: string, value: unknown): KnowledgeDocumentJob | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<KnowledgeDocumentJob>;
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso();
  const source = candidate.source === "qa-import" || candidate.source === "local-text" ? candidate.source : "upload";
  const status = candidate.status === "parsed" || candidate.status === "needs-review" || candidate.status === "blocked" ? candidate.status : "queued";
  return {
    id: safeId(candidate.id, `docjob-${Date.now()}`),
    projectId,
    title: safePersistedText(candidate.title, "未命名文档"),
    source,
    status,
    detail: safePersistedText(candidate.detail, "等待本地解析。"),
    createdAt,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt
  };
}

export function createProjectKnowledge(projectId: string, seedDemo = false): ProjectKnowledgeBase {
  const updatedAt = nowIso();
  return {
    schemaVersion: 1,
    projectId,
    items: seedDemo ? demoKnowledgeItems(projectId) : [],
    documentJobs: seedDemo ? demoDocumentJobs(projectId) : [],
    updatedAt
  };
}

export function normalizeProjectKnowledge(projectId: string, value: unknown, seedDemo = false): ProjectKnowledgeBase {
  if (!value || typeof value !== "object") {
    return createProjectKnowledge(projectId, seedDemo);
  }
  const candidate = value as Partial<ProjectKnowledgeBase>;
  const items = (Array.isArray(candidate.items) ? candidate.items : [])
    .map((item) => normalizeKnowledgeItem(projectId, item))
    .filter((item): item is KnowledgeItem => Boolean(item));
  const documentJobs = (Array.isArray(candidate.documentJobs) ? candidate.documentJobs : [])
    .map((job) => normalizeDocumentJob(projectId, job))
    .filter((job): job is KnowledgeDocumentJob => Boolean(job));
  return {
    schemaVersion: 1,
    projectId,
    items: items.length > 0 || !seedDemo ? items : demoKnowledgeItems(projectId),
    documentJobs: documentJobs.length > 0 || !seedDemo ? documentJobs : demoDocumentJobs(projectId),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso()
  };
}

export function parseKnowledgeActionInput(input: unknown): KnowledgeItemActionInput {
  if (!input || typeof input !== "object") {
    throw new Error("知识项操作请求无效。");
  }
  const candidate = input as Partial<KnowledgeItemActionInput>;
  if (typeof candidate.itemId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(candidate.itemId)) {
    throw new Error("知识项 ID 无效。");
  }
  const note = typeof candidate.note === "string" ? candidate.note.trim() : "";
  if (note.length > 500) {
    throw new Error("知识操作说明不能超过 500 个字符。");
  }
  if (note) assertNoSensitiveKnowledgeContent(note);
  return { itemId: candidate.itemId, note };
}

export function parseKnowledgeCaseReferenceInput(input: unknown): KnowledgeCaseReferenceInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("知识引用请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !KNOWLEDGE_CASE_REFERENCE_ALLOWED_KEYS.has(key))) {
    throw new Error("知识引用请求包含不支持的字段。");
  }
  const actionInput = parseKnowledgeActionInput(input);
  return { itemId: actionInput.itemId, note: actionInput.note };
}

export function parseKnowledgeReviewInput(input: unknown): KnowledgeReviewInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("知识审核请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !KNOWLEDGE_REVIEW_ALLOWED_KEYS.has(key))) {
    throw new Error("知识审核请求包含不支持的字段。");
  }
  const candidate = input as Partial<KnowledgeReviewInput>;
  const actionInput = parseKnowledgeActionInput({ itemId: candidate.itemId, note: candidate.note });
  const note = (actionInput.note ?? "").trim();
  if (note.length < 8) {
    throw new Error("请填写至少 8 个字的审核备注，说明为什么这条候选可以进入正式知识库。");
  }
  if (!hasCompleteReviewChecklist(candidate.checklist)) {
    throw new Error("请完成审核清单：来源和范围、无密钥、无 SAP 源码或写操作、无客户明细都必须确认。");
  }
  assertNoSensitiveKnowledgeContent(note);
  return {
    itemId: actionInput.itemId,
    note,
    checklist: {
      sourceAndScopeConfirmed: true,
      noSecretsConfirmed: true,
      noSapSourceOrWriteOpsConfirmed: true,
      noCustomerDetailsConfirmed: true
    }
  };
}

function normalizeKnowledgeEditDate(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(`${label}必须是 YYYY-MM-DD 格式。`);
  }
  return value.trim();
}

export function parseKnowledgeEditInput(input: unknown): KnowledgeEditInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("知识编辑请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !KNOWLEDGE_EDIT_ALLOWED_KEYS.has(key))) {
    throw new Error("知识编辑请求包含不支持的字段。");
  }
  const candidate = input as Partial<KnowledgeEditInput>;
  const actionInput = parseKnowledgeActionInput({ itemId: candidate.itemId, note: candidate.note });
  const note = (actionInput.note ?? "").trim();
  if (note.length < 6) {
    throw new Error("请填写至少 6 个字的修改说明。");
  }
  const title = assertSafeKnowledgeImportText("知识标题", candidate.title, MAX_KNOWLEDGE_IMPORT_TITLE_LENGTH);
  const summary = assertSafeKnowledgeImportText("知识摘要", candidate.summary, 500);
  const content = assertSafeKnowledgeImportBody(candidate.content);
  const sapObjects = normalizeKnowledgeImportSapObjects(candidate.sapObjects);
  const effectiveFrom = normalizeKnowledgeEditDate("生效时间", candidate.effectiveFrom);
  const effectiveTo = normalizeKnowledgeEditDate("失效时间", candidate.effectiveTo);
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    throw new Error("失效时间不能早于生效时间。");
  }
  return {
    itemId: actionInput.itemId,
    title,
    summary,
    content,
    sapObjects,
    effectiveFrom,
    effectiveTo,
    note
  };
}

function assertStrictKnowledgeProjectId(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error("项目 ID 无效，无法导入知识候选。");
  }
  return value;
}

export function parseKnowledgeImportTextFileInput(input: unknown): KnowledgeImportTextFileInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("文本文件导入请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_KEYS.has(key))) {
    throw new Error("文本文件导入请求包含不支持的字段。");
  }
  return {
    projectId: assertStrictKnowledgeProjectId((input as Partial<KnowledgeImportTextFileInput>).projectId)
  };
}

function normalizeKnowledgeImportTextFileExtension(fileName: string): KnowledgeImportTextFileMetadata["extension"] {
  const lower = fileName.toLowerCase();
  const extension = KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_EXTENSIONS.find((item) => lower.endsWith(item));
  if (!extension) {
    throw new Error("只支持导入 Markdown 或 TXT 文件。");
  }
  return extension;
}

function titleFromKnowledgeImportFileName(fileName: string, extension: KnowledgeImportTextFileMetadata["extension"]): string {
  const withoutExtension = fileName.slice(0, fileName.length - extension.length).replace(/[_-]+/g, " ").trim();
  return withoutExtension || "文本文件知识候选";
}

export function createKnowledgeImportInputFromTextFile(input: {
  projectId: string;
  fileName: string;
  sizeBytes: number;
  body: string;
}): { importInput: KnowledgeImportLocalTextInput; metadata: KnowledgeImportTextFileMetadata } {
  const projectId = assertStrictKnowledgeProjectId(input.projectId);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error("文件为空，无法生成知识候选。");
  }
  if (input.sizeBytes > MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES) {
    throw new Error("文件太大，请拆成更小的已脱敏 Markdown 或 TXT 文本后再导入。");
  }
  const sourceName = assertSafeKnowledgeImportText("来源文件名", input.fileName, MAX_KNOWLEDGE_IMPORT_SOURCE_NAME_LENGTH);
  const extension = normalizeKnowledgeImportTextFileExtension(sourceName);
  const body = assertSafeKnowledgeImportBody(input.body);
  const sourceKind: KnowledgeImportSourceKind = extension === ".txt" ? "local-text" : "markdown-note";
  const title = assertSafeKnowledgeImportText("知识标题", titleFromKnowledgeImportFileName(sourceName, extension), MAX_KNOWLEDGE_IMPORT_TITLE_LENGTH);
  return {
    importInput: {
      projectId,
      title,
      sourceKind,
      sourceName,
      body,
      sapObjects: []
    },
    metadata: {
      sourceName,
      extension,
      sizeBytes: input.sizeBytes,
      characterCount: body.length
    }
  };
}

function assertSafeKnowledgeImportText(label: string, value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`${label}必须是文本。`);
  }
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!normalized) {
    throw new Error(`${label}不能为空。`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label}过长。`);
  }
  const lower = normalized.toLowerCase();
  const pathLike = (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.startsWith(".") ||
    /^[a-zA-Z]:/.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
    lower.includes(".env") ||
    lower.includes(".sap-adt-cli") ||
    lower.includes(".sap-abap-cli") ||
    lower.includes("messages.json") ||
    lower.includes("metadata.json") ||
    lower.includes("app-state.json") ||
    lower.includes("project.json")
  );
  const secretLike = /(authorization|cookie|password|passwd|api[_-]?key|client[_-]?secret|access[_-]?key|secret|credential|token|secure-store|sap_sessionid|mysapsso2)/i.test(normalized);
  if (pathLike || secretLike) {
    throw new Error(`${label}包含路径、内部文件名或敏感字段，已阻止。`);
  }
  assertNoSensitiveKnowledgeContent(normalized);
  return normalized;
}

function assertSafeKnowledgeImportBody(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("导入正文必须是文本。");
  }
  const body = value.replace(/\u0000/g, "").trim();
  if (!body) {
    throw new Error("导入正文不能为空。");
  }
  if (body.length > MAX_KNOWLEDGE_IMPORT_BODY_LENGTH) {
    throw new Error("导入正文过长，请先拆分为更小的已脱敏文本。");
  }
  assertNoSensitiveKnowledgeContent(body);
  const importUnsafePatterns = [
    /^\s*(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION|FORM|MODULE|METHOD)\s+[\w/]+/im,
    /^\s*(DATA|TYPES|CONSTANTS|SELECT-OPTIONS|PARAMETERS)\s*[:\s]/im,
    /\bSELECT\s+[\s\S]{0,300}\s+FROM\s+[\w/]+/i,
    /\bCALL\s+(FUNCTION|TRANSACTION)\b/i,
    /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
  ];
  if (importUnsafePatterns.some((pattern) => pattern.test(body))) {
    throw new Error("导入正文包含疑似 ABAP 源码或写操作片段，请先脱敏并改写为业务结论。");
  }
  const unsafeBodyMarkers = [
    /[A-Za-z]:[\\/]|\.{2}[\\/]|\/etc\/|\/users\/|\/home\//i,
    /\.env|\.sap-adt-cli|\.sap-abap-cli|messages\.json|metadata\.json|app-state\.json|project\.json/i
  ];
  if (unsafeBodyMarkers.some((pattern) => pattern.test(body))) {
    throw new Error("导入正文包含路径或内部文件名，请先改写为脱敏业务结论。");
  }
  const rows = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const structuredRows = rows.filter((line) => line.split(/\t|,|，|\||;|；/).filter((cell) => cell.trim().length > 0).length >= 5);
  if (structuredRows.length >= 6) {
    throw new Error("导入正文疑似包含成批业务表格数据，请先汇总为脱敏结论。");
  }
  const jsonLikeRows = rows.filter((line) => /^\s*[{[]/.test(line) || /["'][^"']{1,80}["']\s*:/.test(line));
  if (jsonLikeRows.length >= 3 || (body.trim().startsWith("[") && body.trim().endsWith("]"))) {
    throw new Error("导入正文疑似包含结构化明细数据，请先汇总为脱敏结论。");
  }
  return body;
}

function normalizeKnowledgeImportSourceKind(value: unknown): KnowledgeImportSourceKind {
  if (typeof value !== "string" || !KNOWLEDGE_IMPORT_ALLOWED_SOURCE_KINDS.has(value as KnowledgeImportSourceKind)) {
    throw new Error("导入来源类型不在允许范围内。");
  }
  return value as KnowledgeImportSourceKind;
}

function normalizeKnowledgeImportSapObjects(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("SAP 对象标签必须是数组。");
  }
  const objects = value.map((item) => assertSafeKnowledgeImportText("SAP 对象标签", item, 80));
  const uniqueObjects = [...new Set(objects)];
  if (uniqueObjects.length > MAX_KNOWLEDGE_IMPORT_SAP_OBJECTS) {
    throw new Error(`SAP 对象标签不能超过 ${MAX_KNOWLEDGE_IMPORT_SAP_OBJECTS} 个。`);
  }
  return uniqueObjects;
}

export function parseKnowledgeImportLocalTextInput(input: unknown): KnowledgeImportLocalTextInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("知识导入请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !KNOWLEDGE_IMPORT_ALLOWED_KEYS.has(key))) {
    throw new Error("知识导入请求包含不支持的字段。");
  }
  const candidate = input as Partial<KnowledgeImportLocalTextInput>;
  return {
    projectId: assertStrictKnowledgeProjectId(candidate.projectId),
    title: assertSafeKnowledgeImportText("知识标题", candidate.title, MAX_KNOWLEDGE_IMPORT_TITLE_LENGTH),
    sourceKind: normalizeKnowledgeImportSourceKind(candidate.sourceKind),
    sourceName: assertSafeKnowledgeImportText("来源名称", candidate.sourceName, MAX_KNOWLEDGE_IMPORT_SOURCE_NAME_LENGTH),
    body: assertSafeKnowledgeImportBody(candidate.body),
    sapObjects: normalizeKnowledgeImportSapObjects(candidate.sapObjects)
  };
}

export function assertNoSensitiveKnowledgeContent(content: string): void {
  const patterns = [
    /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    /secure-store:sec_[a-f0-9]{32}/i,
    /sk-[a-z0-9]{20,}/i,
    /ghp_[a-z0-9]{20,}/i,
    /github_pat_[a-z0-9_]{20,}/i,
    /xox[baprs]-[a-z0-9-]{20,}/i,
    /akia[0-9a-z]{16}/i,
    /bearer\s+[a-z0-9._-]{12,}/i,
    /authorization\s*[:=]/i,
    /cookie\s*[:=]/i,
    /x-csrf-token/i,
    /sap_sessionid/i,
    /mysapsso2/i,
    /app[_-]?secret\s*[:=]/i,
    /refresh[_-]?token\s*[:=]/i,
    /device[_-]?code\s*[:=]/i,
    /verification[_-]?uri\s*[:=]/i,
    /document[_-]?id\s*[:=]/i,
    /https?:\/\/[^\s]*(feishu|larksuite|larkoffice|open\.feishu)/i,
    /(^|[^a-z0-9_-])[tu]-[a-z0-9_-]{20,}($|[^a-z0-9_-])/i,
    /(^|[^a-z0-9_-])[a-z0-9_-]{48,}($|[^a-z0-9_-])/i,
    /tenant[_-]?access[_-]?token/i,
    /user[_-]?access[_-]?token/i,
    /api[_-]?key\s*[:=]/i,
    /password\s*[:=]/i,
    /passwd\s*[:=]/i,
    /token\s*[:=]/i,
    /^\s*(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION|FORM|MODULE|METHOD)\s+[\w/]+/im,
    /^\s*(DATA|TYPES|CONSTANTS|SELECT-OPTIONS|PARAMETERS)\s*[:\s]/im,
    /\bLOOP\s+AT\b|\bREAD\s+TABLE\b|\bAPPEND\s+.+\s+TO\b/i,
    /^\s*\*&[-=]{3,}/m,
    /\bENDCLASS\b|\bENDFUNCTION\b|\bENDFORM\b|\bENDMETHOD\b/i,
    /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
  ];
  if (patterns.some((pattern) => pattern.test(content))) {
    throw new Error("知识内容包含疑似密钥、授权信息或大段源码，已阻止入库。");
  }
}

export interface ImportedKnowledgeCandidate {
  job: KnowledgeDocumentJob;
  item: KnowledgeItem;
  artifact: CaseGeneratedFile;
}

function importedSourceLabel(sourceKind: KnowledgeImportSourceKind): string {
  if (sourceKind === "qa-text") return "QA 文本";
  if (sourceKind === "markdown-note") return "Markdown 笔记";
  return "本地文本";
}

export function createImportedKnowledgeCandidate(projectId: string, input: KnowledgeImportLocalTextInput, sourceFilePath: string): ImportedKnowledgeCandidate {
  const createdAt = nowIso();
  const suffix = `${createdAt.replace(/[^0-9]/g, "")}-${Math.random().toString(16).slice(2, 8)}`;
  const sourceLabel = importedSourceLabel(input.sourceKind);
  const itemType: KnowledgeItemType = input.sourceKind === "qa-text" ? "qa" : "doc";
  const sourceType: KnowledgeSourceType = input.sourceKind === "qa-text" ? "qa-import" : "document-import";
  const summary = `${sourceLabel}「${input.sourceName}」导入为待确认知识候选，仍需人工复核后才能正式入库。`;
  const job: KnowledgeDocumentJob = {
    id: `docjob-import-${suffix}`,
    projectId,
    title: input.title,
    source: input.sourceKind === "qa-text" ? "qa-import" : "local-text",
    status: "needs-review",
    detail: `${sourceLabel}已通过本地导入防火墙，等待人工确认；未读取文件路径，未连接飞书，未自动入库。`,
    createdAt,
    updatedAt: createdAt
  };
  const item: KnowledgeItem = {
    id: `knowledge-import-${suffix}`,
    projectId,
    title: input.title,
    type: itemType,
    status: "pending",
    sourceType,
    sourceCaseId: null,
    sourceFilePath,
    sapObjects: input.sapObjects ?? [],
    summary,
    content: input.body,
    confidence: null,
    effectiveFrom: null,
    effectiveTo: null,
    reviewer: null,
    reviewedAt: null,
    reviewNote: null,
    reviewedContentHash: null,
    reviewChecklist: null,
    conflictWithIds: [],
    createdAt,
    updatedAt: createdAt,
    publishedAt: null,
    timeline: [event("created", `${sourceLabel}通过导入防火墙生成待确认知识。`, createdAt)]
  };
  const artifact: CaseGeneratedFile = {
    relativePath: sourceFilePath,
    purpose: "candidate_knowledge",
    content: [
      `# ${input.title}`,
      "",
      "安全标记：phase16-document-ingestion-firewall",
      "",
      `来源类型：${sourceLabel}`,
      `来源名称：${input.sourceName}`,
      `知识项 ID：${item.id}`,
      `文档任务 ID：${job.id}`,
      "",
      "状态：待人工确认，不是正式知识。",
      "",
      "## 待确认内容",
      "",
      input.body,
      ""
    ].join("\n")
  };
  return { job, item, artifact };
}

function safeCaseCandidateLine(value: string, maxLength: number): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  assertNoSensitiveKnowledgeContent(normalized);
  return normalized;
}

function safeCaseCandidateContent(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_CASE_CANDIDATE_CONTENT_LENGTH);
  assertNoSensitiveKnowledgeContent(normalized);
  return normalized;
}

function caseCandidateProjection(project: ProjectSummary, caseItem: CaseSummary, file: CaseGeneratedFile) {
  const content = safeCaseCandidateContent(file.content);
  const title = safeCaseCandidateLine(`${caseItem.title} 经验候选`, MAX_CASE_CANDIDATE_TITLE_LENGTH);
  const summary = safeCaseCandidateLine(
    `来自项目「${project.name}」案件「${caseItem.title}」和文件 ${file.relativePath} 的待确认知识候选，需人工确认后才能入库。`,
    MAX_CASE_CANDIDATE_SUMMARY_LENGTH
  );
  return {
    title,
    summary,
    content,
    confidence: null
  };
}

export function createKnowledgeCandidateFromCase(project: ProjectSummary, caseItem: CaseSummary, file: CaseGeneratedFile): KnowledgeItem {
  const createdAt = nowIso();
  const projection = caseCandidateProjection(project, caseItem, file);
  return {
    id: `knowledge-${caseItem.id}-${createdAt.replace(/[^0-9]/g, "")}-${Math.random().toString(16).slice(2, 8)}`,
    projectId: project.id,
    title: projection.title,
    type: "case_note",
    status: "pending",
    sourceType: "case-candidate",
    sourceCaseId: caseItem.id,
    sourceFilePath: file.relativePath,
    sapObjects: [],
    summary: projection.summary,
    content: projection.content,
    confidence: projection.confidence,
    effectiveFrom: null,
    effectiveTo: null,
    reviewer: null,
    reviewedAt: null,
    reviewNote: null,
    reviewedContentHash: null,
    reviewChecklist: null,
    conflictWithIds: [],
    createdAt,
    updatedAt: createdAt,
    publishedAt: null,
    timeline: [event("created", `从案件文件 ${file.relativePath} 生成待确认知识。`, createdAt)]
  };
}

export function appendKnowledgeCandidatesFromCase(project: ProjectSummary, caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[]): ProjectKnowledgeBase {
  const candidateFiles = generatedFiles.filter((file) => file.purpose === "candidate_knowledge");
  if (candidateFiles.length === 0) return project.knowledge;
  const updatedAt = nowIso();
  const additions: KnowledgeItem[] = [];
  const refreshedKeys = new Set<string>();
  const candidateKeys = new Set(candidateFiles.map((file) => `${caseItem.id}:${file.relativePath}`));
  const existingPendingBySourceKey = new Map<string, KnowledgeItem>(
    project.knowledge.items
      .filter((item) => item.status === "pending")
      .map((item) => [`${item.sourceCaseId ?? ""}:${item.sourceFilePath ?? ""}`, item] as const)
  );
  for (const file of candidateFiles) {
    const key = `${caseItem.id}:${file.relativePath}`;
    const existingPending = existingPendingBySourceKey.get(key);
    if (existingPending && !isPhase21EditedCandidate(existingPending)) {
      refreshedKeys.add(key);
    } else if (!existingPending) {
      additions.push(createKnowledgeCandidateFromCase(project, caseItem, file));
    }
  }
  if (additions.length === 0 && refreshedKeys.size === 0) return project.knowledge;
  return {
    ...project.knowledge,
    items: [
      ...additions,
      ...project.knowledge.items.map((item) => {
        const key = `${item.sourceCaseId ?? ""}:${item.sourceFilePath ?? ""}`;
        if (!candidateKeys.has(key) || !refreshedKeys.has(key) || item.status !== "pending") return item;
        const sourceFile = candidateFiles.find((file) => `${caseItem.id}:${file.relativePath}` === key);
        if (!sourceFile) return item;
        const projection = caseCandidateProjection(project, caseItem, sourceFile);
        return {
          ...item,
          title: projection.title,
          summary: projection.summary,
          content: projection.content,
          confidence: projection.confidence,
          reviewer: null,
          reviewedAt: null,
          reviewNote: null,
          reviewedContentHash: null,
          reviewChecklist: null,
          updatedAt,
          timeline: [...item.timeline, event("edited", `${PHASE24_CASE_KNOWLEDGE_CANDIDATE_PROJECTION_MARKER}：案件 ${caseItem.id} 再次刷新待确认知识候选。`, updatedAt)]
        };
      })
    ],
    updatedAt
  };
}

function updateKnowledgeItem(base: ProjectKnowledgeBase, itemId: string, updater: (item: KnowledgeItem, updatedAt: string) => KnowledgeItem): ProjectKnowledgeBase {
  const updatedAt = nowIso();
  let found = false;
  const items = base.items.map((item) => {
    if (item.id !== itemId) return item;
    found = true;
    return updater(item, updatedAt);
  });
  if (!found) {
    throw new Error("未找到知识项，无法执行操作。");
  }
  return {
    ...base,
    items,
    updatedAt
  };
}

export function isPhase16LocalTextImportCandidate(item: KnowledgeItem): boolean {
  return item.id.startsWith("knowledge-import-") ||
    ((item.sourceType === "document-import" || item.sourceType === "qa-import") &&
      (item.sourceFilePath ?? "").startsWith("knowledge_candidates/imported-knowledge-"));
}

export function isCaseGeneratedKnowledgeCandidate(item: KnowledgeItem): boolean {
  return item.sourceType === "case-candidate" &&
    typeof item.sourceCaseId === "string" &&
    (item.sourceFilePath ?? "").startsWith("knowledge_candidates/");
}

function isPhase21EditedCandidate(item: KnowledgeItem): boolean {
  return item.timeline.some((timelineEvent) =>
    timelineEvent.action === "edited" && timelineEvent.note.includes(PHASE21_KNOWLEDGE_EDIT_REVIEW_MARKER)
  );
}

function requiresHumanReviewBeforePublish(item: KnowledgeItem): boolean {
  return item.status !== "published" && item.status !== "expired";
}

function knowledgePeriodsOverlap(left: KnowledgeItem, right: KnowledgeItem): boolean {
  const leftStart = knowledgeDateKey(left.effectiveFrom) ?? "0000-01-01";
  const rightStart = knowledgeDateKey(right.effectiveFrom) ?? "0000-01-01";
  const leftEnd = knowledgeDateKey(left.effectiveTo) ?? "9999-12-31";
  const rightEnd = knowledgeDateKey(right.effectiveTo) ?? "9999-12-31";
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function publishedKnowledgeConflicts(base: ProjectKnowledgeBase, candidate: KnowledgeItem): KnowledgeItem[] {
  const candidateObjects = new Set(candidate.sapObjects.map((item) => item.trim().toUpperCase()).filter(Boolean));
  if (candidateObjects.size === 0) return [];
  return base.items.filter((item) =>
    item.id !== candidate.id &&
    item.status === "published" &&
    knowledgePeriodsOverlap(candidate, item) &&
    item.sapObjects.some((sapObject) => candidateObjects.has(sapObject.trim().toUpperCase()))
  );
}

function assertNoPublishedKnowledgeConflict(base: ProjectKnowledgeBase, candidate: KnowledgeItem): void {
  const conflicts = publishedKnowledgeConflicts(base, candidate);
  if (conflicts.length === 0) return;
  const labels = conflicts.slice(0, 3).map((item) => `「${item.title}」`).join("、");
  throw new Error(`检测到与已发布知识 ${labels} 的 SAP 对象和适用期重叠。请先调整对象/适用期或记录冲突处理结论，再重新审核。`);
}

function hasHumanReviewRecord(item: KnowledgeItem): boolean {
  return Boolean(item.reviewedAt && item.reviewer && item.reviewNote && item.reviewNote.trim().length >= 8 && item.reviewedContentHash && item.reviewChecklist && hasCompleteReviewChecklist(item.reviewChecklist));
}

function assertKnowledgePublishSafe(item: KnowledgeItem, note = ""): void {
  assertNoSensitiveKnowledgeContent(item.title);
  assertNoSensitiveKnowledgeContent(item.summary);
  assertNoSensitiveKnowledgeContent(item.content);
  assertNoSensitiveKnowledgeContent(item.reviewNote ?? "");
  assertNoSensitiveKnowledgeContent(note);
  if (requiresHumanReviewBeforePublish(item)) {
    assertSafeKnowledgeImportBody(item.content);
  }
  for (const sapObject of item.sapObjects) {
    assertNoSensitiveKnowledgeContent(sapObject);
  }
}

function assertReviewedContentUnchanged(item: KnowledgeItem): void {
  if (!item.reviewedContentHash || item.reviewedContentHash !== knowledgeReviewContentHash(item)) {
    throw new Error("该知识候选在审核后发生变化，请重新记录人工审核后再确认入库。");
  }
}

export function reviewKnowledgeItemForPublish(base: ProjectKnowledgeBase, input: KnowledgeReviewInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, input.itemId, (item, updatedAt) => {
    if (!requiresHumanReviewBeforePublish(item)) {
      throw new Error("当前知识状态不需要重复记录发布审核。");
    }
    if (item.status === "conflicted") {
      throw new Error("该知识仍处于冲突状态，不能记录发布审核。请先处理适用范围或结论冲突。");
    }
    if (item.status === "expired") {
      throw new Error("已失效知识不能记录发布审核。请重新生成候选知识后再确认。");
    }
    if (item.status === "published") {
      throw new Error("该知识已经发布，不能重复记录发布审核。");
    }
    if (item.status !== "pending") {
      throw new Error("只有待确认知识候选才能记录发布审核。");
    }
    if (item.conflictWithIds.length > 0) {
      throw new Error("该知识仍关联冲突项，不能记录发布审核。请先处理冲突关系。");
    }
    assertNoPublishedKnowledgeConflict(base, item);
    assertKnowledgePublishSafe(item, input.note);
    const reviewedContentHash = knowledgeReviewContentHash(item);
    return {
      ...item,
      reviewer: LOCAL_KNOWLEDGE_REVIEWER_LABEL,
      reviewedAt: updatedAt,
      reviewNote: input.note,
      reviewedContentHash,
      reviewChecklist: input.checklist,
      updatedAt,
      timeline: [...item.timeline, event("reviewed", `phase19-knowledge-review-gate：${input.note}`, updatedAt)]
    };
  });
}

export function editKnowledgeCandidate(base: ProjectKnowledgeBase, editInput: KnowledgeEditInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, editInput.itemId, (item, updatedAt) => {
    if (item.status === "published") {
      throw new Error("已发布知识不能直接编辑。请重新生成待确认候选后再替代。");
    }
    if (item.status === "expired") {
      throw new Error("已失效知识不能直接编辑复活。请重新生成候选知识。");
    }
    if (item.status !== "draft" && item.status !== "pending" && item.status !== "conflicted") {
      throw new Error("只有草稿、待确认或冲突候选可以编辑。");
    }
    const editedItem: KnowledgeItem = {
      ...item,
      title: editInput.title,
      summary: editInput.summary,
      content: editInput.content,
      sapObjects: editInput.sapObjects ?? [],
      effectiveFrom: editInput.effectiveFrom ?? null,
      effectiveTo: editInput.effectiveTo ?? null
    };
    assertKnowledgePublishSafe(editedItem, editInput.note);
    return {
      ...editedItem,
      status: "pending",
      reviewer: null,
      reviewedAt: null,
      reviewNote: null,
      reviewedContentHash: null,
      reviewChecklist: null,
      conflictWithIds: [],
      updatedAt,
      timeline: [
        ...item.timeline,
        event(
          "edited",
          item.sourceFilePath
            ? `${PHASE21_KNOWLEDGE_EDIT_REVIEW_MARKER}：${editInput.note}；知识记录版本已更新，来源快照保持只读。`
            : `${PHASE21_KNOWLEDGE_EDIT_REVIEW_MARKER}：${editInput.note}；知识记录版本已更新。`,
          updatedAt
        )
      ]
    };
  });
}

export function publishKnowledgeItem(base: ProjectKnowledgeBase, input: KnowledgeItemActionInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, input.itemId, (item, updatedAt) => {
    if (item.status === "conflicted") {
      throw new Error("该知识仍处于冲突状态，不能直接确认入库。请先处理适用范围或结论冲突。");
    }
    if (item.status === "expired") {
      throw new Error("已失效知识不能直接重新确认入库。请重新生成候选知识后再确认。");
    }
    if (item.status === "published") {
      throw new Error("该知识已经是已发布状态，无需重复确认入库。");
    }
    if (item.conflictWithIds.length > 0) {
      throw new Error("该知识仍关联冲突项，不能直接确认入库。请先处理冲突关系。");
    }
    assertNoPublishedKnowledgeConflict(base, item);
    const needsHumanReview = requiresHumanReviewBeforePublish(item);
    if (needsHumanReview && !hasHumanReviewRecord(item)) {
      throw new Error("该知识候选必须先记录人工审核备注，才能确认入库。");
    }
    assertKnowledgePublishSafe(item, input.note ?? "");
    if (needsHumanReview) {
      assertReviewedContentUnchanged(item);
    }
    return {
      ...item,
      status: "published",
      reviewer: item.reviewer ?? LOCAL_KNOWLEDGE_REVIEWER_LABEL,
      updatedAt,
      publishedAt: updatedAt,
      timeline: [...item.timeline, event("published", input.note || "人工确认后入库。", updatedAt)]
    };
  });
}

export function markKnowledgeItemConflicted(base: ProjectKnowledgeBase, input: KnowledgeItemActionInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, input.itemId, (item, updatedAt) => {
    if (item.status === "published") {
      throw new Error("已发布知识不能改为冲突状态。请新建待确认候选记录冲突说明。");
    }
    if (item.status === "expired") {
      throw new Error("已失效知识不能改为冲突状态。请重新生成候选知识。");
    }
    return {
      ...item,
      status: "conflicted",
      updatedAt,
      timeline: [...item.timeline, event("marked-conflicted", input.note || "人工标记为存在适用范围或结论冲突。", updatedAt)]
    };
  });
}

export function expireKnowledgeItem(base: ProjectKnowledgeBase, input: KnowledgeItemActionInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, input.itemId, (item, updatedAt) => {
    const wasPublished = item.status === "published";
    if (item.status === "expired") {
      throw new Error("该知识已经失效，不能重复修改失效状态。");
    }
    const today = localDateKey(new Date(updatedAt));
    const existingEffectiveTo = knowledgeDateKey(item.effectiveTo);
    const effectiveTo = existingEffectiveTo && existingEffectiveTo <= today ? existingEffectiveTo : today;
    const auditNote = wasPublished
      ? `已发布知识由本机用户标记为失效；适用期截至 ${effectiveTo}。${input.note || "保留正式知识内容和既有审核记录。"}`
      : input.note || `本机用户标记为已失效；适用期截至 ${effectiveTo}，保留历史记录。`;
    return {
      ...item,
      status: "expired",
      effectiveTo,
      updatedAt,
      timeline: [...item.timeline, event("expired", auditNote, updatedAt)]
    };
  });
}

function safeReferenceText(value: string, maxLength: number): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  assertNoSensitiveKnowledgeContent(cleaned);
  return cleaned;
}

function hasReusableReviewRecord(item: KnowledgeItem): boolean {
  return hasHumanReviewRecord(item) && item.reviewedContentHash === knowledgeReviewContentHash(item);
}

export function createCaseKnowledgeReference(item: KnowledgeItem, attachedAt: string): CaseKnowledgeReference {
  if (item.status !== "published") {
    throw new Error("只有已发布知识才能加入案件上下文。");
  }
  if (hasKnowledgeEffectivePeriodEnded(item)) {
    throw new Error("该知识的适用期已经结束，不能加入案件上下文。请先将其标记为失效，或选择仍在适用期内的知识。");
  }
  if (!hasReusableReviewRecord(item)) {
    throw new Error("已发布知识必须保留人工审核记录，才能加入案件上下文。");
  }
  assertKnowledgePublishSafe(item);
  return {
    itemId: item.id,
    title: safeReferenceText(item.title, 120),
    summary: safeReferenceText(item.summary, 500),
    sourceType: item.sourceType,
    sourceCaseId: item.sourceCaseId,
    sourceFilePath: null,
    sapObjects: item.sapObjects.map((objectName) => safeReferenceText(objectName, 80)).slice(0, 20),
    publishedAt: item.publishedAt,
    attachedAt
  };
}

export function knowledgeCounts(items: KnowledgeItem[]): KnowledgeStatusCounts {
  const counts: KnowledgeStatusCounts = { draft: 0, pending: 0, published: 0, conflicted: 0, expired: 0, total: items.length };
  for (const item of items) {
    counts[item.status] += 1;
  }
  return counts;
}

export function projectKnowledgeView(base: ProjectKnowledgeBase): ProjectKnowledgeView {
  return {
    projectId: base.projectId,
    counts: knowledgeCounts(base.items),
    items: [...base.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    documentJobs: [...base.documentJobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  };
}

export function renderProjectKnowledgeMarkdown(base: ProjectKnowledgeBase): string {
  const lines = [
    "# 项目知识库",
    "",
    "安全标记：no-secrets-project-knowledge",
    "",
    `项目 ID：${base.projectId}`,
    `更新时间：${base.updatedAt}`,
    "",
    "说明：本文件只记录当前项目的本地知识项摘要。候选知识必须人工确认后才会变为已发布知识；不要保存密码、Token、授权头、真实客户明细或大段生产源码。",
    ""
  ];

  for (const item of base.items) {
    lines.push(
      `## ${item.title}`,
      "",
      `状态：${KNOWLEDGE_STATUS_LABELS[item.status]}`,
      `类型：${KNOWLEDGE_TYPE_LABELS[item.type]}`,
      `来源：${KNOWLEDGE_SOURCE_LABELS[item.sourceType]}`,
      item.sourceCaseId ? `来源案件：${item.sourceCaseId}` : "来源案件：无",
      item.sourceFilePath ? `来源文件：${item.sourceFilePath}` : "来源文件：无",
      item.reviewedAt ? `审核：${item.reviewer ?? "未知"} 于 ${item.reviewedAt} 确认` : "审核：未审核",
      `摘要：${item.summary}`,
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

export function renderProjectKnowledgeJson(base: ProjectKnowledgeBase): object {
  return {
    safety: "no-secrets-project-knowledge",
    knowledge: base
  };
}
