import type {
  CaseGeneratedFile,
  CaseSummary,
  KnowledgeDocumentJob,
  KnowledgeItem,
  KnowledgeItemActionInput,
  KnowledgeItemStatus,
  KnowledgeItemType,
  KnowledgeSourceType,
  KnowledgeStatusCounts,
  KnowledgeTimelineEvent,
  ProjectKnowledgeBase,
  ProjectKnowledgeView,
  ProjectSummary
} from "../shared/workbenchTypes";

const MAX_KNOWLEDGE_CONTENT_LENGTH = 12000;
const MAX_KNOWLEDGE_ITEMS = 500;

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

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeId(value: unknown, fallback: string): string {
  const raw = text(value, fallback);
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function limitedText(value: unknown, fallback = ""): string {
  const raw = text(value, fallback).slice(0, MAX_KNOWLEDGE_CONTENT_LENGTH);
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
      reviewer: "演示用户",
      conflictWithIds: [],
      createdAt: "2026-07-01T08:20:00.000Z",
      updatedAt: "2026-07-01T09:00:00.000Z",
      publishedAt: "2026-07-01T09:00:00.000Z",
      timeline: [
        event("created", "从演示文档解析为知识候选。", "2026-07-01T08:20:00.000Z"),
        event("published", "演示用户确认入库。", "2026-07-01T09:00:00.000Z")
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
  return value.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<KnowledgeTimelineEvent>;
    const action = candidate.action === "published" || candidate.action === "marked-conflicted" || candidate.action === "expired" || candidate.action === "edited" || candidate.action === "parsed" ? candidate.action : "created";
    const at = typeof candidate.at === "string" ? candidate.at : fallbackAt;
    return [{
      id: safeId(candidate.id, `ke-${at.replace(/[^0-9]/g, "")}`),
      at,
      action,
      note: limitedText(candidate.note, fallbackNote).slice(0, 300)
    }];
  });
}

function normalizeKnowledgeItem(projectId: string, value: unknown): KnowledgeItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<KnowledgeItem>;
  const id = safeId(candidate.id, `knowledge-${Date.now()}`);
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso();
  const title = limitedText(candidate.title, "未命名知识").slice(0, 120);
  const summary = limitedText(candidate.summary, title).slice(0, 500);
  const content = limitedText(candidate.content, summary);
  return {
    id,
    projectId,
    title,
    type: normalizeType(candidate.type),
    status: normalizeStatus(candidate.status),
    sourceType: normalizeSourceType(candidate.sourceType),
    sourceCaseId: typeof candidate.sourceCaseId === "string" ? safeId(candidate.sourceCaseId, candidate.sourceCaseId) : null,
    sourceFilePath: typeof candidate.sourceFilePath === "string" ? candidate.sourceFilePath.replaceAll("\\", "/").slice(0, 240) : null,
    sapObjects: Array.isArray(candidate.sapObjects) ? candidate.sapObjects.map((item) => text(item).slice(0, 80)).filter(Boolean).slice(0, 20) : [],
    summary,
    content,
    confidence: typeof candidate.confidence === "number" && candidate.confidence >= 0 && candidate.confidence <= 1 ? candidate.confidence : null,
    effectiveFrom: typeof candidate.effectiveFrom === "string" ? candidate.effectiveFrom : null,
    effectiveTo: typeof candidate.effectiveTo === "string" ? candidate.effectiveTo : null,
    reviewer: typeof candidate.reviewer === "string" ? candidate.reviewer.slice(0, 80) : null,
    conflictWithIds: Array.isArray(candidate.conflictWithIds) ? candidate.conflictWithIds.map((item) => safeId(item, "")).filter(Boolean).slice(0, 20) : [],
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
  const source = candidate.source === "qa-import" ? candidate.source : "upload";
  const status = candidate.status === "parsed" || candidate.status === "needs-review" || candidate.status === "blocked" ? candidate.status : "queued";
  return {
    id: safeId(candidate.id, `docjob-${Date.now()}`),
    projectId,
    title: limitedText(candidate.title, "未命名文档").slice(0, 160),
    source,
    status,
    detail: limitedText(candidate.detail, "等待本地解析。").slice(0, 500),
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
    .filter((item): item is KnowledgeItem => Boolean(item))
    .slice(0, MAX_KNOWLEDGE_ITEMS);
  const documentJobs = (Array.isArray(candidate.documentJobs) ? candidate.documentJobs : [])
    .map((job) => normalizeDocumentJob(projectId, job))
    .filter((job): job is KnowledgeDocumentJob => Boolean(job))
    .slice(0, 100);
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
  const note = typeof candidate.note === "string" ? candidate.note.trim().slice(0, 500) : "";
  if (note) assertNoSensitiveKnowledgeContent(note);
  return { itemId: candidate.itemId, note };
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

export function createKnowledgeCandidateFromCase(project: ProjectSummary, caseItem: CaseSummary, file: CaseGeneratedFile): KnowledgeItem {
  const createdAt = nowIso();
  const summary = `来自案件「${caseItem.title}」的待确认知识候选。`;
  return {
    id: `knowledge-${caseItem.id}-${createdAt.replace(/[^0-9]/g, "")}-${Math.random().toString(16).slice(2, 8)}`,
    projectId: project.id,
    title: `${caseItem.title} 经验候选`,
    type: "case_note",
    status: "pending",
    sourceType: "case-candidate",
    sourceCaseId: caseItem.id,
    sourceFilePath: file.relativePath,
    sapObjects: [],
    summary,
    content: summary,
    confidence: 0.82,
    effectiveFrom: null,
    effectiveTo: null,
    reviewer: null,
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
  const existingPendingSourceKeys = new Set(project.knowledge.items.filter((item) => item.status === "pending").map((item) => `${item.sourceCaseId ?? ""}:${item.sourceFilePath ?? ""}`));
  for (const file of candidateFiles) {
    const key = `${caseItem.id}:${file.relativePath}`;
    if (existingPendingSourceKeys.has(key)) {
      refreshedKeys.add(key);
    } else {
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
        return {
          ...item,
          updatedAt,
          timeline: [...item.timeline, event("edited", `案件 ${caseItem.id} 再次刷新待确认知识候选。`, updatedAt)]
        };
      })
    ].slice(0, MAX_KNOWLEDGE_ITEMS),
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
    assertNoSensitiveKnowledgeContent(item.content);
    return {
      ...item,
      status: "published",
      reviewer: "演示用户",
      updatedAt,
      publishedAt: updatedAt,
      timeline: [...item.timeline, event("published", input.note || "人工确认后入库。", updatedAt)]
    };
  });
}

export function markKnowledgeItemConflicted(base: ProjectKnowledgeBase, input: KnowledgeItemActionInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, input.itemId, (item, updatedAt) => ({
    ...item,
    status: "conflicted",
    updatedAt,
    timeline: [...item.timeline, event("marked-conflicted", input.note || "人工标记为存在适用范围或结论冲突。", updatedAt)]
  }));
}

export function expireKnowledgeItem(base: ProjectKnowledgeBase, input: KnowledgeItemActionInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, input.itemId, (item, updatedAt) => ({
    ...item,
    status: "expired",
    effectiveTo: updatedAt.slice(0, 10),
    updatedAt,
    timeline: [...item.timeline, event("expired", input.note || "人工标记为已失效，保留历史记录。", updatedAt)]
  }));
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
