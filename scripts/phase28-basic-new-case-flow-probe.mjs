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
  ["renderer bridge call", "bridge.createLocalCase", sources.app],
  ["Chinese placeholder", "输入工作文件夹名称", sources.app],
  ["Chinese action", "创建文件夹", sources.app],
  ["created notice", "新工作文件夹已创建", sources.app],
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
const caseState = await store.createLocalCase({ projectId, title: "Phase28 正式新案件" });
const project = caseState.projects.find((item) => item.id === projectId);
const caseItem = project?.cases.find((item) => item.title === "Phase28 正式新案件");
assert(project, "project missing after create case");
assert(caseItem, "created case missing");
assert(caseState.activeProjectId === projectId, "created case did not keep project active");
assert(caseState.activeCaseId === caseItem.id, "created case did not become active");
assert(caseState.activeCaseFiles.some((node) => node.name === "README.md"), "new case file tree missing README");
assert(caseState.activeCaseFiles.some((node) => node.name === "conversation.md"), "new case file tree missing conversation");
pass("runtimeCreateCaseUsable");
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
