import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, readdir, rm as removeTree, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

const [main, preload, renderer, storeSource, transferSource] = await Promise.all([
  readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/preload/preload.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceTransferService.ts"), "utf8")
]);

for (const [label, marker, source] of [
  ["native folder IPC", 'workbench:select-local-task-folder', main],
  ["native open-directory dialog", 'properties: ["openDirectory"]', main],
  ["one-time selection token", "pendingLocalFolderSelections", main],
  ["preload bridge", "selectLocalTaskFolder", preload],
  ["renderer native picker", "选择电脑文件夹", renderer],
  ["main-owned binding registry", "local-folder-bindings.json", storeSource],
  ["folder safety inspection", "inspectLocalTaskFolder", storeSource]
]) {
  assert(source.includes(marker), `missing ${label}: ${marker}`);
}
assert(!renderer.includes('aria-label="已有工作文件夹"'), "renderer still binds tasks through the internal case dropdown");
assert(!transferSource.includes('"local-folder-bindings.json"'), "machine-local folder paths must not enter portable workspace backup/import");
pass("phase49StaticBoundary");

const probeOutputRoot = path.join(repoRoot, "output");
await mkdir(probeOutputRoot, { recursive: true });
const tempRoot = await mkdtemp(path.join(probeOutputRoot, "phase49-local-folder-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const selectedFolder = path.join(tempRoot, "existing-business-folder");
await mkdir(selectedFolder, { recursive: true });
await writeFile(path.join(selectedFolder, "sentinel.txt"), "do-not-touch", "utf8");

const entrySource = `
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
import fs from "node:fs/promises";
import path from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(task, marker) {
  try {
    await task();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(marker), "unexpected rejection: " + (error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error("expected rejection containing: " + marker);
}

const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const selectedFolder = ${JSON.stringify(selectedFolder)};
const store = new WorkspaceStore(isolatedRepoRoot);
const projectState = await store.createLocalProject({ name: "Phase49 Project", sapVersion: "S4", systemLabel: "LOCAL/049" });
const projectId = projectState.activeProjectId;
const inspected = await store.inspectLocalTaskFolder(selectedFolder);
assert(inspected.folderName === "existing-business-folder", "selected folder display name mismatch");

const state = await store.createWorkThread({
  projectId,
  title: "绑定已有电脑文件夹",
  folderMode: "existing",
  folderSelectionToken: "phase49-selection"
}, inspected);
const project = state.projects.find((item) => item.id === projectId);
const caseItem = project?.cases.find((item) => item.folderSource === "linked-local");
assert(caseItem, "linked local folder case missing");
assert(caseItem.linkedFolderName === "existing-business-folder", "linked folder name was not persisted safely");
assert(state.activeCaseId === caseItem.id, "linked local folder case did not become active");

const workspaceRoot = store.getWorkspaceRoot();
const appState = await fs.readFile(path.join(workspaceRoot, "app-state.json"), "utf8");
assert(!appState.includes(selectedFolder), "absolute selected folder path leaked into renderer-visible app state");
const registry = JSON.parse(await fs.readFile(path.join(workspaceRoot, "local-folder-bindings.json"), "utf8"));
const binding = registry.bindings.find((item) => item.projectId === projectId && item.caseId === caseItem.id);
assert(binding?.folderPath === inspected.folderPath, "main-owned local folder binding was not persisted");

const reusedState = await store.createWorkThread({
  projectId,
  title: "复用同一电脑文件夹",
  folderMode: "existing",
  folderSelectionToken: "phase49-selection-2"
}, inspected);
const linkedCases = reusedState.projects.find((item) => item.id === projectId)?.cases.filter((item) => item.folderSource === "linked-local") ?? [];
assert(linkedCases.length === 1, "selecting the same local folder created a duplicate Case binding");
assert(reusedState.workThreads.filter((item) => item.caseId === caseItem.id).length === 2, "same local folder did not reuse the Case across task threads");

const selectedEntries = await fs.readdir(selectedFolder);
assert(JSON.stringify(selectedEntries) === JSON.stringify(["sentinel.txt"]), "selected business folder was modified during binding");
assert(await fs.readFile(path.join(selectedFolder, "sentinel.txt"), "utf8") === "do-not-touch", "selected business file was modified during binding");
await rejects(() => store.inspectLocalTaskFolder(path.parse(selectedFolder).root), "磁盘根目录");
await rejects(() => store.inspectLocalTaskFolder(workspaceRoot), "工作台自身目录");
process.stdout.write("phase49RuntimeLocalFolderBinding=ok\\n");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase49-probe-entry.ts",
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
