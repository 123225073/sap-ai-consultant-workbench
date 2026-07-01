import type { AdtConfig, AdtRedactedSystemInfo, AdtT000ProbeResult, AdtVerificationError, AdtVerificationErrorCode, AdtVerificationReport, AdtVerificationStep } from "../shared/workbenchTypes";

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
  return new FakeAdtReadonlyConnector();
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
