import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase22-knowledge-context-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const statePath = path.join(isolatedRepoRoot, "local-data", "workbench", "app-state.json");
const PHASE22_MARKER = "phase22-published-knowledge-case-context";
const FULL_BODY_MARKER = "FULLBODYMARK22";
const SAFE_SUMMARY_MARKER = "phase22-local-note";

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

function activeCase(state) {
  const project = activeProject(state);
  return project.cases.find((caseItem) => caseItem.id === state.activeCaseId);
}

const checklist = {
  sourceAndScopeConfirmed: true,
  noSecretsConfirmed: true,
  noSapSourceOrWriteOpsConfirmed: true,
  noCustomerDetailsConfirmed: true
};

async function importCandidate(store, projectId, title, body = null) {
  const result = await store.importKnowledgeLocalText({
    projectId,
    title,
    sourceKind: "local-text",
    sourceName: "phase22-local-note",
    body: body ?? title + " can be reused after human review. It is safe, scoped, and contains no system secrets.",
    sapObjects: ["ZPHASE22"]
  });
  return result.knowledgeItemId;
}

async function publishImportedCandidate(store, projectId, title) {
  const itemId = await importCandidate(
    store,
    projectId,
    title,
    "Approved process summary for phase twenty two. " + FULL_BODY_MARKER + " internal detail stays outside model context."
  );
  await store.reviewKnowledgeForPublish(projectId, {
    itemId,
    note: "Human review confirmed the source scope and safety boundary for reuse.",
    checklist
  });
  const state = await store.publishKnowledge(projectId, { itemId, note: "Approved for formal knowledge reuse." });
  return { state, itemId };
}

async function mutateProjectKnowledge(projectId, mutator) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const project = state.projects.find((item) => item.id === projectId);
  assert(project, "project missing during mutation");
  mutator(project.knowledge);
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function mutateState(mutator) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  mutator(state);
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

function caseRoot(state) {
  const project = activeProject(state);
  const caseItem = activeCase(state);
  return path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
}

const store = new WorkspaceStore(isolatedRepoRoot);
const initialState = await store.createLocalProject({ name: "Phase22 Client", sapVersion: "S4", systemLabel: "LOCAL/022" });
const project = activeProject(initialState);
assert(project, "project missing");

const { itemId: publishedItemId } = await publishImportedCandidate(store, project.id, "Phase22 Published Reusable Knowledge");
const attachState = await store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: publishedItemId, note: "attach published summary" });
const attachProject = activeProject(attachState);
const attachCase = activeCase(attachState);
assert(attachCase.knowledgeReferences.length === 1, "published reference was not added to active case");
assert(attachCase.knowledgeReferences[0].itemId === publishedItemId, "wrong knowledge reference item id");
pass("publishedKnowledgeAttachSucceeds");

const rootAfterAttach = caseRoot(attachState);
const contextPack = await readFile(path.join(rootAfterAttach, "context_pack.md"), "utf8");
assert(contextPack.includes("Phase22 Published Reusable Knowledge"), "context pack missing referenced title");
assert(contextPack.includes(SAFE_SUMMARY_MARKER), "context pack missing safe imported summary");
pass("contextPackReferencesSafeSummary");
assert(!contextPack.includes(FULL_BODY_MARKER), "context pack leaked full knowledge body");
pass("contextPackDoesNotContainFullKnowledgeContent");

const metadata = JSON.parse(await readFile(path.join(rootAfterAttach, "metadata.json"), "utf8"));
assert(metadata.knowledgeReferences.length === 1, "metadata missing knowledge reference");
assert(metadata.knowledgeReferences[0].itemId === publishedItemId, "metadata recorded wrong reference item id");
assert(metadata.knowledgeReferences[0].sourceFilePath === null, "metadata leaked source file path");
assert(!JSON.stringify(metadata).includes(FULL_BODY_MARKER), "metadata leaked full knowledge body");
pass("metadataContainsReference");

const timeline = await readFile(path.join(rootAfterAttach, "timeline.md"), "utf8");
assert(!timeline.includes(PHASE22_MARKER), "timeline leaked internal phase marker");
assert(timeline.includes("Phase22 Published Reusable Knowledge"), "timeline missing referenced title");
pass("timelineContainsPhase22Reference");

const duplicateState = await store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: publishedItemId, note: "attach duplicate summary" });
const duplicateCase = activeCase(duplicateState);
assert(duplicateCase.knowledgeReferences.filter((item) => item.itemId === publishedItemId).length === 1, "duplicate attach created multiple references");
pass("duplicateAttachRemainsSingleReference");

const pendingItemId = await importCandidate(store, project.id, "Phase22 Pending Candidate");
await assertRejects("pendingKnowledgeAttachBlocked", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: pendingItemId, note: "try pending" }));

const draftItemId = await importCandidate(store, project.id, "Phase22 Draft Candidate");
await mutateProjectKnowledge(project.id, (knowledge) => {
  const item = knowledge.items.find((candidate) => candidate.id === draftItemId);
  assert(item, "draft item missing");
  item.status = "draft";
});
await assertRejects("draftKnowledgeAttachBlocked", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: draftItemId, note: "try draft" }));

const conflictedItemId = await importCandidate(store, project.id, "Phase22 Conflicted Candidate");
await store.markKnowledgeConflicted(project.id, { itemId: conflictedItemId, note: "mark conflicted for probe" });
await assertRejects("conflictedKnowledgeAttachBlocked", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: conflictedItemId, note: "try conflict" }));

const expiredItemId = await importCandidate(store, project.id, "Phase22 Expired Candidate");
await store.expireKnowledge(project.id, { itemId: expiredItemId, note: "mark expired for probe" });
await assertRejects("expiredKnowledgeAttachBlocked", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: expiredItemId, note: "try expired" }));

const unreviewedPublishedItemId = "phase22-unreviewed-published";
await mutateProjectKnowledge(project.id, (knowledge) => {
  knowledge.items.push({
    id: unreviewedPublishedItemId,
    projectId: project.id,
    title: "Phase22 Unreviewed Published Knowledge",
    type: "case_note",
    status: "published",
    sourceType: "case-candidate",
    sourceCaseId: null,
    sourceFilePath: "C:/customer/internal/source.md",
    sapObjects: ["ZPHASE22"],
    summary: "This item was marked published without a human review record.",
    content: "Published status alone is not enough for case context reuse.",
    confidence: null,
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
    publishedAt: "2026-07-04T00:00:00.000Z",
    timeline: [{ id: "phase22-unreviewed", at: "2026-07-04T00:00:00.000Z", action: "published", note: "probe unreviewed publish" }]
  });
});
await assertRejects("unreviewedPublishedKnowledgeAttachBlocked", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: unreviewedPublishedItemId, note: "try unreviewed published" }));

await mutateState((state) => {
  const pollutedProject = state.projects.find((item) => item.id === project.id);
  const pollutedCase = pollutedProject.cases.find((caseItem) => caseItem.id === state.activeCaseId);
  pollutedCase.knowledgeReferences = [
    ...pollutedCase.knowledgeReferences,
    {
      itemId: unreviewedPublishedItemId,
      title: "Polluted Unreviewed Reference",
      summary: "Polluted reference should be removed during state normalization.",
      sourceType: "case-candidate",
      sourceCaseId: null,
      sourceFilePath: "C:/customer/internal/source.md",
      sapObjects: ["ZBAD"],
      publishedAt: "2026-07-04T00:00:00.000Z",
      attachedAt: "2026-07-04T00:10:00.000Z"
    },
    {
      itemId: "../bad",
      title: "Polluted Invalid Reference",
      summary: "Invalid reference should be removed during state normalization.",
      sourceType: "manual",
      sourceCaseId: null,
      sourceFilePath: "C:/customer/internal/invalid.md",
      sapObjects: [],
      publishedAt: "2026-07-04T00:00:00.000Z",
      attachedAt: "2026-07-04T00:11:00.000Z"
    }
  ];
});
const cleanedState = await store.getState();
const cleanedCase = activeCase(cleanedState);
assert(cleanedCase.knowledgeReferences.length === 1, "polluted persisted references were not pruned");
assert(cleanedCase.knowledgeReferences[0].itemId === publishedItemId, "valid published reviewed reference was not preserved");
assert(cleanedCase.knowledgeReferences[0].sourceFilePath === null, "cleaned reference retained source path");
pass("pollutedPersistedReferencesPruned");

await store.createLocalProject({ name: "Phase22 Other Client", sapVersion: "ECC", systemLabel: "LOCAL/999" });
await assertRejects("wrongProjectKnowledgeAttachBlocked", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: publishedItemId, note: "try wrong project" }));

await assertRejects("attachRejectsExtraFields", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: publishedItemId, status: "published", note: "extra field" }));
await assertRejects("attachRejectsInvalidItemId", () => store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: "../bad", note: "bad id" }));

const sourceFiles = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/knowledgeService.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/main/caseWorkflowService.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts",
  "apps/desktop/src/renderer/App.tsx",
  "apps/desktop/src/renderer/KnowledgeCenter.tsx"
];
const sourceByFile = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(path.join(repoRoot, file), "utf8")])));
const appSource = Object.values(sourceByFile).join("\\n");
for (const marker of ["workbench:knowledge-attach-to-current-case", "parseKnowledgeCaseReferenceInput", "createCaseKnowledgeReference", "attachPublishedKnowledgeToCurrentCase", "attachKnowledgeToCurrentCase", "runAttachToCase", PHASE22_MARKER]) {
  assert(appSource.includes(marker), "missing phase22 marker: " + marker);
}

function extractBlock(file, startMarker, endMarker) {
  const source = sourceByFile[file];
  const start = source.indexOf(startMarker);
  assert(start >= 0, "missing block start: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, "missing block end for: " + startMarker);
  return source.slice(start, end);
}

const attachBlocks = [
  extractBlock("apps/desktop/src/main/workspaceStore.ts", "async attachPublishedKnowledgeToCurrentCase(projectId: string, input: unknown)", "async markKnowledgeConflicted"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function parseKnowledgeCaseReferenceInput", "export function parseKnowledgeReviewInput"),
  extractBlock("apps/desktop/src/main/knowledgeService.ts", "export function createCaseKnowledgeReference", "export function knowledgeCounts"),
  extractBlock("apps/desktop/src/renderer/KnowledgeCenter.tsx", "async function runAttachToCase", "async function runReview")
];
for (const block of attachBlocks) {
  for (const forbidden of ["showOpenDialog", "dialog.show", "readFile(", "fetch(", "execFile(", "spawn(", "exec(", "openExternal", "openPath", "loadURL", "feishu-sync", "unlink", "rm(", "publishKnowledgeItem", "content:"]) {
    assert(!block.includes(forbidden), "phase22 attach block contains forbidden marker: " + forbidden);
  }
}
pass("noUnsafeKnowledgeAttachCapabilities");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase22-probe-entry.ts",
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
