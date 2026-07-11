import { build } from "esbuild";
import { mkdtemp, readFile, rm as removeTree } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase38-case-action-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
import { parseCaseWorkflowInput } from "./apps/desktop/src/main/caseWorkflowService.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const PROBE_MARKER = "phase38-case-action-workflow";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function activeProject(state) {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function activeCase(state) {
  const project = activeProject(state);
  return project.cases.find((caseItem) => caseItem.id === state.activeCaseId);
}

function caseRoot(state) {
  const project = activeProject(state);
  const caseItem = activeCase(state);
  return path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
}

const parsed = parseCaseWorkflowInput({
  content: "请基于当前案件生成开发说明书。",
  taskMode: "document-generation",
  modelId: "local-workflow",
  actionId: "development-spec",
  permissionMode: "approve_for_me"
});
assert(parsed.actionId === "development-spec", "parser must preserve safe case action id");
assert(parsed.permissionMode === "approve_for_me", "parser must preserve safe permission mode");
pass("parseCaseActionInput");

const unsafeParsed = parseCaseWorkflowInput({
  content: "unsafe action should be normalized",
  taskMode: "document-generation",
  modelId: "local-workflow",
  actionId: "../../escape",
  permissionMode: "root"
});
assert(unsafeParsed.actionId === null, "unsafe action id must be dropped");
assert(unsafeParsed.permissionMode === "request_approval", "unsafe permission mode must fall back to request approval");
pass("unsafeCaseActionInputNormalized");

const store = new WorkspaceStore(isolatedRepoRoot);
let state = await store.createLocalProject({ name: "Phase38 SAP", sapVersion: "S4", systemLabel: "LOCAL/038" });
state = await store.appendMessage({
  content: "案件动作：生成开发说明书\\n执行偏好：低风险自动。请输出开发说明、范围和待确认事项。",
  taskMode: "document-generation",
  modelId: "local-workflow",
  actionId: "development-spec",
  permissionMode: "approve_for_me"
});
const project = activeProject(state);
const caseItem = activeCase(state);
assert(project && caseItem, "project or case missing after case action");
const assistantMessage = caseItem.messages.filter((message) => message.role === "assistant").at(-1);
const userMessage = caseItem.messages.filter((message) => message.role === "user").at(-1);
assert(userMessage?.actionId === "development-spec", "user message lost action id");
assert(userMessage?.permissionModeUsed === "approve_for_me", "user message lost permission mode");
assert(assistantMessage?.actionId === "development-spec", "assistant message lost action id");
assert(assistantMessage?.permissionModeUsed === "approve_for_me", "assistant message lost permission mode");
assert(assistantMessage?.content.includes("案件动作：生成开发说明书"), "assistant reply should mention the case action label");
pass("caseMessagesPersistActionContext");

const root = caseRoot(state);
const metadata = JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"));
assert(metadata.lastAction?.id === "development-spec", "metadata missing last action id");
assert(metadata.lastAction?.label === "生成开发说明书", "metadata missing last action label");
assert(metadata.lastPermissionMode === "approve_for_me", "metadata missing permission mode");
assert(metadata.actionPermissionMode === "approve_for_me", "metadata missing action permission alias");
assert(metadata.lastAction?.outputPath === "outputs/开发说明书.md", "metadata action output path must match the real deliverable");
assert(metadata.generatedFiles.some((file) => file.relativePath === "outputs/开发说明书.md"), "metadata missing development specification");
pass("metadataTracksCaseAction");

const conversation = await readFile(path.join(root, "conversation.md"), "utf8");
assert(conversation.includes("案件动作：生成开发说明书"), "conversation missing action label");
assert(conversation.includes("执行偏好：低风险自动"), "conversation missing execution preference label");
pass("conversationTracksCaseAction");

const timeline = await readFile(path.join(root, "timeline.md"), "utf8");
assert(timeline.includes("案件动作：生成开发说明书"), "timeline missing action label");
assert(timeline.includes("执行偏好：低风险自动"), "timeline missing execution preference label");
pass("timelineTracksCaseAction");

const developmentSpec = await readFile(path.join(root, "outputs", "开发说明书.md"), "utf8");
assert(developmentSpec.includes("执行偏好：低风险自动"), "development specification missing selected execution preference");
assert(!developmentSpec.includes("secure-store:"), "development specification leaked secret reference");

state = await store.appendMessage({
  content: "请把当前讨论整理成案件笔记和后续待办。",
  taskMode: "problem-analysis",
  modelId: "local-workflow",
  actionId: "capture-note",
  permissionMode: "request_approval"
});
const caseNote = await readFile(path.join(root, "outputs", "案件沉淀笔记.md"), "utf8");
assert(caseNote.includes("## 后续待办"), "capture-note must generate a dedicated case note");

state = await store.appendMessage({
  content: "请整理当前案件的本地交付物和交接状态。",
  taskMode: "document-generation",
  modelId: "local-workflow",
  actionId: "export-handoff",
  permissionMode: "request_approval"
});
const handoff = await readFile(path.join(root, "outputs", "交付物清单与交接说明.md"), "utf8");
assert(handoff.includes("## 交接状态"), "export-handoff must generate a dedicated handoff file");
pass("caseActionDeliverablesMatchLabels");

const reloadedState = await new WorkspaceStore(isolatedRepoRoot).getState();
const reloadedCase = activeCase(reloadedState);
const reloadedUserMessage = reloadedCase?.messages.find((message) => message.actionId === "development-spec");
assert(reloadedUserMessage?.permissionModeUsed === "approve_for_me", "reload lost action permission context");
pass("reloadPreservesCaseActionContext");

const appSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8");
assert(appSource.includes('actionId: selectedCaseAction.id'), "renderer must send selected action id");
assert(appSource.includes('permissionMode: actionPermissionMode'), "renderer must send selected permission mode");
pass("rendererSendsActionContext");

const preflight = await readFile(path.join(repoRoot, "scripts/security-preflight.ps1"), "utf8");
assert(preflight.includes(PROBE_MARKER), "security preflight must track phase38 marker");
pass("preflightTracksPhase38");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase38-probe-entry.ts",
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
  log("phase38-case-action-workflow-probe=ok");
} finally {
  await removeTree(tempRoot, { recursive: true, force: true });
}
