import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());

function log(message) {
  process.stdout.write(`${message}\n`);
}

function pass(name) {
  log(`${name}=ok`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [
  sharedTypes,
  connectorSource,
  mainSource,
  workspaceStoreSource,
  caseWorkflowSource,
  preloadSource,
  rendererTypes,
  appSource,
  stylesSource,
  securityPreflight
] = await Promise.all([
  readFile(path.join(repoRoot, "apps/desktop/src/shared/workbenchTypes.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/codexCliConnector.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/caseWorkflowService.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/preload/preload.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/vite-env.d.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/styles.css"), "utf8"),
  readFile(path.join(repoRoot, "scripts/security-preflight.ps1"), "utf8")
]);

assert(sharedTypes.includes("codexAssistEnabled?: boolean"), "Case workflow input is missing the Codex assist flag");
assert(sharedTypes.includes("CodexCaseAssistContext"), "Codex case assist context type is missing");
assert(sharedTypes.includes("CodexCaseAssistRun"), "Codex case assist run type is missing");
pass("sharedTypes");

assert(connectorSource.includes("runCaseAssist"), "Codex connector is missing runCaseAssist");
assert(connectorSource.includes("sap-ai-codex-case-assist-"), "Codex case assist must run in an empty temporary directory");
assert(connectorSource.includes('"--ephemeral"'), "Codex case assist must use ephemeral execution");
assert(connectorSource.includes('"read-only"'), "Codex case assist must use read-only sandbox");
assert(connectorSource.includes('"--skip-git-repo-check"'), "Codex case assist must not require a git repo");
assert(connectorSource.includes('"never"'), "Codex case assist must use non-interactive approvals");
assert(connectorSource.includes("sanitizeCodexAssistOutput(result.stdout)"), "Codex case assist must persist sanitized stdout only");
assert(!/sanitizeCodexAssistOutput\(result\.(stderr|output)\)/.test(connectorSource), "Codex case assist must not save stderr or combined raw output");
assert(!/danger-full-access|workspace-write|dangerously-bypass|mcp-server|\.codex[\\/]sessions|resume|fork/.test(connectorSource), "Codex connector contains forbidden execution or history markers");
pass("connectorBoundary");

assert(workspaceStoreSource.includes("prepareCodexCaseAssistRequest"), "Workspace store must prepare bounded Codex context");
assert(workspaceStoreSource.includes('codexConfig.cliStatus !== "verified"'), "Codex case assist must require verified CLI status");
assert(workspaceStoreSource.includes('codexConfig.loginStatus !== "verified"'), "Codex case assist must require verified login");
assert(!workspaceStoreSource.includes('codexConfig.readonlyTaskStatus !== "verified"'), "optional Codex engineering probe must not block an installed and logged-in CLI");
assert(workspaceStoreSource.includes("standardsSummaryForTask(project.standards, workflowInput.taskMode)"), "Codex context should include task-relevant standards summary");
assert(!/prepareCodexCaseAssistRequest[\s\S]{0,2200}readCaseTree/.test(workspaceStoreSource), "Codex case assist must not read case files for prompt context");
pass("contextBoundary");

assert(mainSource.includes("wantsCodexCaseAssist"), "Main process must detect explicit Codex opt-in");
assert(mainSource.includes("runCaseAssist"), "Main process must run the controlled Codex assist method");
assert(mainSource.includes("store.appendMessage(targetedInput, modelDraft, codexAssist, agentTurnId)"), "Codex assist must be persisted through the immutable-target case workflow");
assert(!/workbench:codex-(case|assist|exec|run|shell|history|session)/.test(mainSource + preloadSource + rendererTypes), "Codex case assist must not expose a generic Codex IPC channel");
pass("ipcBoundary");

assert(caseWorkflowSource.includes("CODEX_ASSIST_BOUNDARY"), "Case workflow must record the Codex assist boundary");
assert(caseWorkflowSource.includes("renderCodexCaseAssistFiles"), "Case workflow must write visible Codex assist files");
assert(caseWorkflowSource.includes("Codex工程辅助分析-"), "Successful Codex assist output file marker is missing");
assert(caseWorkflowSource.includes("Codex工程辅助失败说明-"), "Failed Codex assist output file marker is missing");
assert(caseWorkflowSource.includes("failed-no-raw-output-saved"), "Failed Codex assist metadata must avoid raw output");
pass("caseArtifacts");

assert(appSource.includes("codexAssistAvailable"), "Renderer must gate Codex assist by verified status");
assert(appSource.includes("codex-assist-toggle"), "Renderer Codex assist toggle is missing");
assert(appSource.includes("codexAssistEnabled && codexAssistAvailable"), "Renderer must only send Codex flag when available");
assert(stylesSource.includes(".codex-assist-toggle"), "Codex assist toggle styles are missing");
pass("rendererUx");

assert(securityPreflight.includes("Codex case assist safety scan"), "Security preflight is missing the Codex case assist scan");
assert(securityPreflight.includes("phase34-codex-case-assist-probe"), "Security preflight must reference this phase probe");
pass("securityPreflight");
