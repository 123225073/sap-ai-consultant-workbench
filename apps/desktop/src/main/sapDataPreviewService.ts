import { createHash } from "node:crypto";
import type {
  AdtRedactedSystemInfo,
  AdtVerificationMode,
  CaseGeneratedFile,
  SapDataFilterOperator,
  SapDataPreviewFilter,
  SapDataPreviewRequest,
  SapDataPreviewResult,
  SapDataSourceType
} from "../shared/workbenchTypes";

export const SAP_DATA_PREVIEW_PROFILE = "sap-readonly-data-preview-v1";
export const sapDataPreviewBoundary = "SAP 通用数据预览：只允许结构化对象名、字段、筛选和有界行数；禁止模型提交任意 SQL，禁止写入、过账、激活、传输、任意程序执行和绕过 SAP 后端授权。";

export interface SapDataPreviewConnectorResult {
  intent: "sap-readonly-data";
  operation: "discover" | "read";
  profile: typeof SAP_DATA_PREVIEW_PROFILE;
  system: AdtRedactedSystemInfo;
  sourceMode: AdtVerificationMode;
  request: SapDataPreviewRequest;
  columns: string[];
  rows: Array<Record<string, string>>;
  readAt: string;
  truncated: boolean;
}

export interface SapDataPreviewRecord {
  result: Omit<SapDataPreviewResult, "state" | "generatedFiles">;
  generatedFiles: CaseGeneratedFile[];
}

const MAX_ROWS = 2_000;
const MAX_COLUMNS = 30;
const MAX_DISCOVERED_COLUMNS = 100;
const MAX_FILTERS = 12;
const MAX_CELL_CHARS = 512;
const MODEL_ANALYSIS_ROWS = 100;
const MODEL_ANALYSIS_CHARS = 24_000;
const allowedSourceTypes = new Set<SapDataSourceType>(["table", "view", "cds"]);
const allowedOperators = new Set<SapDataFilterOperator>(["eq", "ne", "gt", "ge", "lt", "le", "like"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeObjectName(value: unknown): string {
  const normalized = text(value).normalize("NFKC").toUpperCase();
  if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f\s;'"`\\]/.test(normalized)) {
    throw new Error("SAP 数据源名称格式无效。");
  }
  const normal = /^[A-Z0-9_][A-Z0-9_/$-]{0,79}$/;
  const namespace = /^\/[A-Z0-9_]{1,30}\/[A-Z0-9_][A-Z0-9_/$-]{0,46}$/;
  if (!normal.test(normalized) && !namespace.test(normalized)) throw new Error("SAP 数据源名称不是受支持的 DDIC/CDS 标识。");
  return normalized;
}

function normalizeField(value: unknown, label = "字段"): string {
  const normalized = text(value).normalize("NFKC").toUpperCase();
  if (!/^[A-Z_][A-Z0-9_/$-]{0,79}$/.test(normalized)) throw new Error(`${label}名称格式无效。`);
  return normalized;
}

function normalizeFilter(candidate: Partial<SapDataPreviewFilter>, index: number): SapDataPreviewFilter {
  const operator = text(candidate.operator) as SapDataFilterOperator;
  if (!allowedOperators.has(operator)) throw new Error(`第 ${index + 1} 个筛选条件的操作符无效。`);
  const value = text(candidate.value).normalize("NFKC");
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`第 ${index + 1} 个筛选值格式无效。`);
  if (operator === "like" && !/^[^*?]*[%_][^*?]*$/.test(value)) {
    throw new Error("LIKE 筛选必须显式包含 % 或 _ 通配符，且不能使用 * 或 ?。");
  }
  return { field: normalizeField(candidate.field, `第 ${index + 1} 个筛选字段`), operator, value };
}

export function parseSapDataPreviewRequest(input: unknown): SapDataPreviewRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("SAP 通用数据预览请求格式无效。");
  const candidate = input as Partial<SapDataPreviewRequest>;
  const allowedKeys = new Set(["intent", "operation", "objectName", "objectType", "columns", "filters", "maxRows", "readOnly", "queryContext"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    throw new Error("SAP 数据预览请求包含不支持的字段；模型不能提交表外参数或任意 SQL。");
  }
  if (candidate.intent !== "sap-readonly-data" || candidate.readOnly !== true) {
    throw new Error("SAP 数据预览必须使用固定 sap-readonly-data 意图和只读模式。");
  }
  const operation = candidate.operation === "discover" ? "discover" : "read";
  if (candidate.operation !== undefined && candidate.operation !== "discover" && candidate.operation !== "read") {
    throw new Error("SAP 数据预览操作类型无效。");
  }
  const objectType = text(candidate.objectType) as SapDataSourceType;
  if (!allowedSourceTypes.has(objectType)) throw new Error("SAP 数据源类型只支持 table、view 或 cds。");
  if (!Array.isArray(candidate.columns) || candidate.columns.length > MAX_COLUMNS) throw new Error(`SAP 数据字段必须是数组，且不能超过 ${MAX_COLUMNS} 个。`);
  const columns = [...new Set(candidate.columns.map((column) => normalizeField(column)))];
  if (!Array.isArray(candidate.filters) || candidate.filters.length > MAX_FILTERS) throw new Error(`SAP 数据筛选必须是数组，且不能超过 ${MAX_FILTERS} 个。`);
  const filters = candidate.filters.map((filter, index) => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new Error(`第 ${index + 1} 个筛选条件格式无效。`);
    const keys = Object.keys(filter);
    if (keys.some((key) => !["field", "operator", "value"].includes(key))) throw new Error(`第 ${index + 1} 个筛选条件包含不支持的字段。`);
    return normalizeFilter(filter, index);
  });
  if (!Number.isInteger(candidate.maxRows) || (candidate.maxRows ?? 0) < 1 || (candidate.maxRows ?? 0) > MAX_ROWS) {
    throw new Error(`SAP 数据预览行数必须在 1 至 ${MAX_ROWS} 之间。`);
  }
  if (operation === "discover") {
    if (columns.length > 0 || filters.length > 0 || candidate.maxRows !== 1) throw new Error("数据源发现只允许空字段、空筛选和 maxRows=1。");
  } else {
    if (columns.length === 0) throw new Error("正式读取必须明确选择至少一个字段。");
    if (filters.length === 0) throw new Error("正式读取必须至少包含一个结构化筛选条件，禁止生产系统无条件读取。");
    const selected = new Set(columns);
    if (filters.some((filter) => !selected.has(filter.field))) throw new Error("筛选字段必须同时出现在所选字段中，确保结果口径可追溯。");
  }
  const request: SapDataPreviewRequest = {
    intent: "sap-readonly-data",
    operation,
    objectName: normalizeObjectName(candidate.objectName),
    objectType,
    columns,
    filters,
    maxRows: candidate.maxRows!,
    readOnly: true
  };
  if (candidate.queryContext !== undefined) {
    const queryContext = text(candidate.queryContext);
    if (queryContext.length > 500 || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(queryContext)) throw new Error("SAP 连接路由提示格式无效或内容过长。");
    request.queryContext = queryContext;
  }
  return request;
}

function normalizeRows(rows: Array<Record<string, string>>, columns: string[], maxRows: number): Array<Record<string, string>> {
  if (!Array.isArray(rows) || rows.length > maxRows) throw new Error("SAP 数据超过本次有界读取范围。");
  const allowed = new Set(columns);
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("SAP 数据行格式无效。");
    if (Object.keys(row).some((column) => !allowed.has(column.toUpperCase()))) throw new Error("SAP 响应包含未选择字段，已停止处理。");
    return Object.fromEntries(columns.map((column) => {
      const raw = row[column] ?? row[column.toLowerCase()] ?? "";
      return [column, String(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_CELL_CHARS)];
    }));
  });
}

function buildAnalysisRows(rows: Array<Record<string, string>>, columns: string[]): Array<Record<string, string>> {
  const analysisRows: Array<Record<string, string>> = [];
  let usedChars = 0;
  for (const row of rows.slice(0, MODEL_ANALYSIS_ROWS)) {
    const next = Object.fromEntries(columns.map((column) => [column, (row[column] ?? "").slice(0, 240)]));
    const nextChars = JSON.stringify(next).length;
    if (analysisRows.length > 0 && usedChars + nextChars > MODEL_ANALYSIS_CHARS) break;
    analysisRows.push(next);
    usedChars += nextChars;
  }
  return analysisRows;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "sap-data";
}

function timestampSlug(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").slice(0, 15) || "time";
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function csvCell(value: string): string {
  const formulaSafe = /^[=+@]/.test(value) || /^-[^0-9.]/.test(value) ? `'${value}` : value;
  return `"${formulaSafe.replaceAll("\"", "\"\"")}"`;
}

function html(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}

function filterLabel(filters: SapDataPreviewFilter[]): string {
  return filters.map((filter) => `${filter.field} ${filter.operator} [已隐藏筛选值]`).join("；") || "仅发现字段，不保留样例数据";
}

function renderHtml(title: string, columns: string[], rows: Array<Record<string, string>>, scopeNote: string): string {
  const headers = columns.map((column) => `<th>${html(column)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${html(row[column] ?? "")}</td>`).join("")}</tr>`).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:32px;color:#182230}h1{font-size:24px}.note{padding:12px 16px;background:#eef4ff;border-left:4px solid #2f6fed;color:#405269}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:20px}th,td{border:1px solid #dbe2ea;padding:8px;text-align:left;white-space:nowrap}th{background:#eef4ff;position:sticky;top:0}tbody tr:nth-child(even){background:#f8fafc}</style></head><body><h1>${html(title)}</h1><p class="note">${html(scopeNote)}</p><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

export function normalizeAndRenderSapDataPreview(connectorResult: SapDataPreviewConnectorResult): SapDataPreviewRecord {
  const request = parseSapDataPreviewRequest(connectorResult.request);
  const columns = [...new Set(connectorResult.columns.map((column) => normalizeField(column)))].slice(
    0,
    request.operation === "discover" ? MAX_DISCOVERED_COLUMNS : MAX_COLUMNS
  );
  if (columns.length === 0) throw new Error("SAP Data Preview 没有返回可识别字段。");
  const rows = request.operation === "discover" ? [] : normalizeRows(connectorResult.rows, columns, request.maxRows);
  const analysisRows = request.operation === "discover" ? [] : buildAnalysisRows(rows, columns);
  const analysisRowsTruncated = analysisRows.length < rows.length;
  const scopeNote = request.operation === "discover"
    ? "本次只发现数据源字段；样例业务数据已在 main process 丢弃，没有写入文件或发送给模型。"
    : `完整明细保存在当前工作文件夹；当前模型接收最多 ${MODEL_ANALYSIS_ROWS} 行、总计约 ${MODEL_ANALYSIS_CHARS} 字符的有界分析数据，以继续完成本轮任务。读取成功不代表已经与业务报表口径对账。`;
  const safeSummary = {
    filterCount: request.filters.length,
    selectedColumnCount: columns.length,
    dataRowsStoredLocally: request.operation === "read",
    scopeNote
  };
  const metadataSource = JSON.stringify({
    profile: SAP_DATA_PREVIEW_PROFILE,
    operation: request.operation,
    objectName: request.objectName,
    objectType: request.objectType,
    columns,
    filters: request.filters,
    maxRows: request.maxRows,
    actualRows: rows.length,
    truncated: connectorResult.truncated,
    readAt: connectorResult.readAt
  });
  const fingerprint = digest(metadataSource + (rows.length > 0 ? JSON.stringify(rows) : ""));
  const slug = `${safeSlug(`${connectorResult.system.systemId}-${connectorResult.system.client}-${request.objectName}`)}-${timestampSlug(connectorResult.readAt)}-${fingerprint.slice(0, 12)}`;
  const summaryPath = `outputs/sap-data-preview-summary-${slug}.md`;
  const metadataPath = `technical/sap-data-preview-metadata-${slug}.md`;
  const generatedFiles: CaseGeneratedFile[] = [
    {
      relativePath: summaryPath,
      purpose: "output",
      content: [
        "# SAP 通用只读数据结果",
        "",
        `- 系统：${connectorResult.system.systemId || connectorResult.system.alias} / Client ${connectorResult.system.client}`,
        `- 数据源：${request.objectType} ${request.objectName}`,
        `- 操作：${request.operation === "discover" ? "字段发现" : "有界读取"}`,
        `- 字段：${columns.join(", ")}`,
        `- 筛选：${filterLabel(request.filters)}`,
        `- 返回行数：${rows.length}${connectorResult.truncated ? `（达到上限 ${request.maxRows}，结果可能不完整）` : ""}`,
        `- 读取时间：${connectorResult.readAt}`,
        `- 证据指纹：${fingerprint}`,
        "",
        "## 范围说明",
        "",
        scopeNote
      ].join("\n")
    },
    {
      relativePath: metadataPath,
      purpose: "technical",
      content: ["# SAP Data Preview 元数据", "", metadataSource, "", sapDataPreviewBoundary].join("\n")
    }
  ];
  if (request.operation === "read") {
    const csv = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(","))].join("\n") + "\n";
    const csvPath = `evidence/sap/data-preview-${safeSlug(request.objectName)}-${slug}.csv`;
    const htmlPath = `outputs/sap-data-preview-${safeSlug(request.objectName)}-${slug}.html`;
    generatedFiles.push(
      { relativePath: csvPath, purpose: "evidence", content: csv },
      { relativePath: htmlPath, purpose: "output", content: renderHtml(`${request.objectName} SAP 只读数据`, columns, rows, scopeNote) }
    );
    generatedFiles[0].content += `\n\n- 完整明细：${csvPath}\n- 本地 HTML：${htmlPath}`;
  }
  return {
    result: {
      intent: "sap-readonly-data",
      operation: request.operation,
      source: {
        objectName: request.objectName,
        objectType: request.objectType,
        systemId: connectorResult.system.systemId,
        client: connectorResult.system.client
      },
      rowCount: rows.length,
      truncated: connectorResult.truncated,
      columns,
      analysisRows,
      analysisRowsTruncated,
      safeSummary
    },
    generatedFiles
  };
}
