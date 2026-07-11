import path from "node:path";
import type { CaseGeneratedFile, CaseSummary, FeishuConfig, FeishuHandoffPublishStatus, ProjectSummary } from "../shared/workbenchTypes";

export const FEISHU_HANDOFF_LOCAL_ONLY_MARKER = "feishu-handoff-local-only";

export const FEISHU_HANDOFF_BLOCKED_ACTIONS = [
  "cloud document creation",
  "cloud document update",
  "cloud whiteboard update",
  "device login flow",
  "secret storage",
  "automatic final publish"
] as const;

export interface FeishuHandoffSourceSummary {
  relativePath: string;
  displayName: string;
  fileType: string;
  sizeBytes: number;
  snippet: string;
  updatedAt: string;
}

export interface FeishuHandoffArtifacts {
  createdAt: string;
  publishStatus: FeishuHandoffPublishStatus;
  generatedFiles: CaseGeneratedFile[];
  sourceFiles: string[];
  blockedActions: string[];
}

export interface FeishuHandoffRenderInput {
  project: ProjectSummary;
  caseItem: CaseSummary;
  feishu: FeishuConfig;
  safeOutputSummaries: FeishuHandoffSourceSummary[];
  createdAt?: string;
}

const MAX_SOURCE_FILES = 12;
const MAX_SNIPPET_CHARS = 240;

function timestampSlug(value: string): string {
  return value.replace(/[-:.TZ]/g, "").slice(0, 14);
}

function plain(value: string, fallback = ""): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function mdCell(value: string): string {
  return plain(value).replaceAll("|", "\\|");
}

function mermaidLabel(value: string): string {
  return plain(value, "item").replace(/["<>]/g, "");
}

function snippet(value: string): string {
  const normalized = plain(value);
  return normalized.length > MAX_SNIPPET_CHARS ? `${normalized.slice(0, MAX_SNIPPET_CHARS)}...` : normalized;
}

function statusLabel(value: FeishuConfig): string {
  if (value.authStatus === "verified" && value.docPermissionStatus === "verified") {
    return "本机 CLI 状态检查已通过";
  }
  if (value.authStatus === "verified") {
    return "CLI 登录已验证，文档权限未验证";
  }
  return "尚未验证云端发布能力";
}

function sensitivePatterns(): RegExp[] {
  return [
    /authorization\s*[:=]/i,
    /cookie\s*[:=]/i,
    /bearer\s+[a-z0-9._~+/=-]{12,}/i,
    /secure-store:sec_[a-f0-9]{32}/i,
    /sk-(?:proj-)?[a-z0-9_-]{20,}/i,
    /api[_-]?key\s*[:=]/i,
    /password\s*[:=]/i,
    /token\s*[:=]/i,
    new RegExp("tenant_" + "access_" + "token", "i"),
    new RegExp("user_" + "access_" + "token", "i"),
    new RegExp("device_" + "code", "i"),
    new RegExp("verification_" + "uri", "i"),
    new RegExp("document_" + "id", "i"),
    /https:\/\/[a-z0-9.-]*feishu/i,
    /https:\/\/[a-z0-9.-]*larksuite/i
  ];
}

export function assertSafeFeishuHandoffText(content: string): string {
  if (sensitivePatterns().some((pattern) => pattern.test(content))) {
    throw new Error("飞书交接草稿包含疑似密钥、授权信息或云端发布标记，已阻止生成。");
  }
  return content;
}

function renderMarkdown(input: Required<FeishuHandoffRenderInput>, sources: FeishuHandoffSourceSummary[]): string {
  const rows = sources.map((source) => (
    `| ${mdCell(source.displayName)} | ${mdCell(source.relativePath)} | ${mdCell(source.fileType || "text")} | ${mdCell(snippet(source.snippet))} |`
  ));
  const sourceRows = rows.length > 0 ? rows : ["| 暂无安全输出来源 | outputs/ | text | 请先生成案件成果，再重新准备交接草稿。 |"];
  return assertSafeFeishuHandoffText([
    "# 飞书 CLI 本地交接草稿",
    "",
    `标记：${FEISHU_HANDOFF_LOCAL_ONLY_MARKER}`,
    "",
    "## 状态",
    "",
    "| 字段 | 值 |",
    "|---|---|",
    `| 发布状态 | 未发布 |`,
    `| 创建时间 | ${input.createdAt} |`,
    `| Project | ${mdCell(input.project.name)} |`,
    `| 工作文件夹 | ${mdCell(input.caseItem.title)} |`,
    `| 飞书 Profile | ${mdCell(input.feishu.profile || "default")} |`,
    `| 飞书 CLI 检查 | ${statusLabel(input.feishu)} |`,
    "",
    "## 边界",
    "",
    "- 本文件是等待人工审核的本地草稿。",
    "- 工作台没有创建或更新任何 Feishu/Lark 云文档。",
    "- 最终云端发布必须由用户本人执行并确认。",
    "- 本文件不保存密钥或云端文档标识。",
    "",
    "## 来源成果",
    "",
    "| 名称 | 本地文件 | 类型 | 安全摘要 |",
    "|---|---|---|---|",
    ...sourceRows,
    "",
    "## 人工交接清单",
    "",
    "1. 打开当前工作文件夹里的 Markdown 成果。",
    "2. 审核业务表述，移除不适合目标飞书空间的内容。",
    "3. 在本动作之外使用已批准的飞书 CLI 或飞书客户端流程。",
    "4. 只有人工发布成功后，才在工作文件夹中记录最终云端链接。",
    "",
    "## 本动作明确禁止",
    "",
    ...FEISHU_HANDOFF_BLOCKED_ACTIONS.map((action) => `- ${action}`)
  ].join("\n"));
}

function renderMermaid(input: Required<FeishuHandoffRenderInput>, sources: FeishuHandoffSourceSummary[]): string {
  const sourceLines = sources.slice(0, 5).map((source, index) => (
    `  S${index + 1}["${mermaidLabel(source.displayName)}"] --> R["人工审核"]`
  ));
  return assertSafeFeishuHandoffText([
    "flowchart TD",
    `  A["${mermaidLabel(input.caseItem.title)}"] --> B["安全本地成果"]`,
    "  B --> R[\"人工审核\"]",
    ...sourceLines,
    "  R --> C[\"在应用外执行已批准的飞书流程\"]",
    "  C --> D[\"人工确认发布\"]",
    "  D --> E[\"确认后记录最终链接\"]"
  ].join("\n"));
}

function renderManifest(input: Required<FeishuHandoffRenderInput>, sources: FeishuHandoffSourceSummary[], generatedFiles: string[]): string {
  return assertSafeFeishuHandoffText(`${JSON.stringify({
    schemaVersion: 1,
    marker: FEISHU_HANDOFF_LOCAL_ONLY_MARKER,
    publishStatus: "not-published",
    createdAt: input.createdAt,
    projectId: input.project.id,
    caseId: input.caseItem.id,
    feishuProfile: input.feishu.profile || "default",
    feishuCliStatus: {
      authStatus: input.feishu.authStatus,
      docPermissionStatus: input.feishu.docPermissionStatus,
      lastCheckedAt: input.feishu.lastCheckedAt
    },
    sourceFiles: sources.map((source) => ({
      relativePath: source.relativePath,
      displayName: source.displayName,
      fileType: source.fileType,
      sizeBytes: source.sizeBytes,
      updatedAt: source.updatedAt
    })),
    generatedFiles,
    blockedActions: FEISHU_HANDOFF_BLOCKED_ACTIONS,
    safety: {
      localOnly: true,
      cloudDocumentCreated: false,
      cloudDocumentUpdated: false,
      cloudWhiteboardUpdated: false,
      tokenStored: false,
      finalPublishRequiresHuman: true
    }
  }, null, 2)}\n`);
}

export function renderFeishuHandoffArtifacts(input: FeishuHandoffRenderInput): FeishuHandoffArtifacts {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const normalizedInput: Required<FeishuHandoffRenderInput> = { ...input, createdAt };
  const sources = input.safeOutputSummaries.slice(0, MAX_SOURCE_FILES).map((source) => ({
    ...source,
    relativePath: source.relativePath.replaceAll("\\", "/"),
    displayName: plain(source.displayName, path.basename(source.relativePath)),
    snippet: snippet(source.snippet)
  }));
  const slug = timestampSlug(createdAt);
  const handoffPath = `outputs/feishu-handoff-${slug}.md`;
  const whiteboardPath = `outputs/feishu-whiteboard-${slug}.mmd`;
  const manifestPath = `technical/feishu-handoff-manifest-${slug}.json`;
  const generatedPaths = [handoffPath, whiteboardPath, manifestPath];
  const generatedFiles: CaseGeneratedFile[] = [
    {
      relativePath: handoffPath,
      purpose: "output",
      content: renderMarkdown(normalizedInput, sources)
    },
    {
      relativePath: whiteboardPath,
      purpose: "output",
      content: renderMermaid(normalizedInput, sources)
    },
    {
      relativePath: manifestPath,
      purpose: "technical",
      content: renderManifest(normalizedInput, sources, generatedPaths)
    }
  ];
  return {
    createdAt,
    publishStatus: "not-published",
    generatedFiles,
    sourceFiles: sources.map((source) => source.relativePath),
    blockedActions: [...FEISHU_HANDOFF_BLOCKED_ACTIONS]
  };
}
