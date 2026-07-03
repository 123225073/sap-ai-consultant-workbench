import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase17-boundary-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const PROBE_MARKER = "phase17-renderer-trust-filetree-probe";

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedRendererUrl } from "./apps/desktop/src/main/trustedRenderer.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const PROBE_MARKER = ${JSON.stringify(PROBE_MARKER)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(name, promiseFactory) {
  let rejected = false;
  try {
    await promiseFactory();
  } catch {
    rejected = true;
  }
  assert(rejected, name + " did not reject");
  pass(name);
}

function activeProject(state) {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function activeCase(project, state) {
  return project.cases.find((caseItem) => caseItem.id === state.activeCaseId);
}

function caseRoot(project, caseItem) {
  return path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
}

function flatten(nodes) {
  return nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
}

const appRoot = path.join(isolatedRepoRoot, "apps", "desktop");
const trustedPackagedUrl = pathToFileURL(path.join(appRoot, "dist", "renderer", "index.html")).href;
const outsideFileUrl = pathToFileURL(path.join(appRoot, "dist", "preload", "preload.cjs")).href;
assert(isTrustedRendererUrl(trustedPackagedUrl, appRoot), "packaged renderer should be trusted");
assert(!isTrustedRendererUrl(outsideFileUrl, appRoot), "file outside renderer root should be blocked");
assert(isTrustedRendererUrl("http://127.0.0.1:5173/src/main.ts", appRoot, "http://127.0.0.1:5173"), "matching loopback dev origin should be trusted");
assert(isTrustedRendererUrl("http://localhost:5173/", appRoot, "http://localhost:5173"), "localhost dev origin should be trusted");
assert(!isTrustedRendererUrl("http://127.0.0.1:5174/", appRoot, "http://127.0.0.1:5173"), "wrong dev port should be blocked");
assert(!isTrustedRendererUrl("https://example.com", appRoot, "http://127.0.0.1:5173"), "external https should be blocked");
assert(!isTrustedRendererUrl("http://example.com", appRoot, "http://127.0.0.1:5173"), "external http should be blocked");
assert(!isTrustedRendererUrl("not a url", appRoot, "http://127.0.0.1:5173"), "malformed URL should be blocked");
pass("trustedRendererUrlDecisions");

const mainSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8");
const ipcLines = mainSource.split(/\\r?\\n/).filter((line) => line.includes('ipcMain.handle("workbench:'));
assert(ipcLines.length >= 20, "expected existing workbench IPC handlers");
assert(ipcLines.every((line) => line.includes("trustedResponse")), "every workbench IPC must use trustedResponse");
for (const marker of ["assertTrustedRendererEvent", "trustedResponse", "setWindowOpenHandler", "will-navigate", "isTrustedRendererUrl"]) {
  assert(mainSource.includes(marker), "missing trusted renderer marker: " + marker);
}
pass("allIpcHandlersUseTrustedResponse");

const workspaceSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8");
for (const marker of ["assertRealPathInside", "ensurePlainDirectory", "safeCaseRootForAccess", "fs.lstat(absolutePath)", "stats.isSymbolicLink()", "readDirectory(caseRoot"]) {
  assert(workspaceSource.includes(marker), "missing file tree boundary marker: " + marker);
}
assert(workspaceSource.includes(PROBE_MARKER) === false, "probe marker should not be hardcoded in app source");
pass("fileTreeBoundaryMarkers");

const store = new WorkspaceStore(isolatedRepoRoot);
const state = await store.createLocalProject({ name: "Phase17 Client", sapVersion: "S4", systemLabel: "LOCAL/017" });
const project = activeProject(state);
const caseItem = activeCase(project, state);
assert(project && caseItem, "project or case missing");
const root = caseRoot(project, caseItem);
await mkdir(path.join(root, "outputs"), { recursive: true });
await writeFile(path.join(root, "outputs", "phase17-safe-note.md"), "Phase 17 safe local file.", "utf8");

const outsideRoot = path.join(isolatedRepoRoot, "outside-case-files");
await mkdir(outsideRoot, { recursive: true });
await writeFile(path.join(outsideRoot, "outside-secret.md"), "outside case metadata must not appear", "utf8");
const linkPath = path.join(root, "linked-outside");
await rm(linkPath, { recursive: true, force: true });
await symlink(outsideRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
await stat(linkPath);

const files = await store.getCaseFiles();
const flattened = flatten(files);
assert(flattened.some((node) => node.relativePath === "outputs/phase17-safe-note.md"), "safe local output file should remain visible");
assert(!flattened.some((node) => node.relativePath.startsWith("linked-outside")), "symlink/junction entry should not appear in case file tree");
assert(!JSON.stringify(files).includes("outside-secret.md"), "outside target metadata leaked into file tree");
pass("caseFileTreeSkipsSymlink");

await assertRejects("previewRejectsSymlinkPath", () => store.previewCurrentCaseFile({ relativePath: "linked-outside/outside-secret.md" }));

const symlinkCaseState = await store.createLocalCase({ projectId: project.id, title: "Root symlink rejection" });
const symlinkProject = activeProject(symlinkCaseState);
const symlinkCase = activeCase(symlinkProject, symlinkCaseState);
const symlinkCaseRoot = caseRoot(symlinkProject, symlinkCase);
await rm(symlinkCaseRoot, { recursive: true, force: true });
await symlink(outsideRoot, symlinkCaseRoot, process.platform === "win32" ? "junction" : "dir");
await stat(symlinkCaseRoot);
await assertRejects("getCaseFilesRejectsCaseRootSymlink", () => store.getCaseFiles());
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase17-probe-entry.ts",
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
