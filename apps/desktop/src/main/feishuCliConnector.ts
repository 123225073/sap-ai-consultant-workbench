import { execFile } from "node:child_process";
import path from "node:path";
import type {
  FeishuCliRedactedInfo,
  FeishuConfig,
  FeishuVerificationError,
  FeishuVerificationErrorCode,
  FeishuVerificationReport,
  FeishuVerificationStep
} from "../shared/workbenchTypes";

export interface FeishuCliConnectorInput {
  cliPath: string;
  profile: string;
}

export interface FeishuCliConnector {
  verify(input: FeishuCliConnectorInput): Promise<FeishuVerificationReport>;
}

interface CommandResult {
  ok: boolean;
  output: string;
  errorCode: string | number | null;
}

const COMMAND_TIMEOUT_MS = 12000;
const OUTPUT_LIMIT = 12000;
const REAL_FEISHU_CLI_COMMANDS = ["lark-cli", "lark-cli.exe", "feishu-cli", "feishu-cli.exe"] as const;
type RealFeishuCliCommand = (typeof REAL_FEISHU_CLI_COMMANDS)[number];

function nowIso(): string {
  return new Date().toISOString();
}

function cliInfo(input: FeishuCliConnectorInput): FeishuCliRedactedInfo {
  const cliName = path.basename(input.cliPath.trim()) || "未填写";
  return {
    cliName,
    profile: input.profile.trim() || "未填写"
  };
}

function error(code: FeishuVerificationErrorCode, message: string, suggestion: string): FeishuVerificationError {
  return { code, message, suggestion };
}

function step(id: FeishuVerificationStep["id"], title: string, status: FeishuVerificationStep["status"], detail: string, checkedAt: string): FeishuVerificationStep {
  return { id, title, status, detail, checkedAt };
}

function buildReport(
  mode: FeishuVerificationReport["mode"],
  input: FeishuCliConnectorInput,
  steps: FeishuVerificationStep[],
  errors: FeishuVerificationError[],
  checkedAt: string
): FeishuVerificationReport {
  const cliPassed = steps.some((item) => item.id === "cli" && item.status === "passed");
  const authPassed = steps.some((item) => item.id === "auth" && item.status === "passed");
  const docsPassed = steps.some((item) => item.id === "docs" && item.status === "passed");
  return {
    ok: cliPassed && authPassed && docsPassed,
    checkedAt,
    mode,
    cli: cliInfo(input),
    steps,
    authStatus: authPassed ? "verified" : cliPassed ? "failed" : "pending-verification",
    docPermissionStatus: docsPassed ? "verified" : authPassed ? "failed" : "pending-verification",
    errors
  };
}

function isFakeCli(input: FeishuCliConnectorInput): boolean {
  return input.cliPath.trim().toLowerCase() === "fake-lark-cli";
}

function commandLooksMissing(executableError: string | number | null): boolean {
  return executableError === "ENOENT" || executableError === "UNKNOWN";
}

function looksLikeMissingScope(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("missing_scope") || lower.includes("missing scope") || lower.includes("scope missing") || lower.includes("permission denied");
}

function toFixedCliCommand(value: string): RealFeishuCliCommand | null {
  const command = value.trim().toLowerCase();
  return REAL_FEISHU_CLI_COMMANDS.includes(command as RealFeishuCliCommand) ? (command as RealFeishuCliCommand) : null;
}

function runFixedCli(cliCommand: RealFeishuCliCommand, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(cliCommand, args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: OUTPUT_LIMIT,
      windowsHide: true
    }, (executionError, outText, errText) => {
      const output = `${String(outText ?? "")}\n${String(errText ?? "")}`.slice(0, OUTPUT_LIMIT);
      if (executionError) {
        const code = typeof executionError.code === "string" || typeof executionError.code === "number" ? executionError.code : null;
        resolve({ ok: false, output, errorCode: code });
        return;
      }
      resolve({ ok: true, output, errorCode: null });
    });
  });
}

export class FakeFeishuCliConnector implements FeishuCliConnector {
  async verify(input: FeishuCliConnectorInput): Promise<FeishuVerificationReport> {
    const checkedAt = nowIso();
    const key = `${input.cliPath} ${input.profile}`.toLowerCase();
    const steps: FeishuVerificationStep[] = [];
    const errors: FeishuVerificationError[] = [];

    if (key.includes("missing-cli")) {
      steps.push(step("cli", "CLI 检测", "failed", "未检测到可执行的飞书 CLI。", checkedAt));
      steps.push(step("auth", "登录状态", "skipped", "CLI 未通过检测，未检查登录状态。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "CLI 未通过检测，未检查文档权限。", checkedAt));
      errors.push(error("cli-missing", "未检测到飞书 CLI。", "请安装 lark-cli，或在配置中心填写正确的 CLI 路径。"));
      return buildReport("fake", input, steps, errors, checkedAt);
    }

    steps.push(step("cli", "CLI 检测", "passed", "飞书 CLI 可执行，基础环境检测通过。", checkedAt));

    if (key.includes("not-logged-in")) {
      steps.push(step("auth", "登录状态", "failed", "当前 Profile 未完成登录验证。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "登录未通过，未检查文档权限。", checkedAt));
      errors.push(error("auth-failed", "飞书 CLI Profile 未登录。", "请在终端完成 lark-cli 登录或授权后，再回到配置中心验证。"));
      return buildReport("fake", input, steps, errors, checkedAt);
    }

    steps.push(step("auth", "登录状态", "passed", "当前 Profile 已通过登录状态验证。", checkedAt));

    if (key.includes("missing-scope")) {
      steps.push(step("docs", "文档权限", "failed", "当前 Profile 缺少文档创建或写入权限。", checkedAt));
      errors.push(error("missing-scope", "飞书文档权限不足。", "请补齐飞书文档创建、文档写入和白板相关权限；本工作台不会自动启动新的授权流程。"));
      return buildReport("fake", input, steps, errors, checkedAt);
    }

    steps.push(step("docs", "文档权限", "passed", "未发现缺失文档权限；本阶段不创建真实文档，权限仍以后续真实流程为准。", checkedAt));
    return buildReport("fake", input, steps, errors, checkedAt);
  }
}

export class RealFeishuCliConnector implements FeishuCliConnector {
  async verify(input: FeishuCliConnectorInput): Promise<FeishuVerificationReport> {
    const checkedAt = nowIso();
    const steps: FeishuVerificationStep[] = [];
    const errors: FeishuVerificationError[] = [];
    const cliCommand = toFixedCliCommand(input.cliPath);

    if (!cliCommand) {
      steps.push(step("cli", "CLI 检测", "failed", "飞书 CLI 配置不在固定命令白名单内。", checkedAt));
      steps.push(step("auth", "登录状态", "skipped", "CLI 配置未通过，未检查登录状态。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "CLI 配置未通过，未检查文档权限。", checkedAt));
      errors.push(error("invalid-cli-path", "当前只允许验证固定的 lark-cli 或 feishu-cli 命令。", "请把 CLI 配置改为 lark-cli 或 feishu-cli；本功能不会执行任意本地路径。"));
      return buildReport("cli", input, steps, errors, checkedAt);
    }

    const doctor = await runFixedCli(cliCommand, ["doctor"]);
    if (!doctor.ok) {
      steps.push(step("cli", "CLI 检测", "failed", "飞书 CLI 自检未通过。", checkedAt));
      steps.push(step("auth", "登录状态", "skipped", "CLI 检测未通过，未检查登录状态。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "CLI 检测未通过，未检查文档权限。", checkedAt));
      const code = commandLooksMissing(doctor.errorCode) ? "cli-missing" : "doctor-failed";
      errors.push(error(code, code === "cli-missing" ? "未检测到飞书 CLI。" : "飞书 CLI 自检失败。", "请确认 lark-cli 已安装，并能在终端正常自检。"));
      return buildReport("cli", input, steps, errors, checkedAt);
    }

    steps.push(step("cli", "CLI 检测", "passed", "飞书 CLI 自检通过。", checkedAt));

    const auth = await runFixedCli(cliCommand, ["auth", "status", "--verify", "--profile", input.profile]);
    const missingScope = looksLikeMissingScope(auth.output);
    if (!auth.ok && !missingScope) {
      steps.push(step("auth", "登录状态", "failed", "当前 Profile 未通过登录状态验证。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "登录未通过，未检查文档权限。", checkedAt));
      errors.push(error("auth-failed", "飞书 CLI Profile 未登录或不可用。", "请在终端完成 lark-cli 登录或授权后，再回到配置中心验证。"));
      return buildReport("cli", input, steps, errors, checkedAt);
    }

    steps.push(step("auth", "登录状态", "passed", missingScope ? "Profile 可读取，但权限检查发现缺少飞书文档权限项。" : "当前 Profile 已通过登录状态验证。", checkedAt));

    if (missingScope) {
      steps.push(step("docs", "文档权限", "failed", "当前 Profile 缺少文档创建或写入权限。", checkedAt));
      errors.push(error("missing-scope", "飞书文档权限不足。", "请补齐飞书文档创建、文档写入和白板相关权限；本工作台不会自动启动新的授权流程。"));
      return buildReport("cli", input, steps, errors, checkedAt);
    }

    steps.push(step("docs", "文档权限", "passed", "未发现缺失文档权限；本阶段不创建真实文档，权限仍以后续真实流程为准。", checkedAt));
    return buildReport("cli", input, steps, errors, checkedAt);
  }
}

export function createFeishuCliConnector(config: Pick<FeishuConfig, "cliPath" | "profile">): FeishuCliConnector {
  return isFakeCli(config) ? new FakeFeishuCliConnector() : new RealFeishuCliConnector();
}

export function createFeishuValidationFailureReport(
  input: FeishuCliConnectorInput,
  code: FeishuVerificationErrorCode,
  message: string,
  suggestion: string
): FeishuVerificationReport {
  const checkedAt = nowIso();
  const steps: FeishuVerificationStep[] = [
    step("cli", "CLI 检测", "failed", message, checkedAt),
    step("auth", "登录状态", "skipped", "CLI 配置未通过，未检查登录状态。", checkedAt),
    step("docs", "文档权限", "skipped", "CLI 配置未通过，未检查文档权限。", checkedAt)
  ];
  return buildReport("fake", input, steps, [error(code, message, suggestion)], checkedAt);
}
