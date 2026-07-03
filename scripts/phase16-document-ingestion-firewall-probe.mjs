import { build } from "esbuild";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase16-ingestion-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const PROBE_MARKER = "phase16-document-ingestion-firewall";

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { mkdir, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
import { parseKnowledgeImportLocalTextInput } from "./apps/desktop/src/main/knowledgeService.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};

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

function activeProject(state) {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function activeCase(project, state) {
  return project.cases.find((caseItem) => caseItem.id === state.activeCaseId);
}

function caseRoot(project, caseItem) {
  return path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
}

const safeInput = {
  projectId: "project-safe",
  title: "采购审批口径候选",
  sourceKind: "local-text",
  sourceName: "会议纪要摘录",
  body: "采购订单审批口径以当前项目确认的组织范围为准，历史口径仅作为参考。该内容需要顾问复核后才能成为正式知识。",
  sapObjects: ["ZMM_APPROVAL"]
};

parseKnowledgeImportLocalTextInput(safeInput);
pass("parseSafeImportInput");

assertThrows("parseImportBlocksExtraField", () => parseKnowledgeImportLocalTextInput({ ...safeInput, unexpectedPath: "../escape" }));
assertThrows("parseImportBlocksBadProjectId", () => parseKnowledgeImportLocalTextInput({ ...safeInput, projectId: "project-safe/../x" }));
assertThrows("parseImportBlocksPathSourceName", () => parseKnowledgeImportLocalTextInput({ ...safeInput, sourceName: "../escape.md" }));
assertThrows("parseImportBlocksAbsoluteSourceName", () => parseKnowledgeImportLocalTextInput({ ...safeInput, sourceName: "C:/temp/a.md" }));
assertThrows("parseImportBlocksUrlSourceName", () => parseKnowledgeImportLocalTextInput({ ...safeInput, sourceName: "https://example.com/a.md" }));
assertThrows("parseImportBlocksDotEnvSourceName", () => parseKnowledgeImportLocalTextInput({ ...safeInput, sourceName: ".env" }));
assertThrows("parseImportBlocksSapConfigSourceName", () => parseKnowledgeImportLocalTextInput({ ...safeInput, sourceName: ".sap-adt-cli/config.json" }));
assertThrows("parseImportBlocksInternalJsonSourceName", () => parseKnowledgeImportLocalTextInput({ ...safeInput, sourceName: "messages.json" }));
assertThrows("parseImportBlocksPasswordBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "password=abcdefghi" }));
assertThrows("parseImportBlocksTokenBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "token=abcdefghijklmnop" }));
assertThrows("parseImportBlocksAuthorizationBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" }));
assertThrows("parseImportBlocksCookieBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "Cookie: SAP_SESSIONID=abcdefghi" }));
assertThrows("parseImportBlocksSapSessionBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "SAP_SESSIONID=abcdefghi" }));
assertThrows("parseImportBlocksMysapsso2Body", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "MYSAPSSO2=abcdefghi" }));
assertThrows("parseImportBlocksSecureStoreBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "secure-store:" + "sec_0123456789abcdef0123456789abcdef" }));
assertThrows("parseImportBlocksAppSecretBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "app_secret=abcdefghi" }));
assertThrows("parseImportBlocksDeviceCodeBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "device_code=abcdefghi" }));
assertThrows("parseImportBlocksVerificationUriBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "verification_uri=https://open.feishu.cn/auth" }));
assertThrows("parseImportBlocksDocumentIdBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "document_id=abcdefghi" }));
assertThrows("parseImportBlocksFeishuUrlBody", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "请看 https://open.feishu.cn/document/abcdefghi" }));
assertThrows("parseImportBlocksBodyPath", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "请读取 C:/Users/admin/.env 后导入。" }));
assertThrows("parseImportBlocksInlineBodyPath", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "路径C:/Users/admin/.env 不能进入知识。" }));
assertThrows("parseImportBlocksBareFeishuToken", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "t-abcdefghijklmnopqrstuvwxyz123456" }));
assertThrows("parseImportBlocksBareFeishuTokenWithPunctuation", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "t-abcdefghijklmnopqrstuvwxyz123456;" }));
assertThrows("parseImportBlocksTableRows", () => parseKnowledgeImportLocalTextInput({
  ...safeInput,
  body: ["a,b,c,d,e", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5"].join("\\n")
}));
assertThrows("parseImportBlocksSemicolonTableRows", () => parseKnowledgeImportLocalTextInput({
  ...safeInput,
  body: ["a;b;c;d;e", "1;2;3;4;5", "1;2;3;4;5", "1;2;3;4;5", "1;2;3;4;5", "1;2;3;4;5"].join("\\n")
}));
assertThrows("parseImportBlocksJsonRows", () => parseKnowledgeImportLocalTextInput({
  ...safeInput,
  body: ['{"a":1,"b":2}', '{"a":1,"b":2}', '{"a":1,"b":2}'].join("\\n")
}));
assertThrows("parseImportBlocksReportSource", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "REPORT zunsafe.\\nWRITE demo." }));
assertThrows("parseImportBlocksClassSource", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "CLASS zcl_unsafe DEFINITION.\\nENDCLASS." }));
assertThrows("parseImportBlocksSelectSource", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "SELECT * FROM mara INTO TABLE lt_mara." }));
assertThrows("parseImportBlocksCallFunction", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'." }));
assertThrows("parseImportBlocksUpdateSource", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "UPDATE mara SET matnr = 'X'." }));
assertThrows("parseImportBlocksDeleteSource", () => parseKnowledgeImportLocalTextInput({ ...safeInput, body: "DELETE FROM mara WHERE matnr = 'X'." }));

const store = new WorkspaceStore(isolatedRepoRoot);
const projectState = await store.createLocalProject({ name: "Phase16 Client", sapVersion: "S4", systemLabel: "LOCAL/016" });
const project = activeProject(projectState);
const caseItem = activeCase(project, projectState);
assert(project && caseItem, "project or case missing");
const beforeImportItemCount = project.knowledge.items.length;
const beforeImportJobCount = project.knowledge.documentJobs.length;

const importResult = await store.importKnowledgeLocalText({
  projectId: project.id,
  title: "采购审批口径候选",
  sourceKind: "local-text",
  sourceName: "会议纪要摘录",
  body: "采购订单审批口径以当前项目确认的组织范围为准，历史口径仅作为参考。该内容需要顾问复核后才能成为正式知识。",
  sapObjects: ["ZMM_APPROVAL"]
});
const importedState = importResult.state;
const importedProject = activeProject(importedState);
const importedCase = activeCase(importedProject, importedState);
const importedItem = importedProject.knowledge.items.find((item) => item.id === importResult.knowledgeItemId);
const importedJob = importedProject.knowledge.documentJobs.find((job) => job.id === importResult.documentJobId);
assert(importedItem, "imported knowledge item missing");
assert(importedJob, "imported document job missing");
assert(importedProject.knowledge.items.length === beforeImportItemCount + 1, "import should add exactly one knowledge item");
assert(importedProject.knowledge.documentJobs.length === beforeImportJobCount + 1, "import should add exactly one document job");
assert(importedJob.status === "needs-review", "document job must require review");
assert(importedJob.source === "local-text", "document job source should be local text");
assert(importedItem.status === "pending", "imported knowledge must be pending");
assert(importedItem.publishedAt === null, "imported knowledge must not be published");
assert(importedItem.reviewer === null, "imported knowledge must not set reviewer");
assert(importedItem.sourceCaseId === importedCase.id, "imported knowledge should point to active case");
assert(importedItem.sourceFilePath && importedItem.sourceFilePath.startsWith("knowledge_candidates/"), "source path must be safe relative candidate path");
assert(importedItem.sourceFilePath.endsWith(".md"), "candidate source path should be markdown");
assert(importedItem.sapObjects.includes("ZMM_APPROVAL"), "SAP object label was not preserved");
assert(importResult.generatedFiles.length === 1 && importResult.generatedFiles[0] === importedItem.sourceFilePath, "generated file metadata mismatch");
await stat(path.join(caseRoot(importedProject, importedCase), importedItem.sourceFilePath));
pass("importCreatesPendingCandidate");

await assertRejects("publishImportedCandidateBlocked", () => store.publishKnowledge(importedProject.id, { itemId: importedItem.id, note: "try publish" }));

const knowledgeJson = JSON.parse(await readFile(path.join(isolatedRepoRoot, "local-data", "workbench", "projects", importedProject.id, "knowledge", "project-knowledge.json"), "utf8"));
assert(knowledgeJson.safety === "no-secrets-project-knowledge", "knowledge json safety marker missing");
assert(knowledgeJson.knowledge.items.some((item) => item.id === importedItem.id && item.status === "pending"), "knowledge json missing pending imported item");
const knowledgeMarkdown = await readFile(path.join(isolatedRepoRoot, "local-data", "workbench", "projects", importedProject.id, "knowledge", "project-knowledge.md"), "utf8");
assert(knowledgeMarkdown.includes("采购审批口径候选"), "knowledge markdown missing imported title");
pass("importPersistsProjectKnowledge");

const searchResults = await store.search("采购审批口径候选");
assert(searchResults.some((item) => item.type === "knowledge" && item.projectId === importedProject.id), "search did not find imported candidate");
pass("searchFindsImportedCandidate");

await assertRejects("importRejectsWrongProject", () => store.importKnowledgeLocalText({ ...safeInput, projectId: "missing-project" }));
await assertRejects("importRejectsExtraField", () => store.importKnowledgeLocalText({ ...safeInput, projectId: importedProject.id, rawPath: "../escape" }));
await assertRejects("importRejectsPathSourceName", () => store.importKnowledgeLocalText({ ...safeInput, projectId: importedProject.id, sourceName: "../escape.md" }));
await assertRejects("importRejectsSecretBody", () => store.importKnowledgeLocalText({ ...safeInput, projectId: importedProject.id, body: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" }));
await assertRejects("importRejectsAbapSource", () => store.importKnowledgeLocalText({ ...safeInput, projectId: importedProject.id, body: "REPORT zunsafe.\\nUPDATE mara SET matnr = 'X'." }));

const outsideRoot = path.join(isolatedRepoRoot, "outside-knowledge-candidates");
await mkdir(outsideRoot, { recursive: true });
const candidateDir = path.join(caseRoot(importedProject, importedCase), "knowledge_candidates");
await rm(candidateDir, { recursive: true, force: true });
await symlink(outsideRoot, candidateDir, process.platform === "win32" ? "junction" : "dir");
const beforeSymlinkItemCount = importedProject.knowledge.items.length;
const beforeSymlinkJobCount = importedProject.knowledge.documentJobs.length;
await assertRejects("importRejectsCandidateDirectorySymlink", () => store.importKnowledgeLocalText({
  projectId: importedProject.id,
  title: "目录联接逃逸测试",
  sourceKind: "local-text",
  sourceName: "本地粘贴文本",
  body: "这是一段安全业务结论，但候选目录已经被替换成目录联接。",
  sapObjects: []
}));
const afterSymlinkKnowledge = await store.getProjectKnowledge(importedProject.id);
assert(afterSymlinkKnowledge.items.length === beforeSymlinkItemCount, "symlink rejection should not add knowledge item");
assert(afterSymlinkKnowledge.documentJobs.length === beforeSymlinkJobCount, "symlink rejection should not add document job");
const outsideEntries = await readdir(outsideRoot);
assert(outsideEntries.length === 0, "symlink rejection wrote outside case root");

const sourceFiles = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/knowledgeService.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts",
  "apps/desktop/src/renderer/KnowledgeCenter.tsx"
];
const sourceByFile = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(path.join(repoRoot, file), "utf8")])));
const appSource = Object.values(sourceByFile).join("\\n");
assert(appSource.includes("workbench:knowledge-import-local-text"), "missing local text import IPC marker");
assert(appSource.includes("parseKnowledgeImportLocalTextInput"), "missing import parser marker");
assert(appSource.includes("createImportedKnowledgeCandidate"), "missing imported candidate builder marker");

function extractBlock(file, startMarker, endMarker) {
  const source = sourceByFile[file];
  const start = source.indexOf(startMarker);
  assert(start >= 0, "missing block start: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, "missing block end for: " + startMarker);
  return source.slice(start, end);
}

const importBlocks = [
  extractBlock("apps/desktop/src/main/workspaceStore.ts", "async importKnowledgeLocalText(input: unknown)", "async copyProjectStandardsTemplate"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function parseKnowledgeImportLocalTextInput", "export function assertNoSensitiveKnowledgeContent"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function createImportedKnowledgeCandidate", "export function createKnowledgeCandidateFromCase"),
  extractBlock("apps/desktop/src/renderer/KnowledgeCenter.tsx", "async function submitImport", "if (!project || !view)")
];
for (const block of importBlocks) {
  for (const forbidden of ["showOpenDialog", "dialog.show", "openExternal", "loadURL", "feishu-sync", "readFile(", "fetch(", "execFile(", "spawn(", "exec(", "openPath(", "unlink", "rm("]) {
    assert(!block.includes(forbidden), "import function block contains forbidden marker: " + forbidden);
  }
}
const importPublishedLine = appSource.split(/\\r?\\n/).find((line) => line.includes("createImportedKnowledgeCandidate") && (line.includes("published") || line.includes("publishedAt")));
assert(!importPublishedLine, "import builder invocation should not publish knowledge");
pass("noUnsafeImportCapabilities");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase16-probe-entry.ts",
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
