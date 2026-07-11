import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  LocalAiCapability,
  LocalAiCapabilityId,
  LocalAiCapabilityPathLabel,
  LocalAiInstallInput,
  LocalAiInstallResult,
  LocalAiScanResult
} from "../shared/workbenchTypes";

const COMMAND_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 180_000;
const OUTPUT_LIMIT = 4_096;
const OFFICIAL_NPM_PACKAGE = "@openai/codex";
const OFFICIAL_NPM_INSTALL_ARGS = ["install", "-g", OFFICIAL_NPM_PACKAGE] as const;

interface CommandResult {
  ok: boolean;
  output: string;
  errorCode: string | number | null;
  timedOut: boolean;
}

interface FixedCommand {
  command: string;
  args: string[];
  pathLabel: LocalAiCapabilityPathLabel;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function runFixedCommand(command: string, args: readonly string[], timeout: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, [...args], {
      timeout,
      maxBuffer: OUTPUT_LIMIT,
      windowsHide: true,
      shell: false
    }, (executionError, stdout, stderr) => {
      const output = `${String(stdout ?? "")}\n${String(stderr ?? "")}`.slice(0, OUTPUT_LIMIT);
      const errorCode = executionError && (typeof executionError.code === "string" || typeof executionError.code === "number")
        ? executionError.code
        : null;
      resolve({
        ok: !executionError,
        output,
        errorCode,
        timedOut: Boolean(executionError && "killed" in executionError && executionError.killed)
      });
    });
  });
}

function versionFromOutput(output: string): string | null {
  const match = output.match(/(?:codex-cli|openai codex)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i);
  return match?.[1] ?? null;
}

function fixedNodeRoots(): string[] {
  if (process.platform !== "win32") return [];
  const home = os.homedir();
  return Array.from(new Set([
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs") : null,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"] as string, "nodejs") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "nodejs") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Volta", "bin") : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, "nvm") : null,
    home ? path.join(home, ".volta", "bin") : null,
    home ? path.join(home, "scoop", "apps", "nodejs", "current") : null,
    home ? path.join(home, "scoop", "apps", "nodejs-lts", "current") : null
  ].filter((value): value is string => Boolean(value))));
}

async function fixedCodexCommands(): Promise<FixedCommand[]> {
  const commands: FixedCommand[] = [];
  if (process.platform === "win32") {
    const npmRoots = Array.from(new Set([
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
      ...fixedNodeRoots()
    ].filter((value): value is string => Boolean(value))));
    for (const npmRoot of npmRoots) {
      const codexEntry = path.join(npmRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (!await fileExists(codexEntry)) continue;
      for (const nodeRoot of fixedNodeRoots()) {
        const nodeCommand = path.join(nodeRoot, "node.exe");
        if (await fileExists(nodeCommand)) {
          commands.push({ command: nodeCommand, args: [codexEntry, "--version"], pathLabel: "npm 全局安装目录" });
          break;
        }
      }
    }
    commands.push({ command: "codex.exe", args: ["--version"], pathLabel: "系统命令目录" });
  } else {
    commands.push(
      { command: "/usr/local/bin/codex", args: ["--version"], pathLabel: "系统命令目录" },
      { command: "/usr/bin/codex", args: ["--version"], pathLabel: "系统命令目录" },
      { command: "codex", args: ["--version"], pathLabel: "系统命令目录" }
    );
  }
  return commands;
}

async function scanCodexCli(): Promise<LocalAiCapability> {
  for (const candidate of await fixedCodexCommands()) {
    const result = await runFixedCommand(candidate.command, candidate.args, COMMAND_TIMEOUT_MS);
    const version = result.ok ? versionFromOutput(result.output) : null;
    if (version) {
      return {
        capabilityId: "codex-cli",
        label: "Codex CLI",
        installed: true,
        version,
        pathLabel: candidate.pathLabel
      };
    }
  }
  return {
    capabilityId: "codex-cli",
    label: "Codex CLI",
    installed: false,
    version: null,
    pathLabel: null
  };
}

export async function scanLocalAiCapabilities(): Promise<LocalAiScanResult> {
  const capability = await scanCodexCli();
  return {
    checkedAt: nowIso(),
    capabilities: [capability],
    message: capability.installed ? "已检测到 Codex CLI。" : "未检测到 Codex CLI；这不会影响工作台核心功能。"
  };
}

export function parseLocalAiInstallInput(input: unknown): LocalAiInstallInput {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || Object.keys(input).length !== 1
    || (input as { capabilityId?: unknown }).capabilityId !== "codex-cli"
  ) {
    throw new Error("本机 AI 安装请求无效；当前只允许安装 Codex CLI。");
  }
  return { capabilityId: "codex-cli" };
}

async function fixedNpmCommand(): Promise<FixedCommand | null> {
  if (process.platform !== "win32") {
    for (const command of ["/usr/local/bin/npm", "/usr/bin/npm", "npm"]) {
      if (!path.isAbsolute(command) || await fileExists(command)) {
        return { command, args: [...OFFICIAL_NPM_INSTALL_ARGS], pathLabel: "npm 全局安装目录" };
      }
    }
    return null;
  }
  for (const nodeRoot of fixedNodeRoots()) {
    const nodeCommand = path.join(nodeRoot, "node.exe");
    const npmCli = path.join(nodeRoot, "node_modules", "npm", "bin", "npm-cli.js");
    if (await fileExists(nodeCommand) && await fileExists(npmCli)) {
      return {
        command: nodeCommand,
        args: [npmCli, ...OFFICIAL_NPM_INSTALL_ARGS],
        pathLabel: "npm 全局安装目录"
      };
    }
  }
  return null;
}

function failedInstall(capabilityId: LocalAiCapabilityId, message: string): LocalAiInstallResult {
  return {
    checkedAt: nowIso(),
    capabilityId,
    status: "failed",
    installed: false,
    version: null,
    pathLabel: null,
    message
  };
}

export async function installLocalAiCapability(input: unknown): Promise<LocalAiInstallResult> {
  const { capabilityId } = parseLocalAiInstallInput(input);
  const npmCommand = await fixedNpmCommand();
  if (!npmCommand) {
    return failedInstall(capabilityId, "未检测到受支持的 Node.js/npm 固定安装目录，无法自动安装 Codex CLI。请先安装官方 Node.js。核心功能不受影响。");
  }
  const result = await runFixedCommand(npmCommand.command, npmCommand.args, INSTALL_TIMEOUT_MS);
  if (!result.ok) {
    if (result.timedOut) {
      return failedInstall(capabilityId, "Codex CLI 安装超时。请检查网络后重试；工作台核心功能不受影响。");
    }
    if (result.errorCode === "EACCES" || result.errorCode === "EPERM") {
      return failedInstall(capabilityId, "Codex CLI 安装失败：当前用户没有 npm 全局安装权限。请检查 Node.js/npm 权限后重试；工作台核心功能不受影响。");
    }
    return failedInstall(capabilityId, "Codex CLI 安装失败。请检查网络、Node.js/npm 状态和全局安装权限后重试；工作台核心功能不受影响。");
  }
  const scan = await scanLocalAiCapabilities();
  const capability = scan.capabilities[0];
  if (!capability?.installed) {
    return failedInstall(capabilityId, "安装命令已完成，但仍未检测到 Codex CLI。请重新打开应用后扫描；工作台核心功能不受影响。");
  }
  return {
    checkedAt: nowIso(),
    capabilityId,
    status: "installed",
    installed: true,
    version: capability.version,
    pathLabel: capability.pathLabel,
    message: "Codex CLI 已安装并检测到。"
  };
}
