import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase20-text-file-import-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const PROBE_MARKER = "phase20-controlled-text-file-import";

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
import {
  decodeControlledKnowledgeTextFile,
  readControlledKnowledgeTextFile
} from "./apps/desktop/src/main/controlledTextFileImportService.ts";
import {
  createKnowledgeImportInputFromTextFile,
  MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES,
  parseKnowledgeImportTextFileInput
} from "./apps/desktop/src/main/knowledgeService.ts";

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

const request = parseKnowledgeImportTextFileInput({ projectId: "project-safe" });
assert(request.projectId === "project-safe", "project id was not preserved");
pass("parseTextFileImportRequest");

assertThrows("parseTextFileImportRejectsExtraField", () => parseKnowledgeImportTextFileInput({ projectId: "project-safe", path: "C:/temp/a.md" }));
assertThrows("parseTextFileImportRejectsBadProject", () => parseKnowledgeImportTextFileInput({ projectId: "../bad" }));

const safeBody = "PO approval path follows the confirmed organization scope. Historical notes are reference only. This candidate still needs human review before publishing.";
const { importInput, metadata } = createKnowledgeImportInputFromTextFile({
  projectId: "project-safe",
  fileName: "approval-note.md",
  sizeBytes: Buffer.byteLength(safeBody, "utf8"),
  body: safeBody
});
assert(importInput.title === "approval note", "title should be derived from safe basename");
assert(importInput.sourceKind === "markdown-note", "markdown file should use markdown-note source kind");
assert(importInput.sourceName === "approval-note.md", "source name should be basename only");
assert(importInput.body === safeBody, "body was not preserved");
assert(metadata.extension === ".md", "metadata extension mismatch");
assert(metadata.sourceName === "approval-note.md", "metadata source name mismatch");
assert(metadata.characterCount === safeBody.length, "metadata character count mismatch");
pass("createImportInputFromMarkdownFile");

const txtResult = createKnowledgeImportInputFromTextFile({
  projectId: "project-safe",
  fileName: "meeting-summary.txt",
  sizeBytes: Buffer.byteLength(safeBody, "utf8"),
  body: safeBody
});
assert(txtResult.importInput.sourceKind === "local-text", "txt file should use local-text source kind");
pass("createImportInputFromTxtFile");

assertThrows("textFileRejectsPdf", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "unsafe.pdf", sizeBytes: 20, body: safeBody }));
assertThrows("textFileRejectsAbap", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "zunsafe.abap", sizeBytes: 20, body: safeBody }));
assertThrows("textFileRejectsEmpty", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "empty.md", sizeBytes: 0, body: "" }));
assertThrows("textFileRejectsOversized", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "large.md", sizeBytes: MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES + 1, body: safeBody }));
assertThrows("textFileRejectsSecretBody", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "note.md", sizeBytes: 64, body: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" }));
assertThrows("textFileRejectsFeishuUrl", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "note.md", sizeBytes: 64, body: "See https://open.feishu.cn/document/abcdefghi" }));
assertThrows("textFileRejectsBodyPath", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "note.md", sizeBytes: 64, body: "Please import C:/Users/admin/.env into knowledge." }));
assertThrows("textFileRejectsAbapSource", () => createKnowledgeImportInputFromTextFile({ projectId: "project-safe", fileName: "note.md", sizeBytes: 64, body: "REPORT zunsafe.\\nUPDATE mara SET matnr = 'X'." }));
assertThrows("textFileRejectsStructuredRows", () => createKnowledgeImportInputFromTextFile({
  projectId: "project-safe",
  fileName: "note.md",
  sizeBytes: 128,
  body: ["a,b,c,d,e", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5"].join("\\n")
}));

assert(decodeControlledKnowledgeTextFile(Buffer.from("safe utf8 note", "utf8")) === "safe utf8 note", "safe UTF-8 text did not decode");
pass("decodeSafeUtf8Text");
assertThrows("decodeRejectsNulBinary", () => decodeControlledKnowledgeTextFile(Buffer.from([0x61, 0x00, 0x62])));
assertThrows("decodeRejectsInvalidUtf8", () => decodeControlledKnowledgeTextFile(Buffer.from([0xff, 0xfe, 0xfd])));
assertThrows("decodeRejectsControlHeavyText", () => decodeControlledKnowledgeTextFile(Buffer.from("\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\u0008\\u000e\\u000f", "utf8")));

const fileReadRoot = path.join(isolatedRepoRoot, "selected-files");
await mkdir(fileReadRoot, { recursive: true });
const readableFile = path.join(fileReadRoot, "approval-note.md");
await writeFile(readableFile, safeBody, "utf8");
const selectedRead = await readControlledKnowledgeTextFile(readableFile);
assert(selectedRead.sourceName === "approval-note.md", "controlled read should return basename only");
assert(selectedRead.body === safeBody, "controlled read body mismatch");
assert(selectedRead.sizeBytes === Buffer.byteLength(safeBody, "utf8"), "controlled read size mismatch");
pass("controlledReadReturnsSafeMetadata");

await writeFile(readableFile, "will be removed", "utf8");
await rm(readableFile, { force: true });
try {
  await readControlledKnowledgeTextFile(readableFile);
  throw new Error("deleted file read did not reject");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  assert(!message.includes(readableFile), "deleted file error leaked absolute path");
  assert(!message.includes(fileReadRoot), "deleted file error leaked parent path");
  pass("controlledReadErrorDoesNotLeakPath");
}

const oversizedFile = path.join(fileReadRoot, "large.md");
await writeFile(oversizedFile, "x".repeat(MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES + 1), "utf8");
await assertRejects("controlledReadRejectsOversizedBuffer", () => readControlledKnowledgeTextFile(oversizedFile));

const store = new WorkspaceStore(isolatedRepoRoot);
const projectState = await store.createLocalProject({ name: "Phase20 Client", sapVersion: "S4", systemLabel: "LOCAL/020" });
const project = activeProject(projectState);
const caseItem = activeCase(project, projectState);
assert(project && caseItem, "project or case missing");

const importResult = await store.importKnowledgeLocalText({ ...importInput, projectId: project.id });
const importedProject = activeProject(importResult.state);
const importedItem = importedProject.knowledge.items.find((item) => item.id === importResult.knowledgeItemId);
const importedJob = importedProject.knowledge.documentJobs.find((job) => job.id === importResult.documentJobId);
assert(importedItem, "imported knowledge item missing");
assert(importedJob, "imported job missing");
assert(importedItem.status === "pending", "file import must create pending item");
assert(importedItem.publishedAt === null, "file import must not auto-publish");
assert(importedItem.sourceFilePath && importedItem.sourceFilePath.startsWith("knowledge_candidates/imported-knowledge-"), "source path should be generated candidate path");
assert(!importedItem.sourceFilePath.includes("approval-note.md"), "generated source path must not reuse selected filename as path");
assert(importedItem.sourceType === "document-import", "markdown import should be document import");
assert(importedJob.status === "needs-review", "file import job must need review");
assert(importedJob.source === "local-text", "file import reuses local text job source");
pass("fileImportCreatesPendingCandidate");

await assertRejects("fileImportPublishBeforeReviewBlocked", () => store.publishKnowledge(importedProject.id, { itemId: importedItem.id, note: "publish before review" }));

const reviewedState = await store.reviewKnowledgeForPublish(importedProject.id, {
  itemId: importedItem.id,
  note: "Reviewed safe source and scope",
  checklist: {
    sourceAndScopeConfirmed: true,
    noSecretsConfirmed: true,
    noSapSourceOrWriteOpsConfirmed: true,
    noCustomerDetailsConfirmed: true
  }
});
const reviewedProject = activeProject(reviewedState);
const reviewedItem = reviewedProject.knowledge.items.find((item) => item.id === importedItem.id);
assert(reviewedItem.reviewedAt && reviewedItem.reviewedContentHash, "review metadata missing");
pass("fileImportReviewRecorded");

const publishedState = await store.publishKnowledge(reviewedProject.id, { itemId: importedItem.id, note: "Approved after human review" });
const publishedProject = activeProject(publishedState);
const publishedItem = publishedProject.knowledge.items.find((item) => item.id === importedItem.id);
assert(publishedItem.status === "published", "reviewed file import did not publish");
assert(publishedItem.publishedAt, "published timestamp missing");
pass("fileImportPublishesAfterReview");

const searchResults = await store.search("approval path");
assert(searchResults.some((item) => item.type === "knowledge" && item.projectId === publishedProject.id), "search did not find imported file candidate");
pass("searchFindsFileImportCandidate");

const sourceFiles = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/controlledTextFileImportService.ts",
  "apps/desktop/src/main/knowledgeService.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts",
  "apps/desktop/src/renderer/App.tsx",
  "apps/desktop/src/renderer/KnowledgeCenter.tsx"
];
const sourceByFile = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(path.join(repoRoot, file), "utf8")])));
const appSource = Object.values(sourceByFile).join("\\n");
assert(appSource.includes("workbench:knowledge-import-text-file"), "missing text file import IPC marker");
assert(appSource.includes("parseKnowledgeImportTextFileInput"), "missing text file import request parser");
assert(appSource.includes("createKnowledgeImportInputFromTextFile"), "missing text file import builder");
assert(appSource.includes("MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES"), "missing text file size guard");
assert(appSource.includes("decodeControlledKnowledgeTextFile"), "missing UTF-8 text decode guard");
assert(appSource.includes("readControlledKnowledgeTextFile"), "missing controlled file read guard");

function extractBlock(file, startMarker, endMarker) {
  const source = sourceByFile[file];
  const start = source.indexOf(startMarker);
  assert(start >= 0, "missing block start: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, "missing block end for: " + startMarker);
  return source.slice(start, end);
}

const mainImportBlock = extractBlock("apps/desktop/src/main/main.ts", "async function importKnowledgeTextFile", "function registerWorkbenchHandlers");
assert(mainImportBlock.includes("dialog.showOpenDialog"), "main import block must own the file picker");
assert(mainImportBlock.includes("readControlledKnowledgeTextFile"), "main import block must delegate controlled file read");
assert(!mainImportBlock.includes("sourceFilePath"), "main import block must not accept or return sourceFilePath");
for (const forbidden of ["fetch(", "execFile(", "spawn(", "exec(", "openExternal", "openPath", "loadURL", "feishu-sync", "unlink", "rm("]) {
  assert(!mainImportBlock.includes(forbidden), "main import block contains forbidden marker: " + forbidden);
}

const rendererAndPreload = [
  sourceByFile["apps/desktop/src/preload/preload.ts"],
  sourceByFile["apps/desktop/src/renderer/vite-env.d.ts"],
  sourceByFile["apps/desktop/src/renderer/App.tsx"],
  sourceByFile["apps/desktop/src/renderer/KnowledgeCenter.tsx"]
].join("\\n");
for (const forbidden of ["showOpenDialog", "dialog.show", "readFile(", "fs.", "node:fs", "fetch(", "execFile(", "spawn(", "exec(", "openExternal", "openPath", "loadURL", "feishu-sync"]) {
  assert(!rendererAndPreload.includes(forbidden), "renderer/preload text file import exposes forbidden marker: " + forbidden);
}

const sourcePathUse = appSource.split(/\\r?\\n/).filter((line) => /readFile\\(.*sourceFilePath|path\\.join\\(.*sourceFilePath|openPath\\(.*sourceFilePath|shell\\.openPath\\(.*sourceFilePath/.test(line));
assert(sourcePathUse.length === 0, "sourceFilePath is used as filesystem path");

const controlledReadBlock = sourceByFile["apps/desktop/src/main/controlledTextFileImportService.ts"];
assert(controlledReadBlock.includes("fs.stat"), "controlled read should stat before reading");
assert(controlledReadBlock.includes("fs.readFile"), "controlled read should own the one-time read");
assert(controlledReadBlock.includes("fileBuffer.length > MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES"), "controlled read should check actual buffer size after read");
assert(!controlledReadBlock.includes("error.message"), "controlled read must not expose raw fs error messages");
pass("noUnsafeTextFileImportCapabilities");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase20-probe-entry.ts",
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
