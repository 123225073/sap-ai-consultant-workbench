import { standardsSummaryForTask } from "./standardsService";
import type { ActionPermissionMode, CaseActionId, CaseGeneratedFile, CaseKnowledgeReference, CaseMessage, CaseSummary, CaseWorkflowInput, CodexCaseAssistRun, ProjectSummary, TaskMode } from "../shared/workbenchTypes";
import { renderSafeModelDraftFiles, safeModelDraftBoundary, safeModelDraftDisplayValue, type SafeModelDraftRun } from "./safeModelCaseDraftService";

export const TASK_MODE_LABELS: Record<TaskMode, string> = {
  "problem-analysis": "问题分析",
  "abap-development": "ABAP 开发",
  "document-generation": "文档生成",
  "flow-diagram": "画流程图"
};

export const CASE_ACTION_LABELS: Record<CaseActionId, string> = {
  "read-source": "梳理资料",
  "capture-note": "沉淀笔记",
  "development-spec": "生成开发说明书",
  "draw-flow": "画流程图",
  "candidate-knowledge": "整理候选知识",
  "export-handoff": "整理交付物"
};

const CASE_ACTION_TASK_MODES: Record<CaseActionId, TaskMode> = {
  "read-source": "problem-analysis",
  "capture-note": "problem-analysis",
  "development-spec": "document-generation",
  "draw-flow": "flow-diagram",
  "candidate-knowledge": "problem-analysis",
  "export-handoff": "document-generation"
};

const CASE_ACTION_OUTPUT_PATHS: Record<CaseActionId, string> = {
  "read-source": "evidence/资料梳理与缺口清单.md",
  "capture-note": "outputs/案件沉淀笔记.md",
  "development-spec": "outputs/开发说明书.md",
  "draw-flow": "outputs/逻辑说明图.mmd",
  "candidate-knowledge": "knowledge_candidates/问题处理经验候选.md",
  "export-handoff": "outputs/交付物清单与交接说明.md"
};

export const ACTION_PERMISSION_LABELS: Record<ActionPermissionMode, string> = {
  request_approval: "每步确认",
  approve_for_me: "低风险自动",
  full_access: "尽量自动"
};

const CASE_OUTPUT_PHASE = "受控本地成果";
const LOCAL_WORKFLOW_BOUNDARY = "本地案件工作流：没有合格模型时生成本地草稿；已验证模型只可生成安全本地草稿，不读取真实 SAP、不创建或发布飞书文档。";
const CODEX_ASSIST_BOUNDARY = "Codex 工程辅助：只基于当前案件输入生成工程分析；不读取 Codex 历史聊天，不写 SAP，不发布飞书，不保存终端原始日志。";

export interface CaseWorkflowArtifacts {
  currentSummary: string;
  generatedFiles: CaseGeneratedFile[];
  readme: string;
  conversation: string;
  timeline: string;
  contextPack: string;
  metadata: unknown;
}

export interface CaseWorkflowRuntimeContext {
  existingFiles: Array<{
    relativePath: string;
    purpose: string;
    sizeBytes: number;
    updatedAt: string;
  }>;
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

export function normalizeCaseActionId(value: unknown): CaseActionId | null {
  if (
    value === "read-source" ||
    value === "capture-note" ||
    value === "development-spec" ||
    value === "draw-flow" ||
    value === "candidate-knowledge" ||
    value === "export-handoff"
  ) {
    return value;
  }
  return null;
}

export function normalizeActionPermissionMode(value: unknown): ActionPermissionMode {
  if (value === "approve_for_me" || value === "full_access") return value;
  return "request_approval";
}

function optionalWorkflowTargetId(label: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value !== value.trim() || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error(`${label}包含不安全内容或疑似文件路径，已阻止处理。`);
  }
  return value;
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
      modelId: "local-workflow",
      actionId: null,
      permissionMode: "request_approval"
    };
  }

  if (!input || typeof input !== "object") {
    return {
      content: "",
      taskMode: "problem-analysis",
      modelId: "local-workflow",
      actionId: null,
      permissionMode: "request_approval"
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
  const actionId = normalizeCaseActionId(candidate.actionId);
  return {
    projectId: optionalWorkflowTargetId("Project ID", candidate.projectId),
    caseId: optionalWorkflowTargetId("Case ID", candidate.caseId),
    threadId: optionalWorkflowTargetId("任务会话 ID", candidate.threadId),
    content,
    taskMode: actionId ? CASE_ACTION_TASK_MODES[actionId] : normalizeTaskMode(candidate.taskMode),
    modelId: modelHint.modelId,
    actionId,
    permissionMode: normalizeActionPermissionMode(candidate.permissionMode),
    providerId: providerHint.providerId,
    codexAssistEnabled: candidate.codexAssistEnabled === true,
    rewindRevisionId: optionalWorkflowTargetId("对话历史版本 ID", candidate.rewindRevisionId),
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

function modelDraftContentOr(modelDraft: SafeModelDraftRun | undefined, fallback: string): string {
  return modelDraft?.status === "success" ? modelDraft.content : fallback;
}

function summaryExcerpt(value: string): string {
  return value.replace(/[`*_>#|\[\]{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
}

function commonContext(input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary, modelDraft?: SafeModelDraftRun): string {
  const standardsSummary = standardsSummaryForTask(project.standards, input.taskMode);
  return [
    `- 项目：${project.name}`,
    `- 案件：${caseItem.title}`,
    `- 任务模式：${TASK_MODE_LABELS[input.taskMode]}`,
    input.actionId ? `- 案件动作：${CASE_ACTION_LABELS[input.actionId]}` : null,
    `- 执行偏好：${ACTION_PERMISSION_LABELS[input.permissionMode]}（仅作记录，不替代系统安全边界）`,
    `- 输入摘要：${safeContentSummary(input.content, "用户输入")}`,
    input.taskMode === "abap-development" ? `- 当前项目规范摘要：${standardsSummary}` : null,
    `- 执行边界：${CASE_OUTPUT_PHASE} ${modelBoundaryText(modelDraft)}`,
    ""
  ].filter(Boolean).join("\n");
}

function traceabilityCsv(project: ProjectSummary, caseItem: CaseSummary, taskMode: TaskMode, modelDraft?: SafeModelDraftRun, codexAssist?: CodexCaseAssistRun): string {
  const modelStatus = modelDraft?.status === "success" ? "已调用安全草稿" : modelDraft?.status === "failed" ? "调用失败" : "未调用";
  const modelNote = modelDraft?.status === "success"
    ? `已用 ${modelDraft.modelId} 生成本地草稿`
    : modelDraft?.status === "failed"
      ? "模型未返回可保存草稿，已保存安全失败说明"
      : "没有合格模型时只生成本地草稿文件";
  const codexStatus = codexAssist?.status === "success" ? "已生成工程辅助分析" : codexAssist?.status === "failed" ? "执行失败" : "未调用";
  const codexNote = codexAssist?.status === "success"
    ? "已把 Codex 工程辅助分析保存到当前案件 outputs 目录"
    : codexAssist?.status === "failed"
      ? "Codex 未生成可用分析，已保存失败说明"
      : "未开启 Codex 工程辅助";
  return csvRows([
    ["类型", "名称", "状态", "说明"],
    ["项目", project.name, "已记录", `系统标签 ${project.systemLabel}`],
    ["案件", caseItem.title, "已记录", "所有输出写入当前案件文件夹"],
    ["任务模式", TASK_MODE_LABELS[taskMode], "已选择", "决定本地输出模板和文件目录"],
    ["SAP 写入", "禁用", "已锁定", "当前阶段不会写入、激活或释放传输"],
    ["外部模型", modelStatus, "受控", modelNote],
    ["Codex 工程辅助", codexStatus, "受控", codexNote],
    ["飞书发布", "未发布", "已锁定", "当前阶段不会创建或更新飞书文档"]
  ]);
}

function timestampForFile(value: string): string {
  const date = new Date(value);
  const source = Number.isNaN(date.getTime()) ? new Date() : date;
  return source.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function renderCodexCaseAssistFiles(codexAssist: CodexCaseAssistRun, input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary): CaseGeneratedFile[] {
  const fileName = codexAssist.status === "success"
    ? `outputs/Codex工程辅助分析-${timestampForFile(codexAssist.generatedAt)}.md`
    : `outputs/Codex工程辅助失败说明-${timestampForFile(codexAssist.generatedAt)}.md`;
  const content = codexAssist.status === "success"
    ? [
        "# Codex 工程辅助分析",
        "",
        `生成时间：${codexAssist.generatedAt}`,
        `执行器：${codexAssist.executorLabel}`,
        `项目：${project.name}`,
        `案件：${caseItem.title}`,
        `任务模式：${TASK_MODE_LABELS[input.taskMode]}`,
        "",
        "## 安全边界",
        "",
        `- ${CODEX_ASSIST_BOUNDARY}`,
        "- 本文件只保存 Codex 返回的安全分析正文，不保存终端原始输出。",
        "",
        "## 分析结果",
        "",
        codexAssist.content ?? "Codex 未返回正文。",
        ""
      ].join("\n")
    : [
        "# Codex 工程辅助失败说明",
        "",
        `生成时间：${codexAssist.generatedAt}`,
        `执行器：${codexAssist.executorLabel}`,
        `项目：${project.name}`,
        `案件：${caseItem.title}`,
        `任务模式：${TASK_MODE_LABELS[input.taskMode]}`,
        "",
        "## 当前状态",
        "",
        "Codex 工程辅助未生成可保存的分析内容，当前案件仍已按本地工作流生成基础输出。",
        "",
        "## 原因",
        "",
        codexAssist.errorMessage ?? "Codex 执行失败。",
        "",
        "## 下一步",
        "",
        "- 到配置中心重新测试 Codex。",
        "- 确认本机 Codex 可以正常登录和运行只读任务。",
        "- 重新发送案件消息并开启 Codex 工程辅助。",
        "",
        "## 安全边界",
        "",
        `- ${CODEX_ASSIST_BOUNDARY}`,
        "- 本文件不保存终端原始输出、stderr、密钥或授权信息。",
        ""
      ].join("\n");
  return [{ relativePath: fileName, purpose: "output", content }];
}

function renderProblemAnalysisKnowledgeCandidate(input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary, modelDraft?: SafeModelDraftRun): string {
  const reusableDraft = modelDraftContentOr(
    modelDraft,
    "当前没有可验证的模型提炼结果。请先在案件中补齐结论与证据，再由用户编辑本候选；不要把这段占位说明发布为正式知识。"
  );
  return [
    "# 问题处理经验候选",
    "",
    "状态：待确认",
    "",
    `来源案件：${caseItem.title}`,
    `来源项目：${project.name}`,
    `任务模式：${TASK_MODE_LABELS[input.taskMode]}`,
    "",
    "## 来源摘要",
    "",
    `- ${safeContentSummary(input.content, "用户输入")}`,
    `- 当前边界：${modelBoundaryText(modelDraft)}`,
    "- 本候选不是正式知识，不能直接作为长期经验引用。",
    "",
    "## 案件当前摘要",
    "",
    caseItem.currentSummary,
    "",
    "## 可复用经验草稿",
    "",
    reusableDraft,
    "",
    "## 入库前必须确认",
    "",
    "- 内容是否适用于当前项目。",
    "- 是否需要补充 SAP 对象、业务范围或失效条件。",
    "- 是否与已有知识冲突。",
    "- 是否已经去除 SAP 源码、客户明细、密码、Token 和授权信息。",
    ""
  ].join("\n");
}

export function createCaseMessage(
  role: CaseMessage["role"],
  caseId: string,
  content: string,
  taskMode: TaskMode,
  modelId: string,
  linkedFileIds: string[] = [],
  actionId: CaseActionId | null = null,
  permissionModeUsed: ActionPermissionMode = "request_approval",
  providerId?: string,
  agentTurnId?: string
): CaseMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    caseId,
    agentTurnId,
    role,
    content,
    taskMode,
    modelId,
    providerId,
    actionId,
    permissionModeUsed,
    linkedFileIds,
    createdAt: nowIso()
  };
}

// phase38-case-action-workflow: action and permission context stays in the local case boundary.
function safeConversationNotes(caseItem: CaseSummary): string[] {
  return caseItem.messages
    .slice(-8)
    .map((message) => {
      const excerpt = summaryExcerpt(message.content).slice(0, 220);
      return excerpt ? `- ${message.role === "user" ? "用户" : "AI"}：${excerpt}` : null;
    })
    .filter((line): line is string => Boolean(line));
}

function fileInventoryLines(runtime: CaseWorkflowRuntimeContext | undefined, plannedFiles: CaseGeneratedFile[] = []): string[] {
  const records = [
    ...(runtime?.existingFiles ?? []).map((file) => ({ relativePath: file.relativePath, purpose: file.purpose, sizeBytes: file.sizeBytes })),
    ...plannedFiles.map((file) => ({ relativePath: file.relativePath, purpose: file.purpose, sizeBytes: Buffer.byteLength(file.content, "utf8") }))
  ];
  const unique = new Map(records.map((record) => [record.relativePath, record]));
  return [...unique.values()]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
    .slice(0, 80)
    .map((file) => `- ${file.relativePath}（${file.purpose}，${file.sizeBytes} B）`);
}

function renderCaseActionFiles(
  input: CaseWorkflowInput,
  project: ProjectSummary,
  caseItem: CaseSummary,
  runtime: CaseWorkflowRuntimeContext | undefined,
  plannedFiles: CaseGeneratedFile[],
  modelDraft?: SafeModelDraftRun
): CaseGeneratedFile[] {
  if (!input.actionId) return [];
  const permissionLabel = ACTION_PERMISSION_LABELS[input.permissionMode];
  const commonBoundary = [
    `- 执行偏好：${permissionLabel}（仅作记录，不替代系统安全边界）`,
    "- 只使用本次补充、案件安全摘要、已引用正式知识、相关规范和 outputs 文件安全摘要。",
    "- 不写入 SAP，不发布 Feishu/Lark，不保存密码、Token、API Key 或授权信息。"
  ].join("\n");

  if (input.actionId === "read-source") {
    const files = fileInventoryLines(runtime);
    return [{
      relativePath: CASE_ACTION_OUTPUT_PATHS[input.actionId],
      purpose: "evidence",
      content: `# 资料梳理与缺口清单\n\n项目：${project.name}\n\n案件：${caseItem.title}\n\n## 当前文件清单\n\n${files.length ? files.join("\n") : "- 当前工作文件夹尚无可用文件。"}\n\n## 当前讨论摘要\n\n${safeConversationNotes(caseItem).join("\n") || "- 尚无可整理的讨论内容。"}\n\n## AI 梳理结果\n\n${modelDraftContentOr(modelDraft, "当前没有已验证模型的梳理结果；以下缺口根据文件类型确定。")}\n\n## 待补充资料\n\n- 缺少真实 SAP 对象证据时，只能保留为待确认结论。\n- 外部文档需由用户选择并经过受控导入后才能使用。\n- 交付前应补齐业务范围、异常样例、期望结果和验收口径。\n\n## 执行边界\n\n${commonBoundary}\n`
    }];
  }

  if (input.actionId === "capture-note") {
    return [{
      relativePath: CASE_ACTION_OUTPUT_PATHS[input.actionId],
      purpose: "output",
      content: `# 案件沉淀笔记\n\n## 当前讨论\n\n${safeConversationNotes(caseItem).join("\n") || "- 尚无可整理的讨论内容。"}\n\n## 本次输入\n\n${safeContentSummary(input.content, "本次案件输入")}\n\n## 结论与依据\n\n${modelDraftContentOr(modelDraft, "当前没有已验证模型的总结结果。请人工补充已确认结论、依据和未决事项。")}\n\n## 后续待办\n\n1. 补充缺少的业务范围、异常样例或验收口径。\n2. 需要时通过 SAP 只读取证补充技术证据。\n3. 将可复用经验整理为候选知识并人工审核。\n\n## 执行边界\n\n${commonBoundary}\n`
    }];
  }

  if (input.actionId === "export-handoff") {
    const files = fileInventoryLines(runtime, plannedFiles);
    return [{
      relativePath: CASE_ACTION_OUTPUT_PATHS[input.actionId],
      purpose: "output",
      content: `# 交付物清单与交接说明\n\n项目：${project.name}\n\n案件：${caseItem.title}\n\n## 交付结论\n\n${modelDraftContentOr(modelDraft, "当前没有已验证模型的交接总结，请由交付人补充最终结论与风险。")}\n\n## 实际文件清单\n\n${files.length ? files.join("\n") : "- 当前没有可交付文件。"}\n\n## 交接状态\n\n- 文件清单来自当前工作文件夹，不包含不存在的占位交付物。\n- 待确认知识仍不是正式知识。\n- SAP 证据仅代表只读结果，不代表已执行 SAP 写入。\n\n## 交接边界\n\n- 所有内容仍为本地文件，未自动创建或发布 Feishu/Lark 文档。\n- 发布、发送或复制到外部系统前仍需用户确认。\n\n## 执行边界\n\n${commonBoundary}\n`
    }];
  }

  return [];
}

const DEVELOPMENT_SPEC_HEADINGS = [
  "业务背景与目标",
  "需求范围",
  "现状与问题",
  "方案设计",
  "SAP 对象与接口",
  "处理逻辑",
  "权限与安全",
  "异常处理",
  "测试方案",
  "上线与回退",
  "待确认事项"
];

function developmentSpecBody(modelDraft: SafeModelDraftRun | undefined): { body: string; missing: string[] } {
  const fallback = DEVELOPMENT_SPEC_HEADINGS
    .map((heading) => `## ${heading}\n\n待确认：当前没有已验证模型生成的案件专用内容。`)
    .join("\n\n");
  const body = modelDraftContentOr(modelDraft, fallback);
  const missing = DEVELOPMENT_SPEC_HEADINGS.filter((heading) => !new RegExp(`^#{1,3}\\s*${heading}\\s*$`, "m").test(body));
  return { body, missing };
}

function extractMermaidDraft(modelDraft: SafeModelDraftRun | undefined, caseItem: CaseSummary): { source: string; status: "verified" | "fallback"; note: string } {
  if (modelDraft?.status === "success") {
    const unfenced = modelDraft.content
      .replace(/^```(?:mermaid)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const lines = unfenced.split(/\r?\n/);
    const nodeCount = lines.filter((line) => /(?:^|\s)[A-Za-z0-9_]+(?:\[|\{|\()/.test(line)).length;
    const forbidden = /\b(click|href)\b|<\/?(?:script|iframe|object|embed)|https?:\/\//i.test(unfenced);
    if (/^(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b/i.test(unfenced) && !forbidden && lines.length <= 160 && nodeCount <= 80) {
      return { source: `${unfenced}\n`, status: "verified", note: "Mermaid 结构与安全规则校验通过，业务含义仍需用户确认。" };
    }
  }
  const safeTitle = caseItem.title.replace(/[\[\]{}()"'`<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "当前案件";
  return {
    source: [
      "flowchart TD",
      `  A[\"开始：${safeTitle}\"] --> B[\"确认业务范围与期望结果\"]`,
      "  B --> C{证据是否充分}",
      "  C -- 否 --> D[\"补充 SAP 只读证据或业务样例\"]",
      "  D --> C",
      "  C -- 是 --> E[\"执行案件处理逻辑：待确认\"]",
      "  E --> F{结果是否满足验收口径}",
      "  F -- 否 --> G[\"记录差异并调整方案\"]",
      "  G --> E",
      "  F -- 是 --> H[\"结束：用户确认成果\"]",
      ""
    ].join("\n"),
    status: "fallback",
    note: "模型未返回通过校验的 Mermaid，已生成案件专用待确认骨架；必须补充真实业务节点后再交付。"
  };
}

function mermaidNodeRows(source: string): string[][] {
  const rows = [["节点 ID", "节点名称", "确认状态"]];
  const seen = new Set<string>();
  for (const match of source.matchAll(/^\s*([A-Za-z0-9_]+)\s*[\[({]+["']?([^\]\)}"']+)/gm)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    rows.push([match[1], match[2].trim(), /待确认/.test(match[2]) ? "待确认" : "需业务确认"]);
  }
  return rows;
}

function modeFilePlan(input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary, modelDraft?: SafeModelDraftRun, codexAssist?: CodexCaseAssistRun): CaseGeneratedFile[] {
  if (input.actionId === "read-source" || input.actionId === "capture-note" || input.actionId === "export-handoff") {
    return [];
  }
  const header = `# ${TASK_MODE_LABELS[input.taskMode]}本地输出\n\n`;
  const standardsSummary = standardsSummaryForTask(project.standards, input.taskMode);
  const context = commonContext(input, project, caseItem, modelDraft);
  const modelBoundary = modelBoundaryText(modelDraft);

  if (input.taskMode === "abap-development") {
    const implementationDraft = modelDraftContentOr(modelDraft, "尚未获得模型分析；当前文件只建立安全结构，需补充 SAP 只读快照、对象范围和验收口径后再形成实施方案。");
    return [
      {
        relativePath: "outputs/ABAP只读开发草稿.md",
        purpose: "output",
        content: `${header}${context}\n## 开发目标\n\n- 已按 ABAP 开发模式建立本地开发草稿。\n- 当前只记录需求和项目规范摘要，不复制用户原文、不保存真实源码。\n- 真实接入后，必须先通过 ADT 只读读取最新对象并保存快照，再进入开发说明。\n\n## 项目规范摘要\n\n${standardsSummary}\n\n## 实施分析草稿\n\n${implementationDraft}\n\n## 输出状态\n\n| 项目 | 当前结论 |\n|---|---|\n| 需求状态 | 待用户确认开发对象、影响范围和验收口径 |\n| 数据来源 | 当前案件安全上下文、相关规范摘要与已选择证据 |\n| 交付物 | 开发草稿、请求说明草稿、只读快照说明、安全边界说明 |\n| 禁止动作 | 不写入 SAP、不激活对象、不释放传输 |\n\n## 下一步核对\n\n1. 确认目标对象名称和对象类型。\n2. 在配置中心完成 ADT 只读验证。\n3. 读取最新对象快照后，再确认实施方案。\n`
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
    const specification = developmentSpecBody(modelDraft);
    const complianceStatus = specification.missing.length === 0 ? "结构校验通过" : `结构不完整，缺少：${specification.missing.join("、")}`;
    return [
      {
        relativePath: "outputs/开发说明书.md",
        purpose: "output",
        content: `${header}${context}\n## 基本信息\n\n| 字段 | 内容 |\n|---|---|\n| 项目 | ${project.name} |\n| 案件 | ${caseItem.title} |\n| 文档状态 | 本地 Markdown 草稿，待顾问审阅 |\n| 结构校验 | ${complianceStatus} |\n| 发布状态 | 未创建或发布飞书文档 |\n\n${specification.body}\n\n## 项目规范依据\n\n${standardsSummary}\n\n## 数据来源与可追溯性\n\n- 本次用户补充和案件安全摘要。\n- 已引用的正式知识与相关项目规范。\n- 当前案件 outputs 文件的安全摘要。\n- 未经只读取证，不声称已读取真实 SAP。\n\n## 审阅结论\n\n- ${complianceStatus}。\n- 文档中的“待确认”必须由 SAP 顾问补齐后才能作为正式交付物。\n- 本工作台未执行 SAP 写入、对象激活、传输释放或外部发布。\n`
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
    const mermaid = extractMermaidDraft(modelDraft, caseItem);
    return [
      {
        relativePath: "outputs/逻辑说明图.mmd",
        purpose: "output",
        content: mermaid.source
      },
      {
        relativePath: "outputs/流程图说明.md",
        purpose: "output",
        content: `${header}${context}\n## 校验状态\n\n${mermaid.note}\n\n## 图示说明\n\n该 Mermaid 文件只表达当前案件的业务/技术流程草稿，不代表 SAP 运行结果，也没有发布到飞书白板。\n\n## 用户需确认\n\n- 节点顺序、判断条件和异常路径是否符合真实业务流程。\n- 所有“待确认”节点是否已经补充证据。\n- 是否需要在审阅后转换成图片或飞书白板素材。\n`
      },
      {
        relativePath: "outputs/流程节点清单.csv",
        purpose: "output",
        content: csvRows(mermaidNodeRows(mermaid.source))
      }
    ];
  }

  const problemDraft = modelDraftContentOr(modelDraft, "当前没有模型分析结果。已建立核对结构，但不能据此声称找到根因；请继续补充异常现象、期望结果和只读证据。");
  return [
    {
      relativePath: "outputs/问题分析_处理结论.md",
      purpose: "output",
      content: `${header}${context}\n## 分析草稿\n\n${problemDraft}\n\n## 当前证据状态\n\n- 本次补充已记录到 conversation.md。\n- timeline.md、context_pack.md 和 metadata.json 已刷新。\n- 未经 SAP 只读取证或用户明确提供的材料，不把推测写成已确认根因。\n\n## 待确认\n\n1. 是否需要读取 SAP 对象或表结构作为证据。\n2. 是否需要补充影响范围、异常样例和期望结果。\n3. 结论确认后，是否通过“整理候选知识”单独生成知识候选。\n\n## 安全边界\n\n${modelBoundary}\n`
    },
      {
        relativePath: "outputs/问题分析_核对清单.csv",
        purpose: "output",
        content: traceabilityCsv(project, caseItem, input.taskMode, modelDraft, codexAssist)
      },
      ...(input.actionId === "candidate-knowledge" ? [{
        relativePath: "knowledge_candidates/问题处理经验候选.md",
        purpose: "candidate_knowledge" as const,
        content: renderProblemAnalysisKnowledgeCandidate(input, project, caseItem, modelDraft)
      }] : []),
    {
      relativePath: "evidence/本地处理证据.md",
      purpose: "evidence",
      content: `# 本地处理证据\n\n- 阶段：${CASE_OUTPUT_PHASE}\n- 输入：${safeContentSummary(input.content, "用户输入")}\n- 文件：问题分析输出、核对清单、候选知识已写入当前案件目录。\n- 边界：${modelBoundary}\n`
    }
  ];
}

function codexAssistMessage(codexAssist?: CodexCaseAssistRun): string {
  if (!codexAssist) return "";
  if (codexAssist.status === "success") return "Codex 工程辅助已生成受控分析文件；未读取历史聊天，也未执行外部发布。";
  return "Codex 工程辅助未成功生成分析文件；已保存失败说明，当前案件基础输出不受影响。";
}

export function buildAssistantContent(input: CaseWorkflowInput, generatedFiles: CaseGeneratedFile[], modelDraft?: SafeModelDraftRun, codexAssist?: CodexCaseAssistRun): string {
  const resultLine = `已生成 ${generatedFiles.length} 个本地成果，可从回复下方或右侧文件面板打开。`;
  const codexLine = codexAssistMessage(codexAssist);
  const hasCodexAssist = Boolean(codexAssist);
  const actionLine = input.actionId ? `案件动作：${CASE_ACTION_LABELS[input.actionId]}。执行偏好：${ACTION_PERMISSION_LABELS[input.permissionMode]}。` : "";
  if (modelDraft?.status === "success") {
    return [
      modelDraft.content,
      "",
      actionLine,
      hasCodexAssist
        ? "已同步生成本地成果和 Codex 工程辅助文件；未执行外部系统写入或发布。"
        : "已同步生成本地成果文件；未执行外部系统写入或发布。",
      codexLine,
      resultLine
    ].filter(Boolean).join("\n");
  }
  if (modelDraft?.status === "failed") {
    const failureReason = safeModelDraftDisplayValue(
      "模型失败原因",
      modelDraft.errorMessage,
      "模型或受控工具调用失败，请检查当前连接、授权和模型兼容性后重试。"
    );
    return [
      `已尝试使用已验证模型「${modelDraft.modelId}」，但模型草稿未生成。`,
      `失败原因：${failureReason}`,
      "",
      actionLine,
      "本次失败未执行外部系统写入或发布，也没有保存原始模型请求或响应。",
      codexLine,
      "",
      resultLine
    ].join("\n");
  }
  return [
    `已按「${TASK_MODE_LABELS[input.taskMode]}」模式生成 ${CASE_OUTPUT_PHASE} 本地案件输出。`,
    "",
    actionLine,
    hasCodexAssist
      ? "当前没有可用的已验证模型；已生成可编辑、可追溯的本地结构草稿，Codex 工程辅助只额外生成受控分析。"
      : "当前没有可用的已验证模型；已生成可编辑、可追溯的本地结构草稿，可在配置中心验证模型渠道后继续。",
    codexLine,
    "",
    resultLine
  ].join("\n");
}

function renderConversation(messages: CaseMessage[]): string {
  return messages
    .map((message) => [
      `## ${message.role === "user" ? "用户" : message.modelId === "local-workflow" ? "本地工作流" : "模型草稿"} · ${message.createdAt}`,
      "",
      `任务模式：${TASK_MODE_LABELS[message.taskMode]}`,
      message.actionId ? `案件动作：${CASE_ACTION_LABELS[message.actionId]}` : null,
      `执行偏好：${ACTION_PERMISSION_LABELS[message.permissionModeUsed ?? "request_approval"]}`,
      `模型：${message.modelId}`,
      "",
      message.content,
      ""
    ].filter((line) => line !== null).join("\n"))
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

function renderTimeline(caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[], codexAssist?: CodexCaseAssistRun): string {
  const messageEvents = caseItem.messages.map((message) => {
    const actionText = message.actionId ? `；案件动作：${CASE_ACTION_LABELS[message.actionId]}；执行偏好：${ACTION_PERMISSION_LABELS[message.permissionModeUsed ?? "request_approval"]}` : "";
    return `- ${message.createdAt}：${message.role === "user" ? "用户补充案件信息" : `${CASE_OUTPUT_PHASE} 本地工作流生成回复`}（${TASK_MODE_LABELS[message.taskMode]}${actionText}）。`;
  });
  const fileEvents = generatedFiles.map((file) => `- ${nowIso()}：生成或刷新文件 ${file.relativePath}。`);
  const knowledgeReferenceEvents = caseItem.knowledgeReferences.map((reference) => `- ${reference.attachedAt}：引用已发布知识 ${reference.title}。`);
  const codexEvent = codexAssist ? [`- ${codexAssist.generatedAt}：Codex 工程辅助${codexAssist.status === "success" ? "生成受控分析" : "执行失败并保存说明"}。`] : [];
  return [
    "# 时间线",
    "",
    `- ${caseItem.createdAt}：创建案件。`,
    ...messageEvents,
    ...knowledgeReferenceEvents,
    ...codexEvent,
    ...fileEvents
  ].join("\n");
}

function renderContextPack(project: ProjectSummary, caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[], modelDraft?: SafeModelDraftRun, codexAssist?: CodexCaseAssistRun): string {
  const lastTaskMode = caseItem.messages[caseItem.messages.length - 1]?.taskMode ?? null;
  const recentMessages = caseItem.messages.slice(-4).map((message) => `- ${message.role === "user" ? "用户" : message.modelId === "local-workflow" ? "本地工作流" : "模型草稿"}：${safeContentSummary(message.content, message.role === "user" ? "用户输入" : "本地回复")}`);
  const recentFiles = generatedFiles.map((file) => `- ${file.relativePath}（${file.purpose}）`);
  const modelFact = modelDraft?.status === "success"
    ? `- 已调用已验证模型 ${modelDraft.modelId} 生成安全本地草稿。`
    : modelDraft?.status === "failed"
      ? `- 已尝试调用已验证模型 ${modelDraft.modelId}，但草稿未生成。`
      : "- 本次没有调用真实 SAP、模型 API 或飞书发布。";
  const codexFact = codexAssist?.status === "success"
    ? "- Codex 工程辅助已生成受控分析；未读取历史聊天，未写 SAP，未发布飞书。"
    : codexAssist?.status === "failed"
      ? "- Codex 工程辅助执行失败；已保存失败说明，未保存终端原始输出。"
      : "- Codex 工程辅助未开启。";
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
    codexFact,
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
    `- 当前项目规范：${standardsSummaryForTask(project.standards, lastTaskMode)}`,
    "",
    "## SAP 对象",
    "",
    "- SAP 只读证据以当前工作文件夹中的 evidence/sap、snapshots、technical 文件和本轮工具审计记录为准；本上下文包不重复原始 SAP 数据。",
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
    `- ${CASE_OUTPUT_PHASE} 生成本地成果、项目规范摘要、安全模型结果和待确认知识候选；已授权 SAP 能力仅允许受控只读取证。`,
    `- ${modelBoundaryText(modelDraft)}`,
    `- ${CODEX_ASSIST_BOUNDARY}`,
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

export function buildCaseWorkflowArtifacts(
  project: ProjectSummary,
  caseItem: CaseSummary,
  input: CaseWorkflowInput,
  modelDraft?: SafeModelDraftRun,
  codexAssist?: CodexCaseAssistRun,
  runtime?: CaseWorkflowRuntimeContext
): CaseWorkflowArtifacts {
  const modeFiles = modeFilePlan(input, project, caseItem, modelDraft, codexAssist);
  const generatedFiles = [
    ...(modelDraft ? renderSafeModelDraftFiles(modelDraft) : []),
    ...(codexAssist ? renderCodexCaseAssistFiles(codexAssist, input, project, caseItem) : []),
    ...renderCaseActionFiles(input, project, caseItem, runtime, modeFiles, modelDraft),
    ...modeFiles
  ];
  const codexSummary = codexAssist?.status === "success"
    ? "，并已生成 Codex 工程辅助分析"
    : codexAssist?.status === "failed"
      ? "，Codex 工程辅助未成功但已保存失败说明"
      : "";
  const currentSummary = modelDraft?.status === "success"
    ? `模型分析草稿：${summaryExcerpt(modelDraft.content)}${codexSummary}。已保存 ${generatedFiles.length} 个本地文件，结论仍待用户确认。`
    : modelDraft?.status === "failed"
      ? `模型调用失败${codexSummary}。已保存失败说明与 ${generatedFiles.length} 个本地文件，尚未形成可验证结论。`
      : `已记录「${TASK_MODE_LABELS[input.taskMode]}」任务并生成 ${generatedFiles.length} 个本地工作文件${codexSummary}；当前没有模型分析，尚未形成可验证结论。`;
  const enrichedCase: CaseSummary = { ...caseItem, currentSummary };
  return {
    currentSummary,
    generatedFiles,
    readme: renderReadme(project, enrichedCase, generatedFiles),
    conversation: renderConversation(enrichedCase.messages),
    timeline: renderTimeline(enrichedCase, generatedFiles, codexAssist),
    contextPack: renderContextPack(project, enrichedCase, generatedFiles, modelDraft, codexAssist),
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
      lastAction: input.actionId ? {
        id: input.actionId,
        label: CASE_ACTION_LABELS[input.actionId],
        outputPath: CASE_ACTION_OUTPUT_PATHS[input.actionId]
      } : null,
      lastPermissionMode: input.permissionMode,
      actionPermissionMode: input.permissionMode,
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
      codexAssist: codexAssist ? {
        status: codexAssist.status,
        executorLabel: codexAssist.executorLabel,
        generatedAt: codexAssist.generatedAt,
        outputCharCount: codexAssist.outputCharCount
      } : null,
      standards: {
        sourceTemplateId: project.standards.sourceTemplateId,
        sourceTemplateName: project.standards.sourceTemplateName,
        version: project.standards.version,
        summary: standardsSummaryForTask(project.standards, input.taskMode)
      },
      safety: {
        localOnly: true,
        sapWrite: "disabled",
        externalModelCall: modelDraft?.status === "success" ? "safe-draft-run" : modelDraft?.status === "failed" ? "failed-no-raw-response-saved" : "not-run",
        codexAssist: codexAssist?.status === "success" ? "readonly-ephemeral-case-assist" : codexAssist?.status === "failed" ? "failed-no-raw-output-saved" : "not-run",
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
      lastAction: lastMessage?.actionId ? {
        id: lastMessage.actionId,
        label: CASE_ACTION_LABELS[lastMessage.actionId],
        outputPath: CASE_ACTION_OUTPUT_PATHS[lastMessage.actionId]
      } : null,
      lastPermissionMode: lastMessage?.permissionModeUsed ?? "request_approval",
      actionPermissionMode: lastMessage?.permissionModeUsed ?? "request_approval",
      lastModelId: lastMessage?.modelId ?? "local-workflow",
      generatedFiles: [],
      standards: {
        sourceTemplateId: project.standards.sourceTemplateId,
        sourceTemplateName: project.standards.sourceTemplateName,
        version: project.standards.version,
        summary: standardsSummaryForTask(project.standards, lastMessage?.taskMode)
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
