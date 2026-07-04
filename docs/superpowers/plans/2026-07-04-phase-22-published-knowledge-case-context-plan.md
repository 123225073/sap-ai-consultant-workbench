# Phase 22 Published Knowledge Case Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user manually attach a published project knowledge item to the current active case so the case context can reuse reviewed knowledge without copying full knowledge content into model context.

**Architecture:** Add a narrow reference type on `CaseSummary`, validate attach requests in `knowledgeService`, and let `WorkspaceStore` append a safe case reference only when the item belongs to the active project and has `status === "published"`. The existing case maintenance writer refreshes `README.md`, `timeline.md`, `context_pack.md`, and `metadata.json`; renderer wiring exposes one action button on published knowledge. No automatic RAG, no arbitrary file reads, no SAP writes, no Feishu sync, and no network or shell capability is added.

**Tech Stack:** Electron, React, TypeScript, local JSON workspace store, existing case workflow artifacts, existing probe/security-preflight pattern.

---

## File Structure

- Modify `apps/desktop/src/shared/workbenchTypes.ts`: add `CaseKnowledgeReference` and `KnowledgeCaseReferenceInput`, and add `knowledgeReferences` to `CaseSummary`.
- Modify `apps/desktop/src/main/workspaceStore.ts`: normalize persisted case references; add `attachPublishedKnowledgeToCurrentCase(projectId, input)`; persist state, project metadata, case files, and search index.
- Modify `apps/desktop/src/main/knowledgeService.ts`: add `parseKnowledgeCaseReferenceInput`, `createCaseKnowledgeReference`, and `PHASE22_PUBLISHED_KNOWLEDGE_CASE_CONTEXT_MARKER`.
- Modify `apps/desktop/src/main/caseWorkflowService.ts`: render referenced published knowledge in timeline, context pack, README, and metadata using summary/source only.
- Modify `apps/desktop/src/main/main.ts`: add `workbench:knowledge-attach-to-current-case` IPC.
- Modify `apps/desktop/src/preload/preload.ts`: expose `attachKnowledgeToCurrentCase`.
- Modify `apps/desktop/src/renderer/vite-env.d.ts`: type the bridge method.
- Modify `apps/desktop/src/renderer/App.tsx`: wire the callback and user notice.
- Modify `apps/desktop/src/renderer/KnowledgeCenter.tsx`: show a single action for published knowledge.
- Modify `apps/desktop/src/renderer/styles.css`: add compact UI styling if needed for the attach action/status.
- Modify `scripts/security-preflight.ps1`: add Phase 22 marker and forbidden-capability scans.
- Create `scripts/phase22-published-knowledge-case-context-probe.mjs`: prove successful attach, blocked states, wrong-project rejection, idempotency, safe context output, timeline/metadata update, and forbidden capability boundaries.
- Create `docs/architecture/reviews/2026-07-04-phase-22-published-knowledge-case-context-review.md`: record adversarial audit results and fixes.

## Task 1: Shared Types, Parser, And Safe Reference Builder

**Files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Modify: `apps/desktop/src/main/knowledgeService.ts`

- [ ] **Step 1: Add shared types**

Add the following near the existing case and knowledge interfaces:

```ts
export interface CaseKnowledgeReference {
  itemId: string;
  title: string;
  summary: string;
  sourceType: KnowledgeSourceType;
  sourceCaseId: string | null;
  sourceFilePath: string | null;
  sapObjects: string[];
  publishedAt: string | null;
  attachedAt: string;
}

export interface KnowledgeCaseReferenceInput {
  itemId: string;
  note?: string;
}
```

Add this property to `CaseSummary`:

```ts
knowledgeReferences: CaseKnowledgeReference[];
```

- [ ] **Step 2: Add Phase 22 parser**

In `knowledgeService.ts`, import `CaseKnowledgeReference` and `KnowledgeCaseReferenceInput`, then add:

```ts
export const PHASE22_PUBLISHED_KNOWLEDGE_CASE_CONTEXT_MARKER = "phase22-published-knowledge-case-context";
const KNOWLEDGE_CASE_REFERENCE_ALLOWED_KEYS = new Set(["itemId", "note"]);

export function parseKnowledgeCaseReferenceInput(input: unknown): KnowledgeCaseReferenceInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Knowledge reference request is invalid.");
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !KNOWLEDGE_CASE_REFERENCE_ALLOWED_KEYS.has(key))) {
    throw new Error("Knowledge reference request contains unsupported fields.");
  }
  const actionInput = parseKnowledgeActionInput(input);
  return { itemId: actionInput.itemId, note: actionInput.note };
}
```

- [ ] **Step 3: Add safe reference builder**

Add:

```ts
function safeReferenceText(value: string, maxLength: number): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  assertNoSensitiveKnowledgeContent(cleaned);
  return cleaned;
}

export function createCaseKnowledgeReference(item: KnowledgeItem, attachedAt: string): CaseKnowledgeReference {
  if (item.status !== "published") {
    throw new Error("Only published knowledge can be referenced by a case.");
  }
  assertKnowledgePublishSafe(item);
  return {
    itemId: item.id,
    title: safeReferenceText(item.title, 120),
    summary: safeReferenceText(item.summary, 500),
    sourceType: item.sourceType,
    sourceCaseId: item.sourceCaseId,
    sourceFilePath: null,
    sapObjects: item.sapObjects.map((objectName) => safeReferenceText(objectName, 80)).slice(0, 20),
    publishedAt: item.publishedAt,
    attachedAt
  };
}
```

- [ ] **Step 4: Run focused typecheck**

Run:

```powershell
npm run check
```

Expected: if incomplete task state still exists, fix compile errors before continuing.

## Task 2: Persist References And Refresh Case Artifacts

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/caseWorkflowService.ts`

- [ ] **Step 1: Normalize persisted references**

In `workspaceStore.ts`, add a normalizer that accepts only safe, same-shape reference records:

```ts
function normalizeCaseKnowledgeReferences(value: unknown): CaseKnowledgeReference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const references: CaseKnowledgeReference[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<CaseKnowledgeReference>;
    const itemId = safeId(candidate.itemId, "");
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    references.push({
      itemId,
      title: text(candidate.title).slice(0, 120),
      summary: text(candidate.summary).slice(0, 500),
      sourceType: candidate.sourceType === "document-import" || candidate.sourceType === "qa-import" || candidate.sourceType === "manual" ? candidate.sourceType : "case-candidate",
      sourceCaseId: typeof candidate.sourceCaseId === "string" ? safeId(candidate.sourceCaseId, "") || null : null,
      sourceFilePath: null,
      sapObjects: Array.isArray(candidate.sapObjects) ? candidate.sapObjects.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20) : [],
      publishedAt: typeof candidate.publishedAt === "string" ? candidate.publishedAt : null,
      attachedAt: text(candidate.attachedAt, nowIso())
    });
  }
  return references;
}
```

Use it in `normalizeCaseSummary` and initialize `knowledgeReferences: []` in `demoCase()` and `createLocalCaseRecord()`.

- [ ] **Step 2: Add attach method**

In `WorkspaceStore`, import `createCaseKnowledgeReference` and `parseKnowledgeCaseReferenceInput`, then add:

```ts
async attachPublishedKnowledgeToCurrentCase(projectId: string, input: unknown): Promise<WorkbenchState> {
  return this.runExclusive(async () => {
    const referenceInput = parseKnowledgeCaseReferenceInput(input);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project || project.id !== state.activeProjectId) {
      throw new Error("Knowledge can only be attached inside the active project.");
    }
    const currentCase = this.getActiveCase(state);
    if (currentCase.projectId !== project.id) {
      throw new Error("Current case does not belong to the active project.");
    }
    const knowledgeItem = project.knowledge.items.find((item) => item.id === referenceInput.itemId);
    if (!knowledgeItem) {
      throw new Error("Knowledge item was not found in the active project.");
    }
    if (knowledgeItem.projectId !== project.id) {
      throw new Error("Knowledge item belongs to a different project.");
    }
    const reference = createCaseKnowledgeReference(knowledgeItem, nowIso());
    const existing = currentCase.knowledgeReferences.find((item) => item.itemId === reference.itemId);
    currentCase.knowledgeReferences = existing
      ? currentCase.knowledgeReferences.map((item) => item.itemId === reference.itemId ? { ...item, attachedAt: reference.attachedAt } : item)
      : [...currentCase.knowledgeReferences, reference];
    currentCase.currentSummary = `${currentCase.currentSummary} Referenced published knowledge: ${reference.title}.`.slice(0, 500);
    currentCase.summary = currentCase.currentSummary;
    currentCase.updatedAt = reference.attachedAt;
    currentCase.lastOpenedAt = reference.attachedAt;
    project.updatedAt = reference.attachedAt;
    await this.saveState(state);
    await this.writeProjectMetadata(project);
    await this.writeCaseMarkdown(state, currentCase, buildCaseMaintenanceArtifacts(project, currentCase));
    await this.refreshSearchIndex(state);
    return this.withFiles(state);
  });
}
```

- [ ] **Step 3: Render safe references in case artifacts**

In `caseWorkflowService.ts`, add helper lines for `caseItem.knowledgeReferences` and include them in:

```ts
## Referenced Published Knowledge
- {title}: {summary}
- Source: {sourceType}; published: {publishedAt ?? "unknown"}; attached: {attachedAt}
- SAP objects: {sapObjects.join(", ") || "none"}
```

Use this section in `README.md` and `context_pack.md`. Add timeline entries:

```ts
- {attachedAt}: Published knowledge referenced in this case: {title}.
```

Add metadata field:

```ts
knowledgeReferences: caseItem.knowledgeReferences.map((item) => ({
  itemId: item.itemId,
  title: item.title,
  summary: item.summary,
  sourceType: item.sourceType,
  sourceCaseId: item.sourceCaseId,
  sourceFilePath: null,
  sapObjects: item.sapObjects,
  publishedAt: item.publishedAt,
  attachedAt: item.attachedAt
}))
```

Do not include `KnowledgeItem.content` in rendered references.

- [ ] **Step 4: Run focused probe while still local**

Run:

```powershell
npm run check
```

Expected: exit 0.

## Task 3: IPC, Bridge, And Renderer Action

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add IPC**

Add:

```ts
ipcMain.handle("workbench:knowledge-attach-to-current-case", (event, projectId: unknown, input: unknown) =>
  trustedResponse(event, appRoot, () => store.attachPublishedKnowledgeToCurrentCase(validProjectId(projectId, "attach published knowledge to current case"), input)));
```

- [ ] **Step 2: Expose bridge type and method**

In preload:

```ts
attachKnowledgeToCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput): Promise<WorkbenchResponse<WorkbenchState>> =>
  ipcRenderer.invoke("workbench:knowledge-attach-to-current-case", projectId, input)
```

In `vite-env.d.ts`:

```ts
attachKnowledgeToCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput) => Promise<WorkbenchResponse<WorkbenchState>>;
```

- [ ] **Step 3: Wire App callback**

In `App.tsx`, add:

```ts
async function attachKnowledgeToCurrentCase(projectId: string, input: KnowledgeCaseReferenceInput) {
  if (!bridge) {
    setNotice("Open the desktop app to attach knowledge to the current case.");
    return;
  }
  const response = await bridge.attachKnowledgeToCurrentCase(projectId, input);
  if (response.ok) {
    setState(response.data);
    setNotice("Published knowledge is now referenced by the current case context.");
  } else {
    setNotice(response.error);
  }
}
```

Pass it to `KnowledgeCenter`.

- [ ] **Step 4: Add Knowledge Center action**

Add prop:

```ts
onAttachToCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput) => Promise<void>;
```

Add:

```ts
const attachDisabled = Boolean(!selectedItem || selectedItem.status !== "published" || busyItemId === selectedItem.id);

async function runAttachToCase(item: KnowledgeItem) {
  if (!project || busyItemId || item.status !== "published") return;
  setBusyItemId(item.id);
  try {
    await onAttachToCurrentCase(project.id, { itemId: item.id, note: "reference published knowledge in current case" });
  } finally {
    setBusyItemId("");
  }
}
```

Render one button in the detail action section:

```tsx
<button disabled={attachDisabled} onClick={() => void runAttachToCase(selectedItem)}>
  <FileText size={16} />加入当前案件上下文
</button>
```

- [ ] **Step 5: Run focused typecheck**

Run:

```powershell
npm run check
```

Expected: exit 0.

## Task 4: Probe And Security Preflight

**Files:**
- Create: `scripts/phase22-published-knowledge-case-context-probe.mjs`
- Modify: `scripts/security-preflight.ps1`
- Create: `docs/architecture/reviews/2026-07-04-phase-22-published-knowledge-case-context-review.md`

- [ ] **Step 1: Add Phase 22 probe**

Use the Phase 21 bundled-probe pattern. Required assertions:

```text
publishedKnowledgeAttachSucceeds=ok
contextPackReferencesSafeSummary=ok
contextPackDoesNotContainFullKnowledgeContent=ok
metadataContainsReference=ok
timelineContainsPhase22Reference=ok
duplicateAttachRemainsSingleReference=ok
pendingKnowledgeAttachBlocked=ok
draftKnowledgeAttachBlocked=ok
conflictedKnowledgeAttachBlocked=ok
expiredKnowledgeAttachBlocked=ok
wrongProjectKnowledgeAttachBlocked=ok
attachRejectsExtraFields=ok
attachRejectsInvalidItemId=ok
noUnsafeKnowledgeAttachCapabilities=ok
```

The probe must inspect the persisted `context_pack.md`, `timeline.md`, `metadata.json`, source markers, and source blocks.

- [ ] **Step 2: Add security preflight block**

Add required markers:

```powershell
parseKnowledgeCaseReferenceInput
createCaseKnowledgeReference
attachPublishedKnowledgeToCurrentCase
workbench:knowledge-attach-to-current-case
attachKnowledgeToCurrentCase
runAttachToCase
phase22-published-knowledge-case-context
```

Scan attach blocks for these forbidden markers:

```powershell
showOpenDialog
dialog.show
readFile(
fetch(
execFile(
spawn(
exec(
openExternal
openPath
loadURL
feishu-sync
unlink
rm(
publishKnowledgeItem
status: "published"
content:
```

The scan must prove the attach path does not publish, read arbitrary files, call Feishu/network/shell, delete files, or inject full knowledge body.

- [ ] **Step 3: Write adversarial review doc**

Create a short review table covering:

```md
# Phase 22 Published Knowledge Case Context Review

| Attack / failure mode | Result |
| --- | --- |
| Attach pending/draft/conflicted/expired knowledge | Blocked by backend and probe. |
| Attach cross-project knowledge | Blocked by active-project and item project checks. |
| Duplicate attach bloats case context | Same item remains one reference. |
| Full knowledge content leaks into model context | Probe checks `context_pack.md` excludes full content. |
| Attach path gains SAP/Feishu/network/shell/file-read powers | Security preflight and probe scan blocks. |
```

- [ ] **Step 4: Run phase verification**

Run:

```powershell
npm run check
node scripts\phase22-published-knowledge-case-context-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Expected: all exit 0.

## Task 5: Full Regression, Multi-Agent Review, Commit, Push

**Files:**
- Review all changed files.

- [ ] **Step 1: Dispatch adversarial review agents**

Use one code-quality/security reviewer and one product-flow reviewer. Ask them to focus on:

```text
1. Does Phase 22 only reference published same-project knowledge?
2. Can any non-published, expired, conflicted, or wrong-project item enter case context?
3. Does model-facing `context_pack.md` avoid full knowledge content and sensitive data?
4. Did the implementation add any SAP write, Feishu sync, network, shell, arbitrary file read, or delete capability?
5. Is the UI action clear and limited to the published knowledge state?
```

- [ ] **Step 2: Fix Critical and Important findings**

Apply only scoped fixes required by the reviewers. Re-run the focused Phase 22 commands after any fix.

- [ ] **Step 3: Run full regression**

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
node scripts\phase22-published-knowledge-case-context-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Expected: all exit 0.

- [ ] **Step 4: Commit and push**

Run:

```powershell
git status --short
git add apps/desktop/src/shared/workbenchTypes.ts apps/desktop/src/main/knowledgeService.ts apps/desktop/src/main/workspaceStore.ts apps/desktop/src/main/caseWorkflowService.ts apps/desktop/src/main/main.ts apps/desktop/src/preload/preload.ts apps/desktop/src/renderer/vite-env.d.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/KnowledgeCenter.tsx apps/desktop/src/renderer/styles.css scripts/security-preflight.ps1 scripts/phase22-published-knowledge-case-context-probe.mjs docs/superpowers/plans/2026-07-04-phase-22-published-knowledge-case-context-plan.md docs/architecture/reviews/2026-07-04-phase-22-published-knowledge-case-context-review.md
git commit -m "feat: add published knowledge case context"
git push -u origin codex/phase-22-published-knowledge-case-context
```

Expected: commit and push succeed.

## Self-Review

- Spec coverage: The plan covers shared data shape, strict parsing, backend same-project published-only gate, case artifact refresh, renderer action, probe, security preflight, multi-agent review, regression, commit, and push.
- Placeholder scan: No `TBD`, `TODO`, `implement later`, or unresolved task placeholders remain.
- Type consistency: `CaseKnowledgeReference`, `KnowledgeCaseReferenceInput`, `parseKnowledgeCaseReferenceInput`, `createCaseKnowledgeReference`, `attachPublishedKnowledgeToCurrentCase`, `attachKnowledgeToCurrentCase`, and `runAttachToCase` are used consistently across tasks.
