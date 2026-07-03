import { createHash } from "node:crypto";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase19-knowledge-review-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const statePath = path.join(isolatedRepoRoot, "local-data", "workbench", "app-state.json");
const REVIEW_MARKER = "phase19-knowledge-review-gate";

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

const checklist = {
  sourceAndScopeConfirmed: true,
  noSecretsConfirmed: true,
  noSapSourceOrWriteOpsConfirmed: true,
  noCustomerDetailsConfirmed: true
};

function reviewHash(item) {
  return createHash("sha256").update(JSON.stringify({
    title: item.title,
    summary: item.summary,
    content: item.content,
    sapObjects: item.sapObjects,
    effectiveFrom: item.effectiveFrom,
    effectiveTo: item.effectiveTo,
    sourceFilePath: item.sourceFilePath
  }), "utf8").digest("hex");
}

async function mutateKnowledgeItem(projectId, itemId, mutator) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const project = state.projects.find((item) => item.id === projectId);
  assert(project, "project missing during mutation");
  const item = project.knowledge.items.find((candidate) => candidate.id === itemId);
  assert(item, "knowledge item missing during mutation");
  mutator(item);
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function importCandidate(store, projectId, title) {
  const result = await store.importKnowledgeLocalText({
    projectId,
    title,
    sourceKind: "local-text",
    sourceName: "本地粘贴文本",
    body: title + "以当前项目确认的业务范围为准，历史口径仅作为参考，审核后才能成为正式知识。",
    sapObjects: ["ZMM_REVIEW"]
  });
  return result.knowledgeItemId;
}

const store = new WorkspaceStore(isolatedRepoRoot);
const initialState = await store.createLocalProject({ name: "Phase19 Client", sapVersion: "S4", systemLabel: "LOCAL/019" });
const project = activeProject(initialState);
const caseItem = activeCase(project, initialState);
assert(project && caseItem, "project or case missing");

const itemId = await importCandidate(store, project.id, "采购审批审核门候选");
const importedView = await store.getProjectKnowledge(project.id);
const importedItem = importedView.items.find((item) => item.id === itemId);
assert(importedItem, "imported knowledge item missing");
assert(importedItem.status === "pending", "imported item must start pending");
assert(importedItem.reviewedAt === null, "imported item must start unreviewed");
assert(importedItem.reviewedContentHash === null, "imported item must not start with review hash");
pass("importCreatesUnreviewedCandidate");

await assertRejects("publishImportedCandidateWithoutReviewBlocked", () => store.publishKnowledge(project.id, { itemId, note: "try direct publish" }));
await assertRejects("reviewRejectsShortNote", () => store.reviewKnowledgeForPublish(project.id, { itemId, note: "太短", checklist }));
await assertRejects("reviewRejectsIncompleteChecklist", () => store.reviewKnowledgeForPublish(project.id, {
  itemId,
  note: "已确认来源和适用范围，可以进入正式知识库。",
  checklist: { ...checklist, noSecretsConfirmed: false }
}));
await assertRejects("reviewRejectsSensitiveNote", () => store.reviewKnowledgeForPublish(project.id, {
  itemId,
  note: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
  checklist
}));

const reviewedState = await store.reviewKnowledgeForPublish(project.id, {
  itemId,
  note: "已确认来源、适用范围和脱敏状态，可以进入正式知识库。",
  checklist
});
const reviewedProject = activeProject(reviewedState);
const reviewedItem = reviewedProject.knowledge.items.find((item) => item.id === itemId);
assert(reviewedItem.reviewedAt, "reviewedAt missing");
assert(reviewedItem.reviewNote.includes("适用范围"), "review note missing");
assert(reviewedItem.reviewedContentHash === reviewHash(reviewedItem), "review hash mismatch");
assert(reviewedItem.reviewChecklist.noSecretsConfirmed === true, "review checklist missing");
assert(reviewedItem.timeline.some((event) => event.action === "reviewed" && event.note.includes(REVIEW_MARKER)), "review timeline marker missing");
pass("reviewImportedCandidateRecordsGate");

const publishedState = await store.publishKnowledge(project.id, { itemId, note: "人工审核后确认入库。" });
const publishedProject = activeProject(publishedState);
const publishedItem = publishedProject.knowledge.items.find((item) => item.id === itemId);
assert(publishedItem.status === "published", "reviewed imported item was not published");
assert(publishedItem.publishedAt, "publishedAt missing");
assert(publishedItem.reviewer === "演示用户", "reviewer should be preserved");
pass("publishReviewedImportedCandidateSucceeds");

await assertRejects("publishAlreadyPublishedBlocked", () => store.publishKnowledge(project.id, { itemId, note: "publish again" }));

const tamperItemId = await importCandidate(store, project.id, "审核后篡改候选");
await store.reviewKnowledgeForPublish(project.id, {
  itemId: tamperItemId,
  note: "已确认这条候选的来源和脱敏状态，等待发布。",
  checklist
});
await mutateKnowledgeItem(project.id, tamperItemId, (item) => {
  item.content = "审核之后被改写的内容仍然看似安全。";
});
await assertRejects("publishTamperedImportedCandidateBlocked", () => store.publishKnowledge(project.id, { itemId: tamperItemId, note: "publish tampered" }));

const identityTamperItemId = await importCandidate(store, project.id, "身份字段篡改候选");
await mutateKnowledgeItem(project.id, identityTamperItemId, (item) => {
  item.sourceType = "manual";
  item.sourceFilePath = "knowledge/manual-note.md";
});
await assertRejects("publishIdentityTamperedImportedCandidateBlocked", () => store.publishKnowledge(project.id, { itemId: identityTamperItemId, note: "publish identity tampered" }));

const conflictItemId = await importCandidate(store, project.id, "冲突候选");
await store.markKnowledgeConflicted(project.id, { itemId: conflictItemId, note: "人工标记冲突。" });
await assertRejects("reviewConflictedCandidateBlocked", () => store.reviewKnowledgeForPublish(project.id, {
  itemId: conflictItemId,
  note: "冲突状态不能审核通过。",
  checklist
}));
await assertRejects("publishConflictedCandidateBlocked", () => store.publishKnowledge(project.id, { itemId: conflictItemId, note: "publish conflict" }));

const expiredItemId = await importCandidate(store, project.id, "失效候选");
await store.expireKnowledge(project.id, { itemId: expiredItemId, note: "人工标记失效。" });
await assertRejects("reviewExpiredCandidateBlocked", () => store.reviewKnowledgeForPublish(project.id, {
  itemId: expiredItemId,
  note: "失效状态不能审核通过。",
  checklist
}));
await assertRejects("publishExpiredCandidateBlocked", () => store.publishKnowledge(project.id, { itemId: expiredItemId, note: "publish expired" }));

const knowledgeJson = JSON.parse(await readFile(path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "knowledge", "project-knowledge.json"), "utf8"));
const persistedItem = knowledgeJson.knowledge.items.find((item) => item.id === itemId);
assert(persistedItem.status === "published", "project knowledge json did not persist published status");
assert(persistedItem.reviewedContentHash, "project knowledge json did not persist review hash");
const knowledgeMarkdown = await readFile(path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "knowledge", "project-knowledge.md"), "utf8");
assert(knowledgeMarkdown.includes("审核："), "knowledge markdown missing review summary");
pass("reviewPublishPersistsProjectKnowledge");

const searchResults = await store.search("采购审批审核门候选");
assert(searchResults.some((item) => item.type === "knowledge" && item.projectId === project.id), "search did not find published reviewed knowledge");
pass("searchFindsReviewedPublishedKnowledge");

const sensitiveItemId = await importCandidate(store, project.id, "发布时敏感重扫候选");
await mutateKnowledgeItem(project.id, sensitiveItemId, (item) => {
  item.content = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz";
  item.reviewedAt = new Date().toISOString();
  item.reviewer = "演示用户";
  item.reviewNote = "恶意构造的审核记录应该仍被发布时重扫拦截。";
  item.reviewChecklist = checklist;
  item.reviewedContentHash = reviewHash(item);
});
await assertRejects("publishSensitiveReviewedCandidateBlocked", () => store.publishKnowledge(project.id, { itemId: sensitiveItemId, note: "publish sensitive" }));

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
assert(appSource.includes("workbench:knowledge-review-for-publish"), "missing review IPC marker");
assert(appSource.includes("parseKnowledgeReviewInput"), "missing review parser marker");
assert(appSource.includes("reviewKnowledgeItemForPublish"), "missing review transition marker");
assert(appSource.includes("assertReviewedContentUnchanged"), "missing review tamper guard marker");

function extractBlock(file, startMarker, endMarker) {
  const source = sourceByFile[file];
  const start = source.indexOf(startMarker);
  assert(start >= 0, "missing block start: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, "missing block end for: " + startMarker);
  return source.slice(start, end);
}

const reviewBlocks = [
  extractBlock("apps/desktop/src/main/workspaceStore.ts", "async reviewKnowledgeForPublish(projectId: string, input: unknown)", "async markKnowledgeConflicted"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function parseKnowledgeReviewInput", "function assertStrictKnowledgeProjectId"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function reviewKnowledgeItemForPublish", "export function publishKnowledgeItem"),
  extractBlock("apps/desktop/src/renderer/KnowledgeCenter.tsx", "async function runReview", "async function submitImport")
];
for (const block of reviewBlocks) {
  for (const forbidden of ["showOpenDialog", "dialog.show", "openExternal", "loadURL", "feishu-sync", "readFile(", "fetch(", "execFile(", "spawn(", "exec(", "openPath(", "unlink", "rm("]) {
    assert(!block.includes(forbidden), "review gate block contains forbidden marker: " + forbidden);
  }
}
pass("noUnsafeReviewGateCapabilities");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase19-probe-entry.ts",
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
