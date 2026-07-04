# Phase 23 Referenced Knowledge Safe Model Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the safe model draft context use only the current case's already-attached, published, human-reviewed knowledge summaries.

**Architecture:** Reuse the Phase 22 case knowledge reference gate as the only source of knowledge context. `WorkspaceStore.prepareSafeModelDraftRequest` passes the active case's reconciled `knowledgeReferences` into `buildSafeModelDraftContext`; the safe model service sanitizes and truncates those references before composing the model prompt and audit metadata.

**Tech Stack:** Electron main process, React/TypeScript shared types, Node probe scripts, PowerShell security preflight.

---

## Scope

In scope:

- Add `knowledgeReferences` to the explicit safe model context allowlist.
- Include only `title`, `summary`, `sourceType`, `sapObjects`, `publishedAt`, and `attachedAt`.
- Count referenced knowledge in the safe model audit.
- Add a Phase 23 probe proving safe summaries enter the model context and full bodies, source file paths, and polluted references do not.
- Extend security preflight with Phase 23 markers.

Out of scope:

- No automatic RAG, search, or bulk knowledge injection.
- No reading `context_pack.md`, metadata files, or arbitrary files for model context.
- No use of `KnowledgeItem.content`.
- No SAP read/write changes.
- No Feishu cloud publish/auth/sync changes.
- No new IPC channel.

## File Structure

- Modify `apps/desktop/src/main/safeModelCaseDraftService.ts`
  - Owns the safe model allowlist, sanitization, prompt text, and audit metadata.
- Modify `apps/desktop/src/main/workspaceStore.ts`
  - Owns passing the active case's already-reconciled knowledge references into safe model context building.
- Create `scripts/phase23-referenced-knowledge-safe-model-context-probe.mjs`
  - Bundled integration probe for Phase 23 boundaries.
- Modify `scripts/security-preflight.ps1`
  - Adds static checks for Phase 23 markers and forbidden full-content/file-read patterns.
- Create `docs/architecture/reviews/2026-07-04-phase-23-referenced-knowledge-safe-model-context-review.md`
  - Records adversarial review findings and verification evidence.

## Tasks

### Task 1: Extend Safe Model Context Shape

**Files:**
- Modify: `apps/desktop/src/main/safeModelCaseDraftService.ts`

- [ ] **Step 1: Add a safe knowledge summary input type**

Add a type with only summary fields:

```ts
export interface SafeModelKnowledgeReferenceInput {
  title: string;
  summary: string;
  sourceType: string;
  sapObjects: string[];
  publishedAt: string | null;
  attachedAt: string;
}
```

- [ ] **Step 2: Add the field to `SafeModelDraftContextInput`**

```ts
knowledgeReferences: SafeModelKnowledgeReferenceInput[];
```

- [ ] **Step 3: Add audit count**

```ts
referencedKnowledgeCount: number;
```

- [ ] **Step 4: Add `knowledgeReferences` to `SAFE_MODEL_CONTEXT_ALLOWED_FIELDS`**

```ts
"knowledgeReferences",
```

Expected: the allowlist documents this as an intentional model-context field.

### Task 2: Sanitize And Render Referenced Knowledge

**Files:**
- Modify: `apps/desktop/src/main/safeModelCaseDraftService.ts`

- [ ] **Step 1: Add limits**

```ts
const MAX_KNOWLEDGE_REFERENCES = 5;
const MAX_KNOWLEDGE_TITLE_CHARS = 140;
const MAX_KNOWLEDGE_SUMMARY_CHARS = 420;
const MAX_KNOWLEDGE_SAP_OBJECTS = 8;
```

- [ ] **Step 2: Add a safe reference mapper**

Use `safeField` for title, summary, source type, SAP object labels, and timestamps. Never accept or mention `content`, `sourceFilePath`, or raw file paths.

- [ ] **Step 3: Add prompt section**

Render a section named `已引用已发布知识摘要：`.

Expected line shape:

```text
1. {title}：{summary}；SAP对象：{sapObjects}; 来源：{sourceType}; 发布时间：{publishedAt}; 引用时间：{attachedAt}
```

- [ ] **Step 4: Keep final context guard**

Run `assertNoUnsafeModelContextText("完整模型上下文", userContext)` after adding the new section.

### Task 3: Pass Current Case References From Store

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`

- [ ] **Step 1: Pass active case references**

In `prepareSafeModelDraftRequest`, pass:

```ts
knowledgeReferences: currentCase.knowledgeReferences.map((reference) => ({
  title: reference.title,
  summary: reference.summary,
  sourceType: reference.sourceType,
  sapObjects: reference.sapObjects,
  publishedAt: reference.publishedAt,
  attachedAt: reference.attachedAt
}))
```

Expected: this uses already-reconciled Phase 22 references, not raw knowledge items.

### Task 4: Add Phase 23 Probe

**Files:**
- Create: `scripts/phase23-referenced-knowledge-safe-model-context-probe.mjs`

- [ ] **Step 1: Build a safe direct context**

Assert the serialized model context includes the referenced title and summary.

- [ ] **Step 2: Prove unsafe fields stay out**

Assert the serialized model context does not include:

```text
FULL_BODY_SHOULD_NOT_ENTER_MODEL
sourceFilePath
C:/customer/internal/source.md
KnowledgeItem.content
```

- [ ] **Step 3: Prove audit count**

Assert `context.audit.referencedKnowledgeCount === 1`.

- [ ] **Step 4: Prove polluted persisted state is pruned before safe model context**

Create a published reviewed item, attach it, manually pollute `app-state.json` with an unreviewed/wrong-path reference, reload via `WorkspaceStore`, prepare a safe model request, and assert only the valid reference enters context.

- [ ] **Step 5: Prove no new IPC or unsafe capability**

Read `main.ts` and `preload.ts`, assert no new safe-model IPC, generic model IPC, file browser, fetch proxy, SAP write, or Feishu publish markers are introduced.

### Task 5: Extend Security Preflight

**Files:**
- Modify: `scripts/security-preflight.ps1`

- [ ] **Step 1: Add Phase 23 markers**

Require:

```powershell
SafeModelKnowledgeReferenceInput
referencedKnowledgeCount
knowledgeReferences: currentCase.knowledgeReferences.map
phase23-referenced-knowledge-safe-model-context-probe
```

- [ ] **Step 2: Add forbidden service scan**

Keep `safeModelCaseDraftService.ts` blocked from `item.content`, `sourceFilePath`, `readFile`, `readdir`, `node:fs`, search calls, and file previews.

### Task 6: Verify And Review

**Files:**
- Create: `docs/architecture/reviews/2026-07-04-phase-23-referenced-knowledge-safe-model-context-review.md`

- [ ] **Step 1: Run focused verification**

```powershell
npm run check
node scripts\phase23-referenced-knowledge-safe-model-context-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [ ] **Step 2: Dispatch adversarial review agents**

Ask one reviewer to focus on security boundaries and one reviewer to focus on product/MVP flow.

- [ ] **Step 3: Fix Critical or Important findings**

Repeat focused verification after fixes.

- [ ] **Step 4: Run regression**

Run Phase 11 through Phase 23 probes, `npm run check`, `npm run build`, security preflight, and `git diff --check`.

- [ ] **Step 5: Commit and push**

```bash
git add apps/desktop/src/main/safeModelCaseDraftService.ts apps/desktop/src/main/workspaceStore.ts scripts/security-preflight.ps1 scripts/phase23-referenced-knowledge-safe-model-context-probe.mjs docs/superpowers/plans/2026-07-04-phase-23-referenced-knowledge-safe-model-context-plan.md docs/architecture/reviews/2026-07-04-phase-23-referenced-knowledge-safe-model-context-review.md
git commit -m "feat: add referenced knowledge to safe model context"
git push
```

## Self-Review

- Spec coverage: Phase 23 covers the next MVP link from published reviewed knowledge reference to safe model draft context.
- Placeholder scan: no `TBD`, `TODO`, or vague future implementation steps.
- Type consistency: `knowledgeReferences` uses existing `CaseKnowledgeReference` data from Phase 22 but exposes a narrower safe-model input type.
