import { build } from "esbuild";
import { mkdtemp, readFile, rm as removeTree, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase26-project-visible-list-removal-probe";

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

async function readSource(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const sourceFiles = {
  types: "apps/desktop/src/shared/workbenchTypes.ts",
  workspaceStore: "apps/desktop/src/main/workspaceStore.ts",
  main: "apps/desktop/src/main/main.ts",
  preload: "apps/desktop/src/preload/preload.ts",
  viteEnv: "apps/desktop/src/renderer/vite-env.d.ts",
  app: "apps/desktop/src/renderer/App.tsx",
  styles: "apps/desktop/src/renderer/styles.css",
  preflight: "scripts/security-preflight.ps1"
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(sourceFiles).map(async ([key, file]) => [key, await readSource(file)]))
);

for (const [name, marker, source] of [
  ["shared input type", "HideProjectFromSidebarInput", sources.types],
  ["store method", "hideProjectFromSidebar", sources.workspaceStore],
  ["store parser", "parseHideProjectFromSidebarInput", sources.workspaceStore],
  ["visibility normalization", "projectVisibilityFingerprint", sources.workspaceStore],
  ["main IPC", "workbench:hide-project-from-sidebar", sources.main],
  ["preload bridge", "hideProjectFromSidebar", sources.preload],
  ["renderer bridge type", "hideProjectFromSidebar", sources.viteEnv],
  ["visible project list", "visibleProjects", sources.app],
  ["visible filter", "item.isVisible !== false", sources.app],
  ["hidden project recovery", "查看并恢复已隐藏项目", sources.app],
  ["project actions style", "project-actions", sources.styles],
  ["preflight marker", PROBE_MARKER, sources.preflight]
]) {
  assert(source.includes(marker), `missing ${name}: ${marker}`);
}
pass("phase26Markers");

assert(!sources.main.includes("workbench:delete-project"), "must not add delete-project IPC");
assert(!sources.preload.includes("workbench:delete-project"), "must not expose delete-project bridge");
assert(!sources.app.includes("workbench:delete-project"), "renderer must not call delete-project");
assert(!sources.workspaceStore.includes("state.projects = state.projects.filter"), "must not remove projects from state with filter assignment");
assert(!sources.workspaceStore.includes(".projects.splice"), "must not splice projects out of state");
assert(!sources.workspaceStore.includes("shell.trashItem"), "must not move project files to trash");
const visibilityStoreBlock = sourceBlock(sources.workspaceStore, "async hideProjectFromSidebar", "async switchCase");
for (const forbidden of [
  "deleteProject",
  "removeProjectFiles",
  "sap-write",
  "transport-release",
  "activateObject",
  "feishu-sync",
  "knowledge-publish-auto"
]) {
  assert(![sources.workspaceStore, sources.main, sources.preload, sources.app].join("\n").includes(forbidden), `forbidden capability marker: ${forbidden}`);
}
for (const forbidden of [
  "openExternal",
  "openPath",
  "showOpenDialog",
  "execFile(",
  "spawn("
]) {
  assert(![sources.workspaceStore, sources.preload, sources.app].join("\n").includes(forbidden), `forbidden renderer/store capability marker: ${forbidden}`);
}
for (const forbidden of ["fs." + "rm", "fs.un" + "link", "shell.trashItem", "removeProjectFiles", "deleteProject"]) {
  assert(!visibilityStoreBlock.includes(forbidden), `project visibility must not delete files: ${forbidden}`);
}
pass("phase26AddsNoDeleteOrExternalCapability");

const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase26-visible-projects-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertExists(targetPath, message) {
  await stat(targetPath).catch(() => {
    throw new Error(message);
  });
}

async function assertRejects(name, fn) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  assert(rejected, name + " should reject");
  pass(name);
}

const repoRoot = ${JSON.stringify(isolatedRepoRoot)};
const store = new WorkspaceStore(repoRoot);
await store.createLocalProject({ name: "Phase26 Alpha", sapVersion: "S4", systemLabel: "LOCAL/026A" });
const betaState = await store.createLocalProject({ name: "Phase26 Beta", sapVersion: "ECC", systemLabel: "LOCAL/026B" });
const betaId = betaState.activeProjectId;
const betaProject = betaState.projects.find((item) => item.id === betaId);
const betaCase = betaProject.cases[0];
const betaProjectDir = path.join(repoRoot, "local-data", "workbench", "projects", betaProject.projectDir);
const betaCaseDir = path.join(betaProjectDir, "cases", betaCase.folderName);
await assertExists(betaProjectDir, "project directory should exist before hiding");
await assertExists(betaCaseDir, "case directory should exist before hiding");
await assertExists(path.join(betaProjectDir, "project.json"), "project metadata should exist before hiding");
await assertExists(path.join(betaProjectDir, "standards", "project-standards.json"), "standards should exist before hiding");
await assertExists(path.join(betaProjectDir, "knowledge", "project-knowledge.json"), "knowledge should exist before hiding");

const hiddenState = await store.hideProjectFromSidebar({ projectId: betaId });
const hiddenProject = hiddenState.projects.find((item) => item.id === betaId);
assert(hiddenProject, "hidden project remains in state.projects");
assert(hiddenProject.isVisible === false, "hidden project is marked invisible");
assert(hiddenState.activeProjectId !== betaId, "active project switches away from hidden project");
assert(hiddenState.projects.some((item) => item.id !== betaId && item.isVisible !== false), "another visible project remains");
await assertExists(betaProjectDir, "hidden project directory must remain");
await assertExists(betaCaseDir, "hidden case directory must remain");
await assertExists(path.join(betaProjectDir, "project.json"), "hidden project metadata must remain");
await assertExists(path.join(betaProjectDir, "standards", "project-standards.json"), "hidden standards must remain");
await assertExists(path.join(betaProjectDir, "knowledge", "project-knowledge.json"), "hidden knowledge must remain");
assert(hiddenState.activeCaseFiles.length > 0, "active case file tree remains available after switching");
pass("runtimeHideActiveProjectKeepsData");

await assertRejects("repeatHiddenProjectRejected", () => store.hideProjectFromSidebar({ projectId: betaId }));
await assertRejects("switchHiddenProjectRejected", () => store.switchProject({ projectId: betaId }));
await assertRejects("hideRejectsPathProjectId", () => store.hideProjectFromSidebar({ projectId: betaId + "/trick" }));
await assertRejects("hideRejectsExtraField", () => store.hideProjectFromSidebar({ projectId: hiddenState.activeProjectId, danger: true }));
const beforeLastVisibleState = await store.getState();
const extraVisibleProject = beforeLastVisibleState.projects.find((item) => item.id !== beforeLastVisibleState.activeProjectId && item.isVisible !== false);
assert(extraVisibleProject, "expected one extra visible project before final visibility check");
await store.hideProjectFromSidebar({ projectId: extraVisibleProject.id });
const lastVisibleState = await store.getState();
assert(lastVisibleState.projects.filter((item) => item.isVisible !== false).length === 1, "test setup should leave exactly one visible project");
await assertRejects("hideLastVisibleProjectRejected", () => store.hideProjectFromSidebar({ projectId: lastVisibleState.activeProjectId }));

const appStatePath = path.join(repoRoot, "local-data", "workbench", "app-state.json");
const persistedState = JSON.parse(await readFile(appStatePath, "utf8"));
persistedState.projects = persistedState.projects.map((item) => ({ ...item, isVisible: false }));
persistedState.activeProjectId = betaId;
await writeFile(appStatePath, JSON.stringify(persistedState, null, 2), "utf8");
const recoveredState = await new WorkspaceStore(repoRoot).getState();
const recoveredActiveProject = recoveredState.projects.find((item) => item.id === recoveredState.activeProjectId);
assert(recoveredState.projects.some((item) => item.isVisible !== false), "normalization restores at least one visible project");
assert(recoveredActiveProject?.isVisible !== false, "normalization switches active project to a visible project");
pass("runtimeAllHiddenStateRecoversVisibleProject");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase26-runtime-probe-entry.ts",
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

await stat(path.join(repoRoot, "docs", "superpowers", "plans", "2026-07-04-phase-26-project-visible-list-removal-plan.md"));
pass("phase26PlanExists");
