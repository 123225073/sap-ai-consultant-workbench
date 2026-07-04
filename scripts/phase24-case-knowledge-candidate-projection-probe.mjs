import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase24-case-knowledge-candidate-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const PHASE24_MARKER = "phase24-case-knowledge-candidate-projection";
const CANDIDATE_PATH = "knowledge_candidates/问题处理经验候选.md";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function activeProject(state) {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function activeCase(state) {
  const project = activeProject(state);
  return project.cases.find((caseItem) => caseItem.id === state.activeCaseId);
}

function caseRoot(state) {
  const project = activeProject(state);
  const caseItem = activeCase(state);
  return path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
}

function findCaseCandidate(items, caseItem) {
  return items.find((item) => item.sourceCaseId === caseItem.id && item.sourceFilePath === CANDIDATE_PATH);
}

const store = new WorkspaceStore(isolatedRepoRoot);
const initialState = await store.createLocalProject({ name: "Phase24 Client", sapVersion: "S4", systemLabel: "LOCAL/024" });
const project = activeProject(initialState);
const caseItem = activeCase(initialState);
assert(project && caseItem, "project or case missing");

const firstState = await store.appendMessage({
  content: "请沉淀本案件的处理经验：先本地保存结论和证据，再人工确认是否入库。",
  taskMode: "problem-analysis",
  modelId: "local-workflow"
});
const firstProject = activeProject(firstState);
const firstCase = activeCase(firstState);
const firstKnowledge = await store.getProjectKnowledge(firstProject.id);
const firstCandidate = findCaseCandidate(firstKnowledge.items, firstCase);
assert(firstCandidate, "case knowledge candidate was not created");
assert(firstCandidate.status === "pending", "candidate must remain pending");
assert(firstCandidate.sourceType === "case-candidate", "candidate source type mismatch");
assert(firstCandidate.sourceFilePath === CANDIDATE_PATH, "candidate source file mismatch");
assert(firstCandidate.content.includes("## 来源摘要"), "candidate content should include source summary");
assert(firstCandidate.content.includes("任务模式：问题分析"), "candidate content should include task mode");
assert(firstCandidate.content.includes("## 候选内容"), "candidate content should include candidate review section");
assert(firstCandidate.content.includes("入库前必须确认"), "candidate content should include review checklist");
assert(!firstCandidate.content.includes("Authorization:"), "candidate content leaked unsafe text");
assert(firstCandidate.reviewedContentHash === null, "case candidates must not start reviewed");
assert(firstCandidate.reviewedAt === null && firstCandidate.reviewer === null, "case candidates must not start with reviewer fields");
assert(firstCandidate.publishedAt === null, "phase24 must not auto-publish case candidates");
assert(firstCandidate.confidence === null, "case candidates should not show a fake confidence score");
pass("caseCandidateProjectsReviewableContent");

const candidateFile = await readFile(path.join(caseRoot(firstState), CANDIDATE_PATH), "utf8");
assert(candidateFile.includes("## 来源摘要"), "candidate file missing source summary");
assert(candidateFile.includes("## 入库前必须确认"), "candidate file missing review checklist");
pass("candidateFileContainsReviewSections");

const searchResults = await store.search("入库前必须确认");
assert(searchResults.some((item) => item.type === "knowledge" && item.projectId === firstProject.id), "search did not find projected candidate content");
pass("searchFindsProjectedCandidateContent");

const secondState = await store.appendMessage({
  content: "继续补充：候选知识仍然只能待确认，不能自动变成正式知识。",
  taskMode: "problem-analysis",
  modelId: "local-workflow"
});
const secondProject = activeProject(secondState);
const secondCase = activeCase(secondState);
const secondKnowledge = await store.getProjectKnowledge(secondProject.id);
const matchingCandidates = secondKnowledge.items.filter((item) => item.sourceCaseId === secondCase.id && item.sourceFilePath === CANDIDATE_PATH);
assert(matchingCandidates.length === 1, "refresh must not duplicate same case candidate");
const refreshedCandidate = matchingCandidates[0];
assert(refreshedCandidate.status === "pending", "refreshed candidate must remain pending");
assert(refreshedCandidate.publishedAt === null, "refreshed candidate must not be published");
assert(refreshedCandidate.reviewedContentHash === null, "refreshed candidate must clear review hash");
assert(refreshedCandidate.timeline.some((event) => event.action === "edited" && event.note.includes(PHASE24_MARKER)), "refresh timeline missing phase24 marker");
assert(refreshedCandidate.content.includes("候选内容"), "refreshed content lost reviewable candidate text");
pass("refreshUpdatesSinglePendingCandidate");

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

const checklist = {
  sourceAndScopeConfirmed: true,
  noSecretsConfirmed: true,
  noSapSourceOrWriteOpsConfirmed: true,
  noCustomerDetailsConfirmed: true
};

await assertRejects("publishCaseCandidateWithoutReviewBlocked", () =>
  store.publishKnowledge(secondProject.id, { itemId: refreshedCandidate.id, note: "try direct publish" })
);
await store.reviewKnowledgeForPublish(secondProject.id, {
  itemId: refreshedCandidate.id,
  note: "已确认案件候选的来源、范围和脱敏状态，可以进入正式知识库。",
  checklist
});
const publishedState = await store.publishKnowledge(secondProject.id, {
  itemId: refreshedCandidate.id,
  note: "案件候选经人工审核后确认入库。"
});
const publishedProject = activeProject(publishedState);
const publishedCase = activeCase(publishedState);
const publishedKnowledge = await store.getProjectKnowledge(publishedProject.id);
const publishedCandidate = publishedKnowledge.items.find((item) => item.id === refreshedCandidate.id);
assert(publishedCandidate.status === "published", "reviewed case candidate did not publish");
assert(publishedCandidate.reviewedContentHash, "published case candidate must keep review hash for reuse");
const attachedState = await store.attachPublishedKnowledgeToCurrentCase(publishedProject.id, {
  itemId: publishedCandidate.id,
  note: "attach reviewed case candidate"
});
const attachedCase = activeCase(attachedState);
assert(attachedCase.id === publishedCase.id, "attached state changed active case unexpectedly");
assert(attachedCase.knowledgeReferences.some((reference) => reference.itemId === publishedCandidate.id), "reviewed published case candidate cannot be reused by current case");
pass("reviewPublishAttachCaseCandidateClosesLoop");

const sourceFiles = [
  "apps/desktop/src/main/caseWorkflowService.ts",
  "apps/desktop/src/main/knowledgeService.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/renderer/KnowledgeCenter.tsx",
  "scripts/phase24-case-knowledge-candidate-projection-probe.mjs",
  "scripts/security-preflight.ps1"
];
const sourceByFile = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(path.join(repoRoot, file), "utf8")])));
const appSource = Object.values(sourceByFile).join("\\n");
for (const marker of [
  PHASE24_MARKER,
  "renderProblemAnalysisKnowledgeCandidate",
  "isCaseGeneratedKnowledgeCandidate",
  "caseCandidateProjection",
  "safeCaseCandidateContent",
  "phase24-case-knowledge-candidate-projection-probe"
]) {
  assert(appSource.includes(marker), "missing phase24 marker: " + marker);
}

function extractBlock(file, startMarker, endMarker) {
  const source = sourceByFile[file];
  const start = source.indexOf(startMarker);
  assert(start >= 0, "missing block start: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, "missing block end for: " + startMarker);
  return source.slice(start, end);
}

const caseRendererBlock = extractBlock(
  "apps/desktop/src/main/caseWorkflowService.ts",
  "function renderProblemAnalysisKnowledgeCandidate",
  "function modeFilePlan"
);
const projectionBlock = extractBlock(
  "apps/desktop/src/main/knowledgeService.ts",
  "function caseCandidateProjection",
  "export function appendKnowledgeCandidatesFromCase"
);
for (const block of [caseRendererBlock, projectionBlock]) {
  for (const forbidden of [
    "readFile(",
    "readdir",
    "node:fs",
    "fetch(",
    "execFile(",
    "spawn(",
    "openExternal",
    "openPath",
    "workbench:",
    "reviewKnowledgeItemForPublish",
    "publishKnowledgeItem",
    "status: \\"published\\"",
    "publishedAt: new Date"
  ]) {
    assert(!block.includes(forbidden), "phase24 candidate projection block contains forbidden marker: " + forbidden);
  }
}
pass("noUnsafeCaseCandidateProjectionCapabilities");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase24-probe-entry.ts",
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
