import { build } from "esbuild";
import { mkdtemp, readFile, rm as removeTree } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase28-basic-new-case-flow-probe";

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readSource(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const sourceFiles = {
  app: "apps/desktop/src/renderer/App.tsx",
  styles: "apps/desktop/src/renderer/styles.css",
  main: "apps/desktop/src/main/main.ts",
  preload: "apps/desktop/src/preload/preload.ts",
  workspaceStore: "apps/desktop/src/main/workspaceStore.ts",
  preflight: "scripts/security-preflight.ps1"
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(sourceFiles).map(async ([key, file]) => [key, await readSource(file)]))
);

for (const [name, marker, source] of [
  ["creating state", "creatingCase", sources.app],
  ["new case input ref", "newCaseInputRef", sources.app],
  ["focus action", "focusNewCaseInput", sources.app],
  ["flow marker", "phase28-new-case-flow", sources.app],
  ["renderer bridge call", "bridge.createWorkThread", sources.app],
  ["task dialog", 'aria-label="新建任务"', sources.app],
  ["folder binding modes", "task-folder-mode", sources.app],
  ["existing folder binding", 'setNewTaskFolderMode("existing")', sources.app],
  ["active view switch", 'setActiveView("case")', sources.app],
  ["case action style", "case-create button:not(:disabled)", sources.styles],
  ["main IPC", "workbench:create-local-case", sources.main],
  ["preload bridge", "createLocalCase", sources.preload],
  ["store method", "createLocalCase(input", sources.workspaceStore],
  ["preflight marker", PROBE_MARKER, sources.preflight],
  ["probe self marker", PROBE_MARKER, await readSource("scripts/phase28-basic-new-case-flow-probe.mjs")]
]) {
  assert(source.includes(marker), `missing ${name}: ${marker}`);
}
pass("phase28Markers");

for (const forbiddenCopy of [
  "New case title",
  "Create case",
  "Case title is required.",
  "Create a case folder in the active project",
  "Local case created.",
  "输入案件名称",
  "创建案件"
]) {
  assert(!sources.app.includes(forbiddenCopy), `unfinished case UI copy found: ${forbiddenCopy}`);
}
pass("phase28NoPrototypeCaseCopy");

const rendererLifecycleSource = [sources.app, sources.preload].join("\n");
for (const forbidden of [
  "workbench:create-demo-case",
  "createDemoCase",
  "showOpenDialog",
  "openExternal",
  "openPath",
  "execFile(",
  "spawn(",
  "fetch(",
  "readFile(",
  "unlink",
  "rm("
]) {
  const found = forbidden === "rm("
    ? /(?:^|[^a-zA-Z0-9_])rm\(/.test(rendererLifecycleSource)
    : rendererLifecycleSource.includes(forbidden);
  assert(!found, `unsafe renderer lifecycle marker found: ${forbidden}`);
}
pass("phase28AddsNoUnsafeRendererCapability");

const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase28-new-case-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
const projectState = await store.createLocalProject({ name: "Phase28 Project", sapVersion: "S4", systemLabel: "LOCAL/028" });
const projectId = projectState.activeProjectId;
const taskState = await store.createWorkThread({ projectId, title: "Phase28 正式任务", folderMode: "new", folderName: "Phase28 工作文件夹" });
const project = taskState.projects.find((item) => item.id === projectId);
const caseItem = project?.cases.find((item) => item.title === "Phase28 工作文件夹");
const workThread = taskState.workThreads.find((item) => item.title === "Phase28 正式任务");
assert(project, "project missing after create case");
assert(caseItem, "created case missing");
assert(workThread, "created work thread missing");
assert(taskState.activeProjectId === projectId, "created task did not keep project active");
assert(taskState.activeCaseId === caseItem.id, "created task folder did not become active");
assert(taskState.activeWorkThreadId === workThread.id, "created task conversation did not become active");
assert(taskState.activeCaseFiles.some((node) => node.name === "README.md"), "new task file tree missing README");
assert(taskState.activeCaseFiles.some((node) => node.name === "conversation.md"), "new task file tree missing conversation");
pass("runtimeCreateTaskUsable");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase28-probe-entry.ts",
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
} finally {
  await removeTree(tempRoot, { recursive: true, force: true });
}
