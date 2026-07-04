import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase25-case-file-knowledge-status-clarity-probe";
const PHASE25_MARKER = "phase25-case-file-knowledge-status-clarity";

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
  knowledge: "apps/desktop/src/renderer/KnowledgeCenter.tsx",
  styles: "apps/desktop/src/renderer/styles.css",
  workspaceStore: "apps/desktop/src/main/workspaceStore.ts",
  search: "apps/desktop/src/main/searchService.ts",
  main: "apps/desktop/src/main/main.ts",
  preload: "apps/desktop/src/preload/preload.ts",
  preflight: "scripts/security-preflight.ps1"
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(sourceFiles).map(async ([key, file]) => [key, await readSource(file)]))
);

for (const [name, marker, source] of [
  ["phase marker", PHASE25_MARKER, sources.app],
  ["case file purpose label", "caseFilePurposeLabel", sources.app],
  ["case file purpose tone", "caseFilePurposeTone", sources.app],
  ["file purpose legend", "file-purpose-legend", sources.app + sources.styles],
  ["deliverable label", "交付物", sources.app],
  ["pending knowledge label", "待确认知识", sources.app],
  ["technical evidence label", "技术证据/过程材料", sources.app],
  ["safe preview subtitle", "filePreviewSubtitle", sources.app],
  ["local feishu draft label", "生成飞书本地草稿", sources.app],
  ["knowledge source helper", "knowledgeSourceLabel", sources.knowledge],
  ["knowledge reuse helper", "knowledgeReuseLabel", sources.knowledge],
  ["candidate source label", "候选来源", sources.knowledge],
  ["formal knowledge label", "正式知识", sources.knowledge],
  ["reusable after publish label", "发布后可复用", sources.knowledge],
  ["internal case tree filter", "isInternalCaseTreeEntry", sources.workspaceStore],
  ["internal case tree skip", "if (isInternalCaseTreeEntry(relativePath, kind)) continue", sources.workspaceStore],
  ["safe file purpose search label", "safeFilePurposeLabel", sources.search],
  ["probe marker", PROBE_MARKER, sources.preflight]
]) {
  assert(source.includes(marker), `missing ${name}: ${marker}`);
}
pass("phase25VisibleStatusMarkers");

const mainIpcHandlers = [...sources.main.matchAll(/ipcMain\.handle\("workbench:/g)].length;
const preloadIpcInvokes = [...sources.preload.matchAll(/ipcRenderer\.invoke\("workbench:/g)].length;
assert(mainIpcHandlers > 0, "expected existing workbench IPC handlers");
assert(preloadIpcInvokes > 0, "expected existing preload workbench invokes");
assert(!sources.main.includes("workbench:phase25"), "phase25 must not add a main-process IPC channel");
assert(!sources.preload.includes("workbench:phase25"), "phase25 must not add a preload IPC channel");
assert(!sources.app.includes("workbench:phase25"), "phase25 must not add a renderer IPC channel");
assert(!sources.knowledge.includes("workbench:phase25"), "phase25 must not add a knowledge IPC channel");
pass("phase25AddsNoIpcChannel");

const rendererSource = [sources.app, sources.knowledge].join("\n");
for (const forbidden of [
  "readFile(",
  "showOpenDialog",
  "dialog.show",
  "openExternal",
  "openPath",
  "fetch(",
  "execFile(",
  "spawn(",
  "loadURL",
  "feishu-sync",
  "knowledge-publish-auto",
  "sap-write",
  "transport-release"
]) {
  assert(!rendererSource.includes(forbidden), `renderer contains forbidden capability marker: ${forbidden}`);
}
pass("phase25RendererAddsNoUnsafeCapabilities");

assert(!sources.app.includes("filePreview?.relativePath"), "file preview must not display internal relative paths");
assert(!sources.app.includes("title={node.relativePath}"), "file rows must not expose internal relative paths in title text");
assert(!sources.app.includes("node.relativePath.toLowerCase()"), "file panel search must not match hidden relative paths");
assert(!sources.app.includes("response.data.generatedFiles.join"), "renderer notices must not display generated relative paths");
assert(!sources.app.includes("result.sourcePath"), "renderer search results must not consume hidden source paths");
assert(!sources.knowledge.includes("selectedItem.sourceFilePath ?? sourceTypeLabels"), "knowledge detail must not display sourceFilePath directly");
assert(!sources.knowledge.includes('item.sourceFilePath ?? "",'), "knowledge search must not match hidden sourceFilePath");
assert(!sources.search.includes("来源文件 ${item.sourceFilePath}"), "search location must not display knowledge sourceFilePath");
assert(!sources.search.includes("location: node.relativePath"), "search location must not display file relativePath");
assert(!sources.search.includes("node.relativePath.toLowerCase()"), "search must not match hidden file relative paths");
assert(!sources.search.includes("sourcePath: node.relativePath"), "search results must not return file relative paths");
assert(!sources.search.includes("sourcePath: summary.relativePath"), "safe summary search results must not return file relative paths");
assert(sources.workspaceStore.includes('INTERNAL_CASE_TREE_FILENAMES = new Set(["messages.json", "metadata.json", "project.json", "app-state.json"])'), "internal case tree file set is missing");
assert(sources.workspaceStore.includes("INTERNAL_CASE_TREE_PATH_NAMES"), "internal case tree path set is missing");
pass("phase25HidesInternalPathsAndStateFiles");

const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase25-status-clarity-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
}

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
const state = await store.createLocalProject({ name: "Phase25 Client", sapVersion: "S4", systemLabel: "LOCAL/025" });
const project = state.projects.find((item) => item.id === state.activeProjectId);
const caseItem = project.cases.find((item) => item.id === state.activeCaseId);
const caseRoot = path.join(${JSON.stringify(isolatedRepoRoot)}, "local-data", "workbench", "projects", project.projectDir, "cases", caseItem.folderName);
await mkdir(path.join(caseRoot, "credentials"), { recursive: true });
await writeFile(path.join(caseRoot, "credentials", "token.txt"), "secret-token", "utf8");
await mkdir(path.join(caseRoot, ".sap-adt-cli"), { recursive: true });
await writeFile(path.join(caseRoot, ".sap-adt-cli", "config.json"), "{}", "utf8");
const files = await store.getCaseFiles();
const flattened = flatten(files);
assert(flattened.some((node) => node.relativePath === "README.md"), "case summary should remain visible");
assert(flattened.some((node) => node.relativePath === "conversation.md"), "case conversation should remain visible");
assert(!flattened.some((node) => node.relativePath === "metadata.json"), "metadata.json must not appear in case file tree");
assert(!flattened.some((node) => node.relativePath === "messages.json"), "messages.json must not appear in case file tree");
assert(!flattened.some((node) => node.relativePath.startsWith("credentials")), "credentials directory must not appear in case file tree");
assert(!flattened.some((node) => node.relativePath.startsWith(".sap-adt-cli")), ".sap-adt-cli directory must not appear in case file tree");
assert(!JSON.stringify(files).includes("metadata.json"), "metadata.json leaked through nested file tree data");
assert(!JSON.stringify(files).includes("messages.json"), "messages.json leaked through nested file tree data");
assert(!JSON.stringify(files).includes("credentials"), "credentials directory leaked through nested file tree data");
assert(!JSON.stringify(files).includes(".sap-adt-cli"), ".sap-adt-cli directory leaked through nested file tree data");
pass("runtimeCaseFileTreeHidesInternalStateFiles");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase25-runtime-probe-entry.ts",
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
  await rm(tempRoot, { recursive: true, force: true });
}

for (const marker of [
  "previewCurrentCaseFile",
  "knowledge-import-text-file",
  "knowledge-publish"
]) {
  assert(sources.app.includes(marker) || sources.knowledge.includes(marker) || sources.preload.includes(marker), `expected existing marker missing: ${marker}`);
}
pass("existingFileAndKnowledgeFlowsRemainExplicit");
