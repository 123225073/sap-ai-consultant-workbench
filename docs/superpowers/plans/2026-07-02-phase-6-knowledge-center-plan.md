# Phase 6 Knowledge Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local knowledge center foundation so case-generated candidates can be reviewed, published, conflicted, expired, persisted, and searched without automatic formal knowledge ingestion.

**Architecture:** Keep knowledge local to the current project under `local-data/workbench/projects/<project>/knowledge/`. Case workflows may create pending candidate records only. Narrow IPC methods expose read, publish, conflict, and expire actions; all status changes are explicit user actions in the renderer. No real SAP, model, Feishu, document parsing, cloud sync, or automatic knowledge publishing is introduced.

**Tech Stack:** Electron main process, React + TypeScript renderer, local JSON/file persistence, existing PowerShell security preflight.

---

## File Structure

- `apps/desktop/src/shared/workbenchTypes.ts`
  - Add knowledge item, status, timeline, document queue, view, and action contracts.
- `apps/desktop/src/main/knowledgeService.ts`
  - Define local knowledge state machine, sensitive content checks, candidate creation, publish/conflict/expire actions, view rendering, and safe file rendering.
- `apps/desktop/src/main/workspaceStore.ts`
  - Store project knowledge, create pending candidates from case workflow output, persist fixed knowledge files, search knowledge items.
- `apps/desktop/src/main/main.ts`
  - Add narrow knowledge IPC handlers only.
- `apps/desktop/src/preload/preload.ts`
  - Expose knowledge read and action methods.
- `apps/desktop/src/renderer/vite-env.d.ts`
  - Match bridge typing.
- `apps/desktop/src/renderer/KnowledgeCenter.tsx`
  - Add project knowledge UI: status filters, candidate list, details, review actions, document parsing queue.
- `apps/desktop/src/renderer/App.tsx`
  - Add navigation into knowledge center and wire actions.
- `apps/desktop/src/renderer/styles.css`
  - Add knowledge center layout styles consistent with the existing workbench.
- `scripts/security-preflight.ps1`
  - Whitelist narrow knowledge IPC and add knowledge safety scans.
- `docs/architecture/reviews/2026-07-02-phase-6-knowledge-center-review.md`
  - Record product, UX, security, and verification review.

## Task 1: Shared Knowledge Contract And Service

- [x] Add knowledge shared types for item status, item type, source type, timeline events, document queue, view, and action input.
- [x] Create `knowledgeService.ts`.
- [x] Define demo knowledge items and document parsing queue.
- [x] Normalize old project state through sensitive content checks.
- [x] Validate knowledge text for obvious secrets, auth artifacts, SAP session material, write statements, and large source markers.
- [x] Generate pending case candidates only; do not publish from the case workflow.
- [x] Render project knowledge JSON and Markdown with safety markers.

Expected check:

```powershell
npm run check
```

## Task 2: Main Process Persistence And IPC

- [x] Add `knowledge` to each project state.
- [x] Add `getProjectKnowledge(projectId)`.
- [x] Add `publishKnowledge(projectId, input)`.
- [x] Add `markKnowledgeConflicted(projectId, input)`.
- [x] Add `expireKnowledge(projectId, input)`.
- [x] Persist `knowledge/project-knowledge.json` and `knowledge/project-knowledge.md`.
- [x] Add narrow IPC handlers: `workbench:get-project-knowledge`, `workbench:knowledge-publish`, `workbench:knowledge-mark-conflict`, `workbench:knowledge-expire`.
- [x] Keep knowledge writes inside the current local workspace and project folder.

Expected check:

```powershell
npm run check
```

## Task 3: Renderer Knowledge Center

- [x] Add `KnowledgeCenter.tsx`.
- [x] Add navigation from the left sidebar.
- [x] Show current project, SAP version, total counts, pending count, published count, conflict/expired count.
- [x] Show status filters, searchable knowledge list, detail pane, and item timeline.
- [x] Let the user explicitly publish, mark conflicted, or expire a knowledge item.
- [x] Show document parsing queue without pretending real parsing is already available.
- [x] Keep UI as a workbench page, not a dashboard.

Expected checks:

```powershell
npm run check
npm run build
```

## Task 4: Search And Case Workflow Link

- [x] Case workflow creates pending candidate knowledge records when a candidate knowledge file is generated.
- [x] Candidate knowledge remains pending until the user confirms it in the knowledge center.
- [x] Global search includes knowledge title, summary, content, status, type, source file, and SAP object tags.
- [x] Case workflow and chat output do not auto-publish formal knowledge.

Expected runtime check:

```powershell
# Use a temp workspace to append a problem-analysis case message,
# confirm a pending knowledge item appears, publish it explicitly,
# confirm search finds it, and verify persisted knowledge files exist.
```

## Task 5: Adversarial Review, Verification, Commit, And Push

- [x] Dispatch product/UX and security/architecture read-only review agents.
- [x] Fix must-fix findings.
- [x] Create `docs/architecture/reviews/2026-07-02-phase-6-knowledge-center-review.md`.
- [x] Run final verification.
- [ ] Commit as `feat: add local knowledge center`.
- [ ] Run clean-tree security preflight.
- [ ] Push `phase-6-knowledge-center`.

Expected commands:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
git add .
git commit -m "feat: add local knowledge center"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin phase-6-knowledge-center
```
