# Phase 24 Case Knowledge Candidate Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make case-generated knowledge candidates useful for human review by projecting a safe, traceable summary from the candidate file into the project knowledge item.

**Architecture:** Keep the existing local-only chain: case workflow generates a `knowledge_candidates/` file, `WorkspaceStore.appendMessage` appends a pending `KnowledgeItem`, the knowledge center records a human review hash, and only then can the item be published and reused by case context. Phase 24 improves only the pending item title, summary, content, review requirement, and refresh behavior from the generated candidate file; it does not add SAP reads, Feishu publishing, arbitrary file reads, model context, or new IPC.

**Tech Stack:** Electron main process, TypeScript service functions, Node esbuild probe scripts, PowerShell security preflight.

---

## Scope

In scope:

- Make the problem-analysis candidate file more reviewable without copying raw user input.
- Extract safe reviewable text from a generated `CaseGeneratedFile` with `purpose: "candidate_knowledge"`.
- Store that extracted summary in the pending `KnowledgeItem.content`, not the generic placeholder text.
- Keep candidate status as `pending` and keep `reviewedContentHash`, reviewer fields, confidence score, and publish state empty.
- Require the same human review gate for case-generated candidates before publish, so published case candidates can be reused by current or future case context.
- Refresh existing pending source-matched candidates when the same case file is regenerated.
- Add a Phase 24 probe that proves the candidate is useful, refreshed, searchable, and still blocked from automatic publish.
- Extend security preflight with markers and forbidden capability scans.

Out of scope:

- No automatic knowledge publishing.
- No new human review bypass.
- No reading candidate files from disk for knowledge projection.
- No SAP read/write changes.
- No Feishu cloud publish/auth/sync changes.
- No model-context injection changes.
- No new IPC channel.

## File Structure

- Modify `apps/desktop/src/main/caseWorkflowService.ts`
  - Owns the generated local candidate file content for problem-analysis mode.
- Modify `apps/desktop/src/main/knowledgeService.ts`
  - Owns safe candidate-file projection into pending knowledge items.
- Modify `apps/desktop/src/renderer/KnowledgeCenter.tsx`
  - Shows case-generated candidates as requiring review and avoids fake confidence scores.
- Create `scripts/phase24-case-knowledge-candidate-projection-probe.mjs`
  - Proves the local case candidate projection behavior and security boundary.
- Modify `scripts/security-preflight.ps1`
  - Adds Phase 24 static markers and forbidden capability scans.
- Create `docs/architecture/reviews/2026-07-04-phase-24-case-knowledge-candidate-projection-review.md`
  - Records adversarial product/security review and verification evidence.

## Tasks

### Task 1: Add A Failing Phase 24 Probe

**Files:**
- Create: `scripts/phase24-case-knowledge-candidate-projection-probe.mjs`

- [ ] **Step 1: Build an isolated WorkspaceStore probe**

Use esbuild to bundle a temporary probe, following the Phase 19 and Phase 23 script pattern.

- [ ] **Step 2: Generate a problem-analysis case output**

Run:

```js
await store.appendMessage({
  content: "请沉淀本案件的处理经验：先本地保存结论和证据，再人工确认是否入库。",
  taskMode: "problem-analysis",
  modelId: "local-workflow"
});
```

- [ ] **Step 3: Assert projected candidate content**

Expected after implementation:

```js
assert(candidate.status === "pending", "candidate must remain pending");
assert(candidate.sourceType === "case-candidate", "candidate source type mismatch");
assert(candidate.sourceFilePath === "knowledge_candidates/问题处理经验候选.md", "candidate source file mismatch");
assert(candidate.content.includes("## 候选内容"), "candidate content should include candidate file review section");
assert(candidate.content.includes("入库前必须确认"), "candidate content should include review checklist");
assert(!candidate.content.includes("Authorization:"), "candidate content leaked unsafe text");
assert(candidate.reviewedContentHash === null, "case candidates must not start reviewed");
assert(candidate.confidence === null, "case candidates should not show a fake confidence score");
```

- [ ] **Step 4: Assert Phase 24 does not auto-publish**

After `appendMessage`, assert Phase 24 does not mark the generated candidate `published`, does not set reviewer fields, and does not create a review hash. Do not call `publishKnowledge` in this probe step; explicit user-driven publish behavior is covered by existing knowledge lifecycle probes.

- [ ] **Step 5: Assert refresh updates the same pending item**

Append a second safe problem-analysis message and assert there is still only one pending item for the same `caseId + sourceFilePath`, with a new `edited` timeline event and updated reviewable content.

- [ ] **Step 6: Assert case-candidate review closes the loop**

Try to publish the case candidate before review and expect rejection. Then record human review, publish it, attach it to the current case, and assert it appears in `knowledgeReferences`.

- [ ] **Step 7: Assert no unsafe capability**

Read source files and assert no new markers such as `workbench:knowledge-auto-publish`, `readFile(` in the Phase 24 projection block, SAP write commands, Feishu publish commands, `openExternal`, or generic network proxy strings.

### Task 2: Improve The Generated Case Candidate File

**Files:**
- Modify: `apps/desktop/src/main/caseWorkflowService.ts`

- [ ] **Step 1: Add a small candidate renderer**

Add a helper near `modeFilePlan`:

```ts
function renderProblemAnalysisKnowledgeCandidate(input: CaseWorkflowInput, project: ProjectSummary, caseItem: CaseSummary, modelDraft?: SafeModelDraftRun): string {
  return [
    "# 问题处理经验候选",
    "",
    "状态：待确认",
    "",
    `来源案件：${caseItem.title}`,
    `来源项目：${project.name}`,
    `任务模式：${TASK_MODE_LABELS[input.taskMode]}`,
    "",
    "## 来源摘要",
    "",
    `- ${safeContentSummary(input.content, "用户输入")}`,
    `- 当前边界：${modelBoundaryText(modelDraft)}`,
    "- 本候选不是正式知识，不能直接作为长期经验引用。",
    "",
    "## 候选内容",
    "",
    "当前案件形成了一条待整理经验：先在本地案件中沉淀问题、结论、核对清单和证据，再由用户确认是否进入正式知识库。",
    "",
    "## 入库前必须确认",
    "",
    "- 内容是否适用于当前项目。",
    "- 是否需要补充 SAP 对象、业务范围或失效条件。",
    "- 是否与已有知识冲突。",
    "- 是否已经去除 SAP 源码、客户明细、密码、Token 和授权信息。",
    ""
  ].join("\n");
}
```

- [ ] **Step 2: Use the renderer for `knowledge_candidates/问题处理经验候选.md`**

Replace the inline candidate content in problem-analysis mode with:

```ts
content: renderProblemAnalysisKnowledgeCandidate(input, project, caseItem, modelDraft)
```

Expected: the candidate file is still local-only, still pending, and still does not copy raw user input.

### Task 3: Project Candidate File Text Safely

**Files:**
- Modify: `apps/desktop/src/main/knowledgeService.ts`

- [ ] **Step 1: Add Phase 24 marker and limits**

Add:

```ts
const PHASE24_CASE_KNOWLEDGE_CANDIDATE_PROJECTION_MARKER = "phase24-case-knowledge-candidate-projection";
const MAX_CASE_CANDIDATE_TITLE_LENGTH = 120;
const MAX_CASE_CANDIDATE_SUMMARY_LENGTH = 500;
const MAX_CASE_CANDIDATE_CONTENT_LENGTH = 1600;
```

- [ ] **Step 2: Add safe text helper**

Add a helper that removes control characters, collapses whitespace for title/summary, truncates to the limit, and calls `assertNoSensitiveKnowledgeContent`.

- [ ] **Step 3: Add candidate projection helper**

Build a helper from `project`, `caseItem`, and generated candidate `file`:

```ts
function caseCandidateProjection(project: ProjectSummary, caseItem: CaseSummary, file: CaseGeneratedFile) {
  const cleanedContent = safeCaseCandidateContent(file.content);
  return {
    title: safeCaseCandidateLine(`${caseItem.title} 经验候选`, MAX_CASE_CANDIDATE_TITLE_LENGTH),
    summary: safeCaseCandidateLine(`来自案件「${caseItem.title}」和文件 ${file.relativePath} 的待确认知识候选，需人工确认后才能入库。`, MAX_CASE_CANDIDATE_SUMMARY_LENGTH),
    content: cleanedContent,
    confidence: null
  };
}
```

Expected: this uses the in-memory generated candidate file only. It must not read from disk and must not copy `project.knowledge` or published knowledge bodies.

- [ ] **Step 4: Use projection in new candidate creation**

Update `createKnowledgeCandidateFromCase` so `KnowledgeItem.content` stores the cleaned candidate file content instead of the generic one-line summary.

- [ ] **Step 5: Refresh existing pending candidates**

In `appendKnowledgeCandidatesFromCase`, when an existing pending item matches the same case and source file, update:

```ts
title
summary
content
confidence
reviewer: null
reviewedAt: null
reviewNote: null
reviewedContentHash: null
reviewChecklist: null
updatedAt
timeline: [...item.timeline, event("edited", `${PHASE24_CASE_KNOWLEDGE_CANDIDATE_PROJECTION_MARKER}：案件 ${caseItem.id} 刷新待确认知识候选。`, updatedAt)]
```

Expected: refresh never publishes or reviews the item.

- [ ] **Step 6: Require review for case-generated candidates**

Add a helper:

```ts
export function isCaseGeneratedKnowledgeCandidate(item: KnowledgeItem): boolean {
  return item.sourceType === "case-candidate" &&
    typeof item.sourceCaseId === "string" &&
    (item.sourceFilePath ?? "").startsWith("knowledge_candidates/");
}
```

Then update:

```ts
function requiresHumanReviewBeforePublish(item: KnowledgeItem): boolean {
  return isPhase16LocalTextImportCandidate(item) || isCaseGeneratedKnowledgeCandidate(item) || isPhase21EditedCandidate(item);
}
```

Expected: a case-generated candidate cannot be published until the human review checklist and review hash are recorded. Once reviewed and published, it can satisfy `createCaseKnowledgeReference` and return to case context as reusable knowledge.

### Task 4: Sync Knowledge Center Review Gate

**Files:**
- Modify: `apps/desktop/src/renderer/KnowledgeCenter.tsx`

- [ ] **Step 1: Add the same case-candidate review predicate**

Use the same source type, source case, and `knowledge_candidates/` path rule as the main process.

- [ ] **Step 2: Include it in `selectedRequiresReviewGate`**

```ts
const selectedRequiresReviewGate = selectedImportedCandidate || selectedCaseGeneratedCandidate || selectedEditedCandidate;
```

- [ ] **Step 3: Avoid fake confidence display**

Show pending null-confidence candidates as:

```text
待人工判断
```

### Task 5: Extend Security Preflight

**Files:**
- Modify: `scripts/security-preflight.ps1`

- [ ] **Step 1: Add Phase 24 markers**

Require:

```powershell
phase24-case-knowledge-candidate-projection
renderProblemAnalysisKnowledgeCandidate
isCaseGeneratedKnowledgeCandidate
caseCandidateProjection
safeCaseCandidateContent
scripts/phase24-case-knowledge-candidate-projection-probe.mjs
```

- [ ] **Step 2: Scan projection block**

Use `Get-SourceBlock` around `function caseCandidateProjection` through `export function appendKnowledgeCandidatesFromCase` and reject:

```text
readFile(
readdir
node:fs
fetch(
execFile(
spawn(
openExternal
openPath
publishKnowledgeItem
reviewKnowledgeItemForPublish
workbench:
```

Expected: the projection is pure in-memory transformation only.

### Task 6: Verify, Review, And Commit

**Files:**
- Create: `docs/architecture/reviews/2026-07-04-phase-24-case-knowledge-candidate-projection-review.md`

- [ ] **Step 1: Run focused verification**

```powershell
npm run check
node scripts\phase24-case-knowledge-candidate-projection-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [ ] **Step 2: Dispatch adversarial review agents**

One reviewer focuses on product/MVP flow: whether this improves the daily case-to-knowledge loop without turning into auto-publish or dashboard work.

One reviewer focuses on security boundaries: no secrets, no disk read, no SAP write, no Feishu publish, no model-context expansion, no review bypass.

- [ ] **Step 3: Fix Critical or Important findings**

Repeat focused verification after any fix.

- [ ] **Step 4: Run regression**

```powershell
npm run check
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase12-sap-readonly-evidence-probe.mjs
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
node scripts\phase14-feishu-safe-handoff-probe.mjs
node scripts\phase15-real-project-case-lifecycle-probe.mjs
node scripts\phase16-document-ingestion-firewall-probe.mjs
node scripts\phase17-renderer-trust-filetree-probe.mjs
node scripts\phase18-composer-model-selector-probe.mjs
node scripts\phase19-knowledge-review-gate-probe.mjs
node scripts\phase20-controlled-text-file-import-probe.mjs
node scripts\phase21-knowledge-edit-conflict-resolution-probe.mjs
node scripts\phase22-published-knowledge-case-context-probe.mjs
node scripts\phase23-referenced-knowledge-safe-model-context-probe.mjs
node scripts\phase24-case-knowledge-candidate-projection-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add apps/desktop/src/main/caseWorkflowService.ts apps/desktop/src/main/knowledgeService.ts apps/desktop/src/renderer/KnowledgeCenter.tsx scripts/security-preflight.ps1 scripts/phase24-case-knowledge-candidate-projection-probe.mjs docs/superpowers/plans/2026-07-04-phase-24-case-knowledge-candidate-projection-plan.md docs/architecture/reviews/2026-07-04-phase-24-case-knowledge-candidate-projection-review.md
git commit -m "feat: improve case knowledge candidate projection"
git push
```

## Self-Review

- Spec coverage: This plan advances the MVP's "case output -> pending knowledge -> manual confirmation" loop without adding external system behavior.
- Placeholder scan: no `TBD`, `TODO`, or vague "handle later" steps.
- Type consistency: Existing `CaseGeneratedFile`, `KnowledgeItem`, and `ProjectKnowledgeBase` types are reused; no new IPC or shared renderer types are needed.
