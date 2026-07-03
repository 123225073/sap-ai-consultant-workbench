import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase14-feishu-handoff-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  FEISHU_HANDOFF_LOCAL_ONLY_MARKER,
  assertSafeFeishuHandoffText,
  renderFeishuHandoffArtifacts
} from "./apps/desktop/src/main/feishuHandoffService.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function snapshotFiles(root, relativeBase = "") {
  const absoluteBase = path.join(root, relativeBase);
  const entries = await readdir(absoluteBase, { withFileTypes: true }).catch(() => []);
  const files = new Map();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      for (const [key, value] of await snapshotFiles(root, relativePath)) {
        files.set(key, value);
      }
    } else if (entry.isFile()) {
      const content = await readFile(absolutePath);
      files.set(relativePath.replaceAll("\\\\", "/"), createHash("sha256").update(content).digest("hex"));
    }
  }
  return files;
}

function changedFiles(before, after) {
  const changed = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of [...keys].sort()) {
    if (before.get(key) !== after.get(key)) changed.push(key);
  }
  return changed;
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

assert(FEISHU_HANDOFF_LOCAL_ONLY_MARKER === "feishu-handoff-local-only", "local-only marker mismatch");
assertThrows("handoffBlocksAuthorization", () => assertSafeFeishuHandoffText("Authorization: Bearer abcdefghijklmnop"));
assertThrows("handoffBlocksDocumentId", () => assertSafeFeishuHandoffText("document_id: abcdefghijklmnop"));
assertThrows("handoffBlocksToken", () => assertSafeFeishuHandoffText("tenant_access_token: abcdefghijklmnop"));

const store = new WorkspaceStore(isolatedRepoRoot);
await store.appendMessage({
  content: "Prepare a safe local document summary for Feishu handoff testing.",
  taskMode: "document-generation",
  modelId: "local-workflow"
});
const initialState = await store.getState();
const initialProject = initialState.projects.find((item) => item.id === initialState.activeProjectId);
const initialCase = initialProject.cases.find((item) => item.id === initialState.activeCaseId);
const beforeHandoffFiles = await snapshotFiles(isolatedRepoRoot);
const result = await store.prepareFeishuHandoff();
assert(result.publishStatus === "not-published", "handoff publish status changed");
assert(result.generatedFiles.length === 3, "unexpected generated handoff file count");
assert(result.generatedFiles.some((file) => file.startsWith("outputs/feishu-handoff-") && file.endsWith(".md")), "handoff markdown missing");
assert(result.generatedFiles.some((file) => file.startsWith("outputs/feishu-whiteboard-") && file.endsWith(".mmd")), "handoff mermaid missing");
assert(result.generatedFiles.some((file) => file.startsWith("technical/feishu-handoff-manifest-") && file.endsWith(".json")), "handoff manifest missing");
assert(result.generatedFiles.every((file) => file.startsWith("outputs/") || file.startsWith("technical/")), "handoff wrote outside allowed dirs");
assert(result.sourceFiles.every((file) => file.startsWith("outputs/")), "handoff source file outside outputs");
assert(result.blockedActions.includes("automatic final publish"), "blocked action marker missing");
pass("handoffResultShape");

const state = result.state;
const project = state.projects.find((item) => item.id === state.activeProjectId);
const caseItem = project.cases.find((item) => item.id === state.activeCaseId);
const caseRoot = path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
assert(initialProject.id === project.id && initialCase.id === caseItem.id, "handoff changed active case");
const afterHandoffFiles = await snapshotFiles(isolatedRepoRoot);
const allowedChangedFiles = new Set(result.generatedFiles.map((file) => (
  path.join("local-data", "workbench", "projects", project.id, "cases", caseItem.folderName, file).replaceAll("\\\\", "/")
)));
const changed = changedFiles(beforeHandoffFiles, afterHandoffFiles);
assert(changed.length === allowedChangedFiles.size, "unexpected handoff write count: " + changed.join(", "));
assert(changed.every((file) => allowedChangedFiles.has(file)), "handoff changed files outside generated artifacts: " + changed.join(", "));
pass("handoffActualDiskWritesLimited");

const generatedText = [];
for (const relativePath of result.generatedFiles) {
  generatedText.push(await readFile(path.join(caseRoot, relativePath), "utf8"));
}
const combined = generatedText.join("\\n---FILE---\\n");
assert(combined.includes("not-published"), "not-published marker missing from files");
assert(combined.includes("local draft"), "local draft marker missing from files");
assert(combined.includes(FEISHU_HANDOFF_LOCAL_ONLY_MARKER), "local-only marker missing from files");
assert(!/tenant_access_token|user_access_token|Authorization|Cookie|secure-store:sec_|SAP_SESSIONID|MYSAPSSO2|document_id/i.test(combined), "sensitive or cloud id marker leaked into handoff files");
assert(!/Feishu Doc URL|published successfully|cloud document was created/i.test(combined), "handoff file claims cloud publication");
pass("handoffFilesSafe");

const manifestPath = result.generatedFiles.find((file) => file.startsWith("technical/"));
const manifest = JSON.parse(await readFile(path.join(caseRoot, manifestPath), "utf8"));
assert(manifest.publishStatus === "not-published", "manifest publish status mismatch");
assert(manifest.safety.cloudDocumentCreated === false, "manifest cloud creation flag mismatch");
assert(manifest.safety.cloudDocumentUpdated === false, "manifest cloud update flag mismatch");
assert(manifest.safety.tokenStored === false, "manifest token flag mismatch");
pass("manifestSafety");

const searchResults = await store.search("Feishu");
assert(!searchResults.some((item) => item.sourcePath?.startsWith("technical/feishu-handoff-manifest-")), "technical manifest entered search results");
pass("searchExcludesTechnicalManifest");

const serviceOutput = renderFeishuHandoffArtifacts({
  project,
  caseItem,
  feishu: project.config.feishu,
  safeOutputSummaries: [{
    relativePath: "outputs/source.md",
    displayName: "Source",
    fileType: "md",
    sizeBytes: 42,
    snippet: "Safe source summary",
    updatedAt: "2099-01-01T00:00:00.000Z"
  }],
  createdAt: "2099-01-01T00:00:00.000Z"
});
assert(serviceOutput.generatedFiles.every((file) => file.relativePath.includes("20990101000000")), "timestamped deterministic paths missing");
pass("serviceDeterministicPaths");

const appSourceFiles = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/main/feishuHandoffService.ts",
  "apps/desktop/src/preload/preload.ts"
];
const appSource = (await Promise.all(appSourceFiles.map((file) => readFile(path.join(repoRoot, file), "utf8")))).join("\\n");
assert(appSource.includes("workbench:prepare-feishu-handoff"), "narrow handoff IPC missing");
for (const forbidden of ["docs +create", "docs +update", "whiteboard-update", "auth login"]) {
  assert(!appSource.includes(forbidden), "Feishu publish or auth marker found: " + forbidden);
}
const handoffPathSource = (await Promise.all([
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/main/feishuHandoffService.ts",
  "apps/desktop/src/preload/preload.ts"
].map((file) => readFile(path.join(repoRoot, file), "utf8")))).join("\\n");
for (const forbidden of ["device_code", "verification_uri"]) {
  assert(!handoffPathSource.includes(forbidden), "handoff path auth marker found: " + forbidden);
}
assert(!handoffPathSource.includes("child_process"), "handoff path imported child_process");
pass("noFeishuPublishCommands");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase14-probe-entry.ts",
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
