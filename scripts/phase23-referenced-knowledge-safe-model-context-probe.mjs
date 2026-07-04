import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase23-safe-knowledge-context-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const PHASE23_MARKER = "phase23-referenced-knowledge-safe-model-context-probe";

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertNoUnsafeModelContextText,
  buildSafeModelDraftContext
} from "./apps/desktop/src/main/safeModelCaseDraftService.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const PHASE23_MARKER = ${JSON.stringify(PHASE23_MARKER)};
const statePath = path.join(isolatedRepoRoot, "local-data", "workbench", "app-state.json");
const FULL_BODY_MARKER = "FULL_BODY_SHOULD_NOT_ENTER_MODEL_PHASE23";
const SAFE_SUMMARY_MARKER = "PHASE23_SAFE_REUSABLE_SUMMARY";

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

function activeProject(state) {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function activeCase(state) {
  const project = activeProject(state);
  return project.cases.find((caseItem) => caseItem.id === state.activeCaseId);
}

function provider(id, name, models, overrides = {}) {
  return {
    id,
    name,
    providerType: "openai-compatible",
    baseUrl: "https://fake-models.test/v1",
    enabled: true,
    credential: {
      secretRef: null,
      kind: "api-key",
      store: "electron-safe-storage",
      state: "set-in-secure-store",
      updatedAt: "2026-07-04T00:00:00.000Z"
    },
    models,
    modelSyncStatus: "verified",
    chatTestStatus: "verified",
    lastVerificationMode: "fake",
    lastVerifiedModelId: models[0]?.id ?? null,
    lastCheckedAt: "2026-07-04T00:00:00.000Z",
    ...overrides
  };
}

const directContext = buildSafeModelDraftContext({
  taskMode: "problem-analysis",
  taskLabel: "问题分析",
  userInput: "请结合当前案件和已发布知识摘要生成安全草稿。",
  caseTitle: "Phase23 Safe Knowledge Case",
  caseSummary: "当前案件需要复用人工审核后的项目经验摘要。",
  sapVersion: "S4",
  standardsSummary: "项目规范摘要仅包含安全概览。",
  knowledgeReferences: [
    {
      title: "Phase23 Published Rule",
      summary: SAFE_SUMMARY_MARKER,
      sourceType: "case-candidate",
      sapObjects: ["ZPHASE23"],
      publishedAt: "2026-07-04T00:00:00.000Z",
      attachedAt: "2026-07-04T00:01:00.000Z"
    }
  ],
  safeOutputSummaries: []
});
const serializedDirectContext = JSON.stringify(directContext);
assert(serializedDirectContext.includes("Phase23 Published Rule"), "referenced knowledge title missing from direct context");
assert(serializedDirectContext.includes(SAFE_SUMMARY_MARKER), "referenced knowledge summary missing from direct context");
assert(directContext.audit.referencedKnowledgeCount === 1, "direct context audit did not count referenced knowledge");
for (const forbidden of [FULL_BODY_MARKER, "sourceFilePath", "C:/customer/internal/source.md", "KnowledgeItem.content"]) {
  assert(!serializedDirectContext.includes(forbidden), "forbidden marker leaked into direct context: " + forbidden);
}
pass("directKnowledgeSummaryOnly");

assertThrows("unsafeReferenceTextBlocked", () => buildSafeModelDraftContext({
  taskMode: "problem-analysis",
  taskLabel: "问题分析",
  userInput: "safe input",
  caseTitle: "safe case",
  caseSummary: "safe summary",
  sapVersion: "S4",
  standardsSummary: "safe standards",
  knowledgeReferences: [
    {
      title: "Unsafe Reference",
      summary: "api_key = abcdefghijklmnop",
      sourceType: "case-candidate",
      sapObjects: ["ZPHASE23"],
      publishedAt: "2026-07-04T00:00:00.000Z",
      attachedAt: "2026-07-04T00:01:00.000Z"
    }
  ],
  safeOutputSummaries: []
}));
assertThrows("unsafeDirectGuardStillBlocks", () => assertNoUnsafeModelContextText("phase23", "Bearer abcdefghijklmnopqrstuvwxyz"));

const checklist = {
  sourceAndScopeConfirmed: true,
  noSecretsConfirmed: true,
  noSapSourceOrWriteOpsConfirmed: true,
  noCustomerDetailsConfirmed: true
};

async function importCandidate(store, projectId, title, body) {
  const result = await store.importKnowledgeLocalText({
    projectId,
    title,
    sourceKind: "local-text",
    sourceName: SAFE_SUMMARY_MARKER,
    body,
    sapObjects: ["ZPHASE23"]
  });
  return result.knowledgeItemId;
}

async function publishReviewedCandidate(store, projectId) {
  const itemId = await importCandidate(
    store,
    projectId,
    "Phase23 Published Knowledge",
    "Reviewed reusable case summary for phase twenty three. " + SAFE_SUMMARY_MARKER + " " + FULL_BODY_MARKER
  );
  await store.reviewKnowledgeForPublish(projectId, {
    itemId,
    note: "Human review confirmed this safe summary can be reused in the current project.",
    checklist
  });
  await store.publishKnowledge(projectId, { itemId, note: "Approved for safe referenced context." });
  return itemId;
}

async function mutateState(mutator) {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  mutator(state);
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

const store = new WorkspaceStore(isolatedRepoRoot);
await mkdir(isolatedRepoRoot, { recursive: true });
const initialState = await store.createLocalProject({ name: "Phase23 Client", sapVersion: "S4", systemLabel: "LOCAL/023" });
const project = activeProject(initialState);
assert(project, "project missing");

await mutateState((state) => {
  const stateProject = activeProject(state);
  stateProject.config.apiProviders = [
    provider("provider-phase23", "Provider Phase23", [
      { id: "phase23-safe-model", displayName: "Phase23 Safe Model", capabilities: ["chat"], lastSeenAt: "2026-07-04T00:00:00.000Z" }
    ])
  ];
});

const publishedItemId = await publishReviewedCandidate(store, project.id);
await store.attachPublishedKnowledgeToCurrentCase(project.id, { itemId: publishedItemId, note: "attach safe reviewed summary" });

await mutateState((state) => {
  const stateProject = activeProject(state);
  stateProject.knowledge.items.push({
    id: "phase23-unreviewed-published",
    projectId: stateProject.id,
    title: "Phase23 Unreviewed Published Knowledge",
    type: "case_note",
    status: "published",
    sourceType: "case-candidate",
    sourceCaseId: null,
    sourceFilePath: "C:/customer/internal/source.md",
    sapObjects: ["ZBAD23"],
    summary: "This polluted summary must not enter the safe model context.",
    content: "Unreviewed full body must not enter model context.",
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
    timeline: [{ id: "phase23-unreviewed", at: "2026-07-04T00:00:00.000Z", action: "published", note: "probe unreviewed published state" }]
  });
  stateProject.knowledge.items.push({
    id: "phase23-fake-reviewed-published",
    projectId: stateProject.id,
    title: "Phase23 Fake Reviewed Published Knowledge",
    type: "case_note",
    status: "published",
    sourceType: "case-candidate",
    sourceCaseId: null,
    sourceFilePath: null,
    sapObjects: ["ZBADHASH23"],
    summary: "fake reviewed polluted summary must stay out",
    content: "Fake reviewed item body changed after review.",
    confidence: null,
    effectiveFrom: null,
    effectiveTo: null,
    reviewer: "演示用户",
    reviewedAt: "2026-07-04T00:00:00.000Z",
    reviewNote: "Fake review record has a valid-looking note but an invalid content hash.",
    reviewedContentHash: "0".repeat(64),
    reviewChecklist: checklist,
    conflictWithIds: [],
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    publishedAt: "2026-07-04T00:00:00.000Z",
    timeline: [{ id: "phase23-fake-reviewed", at: "2026-07-04T00:00:00.000Z", action: "published", note: "probe fake reviewed published state" }]
  });
  const stateCase = activeCase(state);
  stateCase.knowledgeReferences.push(
    {
      itemId: "phase23-unreviewed-published",
      title: "Polluted Unreviewed Reference",
      summary: "POLLUTED_UNREVIEWED_REFERENCE_SHOULD_NOT_ENTER_MODEL",
      sourceType: "case-candidate",
      sourceCaseId: null,
      sourceFilePath: "C:/customer/internal/source.md",
      sapObjects: ["ZBAD23"],
      publishedAt: "2026-07-04T00:00:00.000Z",
      attachedAt: "2026-07-04T00:10:00.000Z"
    },
    {
      itemId: "phase23-fake-reviewed-published",
      title: "Fake Reviewed Reference",
      summary: "fake reviewed polluted summary must stay out",
      sourceType: "case-candidate",
      sourceCaseId: null,
      sourceFilePath: null,
      sapObjects: ["ZBADHASH23"],
      publishedAt: "2026-07-04T00:00:00.000Z",
      attachedAt: "2026-07-04T00:10:30.000Z"
    },
    {
      itemId: "../bad",
      title: "Invalid Polluted Reference",
      summary: "POLLUTED_INVALID_REFERENCE_SHOULD_NOT_ENTER_MODEL",
      sourceType: "manual",
      sourceCaseId: null,
      sourceFilePath: "C:/customer/internal/invalid.md",
      sapObjects: [],
      publishedAt: "2026-07-04T00:00:00.000Z",
      attachedAt: "2026-07-04T00:11:00.000Z"
    }
  );
});

const prepared = await new WorkspaceStore(isolatedRepoRoot).prepareSafeModelDraftRequest({
  content: "请结合已发布知识摘要生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-phase23",
  modelId: "phase23-safe-model"
}, { allowFakeModelExecution: true });
assert(prepared, "safe model request was not prepared");
assert(prepared.context.audit.referencedKnowledgeCount === 1, "prepared context should include exactly one cleaned reference");
const serializedPreparedContext = JSON.stringify(prepared.context);
assert(serializedPreparedContext.includes("Phase23 Published Knowledge"), "valid published knowledge title missing from prepared context");
assert(serializedPreparedContext.includes(SAFE_SUMMARY_MARKER), "valid published knowledge summary missing from prepared context");
for (const forbidden of [
  FULL_BODY_MARKER,
  "POLLUTED_UNREVIEWED_REFERENCE_SHOULD_NOT_ENTER_MODEL",
  "fake reviewed polluted summary must stay out",
  "POLLUTED_INVALID_REFERENCE_SHOULD_NOT_ENTER_MODEL",
  "C:/customer/internal/source.md",
  "sourceFilePath",
  "Unreviewed full body",
  "content:"
]) {
  assert(!serializedPreparedContext.includes(forbidden), "forbidden marker leaked into prepared context: " + forbidden);
}
pass("preparedContextUsesCleanedReviewedReferencesOnly");

const sourceFiles = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/main/safeModelCaseDraftService.ts",
  "apps/desktop/src/preload/preload.ts"
];
const sourceByFile = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(path.join(repoRoot, file), "utf8")])));
const appSource = Object.values(sourceByFile).join("\\n");
assert(PHASE23_MARKER.includes("safe-model-context-probe"), "phase23 marker missing");
for (const marker of [
  "SafeModelKnowledgeReferenceInput",
  "referencedKnowledgeCount",
  "已引用已发布知识摘要",
  "knowledgeReferences: currentCase.knowledgeReferences.map"
]) {
  assert(appSource.includes(marker), "missing phase23 marker: " + marker);
}
for (const forbidden of [
  "workbench:safe-model-draft",
  "chat-completions",
  "get-api-key",
  "read-api-key",
  "fetch-url",
  "proxy-request",
  "run-sql",
  "execute-sql",
  "feishu-sync",
  "openExternal",
  "openPath"
]) {
  assert(!appSource.includes(forbidden), "unsafe capability marker found: " + forbidden);
}
const serviceSource = sourceByFile["apps/desktop/src/main/safeModelCaseDraftService.ts"];
for (const forbidden of ["readFile", "readdir", "node:fs", "item.content", "sourceFilePath", "searchWorkbench", "previewCurrentCaseFile"]) {
  assert(!serviceSource.includes(forbidden), "safe model service contains forbidden marker: " + forbidden);
}
pass("noNewUnsafeCapabilities");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase23-probe-entry.ts",
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
