import { build } from "esbuild";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase15-lifecycle-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore, parseCreateLocalCaseInput, parseCreateLocalProjectInput } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const legacyRepoRoot = path.join(${JSON.stringify(tempRoot)}, "legacy-repo");

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(name, fn) {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  assert(thrown, name + " did not throw");
  pass(name);
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

function caseRoot(project, caseItem) {
  return path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
}

function expectedCasesDir(project, caseItem) {
  return "local-data/workbench/projects/" + project.projectDir + "/cases/" + caseItem.folderName;
}

async function listTmpFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await listTmpFiles(fullPath));
    } else if (entry.name.endsWith(".tmp")) {
      matches.push(fullPath);
    }
  }
  return matches;
}

parseCreateLocalProjectInput({ name: "Client Alpha", sapVersion: "S4", systemLabel: "PRD/800" });
parseCreateLocalCaseInput({ title: "Pricing issue" });
pass("parseSafeInputs");

assertThrows("parseBlocksProjectPath", () => parseCreateLocalProjectInput({ name: "../escape", sapVersion: "S4", systemLabel: "PRD/800" }));
assertThrows("parseBlocksSecretText", () => parseCreateLocalCaseInput({ title: "password=abcdefghi" }));
assertThrows("parseBlocksExtraField", () => parseCreateLocalProjectInput({ name: "Alpha", sapVersion: "S4", systemLabel: "PRD/800", path: "../escape" }));
assertThrows("parseBlocksUnknownSapVersion", () => parseCreateLocalProjectInput({ name: "Alpha", sapVersion: "UNKNOWN", systemLabel: "PRD/800" }));

const store = new WorkspaceStore(isolatedRepoRoot);
const alphaState = await store.createLocalProject({ name: "Client Alpha", sapVersion: "S4", systemLabel: "PRD/800" });
const alpha = alphaState.projects.find((project) => project.name === "Client Alpha");
assert(alpha, "alpha project missing");
assert(alpha.id !== "demo-s4hana", "real project reused demo id");
assert(alpha.connectionState === "not-configured", "real project should start not configured");
assert(alpha.config.adt.url === "", "real project inherited demo ADT URL");
assert(alpha.config.adt.username === "", "real project inherited demo ADT username");
assert(alpha.config.adt.configStatus === "not-configured", "real project ADT config should be clean");
assert(alpha.knowledge.items.length === 0, "real project inherited demo knowledge");
assert(alpha.standards.projectId === alpha.id, "project standards are not isolated");
assert(alpha.cases.length === 1, "new project should have one starter case");
assert(alpha.config.localStorage.casesDir === expectedCasesDir(alpha, alpha.cases[0]), "new project storage config did not point to starter case");
assert(alphaState.activeProjectId === alpha.id, "new project did not become active");
assert(alphaState.activeCaseId === alpha.cases[0].id, "starter case did not become active");
await stat(path.join(caseRoot(alpha, alpha.cases[0]), "README.md"));
await stat(path.join(caseRoot(alpha, alpha.cases[0]), "metadata.json"));
pass("createLocalProject");

const betaState = await store.createLocalProject({ name: "Client Beta", sapVersion: "ECC", systemLabel: "QA/220" });
const beta = betaState.projects.find((project) => project.name === "Client Beta");
const alphaReloaded = betaState.projects.find((project) => project.id === alpha.id);
assert(beta && alphaReloaded, "created projects missing after second create");
assert(beta.id !== alpha.id, "project ids are not unique");
assert(beta.standards.projectId === beta.id, "beta standards not isolated");
assert(beta.knowledge.items.length === 0, "beta inherited demo knowledge");
pass("createSecondProject");

const concurrentProjectNames = ["Concurrent A", "Concurrent B", "Concurrent C", "Concurrent D"];
await Promise.all(concurrentProjectNames.map((name, index) => store.createLocalProject({ name, sapVersion: index % 2 === 0 ? "S4" : "ECC", systemLabel: "LOCAL/" + index })));
const afterConcurrentProjects = await store.getState();
for (const name of concurrentProjectNames) {
  assert(afterConcurrentProjects.projects.some((project) => project.name === name), "concurrent project missing: " + name);
}
assert(new Set(afterConcurrentProjects.projects.map((project) => project.id)).size === afterConcurrentProjects.projects.length, "concurrent project IDs are not unique");
pass("concurrentProjectCreation");

const caseState = await store.createLocalCase({ projectId: alpha.id, title: "Pricing issue investigation" });
const alphaAfterCase = caseState.projects.find((project) => project.id === alpha.id);
const pricingCase = alphaAfterCase.cases.find((caseItem) => caseItem.title === "Pricing issue investigation");
assert(pricingCase, "created case missing");
assert(caseState.activeProjectId === alpha.id, "new case did not switch active project");
assert(caseState.activeCaseId === pricingCase.id, "new case did not become active");
assert(alphaAfterCase.config.localStorage.casesDir === expectedCasesDir(alphaAfterCase, pricingCase), "new case storage config did not point to active case");
await stat(path.join(caseRoot(alphaAfterCase, pricingCase), "conversation.md"));
await stat(path.join(caseRoot(alphaAfterCase, pricingCase), "timeline.md"));
await stat(path.join(caseRoot(alphaAfterCase, pricingCase), "context_pack.md"));
pass("createLocalCase");

const concurrentCaseTitles = ["Parallel case A", "Parallel case B", "Parallel case C", "Parallel case D"];
await Promise.all(concurrentCaseTitles.map((title) => store.createLocalCase({ projectId: alpha.id, title })));
const afterConcurrentCases = await store.getState();
const alphaAfterConcurrentCases = afterConcurrentCases.projects.find((project) => project.id === alpha.id);
for (const title of concurrentCaseTitles) {
  assert(alphaAfterConcurrentCases.cases.some((caseItem) => caseItem.title === title), "concurrent case missing: " + title);
}
assert(new Set(alphaAfterConcurrentCases.cases.map((caseItem) => caseItem.id)).size === alphaAfterConcurrentCases.cases.length, "concurrent case IDs are not unique");
pass("concurrentCaseCreation");

const betaSwitch = await store.switchProject({ projectId: beta.id });
assert(betaSwitch.activeProjectId === beta.id, "switch project did not change active project");
assert(betaSwitch.activeCaseId === beta.cases[0].id, "switch project did not select beta recent case");
const betaAfterSwitch = betaSwitch.projects.find((project) => project.id === beta.id);
assert(betaAfterSwitch.config.localStorage.casesDir === expectedCasesDir(betaAfterSwitch, beta.cases[0]), "switch project storage config did not point to active case");
assert(betaSwitch.activeCaseFiles.some((node) => node.name === "README.md"), "switch project did not read active files");
pass("switchProject");

const alphaCaseSwitch = await store.switchCase({ projectId: alpha.id, caseId: pricingCase.id });
assert(alphaCaseSwitch.activeProjectId === alpha.id, "switch case did not set active project");
assert(alphaCaseSwitch.activeCaseId === pricingCase.id, "switch case did not set active case");
const alphaAfterSwitch = alphaCaseSwitch.projects.find((project) => project.id === alpha.id);
assert(alphaAfterSwitch.config.localStorage.casesDir === expectedCasesDir(alphaAfterSwitch, pricingCase), "switch case storage config did not point to active case");
assert(alphaCaseSwitch.activeCaseFiles.some((node) => node.name === "README.md"), "switch case did not read case files");
pass("switchCase");

await assertRejects("crossProjectCaseBlocked", () => store.switchCase({ projectId: beta.id, caseId: pricingCase.id }));
await assertRejects("switchProjectBlocksSlashId", () => store.switchProject({ projectId: alpha.id + "/trick" }));
await assertRejects("switchProjectBlocksColonId", () => store.switchProject({ projectId: alpha.id + ":" }));
await assertRejects("switchCaseBlocksSlashProjectId", () => store.switchCase({ projectId: alpha.id + "/", caseId: pricingCase.id }));
await assertRejects("switchCaseBlocksSlashCaseId", () => store.switchCase({ projectId: alpha.id, caseId: pricingCase.id + "/trick" }));
await assertRejects("createCaseBlocksPathProjectId", () => store.createLocalCase({ projectId: alpha.id + "/../" + beta.id, title: "Wrong target" }));
await assertRejects("createProjectBlocksDotEnv", () => store.createLocalProject({ name: ".env", sapVersion: "S4", systemLabel: "PRD/800" }));
await assertRejects("createProjectBlocksSapAdtCli", () => store.createLocalProject({ name: ".sap-adt-cli", sapVersion: "S4", systemLabel: "PRD/800" }));
await assertRejects("createProjectBlocksAbsolutePath", () => store.createLocalProject({ name: "C:/temp/project", sapVersion: "S4", systemLabel: "PRD/800" }));
await assertRejects("createProjectBlocksUnknownSapVersion", () => store.createLocalProject({ name: "Unknown SAP", sapVersion: "UNKNOWN", systemLabel: "PRD/800" }));
await assertRejects("createCaseBlocksToken", () => store.createLocalCase({ projectId: alpha.id, title: "token=abcdefghijklmnop" }));

const projectResults = await store.search("Client Alpha");
assert(projectResults.some((item) => item.type === "project" && item.projectId === alpha.id), "search did not find created project");
const caseResults = await store.search("Pricing issue");
assert(caseResults.some((item) => item.type === "case" && item.caseId === pricingCase.id), "search did not find created case");
pass("searchFindsLifecycleRecords");

const appSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8");
assert(!appSource.includes("bridge.createDemoProject"), "renderer still calls demo project creation");
assert(!appSource.includes("bridge.createDemoCase"), "renderer still calls demo case creation");
assert(!appSource.includes('<option value="UNKNOWN">'), "new project UI still offers UNKNOWN SAP version");
assert(!appSource.includes("Publish status"), "renderer still uses publish wording for local Feishu draft");
assert(appSource.includes('switchProject(item.id, "config")'), "project settings button does not switch project before config");
pass("rendererUsesRealLifecycle");

const sourceFiles = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts",
  "apps/desktop/src/renderer/App.tsx"
];
const sourceByFile = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(path.join(repoRoot, file), "utf8")])));
let appLifecycleSource = Object.values(sourceByFile).join("\\n");
const phase20Start = sourceByFile["apps/desktop/src/main/main.ts"].indexOf("async function importKnowledgeTextFile");
const phase20End = sourceByFile["apps/desktop/src/main/main.ts"].indexOf("function registerWorkbenchHandlers", phase20Start);
if (phase20Start >= 0 && phase20End > phase20Start) {
  appLifecycleSource = appLifecycleSource.replace(sourceByFile["apps/desktop/src/main/main.ts"].slice(phase20Start, phase20End), "");
}
for (const marker of ["workbench:create-local-project", "workbench:create-local-case", "workbench:switch-project", "workbench:switch-case"]) {
  assert(appLifecycleSource.includes(marker), "missing lifecycle IPC marker: " + marker);
}
for (const forbidden of ["workbench:create-demo-project", "workbench:create-demo-case", "createDemoProject:", "createDemoCase:"]) {
  assert(!appLifecycleSource.includes(forbidden), "demo lifecycle IPC is still exposed: " + forbidden);
}
for (const forbidden of ["showOpenDialog", "dialog.show", "shell.open", "openExternal", "openPath", "execFile", "spawn(", "exec(", "fetch(", "unlink", "rm("]) {
  assert(!appLifecycleSource.includes(forbidden), "unsafe lifecycle source marker found: " + forbidden);
}
pass("noUnsafeLifecycleCapabilities");

const tempFiles = await listTmpFiles(path.join(isolatedRepoRoot, "local-data", "workbench"));
assert(tempFiles.length === 0, "atomic write temp files were left behind: " + tempFiles.join(", "));
pass("noAtomicTempResidue");

const legacyStore = new WorkspaceStore(legacyRepoRoot);
const legacyProjectState = await legacyStore.createLocalProject({ name: "Legacy Client", sapVersion: "S4", systemLabel: "LEG/100" });
const legacyProject = legacyProjectState.projects.find((project) => project.name === "Legacy Client");
assert(legacyProject, "legacy project missing");
const legacyFirstCase = legacyProject.cases[0];
assert(legacyFirstCase, "legacy first case missing");
const legacyCaseState = await legacyStore.createLocalCase({ projectId: legacyProject.id, title: "Migrated active case" });
const legacyActiveProject = legacyCaseState.projects.find((project) => project.id === legacyProject.id);
assert(legacyActiveProject, "legacy active project missing");
const legacyActiveCase = legacyActiveProject.cases.find((caseItem) => caseItem.title === "Migrated active case");
assert(legacyActiveCase, "legacy active case missing");
const staleStatePath = path.join(legacyRepoRoot, "local-data", "workbench", "app-state.json");
const staleState = JSON.parse(await readFile(staleStatePath, "utf8"));
const staleProject = staleState.projects.find((project) => project.id === legacyProject.id);
assert(staleProject, "legacy stale project missing");
staleProject.config.localStorage.casesDir = expectedCasesDir(staleProject, legacyFirstCase);
await writeFile(staleStatePath, JSON.stringify(staleState, null, 2) + "\\n", "utf8");

const migratedState = await legacyStore.getState();
const migratedProject = migratedState.projects.find((project) => project.id === legacyProject.id);
assert(migratedProject, "legacy migrated project missing");
assert(migratedProject.config.localStorage.casesDir === expectedCasesDir(migratedProject, legacyActiveCase), "getState did not return migrated active case storage path");
const persistedState = JSON.parse(await readFile(staleStatePath, "utf8"));
const persistedProject = persistedState.projects.find((project) => project.id === legacyProject.id);
assert(persistedProject, "legacy persisted project missing");
assert(persistedProject.config.localStorage.casesDir === expectedCasesDir(persistedProject, legacyActiveCase), "app-state.json did not persist normalized active case storage path");
const legacyProjectJsonPath = path.join(legacyRepoRoot, "local-data", "workbench", "projects", legacyProject.id, "project.json");
const persistedProjectJson = JSON.parse(await readFile(legacyProjectJsonPath, "utf8"));
assert(persistedProjectJson.config.localStorage.casesDir === expectedCasesDir(legacyActiveProject, legacyActiveCase), "project.json did not persist normalized active case storage path");
pass("legacyStateStorageMigration");

persistedProjectJson.config.localStorage.casesDir = expectedCasesDir(legacyActiveProject, legacyFirstCase);
await writeFile(legacyProjectJsonPath, JSON.stringify(persistedProjectJson, null, 2) + "\\n", "utf8");
const projectOnlyMigratedState = await legacyStore.getState();
const projectOnlyMigratedProject = projectOnlyMigratedState.projects.find((project) => project.id === legacyProject.id);
assert(projectOnlyMigratedProject, "project-only migrated project missing");
assert(projectOnlyMigratedProject.config.localStorage.casesDir === expectedCasesDir(projectOnlyMigratedProject, legacyActiveCase), "getState returned stale project-only storage path");
const projectOnlyPersistedJson = JSON.parse(await readFile(legacyProjectJsonPath, "utf8"));
assert(projectOnlyPersistedJson.config.localStorage.casesDir === expectedCasesDir(legacyActiveProject, legacyActiveCase), "project.json-only stale storage path was not repaired");
pass("projectOnlyStorageMigration");

const stableStatePathStat = await stat(staleStatePath);
const stableProjectJsonStat = await stat(legacyProjectJsonPath);
const stableStateA = await legacyStore.getState();
const stableStateB = await legacyStore.getState();
const stableProjectA = stableStateA.projects.find((project) => project.id === legacyProject.id);
const stableProjectB = stableStateB.projects.find((project) => project.id === legacyProject.id);
assert(stableProjectA && stableProjectB, "stable timestamp project missing");
assert(stableProjectA.config.updatedAt === stableProjectB.config.updatedAt, "getState churned project config updatedAt");
assert(stableProjectA.config.localStorage.lastCheckedAt === stableProjectB.config.localStorage.lastCheckedAt, "getState churned local storage lastCheckedAt");
const stableStatePathAfterStat = await stat(staleStatePath);
const stableProjectJsonAfterStat = await stat(legacyProjectJsonPath);
assert(stableStatePathStat.mtimeMs === stableStatePathAfterStat.mtimeMs, "stable getState rewrote app-state.json");
assert(stableProjectJsonStat.mtimeMs === stableProjectJsonAfterStat.mtimeMs, "stable getState rewrote project.json");
pass("getStateTimestampStable");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase15-probe-entry.ts",
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
