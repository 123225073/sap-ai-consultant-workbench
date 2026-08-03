import http from "node:http";
import https from "node:https";
import type { AdtRedactedSystemInfo, SapDataPreviewFilter, SapDataPreviewRequest } from "../shared/workbenchTypes";
import type { AdtConnectorInput } from "./adtReadonlyConnector";
import {
  SAP_DATA_PREVIEW_PROFILE,
  parseSapDataPreviewRequest,
  type SapDataPreviewConnectorResult
} from "./sapDataPreviewService";

export const ADT_DATA_PREVIEW_FIXED_READ_ENDPOINT = "/sap/bc/adt/datapreview/freestyle";
export const ADT_DATA_PREVIEW_SEMANTIC_READ_POST = "adt-data-preview-semantic-read-post";

const TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PARSED_COLUMNS = 100;

class DataPreviewFailure extends Error {
  constructor(message: string, readonly statusCode: number | null = null) {
    super(message);
    this.name = "DataPreviewFailure";
  }
}

function maskUsername(username: string): string {
  const value = username.trim();
  if (value.length <= 2) return value ? `${value[0]}*` : "";
  if (value.length <= 5) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function redactedSystem(input: AdtConnectorInput): AdtRedactedSystemInfo {
  const parsed = new URL(input.url);
  return {
    alias: input.alias,
    systemId: input.systemId,
    instanceNumber: input.instanceNumber,
    environment: input.environment,
    endpointHost: `${parsed.protocol}//${parsed.host}`,
    client: input.client,
    usernameMasked: maskUsername(input.username),
    language: input.language,
    sslMode: input.sslMode,
    readOnly: true,
    transportWriteMode: "disabled"
  };
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function renderFilter(filter: SapDataPreviewFilter): string {
  const operators = { eq: "=", ne: "<>", gt: ">", ge: ">=", lt: "<", le: "<=", like: "LIKE" } as const;
  return `${filter.field} ${operators[filter.operator]} ${sqlLiteral(filter.value)}`;
}

export function buildApprovedDataPreviewSql(requestValue: SapDataPreviewRequest): string {
  const request = parseSapDataPreviewRequest(requestValue);
  const select = request.operation === "discover" ? "*" : request.columns.join(", ");
  const where = request.filters.length > 0 ? ` WHERE ${request.filters.map(renderFilter).join(" AND ")}` : "";
  return `SELECT ${select} FROM ${request.objectName}${where}`;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function attributeValue(source: string, name: string): string {
  const match = source.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*[\"']([^\"']*)[\"']`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function safeResponseField(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z_][A-Z0-9_/$-]{0,79}$/.test(normalized) ? normalized : "";
}

export function parseAdtDataPreviewXml(xml: string, maxRows: number): { columns: string[]; rows: Array<Record<string, string>> } {
  const source = xml.trim();
  if (!source || /<(?:html|form|input|script)\b/i.test(source.slice(0, 12000))) throw new Error("SAP Data Preview 没有返回可解析的 ADT XML。");
  const ordered: Array<{ name: string; values: string[] }> = [];
  const columnPattern = /<(?:[\w.-]+:)?columns\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?columns>/gi;
  for (const columnMatch of source.matchAll(columnPattern)) {
    if (ordered.length >= MAX_PARSED_COLUMNS) break;
    const block = columnMatch[2];
    const metadata = block.match(/<(?:[\w.-]+:)?metadata\b([^>]*)\/?>(?:[\s\S]*?<\/(?:[\w.-]+:)?metadata>)?/i);
    const name = safeResponseField(metadata ? attributeValue(metadata[1], "name") : attributeValue(columnMatch[1], "name"));
    if (!name || ordered.some((item) => item.name === name)) continue;
    const dataset = block.match(/<(?:[\w.-]+:)?dataSet\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?dataSet>/i)?.[1] ?? "";
    const values = [...dataset.matchAll(/<(?:[\w.-]+:)?data\b[^>]*?(?:\/\s*>|>([\s\S]*?)<\/(?:[\w.-]+:)?data>)/gi)]
      .slice(0, maxRows)
      .map((match) => decodeXml((match[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim());
    ordered.push({ name, values });
  }
  if (ordered.length === 0) {
    const fallbackPattern = /<(?:[\w.-]+:)?column\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?column>/gi;
    for (const columnMatch of source.matchAll(fallbackPattern)) {
      if (ordered.length >= MAX_PARSED_COLUMNS) break;
      const name = safeResponseField(attributeValue(columnMatch[1], "name"));
      if (!name || ordered.some((item) => item.name === name)) continue;
      const values = [...columnMatch[2].matchAll(/<(?:[\w.-]+:)?(?:row|cell|value)\b[^>]*?(?:\/\s*>|>([\s\S]*?)<\/(?:[\w.-]+:)?(?:row|cell|value)>)/gi)]
        .slice(0, maxRows)
        .map((match) => decodeXml((match[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim());
      ordered.push({ name, values });
    }
  }
  if (ordered.length === 0) throw new Error("SAP Data Preview XML 中没有找到可识别字段。");
  const columns = ordered.map((item) => item.name);
  const rowCount = Math.min(maxRows, Math.max(...ordered.map((column) => column.values.length)));
  const rows = Array.from({ length: rowCount }, (_, index) => Object.fromEntries(columns.map((column) => [column, ordered.find((item) => item.name === column)?.values[index] ?? ""])));
  return { columns, rows };
}

function dataPreviewUrl(input: AdtConnectorInput): URL {
  const configured = new URL(input.url);
  return new URL(ADT_DATA_PREVIEW_FIXED_READ_ENDPOINT, `${configured.protocol}//${configured.host}`);
}

function requestDataPreview(input: AdtConnectorInput, request: SapDataPreviewRequest, method: "GET" | "POST", signal?: AbortSignal): Promise<string> {
  const target = dataPreviewUrl(input);
  const sql = buildApprovedDataPreviewSql(request);
  target.searchParams.set("rowNumber", String(request.maxRows));
  if (method === "GET") target.searchParams.set("sqlCommand", sql);
  const body = method === "POST" ? Buffer.from(sql, "utf8") : null;
  const isHttps = target.protocol === "https:";
  const options: http.RequestOptions | https.RequestOptions = {
    method,
    timeout: TIMEOUT_MS,
    signal,
    headers: {
      Accept: "application/vnd.sap.adt.datapreview.table.v1+xml",
      Authorization: `Basic ${Buffer.from(`${input.username}:${input.password}`, "utf8").toString("base64")}`,
      "X-SAP-Client": input.client,
      "Accept-Language": input.language,
      ...(body ? { "Content-Type": "text/plain", "Content-Length": String(body.length) } : {})
    }
  };
  if (isHttps && input.sslMode === "skip-certificate") options.agent = new https.Agent({ rejectUnauthorized: false });
  return new Promise((resolve, reject) => {
    const outgoing = (isHttps ? https : http).request(target, options, (incoming) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      incoming.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) outgoing.destroy(new DataPreviewFailure("SAP Data Preview 响应超过 8 MB 本地限制。"));
        else chunks.push(chunk);
      });
      incoming.on("end", () => {
        const statusCode = incoming.statusCode ?? 0;
        const response = Buffer.concat(chunks).toString("utf8");
        if (statusCode < 200 || statusCode >= 300) {
          reject(new DataPreviewFailure(`SAP Data Preview 返回 HTTP ${statusCode}。`, statusCode));
          return;
        }
        const contentType = String(incoming.headers["content-type"] ?? "").toLowerCase();
        if (!contentType.includes("xml") && !contentType.includes("vnd.sap.adt.datapreview")) {
          reject(new DataPreviewFailure("SAP Data Preview 返回的内容类型不是 ADT XML。"));
          return;
        }
        resolve(response);
      });
    });
    outgoing.on("timeout", () => outgoing.destroy(new DataPreviewFailure("SAP Data Preview 在 60 秒内没有完成。")));
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

export interface AdtDataPreviewConnector {
  readDataPreview(input: AdtConnectorInput, request: SapDataPreviewRequest, signal?: AbortSignal): Promise<SapDataPreviewConnectorResult>;
}

class RealAdtDataPreviewConnector implements AdtDataPreviewConnector {
  async readDataPreview(input: AdtConnectorInput, requestValue: SapDataPreviewRequest, signal?: AbortSignal): Promise<SapDataPreviewConnectorResult> {
    if (input.readOnly !== true) throw new Error("ADT 只读模式未锁定，已阻止数据预览。");
    const request = parseSapDataPreviewRequest(requestValue);
    let xml: string;
    try {
      xml = await requestDataPreview(input, request, "GET", signal);
    } catch (error) {
      if (!(error instanceof DataPreviewFailure) || error.statusCode !== 405) throw error;
      xml = await requestDataPreview(input, request, "POST", signal);
    }
    const parsed = parseAdtDataPreviewXml(xml, request.maxRows);
    const selectedColumns = request.operation === "discover" ? parsed.columns : request.columns;
    if (request.operation === "read" && selectedColumns.some((column) => !parsed.columns.includes(column))) {
      throw new Error("SAP Data Preview 响应缺少请求字段，已阻止生成不完整结果。");
    }
    return {
      intent: "sap-readonly-data",
      operation: request.operation,
      profile: SAP_DATA_PREVIEW_PROFILE,
      system: redactedSystem(input),
      sourceMode: "adt",
      request,
      columns: selectedColumns,
      rows: request.operation === "discover" ? [] : parsed.rows.map((row) => Object.fromEntries(selectedColumns.map((column) => [column, row[column] ?? ""]))),
      readAt: new Date().toISOString(),
      truncated: request.operation === "read" && parsed.rows.length >= request.maxRows
    };
  }
}

export function createAdtDataPreviewConnector(): AdtDataPreviewConnector {
  return new RealAdtDataPreviewConnector();
}
