# Phase 25 Case File And Knowledge Status Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current case file panel and Knowledge Center clearly explain which files are deliverables, pending knowledge candidates, and restricted technical evidence without adding new unsafe capabilities.

**Architecture:** Reuse existing case metadata instead of introducing new flows. Renderer changes translate existing `CaseFileNode.purpose` and `KnowledgeItem` status/source fields into plain UI labels. Main-process changes are limited to hiding internal case-state files from the file tree and removing visible source-path leakage from search results. Probes and security preflight prove the boundary.

**Tech Stack:** Electron, React + TypeScript, CSS, Node/esbuild probe scripts, PowerShell security preflight.

---

## Scope

In scope:

- Add a Phase 25 UI marker and compact purpose labels in the current case file panel.
- Show deliverable, pending-knowledge, and technical-evidence/process-material labels using the existing `CaseFileNode.purpose` field.
- Replace visible file preview subtitles and row titles that exposed internal relative paths.
- Rename the Feishu handoff action so it is clearly a local draft generator only.
- Clarify Knowledge Center source and reuse state without showing `sourceFilePath`.
- Tighten renderer-side reusable-knowledge display so it matches the human-review requirement.
- Hide internal case-state files from the active case file tree.
- Remove visible internal/source paths from search result location, snippet, and indexed knowledge content.
- Add a Phase 25 probe and extend `security-preflight.ps1`.
- Record adversarial product and security review outcomes.

Out of scope:

- No new IPC channel.
- No new arbitrary local path open/read behavior.
- No SAP write, activation, transport release, or table-query feature.
- No Feishu cloud publish, sync, auth, or document creation.
- No automatic knowledge review, publish, or attach.
- No broad redesign, dashboard conversion, or new connector.

## File Structure

- Modify `apps/desktop/src/renderer/App.tsx`
  - Case file purpose labels, legend, preview subtitle, and local-only Feishu draft wording.
- Modify `apps/desktop/src/renderer/KnowledgeCenter.tsx`
  - Knowledge source/reuse labels, stricter reusable-review predicate, and case-candidate warning.
- Modify `apps/desktop/src/renderer/styles.css`
  - Compact purpose badges, legend dots, and source-warning styling.
- Modify `apps/desktop/src/main/workspaceStore.ts`
  - Hide `messages.json`, `metadata.json`, `project.json`, `app-state.json`, credential, and secret files from the current case tree.
- Modify `apps/desktop/src/main/searchService.ts`
  - Replace internal path text with safe purpose labels, hashed result IDs, and null `sourcePath` values.
- Create `scripts/phase25-case-file-knowledge-status-clarity-probe.mjs`
  - Static and runtime checks for markers, no new IPC, no unsafe renderer capability, hidden internal files, and safe search labels.
- Modify `scripts/security-preflight.ps1`
  - Phase 25 marker and forbidden-string scans.
- Create `docs/architecture/reviews/2026-07-04-phase-25-case-file-knowledge-status-clarity-review.md`
  - Adversarial review summary, fixes, verification, and residual risk.

## Tasks

### Task 1: Add Phase 25 Probe

**Files:**
- Create: `scripts/phase25-case-file-knowledge-status-clarity-probe.mjs`

- [x] **Step 1: Read relevant source files**

The probe reads `App.tsx`, `KnowledgeCenter.tsx`, `styles.css`, `workspaceStore.ts`, `searchService.ts`, `main.ts`, `preload.ts`, and `security-preflight.ps1`.

- [x] **Step 2: Assert UI and boundary markers**

Required markers include:

```text
phase25-case-file-knowledge-status-clarity
caseFilePurposeLabel
caseFilePurposeTone
filePreviewSubtitle
knowledgeSourceLabel
knowledgeReuseLabel
isInternalCaseTreeEntry
safeFilePurposeLabel
```

- [x] **Step 3: Assert no new Phase 25 IPC**

The probe rejects `workbench:phase25` in main, preload, renderer, and Knowledge Center files.

- [x] **Step 4: Assert no unsafe renderer capability**

The renderer additions must not contain file-read, path-open, command, network, SAP-write, Feishu-sync, or transport-release markers.

- [x] **Step 5: Runtime-check hidden internal files**

The probe bundles `WorkspaceStore`, creates a temporary project/case, and proves `metadata.json` and `messages.json` do not appear in the current case file tree.

### Task 2: Label Current Case Files By Purpose

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [x] **Step 1: Add purpose helpers**

`caseFilePurposeLabel` maps:

```text
output -> deliverable
candidate_knowledge -> pending knowledge
technical/evidence/snapshot -> technical evidence / process material
summary/conversation -> case record
```

`caseFilePurposeTone` maps those purposes to compact badge tones.

- [x] **Step 2: Render purpose labels in file rows**

Rows show the file name and a purpose badge, not `node.relativePath` as the visible title.

- [x] **Step 3: Add file panel legend**

The right panel shows a compact legend for deliverables, pending knowledge, and technical evidence/process material.

- [x] **Step 4: Replace preview subtitle**

Preview header subtitle now uses `filePreviewSubtitle`, so the UI describes the current file role instead of exposing `filePreview.relativePath`.

- [x] **Step 5: Rename Feishu local draft action**

The button text and title make clear that the action generates local Feishu draft files only and does not publish or update cloud documents.

### Task 3: Clarify Knowledge Source And Reuse State

**Files:**
- Modify: `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [x] **Step 1: Add knowledge source and reuse helpers**

`knowledgeSourceLabel` names case-generated, document-import, QA-import, and manual sources without exposing `sourceFilePath`.

Published imported knowledge is labeled as formal knowledge rather than as a candidate.

`knowledgeReuseLabel` explains whether an item is reusable, still pending review, conflicted, expired, or manually maintained.

- [x] **Step 2: Tighten reusable review display**

`hasReusableReviewRecord` now requires complete review metadata, review note length, and a complete checklist before UI labels published knowledge as reusable.

- [x] **Step 3: Update list and detail copy**

Knowledge list and detail rows use plain source/reuse labels instead of direct source paths.

- [x] **Step 4: Add case-candidate warning**

Case-generated pending candidates show a warning that they come from the current case and require human review before they become formal reusable knowledge.

### Task 4: Hide Internal Paths And State Files

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/searchService.ts`

- [x] **Step 1: Hide internal case tree files**

`isInternalCaseTreeEntry` removes `messages.json`, `metadata.json`, `project.json`, `app-state.json`, credential/secret files, and credential/secret directories from the current case tree data returned to the renderer.

- [x] **Step 2: Remove visible source-path leakage from search**

Knowledge search records no longer expose `sourceFilePath` in `location`, `content`, or `sourcePath`. Knowledge Center search also no longer matches hidden `sourceFilePath`.

- [x] **Step 3: Replace file result labels**

Current-case file search results use `safeFilePurposeLabel` for visible labels and hashed IDs instead of raw relative paths. Search results do not return preview paths; file preview remains available from the right-side current-case file tree.

- [x] **Step 4: Remove raw safe-output summary paths from visible locations**

Safe output summaries use hashed result IDs and null `sourcePath`; visible locations no longer include raw `summary.relativePath`.

### Task 5: Extend Security Preflight

**Files:**
- Modify: `scripts/security-preflight.ps1`

- [x] **Step 1: Add Phase 25 marker checks**

Preflight checks markers for renderer labels, Knowledge Center labels, main-process file-tree filtering, search safe labels, and the Phase 25 probe.

- [x] **Step 2: Add forbidden capability scans**

Preflight rejects Phase 25 renderer strings for file reads, path opens, command execution, network fetch, SAP write, Feishu sync, transport release, and `workbench:phase25`.

- [x] **Step 3: Add visible internal-path scans**

Preflight rejects visible `relativePath`, `sourceFilePath`, and raw file-location patterns that Phase 25 intentionally removed.

### Task 6: Review, Verify, Commit, And Push

**Files:**
- Create: `docs/architecture/reviews/2026-07-04-phase-25-case-file-knowledge-status-clarity-review.md`

- [x] **Step 1: Record adversarial review**

Document the product/UX and security review findings, the fixes made, and residual risks.

- [x] **Step 2: Run focused verification**

```powershell
npm run check
node scripts\phase25-case-file-knowledge-status-clarity-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [x] **Step 3: Run Phase 11-25 regression and build**

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
node scripts\phase25-case-file-knowledge-status-clarity-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [ ] **Step 4: Commit and push**

```powershell
git add apps/desktop/src/main/searchService.ts apps/desktop/src/main/workspaceStore.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/KnowledgeCenter.tsx apps/desktop/src/renderer/styles.css scripts/phase12-sap-readonly-evidence-probe.mjs scripts/security-preflight.ps1 scripts/phase25-case-file-knowledge-status-clarity-probe.mjs docs/superpowers/plans/2026-07-04-phase-25-case-file-knowledge-status-clarity-plan.md docs/architecture/reviews/2026-07-04-phase-25-case-file-knowledge-status-clarity-review.md
git commit -m "feat: clarify case file and knowledge status"
git push
```

## Self-Review

- Spec coverage: Phase 25 improves clarity for case files and knowledge status while keeping SAP, Feishu, model context, and publish/review flows unchanged.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: existing `CaseFileNode.purpose`, `KnowledgeItem.status`, and `KnowledgeItem.sourceType` fields are reused.
- Boundary consistency: internal case-state filtering and visible path cleanup are included because the adversarial review showed UI-only labeling was not enough.
