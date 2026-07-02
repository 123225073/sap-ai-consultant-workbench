import { standardsSummaryForTask } from "./standardsService";
import type { CaseGeneratedFile, CaseMessage, CaseSummary, CaseWorkflowInput, ProjectSummary, TaskMode } from "../shared/workbenchTypes";

export const TASK_MODE_LABELS: Record<TaskMode, string> = {
  "problem-analysis": "问题分析",
  "abap-development": "ABAP 开发",
  "document-generation": "文档生成",
  "flow-diagram": "画流程图"
};

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
  return {
    content,
    taskMode: normalizeTaskMode(candidate.taskMode),
    modelId: "local-workflow"
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
  const clipped = singleLine.slice(0, 80);
  return `${sourceLabel}摘要（${content.length} 字，已通过本地敏感内容检查）：${clipped}${singleLine.length > clipped.length ? "..." : ""}`;
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

function modeFilePlan(input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary): CaseGeneratedFile[] {
  const header = `# ${TASK_MODE_LABELS[input.taskMode]}本地工作结果\n\n`;
  const standardsSummary = standardsSummaryForTask(project.standards);
  const context = [
    `- 项目：${project.name}`,
    `- 案件：${caseItem.title}`,
    `- 任务模式：${TASK_MODE_LABELS[input.taskMode]}`,
    `- 输入摘要：${safeContentSummary(input.content, "用户输入")}`,
    input.taskMode === "abap-development" ? `- 当前项目规范：${standardsSummary}` : null,
    "- 执行边界：Phase 5 仅做本地案件沉淀和项目规范引用，不调用真实 SAP、模型或飞书。",
    ""
  ].filter(Boolean).join("\n");

  if (input.taskMode === "abap-development") {
    return [
      {
        relativePath: "outputs/ABAP开发_只读开发说明.md",
        purpose: "output",
        content: `${header}${context}\n## 本地开发说明\n\n- 已按 ABAP 开发模式记录需求。\n- 当前任务已加载项目规范摘要：${standardsSummary}。\n- 后续真实接入时，必须先读取 SAP 最新源码并保存快照。\n- MVP 不自动写入、激活或释放传输请求。\n`
      },
      {
        relativePath: "snapshots/ABAP只读快照占位.md",
        purpose: "snapshot",
        content: `# ABAP 只读快照占位\n\n当前阶段未读取真实 SAP 源码。后续 ABAP 开发模式必须把真实只读快照保存到本目录。\n`
      }
    ];
  }

  if (input.taskMode === "document-generation") {
    return [
      {
        relativePath: "outputs/开发说明书.md",
        purpose: "output",
        content: `${header}${context}\n## 文档结构\n\n1. 基本信息\n2. 业务背景\n3. 处理目标\n4. 关键逻辑\n5. 数据来源\n6. 异常与边界说明\n7. 交付物\n8. 上线确认清单\n\n> 当前为本地 Markdown 草稿，尚未创建或发布飞书文档。\n`
      },
      {
        relativePath: "outputs/飞书发布准备说明.md",
        purpose: "output",
        content: "# 飞书发布准备说明\n\n- 当前仅生成本地草稿。\n- 发布前必须确认飞书 CLI 登录和文档权限。\n- 不记录飞书 Token、App Secret 或授权链接。\n"
      }
    ];
  }

  if (input.taskMode === "flow-diagram") {
    return [
      {
        relativePath: "outputs/逻辑说明图.mmd",
        purpose: "output",
        content: "flowchart TD\n  A[用户问题] --> B[本地案件上下文]\n  B --> C[生成流程图草稿]\n  C --> D[保存到 outputs]\n  D --> E[等待用户确认]\n"
      },
      {
        relativePath: "outputs/流程图说明.md",
        purpose: "output",
        content: `${header}${context}\n## 图示说明\n\n当前 Mermaid 文件是本地流程图草稿，可用于后续图片或飞书白板生成。\n`
      }
    ];
  }

  return [
    {
      relativePath: "outputs/问题分析_本地结论.md",
      purpose: "output",
      content: `${header}${context}\n## 初步结论\n\n当前问题已记录到案件。Phase 5 会先沉淀对话、时间线、上下文包、候选知识和项目规范摘要，后续真实模式再接入 SAP 只读读取与模型分析。\n`
    },
      {
        relativePath: "knowledge_candidates/案件经验候选.md",
        purpose: "candidate_knowledge",
        content: `# 案件经验候选\n\n状态：待确认\n\n来源案件：${caseItem.title}\n\n候选内容：${safeContentSummary(input.content, "用户输入")}。该候选知识必须人工确认后才能正式入库。\n`
      },
    {
      relativePath: "evidence/本地工作流记录.md",
      purpose: "evidence",
      content: "# 本地工作流记录\n\nPhase 5 已记录一次问题分析模式的本地案件工作流。当前没有调用真实 SAP、飞书或模型服务。\n"
    }
  ];
}

export function buildAssistantContent(input: CaseWorkflowInput, generatedFiles: CaseGeneratedFile[]): string {
  const fileList = generatedFiles.map((file) => `- ${file.relativePath}`).join("\n");
  return [
    `已按「${TASK_MODE_LABELS[input.taskMode]}」模式完成本地案件沉淀。`,
    "",
    "本阶段没有调用真实 SAP、模型或飞书，只把这次处理过程保存为可追溯的案件文件。",
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
      `## ${message.role === "user" ? "用户" : "AI"} · ${message.createdAt}`,
      "",
      `任务模式：${TASK_MODE_LABELS[message.taskMode]}`,
      `模型：${message.modelId}`,
      "",
      message.content,
      ""
    ].join("\n"))
    .join("\n");
}

function renderTimeline(caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[]): string {
  const messageEvents = caseItem.messages.map((message) => `- ${message.createdAt}：${message.role === "user" ? "用户补充案件信息" : "本地工作流生成回复"}（${TASK_MODE_LABELS[message.taskMode]}）。`);
  const fileEvents = generatedFiles.map((file) => `- ${nowIso()}：生成或刷新文件 ${file.relativePath}。`);
  return [
    "# 时间线",
    "",
    `- ${caseItem.createdAt}：创建案件。`,
    ...messageEvents,
    ...fileEvents
  ].join("\n");
}

function renderContextPack(project: ProjectSummary, caseItem: CaseSummary, generatedFiles: CaseGeneratedFile[]): string {
  const recentMessages = caseItem.messages.slice(-4).map((message) => `- ${message.role === "user" ? "用户" : "AI"}：${safeContentSummary(message.content, message.role === "user" ? "用户输入" : "本地回复")}`);
  const recentFiles = generatedFiles.map((file) => `- ${file.relativePath}（${file.purpose}）`);
  return [
    "# 上下文恢复包",
    "",
    "## 当前案件目标",
    "",
    caseItem.currentSummary,
    "",
    "## 已确认事实",
    "",
    "- 当前案件已完成本地文件沉淀。",
    "- 本阶段没有调用真实 SAP、模型 API、Codex 任务或飞书发布。",
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
    "- Phase 5 只做本地案件工作流、文件沉淀和项目规范引用。",
    "- 未调用真实 SAP、模型 API、Codex 任务或飞书发布。",
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
    "## 过程材料",
    "",
    ...generatedFiles.filter((file) => file.purpose !== "output" && file.purpose !== "candidate_knowledge").map((file) => `- ${file.relativePath}`)
  ].join("\n");
}

export function buildCaseWorkflowArtifacts(project: ProjectSummary, caseItem: CaseSummary, input: CaseWorkflowInput): CaseWorkflowArtifacts {
  const generatedFiles = modeFilePlan(input, project, caseItem);
  const currentSummary = `已按「${TASK_MODE_LABELS[input.taskMode]}」模式处理最新输入，并生成 ${generatedFiles.length} 个本地案件文件。`;
  const enrichedCase: CaseSummary = { ...caseItem, currentSummary };
  return {
    currentSummary,
    generatedFiles,
    readme: renderReadme(project, enrichedCase, generatedFiles),
    conversation: renderConversation(enrichedCase.messages),
    timeline: renderTimeline(enrichedCase, generatedFiles),
    contextPack: renderContextPack(project, enrichedCase, generatedFiles),
    metadata: {
      schemaVersion: 1,
      caseId: enrichedCase.id,
      projectId: project.id,
      title: enrichedCase.title,
      status: enrichedCase.status,
      updatedAt: enrichedCase.updatedAt,
      lastTaskMode: input.taskMode,
      lastModelId: input.modelId,
      generatedFiles: generatedFiles.map((file) => ({ relativePath: file.relativePath, purpose: file.purpose })),
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
