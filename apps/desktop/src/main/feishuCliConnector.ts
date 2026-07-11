import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { externalConnectorUserError } from "./externalConnectorUserError";
import type {
  FeishuCliDiscoveryReport,
  FeishuCliInstallResult,
  FeishuCliProfileSetupResult,
  FeishuCliProfileSummary,
  FeishuCliRedactedInfo,
  FeishuConfig,
  FeishuAuthAction,
  FeishuVerificationError,
  FeishuVerificationErrorCode,
  FeishuVerificationReport,
  FeishuVerificationStep
} from "../shared/workbenchTypes";

export interface FeishuCliConnectorInput {
  cliPath: string;
  profile: string;
  appId: string;
}

export interface FeishuCliVerifyOptions {
  startUserAuthOnFailure?: boolean;
  openConsentUrl?: (url: string) => Promise<void>;
}

export interface FeishuCliProfileSetupInput extends FeishuCliConnectorInput {
  appSecret: string;
}

export interface FeishuCliConnector {
  verify(input: FeishuCliConnectorInput, options?: FeishuCliVerifyOptions): Promise<FeishuVerificationReport>;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  output: string;
  errorCode: string | number | null;
}

interface CliExecutable {
  executablePath: string;
  commandName: RealFeishuCliCommand;
}

interface DiscoveryInternal extends FeishuCliDiscoveryReport {
  candidates: CliExecutable[];
}

interface RawProfile {
  name?: unknown;
  appId?: unknown;
  brand?: unknown;
  active?: unknown;
  user?: unknown;
  tokenStatus?: unknown;
}

const COMMAND_TIMEOUT_MS = 12000;
const INSTALL_TIMEOUT_MS = 120000;
const PROFILE_SAVE_TIMEOUT_MS = 30000;
const AUTH_COMPLETE_TIMEOUT_MS = 180000;
const OUTPUT_LIMIT = 12000;
const REAL_FEISHU_CLI_COMMANDS = ["lark-cli", "lark-cli.cmd", "lark-cli.exe", "feishu-cli", "feishu-cli.cmd", "feishu-cli.exe"] as const;
const REQUIRED_DOC_SCOPES = "docx:document:readonly docx:document:create docx:document:write_only";
type RealFeishuCliCommand = (typeof REAL_FEISHU_CLI_COMMANDS)[number];

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = text(value);
    if (!item) continue;
    const key = process.platform === "win32" ? item.toLowerCase() : item;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function appDataNpmDir(): string | null {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "npm");
  }
  return null;
}

function maskAppId(value: string): string | null {
  const appId = value.trim();
  if (!appId) return null;
  if (appId.length <= 12) return `${appId.slice(0, 4)}***`;
  return `${appId.slice(0, 8)}***${appId.slice(-4)}`;
}

function cliInfo(input: FeishuCliConnectorInput, discovery?: DiscoveryInternal, profile?: FeishuCliProfileSummary | null): FeishuCliRedactedInfo {
  const cliPath = discovery?.cliPath ?? input.cliPath.trim();
  return {
    cliName: cliPath ? path.basename(cliPath) : "未检测到",
    cliPath: cliPath || "未检测到",
    installDir: discovery?.installDir ?? (cliPath ? path.dirname(cliPath) : null),
    version: discovery?.version ?? null,
    profile: profile?.name ?? (input.profile.trim() || "未选择"),
    profileUser: profile?.user ?? null,
    profileTokenStatus: profile?.tokenStatus ?? null,
    appIdMasked: maskAppId(input.appId) ?? profile?.appIdMasked ?? null
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
  cli: FeishuCliRedactedInfo,
  steps: FeishuVerificationStep[],
  errors: FeishuVerificationError[],
  checkedAt: string,
  authAction?: FeishuAuthAction
): FeishuVerificationReport {
  const cliPassed = steps.some((item) => item.id === "cli" && item.status === "passed");
  const authPassed = steps.some((item) => item.id === "auth" && item.status === "passed");
  const docsPassed = steps.some((item) => item.id === "docs" && item.status === "passed");
  return {
    ok: cliPassed && authPassed && docsPassed,
    checkedAt,
    mode,
    cli,
    steps,
    authStatus: authPassed ? "verified" : cliPassed ? "failed" : "pending-verification",
    docPermissionStatus: docsPassed ? "verified" : authPassed ? "failed" : "pending-verification",
    errors,
    ...(authAction ? { authAction } : {})
  };
}

function isFakeCli(input: Pick<FeishuConfig, "cliPath" | "profile">): boolean {
  return input.cliPath.trim().toLowerCase() === "fake-lark-cli";
}

function commandLooksMissing(executableError: string | number | null): boolean {
  return executableError === "ENOENT" || executableError === "UNKNOWN";
}

function looksLikeMissingScope(textValue: string): boolean {
  const lower = textValue.toLowerCase();
  return lower.includes("missing_scope") || lower.includes("missing scope") || lower.includes("scope missing") || lower.includes("permission denied");
}

function safeJsonParse(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const firstJson = trimmed.search(/[\[{]/);
  if (firstJson < 0) return null;
  try {
    return JSON.parse(trimmed.slice(firstJson));
  } catch {
    return null;
  }
}

function firstStringByKeys(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringByKeys(item, keys);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = record[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  for (const item of Object.values(record)) {
    const found = firstStringByKeys(item, keys);
    if (found) return found;
  }
  return null;
}

function authorizationUrlFromOutput(output: unknown): string | null {
  const candidates = [
    firstStringByKeys(output, ["verification_uri_complete", "verificationUriComplete", "verification_url_complete", "verificationUrlComplete"]),
    firstStringByKeys(output, ["verification_url", "verificationUrl", "verification_uri", "verificationUri", "url"])
  ];
  return candidates.find((candidate) => candidate && /^https?:\/\//i.test(candidate)) ?? null;
}

function deviceCodeFromOutput(output: unknown): string | null {
  return firstStringByKeys(output, ["device_code", "deviceCode"]);
}

function cliCommandFromName(value: string): RealFeishuCliCommand | null {
  const command = path.basename(value.trim()).toLowerCase();
  return REAL_FEISHU_CLI_COMMANDS.includes(command as RealFeishuCliCommand) ? (command as RealFeishuCliCommand) : null;
}

function cliCommandFamily(command: RealFeishuCliCommand): "lark-cli" | "feishu-cli" {
  return command.startsWith("feishu-cli") ? "feishu-cli" : "lark-cli";
}

function hasDirectoryPart(value: string): boolean {
  const trimmed = value.trim();
  return path.isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\") || path.dirname(trimmed) !== ".";
}

function safeExecutablePath(value: string): boolean {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (process.platform === "win32" && /[&|<>^]/.test(value)) return false;
  return Boolean(cliCommandFromName(value));
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

function spawnCommand(command: string, args: string[], inputText: string | null, timeout = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
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

    if (inputText !== null) {
      child.stdin.write(inputText);
    }
    child.stdin.end();
  });
}

function executableInvocation(executablePath: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === "win32" && executablePath.toLowerCase().endsWith(".cmd")) {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", executablePath, ...args] };
  }
  return { command: executablePath, args };
}

function runCliExecutable(executable: CliExecutable, args: string[], timeout = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  const invocation = executableInvocation(executable.executablePath, args);
  return spawnCommand(invocation.command, invocation.args, null, timeout);
}

function runCliExecutableWithInput(executable: CliExecutable, args: string[], inputText: string, timeout = PROFILE_SAVE_TIMEOUT_MS): Promise<CommandResult> {
  const invocation = executableInvocation(executable.executablePath, args);
  return spawnCommand(invocation.command, invocation.args, inputText, timeout);
}

async function whereCommand(commandName: RealFeishuCliCommand | "npm.cmd" | "npm"): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const result = await runSystemCommand("where.exe", [commandName], COMMAND_TIMEOUT_MS);
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function localCliCandidates(): Promise<CliExecutable[]> {
  const npmDir = appDataNpmDir();
  const fixedCandidates = [
    npmDir ? path.join(npmDir, "lark-cli.cmd") : null,
    npmDir ? path.join(npmDir, "lark-cli.exe") : null,
    npmDir ? path.join(npmDir, "lark-cli") : null,
    npmDir ? path.join(npmDir, "feishu-cli.cmd") : null,
    npmDir ? path.join(npmDir, "feishu-cli.exe") : null,
    npmDir ? path.join(npmDir, "feishu-cli") : null
  ];

  const whereCandidates = [
    ...await whereCommand("lark-cli.cmd"),
    ...await whereCommand("lark-cli.exe"),
    ...await whereCommand("lark-cli"),
    ...await whereCommand("feishu-cli.cmd"),
    ...await whereCommand("feishu-cli.exe"),
    ...await whereCommand("feishu-cli")
  ];

  const candidates: CliExecutable[] = [];
  for (const candidate of uniqueStrings([...fixedCandidates, ...whereCandidates])) {
    if (!safeExecutablePath(candidate)) continue;
    const commandName = cliCommandFromName(candidate);
    if (!commandName) continue;
    if (await fileExists(candidate)) {
      candidates.push({ executablePath: candidate, commandName });
    }
  }
  return candidates;
}

function normalizeProfiles(value: unknown): FeishuCliProfileSummary[] {
  const rawProfiles = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { profiles?: unknown }).profiles)
    ? (value as { profiles: unknown[] }).profiles
    : [];
  return rawProfiles.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as RawProfile;
    const name = text(raw.name);
    if (!name) return [];
    const appId = text(raw.appId);
    return [{
      name,
      appId,
      appIdMasked: maskAppId(appId) ?? "未提供",
      brand: text(raw.brand) || "feishu",
      active: raw.active === true,
      user: text(raw.user) || null,
      tokenStatus: text(raw.tokenStatus) || null
    }];
  });
}

function chooseRecommendedProfile(profiles: FeishuCliProfileSummary[]): string | null {
  const active = profiles.find((profile) => profile.active);
  if (active) return active.name;
  const validToken = profiles.find((profile) => profile.tokenStatus && profile.tokenStatus !== "expired");
  if (validToken) return validToken.name;
  return profiles[0]?.name ?? null;
}

function chooseProfile(configured: string, profiles: FeishuCliProfileSummary[]): FeishuCliProfileSummary | null {
  const wanted = configured.trim();
  if (wanted) {
    return profiles.find((profile) => profile.name === wanted) ?? null;
  }
  if (profiles.length === 1) return profiles[0];
  return null;
}

async function discoverInternal(): Promise<DiscoveryInternal> {
  const checkedAt = nowIso();
  const candidates = await localCliCandidates();
  const executable = candidates[0];
  if (!executable) {
    return {
      checkedAt,
      installed: false,
      cliPath: null,
      installDir: null,
      commandName: null,
      version: null,
      profiles: [],
      recommendedProfile: null,
      message: "未检测到 lark-cli，可点击自动安装。",
      candidates: []
    };
  }

  const versionResult = await runCliExecutable(executable, ["--version"]);
  const version = versionResult.ok ? versionResult.stdout.trim().replace(/^lark-cli version\s+/i, "") || null : null;
  const profileResult = await runCliExecutable(executable, ["profile", "list"]);
  const profiles = profileResult.ok ? normalizeProfiles(safeJsonParse(profileResult.output)) : [];
  return {
    checkedAt,
    installed: true,
    cliPath: executable.executablePath,
    installDir: path.dirname(executable.executablePath),
    commandName: executable.commandName,
    version,
    profiles,
    recommendedProfile: chooseRecommendedProfile(profiles),
    message: profiles.length > 0 ? "已检测到飞书 CLI 和本机 profile。" : "已检测到飞书 CLI，但还没有可用 profile。",
    candidates
  };
}

export async function discoverFeishuCli(): Promise<FeishuCliDiscoveryReport> {
  const { candidates: _candidates, ...report } = await discoverInternal();
  return report;
}

async function resolveNpmCommand(): Promise<string | null> {
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs", "npm.cmd") : null;
    const programFilesX86 = process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"] as string, "nodejs", "npm.cmd") : null;
    for (const candidate of uniqueStrings([programFiles, programFilesX86, ...(await whereCommand("npm.cmd")), ...(await whereCommand("npm"))])) {
      if (path.basename(candidate).toLowerCase() !== "npm.cmd" && path.basename(candidate).toLowerCase() !== "npm") continue;
      if (await fileExists(candidate)) return candidate;
    }
    return null;
  }
  return "npm";
}

export async function installFeishuCli(): Promise<FeishuCliInstallResult> {
  const checkedAt = nowIso();
  const npmCommand = await resolveNpmCommand();
  if (!npmCommand) {
    return {
      checkedAt,
      ok: false,
      cliPath: null,
      installDir: null,
      version: null,
      message: "未检测到 npm，无法自动安装飞书 CLI。",
      errors: [error("install-failed", "未检测到 npm。", "请先安装 Node.js/npm，然后再执行自动安装。")]
    };
  }

  const npmInvocation = executableInvocation(npmCommand, ["install", "-g", "@larksuite/cli"]);
  const result = await spawnCommand(npmInvocation.command, npmInvocation.args, null, INSTALL_TIMEOUT_MS);
  if (!result.ok) {
    const kind = result.errorCode === "TIMEOUT" ? "timeout" : "execution";
    const copy = externalConnectorUserError("Feishu/Lark CLI", kind);
    return {
      checkedAt,
      ok: false,
      cliPath: null,
      installDir: null,
      version: null,
      message: copy.reason,
      errors: [error("install-failed", copy.reason, copy.suggestion)]
    };
  }

  const discovery = await discoverInternal();
  return {
    checkedAt: nowIso(),
    ok: discovery.installed,
    cliPath: discovery.cliPath,
    installDir: discovery.installDir,
    version: discovery.version,
    message: discovery.installed ? "飞书 CLI 已安装并检测到。" : "安装命令已执行，但仍未检测到 lark-cli。",
    errors: discovery.installed ? [] : [error("cli-missing", "安装后仍未检测到飞书 CLI。", "请重新打开应用或检查 npm 全局 bin 目录是否在 PATH 中。")]
  };
}

async function resolveExecutableForInput(inputPath: string, discovery: DiscoveryInternal): Promise<CliExecutable | null> {
  const configured = inputPath.trim();
  if (configured) {
    const configuredBase = cliCommandFromName(configured);
    if (!configuredBase) return null;
    const normalizedConfigured = path.resolve(configured).toLowerCase();
    const exact = discovery.candidates.find((candidate) => path.resolve(candidate.executablePath).toLowerCase() === normalizedConfigured);
    if (exact) return exact;
    if (hasDirectoryPart(configured)) {
      if (safeExecutablePath(configured) && await fileExists(configured)) {
        return { executablePath: configured, commandName: configuredBase };
      }
      return null;
    }
    const wantedFamily = cliCommandFamily(configuredBase);
    return discovery.candidates.find((candidate) => candidate.commandName === configuredBase)
      ?? discovery.candidates.find((candidate) => cliCommandFamily(candidate.commandName) === wantedFamily)
      ?? null;
  }
  return discovery.candidates[0] ?? null;
}

function userIdentityReady(authData: unknown): { ok: boolean; detail: string } {
  if (!authData || typeof authData !== "object") return { ok: false, detail: "CLI 未返回可解析的登录状态。" };
  const data = authData as {
    identity?: unknown;
    identities?: {
      user?: {
        status?: unknown;
        available?: unknown;
        verified?: unknown;
        message?: unknown;
        tokenStatus?: unknown;
        userName?: unknown;
      };
      bot?: {
        available?: unknown;
        verified?: unknown;
        message?: unknown;
      };
    };
    note?: unknown;
  };
  const user = data.identities?.user;
  if (data.identity === "user" || user?.available === true || user?.verified === true || user?.status === "ready") {
    const userName = text(user?.userName);
    return { ok: true, detail: userName ? `用户授权可用：${userName}。` : "用户授权可用。" };
  }
  return { ok: false, detail: "当前 profile 没有可用的 Feishu/Lark 用户授权。" };
}

async function startUserConsent(
  executable: CliExecutable,
  profile: string,
  options?: FeishuCliVerifyOptions
): Promise<FeishuAuthAction> {
  if (!options?.startUserAuthOnFailure || !options.openConsentUrl) {
    return {
      status: "failed",
      message: "当前 profile 的飞书用户授权已失效；需要打开飞书授权页，由用户确认后再测试连接。"
    };
  }

  const start = await runCliExecutable(executable, [
    "auth",
    "login",
    "--profile",
    profile,
    "--scope",
    REQUIRED_DOC_SCOPES,
    "--no-wait",
    "--json"
  ]);
  const startData = safeJsonParse(start.output);
  const verificationUrl = authorizationUrlFromOutput(startData);
  const deviceCode = deviceCodeFromOutput(startData);

  if (!start.ok || !verificationUrl || !deviceCode) {
    return {
      status: "failed",
      message: "飞书授权页没有成功生成；请检查当前 profile 的 App ID/App Secret，或重新写入 CLI Profile。"
    };
  }

  await options.openConsentUrl(verificationUrl);

  const complete = await runCliExecutable(executable, [
    "auth",
    "login",
    "--profile",
    profile,
    "--device-code",
    deviceCode,
    "--json"
  ], AUTH_COMPLETE_TIMEOUT_MS);

  if (complete.ok) {
    return {
      status: "completed",
      message: "飞书授权已完成，已继续检查登录状态和文档权限。"
    };
  }

  return {
    status: "opened",
    message: "已打开飞书授权页。请在浏览器中确认授权；完成后回到这里再次点击测试连接。"
  };
}

export async function saveFeishuCliProfile(input: FeishuCliProfileSetupInput): Promise<FeishuCliProfileSetupResult> {
  const checkedAt = nowIso();
  const profile = input.profile.trim();
  const appId = input.appId.trim();
  const appSecret = input.appSecret;
  if (!profile || !/^[A-Za-z0-9._-]{1,80}$/.test(profile)) {
    return {
      checkedAt,
      ok: false,
      profile: profile || "未填写",
      appIdMasked: maskAppId(appId) ?? "未填写",
      message: "飞书 profile 名称无效。",
      errors: [error("missing-config", "飞书 profile 名称无效。", "请使用 1-80 位英文、数字、点、下划线或短横线。")]
    };
  }
  if (!/^cli_[A-Za-z0-9]+$/.test(appId)) {
    return {
      checkedAt,
      ok: false,
      profile,
      appIdMasked: maskAppId(appId) ?? "未填写",
      message: "飞书 App ID 格式不正确。",
      errors: [error("missing-config", "飞书 App ID 格式不正确。", "请填写飞书开发者后台里的 App ID，通常以 cli_ 开头。")]
    };
  }
  if (!appSecret) {
    return {
      checkedAt,
      ok: false,
      profile,
      appIdMasked: maskAppId(appId) ?? "未填写",
      message: "飞书 App Secret 未保存。",
      errors: [error("missing-config", "飞书 App Secret 未保存。", "请先填写并保存 App Secret，再写入 CLI profile。")]
    };
  }

  const discovery = await discoverInternal();
  const executable = await resolveExecutableForInput(input.cliPath, discovery);
  if (!executable) {
    const copy = externalConnectorUserError("Feishu/Lark CLI", "missing");
    return {
      checkedAt,
      ok: false,
      profile,
      appIdMasked: maskAppId(appId) ?? "未填写",
      message: copy.reason,
      errors: [error("cli-missing", copy.reason, copy.suggestion)]
    };
  }

  const existingProfile = discovery.profiles.find((item) => item.name === profile);
  if (existingProfile && !existingProfile.appId) {
    return {
      checkedAt,
      ok: false,
      profile,
      appIdMasked: maskAppId(appId) ?? "未填写",
      message: "同名飞书 profile 已存在，但无法确认 App ID。",
      errors: [error("profile-save-failed", "同名飞书 profile 已存在，但无法确认 App ID。", "为避免覆盖错公司/个人账号，请换一个 profile 名称；如果要使用已有 profile，请直接选择后测试连接。")]
    };
  }
  if (existingProfile?.appId && existingProfile.appId !== appId) {
    return {
      checkedAt,
      ok: false,
      profile,
      appIdMasked: maskAppId(appId) ?? "未填写",
      message: "同名飞书 profile 已存在，但 App ID 不一致。",
      errors: [error("profile-save-failed", "同名飞书 profile 已存在，但 App ID 不一致。", "请换一个 profile 名称，或选择已有 profile 直接测试连接，避免覆盖错公司/个人账号。")]
    };
  }

  const result = await runCliExecutableWithInput(executable, ["profile", "add", "--name", profile, "--app-id", appId, "--brand", "feishu", "--app-secret-stdin"], `${appSecret}\n`);
  if (!result.ok) {
    const kind = result.errorCode === "TIMEOUT" ? "timeout" : "execution";
    const copy = externalConnectorUserError("Feishu/Lark CLI", kind);
    return {
      checkedAt,
      ok: false,
      profile,
      appIdMasked: maskAppId(appId) ?? "未填写",
      message: copy.reason,
      errors: [error("profile-save-failed", copy.reason, copy.suggestion)]
    };
  }

  return {
    checkedAt: nowIso(),
    ok: true,
    profile,
    appIdMasked: maskAppId(appId) ?? "未填写",
    message: "飞书 CLI profile 已写入，可继续测试连接。",
    errors: []
  };
}

export class FakeFeishuCliConnector implements FeishuCliConnector {
  async verify(input: FeishuCliConnectorInput, _options?: FeishuCliVerifyOptions): Promise<FeishuVerificationReport> {
    const checkedAt = nowIso();
    const key = `${input.cliPath} ${input.profile}`.toLowerCase();
    const steps: FeishuVerificationStep[] = [];
    const errors: FeishuVerificationError[] = [];
    const cli = cliInfo(input);

    if (key.includes("missing-cli")) {
      steps.push(step("cli", "CLI 检测", "failed", "未检测到可执行的飞书 CLI。", checkedAt));
      steps.push(step("profile", "Profile 检测", "skipped", "CLI 未通过检测，未检查 profile。", checkedAt));
      steps.push(step("auth", "登录状态", "skipped", "CLI 未通过检测，未检查登录状态。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "CLI 未通过检测，未检查文档权限。", checkedAt));
      errors.push(error("cli-missing", "未检测到飞书 CLI。", "请安装 lark-cli，或在配置中心执行自动安装。"));
      return buildReport("fake", cli, steps, errors, checkedAt);
    }

    steps.push(step("cli", "CLI 检测", "passed", "飞书 CLI 可执行，基础环境检测通过。", checkedAt));
    steps.push(step("profile", "Profile 检测", "passed", "已找到可用 profile。", checkedAt));

    if (key.includes("not-logged-in")) {
      steps.push(step("auth", "登录状态", "failed", "当前 Profile 未完成登录验证。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "登录未通过，未检查文档权限。", checkedAt));
      errors.push(error("auth-failed", "飞书 CLI Profile 未登录。", "请完成飞书用户授权后，再回到配置中心验证。"));
      return buildReport("fake", cli, steps, errors, checkedAt);
    }

    steps.push(step("auth", "登录状态", "passed", "当前 Profile 已通过登录状态验证。", checkedAt));

    if (key.includes("missing-scope")) {
      steps.push(step("docs", "文档权限", "failed", "当前 Profile 缺少文档创建或写入权限。", checkedAt));
      errors.push(error("missing-scope", "飞书文档权限不足。", "请补齐飞书文档创建、文档写入相关权限。"));
      return buildReport("fake", cli, steps, errors, checkedAt);
    }

    steps.push(step("docs", "文档权限", "passed", "未发现缺失文档权限；本阶段不创建真实文档。", checkedAt));
    return buildReport("fake", cli, steps, errors, checkedAt);
  }
}

export class RealFeishuCliConnector implements FeishuCliConnector {
  async verify(input: FeishuCliConnectorInput, options?: FeishuCliVerifyOptions): Promise<FeishuVerificationReport> {
    const checkedAt = nowIso();
    const steps: FeishuVerificationStep[] = [];
    const errors: FeishuVerificationError[] = [];
    const discovery = await discoverInternal();
    const executable = await resolveExecutableForInput(input.cliPath, discovery);

    if (!discovery.installed || !executable) {
      const copy = externalConnectorUserError("Feishu/Lark CLI", "missing");
      steps.push(step("cli", "CLI 检测", "failed", "未检测到 lark-cli。", checkedAt));
      steps.push(step("profile", "Profile 检测", "skipped", "CLI 未通过检测，未检查 profile。", checkedAt));
      steps.push(step("auth", "登录状态", "skipped", "CLI 未通过检测，未检查登录状态。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "CLI 未通过检测，未检查文档权限。", checkedAt));
      errors.push(error("cli-missing", copy.reason, copy.suggestion));
      return buildReport("cli", cliInfo(input, discovery), steps, errors, checkedAt);
    }

    const version = await runCliExecutable(executable, ["--version"]);
    if (!version.ok) {
      steps.push(step("cli", "CLI 检测", "failed", "飞书 CLI 无法执行版本检查。", checkedAt));
      steps.push(step("profile", "Profile 检测", "skipped", "CLI 检测未通过，未检查 profile。", checkedAt));
      steps.push(step("auth", "登录状态", "skipped", "CLI 检测未通过，未检查登录状态。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "CLI 检测未通过，未检查文档权限。", checkedAt));
      const code = commandLooksMissing(version.errorCode) ? "cli-missing" : "doctor-failed";
      errors.push(error(code, code === "cli-missing" ? "未检测到飞书 CLI。" : "飞书 CLI 无法正常执行。", "请确认 lark-cli 已安装，并能在终端运行 lark-cli --version。"));
      return buildReport("cli", cliInfo(input, discovery), steps, errors, checkedAt);
    }

    const selectedProfile = chooseProfile(input.profile, discovery.profiles);
    const cli = cliInfo({ ...input, profile: selectedProfile?.name ?? input.profile }, discovery, selectedProfile);
    steps.push(step("cli", "CLI 检测", "passed", `已检测到 ${path.basename(executable.executablePath)}${discovery.version ? `，版本 ${discovery.version}` : ""}。`, checkedAt));

    if (!selectedProfile) {
      const configuredProfile = input.profile.trim();
      const profileDetail = configuredProfile
        ? "项目配置的 profile 不在本机 lark-cli profile 列表中。"
        : discovery.profiles.length > 1
          ? `本机检测到 ${discovery.profiles.length} 个飞书 profile，请先明确选择公司或个人账号。`
          : "未检测到可用飞书 profile。";
      steps.push(step("profile", "Profile 检测", "failed", profileDetail, checkedAt));
      steps.push(step("auth", "登录状态", "skipped", "缺少 profile，未检查登录状态。", checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "缺少 profile，未检查文档权限。", checkedAt));
      errors.push(error("profile-missing", "未选择可用飞书 profile。", configuredProfile ? "请在配置中心重新选择本机已存在的 profile，或用 App ID/App Secret 写入新的 profile。" : "请在配置中心选择公司或个人飞书 profile；如果没有目标 profile，请填写 App ID/App Secret 后写入。"));
      return buildReport("cli", cli, steps, errors, checkedAt);
    }

    const autoSelected = input.profile.trim()
      ? `已选择 profile ${selectedProfile.name}。`
      : `本机只有一个 profile，已自动使用 ${selectedProfile.name}。`;
    steps.push(step("profile", "Profile 检测", "passed", selectedProfile.user ? `${autoSelected} 用户：${selectedProfile.user}。` : autoSelected, checkedAt));

    let authAction: FeishuAuthAction | undefined;
    let auth = await runCliExecutable(executable, ["auth", "status", "--verify", "--profile", selectedProfile.name]);
    let authData = safeJsonParse(auth.output);
    let userReady = userIdentityReady(authData);
    if (!auth.ok || !userReady.ok) {
      authAction = await startUserConsent(executable, selectedProfile.name, options);
      if (authAction.status === "completed") {
        auth = await runCliExecutable(executable, ["auth", "status", "--verify", "--profile", selectedProfile.name]);
        authData = safeJsonParse(auth.output);
        userReady = userIdentityReady(authData);
      }
    }

    if (!auth.ok || !userReady.ok) {
      const copy = externalConnectorUserError("Feishu/Lark CLI", "authentication");
      const authDetail = authAction ? `${userReady.detail} ${authAction.message}` : userReady.detail;
      steps.push(step("auth", "登录状态", "failed", authDetail, checkedAt));
      steps.push(step("docs", "文档权限", "skipped", "用户授权未通过，未检查文档权限。", checkedAt));
      errors.push(error("auth-failed", copy.reason, authAction?.status === "opened"
        ? "已自动打开飞书授权页。请在浏览器中确认授权；授权完成后回到这里再次点击测试连接。"
        : copy.suggestion));
      return buildReport("cli", cli, steps, errors, checkedAt, authAction);
    }

    steps.push(step("auth", "登录状态", "passed", authAction?.status === "completed" ? `${userReady.detail} ${authAction.message}` : userReady.detail, checkedAt));

    const docs = await runCliExecutable(executable, ["auth", "check", "--scope", REQUIRED_DOC_SCOPES, "--profile", selectedProfile.name]);
    const docsData = safeJsonParse(docs.output) as { ok?: unknown; missing?: unknown } | null;
    const missing = Array.isArray(docsData?.missing) ? docsData.missing.map(String) : [];
    if (!docs.ok || docsData?.ok !== true || missing.length > 0 || looksLikeMissingScope(docs.output)) {
      const copy = externalConnectorUserError("Feishu/Lark CLI", "permission");
      steps.push(step("docs", "文档权限", "failed", "Feishu/Lark 文档权限检查未通过。", checkedAt));
      errors.push(error("missing-scope", copy.reason, copy.suggestion));
      return buildReport("cli", cli, steps, errors, checkedAt, authAction);
    }

    steps.push(step("docs", "文档权限", "passed", "已具备基础文档读取、创建和写入权限；本次验证不创建真实文档。", checkedAt));
    return buildReport("cli", cli, steps, errors, checkedAt, authAction);
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
    step("profile", "Profile 检测", "skipped", "CLI 配置未通过，未检查 profile。", checkedAt),
    step("auth", "登录状态", "skipped", "CLI 配置未通过，未检查登录状态。", checkedAt),
    step("docs", "文档权限", "skipped", "CLI 配置未通过，未检查文档权限。", checkedAt)
  ];
  return buildReport("fake", cliInfo(input), steps, [error(code, message, suggestion)], checkedAt);
}
