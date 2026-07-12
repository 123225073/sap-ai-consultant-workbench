import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { externalConnectorThrownError, externalConnectorUserError } from "./externalConnectorUserError";
import type {
  CodexCaseAssistContext,
  CodexCaseAssistRun,
  CodexCapabilitySummary,
  CodexConfig,
  CodexRedactedInfo,
  CodexVerificationError,
  CodexVerificationErrorCode,
  CodexVerificationReport,
  CodexVerificationStep
} from "../shared/workbenchTypes";

export interface CodexCliConnectorInput {
  integrationType: CodexConfig["integrationType"];
  executablePath: string;
  workspaceRoot: string;
}

export interface CodexCaseAssistConnectorInput extends CodexCliConnectorInput {
  context: CodexCaseAssistContext;
}

export interface CodexCliConnector {
  verify(input: CodexCliConnectorInput): Promise<CodexVerificationReport>;
  runCaseAssist(input: CodexCaseAssistConnectorInput): Promise<CodexCaseAssistRun>;
}

type CodexCommandName = "codex" | "codex.cmd" | "codex.exe";

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  output: string;
  errorCode: string | number | null;
}

interface CodexExecutable {
  executablePath: string;
  commandName: CodexCommandName;
}

const COMMAND_TIMEOUT_MS = 15000;
const PROBE_TIMEOUT_MS = 90000;
const CASE_ASSIST_TIMEOUT_MS = 120000;
const OUTPUT_LIMIT = 16000;
const CASE_ASSIST_OUTPUT_LIMIT = 12000;
const READONLY_PROBE_MARKER = "CODEX_PROBE_OK";

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((item) => item?.trim()).filter((item): item is string => Boolean(item))));
}

function appDataNpmDir(): string | null {
  if (process.platform !== "win32") return null;
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, "npm") : null;
}

function codexCommandFromName(value: string): CodexCommandName | null {
  const base = path.basename(value.trim()).toLowerCase();
  if (base === "codex" || base === "codex.cmd" || base === "codex.exe") return base;
  return null;
}

function safeExecutablePath(value: string): boolean {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^https?:\/\//i.test(value.trim())) return false;
  if (process.platform === "win32" && /[&|<>^]/.test(value)) return false;
  return Boolean(codexCommandFromName(value));
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate);
    return stats.isFile();
  } catch {
    return false;
  }
}

function runSystemCommand(command: string, args: string[], timeout = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, {
      timeout,
      maxBuffer: OUTPUT_LIMIT,
      windowsHide: true
    }, (executionError, outText, errText) => {
      const stdout = String(outText ?? "").slice(0, OUTPUT_LIMIT);
      const stderr = String(errText ?? "").slice(0, OUTPUT_LIMIT);
      const output = `${stdout}\n${stderr}`.slice(0, OUTPUT_LIMIT);
      if (executionError) {
        const code = typeof executionError.code === "string" || typeof executionError.code === "number" ? executionError.code : null;
        resolve({ ok: false, stdout, stderr, output, errorCode: code });
        return;
      }
      resolve({ ok: true, stdout, stderr, output, errorCode: null });
    });
  });
}

function spawnCommand(command: string, args: string[], timeout = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ ok: false, stdout: "", stderr: "命令执行超时。", output: "命令执行超时。", errorCode: "TIMEOUT" });
      }
    }, timeout);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (spawnError: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout: "", stderr: spawnError.message, output: spawnError.message, errorCode: spawnError.code ?? "UNKNOWN" });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf8").slice(0, OUTPUT_LIMIT);
      const stderrText = Buffer.concat(stderr).toString("utf8").slice(0, OUTPUT_LIMIT);
      const output = `${stdoutText}\n${stderrText}`.slice(0, OUTPUT_LIMIT);
      resolve({ ok: code === 0, stdout: stdoutText, stderr: stderrText, output, errorCode: code });
    });

    child.stdin.end();
  });
}

function executableInvocation(executablePath: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === "win32" && executablePath.toLowerCase().endsWith(".cmd")) {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", executablePath, ...args] };
  }
  return { command: executablePath, args };
}

function runCodexExecutable(executable: CodexExecutable, args: string[], timeout = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  const invocation = executableInvocation(executable.executablePath, args);
  return spawnCommand(invocation.command, invocation.args, timeout);
}

async function whereCommand(commandName: CodexCommandName): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const result = await runSystemCommand("where.exe", [commandName], COMMAND_TIMEOUT_MS);
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function localCodexCandidates(): Promise<CodexExecutable[]> {
  const npmDir = appDataNpmDir();
  const fixedCandidates = [
    npmDir ? path.join(npmDir, "codex.cmd") : null,
    npmDir ? path.join(npmDir, "codex.exe") : null,
    npmDir ? path.join(npmDir, "codex") : null
  ];
  const whereCandidates = [
    ...await whereCommand("codex.cmd"),
    ...await whereCommand("codex.exe"),
    ...await whereCommand("codex")
  ];
  const candidates: CodexExecutable[] = [];
  for (const candidate of uniqueStrings([...fixedCandidates, ...whereCandidates])) {
    if (!safeExecutablePath(candidate)) continue;
    const commandName = codexCommandFromName(candidate);
    if (!commandName) continue;
    if (await fileExists(candidate)) {
      candidates.push({ executablePath: candidate, commandName });
    }
  }
  return candidates;
}

async function resolveExecutable(inputPath: string): Promise<CodexExecutable | null> {
  const configured = inputPath.trim();
  const candidates = await localCodexCandidates();
  if (!configured || configured === "codex") return candidates[0] ?? null;
  const commandName = codexCommandFromName(configured);
  if (!commandName || !safeExecutablePath(configured)) return null;
  if (path.isAbsolute(configured)) {
    return await fileExists(configured) ? { executablePath: configured, commandName } : null;
  }
  return candidates.find((candidate) => path.basename(candidate.executablePath).toLowerCase() === commandName) ?? null;
}

function commandLooksMissing(code: string | number | null): boolean {
  return code === "ENOENT" || code === 9009 || code === "9009";
}

function readonlyProbeFailure(result: CommandResult): { detail: string; suggestion: string } {
  const { output: commandText } = result;
  const output = commandText.toLowerCase();
  if (output.includes("requires a newer version of codex")) {
    return {
      detail: "Codex 当前默认模型与本机 CLI 版本不兼容，工程试跑未完成。",
      suggestion: "请更新 Codex CLI，或在 Codex 配置中改用当前版本支持的模型后重试；这不会影响工作台核心 AI 对话。"
    };
  }
  if (output.includes("websocket") && (output.includes("refused") || output.includes("积极拒绝") || output.includes("10061"))) {
    return {
      detail: "Codex 工程试跑无法建立网络连接，可能仍在使用失效的本机代理端口。",
      suggestion: "请检查 Codex 的代理配置和网络连接后重试；这不会影响工作台已配置的模型渠道。"
    };
  }
  if (result.errorCode === "TIMEOUT") {
    return {
      detail: "Codex 工程试跑等待超时。",
      suggestion: "请检查 Codex 当前模型、CLI 版本与网络状态后重试；这不会影响工作台核心 AI 对话。"
    };
  }
  return {
    detail: "Codex 工程试跑没有返回预期确认结果。",
    suggestion: "请检查 Codex 当前模型、CLI 版本与网络状态后重试；配置页不会保存本次原始输出。"
  };
}

function error(code: CodexVerificationErrorCode, message: string, suggestion: string): CodexVerificationError {
  return { code, message, suggestion };
}

function step(id: CodexVerificationStep["id"], title: string, status: CodexVerificationStep["status"], detail: string, checkedAt: string): CodexVerificationStep {
  return { id, title, status, detail, checkedAt };
}

function versionFromOutput(value: string): string {
  const raw = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  return raw.replace(/^codex-cli\s+/i, "").replace(/^openai codex\s+/i, "").trim();
}

function loginDetail(output: string): { ok: boolean; detail: string } {
  const compact = output.replace(/\s+/g, " ").trim();
  if (/logged in/i.test(compact)) return { ok: true, detail: "Codex 已登录，可使用当前本机账号。" };
  if (/not logged in|logged out|no login|unauth/i.test(compact)) return { ok: false, detail: "Codex 当前未登录。" };
  return { ok: false, detail: "Codex 登录状态无法确认。" };
}

function capabilitiesFromHelp(output: string, readonlyProbeOk: boolean): CodexCapabilitySummary[] {
  const lower = output.toLowerCase();
  return [
    {
      id: "task-runner",
      label: "工程任务执行",
      status: readonlyProbeOk ? "verified" : "pending-verification",
      detail: readonlyProbeOk ? "只读试跑已通过，可作为后台工程执行器。" : "需要只读试跑通过后再用于案件。"
    },
    {
      id: "mcp",
      label: "MCP 能力",
      status: lower.includes("mcp") ? "verified" : "pending-verification",
      detail: lower.includes("mcp") ? "当前 Codex CLI 提供 MCP 管理入口；工作台本阶段不直接读取 MCP 配置。" : "当前 CLI 帮助里未识别到 MCP 入口。"
    },
    {
      id: "plugins",
      label: "插件能力",
      status: lower.includes("plugin") ? "verified" : "pending-verification",
      detail: lower.includes("plugin") ? "当前 Codex CLI 提供插件管理入口；工作台本阶段不直接管理插件。" : "当前 CLI 帮助里未识别到插件入口。"
    },
    {
      id: "skills",
      label: "Skills 能力",
      status: readonlyProbeOk ? "verified" : "pending-verification",
      detail: readonlyProbeOk ? "Codex 任务可加载本机 Skills；工作台只通过 Codex 受控任务间接使用。" : "需要只读试跑通过后确认 Codex 任务运行链路。"
    }
  ];
}

function renderCaseAssistPrompt(context: CodexCaseAssistContext): string {
  return [
    "你是 SAP AI 顾问工作台里的 Codex 工程辅助。",
    "",
    "请严格基于下方提供的案件信息输出中文 Markdown。不要读取本机文件，不要执行工具，不要访问 Codex 历史聊天，不要要求用户切换到终端。",
    "",
    "输出必须包含：",
    "1. 当前问题的工程化拆解。",
    "2. 最小可验证的处理步骤。",
    "3. 风险和边界。",
    "4. 下一步建议。",
    "",
    "边界：",
    "- 只做工程辅助分析，不生成完整源码。",
    "- 不写 SAP、不激活对象、不释放传输。",
    "- 不创建、更新或发布飞书文档。",
    "- 不输出密码、Token、API Key、Cookie、授权头或完整 SAP 源码。",
    "- 如果信息不足，请列出需要用户补充的最少信息。",
    "",
    "案件信息：",
    `- 项目：${context.projectName}`,
    `- 系统：${context.systemLabel}`,
    `- SAP 版本：${context.sapVersion}`,
    `- 案件：${context.caseTitle}`,
    `- 任务模式：${context.taskLabel}`,
    `- 当前案件摘要：${context.caseSummary}`,
    `- 项目规范摘要：${context.standardsSummary}`,
    "",
    "用户本次输入：",
    context.userInput,
    "",
    "请直接输出分析内容，不要输出前后寒暄。"
  ].join("\n");
}

function sanitizeCodexAssistOutput(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw externalConnectorThrownError(externalConnectorUserError("Codex CLI", "invalid-response"));
  }
  const forbiddenPatterns = [
    /secure-store:sec_[a-f0-9]{32}/i,
    /sk-(?:proj-)?[a-z0-9_-]{20,}/i,
    /github_pat_[a-z0-9_]{20,}/i,
    /ghp_[a-z0-9]{20,}/i,
    /bearer\s+[a-z0-9._~+/=-]{12,}/i,
    /authorization\s*[:=]\s*[^\s]+/i,
    /cookie\s*[:=]\s*[^\s]+/i,
    /api[_-]?key\s*[:=]\s*[^\s]+/i,
    /client[_-]?secret\s*[:=]\s*[^\s]+/i,
    /password\s*[:=]\s*[^\s]+/i,
    /token\s*[:=]\s*[^\s]+/i,
    /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    /^\s*(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION)\s+[\w/]+/im,
    /\bENDCLASS\b|\bENDFUNCTION\b|\bENDMETHOD\b|\bENDFORM\b/i,
    /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(normalized))) {
    throw externalConnectorThrownError({
      reason: "Codex CLI 返回内容包含疑似密钥、授权信息、SAP 源码或写入语句，已阻止保存。",
      suggestion: "请缩小输入范围并移除敏感内容后重试；工作台不会保存本次输出。"
    });
  }
  if (normalized.length <= CASE_ASSIST_OUTPUT_LIMIT) return normalized;
  return `${normalized.slice(0, CASE_ASSIST_OUTPUT_LIMIT)}\n\n> 内容较长，已按安全长度限制截断。`;
}

function cliInfo(input: CodexCliConnectorInput, executable: CodexExecutable | null, version = ""): CodexRedactedInfo {
  return {
    integrationType: input.integrationType,
    executablePath: executable?.executablePath ?? (input.executablePath || "未检测到"),
    installDir: executable ? path.dirname(executable.executablePath) : null,
    cliName: executable ? path.basename(executable.executablePath) : text(input.executablePath) || "codex",
    version
  };
}

function buildReport(
  input: CodexCliConnectorInput,
  executable: CodexExecutable | null,
  version: string,
  steps: CodexVerificationStep[],
  errors: CodexVerificationError[],
  capabilities: CodexCapabilitySummary[],
  checkedAt: string
): CodexVerificationReport {
  const cliPassed = steps.some((item) => item.id === "cli" && item.status === "passed");
  const loginPassed = steps.some((item) => item.id === "login" && item.status === "passed");
  const readonlyPassed = steps.some((item) => item.id === "readonly-task" && item.status === "passed");
  return {
    ok: cliPassed && loginPassed,
    checkedAt,
    mode: "cli",
    cli: cliInfo(input, executable, version),
    steps,
    cliStatus: cliPassed ? "verified" : "failed",
    loginStatus: loginPassed ? "verified" : cliPassed ? "failed" : "pending-verification",
    readonlyTaskStatus: readonlyPassed ? "verified" : loginPassed ? "failed" : "pending-verification",
    capabilities,
    errors
  };
}

export class RealCodexCliConnector implements CodexCliConnector {
  async verify(input: CodexCliConnectorInput): Promise<CodexVerificationReport> {
    const checkedAt = nowIso();
    const steps: CodexVerificationStep[] = [];
    const errors: CodexVerificationError[] = [];

    if (input.integrationType !== "cli") {
      steps.push(step("cli", "Codex CLI 检测", "failed", "当前只实现本机 Codex CLI 接入；SDK 接入为后续预留。", checkedAt));
      steps.push(step("login", "登录状态", "skipped", "Codex CLI 未通过检测，未检查登录状态。", checkedAt));
      steps.push(step("readonly-task", "只读试跑", "skipped", "Codex CLI 未通过检测，未执行只读试跑。", checkedAt));
      errors.push(error("unsupported-integration", "当前只支持 Codex CLI 接入。", "请把接入方式改为本机 Codex 命令；SDK 作为后续扩展能力保留。"));
      return buildReport(input, null, "", steps, errors, [], checkedAt);
    }

    const executable = await resolveExecutable(input.executablePath);
    if (!executable) {
      const copy = externalConnectorUserError("Codex CLI", "missing");
      steps.push(step("cli", "Codex CLI 检测", "failed", "未检测到可执行的 codex 命令。", checkedAt));
      steps.push(step("login", "登录状态", "skipped", "Codex CLI 未通过检测，未检查登录状态。", checkedAt));
      steps.push(step("readonly-task", "只读试跑", "skipped", "Codex CLI 未通过检测，未执行只读试跑。", checkedAt));
      errors.push(error("cli-missing", copy.reason, copy.suggestion));
      return buildReport(input, null, "", steps, errors, [], checkedAt);
    }

    const versionResult = await runCodexExecutable(executable, ["--version"]);
    const version = versionResult.ok ? versionFromOutput(versionResult.output) : "";
    if (!versionResult.ok || !version) {
      steps.push(step("cli", "Codex CLI 检测", "failed", "Codex CLI 版本检查失败。", checkedAt));
      steps.push(step("login", "登录状态", "skipped", "Codex CLI 未通过检测，未检查登录状态。", checkedAt));
      steps.push(step("readonly-task", "只读试跑", "skipped", "Codex CLI 未通过检测，未执行只读试跑。", checkedAt));
      const code = commandLooksMissing(versionResult.errorCode) ? "cli-missing" : "version-failed";
      errors.push(error(code, code === "cli-missing" ? "未检测到 Codex CLI。" : "Codex CLI 无法正常执行。", "请确认终端里可以运行 codex --version。"));
      return buildReport(input, executable, version, steps, errors, [], checkedAt);
    }
    steps.push(step("cli", "Codex CLI 检测", "passed", `已检测到 ${path.basename(executable.executablePath)}，版本 ${version}。`, checkedAt));

    const login = await runCodexExecutable(executable, ["login", "status"]);
    const loginState = loginDetail(login.output);
    if (!login.ok || !loginState.ok) {
      const copy = externalConnectorUserError("Codex CLI", "authentication");
      steps.push(step("login", "登录状态", "failed", loginState.detail, checkedAt));
      steps.push(step("readonly-task", "只读试跑", "skipped", "Codex 未登录，未执行只读试跑。", checkedAt));
      errors.push(error("login-failed", copy.reason, copy.suggestion));
      return buildReport(input, executable, version, steps, errors, [], checkedAt);
    }
    steps.push(step("login", "登录状态", "passed", loginState.detail, checkedAt));

    const help = await runCodexExecutable(executable, ["--help"]);
    const prompt = "只回复 CODEX_PROBE_OK。不要读取文件，不要执行工具，不要解释。";
    const probeWorkdir = await fs.mkdtemp(path.join(os.tmpdir(), "sap-ai-codex-probe-"));
    const probe = await runCodexExecutable(executable, [
      "-a",
      "never",
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-C",
      probeWorkdir,
      prompt
    ], PROBE_TIMEOUT_MS);
    const readonlyProbeOk = probe.ok && probe.output.includes(READONLY_PROBE_MARKER);
    const capabilities = capabilitiesFromHelp(help.output, readonlyProbeOk);
    if (!readonlyProbeOk) {
      const failure = readonlyProbeFailure(probe);
      steps.push(step("readonly-task", "工程试跑（可选）", "failed", failure.detail, checkedAt));
      errors.push(error("readonly-task-failed", failure.detail, failure.suggestion));
      return buildReport(input, executable, version, steps, errors, capabilities, checkedAt);
    }

    steps.push(step("readonly-task", "工程试跑（可选）", "passed", "已完成一次临时只读任务；本次不读取 Codex 历史聊天，不写入项目文件。", checkedAt));
    return buildReport(input, executable, version, steps, errors, capabilities, checkedAt);
  }

  async runCaseAssist(input: CodexCaseAssistConnectorInput): Promise<CodexCaseAssistRun> {
    const generatedAt = nowIso();
    if (input.integrationType !== "cli") {
      throw externalConnectorThrownError(externalConnectorUserError("Codex CLI", "configuration"));
    }
    const executable = await resolveExecutable(input.executablePath);
    if (!executable) {
      throw externalConnectorThrownError(externalConnectorUserError("Codex CLI", "missing"));
    }

    const versionResult = await runCodexExecutable(executable, ["--version"]);
    const version = versionResult.ok ? versionFromOutput(versionResult.output) : "";
    if (!version) {
      throw externalConnectorThrownError(externalConnectorUserError("Codex CLI", "execution"));
    }

    const prompt = renderCaseAssistPrompt(input.context);
    const caseWorkdir = await fs.mkdtemp(path.join(os.tmpdir(), "sap-ai-codex-case-assist-"));
    const result = await runCodexExecutable(executable, [
      "-a",
      "never",
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-C",
      caseWorkdir,
      prompt
    ], CASE_ASSIST_TIMEOUT_MS);

    if (!result.ok) {
      const kind = result.errorCode === "TIMEOUT" ? "timeout" : "execution";
      throw externalConnectorThrownError(externalConnectorUserError("Codex CLI", kind));
    }

    const content = sanitizeCodexAssistOutput(result.stdout);
    return {
      status: "success",
      generatedAt,
      executorLabel: `Codex CLI ${version}`,
      content,
      outputCharCount: content.length
    };
  }
}

export function createCodexCliConnector(): CodexCliConnector {
  return new RealCodexCliConnector();
}

export function createCodexValidationFailureReport(
  input: CodexCliConnectorInput,
  code: CodexVerificationErrorCode,
  message: string,
  suggestion: string
): CodexVerificationReport {
  const checkedAt = nowIso();
  const steps = [
    step("cli", "Codex CLI 检测", "failed", message, checkedAt),
    step("login", "登录状态", "skipped", "Codex CLI 未通过检测，未检查登录状态。", checkedAt),
    step("readonly-task", "只读试跑", "skipped", "Codex CLI 未通过检测，未执行只读试跑。", checkedAt)
  ];
  return buildReport(input, null, "", steps, [error(code, message, suggestion)], [], checkedAt);
}
