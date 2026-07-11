import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase40-knowledge-lifecycle-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

const entrySource = `
import {
  LOCAL_KNOWLEDGE_REVIEWER_LABEL,
  appendKnowledgeCandidatesFromCase,
  createCaseKnowledgeReference,
  createImportedKnowledgeCandidate,
  createProjectKnowledge,
  expireKnowledgeItem,
  hasKnowledgeEffectivePeriodEnded,
  normalizeProjectKnowledge,
  parseKnowledgeActionInput,
  publishKnowledgeItem,
  reviewKnowledgeItemForPublish
} from "./apps/desktop/src/main/knowledgeService.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assertRejects(name, action) {
  let rejected = false;
  try {
    action();
  } catch {
    rejected = true;
  }
  assert(rejected, name + " did not reject");
  pass(name);
}

const projectId = "phase40-project";
const checklist = {
  sourceAndScopeConfirmed: true,
  noSecretsConfirmed: true,
  noSapSourceOrWriteOpsConfirmed: true,
  noCustomerDetailsConfirmed: true
};

function publishedImportedKnowledge(title, effectiveTo = null) {
  const imported = createImportedKnowledgeCandidate(projectId, {
    projectId,
    title,
    sourceKind: "local-text",
    sourceName: "本机整理文本",
    body: "该知识只记录已脱敏的业务口径，并由本机用户确认来源、适用范围和安全边界。",
    sapObjects: ["ZMM_PHASE40"]
  }, "knowledge_candidates/imported-phase40.md");
  let base = {
    ...createProjectKnowledge(projectId),
    items: [{ ...imported.item, effectiveTo }],
    documentJobs: [imported.job]
  };
  base = reviewKnowledgeItemForPublish(base, {
    itemId: imported.item.id,
    note: "本机用户已确认来源、适用范围和安全边界。",
    checklist
  });
  return publishKnowledgeItem(base, { itemId: imported.item.id, note: "本机用户确认入库。" });
}

const publishedBase = publishedImportedKnowledge("生命周期知识");
const publishedItem = publishedBase.items[0];
assert(publishedItem.status === "published", "knowledge did not publish before expiry test");
assert(publishedItem.reviewer === LOCAL_KNOWLEDGE_REVIEWER_LABEL, "reviewer is not the local user label");
createCaseKnowledgeReference(publishedItem, new Date().toISOString());
pass("localReviewerAndActiveReference");

const publishedTimeline = JSON.stringify(publishedItem.timeline);
const expiredBase = expireKnowledgeItem(publishedBase, { itemId: publishedItem.id, note: "当前口径已由后续版本替代。" });
const expiredItem = expiredBase.items[0];
assert(publishedBase.items[0].status === "published", "expiry mutated the original knowledge object");
assert(expiredItem.status === "expired", "published knowledge did not become expired");
assert(expiredItem.content === publishedItem.content, "expiry changed formal knowledge content");
assert(expiredItem.publishedAt === publishedItem.publishedAt, "expiry changed the original publish time");
assert(expiredItem.reviewedContentHash === publishedItem.reviewedContentHash, "expiry rewrote the original review hash");
assert(JSON.stringify(expiredItem.timeline.slice(0, -1)) === publishedTimeline, "expiry rewrote existing audit events");
assert(expiredItem.timeline.at(-1)?.action === "expired", "expiry audit event is missing");
assert(expiredItem.timeline.at(-1)?.note.includes("已发布知识由本机用户标记为失效"), "expiry audit note is not explicit");
pass("publishedKnowledgeExpiresWithImmutableAuditEvent");

assertRejects("expiredKnowledgeReferenceBlocked", () => createCaseKnowledgeReference(expiredItem, new Date().toISOString()));

const pastEffectiveToBase = publishedImportedKnowledge("适用期已结束知识", "2000-01-01");
const pastEffectiveToItem = pastEffectiveToBase.items[0];
assert(hasKnowledgeEffectivePeriodEnded(pastEffectiveToItem), "past effectiveTo was not recognized");
assertRejects("pastEffectiveToReferenceBlocked", () => createCaseKnowledgeReference(pastEffectiveToItem, new Date().toISOString()));

const latestNote = "最新审计事件内容。".repeat(80);
const rawTimeline = Array.from({ length: 60 }, (_, index) => ({
  id: "timeline-" + index,
  at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  action: index === 59 ? "expired" : "edited",
  note: index === 59 ? latestNote : "审计事件 " + index
}));
const timelineBase = normalizeProjectKnowledge(projectId, {
  schemaVersion: 1,
  projectId,
  items: [{
    id: "knowledge-timeline-retention",
    title: "时间线保留验证",
    status: "expired",
    summary: "验证加载时保留最新审计事件。",
    content: "时间线保留测试内容。",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:59:00.000Z",
    timeline: rawTimeline
  }],
  documentJobs: [],
  updatedAt: "2026-01-01T00:59:00.000Z"
});
const normalizedTimeline = timelineBase.items[0].timeline;
assert(normalizedTimeline.length === 50, "timeline retention limit is incorrect");
assert(normalizedTimeline[0].id === "timeline-10", "timeline did not discard the oldest event first");
assert(normalizedTimeline.at(-1)?.id === "timeline-59", "latest timeline event was lost");
assert(normalizedTimeline.at(-1)?.note === latestNote, "latest timeline note was silently truncated");
pass("latestTimelineEventsRetained");

const formalContent = ("正式知识原文需要完整保留。\\n").repeat(1200);
const rawFormalItems = Array.from({ length: 505 }, (_, index) => ({
  id: "formal-knowledge-" + index,
  title: "正式知识 " + index,
  status: index === 504 ? "expired" : "published",
  summary: "正式知识摘要 " + index,
  content: index === 504 ? formalContent : "正式知识内容 " + index,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  timeline: [{
    id: "created-" + index,
    at: "2026-01-01T00:00:00.000Z",
    action: "created",
    note: "知识已创建。"
  }]
}));
const normalizedFormalBase = normalizeProjectKnowledge(projectId, {
  schemaVersion: 1,
  projectId,
  items: rawFormalItems,
  documentJobs: [],
  updatedAt: "2026-01-01T00:00:00.000Z"
});
assert(normalizedFormalBase.items.length === rawFormalItems.length, "formal knowledge items were silently dropped during normalization");
assert(normalizedFormalBase.items.at(-1)?.content === formalContent, "formal knowledge content was silently truncated");
pass("formalKnowledgeNormalizationHasNoSilentTruncation");

const appendedBase = appendKnowledgeCandidatesFromCase({
  id: projectId,
  name: "Phase 40 Project",
  knowledge: normalizedFormalBase
}, {
  id: "phase40-case",
  title: "Phase 40 Case"
}, [{
  relativePath: "knowledge_candidates/phase40-candidate.md",
  purpose: "candidate_knowledge",
  content: "该案件候选仅用于验证追加时不会丢弃既有正式知识。"
}]);
assert(appendedBase.items.length === rawFormalItems.length + 1, "candidate append silently dropped formal knowledge");
assert(rawFormalItems.every((item) => appendedBase.items.some((candidate) => candidate.id === item.id)), "candidate append lost an existing formal knowledge item");
pass("candidateAppendDoesNotTruncateFormalKnowledge");

assertRejects("overlongAuditNoteRejectedExplicitly", () => parseKnowledgeActionInput({
  itemId: publishedItem.id,
  note: "说明。".repeat(200)
}));
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase40-knowledge-lifecycle-entry.mjs"
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    outfile: bundlePath,
    logLevel: "silent"
  });
  await import(`${pathToFileURL(bundlePath).href}?run=${Date.now()}`);

  const serviceSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/knowledgeService.ts"), "utf8");
  const rendererSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/KnowledgeCenter.tsx"), "utf8");

  assert(!serviceSource.includes('reviewer: "演示用户"'), "service still records the demo reviewer identity");
  assert(serviceSource.includes('LOCAL_KNOWLEDGE_REVIEWER_LABEL = "本机用户"'), "local reviewer label is missing");
  assert(serviceSource.includes("normalized.slice(-MAX_KNOWLEDGE_TIMELINE_EVENTS)"), "latest-first timeline retention guard is missing");
  assert(!serviceSource.includes("MAX_KNOWLEDGE_ITEMS"), "knowledge item normalization still has a silent item cap");
  pass("serviceLifecycleSourceGuards");

  assert(!rendererSource.includes("knowledge-parser-queue"), "unlinked parser queue is still visible");
  assert(!rendererSource.includes("documentJobs.map"), "document job demo records are still rendered as a live queue");
  assert(rendererSource.includes("Word、PDF、Excel 当前不支持导入或解析"), "unsupported document formats are not stated accurately");
  assert(rendererSource.includes("案件文件仅作为只读来源快照"), "case source snapshot wording is missing");
  assert(rendererSource.includes("形成新的知识记录版本"), "knowledge record version wording is missing");
  assert(rendererSource.includes("潜在冲突提示") && rendererSource.includes("effectivePeriodsOverlap") && rendererSource.includes("sharedSapObjects"), "SAP object and effective-period conflict hint is missing");
  assert(rendererSource.includes("selectedEffectivePeriodEnded") && rendererSource.includes("适用期已经结束，不能加入案件"), "renderer expiry gate is missing");
  pass("rendererLifecycleSemantics");

  process.stdout.write("phase40-knowledge-lifecycle-probe=passed\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
