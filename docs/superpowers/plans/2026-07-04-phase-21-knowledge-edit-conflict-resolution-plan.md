# Phase 21 Knowledge Candidate Edit And Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow, safe editing path for unpublished knowledge candidates so users can fix content or resolve conflict scope before re-review and publish.

**Architecture:** The renderer collects an explicit edit form and sends it through a single knowledge edit IPC. Electron main validates project identity and delegates to `WorkspaceStore`, while `knowledgeService` owns strict input parsing, safety checks, state transitions, review invalidation, and timeline updates. Editing never reads arbitrary files, calls SAP, calls Feishu, uses network, deletes history, or auto-publishes knowledge.

**Tech Stack:** Electron, React, TypeScript, local JSON workspace store, existing knowledge service and security probes.

---

## File Structure

- Modify `apps/desktop/src/shared/workbenchTypes.ts`: add `KnowledgeEditInput` for the narrow edit request.
- Modify `apps/desktop/src/main/knowledgeService.ts`: add `KNOWLEDGE_EDIT_ALLOWED_KEYS`, `parseKnowledgeEditInput`, `editKnowledgeCandidate`, and review invalidation logic.
- Modify `apps/desktop/src/main/workspaceStore.ts`: add `editKnowledgeCandidate(projectId, input)` and persist/search refresh.
- Modify `apps/desktop/src/main/main.ts`: add `workbench:knowledge-edit-candidate` IPC handler.
- Modify `apps/desktop/src/preload/preload.ts`: expose `editKnowledgeCandidate`.
- Modify `apps/desktop/src/renderer/vite-env.d.ts`: type the bridge method.
- Modify `apps/desktop/src/renderer/App.tsx`: wire Knowledge Center callback and user notice.
- Modify `apps/desktop/src/renderer/KnowledgeCenter.tsx`: add compact edit form in the detail pane for `pending`, `draft`, and `conflicted` items only.
- Modify `apps/desktop/src/renderer/styles.css`: add compact styles for the edit form and conflict note.
- Modify `scripts/security-preflight.ps1`: add Phase 21 markers and forbidden-capability scans.
- Create `scripts/phase21-knowledge-edit-conflict-resolution-probe.mjs`: prove edit behavior, conflict transition, review invalidation, search refresh, and forbidden capability boundaries.
- Create `docs/architecture/reviews/2026-07-04-phase-21-knowledge-edit-conflict-resolution-review.md`: record adversarial review findings and resolution.

## Task 1: Shared Types And Knowledge Service State Transition

**Files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Modify: `apps/desktop/src/main/knowledgeService.ts`

- [ ] **Step 1: Add edit input type**

Add this interface near the existing knowledge action/review types:

```ts
export interface KnowledgeEditInput {
  itemId: string;
  title: string;
  summary: string;
  content: string;
  sapObjects?: string[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  note: string;
}
```

- [ ] **Step 2: Add parser and transition markers**

In `knowledgeService.ts`, import `KnowledgeEditInput`, add:

```ts
export const KNOWLEDGE_EDIT_ALLOWED_KEYS = new Set(["itemId", "title", "summary", "content", "sapObjects", "effectiveFrom", "effectiveTo", "note"]);
```

Then implement:

```ts
function normalizeKnowledgeEditDate(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(`${label}必须是 YYYY-MM-DD 格式。`);
  }
  return value.trim();
}

export function parseKnowledgeEditInput(input: unknown): KnowledgeEditInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("知识编辑请求无效。");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !KNOWLEDGE_EDIT_ALLOWED_KEYS.has(key))) {
    throw new Error("知识编辑请求包含不支持的字段。");
  }
  const candidate = input as Partial<KnowledgeEditInput>;
  const actionInput = parseKnowledgeActionInput({ itemId: candidate.itemId, note: candidate.note });
  const note = (actionInput.note ?? "").trim();
  if (note.length < 6) {
    throw new Error("请填写至少 6 个字的修改说明。");
  }
  const title = assertSafeKnowledgeImportText("知识标题", candidate.title, MAX_KNOWLEDGE_IMPORT_TITLE_LENGTH);
  const summary = assertSafeKnowledgeImportText("知识摘要", candidate.summary, 500);
  const content = assertSafeKnowledgeImportBody(candidate.content);
  const sapObjects = normalizeKnowledgeImportSapObjects(candidate.sapObjects);
  const effectiveFrom = normalizeKnowledgeEditDate("生效时间", candidate.effectiveFrom);
  const effectiveTo = normalizeKnowledgeEditDate("失效时间", candidate.effectiveTo);
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    throw new Error("失效时间不能早于生效时间。");
  }
  return { itemId: actionInput.itemId, title, summary, content, sapObjects, effectiveFrom, effectiveTo, note };
}
```

- [ ] **Step 3: Add edit transition**

Implement `editKnowledgeCandidate(base, input)` so it:

- rejects `published` and `expired`;
- allows only `draft`, `pending`, `conflicted`;
- calls `assertSafeKnowledgeImportBody` for the edited content;
- sets `status` to `pending`;
- clears `reviewer`, `reviewedAt`, `reviewNote`, `reviewedContentHash`, and `reviewChecklist`;
- clears `conflictWithIds`;
- appends an `edited` timeline event with a Phase 21 marker;
- never sets `publishedAt`.

Expected transition shape:

```ts
export function editKnowledgeCandidate(base: ProjectKnowledgeBase, input: KnowledgeEditInput): ProjectKnowledgeBase {
  return updateKnowledgeItem(base, input.itemId, (item, updatedAt) => {
    if (item.status === "published") {
      throw new Error("已发布知识不能直接编辑。请重新生成待确认候选后再替代。");
    }
    if (item.status === "expired") {
      throw new Error("已失效知识不能直接编辑复活。请重新生成候选知识。");
    }
    assertKnowledgePublishSafe({
      ...item,
      title: input.title,
      summary: input.summary,
      content: input.content,
      sapObjects: input.sapObjects ?? [],
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo
    });
    return {
      ...item,
      title: input.title,
      summary: input.summary,
      content: input.content,
      sapObjects: input.sapObjects ?? [],
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      status: "pending",
      reviewer: null,
      reviewedAt: null,
      reviewNote: null,
      reviewedContentHash: null,
      reviewChecklist: null,
      conflictWithIds: [],
      updatedAt,
      timeline: [...item.timeline, event("edited", `phase21-knowledge-edit-conflict-resolution：${input.note}`, updatedAt)]
    };
  });
}
```

- [ ] **Step 4: Run focused typecheck**

Run:

```powershell
npm run check
```

Expected: exit 0.

## Task 2: Store, IPC, Preload, And App Wiring

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [ ] **Step 1: Add store method**

Import `editKnowledgeCandidate` and `parseKnowledgeEditInput`, then add `async editKnowledgeCandidate(projectId: string, input: unknown): Promise<WorkbenchState>`.

Required behavior:

- parse input before loading state;
- require project exists;
- update `project.knowledge`;
- update project timestamp;
- call `saveState`, `writeProjectKnowledge`, `writeProjectMetadata`, `ensureCaseFiles`, and `refreshSearchIndex`;
- return `withFiles(state)`.

- [ ] **Step 2: Add narrow IPC**

Add handler:

```ts
ipcMain.handle("workbench:knowledge-edit-candidate", (event, projectId: unknown, input: unknown) =>
  trustedResponse(event, appRoot, () => store.editKnowledgeCandidate(validProjectId(projectId, "编辑知识候选"), input)));
```

- [ ] **Step 3: Expose bridge method**

In preload and `vite-env.d.ts`, add:

```ts
editKnowledgeCandidate: (projectId: string, input: KnowledgeEditInput) => Promise<WorkbenchResponse<WorkbenchState>>;
```

- [ ] **Step 4: Wire App callback**

In `App.tsx`, add `editKnowledgeCandidate` callback that sets state and notice:

```ts
setNotice("候选知识已保存为待确认；需要重新审核后才能入库。");
```

Pass it to `KnowledgeCenter` as `onEdit`.

## Task 3: Knowledge Center UX

**Files:**
- Modify: `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add edit state and reset behavior**

Add form state for title, summary, content, sap objects, effective dates, and edit note. Reset it when the selected item changes.

- [ ] **Step 2: Render compact edit form**

Show edit form only when selected status is `pending`, `draft`, or `conflicted`. Published and expired items remain read-only.

Form labels:

- `知识标题`
- `摘要`
- `正文`
- `SAP对象`
- `生效时间`
- `失效时间`
- `修改说明`

Buttons:

- `保存为待确认`
- `重置`

For conflicted items, show text: `改完后会回到待确认，仍需重新审核后才能入库。`

- [ ] **Step 3: Prevent accidental publish bypass**

After successful edit, keep selected item on the same ID, set status tab to `pending`, and rely on backend cleared review fields to disable publish until re-review.

- [ ] **Step 4: Add compact styles**

Use existing quiet utility style: 7-8px radii, small labels, no nested cards, no large dashboard panels.

## Task 4: Phase 21 Probe And Security Preflight

**Files:**
- Create: `scripts/phase21-knowledge-edit-conflict-resolution-probe.mjs`
- Modify: `scripts/security-preflight.ps1`

- [ ] **Step 1: Add probe**

The probe must build a bundled entry like Phase 19/20 and cover:

- pending imported candidate edit succeeds and remains `pending`;
- edit clears review metadata;
- reviewed candidate edited, then publish fails until re-review;
- edit + re-review + publish succeeds;
- published edit rejects;
- expired edit rejects;
- extra fields reject;
- invalid item ID rejects;
- secret/token/path/Feishu URL/ABAP/write snippets/structured rows unsafe content rejects;
- unsafe SAP object labels reject;
- conflicted edit clears conflict IDs and returns to `pending`;
- conflicted edited candidate still cannot publish without review;
- search finds edited text;
- source blocks contain no forbidden capabilities.

- [ ] **Step 2: Add security preflight block**

Add `Write-Section "Phase 21 knowledge edit conflict resolution scan"` with markers:

- `parseKnowledgeEditInput`
- `KNOWLEDGE_EDIT_ALLOWED_KEYS`
- `editKnowledgeCandidate`
- `workbench:knowledge-edit-candidate`
- `phase21-knowledge-edit-conflict-resolution`

Forbidden in edit parser/store/renderer blocks:

- `showOpenDialog`
- `readFile(`
- `fetch(`
- `execFile(`
- `spawn(`
- `exec(`
- `openExternal`
- `openPath`
- `loadURL`
- `feishu-sync`
- `unlink`
- `rm(`
- `status: "published"`
- `publishedAt:`
- `publishKnowledgeItem`

Also assert edit input does not accept:

- `status`
- `reviewer`
- `reviewedAt`
- `reviewedContentHash`
- `reviewChecklist`
- `publishedAt`
- `sourceFilePath`

## Task 5: Full Verification, Review, Commit, Push

**Files:**
- Create: `docs/architecture/reviews/2026-07-04-phase-21-knowledge-edit-conflict-resolution-review.md`

- [ ] **Step 1: Run full verification**

Run:

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
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Expected: all exit 0.

- [ ] **Step 2: Request adversarial review**

Dispatch a code review subagent with:

- scope: Phase 21 edit/conflict resolution;
- base: Phase 20 commit;
- head: current commit/diff;
- must classify Critical/Important/Minor;
- must check bypasses, unsafe capabilities, and UI misalignment.

- [ ] **Step 3: Fix Critical and Important issues**

Re-run targeted Phase 21 probe, `npm run check`, `npm run build`, and security preflight after fixes.

- [ ] **Step 4: Record review**

Write the review result and fixes to:

```text
docs/architecture/reviews/2026-07-04-phase-21-knowledge-edit-conflict-resolution-review.md
```

- [ ] **Step 5: Commit and push**

Run:

```powershell
git status --short
git add apps/desktop/src/shared/workbenchTypes.ts apps/desktop/src/main/knowledgeService.ts apps/desktop/src/main/workspaceStore.ts apps/desktop/src/main/main.ts apps/desktop/src/preload/preload.ts apps/desktop/src/renderer/vite-env.d.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/KnowledgeCenter.tsx apps/desktop/src/renderer/styles.css scripts/security-preflight.ps1 scripts/phase21-knowledge-edit-conflict-resolution-probe.mjs docs/superpowers/plans/2026-07-04-phase-21-knowledge-edit-conflict-resolution-plan.md docs/architecture/reviews/2026-07-04-phase-21-knowledge-edit-conflict-resolution-review.md
git commit -m "feat: add knowledge candidate editing"
git push -u origin codex/phase-21-knowledge-edit-conflict-resolution
```

Expected: branch pushed and ready for PR.

## Self-Review

- Spec coverage: covers artificial confirmation gap by adding edit-before-review, conflict return-to-pending, and review invalidation.
- Safety coverage: preserves SAP read-only, Feishu local-first/no publish, no arbitrary file read, no network, no shell, no delete, no auto-publish.
- Type consistency: uses `KnowledgeEditInput`, `parseKnowledgeEditInput`, `editKnowledgeCandidate`, and `workbench:knowledge-edit-candidate` consistently.
- Placeholder scan: no `TBD`, no deferred validation, no unspecified tests.
