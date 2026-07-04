import { standardsSummaryForTask } from "./standardsService";
import type { CaseGeneratedFile, CaseKnowledgeReference, CaseMessage, CaseSummary, CaseWorkflowInput, ProjectSummary, TaskMode } from "../shared/workbenchTypes";
import { renderSafeModelDraftFiles, safeModelDraftBoundary, type SafeModelDraftRun } from "./safeModelCaseDraftService";

export const TASK_MODE_LABELS: Record<TaskMode, string> = {
  "problem-analysis": "问题分析",
  "abap-development": "ABAP 开发",
  "document-generation": "文档生成",
  "flow-diagram": "画流程图"
};

const CASE_OUTPUT_PHASE = "Phase 11";
const LOCAL_WORKFLOW_BOUNDARY = "本地案件工作流：没有合格模型时生成本地草稿；已验证模型只可生成安全本地草稿，不读取真实 SAP、不创建或发布飞书文档。";

export interface CaseWorkflowArtifacts {
  currentSummary: string;
  generatedFiles: CaseGeneratedFile[];
  readme: string;
  conversation: string;
  timeline: string;
  contextPack: string;
  metadata: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeWorkflowModelHint(value: unknown, hasHint = false): { modelId: string; rejected: boolean } {
  if (typeof value !== "string") return { modelId: "local-workflow", rejected: hasHint && value !== undefined };
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(trimmed)) return { modelId: "local-workflow", rejected: hasHint };
  if (/bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{20,}|api[_-]?key|token|secret|password|secure-store|https?:\/\//i.test(trimmed)) {
    return { modelId: "local-workflow", rejected: hasHint };
  }
  return { modelId: trimmed, rejected: false };
}

function safeWorkflowProviderHint(value: unknown, hasHint = false): { providerId?: string; rejected: boolean } {
  if (typeof value !== "string") return { providerId: undefined, rejected: hasHint && value !== undefined };
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(trimmed)) return { providerId: undefined, rejected: hasHint };
  if (/(api[_-]?key|token|secret|password|secure-store|https?:\/|bearer\s+)/i.test(trimmed)) return { providerId: undefined, rejected: hasHint };
  return { providerId: trimmed, rejected: false };
}

function csvCell(value: string): string {
  const formulaSafeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${formulaSafeValue.replaceAll("\"", "\"\"")}"`;
}

function csvRows(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function normalizeTaskMode(value: unknown): TaskMode {
  if (value === "abap-development" || value === "document-generation" || value === "flow-diagram") {
    return value;
  }
  return "problem-analysis";
}

export function parseCaseWorkflowInput(input: unknown): CaseWorkflowInput {
  if (typeof input === "string") {
    const content = input.trim();
    if (content.length > 8000) {
      throw new Error("单条案件消息过长。请先整理成 8000 字以内的脱敏摘要后再发送。");
    }
    return {
      content,
      taskMode: "problem-analysis",
      modelId: "local-workflow"
    };
  }

  if (!input || typeof input !== "object") {
    return {
      content: "",
      taskMode: "problem-analysis",
      modelId: "local-workflow"
    };
  }

  const candidate = input as Partial<CaseWorkflowInput>;
  const content = text(candidate.content);
  if (content.length > 8000) {
    throw new Error("单条案件消息过长。请先整理成 8000 字以内的脱敏摘要后再发送。");
  }
  const hasProviderHint = Object.prototype.hasOwnProperty.call(candidate, "providerId");
  const hasModelHint = Object.prototype.hasOwnProperty.call(candidate, "modelId");
  const providerHint = safeWorkflowProviderHint(candidate.providerId, hasProviderHint);
  const modelHint = safeWorkflowModelHint(candidate.modelId, hasModelHint);
  const modelSelectionRejected = providerHint.rejected || modelHint.rejected;
  return {
    content,
    taskMode: normalizeTaskMode(candidate.taskMode),
    modelId: modelHint.modelId,
    providerId: providerHint.providerId,
    ...(modelSelectionRejected ? { modelSelectionRejected: true } : {})
  };
}

export function assertNoSensitiveCaseContent(content: string): void {
  const secretLikePatterns = [
    /secure-store:sec_[a-f0-9]{32}/i,
    /sk-[a-z0-9]{20,}/i,
    /bearer\s+[a-z0-9._-]{12,}/i,
    /authorization\s*[:=]\s*[^\s]+/i,
    /cookie\s*[:=]\s*[^\s]+/i,
    /x-csrf-token\s*[:=]\s*[^\s]+/i,
    /tenant[_-]?access[_-]?token\s*[:=]\s*[^\s]+/i,
    /user[_-]?access[_-]?token\s*[:=]\s*[^\s]+/i,
    /api[_-]?key\s*[:=]\s*["']?[^"'\s]{8,}/i,
    /password\s*[:=]\s*["']?[^"'\s]{6,}/i,
    /passwd\s*[:=]\s*["']?[^"'\s]{6,}/i,
    /token\s*[:=]\s*["']?[^"'\s]{8,}/i
  ];

  if (secretLikePatterns.some((pattern) => pattern.test(content))) {
    throw new Error("消息中包含疑似密钥、Token、密码或授权头。为避免写入案件文件，请先删除敏感内容后再发送。");
  }

  const abapSourceMarkers = [
    /^\s*(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION|FORM|MODULE|METHOD)\s+[\w/]+/im,
    /^\s*(DATA|TYPES|CONSTANTS|SELECT-OPTIONS|PARAMETERS)\s*[:\s]/im,
    /\bLOOP\s+AT\b|\bREAD\s+TABLE\b|\bAPPEND\s+.+\s+TO\b/i,
    /^\s*\*&[-=]{3,}/m,
    /\bENDCLASS\b|\bENDFUNCTION\b|\bENDFORM\b|\bENDMETHOD\b/i,
    /\bSELECT\s+.+\s+FROM\s+[\w/]+/i,
    /\bCALL\s+(FUNCTION|TRANSACTION)\b/i,
    /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
  ];
  if (abapSourceMarkers.some((pattern) => pattern.test(content))) {
    throw new Error("消息中疑似包含 SAP 源码或写入语句。当前本地阶段只保存脱敏问题描述，请先删除源码、表数据或写入语句后再发送。");
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const structuredRows = lines.filter((line) => line.split(/\t|,|\|/).filter((cell) => cell.trim().length > 0).length >= 4);
  if (structuredRows.length >= 3) {
    throw new Error("消息中疑似包含表格行数据。当前本地阶段不把原始业务表格写入案件文件，请先改成脱敏摘要后再发送。");
  }
}

function safeContentSummary(content: string, sourceLabel: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (!singleLine) return `${sourceLabel}为空白内容。`;
  return `${sourceLabel}已记录在本地案件对话中（${content.length} 字），输出文件不重复复制原文摘要。`;
}

function modelBoundaryText(modelDraft?: SafeModelDraftRun): string {
  if (!modelDraft) return LOCAL_WORKFLOW_BOUNDARY;
  if (modelDraft.status === "success") return safeModelDraftBoundary;
  return "安全模型草稿未生成：模型调用失败后只保存本地失败说明，不写 SAP、不发布飞书、不保存原始请求或响应。";
}

function commonContext(input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary, modelDraft?: SafeModelDraftRun): string {
  const standardsSummary = standardsSummaryForTask(project.standards);
  return [
    `- 项目：${project.name}`,
    `- 案件：${caseItem.title}`,
    `- 任务模式：${TASK_MODE_LABELS[input.taskMode]}`,
    `- 输入摘要：${safeContentSummary(input.content, "用户输入")}`,
    input.taskMode === "abap-development" ? `- 当前项目规范摘要：${standardsSummary}` : null,
    `- 执行边界：${CASE_OUTPUT_PHASE} ${modelBoundaryText(modelDraft)}`,
    ""
  ].filter(Boolean).join("\n");
}

function traceabilityCsv(project: ProjectSummary, caseItem: CaseSummary, taskMode: TaskMode, modelDraft?: SafeModelDraftRun): string {
  const modelStatus = modelDraft?.status === "success" ? "已调用安全草稿" : modelDraft?.status === "failed" ? "调用失败" : "未调用";
  const modelNote = modelDraft?.status === "success"
    ? `已用 ${modelDraft.modelId} 生成本地草稿`
    : modelDraft?.status === "failed"
      ? "模型未返回可保存草稿，已保存安全失败说明"
      : "没有合格模型时只生成本地草稿文件";
  return csvRows([
    ["类型", "名称", "状态", "说明"],
    ["项目", project.name, "已记录", `系统标签 ${project.systemLabel}`],
    ["案件", caseItem.title, "已记录", "所有输出写入当前案件文件夹"],
    ["任务模式", TASK_MODE_LABELS[taskMode], "已选择", "决定本地输出模板和文件目录"],
    ["SAP 写入", "禁用", "已锁定", "当前阶段不会写入、激活或释放传输"],
    ["外部模型", modelStatus, "受控", modelNote],
    ["飞书发布", "未发布", "已锁定", "当前阶段不会创建或更新飞书文档"]
  ]);
}

export function createCaseMessage(
  role: CaseMessage["role"],
  caseId: string,
  content: string,
  taskMode: TaskMode,
  modelId: string,
  linkedFileIds: string[] = []
): CaseMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    caseId,
    role,
    content,
    taskMode,
    modelId,
    linkedFileIds,
    createdAt: nowIso()
  };
}

function modeFilePlan(input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary, modelDraft?: SafeModelDraftRun): CaseGeneratedFile[] {
  const header = `# ${TASK_MODE_LABELS[input.taskMode]}本地输出\n\n`;
  const standardsSummary = standardsSummaryForTask(project.standards);
  const context = commonContext(input, project, caseItem, modelDraft);
  const modelBoundary = modelBoundaryText(modelDraft);

  if (input.taskMode === "abap-development") {
    return [
      {
        relativePath: "outputs/ABAP只读开发草稿.md",
        purpose: "output",
        content: `${header}${context}\n## 开发目标\n\n- 已按 ABAP 开发模式建立本地开发草稿。\n- 当前只记录需求和项目规范摘要，不复制用户原文、不保存真实源码。\n- 真实接入后，必须先通过 ADT 只读读取最新对象并保存快照，再进入开发说明。\n\n## 项目规范摘要\n\n${standardsSummary}\n\n## 输出草稿\n\n| 项目 | 当前结论 |\n|---|---|\n| 需求状态 | 待用户确认开发对象、影响范围和验收口径 |\n| 数据来源 | 当前只有本地案件输入和项目规范摘要 |\n| 交付物 | 开发草稿、请求说明草稿、只读快照说明、安全边界说明 |\n| 禁止动作 | 不写入 SAP、不激活对象、不释放传输 |\n\n## 下一步核对\n\n1. 确认目标对象名称和对象类型。\n2. 在配置中心完成 ADT 只读验证。\n3. 读取最新对象快照后，再生成可执行开发方案。\n`
      },
      {
        relativePath: "outputs/请求说明草稿.md",
        purpose: "output",
        content: `# 请求说明草稿\n\n${context}\n## 建议描述\n\n本次请求用于记录当前案件的 ABAP 开发或调整需求。当前阶段尚未读取真实 SAP 对象，因此该说明只可作为草稿。\n\n## 上线前确认\n\n- 已确认对象范围。\n- 已完成 ADT 只读快照。\n- 已完成项目规范检查。\n- 已完成用户验收口径确认。\n`
      },
      {
        relativePath: "snapshots/SAP只读快照说明.md",
        purpose: "snapshot",
        content: `# SAP 只读快照说明\n\n当前阶段未读取真实 SAP 源码，也不会创建真实源码快照。\n\n后续进入真实 ABAP 开发前，本目录只允许保存通过 ADT 只读读取得到的脱敏快照或用户明确要求保存的案件材料。\n`
      },
      {
        relativePath: "technical/ABAP开发安全边界.md",
        purpose: "technical",
        content: `# ABAP 开发安全边界\n\n- ${modelBoundary}\n- SAP 密码、API Key、飞书 Token 不允许进入案件文件。\n- 真实 SAP 写入、对象激活、传输释放不属于当前 MVP。\n- 如果后续需要真实开发，必须先完成 ADT 只读验证和用户确认。\n`
      }
    ];
  }

  if (input.taskMode === "document-generation") {
    return [
      {
        relativePath: "outputs/开发说明书.md",
        purpose: "output",
        content: `${header}${context}\n## 基本信息\n\n| 字段 | 内容 |\n|---|---|\n| 项目 | ${project.name} |\n| 案件 | ${caseItem.title} |\n| 文档状态 | 本地 Markdown 草稿 |\n| 发布状态 | 未创建或发布飞书文档 |\n\n## 业务背景\n\n${safeContentSummary(input.content, "用户输入")}\n\n## 处理目标\n\n- 将当前案件整理成可编辑开发说明。\n- 保留后续接入 SAP 只读证据、流程图和交付物的位置。\n- 发布前由用户确认内容、范围和权限。\n\n## 关键逻辑\n\n当前阶段只根据本地案件上下文生成文档框架；真实业务逻辑需要后续读取 SAP 证据或用户补充后确认。\n\n## 数据来源\n\n- 当前案件对话。\n- 当前项目规范摘要。\n- 当前案件输出文件。\n\n## 异常与边界说明\n\n- 未读取真实 SAP。\n- ${modelDraft?.status === "success" ? "已调用已验证模型生成安全本地草稿。" : modelDraft?.status === "failed" ? "已尝试调用已验证模型，但未生成可保存草稿。" : "未调用真实模型。"}\n- 未创建、更新或发布飞书文档。\n- 未写入任何外部系统。\n\n## 交付物\n\n- outputs/开发说明书.md\n- outputs/上线确认清单.csv\n- outputs/飞书发布准备说明.md\n`
      },
      {
        relativePath: "outputs/上线确认清单.csv",
        purpose: "output",
        content: csvRows([
          ["序号", "确认项", "当前状态", "负责人"],
          ["1", "业务范围已确认", "待确认", "用户"],
          ["2", "SAP 只读证据已补充", "未读取", "用户或后续连接器"],
          ["3", "开发说明已审阅", "待审阅", "用户"],
          ["4", "飞书发布权限已验证", "未发布", "用户"],
          ["5", "知识候选是否入库", "待人工确认", "用户"]
        ])
      },
      {
        relativePath: "outputs/飞书发布准备说明.md",
        purpose: "output",
        content: `# 飞书发布准备说明\n\n- 当前仅生成本地 Markdown 草稿。\n- 发布前必须确认飞书 CLI 已登录，并具备文档创建或更新权限。\n- 本文件不记录飞书 Token、App Secret、授权 URL 或设备码。\n- 发布后才允许在 metadata.json 记录文档 URL、document_id、发布时间和本地来源文件。\n`
      }
    ];
  }

  if (input.taskMode === "flow-diagram") {
    return [
      {
        relativePath: "outputs/逻辑说明图.mmd",
        purpose: "output",
        content: "flowchart TD\n  A[\"接收案件问题\"] --> B[\"整理本地上下文\"]\n  B --> C[\"生成流程图草稿\"]\n  C --> D[\"保存到 outputs 目录\"]\n  D --> E[\"用户确认业务逻辑\"]\n  E --> F[\"后续可生成图片或飞书白板\"]\n"
      },
      {
        relativePath: "outputs/流程图说明.md",
        purpose: "output",
        content: `${header}${context}\n## 图示说明\n\n当前 Mermaid 文件是本地流程图草稿，用于表达案件处理路径。它不是 SAP 运行结果，也没有发布到飞书白板。\n\n## 用户需确认\n\n- 节点顺序是否符合真实业务流程。\n- 是否需要补充异常路径。\n- 是否需要把流程图转换成图片或飞书白板素材。\n`
      },
      {
        relativePath: "outputs/流程节点清单.csv",
        purpose: "output",
        content: csvRows([
          ["节点", "含义", "当前状态"],
          ["接收案件问题", "记录用户需求并写入当前案件", "已生成"],
          ["整理本地上下文", "使用案件摘要、规范摘要和文件索引", "已生成"],
          ["生成流程图草稿", "输出 Mermaid 源文件", "已生成"],
          ["用户确认业务逻辑", "等待用户检查节点和边界", "待确认"],
          ["后续素材生成", "可在确认后生成图片或飞书白板", "未执行"]
        ])
      }
    ];
  }

  return [
    {
      relativePath: "outputs/问题分析_处理结论.md",
      purpose: "output",
      content: `${header}${context}\n## 当前结论\n\n当前问题已进入案件闭环，并生成可追溯的本地分析文件。由于本阶段不读取真实 SAP，根因结论必须标记为待确认。\n\n## 已完成\n\n- 记录本次案件输入到 conversation.md。\n- 刷新 timeline.md、context_pack.md 和 metadata.json。\n- 生成问题分析结论、核对清单、候选知识和本地证据文件。\n\n## 待确认\n\n1. 是否需要读取 SAP 对象或表结构作为证据。\n2. 是否需要补充影响范围、异常样例和期望结果。\n3. 是否把候选知识编辑后正式入库。\n\n## 安全边界\n\n${modelBoundary}\n`
    },
    {
      relativePath: "outputs/问题分析_核对清单.csv",
      purpose: "output",
      content: traceabilityCsv(project, caseItem, input.taskMode, modelDraft)
    },
      {
        relativePath: "knowledge_candidates/问题处理经验候选.md",
        purpose: "candidate_knowledge",
        content: `# 问题处理经验候选\n\n状态：待确认\n\n来源案件：${caseItem.title}\n\n## 候选内容\n\n当前案件形成了一条待整理经验：先在本地案件中沉淀问题、结论、核对清单和证据，再由用户确认是否进入正式知识库。\n\n## 入库前必须确认\n\n- 内容是否适用于当前项目。\n- 是否需要补充 SAP 对象、业务范围或失效条件。\n- 是否与已有知识冲突。\n`
      },
    {
      relativePath: "evidence/本地处理证据.md",
      purpose: "evidence",
      content: `# 本地处理证据\n\n- 阶段：${CASE_OUTPUT_PHASE}\n- 输入：${safeContentSummary(input.content, "用户输入")}\n- 文件：问题分析输出、核对清单、候选知识已写入当前案件目录。\n- 边界：${modelBoundary}\n`
    }
  ];
}

export function buildAssistantContent(input: CaseWorkflowInput, generatedFiles: CaseGeneratedFile[], modelDraft?: SafeModelDraftRun): string {
  const fileList = generatedFiles.map((file) => `- ${file.relativePath}`).join("\n");
  if (modelDraft?.status === "success") {
    return [
      `已用已验证模型「${modelDraft.modelId}」生成 ${CASE_OUTPUT_PHASE} 安全本地草稿。`,
      "",
      "本次只调用模型生成草稿；没有读取真实 SAP，没有写入 SAP，也没有创建或发布飞书文档。",
      "",
      "已更新：",
      "- conversation.md",
      "- timeline.md",
      "- context_pack.md",
      "- metadata.json",
      fileList
    ].join("\n");
  }
  if (modelDraft?.status === "failed") {
    return [
      `已尝试使用已验证模型「${modelDraft.modelId}」，但模型草稿未生成。`,
      "",
      "本次失败没有写入 SAP、没有发布飞书，也没有保存原始模型请求或响应。",
      "",
      "已更新：",
      "- conversation.md",
      "- timeline.md",
      "- context_pack.md",
      "- metadata.json",
      fileList
    ].join("\n");
  }
  return [
    `已按「${TASK_MODE_LABELS[input.taskMode]}」模式生成 ${CASE_OUTPUT_PHASE} 本地案件输出。`,
    "",
    "当前没有合格的已验证模型；本次处理没有调用真实 SAP、模型或飞书，输出是可编辑、可追溯的本地草稿文件。",
    "",
    "已更新：",
    "- conversation.md",
    "- timeline.md",
    "- context_pack.md",
    "- metadata.json",
    fileList
  ].join("\n");
}

function renderConversation(messages: CaseMessage[]): string {
  return messages
    .map((message) => [
      `## ${message.role === "user" ? "用户" : message.modelId === "local-workflow" ? "本地工作流" : "模型草稿"} · ${message.createdAt}`,
      "",
      `任务模式：${TASK_MODE_LABELS[message.taskMode]}`,
      `模型：${message.modelId}`,
      "",
      message.content,
      ""
    ].join("\n"))
    .join("\n");
}

const knowledgeReferenceSourceLabels: Record<CaseKnowledgeReference["sourceType"], string> = {
  "case-candidate": "案件经验",
  "document-import": "本地文档",
  "qa-import": "QA文本",
  manual: "手工录入"
};

function knowledgeReferenceLine(reference: CaseKnowledgeReference): string {
  const sapObjects = reference.sapObjects.length > 0 ? reference.sapObjects.join(", ") : "未绑定";
  return `- ${reference.title}：${reference.summary}（来源：${knowledgeReferenceSourceLabels[reference.sourceType]}；发布：${reference.publishedAt ?? "未知"}；引用：${reference.attachedAt}；SAP对象：${sapObjects}）`;
}

function renderKnowledgeReferenceSection(references: CaseKnowledgeReference[]): string[] {
  if (references.length === 0) {
    return ["- 当前案件尚未引用已发布知识。"];
  }
  return references.map(knowledgeReferenceLine);
}

function metadataKnowledgeReferences(references: CaseKnowledgeReference[]) {
  return references.map((reference) => ({
    itemId: reference.itemId,
    title: reference.title,
    summary: reference.summary,
    sourceType: reference.sourceType,
    sourceCaseId: reference.sourceCaseId,
    sourceFilePath: reference.sourceFilePath,
    sapObjects: reference.sapObjects,
    publishedAt: reference.publishedAt,
    attachedAt: reference.attachedAt
  }));
}

function renderTimeline(caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[]): string {
  const messageEvents = caseItem.messages.map((message) => `- ${message.createdAt}：${message.role === "user" ? "用户补充案件信息" : `${CASE_OUTPUT_PHASE} 本地工作流生成回复`}（${TASK_MODE_LABELS[message.taskMode]}）。`);
  const fileEvents = generatedFiles.map((file) => `- ${nowIso()}：生成或刷新文件 ${file.relativePath}。`);
  const knowledgeReferenceEvents = caseItem.knowledgeReferences.map((reference) => `- ${reference.attachedAt}：引用已发布知识 ${reference.title}。`);
  return [
    "# 时间线",
    "",
    `- ${caseItem.createdAt}：创建案件。`,
    ...messageEvents,
    ...knowledgeReferenceEvents,
    ...fileEvents
  ].join("\n");
}

function renderContextPack(project: ProjectSummary, caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[], modelDraft?: SafeModelDraftRun): string {
  const recentMessages = caseItem.messages.slice(-4).map((message) => `- ${message.role === "user" ? "用户" : message.modelId === "local-workflow" ? "本地工作流" : "模型草稿"}：${safeContentSummary(message.content, message.role === "user" ? "用户输入" : "本地回复")}`);
  const recentFiles = generatedFiles.map((file) => `- ${file.relativePath}（${file.purpose}）`);
  const modelFact = modelDraft?.status === "success"
    ? `- 已调用已验证模型 ${modelDraft.modelId} 生成安全本地草稿。`
    : modelDraft?.status === "failed"
      ? `- 已尝试调用已验证模型 ${modelDraft.modelId}，但草稿未生成。`
      : "- 本次没有调用真实 SAP、模型 API、Codex 任务或飞书发布。";
  return [
    "# 上下文恢复包",
    "",
    "## 当前案件目标",
    "",
    caseItem.currentSummary,
    "",
    "## 已确认事实",
    "",
    `- 当前案件已生成 ${CASE_OUTPUT_PHASE} 本地输出文件。`,
    modelFact,
    "- 候选知识仍为待确认，不能当作正式知识。",
    "",
    "## 关键结论",
    "",
    caseItem.currentSummary,
    "",
    "## 项目上下文",
    "",
    `- 项目：${project.name}`,
    `- 系统标签：${project.systemLabel}`,
    `- SAP 版本：${project.sapVersion}`,
    `- 当前项目规范：${standardsSummaryForTask(project.standards)}`,
    "",
    "## SAP 对象",
    "",
    "- 尚未读取真实 SAP 对象。",
    "",
    "## 已引用知识",
    "",
    ...renderKnowledgeReferenceSection(caseItem.knowledgeReferences),
    "",
    "## 最近对话",
    "",
    ...recentMessages,
    "",
    "## 相关文件",
    "",
    ...recentFiles,
    "",
    "## 当前边界",
    "",
    `- ${CASE_OUTPUT_PHASE} 只生成本地草稿文件、项目规范摘要、安全模型草稿和待确认知识候选。`,
    `- ${modelBoundaryText(modelDraft)}`,
    "- 候选知识必须人工确认后才能正式入库。",
    "",
    "## 下一步",
    "",
    "- 后续接入真实任务模式时，优先读取当前项目配置和项目规范。",
    "- ABAP 开发模式必须先保存只读源码快照。",
    "- 用户确认后，候选知识才允许进入正式知识库。"
  ].join("\n");
}

function renderReadme(project: ProjectSummary, caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[]): string {
  return [
    `# ${caseItem.title}`,
    "",
    "## 当前结论",
    "",
    caseItem.currentSummary,
    "",
    "## 项目",
    "",
    `- 项目：${project.name}`,
    `- 系统标签：${project.systemLabel}`,
    `- SAP 版本：${project.sapVersion}`,
    "- 安全边界：本地个人版，SAP 默认只读",
    "",
    "## 交付物",
    "",
    ...generatedFiles.filter((file) => file.purpose === "output").map((file) => `- ${file.relativePath}`),
    "",
    "## 知识沉淀",
    "",
    ...generatedFiles.filter((file) => file.purpose === "candidate_knowledge").map((file) => `- ${file.relativePath}（待人工确认）`),
    "",
    "## 已引用知识",
    "",
    ...renderKnowledgeReferenceSection(caseItem.knowledgeReferences),
    "",
    "## 过程材料",
    "",
    ...generatedFiles.filter((file) => file.purpose !== "output" && file.purpose !== "candidate_knowledge").map((file) => `- ${file.relativePath}`)
  ].join("\n");
}

export function buildCaseWorkflowArtifacts(project: ProjectSummary, caseItem: CaseSummary, input: CaseWorkflowInput, modelDraft?: SafeModelDraftRun): CaseWorkflowArtifacts {
  const generatedFiles = [
    ...(modelDraft ? renderSafeModelDraftFiles(modelDraft) : []),
    ...modeFilePlan(input, project, caseItem, modelDraft)
  ];
  const currentSummary = modelDraft?.status === "success"
    ? `已用已验证模型生成安全本地草稿，并生成 ${generatedFiles.length} 个 ${CASE_OUTPUT_PHASE} 本地输出文件，等待用户确认。`
    : modelDraft?.status === "failed"
      ? `已尝试调用已验证模型但未生成草稿，已保存安全说明和 ${generatedFiles.length} 个本地输出文件。`
      : `已按「${TASK_MODE_LABELS[input.taskMode]}」模式生成 ${generatedFiles.length} 个 ${CASE_OUTPUT_PHASE} 本地输出文件，等待用户确认或继续补充。`;
  const enrichedCase: CaseSummary = { ...caseItem, currentSummary };
  return {
    currentSummary,
    generatedFiles,
    readme: renderReadme(project, enrichedCase, generatedFiles),
    conversation: renderConversation(enrichedCase.messages),
    timeline: renderTimeline(enrichedCase, generatedFiles),
    contextPack: renderContextPack(project, enrichedCase, generatedFiles, modelDraft),
    metadata: {
      schemaVersion: 1,
      caseId: enrichedCase.id,
      projectId: project.id,
      title: enrichedCase.title,
      status: enrichedCase.status,
      updatedAt: enrichedCase.updatedAt,
      knowledgeReferencePhase: "phase22-published-knowledge-case-context",
      knowledgeReferences: metadataKnowledgeReferences(enrichedCase.knowledgeReferences),
      lastTaskMode: input.taskMode,
      lastModelId: modelDraft?.modelId ?? input.modelId,
      generatedFiles: generatedFiles.map((file) => ({ relativePath: file.relativePath, purpose: file.purpose })),
      outputPhase: CASE_OUTPUT_PHASE,
      workflowBoundary: modelBoundaryText(modelDraft),
      safeModelDraft: modelDraft ? {
        status: modelDraft.status,
        providerName: modelDraft.providerName,
        modelId: modelDraft.modelId,
        generatedAt: modelDraft.generatedAt,
        contextCharCount: modelDraft.contextAudit.contextCharCount,
        referencedKnowledgeCount: modelDraft.contextAudit.referencedKnowledgeCount,
        safeOutputSummaryCount: modelDraft.contextAudit.safeOutputSummaryCount
      } : null,
      standards: {
        sourceTemplateId: project.standards.sourceTemplateId,
        sourceTemplateName: project.standards.sourceTemplateName,
        version: project.standards.version,
        summary: standardsSummaryForTask(project.standards)
      },
      safety: {
        localOnly: true,
        sapWrite: "disabled",
        externalModelCall: modelDraft?.status === "success" ? "safe-draft-run" : modelDraft?.status === "failed" ? "failed-no-raw-response-saved" : "not-run",
        feishuPublish: "not-run",
        secretsStoredInCaseFiles: false
      }
    }
  };
}

export function buildCaseMaintenanceArtifacts(project: ProjectSummary, caseItem: CaseSummary): CaseWorkflowArtifacts {
  const lastMessage = caseItem.messages.length > 0 ? caseItem.messages[caseItem.messages.length - 1] : null;
  return {
    currentSummary: caseItem.currentSummary,
    generatedFiles: [],
    readme: renderReadme(project, caseItem, []),
    conversation: renderConversation(caseItem.messages),
    timeline: renderTimeline(caseItem, []),
    contextPack: renderContextPack(project, caseItem, []),
    metadata: {
      schemaVersion: 1,
      caseId: caseItem.id,
      projectId: project.id,
      title: caseItem.title,
      status: caseItem.status,
      updatedAt: caseItem.updatedAt,
      knowledgeReferencePhase: "phase22-published-knowledge-case-context",
      knowledgeReferences: metadataKnowledgeReferences(caseItem.knowledgeReferences),
      lastTaskMode: lastMessage?.taskMode ?? "problem-analysis",
      lastModelId: lastMessage?.modelId ?? "local-workflow",
      generatedFiles: [],
      standards: {
        sourceTemplateId: project.standards.sourceTemplateId,
        sourceTemplateName: project.standards.sourceTemplateName,
        version: project.standards.version,
        summary: standardsSummaryForTask(project.standards)
      },
      safety: {
        localOnly: true,
        sapWrite: "disabled",
        externalModelCall: "not-run",
        feishuPublish: "not-run",
        secretsStoredInCaseFiles: false
      }
    }
  };
}
