import { createHash } from "node:crypto";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase21-knowledge-edit-"));
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
const PHASE21_MARKER = "phase21-knowledge-edit-conflict-resolution";

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

const checklist = {
  sourceAndScopeConfirmed: true,
  noSecretsConfirmed: true,
  noSapSourceOrWriteOpsConfirmed: true,
  noCustomerDetailsConfirmed: true
};

async function mutateKnowledgeItem(projectId, itemId, mutator) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const project = state.projects.find((item) => item.id === projectId);
  assert(project, "project missing during mutation");
  const item = project.knowledge.items.find((candidate) => candidate.id === itemId);
  assert(item, "knowledge item missing during mutation");
  mutator(item);
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function mutateProjectKnowledge(projectId, mutator) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const project = state.projects.find((item) => item.id === projectId);
  assert(project, "project missing during knowledge mutation");
  mutator(project.knowledge);
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function importCandidate(store, projectId, title, body = null) {
  const result = await store.importKnowledgeLocalText({
    projectId,
    title,
    sourceKind: "local-text",
    sourceName: "本地粘贴文本",
    body: body ?? title + "以当前项目确认的业务范围为准，历史口径仅作为参考，审核后才能成为正式知识。",
    sapObjects: ["ZMM_EDIT"]
  });
  return result.knowledgeItemId;
}

function editInput(itemId, overrides = {}) {
  const objectSuffix = [...itemId].reduce((total, character) => (total + character.codePointAt(0)) % 100000, 0);
  return {
    itemId,
    title: "采购审批口径修订候选",
    summary: "采购审批口径已经按当前项目范围修订，等待人工重新审核。",
    content: "采购审批口径按当前项目范围执行，历史口径只作为参考。该候选经过修改后必须重新审核才能入库。",
    sapObjects: ["ZMM_EDIT_" + objectSuffix],
    effectiveFrom: "2026-07-04",
    effectiveTo: null,
    note: "修订适用范围",
    ...overrides
  };
}

const store = new WorkspaceStore(isolatedRepoRoot);
const initialState = await store.createLocalProject({ name: "Phase21 Client", sapVersion: "S4", systemLabel: "LOCAL/021" });
const project = activeProject(initialState);
assert(project, "project missing");

const nonImportCandidateId = "knowledge-probe-non-import-phase21";
await mutateProjectKnowledge(project.id, (knowledge) => {
  knowledge.items.push({
    id: nonImportCandidateId,
    projectId: project.id,
    title: "普通案件候选待编辑",
    type: "case_note",
    status: "pending",
    sourceType: "case-candidate",
    sourceCaseId: null,
    sourceFilePath: null,
    sapObjects: ["ZMM_MANUAL"],
    summary: "普通案件候选用于验证编辑后复审门。",
    content: "普通案件候选不是文本导入候选，但被编辑后仍必须重新审核才能入库。",
    effectiveFrom: null,
    effectiveTo: null,
    reviewer: null,
    reviewedAt: null,
    reviewNote: null,
    reviewedContentHash: null,
    reviewChecklist: null,
    conflictWithIds: [],
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    publishedAt: null,
    timeline: [{ id: "ke-probe-non-import", at: "2026-07-04T00:00:00.000Z", action: "created", note: "probe-created non-import candidate" }]
  });
  knowledge.updatedAt = "2026-07-04T00:00:00.000Z";
});
await store.editKnowledgeCandidate(project.id, editInput(nonImportCandidateId, {
  title: "普通案件候选编辑后必须复审",
  summary: "普通案件候选经过 Phase 21 编辑后，也必须先记录人工审核。",
  content: "普通案件候选被人工编辑后必须重新审核，不能因为它不是文本导入候选就直接入库。",
  note: "普通候选编辑复审"
}));
await assertRejects("publishEditedNonImportCandidateBeforeReviewBlocked", () => store.publishKnowledge(project.id, { itemId: nonImportCandidateId, note: "try publish edited non-import" }));
await store.reviewKnowledgeForPublish(project.id, {
  itemId: nonImportCandidateId,
  note: "普通案件候选编辑后已重新确认来源范围和安全边界。",
  checklist
});
const publishedNonImportState = await store.publishKnowledge(project.id, { itemId: nonImportCandidateId, note: "普通候选复审后确认入库。" });
const publishedNonImportProject = activeProject(publishedNonImportState);
const publishedNonImportItem = publishedNonImportProject.knowledge.items.find((item) => item.id === nonImportCandidateId);
assert(publishedNonImportItem.status === "published", "edited non-import candidate did not publish after re-review");
pass("editNonImportCandidateReReviewThenPublishSucceeds");

const pendingItemId = await importCandidate(store, project.id, "待编辑候选");
const editedPendingState = await store.editKnowledgeCandidate(project.id, editInput(pendingItemId, {
  title: "编辑后的待确认知识",
  summary: "编辑后的摘要包含新的可检索关键词 phase21-edit-search-key。",
  content: "编辑后的正文只记录脱敏业务结论，包含 phase21-edit-search-key，等待重新审核后才能入库。",
  note: "修订正文范围"
}));
const editedPendingProject = activeProject(editedPendingState);
const editedPendingItem = editedPendingProject.knowledge.items.find((item) => item.id === pendingItemId);
assert(editedPendingItem.status === "pending", "edited pending item must remain pending");
assert(editedPendingItem.publishedAt === null, "edit must not publish");
assert(editedPendingItem.reviewedAt === null, "edit must keep unreviewed candidate unreviewed");
assert(editedPendingItem.timeline.some((event) => event.action === "edited" && event.note.includes(PHASE21_MARKER)), "edit timeline marker missing");
pass("editPendingCandidateStaysPending");

const searchResults = await store.search("phase21-edit-search-key");
assert(searchResults.some((item) => item.type === "knowledge" && item.projectId === project.id), "search did not find edited content");
pass("searchFindsEditedKnowledge");

const reviewedItemId = await importCandidate(store, project.id, "审核后再编辑候选");
await store.reviewKnowledgeForPublish(project.id, {
  itemId: reviewedItemId,
  note: "已确认来源和适用范围，可以等待发布。",
  checklist
});
const reviewedBeforeEditView = await store.getProjectKnowledge(project.id);
const reviewedBeforeEdit = reviewedBeforeEditView.items.find((item) => item.id === reviewedItemId);
assert(reviewedBeforeEdit.reviewedContentHash === reviewHash(reviewedBeforeEdit), "review hash not recorded before edit");

const editedReviewedState = await store.editKnowledgeCandidate(project.id, editInput(reviewedItemId, { note: "审核后修订内容" }));
const editedReviewedProject = activeProject(editedReviewedState);
const editedReviewedItem = editedReviewedProject.knowledge.items.find((item) => item.id === reviewedItemId);
assert(editedReviewedItem.status === "pending", "edited reviewed item must return pending");
assert(editedReviewedItem.reviewedAt === null, "edit must clear reviewedAt");
assert(editedReviewedItem.reviewer === null, "edit must clear reviewer");
assert(editedReviewedItem.reviewNote === null, "edit must clear reviewNote");
assert(editedReviewedItem.reviewedContentHash === null, "edit must clear reviewedContentHash");
assert(editedReviewedItem.reviewChecklist === null, "edit must clear reviewChecklist");
pass("editClearsReviewMetadata");

await assertRejects("publishEditedCandidateBeforeReReviewBlocked", () => store.publishKnowledge(project.id, { itemId: reviewedItemId, note: "try publish after edit" }));
await store.reviewKnowledgeForPublish(project.id, {
  itemId: reviewedItemId,
  note: "编辑后的内容已重新确认来源、范围和脱敏状态。",
  checklist
});
const publishedEditedState = await store.publishKnowledge(project.id, { itemId: reviewedItemId, note: "重新审核后确认入库。" });
const publishedEditedProject = activeProject(publishedEditedState);
const publishedEditedItem = publishedEditedProject.knowledge.items.find((item) => item.id === reviewedItemId);
assert(publishedEditedItem.status === "published", "edited candidate did not publish after re-review");
pass("editReReviewThenPublishSucceeds");

await assertRejects("editPublishedKnowledgeBlocked", () => store.editKnowledgeCandidate(project.id, editInput(reviewedItemId, { note: "尝试编辑发布知识" })));
await assertRejects("markPublishedKnowledgeConflictBlocked", () => store.markKnowledgeConflicted(project.id, { itemId: reviewedItemId, note: "try conflict published" }));
const expiredPublishedState = await store.expireKnowledge(project.id, { itemId: reviewedItemId, note: "人工确认该正式知识已经失效。" });
const expiredPublishedItem = activeProject(expiredPublishedState).knowledge.items.find((item) => item.id === reviewedItemId);
assert(expiredPublishedItem.status === "expired", "published knowledge should support audited expiration");
pass("expirePublishedKnowledgeAudited");

const expiredItemId = await importCandidate(store, project.id, "已失效编辑候选");
await store.expireKnowledge(project.id, { itemId: expiredItemId, note: "人工标记失效。" });
await assertRejects("editExpiredKnowledgeBlocked", () => store.editKnowledgeCandidate(project.id, editInput(expiredItemId, { note: "尝试编辑失效知识" })));

await assertRejects("editRejectsExtraFields", () => store.editKnowledgeCandidate(project.id, { ...editInput(pendingItemId), status: "published" }));
await assertRejects("editRejectsReviewerField", () => store.editKnowledgeCandidate(project.id, { ...editInput(pendingItemId), reviewer: "bad actor" }));
await assertRejects("editRejectsReviewedAtField", () => store.editKnowledgeCandidate(project.id, { ...editInput(pendingItemId), reviewedAt: "2026-07-04T00:00:00.000Z" }));
await assertRejects("editRejectsReviewedHashField", () => store.editKnowledgeCandidate(project.id, { ...editInput(pendingItemId), reviewedContentHash: "a".repeat(64) }));
await assertRejects("editRejectsReviewChecklistField", () => store.editKnowledgeCandidate(project.id, { ...editInput(pendingItemId), reviewChecklist: checklist }));
await assertRejects("editRejectsPublishedAtField", () => store.editKnowledgeCandidate(project.id, { ...editInput(pendingItemId), publishedAt: "2026-07-04T00:00:00.000Z" }));
await assertRejects("editRejectsSourceFilePathField", () => store.editKnowledgeCandidate(project.id, { ...editInput(pendingItemId), sourceFilePath: "knowledge/manual.md" }));
await assertRejects("editRejectsInvalidItemId", () => store.editKnowledgeCandidate(project.id, editInput("../bad", { note: "非法知识编号" })));
await assertRejects("editRejectsSecretBody", () => store.editKnowledgeCandidate(project.id, editInput(pendingItemId, { content: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz", note: "敏感内容测试" })));
await assertRejects("editRejectsFeishuUrl", () => store.editKnowledgeCandidate(project.id, editInput(pendingItemId, { content: "请查看 https://open.feishu.cn/document/abcdefghi", note: "飞书链接测试" })));
await assertRejects("editRejectsBodyPath", () => store.editKnowledgeCandidate(project.id, editInput(pendingItemId, { content: "请读取 C:/Users/admin/.env 后入库。", note: "路径内容测试" })));
await assertRejects("editRejectsAbapSource", () => store.editKnowledgeCandidate(project.id, editInput(pendingItemId, { content: "REPORT zunsafe.\\nDATA lv_value TYPE string.", note: "源码内容测试" })));
await assertRejects("editRejectsSapWriteSnippet", () => store.editKnowledgeCandidate(project.id, editInput(pendingItemId, { content: "UPDATE mara SET matnr = 'X'.", note: "写操作测试" })));
await assertRejects("editRejectsStructuredRows", () => store.editKnowledgeCandidate(project.id, editInput(pendingItemId, {
  content: ["a,b,c,d,e", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5", "1,2,3,4,5"].join("\\n"),
  note: "表格明细测试"
})));
await assertRejects("editRejectsUnsafeSapObjectLabel", () => store.editKnowledgeCandidate(project.id, editInput(pendingItemId, { sapObjects: ["C:/Users/admin/.env"], note: "对象标签测试" })));

const conflictItemId = await importCandidate(store, project.id, "冲突编辑候选");
await store.markKnowledgeConflicted(project.id, { itemId: conflictItemId, note: "人工标记冲突。" });
await mutateKnowledgeItem(project.id, conflictItemId, (item) => {
  item.conflictWithIds = [reviewedItemId];
});
const editedConflictState = await store.editKnowledgeCandidate(project.id, editInput(conflictItemId, {
  title: "冲突修订后候选",
  note: "修订冲突范围"
}));
const editedConflictProject = activeProject(editedConflictState);
const editedConflictItem = editedConflictProject.knowledge.items.find((item) => item.id === conflictItemId);
assert(editedConflictItem.status === "pending", "edited conflicted item must return pending");
assert(editedConflictItem.conflictWithIds.length === 0, "edit must clear conflict links");
assert(editedConflictItem.reviewedContentHash === null, "edited conflict item must need review");
pass("editConflictedCandidateReturnsPending");
await assertRejects("publishEditedConflictBeforeReviewBlocked", () => store.publishKnowledge(project.id, { itemId: conflictItemId, note: "try publish edited conflict" }));

const persistedJson = JSON.parse(await readFile(path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "knowledge", "project-knowledge.json"), "utf8"));
const persistedConflictItem = persistedJson.knowledge.items.find((item) => item.id === conflictItemId);
assert(persistedConflictItem.status === "pending", "project knowledge json did not persist edited conflict status");
assert(persistedJson.knowledge.items.length >= 4, "knowledge history was unexpectedly removed");
pass("editPersistsWithoutDeletingHistory");

const sourceFiles = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/knowledgeService.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts",
  "apps/desktop/src/renderer/App.tsx",
  "apps/desktop/src/renderer/KnowledgeCenter.tsx"
];
const sourceByFile = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(path.join(repoRoot, file), "utf8")])));
const appSource = Object.values(sourceByFile).join("\\n");
for (const marker of ["workbench:knowledge-edit-candidate", "parseKnowledgeEditInput", "KNOWLEDGE_EDIT_ALLOWED_KEYS", "editKnowledgeCandidate", "requiresHumanReviewBeforePublish", PHASE21_MARKER]) {
  assert(appSource.includes(marker), "missing phase21 marker: " + marker);
}
for (const forbiddenInput of ["status", "reviewer", "reviewedAt", "reviewedContentHash", "reviewChecklist", "publishedAt", "sourceFilePath"]) {
  const allowedKeysLine = sourceByFile["apps/desktop/src/main/knowledgeService.ts"].split(/\\r?\\n/).find((line) => line.includes("KNOWLEDGE_EDIT_ALLOWED_KEYS"));
  assert(allowedKeysLine && !allowedKeysLine.includes('"' + forbiddenInput + '"'), "edit allowed keys include forbidden field: " + forbiddenInput);
}

function extractBlock(file, startMarker, endMarker) {
  const source = sourceByFile[file];
  const start = source.indexOf(startMarker);
  assert(start >= 0, "missing block start: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, "missing block end for: " + startMarker);
  return source.slice(start, end);
}

const editBlocks = [
  extractBlock("apps/desktop/src/main/workspaceStore.ts", "async editKnowledgeCandidate(projectId: string, input: unknown)", "async markKnowledgeConflicted"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function parseKnowledgeEditInput", "function assertStrictKnowledgeProjectId"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function editKnowledgeCandidate", "export function publishKnowledgeItem"),
  extractBlock("apps/desktop/src/renderer/KnowledgeCenter.tsx", "async function runEdit", "function restoreEditFields")
];
for (const block of editBlocks) {
  for (const forbidden of ["showOpenDialog", "dialog.show", "readFile(", "fetch(", "execFile(", "spawn(", "exec(", "openExternal", "openPath", "loadURL", "feishu-sync", "unlink", "rm(", "status: \\"published\\"", "publishedAt:", "publishKnowledgeItem"]) {
    assert(!block.includes(forbidden), "phase21 edit block contains forbidden marker: " + forbidden);
  }
}
pass("noUnsafeKnowledgeEditCapabilities");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase21-probe-entry.ts",
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
