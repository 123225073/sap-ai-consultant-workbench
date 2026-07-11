import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase33-codex-cli-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const runRealProbe = process.env.WORKBENCH_RUN_REAL_CODEX_PROBE === "1";

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCodexCliConnector } from "./apps/desktop/src/main/codexCliConnector.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const runRealProbe = ${JSON.stringify(runRealProbe)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const connectorSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/codexCliConnector.ts"), "utf8");
const mainSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8");
const preloadSource = await readFile(path.join(repoRoot, "apps/desktop/src/preload/preload.ts"), "utf8");
const rendererTypes = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/vite-env.d.ts"), "utf8");
const configCenterSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/ConfigCenter.tsx"), "utf8");
const sharedTypes = await readFile(path.join(repoRoot, "apps/desktop/src/shared/workbenchTypes.ts"), "utf8");
const securityPreflight = await readFile(path.join(repoRoot, "scripts/security-preflight.ps1"), "utf8");

assert(sharedTypes.includes("CodexVerificationReport"), "Codex verification report type is missing");
assert(sharedTypes.includes("CodexCapabilitySummary"), "Codex capability summary type is missing");
assert(connectorSource.includes("codexCommandFromName"), "Codex command allowlist marker is missing");
assert(connectorSource.includes("localCodexCandidates"), "Codex local discovery marker is missing");
assert(connectorSource.includes("sap-ai-codex-probe-"), "Codex readonly probe must use an empty temporary directory");
assert(connectorSource.includes("CODEX_PROBE_OK"), "Codex readonly probe marker is missing");
assert(connectorSource.includes("\\\"--ephemeral\\\""), "Codex readonly probe must be ephemeral");
assert(connectorSource.includes("\\\"read-only\\\""), "Codex readonly probe must use read-only sandbox");
assert(connectorSource.includes("\\\"-a\\",\\n      \\\"never\\\""), "Codex readonly probe must use a fixed non-interactive approval mode");
assert(!/danger-full-access|workspace-write|dangerously-bypass|\\.codex[\\\\/]sessions|mcp-server|remote-control/.test(connectorSource), "Codex connector contains forbidden command or history markers");
pass("connectorSafetyMarkers");

assert(mainSource.includes("workbench:codex-verify-cli"), "Codex verify IPC is missing");
assert(mainSource.includes("validateCodexConfig"), "Codex config validation is missing");
assert(preloadSource.includes("verifyCodexCli"), "Codex preload bridge is missing");
assert(rendererTypes.includes("verifyCodexCli"), "Codex renderer bridge type is missing");
assert(configCenterSource.includes("不读取 Codex App 历史聊天"), "Codex no-history UI copy is missing");
assert(configCenterSource.includes("onVerifyCodex"), "Codex ConfigCenter callback is missing");
assert(securityPreflight.includes("Codex fixed CLI command scan"), "Codex security preflight scan is missing");
pass("uiAndIpcMarkers");

if (!runRealProbe) {
  pass("liveCodexProbeSkippedSetWORKBENCH_RUN_REAL_CODEX_PROBE");
} else {
  const report = await createCodexCliConnector().verify({
    integrationType: "cli",
    executablePath: "codex",
    workspaceRoot: repoRoot
  });
  assert(report.cli.executablePath && /codex/i.test(report.cli.executablePath), "live Codex probe must resolve a codex executable");
  assert(report.cli.version, "live Codex probe must return a version");
  assert(report.steps.some((item) => item.id === "cli" && item.status === "passed"), "live Codex CLI step must pass");
  assert(report.steps.some((item) => item.id === "login" && item.status === "passed"), "live Codex login step must pass");
  assert(report.steps.some((item) => item.id === "readonly-task" && item.status === "passed"), "live Codex readonly task step must pass");
  assert(report.ok === true, "live Codex verification report must pass");
  assert(report.capabilities.some((item) => item.id === "mcp"), "Codex capability summary should include MCP");
  assert(report.capabilities.some((item) => item.id === "plugins"), "Codex capability summary should include plugins");
  assert(report.capabilities.some((item) => item.id === "skills"), "Codex capability summary should include skills");
  pass("liveCodexReadonlyProbe");
}
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase33-probe-entry.ts",
      loader: "ts"
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
