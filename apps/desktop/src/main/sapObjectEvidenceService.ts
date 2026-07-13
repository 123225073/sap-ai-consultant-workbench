import { createHash } from "node:crypto";
import type {
  AdtRedactedSystemInfo,
  AdtVerificationMode,
  CaseGeneratedFile,
  SapObjectEvidenceRequest,
  SapObjectEvidenceSummary,
  SapObjectEvidenceType
} from "../shared/workbenchTypes";

export const SAP_OBJECT_EVIDENCE_ALLOWED_TYPES = [
  "program",
  "class",
  "function",
  "include",
  "table",
  "structure"
] as const;

export const sapObjectEvidenceBoundary = "SAP 只读证据：仅允许读取当前工作文件夹明确指定的单个对象；禁止 SAP 写入、任意 SQL、批量读取、传输和原始连接器输出。";

export interface SapObjectEvidenceConnectorResult {
  objectType: SapObjectEvidenceType;
  objectName: string;
  functionGroup: string | null;
  system: AdtRedactedSystemInfo;
  sourceMode: AdtVerificationMode;
  evidenceKind?: "fixed-adt-readonly-source";
  content: string;
  readAt: string;
}

export interface SapObjectEvidenceRecord {
  summary: SapObjectEvidenceSummary;
  content: string;
}

const MAX_OBJECT_NAME_CHARS = 48;
const MAX_EVIDENCE_TEXT_CHARS = 20000;

const allowedTypes = new Set<string>(SAP_OBJECT_EVIDENCE_ALLOWED_TYPES);

const unsafeNamePatterns = [
  /[\u0000-\u001f\u007f]/,
  /\s/,
  /\.\./,
  /[\\:*?"<>|]/,
  /[#;&]/,
  /^[a-z][a-z0-9+.-]*:/i,
  /\*/,
  /\?/,
  /\b(SELECT|UPDATE|INSERT|DELETE|MODIFY|CALL|SUBMIT|TRANSACTION|TRANSPORT|ACTIVATE|PACKAGE|NAMESPACE|WHERE|FROM)\b/i
];

const hardUnsafeEvidenceTextPatterns = [
  /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /secure-store:sec_[a-f0-9]{32}/i,
  /bearer\s+[a-z0-9._~+/=-]{12,}/i,
  /authorization\s*[:=]\s*[^\n\r]+/i,
  /cookie\s*[:=]\s*[^\n\r]+/i,
  /sap_sessionid/i,
  /mysapsso2/i,
  /x-csrf-token\s*[:=]\s*[^\n\r]+/i,
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
  /token\s*[:=]/i
];

const commandLikeEvidenceTextPatterns = [
  /\bSELECT\s+[\s\S]{0,300}\s+FROM\s+[\w/]+/i,
  /\bCALL\s+(FUNCTION|TRANSACTION)\b/i,
  /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeObjectName(value: unknown, label: string): string {
  const normalized = text(value).toUpperCase();
  if (!normalized || normalized.length > MAX_OBJECT_NAME_CHARS) {
    throw new Error(`${label}不能为空，且不能超过 ${MAX_OBJECT_NAME_CHARS} 个字符。`);
  }
  if (unsafeNamePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`${label}包含不安全字符或疑似命令内容。`);
  }
  const slashCount = normalized.split("/").length - 1;
  if (slashCount !== 0 && !(slashCount === 2 && normalized.startsWith("/"))) {
    throw new Error(`${label}必须是普通 SAP 名称或斜杠命名空间名称。`);
  }

  const namespaceMatch = normalized.match(/^\/[A-Z0-9_]{1,12}\/[A-Z0-9_][A-Z0-9_/$-]{0,39}$/);
  const normalMatch = normalized.match(/^[A-Z0-9_][A-Z0-9_/$-]{0,47}$/);
  if (!namespaceMatch && !normalMatch) {
    throw new Error(`${label}不是受支持的 SAP 对象标识。`);
  }

  return normalized;
}

export function parseSapObjectEvidenceRequest(input: unknown): SapObjectEvidenceRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("SAP 证据请求格式无效。");
  }
  const candidate = input as Partial<SapObjectEvidenceRequest>;
  const allowedKeys = new Set(["objectType", "objectName", "functionGroup", "connectionMode", "connectionIds", "queryContext"]);
  const extraKeys = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) {
    throw new Error("SAP 证据请求包含不支持的字段。");
  }
  const objectType = text(candidate.objectType);
  if (!allowedTypes.has(objectType)) {
    throw new Error("不支持当前 SAP 证据对象类型。");
  }

  const request: SapObjectEvidenceRequest = {
    objectType: objectType as SapObjectEvidenceType,
    objectName: normalizeObjectName(candidate.objectName, "SAP 对象名"),
    connectionMode: candidate.connectionMode === "manual" ? "manual" : "auto"
  };

  if (candidate.connectionMode !== undefined && candidate.connectionMode !== "auto" && candidate.connectionMode !== "manual") {
    throw new Error("SAP 连接选择模式无效。");
  }
  if (candidate.connectionIds !== undefined) {
    if (!Array.isArray(candidate.connectionIds) || candidate.connectionIds.length > 6) {
      throw new Error("SAP 连接列表无效；一次只读取 1 至 6 个已确认连接。");
    }
    const connectionIds = [...new Set(candidate.connectionIds.map((value) => text(value)))];
    if (connectionIds.some((value) => !/^[A-Za-z0-9_-]{1,80}$/.test(value))) {
      throw new Error("SAP 连接列表包含无效连接 ID。");
    }
    request.connectionIds = connectionIds;
  }
  if (candidate.queryContext !== undefined) {
    const queryContext = text(candidate.queryContext);
    if (queryContext.length > 6000 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(queryContext)) {
      throw new Error("SAP 连接路由上下文格式无效或内容过长。");
    }
    request.queryContext = queryContext;
  }
  if (request.connectionMode === "manual" && (request.connectionIds?.length ?? 0) === 0) {
    throw new Error("手动选择 SAP 连接时，至少需要选择一个已验证连接。");
  }

  if (request.objectType === "function" && text(candidate.functionGroup)) {
    request.functionGroup = normalizeObjectName(candidate.functionGroup, "Function group 名称");
  }

  if (request.objectType !== "function" && text(candidate.functionGroup)) {
    throw new Error("Function group 只允许用于 Function 证据。");
  }

  return request;
}

function hasTableLikeRows(value: string): boolean {
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const structuredRows = lines.filter((line) => line.split(/\t|,|\|/).filter((cell) => cell.trim().length > 0).length >= 5);
  return structuredRows.length >= 6;
}

export function assertSafeSapObjectEvidenceText(value: string, options: { allowReadOnlySourceText?: boolean } = {}): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error("SAP 证据连接器没有返回内容。");
  }
  if (normalized.length > MAX_EVIDENCE_TEXT_CHARS) {
    throw new Error("SAP 证据内容超过当前单对象大小限制。");
  }
  if (hardUnsafeEvidenceTextPatterns.some((pattern) => pattern.test(normalized)) || hasTableLikeRows(normalized)) {
    throw new Error("SAP 证据内容未通过安全检查，已停止处理。");
  }
  if (options.allowReadOnlySourceText !== true && commandLikeEvidenceTextPatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error("SAP 证据内容未通过安全检查，已停止处理。");
  }
  return normalized;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "object";
}

function timestampSlug(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").slice(0, 15) || "time";
}

function csvCell(value: string | number): string {
  const safe = String(value).replaceAll("\"", "\"\"");
  return `"${safe}"`;
}

function metadataLines(summary: SapObjectEvidenceSummary): string[] {
  return [
    `Object type: ${summary.objectType}`,
    `Object name: ${summary.objectName}`,
    `Function group: ${summary.functionGroup ?? "not applicable"}`,
    `System alias: ${summary.systemAlias}`,
    `System ID: ${summary.systemId}`,
    `Instance number: ${summary.instanceNumber}`,
    `Environment: ${summary.environment}`,
    `Endpoint: ${summary.endpointHost}`,
    `Client: ${summary.client}`,
    `User: ${summary.usernameMasked}`,
    `Source mode: ${summary.sourceMode}`,
    `Read at: ${summary.readAt}`,
    `Content length: ${summary.contentLength}`,
    `Digest: ${summary.digest}`
  ];
}

export function normalizeSapObjectEvidenceResult(result: SapObjectEvidenceConnectorResult): SapObjectEvidenceRecord {
  const content = assertSafeSapObjectEvidenceText(result.content, {
    allowReadOnlySourceText: result.evidenceKind === "fixed-adt-readonly-source" && result.sourceMode === "adt"
  });
  const summary: SapObjectEvidenceSummary = {
    objectType: result.objectType,
    objectName: normalizeObjectName(result.objectName, "SAP 对象名"),
    functionGroup: result.functionGroup ? normalizeObjectName(result.functionGroup, "Function group 名称") : null,
    systemAlias: result.system.alias,
    systemId: result.system.systemId,
    instanceNumber: result.system.instanceNumber,
    environment: result.system.environment,
    endpointHost: result.system.endpointHost,
    client: result.system.client,
    usernameMasked: result.system.usernameMasked,
    sourceMode: result.sourceMode,
    readAt: result.readAt,
    contentLength: content.length,
    digest: digest(content)
  };

  return { summary, content };
}

export function renderSapObjectEvidenceFiles(record: SapObjectEvidenceRecord): CaseGeneratedFile[] {
  const systemSlug = safeSlug(`${record.summary.systemAlias}-${record.summary.client}`);
  const slug = `${record.summary.objectType}-${safeSlug(record.summary.objectName)}-${systemSlug}-${timestampSlug(record.summary.readAt)}-${record.summary.digest.slice(0, 12)}`;
  const evidencePath = `evidence/sap-object-evidence-${slug}.md`;
  const snapshotPath = `snapshots/sap-object-snapshot-${slug}.txt`;
  const summaryPath = `outputs/sap-object-evidence-summary-${slug}.md`;

  return [
    {
      relativePath: evidencePath,
      purpose: "evidence",
      content: [
        "# SAP 只读对象证据",
        "",
        ...metadataLines(record.summary).map((line) => `- ${line}`),
        "",
        "## 安全边界",
        "",
        sapObjectEvidenceBoundary,
        "",
        "## 快照",
        "",
        `完整脱敏对象证据保存在 ${snapshotPath}。`
      ].join("\n")
    },
    {
      relativePath: snapshotPath,
      purpose: "snapshot",
      content: [
        "# SAP 只读对象快照",
        "",
        ...metadataLines(record.summary),
        "",
        "-----BEGIN SAP READ-ONLY EVIDENCE-----",
        record.content,
        "-----END SAP READ-ONLY EVIDENCE-----",
        ""
      ].join("\n")
    },
    {
      relativePath: summaryPath,
      purpose: "output",
      content: [
        "# SAP 证据摘要",
        "",
        `已将 ${record.summary.objectType} ${record.summary.objectName} 的 SAP 只读证据加入当前工作文件夹。`,
        "",
        "| 字段 | 值 |",
        "|---|---|",
        `| 对象 | ${record.summary.objectType} ${record.summary.objectName} |`,
        `| 系统 | ${record.summary.systemId || record.summary.systemAlias} / Client ${record.summary.client} |`,
        `| 实例 | ${record.summary.instanceNumber || "未记录"} |`,
        `| 环境 | ${record.summary.environment} |`,
        `| 来源模式 | ${record.summary.sourceMode} |`,
        `| 读取时间 | ${record.summary.readAt} |`,
        `| 摘要指纹 | ${record.summary.digest.slice(0, 16)} |`,
        "",
        "该摘要可用于搜索和工作文件夹上下文；详细证据保留在受限证据文件中，默认不发送给模型。"
      ].join("\n")
    },
    {
      relativePath: `technical/sap-object-evidence-metadata-${slug}.csv`,
      purpose: "technical",
      content: [
        ["field", "value"].map(csvCell).join(","),
        ["objectType", record.summary.objectType].map(csvCell).join(","),
        ["objectName", record.summary.objectName].map(csvCell).join(","),
        ["functionGroup", record.summary.functionGroup ?? ""].map(csvCell).join(","),
        ["systemAlias", record.summary.systemAlias].map(csvCell).join(","),
        ["systemId", record.summary.systemId].map(csvCell).join(","),
        ["instanceNumber", record.summary.instanceNumber].map(csvCell).join(","),
        ["environment", record.summary.environment].map(csvCell).join(","),
        ["endpointHost", record.summary.endpointHost].map(csvCell).join(","),
        ["client", record.summary.client].map(csvCell).join(","),
        ["usernameMasked", record.summary.usernameMasked].map(csvCell).join(","),
        ["sourceMode", record.summary.sourceMode].map(csvCell).join(","),
        ["readAt", record.summary.readAt].map(csvCell).join(","),
        ["contentLength", record.summary.contentLength].map(csvCell).join(","),
        ["digest", record.summary.digest].map(csvCell).join(",")
      ].join("\n") + "\n"
    }
  ];
}
