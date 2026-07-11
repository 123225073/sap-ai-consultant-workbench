import { build } from "esbuild";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase40-workspace-"));
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const entrySource = `
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new WorkspaceStore(isolatedRepoRoot);
let state = await store.getState();
assert(state.projects.length === 1, "new workspace should start with one neutral local Project");
assert(state.projects[0].id === "local-workspace", "new workspace must not seed the demo Project");
assert(state.projects[0].knowledge.items.length === 0, "new workspace must not seed demo knowledge");

state = await store.createLocalProject({ name: "客户 A", sapVersion: "S4", systemLabel: "DEV/100" });
const projectAId = state.activeProjectId;
const caseAId = state.activeCaseId;
const projectA = state.projects.find((item) => item.id === projectAId);
const caseA = projectA.cases.find((item) => item.id === caseAId);

state = await store.createLocalProject({ name: "客户 B", sapVersion: "ECC", systemLabel: "QAS/200" });
const projectBId = state.activeProjectId;
const caseBId = state.activeCaseId;
await store.switchCase({ projectId: projectAId, caseId: caseAId });

const targeted = await store.bindCaseWorkflowTarget({
  content: "只应写入客户 A 的原始工作文件夹",
  taskMode: "problem-analysis",
  modelId: "local-workflow",
  actionId: null,
  permissionMode: "request_approval"
});
assert(targeted.projectId === projectAId && targeted.caseId === caseAId, "workflow target was not bound at send time");

await store.switchCase({ projectId: projectBId, caseId: caseBId });
state = await store.appendMessage(targeted);
assert(state.activeProjectId === projectBId && state.activeCaseId === caseBId, "background result changed the user's active case");
const persistedA = state.projects.find((item) => item.id === projectAId).cases.find((item) => item.id === caseAId);
const persistedB = state.projects.find((item) => item.id === projectBId).cases.find((item) => item.id === caseBId);
assert(persistedA.messages.some((item) => item.content.includes("只应写入客户 A")), "bound result was not written to the original case");
assert(!persistedB.messages.some((item) => item.content.includes("只应写入客户 A")), "bound result leaked into the newly active case");
const conversationA = await readFile(path.join(isolatedRepoRoot, "local-data", "workbench", "projects", projectAId, "cases", caseA.folderName, "conversation.md"), "utf8");
assert(conversationA.includes("只应写入客户 A"), "original case files were not updated");

await store.switchCase({ projectId: projectBId, caseId: caseBId });
const workbenchRoot = path.join(isolatedRepoRoot, "local-data", "workbench");
await writeFile(path.join(workbenchRoot, "app-state.json"), "{ broken json", "utf8");
const recovered = await new WorkspaceStore(isolatedRepoRoot).getState();
assert(recovered.startupNotice?.includes("已从有效备份恢复"), "state recovery notice was not returned to the renderer");
assert(recovered.projects.some((item) => item.id === projectAId), "valid backup did not recover real projects");
const preserved = (await readdir(workbenchRoot)).filter((name) => name.startsWith("app-state.corrupt-") && name.endsWith(".json"));
assert(preserved.length === 1, "corrupted state file was not preserved exactly once");

process.stdout.write("phase40-workspace-integrity-runtime=ok\\n");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase40-workspace-integrity-entry.ts",
      loader: "ts"
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: bundlePath,
    logLevel: "silent"
  });
  await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);

  const [appSource, mainSource, storeSource] = await Promise.all([
    readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8")
  ]);
  assert(appSource.includes("projectId: target.projectId") && appSource.includes("caseId: target.caseId"), "renderer does not send immutable case target IDs");
  assert(!appSource.includes('className="project-config-preview"'), "Work right panel still renders the project configuration summary");
  assert(mainSource.includes("bindCaseWorkflowTarget(input)"), "main process does not bind workflow target before external calls");
  assert(storeSource.includes("app-state.backup.json") && storeSource.includes("app-state.corrupt-"), "state backup and preservation policy is missing");
  process.stdout.write("phase40-workspace-integrity-static=ok\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
