import http from "node:http";
import https from "node:https";
import { externalConnectorThrownError, externalConnectorUserError } from "./externalConnectorUserError";
import type { AdtConfig, AdtRedactedSystemInfo, AdtT000ProbeResult, AdtVerificationError, AdtVerificationErrorCode, AdtVerificationReport, AdtVerificationStep } from "../shared/workbenchTypes";
import type { SapObjectEvidenceConnectorResult } from "./sapObjectEvidenceService";
import type { SapObjectEvidenceRequest } from "../shared/workbenchTypes";

export const ADT_READONLY_FIXED_GET_ENDPOINTS = "adt-readonly-fixed-get-endpoints";

const ADT_GET_TIMEOUT_MS = 30000;
const MAX_ADT_RESPONSE_CHARS = 120000;

export interface AdtConnectorInput {
  alias: string;
  url: string;
  client: string;
  username: string;
  password: string;
  language: string;
  sslMode: AdtConfig["sslMode"];
  readOnly: true;
}

interface AdtStatusResult {
  ok: boolean;
  detail: string;
}

export interface AdtReadonlyConnector {
  verify(input: AdtConnectorInput): Promise<AdtVerificationReport>;
  readObjectEvidence(input: AdtConnectorInput, request: SapObjectEvidenceRequest, options?: { allowFakeEvidence?: boolean }): Promise<SapObjectEvidenceConnectorResult>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function maskUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length <= 2) return trimmed ? `${trimmed[0]}*` : "";
  if (trimmed.length <= 5) return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

function endpointHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "SAP 地址格式不可读取";
  }
}

function redactedSystem(input: Omit<AdtConnectorInput, "password">): AdtRedactedSystemInfo {
  return {
    alias: input.alias,
    endpointHost: endpointHost(input.url),
    client: input.client,
    usernameMasked: maskUsername(input.username),
    language: input.language,
    sslMode: input.sslMode,
    readOnly: true,
    transportWriteMode: "disabled"
  };
}

function step(id: AdtVerificationStep["id"], title: string, status: AdtVerificationStep["status"], detail: string, checkedAt: string): AdtVerificationStep {
  return { id, title, status, detail, checkedAt };
}

function error(code: AdtVerificationError["code"], message: string, suggestion: string): AdtVerificationError {
  return { code, message, suggestion };
}

type AdtRequestFailureKind = "http" | "content" | "timeout" | "response-too-large";

class AdtRequestFailure extends Error {
  constructor(
    readonly kind: AdtRequestFailureKind,
    message: string,
    readonly statusCode: number | null = null
  ) {
    super(message);
    this.name = "AdtRequestFailure";
  }
}

interface AdtFailureDescription {
  detail: string;
  message: string;
  suggestion: string;
}

function nodeErrorCode(errorValue: unknown): string {
  if (!errorValue || typeof errorValue !== "object" || !("code" in errorValue)) return "";
  const code = (errorValue as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code).toUpperCase() : "";
}

function describeAdtFailure(errorValue: unknown): AdtFailureDescription {
  if (errorValue instanceof AdtRequestFailure && errorValue.kind === "http") {
    const statusCode = errorValue.statusCode ?? 0;
    if (statusCode === 401) {
      const copy = externalConnectorUserError("ADT Service", "authentication");
      return {
        detail: "HTTP 401：SAP 未接受当前账号或密码。",
        message: copy.reason,
        suggestion: `HTTP 401：${copy.suggestion}`
      };
    }
    if (statusCode === 403) {
      const copy = externalConnectorUserError("ADT Service", "permission");
      return {
        detail: "HTTP 403：当前账号无权读取该 ADT 路径。",
        message: copy.reason,
        suggestion: `HTTP 403：${copy.suggestion}`
      };
    }
    if (statusCode === 404) {
      return {
        detail: "HTTP 404：固定 ADT 路径不存在。",
        message: "SAP ADT 服务路径不可用。",
        suggestion: "HTTP 404：请确认地址指向正确 SAP 系统，并让 Basis 检查 /sap/bc/adt 及 DDIC ADT 服务。"
      };
    }
    if (statusCode >= 500 && statusCode <= 599) {
      return {
        detail: `HTTP ${statusCode}：SAP ADT 服务端返回异常。`,
        message: "SAP ADT 服务暂时不可用。",
        suggestion: `HTTP ${statusCode}：请稍后重试；若持续出现，请让 Basis 检查 SAP ADT/SICF 服务和系统日志。`
      };
    }
    if (statusCode >= 300 && statusCode <= 399) {
      return {
        detail: `HTTP ${statusCode}：请求被重定向，可能指向登录页或代理页。`,
        message: "SAP ADT 请求被重定向。",
        suggestion: `HTTP ${statusCode}：请检查 SAP 地址、反向代理和登录方式；工作台不会跟随到网页登录页。`
      };
    }
    return {
      detail: `HTTP ${statusCode || "未知"}：SAP 未返回成功响应。`,
      message: "SAP ADT 请求未成功。",
      suggestion: "请检查 SAP 地址、Client、账号、网络和 ADT 服务状态后重试。"
    };
  }

  if (errorValue instanceof AdtRequestFailure && errorValue.kind === "content") {
    const copy = externalConnectorUserError("ADT Service", "invalid-response");
    return {
      detail: errorValue.message,
      message: copy.reason,
      suggestion: copy.suggestion
    };
  }

  if (errorValue instanceof AdtRequestFailure && errorValue.kind === "response-too-large") {
    return {
      detail: "ADT 响应超过本地只读大小限制。",
      message: "SAP ADT 响应过大，已停止读取。",
      suggestion: "请让 Basis 检查该固定 ADT 路径是否返回了异常页面或过大的代理响应。"
    };
  }

  if (errorValue instanceof AdtRequestFailure && errorValue.kind === "timeout") {
    const copy = externalConnectorUserError("ADT Service", "timeout");
    return {
      detail: "ADT 请求在 30 秒内没有完成。",
      message: copy.reason,
      suggestion: copy.suggestion
    };
  }

  const code = nodeErrorCode(errorValue);
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
    return {
      detail: `TLS/证书检查失败${code ? `（${code}）` : ""}。`,
      message: "SAP HTTPS 证书校验失败。",
      suggestion: "请优先让管理员修复证书链；仅在确认是可信内网自签证书时，才使用项目级“跳过证书校验”。"
    };
  }
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"].includes(code)) {
    const copy = externalConnectorUserError("ADT Service", "network");
    return {
      detail: `网络连接失败${code ? `（${code}）` : ""}。`,
      message: copy.reason,
      suggestion: `${copy.suggestion} 工作台没有发送任何写入请求。`
    };
  }
  return {
    detail: `ADT 请求未完成${code ? `（${code}）` : ""}。`,
    message: "SAP ADT 检查发生未预期错误。",
    suggestion: "请确认 SAP 地址和网络后重试；若持续失败，请让管理员检查 ADT 服务。"
  };
}

function triggerText(input: AdtConnectorInput): string {
  return `${input.alias} ${input.url} ${input.username}`.toLowerCase();
}

function baseT000(attempted: boolean, ok: boolean, client: string | null): AdtT000ProbeResult {
  return {
    objectName: "T000",
    attempted,
    ok,
    rowCount: ok ? 1 : null,
    sampleClient: ok ? client : null,
    source: "fake"
  };
}

function realT000(attempted: boolean, ok: boolean, client: string | null): AdtT000ProbeResult {
  return {
    objectName: "T000",
    attempted,
    ok,
    rowCount: null,
    sampleClient: ok ? client : null,
    source: "adt"
  };
}

function encodeSapName(value: string): string {
  return encodeURIComponent(value);
}

export function adtReadonlyObjectEvidencePath(request: SapObjectEvidenceRequest): string {
  switch (request.objectType) {
    case "program":
      return `/sap/bc/adt/programs/programs/${encodeSapName(request.objectName)}/source/main`;
    case "class":
      return `/sap/bc/adt/oo/classes/${encodeSapName(request.objectName)}/source/main`;
    case "include":
      return `/sap/bc/adt/programs/includes/${encodeSapName(request.objectName)}/source/main`;
    case "function":
      if (!request.functionGroup) {
        throw new Error("读取 Function module 证据前，请先填写 Function group。");
      }
      return `/sap/bc/adt/functions/groups/${encodeSapName(request.functionGroup)}/fmodules/${encodeSapName(request.objectName)}/source/main`;
    case "table":
      return `/sap/bc/adt/ddic/tables/${encodeSapName(request.objectName)}/source/main`;
    case "structure":
      return `/sap/bc/adt/ddic/structures/${encodeSapName(request.objectName)}/source/main`;
    default: {
      const neverType: never = request.objectType;
      throw new Error(`不支持的 SAP 对象证据类型：${neverType}`);
    }
  }
}

function adtStatusPath(): string {
  return "/sap/bc/adt/";
}

function adtT000MinimalPath(): string {
  return "/sap/bc/adt/ddic/tables/T000/source/main";
}

function normalizedContentType(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value ?? "";
  return raw.split(";", 1)[0].trim().toLowerCase();
}

function safeContentTypeLabel(contentType: string): string {
  const safe = contentType.replace(/[^a-z0-9.+\-/]/gi, "").slice(0, 80);
  return safe || "缺失";
}

function isAdtXmlContentType(contentType: string): boolean {
  return contentType === "application/xml"
    || contentType === "text/xml"
    || contentType === "application/atom+xml"
    || contentType === "application/atomsvc+xml"
    || (contentType.startsWith("application/") && contentType.endsWith("+xml"))
    || contentType.startsWith("application/vnd.sap.adt");
}

function isAdtSourceContentType(contentType: string): boolean {
  return contentType === "text/plain" || isAdtXmlContentType(contentType);
}

function looksLikeXml(text: string): boolean {
  return /^\s*(?:<\?xml\s[^>]*>\s*)?<[a-z_][\w:.-]*(?:\s|>|\/)/i.test(text);
}

function looksLikeHtmlOrLoginPage(text: string): boolean {
  const prefix = text.trimStart().slice(0, 12000).toLowerCase();
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(prefix)) return true;
  if (!prefix.startsWith("<")) return false;
  const hasPageMarkup = /<(?:form|input|script|meta)\b/i.test(prefix);
  const hasLoginMarker = /(?:sap-system-login|sap-user|sap-password|j_security_check|\blogon\b|\blogin\b|single sign-on|sso)/i.test(prefix);
  return hasPageMarkup && hasLoginMarker;
}

function validateAdtResponse(fixedPath: string, contentType: string, text: string): void {
  const trimmed = text.trim();
  const contentTypeLabel = safeContentTypeLabel(contentType);
  if (!trimmed) {
    throw new AdtRequestFailure("content", "SAP 返回空响应，未取得 ADT 内容。");
  }
  if (contentType === "text/html" || contentType === "application/xhtml+xml" || looksLikeHtmlOrLoginPage(trimmed)) {
    throw new AdtRequestFailure("content", "SAP 返回 HTML 或登录页面，不是 ADT 数据。");
  }

  if (fixedPath === adtStatusPath()) {
    if (!isAdtXmlContentType(contentType) || !looksLikeXml(trimmed)) {
      throw new AdtRequestFailure("content", `ADT 服务入口返回了不符合预期的内容类型或正文（Content-Type: ${contentTypeLabel}）。`);
    }
    return;
  }

  if (!isAdtSourceContentType(contentType)) {
    throw new AdtRequestFailure("content", `固定 ADT 读取返回了不支持的内容类型（Content-Type: ${contentTypeLabel}）。`);
  }

  if (fixedPath === adtT000MinimalPath()) {
    const hasT000Marker = /\bT000\b/i.test(trimmed);
    const hasDdIcShape = looksLikeXml(trimmed)
      ? /<(?:[\w.-]+:)?(?:ddic|table|entry|object|source)\b/i.test(trimmed)
      : /(?:\bdefine\s+table\s+t000\b|\btable\s+t000\b|@abapcatalog\b)/i.test(trimmed);
    if (!hasT000Marker || !hasDdIcShape) {
      throw new AdtRequestFailure("content", `T000 路径没有返回可识别的 T000 ADT/DDIC 内容（Content-Type: ${contentTypeLabel}）。`);
    }
  }
}

function buildAdtUrl(input: AdtConnectorInput, fixedPath: string): URL {
  const parsed = new URL(input.url);
  return new URL(fixedPath, `${parsed.protocol}//${parsed.host}`);
}

interface AdtGetResult {
  fixedPath: string;
  text: string;
  statusCode: number;
  contentType: string;
}

function adtGet(input: AdtConnectorInput, fixedPath: string): Promise<AdtGetResult> {
  const target = buildAdtUrl(input, fixedPath);
  const isHttps = target.protocol === "https:";
  const headers = {
    Accept: "text/plain, application/xml, text/xml, application/atom+xml, application/atomsvc+xml, application/vnd.sap.adt.ddic.table.v2+xml",
    Authorization: `Basic ${Buffer.from(`${input.username}:${input.password}`, "utf8").toString("base64")}`,
    "X-SAP-Client": input.client,
    "Accept-Language": input.language
  };
  const options: http.RequestOptions | https.RequestOptions = {
    method: "GET",
    headers,
    timeout: ADT_GET_TIMEOUT_MS
  };
  if (isHttps && input.sslMode === "skip-certificate") {
    options.agent = new https.Agent({ rejectUnauthorized: false });
  }

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(target, options, (incoming) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      incoming.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_ADT_RESPONSE_CHARS * 4) {
          request.destroy(new AdtRequestFailure("response-too-large", "ADT 响应超过本地只读大小限制。"));
          return;
        }
        chunks.push(chunk);
      });

      incoming.on("end", () => {
        const statusCode = incoming.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new AdtRequestFailure("http", `ADT GET 返回 HTTP ${statusCode}。`, statusCode));
          return;
        }
        const contentType = normalizedContentType(incoming.headers["content-type"]);
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          validateAdtResponse(fixedPath, contentType, text);
        } catch (validationError) {
          reject(validationError);
          return;
        }
        resolve({
          fixedPath,
          statusCode,
          contentType,
          text
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new AdtRequestFailure("timeout", "ADT 请求在 30 秒内没有完成。"));
    });
    request.on("error", (requestError) => {
      reject(requestError);
    });
    request.end();
  });
}

export class RealAdtReadonlyConnector implements AdtReadonlyConnector {
  async verify(input: AdtConnectorInput): Promise<AdtVerificationReport> {
    const checkedAt = nowIso();
    const system = redactedSystem(input);
    const steps: AdtVerificationStep[] = [
      step("config", "配置检查", "passed", "ADT 配置完整，且只读模式已锁定。", checkedAt)
    ];
    const errors: AdtVerificationError[] = [];

    if (input.readOnly !== true) {
      errors.push(error("readonly-disabled", "ADT Service 只读模式未锁定。", "请保持当前项目 ADT 模式为只读，再重新验证。"));
      steps.push(step("status", "ADT Service", "skipped", "只读模式未锁定，未检查 ADT Service。", checkedAt));
      steps.push(step("t000", "T000 元数据读取", "skipped", "只读模式未锁定，未读取 T000 元数据。", checkedAt));
      return this.report(false, checkedAt, system, steps, realT000(false, false, null), errors);
    }

    let statusOk = false;
    let statusFailure: AdtFailureDescription | null = null;
    try {
      await adtGet(input, adtStatusPath());
      statusOk = true;
    } catch (statusError) {
      statusFailure = describeAdtFailure(statusError);
    }

    try {
      await adtGet(input, adtT000MinimalPath());
      const t000 = realT000(true, true, input.client);
      steps.push(step(
        "status",
        "ADT service",
        "passed",
        statusOk
          ? "固定 GET /sap/bc/adt/ 返回了符合预期的 ADT/XML 服务内容。"
          : `ADT Service 入口检查未通过（${statusFailure?.detail ?? "原因未分类"}），但关键的 T000 元数据读取已通过。`,
        checkedAt
      ));
      steps.push(step("t000", "T000 元数据读取", "passed", "固定 T000 DDIC 元数据 GET 返回了合理内容；未读取任何业务表行。", checkedAt));
      return this.report(true, checkedAt, system, steps, t000, errors);
    } catch (t000Error) {
      const t000 = realT000(true, false, null);
      const t000Failure = describeAdtFailure(t000Error);
      errors.push(error("minimal-read-failed", `T000 元数据读取失败：${t000Failure.message}`, t000Failure.suggestion));
      if (!statusOk) {
        const failure = statusFailure ?? describeAdtFailure(t000Error);
        errors.push(error(
          "status-failed",
          failure.message,
          failure.suggestion
        ));
      }
      steps.push(step(
        "status",
        "ADT service",
        statusOk ? "passed" : "failed",
        statusOk ? "固定 GET /sap/bc/adt/ 返回了符合预期的 ADT/XML 服务内容。" : statusFailure?.detail ?? "ADT 服务入口检查失败。",
        checkedAt
      ));
      steps.push(step("t000", "T000 元数据读取", "failed", t000Failure.detail, checkedAt));
      return this.report(false, checkedAt, system, steps, t000, errors);
    }
  }

  async readObjectEvidence(input: AdtConnectorInput, request: SapObjectEvidenceRequest): Promise<SapObjectEvidenceConnectorResult> {
    if (input.readOnly !== true) {
      const copy = externalConnectorUserError("ADT Service", "configuration");
      throw externalConnectorThrownError({
        reason: "ADT Service 只读模式未锁定，已阻止读取 SAP object evidence。",
        suggestion: copy.suggestion
      });
    }
    const fixedPath = adtReadonlyObjectEvidencePath(request);
    const readAt = nowIso();
    let result: AdtGetResult;
    try {
      result = await adtGet(input, fixedPath);
    } catch (readError) {
      const failure = describeAdtFailure(readError);
      throw externalConnectorThrownError({ reason: failure.message, suggestion: failure.suggestion });
    }
    if (!result.text.trim()) {
      throw externalConnectorThrownError(externalConnectorUserError("ADT Service", "invalid-response"));
    }
    return {
      objectType: request.objectType,
      objectName: request.objectName,
      functionGroup: request.functionGroup ?? null,
      system: redactedSystem(input),
      sourceMode: "adt",
      evidenceKind: "fixed-adt-readonly-source",
      readAt,
      content: result.text
    };
  }

  private report(ok: boolean, checkedAt: string, system: AdtRedactedSystemInfo, steps: AdtVerificationStep[], t000: AdtT000ProbeResult, errors: AdtVerificationError[]): AdtVerificationReport {
    return {
      ok,
      checkedAt,
      mode: "adt",
      system,
      steps,
      connectionStatus: t000.ok || steps.some((item) => item.id === "status" && item.status === "passed") ? "verified" : "failed",
      minimalReadStatus: t000.ok ? "verified" : t000.attempted ? "failed" : "pending-verification",
      t000,
      errors
    };
  }
}

export class FakeAdtReadonlyConnector implements AdtReadonlyConnector {
  async verify(input: AdtConnectorInput): Promise<AdtVerificationReport> {
    const checkedAt = nowIso();
    const system = redactedSystem(input);
    const steps: AdtVerificationStep[] = [
      step("config", "配置检查", "passed", "URL、Client、用户、语言、SSL 和安全密钥引用已满足只读验证要求。", checkedAt)
    ];
    const errors: AdtVerificationError[] = [];

    if (input.readOnly !== true) {
      errors.push(error("readonly-disabled", "写入模式没有锁定为只读。", "请保持当前项目 ADT 写入模式为只读锁定。"));
      steps.push(step("status", "ADT status", "skipped", "写入模式不安全，未继续执行 status 检查。", checkedAt));
      steps.push(step("t000", "T000 最小读取", "skipped", "写入模式不安全，未执行 T000 最小读取。", checkedAt));
      return this.report(false, checkedAt, system, steps, baseT000(false, false, null), errors);
    }

    const status = await this.status(input);
    steps.push(step("status", "ADT status", status.ok ? "passed" : "failed", status.detail, checkedAt));
    if (!status.ok) {
      errors.push(error("status-failed", "ADT status 检查未通过。", "请检查 SAP 地址、VPN、代理、Client、账号和 ADT 服务是否可访问。"));
      steps.push(step("t000", "T000 最小读取", "skipped", "status 未通过，未继续读取 T000。", checkedAt));
      return this.report(false, checkedAt, system, steps, baseT000(false, false, null), errors);
    }

    const t000 = await this.readT000Minimal(input);
    steps.push(step("t000", "T000 最小读取", t000.ok ? "passed" : "failed", t000.ok ? "已完成固定 T000 最小读取，证明只读读取链路可用。" : "T000 最小读取失败，不能标记为只读验证通过。", checkedAt));
    if (!t000.ok) {
      errors.push(error("minimal-read-failed", "T000 最小读取未通过。", "这可能是 ADT Data Preview 或表读取服务不可用，不应误判为连接已验证。"));
    }

    return this.report(t000.ok, checkedAt, system, steps, t000, errors);
  }

  private async status(input: AdtConnectorInput): Promise<AdtStatusResult> {
    if (triggerText(input).includes("fail-status")) {
      return { ok: false, detail: "模拟 status 失败：未能取得只读连接状态。" };
    }
    return { ok: true, detail: "模拟 status 通过：目标系统、Client、用户和只读模式已确认。" };
  }

  private async readT000Minimal(input: AdtConnectorInput): Promise<AdtT000ProbeResult> {
    if (triggerText(input).includes("fail-t000")) {
      return baseT000(true, false, null);
    }
    return baseT000(true, true, input.client);
  }

  async readObjectEvidence(input: AdtConnectorInput, request: SapObjectEvidenceRequest, options: { allowFakeEvidence?: boolean } = {}): Promise<SapObjectEvidenceConnectorResult> {
    if (options.allowFakeEvidence !== true) {
      throw new Error("原因：SAP object evidence 需要真实的只读 ADT Service。建议：fake evidence 仅用于本地 probe，请先完成真实 ADT 连接验证。");
    }
    if (input.readOnly !== true) {
      throw new Error("原因：ADT Service 只读模式未锁定，已阻止读取 SAP object evidence。建议：请保持当前项目 ADT 模式为只读后重试。");
    }
    const readAt = nowIso();
    const objectLabel = `${request.objectType.toUpperCase()} ${request.objectName}`;
    return {
      objectType: request.objectType,
      objectName: request.objectName,
      functionGroup: request.functionGroup ?? null,
      system: redactedSystem(input),
      sourceMode: "fake",
      readAt,
      content: [
        `${objectLabel} 的本地模拟 SAP 只读证据`,
        `系统别名：${input.alias}`,
        `Client: ${input.client}`,
        `语言：${input.language}`,
        `读取时间：${readAt}`,
        "范围：仅单个明确指定对象",
        "模式：本地模拟只读证据",
        "不包含 SAP 写入、激活、传输、表数据行、密码、Token、Cookie 或 Session 内容。"
      ].join("\n")
    };
  }

  private report(ok: boolean, checkedAt: string, system: AdtRedactedSystemInfo, steps: AdtVerificationStep[], t000: AdtT000ProbeResult, errors: AdtVerificationError[]): AdtVerificationReport {
    return {
      ok,
      checkedAt,
      mode: "fake",
      system,
      steps,
      connectionStatus: steps.some((item) => item.id === "status" && item.status === "passed") ? "verified" : "failed",
      minimalReadStatus: t000.ok ? "verified" : t000.attempted ? "failed" : "pending-verification",
      t000,
      errors
    };
  }
}

export function createAdtReadonlyConnector(): AdtReadonlyConnector {
  return new RealAdtReadonlyConnector();
}

export function createAdtValidationFailureReport(
  input: Omit<AdtConnectorInput, "password">,
  code: AdtVerificationErrorCode,
  message: string,
  suggestion: string
): AdtVerificationReport {
  const checkedAt = nowIso();
  const steps: AdtVerificationStep[] = [
    step("config", "配置检查", "failed", message, checkedAt),
    step("status", "ADT status", "skipped", "配置检查未通过，未执行 status 检查。", checkedAt),
    step("t000", "T000 最小读取", "skipped", "配置检查未通过，未执行 T000 最小读取。", checkedAt)
  ];

  return {
    ok: false,
    checkedAt,
    mode: "fake",
    system: redactedSystem(input),
    steps,
    connectionStatus: "failed",
    minimalReadStatus: "pending-verification",
    t000: baseT000(false, false, null),
    errors: [error(code, message, suggestion)]
  };
}
