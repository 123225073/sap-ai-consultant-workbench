import http from "node:http";
import https from "node:https";
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
        throw new Error("Function module evidence requires a function group.");
      }
      return `/sap/bc/adt/functions/groups/${encodeSapName(request.functionGroup)}/fmodules/${encodeSapName(request.objectName)}/source/main`;
    case "table":
      return `/sap/bc/adt/ddic/tables/${encodeSapName(request.objectName)}/source/main`;
    case "structure":
      return `/sap/bc/adt/ddic/structures/${encodeSapName(request.objectName)}/source/main`;
    default: {
      const neverType: never = request.objectType;
      throw new Error(`Unsupported SAP object evidence type: ${neverType}`);
    }
  }
}

function adtStatusPath(): string {
  return "/sap/bc/adt/";
}

function adtT000MinimalPath(): string {
  return "/sap/bc/adt/ddic/tables/T000/source/main";
}

function buildAdtUrl(input: AdtConnectorInput, fixedPath: string): URL {
  const parsed = new URL(input.url);
  return new URL(fixedPath, `${parsed.protocol}//${parsed.host}`);
}

interface AdtGetResult {
  fixedPath: string;
  text: string;
  statusCode: number;
}

function adtGet(input: AdtConnectorInput, fixedPath: string): Promise<AdtGetResult> {
  const target = buildAdtUrl(input, fixedPath);
  const isHttps = target.protocol === "https:";
  const headers = {
    Accept: "text/plain, application/xml, application/atom+xml, */*",
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
          request.destroy(new Error(`ADT GET response exceeded the read-only evidence size limit at ${fixedPath}.`));
          return;
        }
        chunks.push(chunk);
      });

      incoming.on("end", () => {
        const statusCode = incoming.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`ADT GET failed with HTTP ${statusCode} at ${fixedPath}.`));
          return;
        }
        resolve({
          fixedPath,
          statusCode,
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`ADT GET timed out at ${fixedPath}.`));
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
      step("config", "Configuration check", "passed", "ADT configuration is complete and read-only mode is locked.", checkedAt)
    ];
    const errors: AdtVerificationError[] = [];

    if (input.readOnly !== true) {
      errors.push(error("readonly-disabled", "ADT read-only mode is not locked.", "Keep the project ADT mode read-only before verification."));
      steps.push(step("status", "ADT service", "skipped", "Read-only mode is not locked.", checkedAt));
      steps.push(step("t000", "T000 metadata read", "skipped", "Read-only mode is not locked.", checkedAt));
      return this.report(false, checkedAt, system, steps, realT000(false, false, null), errors);
    }

    try {
      await adtGet(input, adtStatusPath());
      steps.push(step("status", "ADT service", "passed", "Fixed GET /sap/bc/adt/ returned successfully.", checkedAt));
    } catch {
      errors.push(error("status-failed", "ADT service check failed.", "Check SAP URL, VPN/proxy, client, account, password, certificate mode, and ADT service activation."));
      steps.push(step("status", "ADT service", "failed", "Fixed GET /sap/bc/adt/ did not return successfully.", checkedAt));
      steps.push(step("t000", "T000 metadata read", "skipped", "ADT service check failed.", checkedAt));
      return this.report(false, checkedAt, system, steps, realT000(false, false, null), errors);
    }

    try {
      await adtGet(input, adtT000MinimalPath());
      const t000 = realT000(true, true, input.client);
      steps.push(step("t000", "T000 metadata read", "passed", "Fixed GET for T000 DDIC metadata returned successfully; no table rows were read.", checkedAt));
      return this.report(true, checkedAt, system, steps, t000, errors);
    } catch {
      const t000 = realT000(true, false, null);
      errors.push(error("minimal-read-failed", "T000 metadata read failed.", "The ADT account or services can reach ADT, but the fixed DDIC metadata read did not pass."));
      steps.push(step("t000", "T000 metadata read", "failed", "Fixed GET for T000 DDIC metadata failed.", checkedAt));
      return this.report(false, checkedAt, system, steps, t000, errors);
    }
  }

  async readObjectEvidence(input: AdtConnectorInput, request: SapObjectEvidenceRequest): Promise<SapObjectEvidenceConnectorResult> {
    if (input.readOnly !== true) {
      throw new Error("SAP object evidence is blocked because ADT read-only mode is not locked.");
    }
    const fixedPath = adtReadonlyObjectEvidencePath(request);
    const readAt = nowIso();
    const result = await adtGet(input, fixedPath);
    if (!result.text.trim()) {
      throw new Error(`ADT GET returned empty object evidence at ${fixedPath}.`);
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
      connectionStatus: steps.some((item) => item.id === "status" && item.status === "passed") ? "verified" : "failed",
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
      throw new Error("SAP object evidence requires a real read-only ADT connector. Fake evidence is limited to local probes.");
    }
    if (input.readOnly !== true) {
      throw new Error("SAP object evidence is blocked because ADT read-only mode is not locked.");
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
        `Fake SAP read-only evidence for ${objectLabel}`,
        `System alias: ${input.alias}`,
        `Client: ${input.client}`,
        `Language: ${input.language}`,
        `Read at: ${readAt}`,
        "Scope: single explicit object only",
        "Mode: read-only demo evidence",
        "No SAP write, activation, transport, table rows, password, token, cookie, or session value is included."
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
