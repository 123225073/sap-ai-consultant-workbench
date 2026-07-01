# Phase 1B Minimum Case Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static desktop shell into a local minimum case loop: create a demo project/case, persist it locally, create the real case folder, write case Markdown files, read the folder into the right panel, and search local case/file names.

**Architecture:** Keep the renderer focused on UI and state. Electron main owns all file-system access through a narrow IPC API. Phase 1B uses a JSON workspace store and Markdown case files under ignored `local-data/`; SQLite, real SAP, Feishu, model APIs, and knowledge publishing remain out of scope.

**Tech Stack:** Electron IPC, React, TypeScript, Node file system APIs, JSON persistence, Markdown case files.

---

## File Structure

Create:

```text
apps/desktop/src/shared/workbenchTypes.ts
apps/desktop/src/main/workspaceStore.ts
```

Modify:

```text
apps/desktop/src/main/main.ts
apps/desktop/src/preload/preload.ts
apps/desktop/src/renderer/vite-env.d.ts
apps/desktop/src/renderer/App.tsx
apps/desktop/src/renderer/styles.css
docs/superpowers/plans/2026-07-02-phase-0-1-foundation-plan.md
```

Generated at runtime, ignored by Git:

```text
local-data/workbench/app-state.json
local-data/workbench/projects/demo-s4hana/cases/demo001/
  README.md
  conversation.md
  timeline.md
  context_pack.md
  metadata.json
  outputs/
    演示BOM核对.md
    逻辑说明图.mmd
    开发说明书.md
  knowledge_candidates/
    演示BOM筛选规则.md
  snapshots/
  evidence/
  technical/
```

## Task 1: Shared Type Contract

- [x] Define `ProjectSummary`.
- [x] Define `CaseSummary`.
- [x] Define `CaseMessage`.
- [x] Define `CaseFileNode`.
- [x] Define `WorkbenchState`.
- [x] Define `SearchResult`.
- [x] Define IPC result types with explicit error strings.

Acceptance:

- Renderer, preload, and main process use the same TypeScript contract.
- No `any` IPC payloads are needed.

## Task 2: Local Workspace Store

- [x] Create a workspace root under `local-data/workbench`.
- [x] Create `app-state.json` when missing.
- [x] Seed sanitized demo project and demo case only.
- [x] Create standard case folder structure.
- [x] Write `README.md`, `conversation.md`, `timeline.md`, `context_pack.md`, and `metadata.json`.
- [x] Write safe sample output Markdown/Mermaid files.
- [x] Read current case file tree from disk.
- [x] Search project, case, and file names.
- [x] Refuse paths outside the workspace root.

Acceptance:

- Running the app creates real local files under ignored `local-data/`.
- No SAP, Feishu, API, password, token, or real customer data is written.
- File tree comes from disk, not hard-coded renderer data.

## Task 3: Safe IPC Boundary

- [x] Add `workbench:get-state`.
- [x] Add `workbench:create-demo-project`.
- [x] Add `workbench:create-demo-case`.
- [x] Add `workbench:append-message`.
- [x] Add `workbench:get-case-files`.
- [x] Add `workbench:search`.
- [x] Return user-readable errors.

Acceptance:

- Renderer never imports Node file-system modules.
- Renderer cannot pass arbitrary file paths for reading.
- No delete operation exists in Phase 1B.

## Task 4: Renderer Case Loop

- [x] Load state from IPC on startup.
- [x] Add explainable buttons for creating demo project and demo case.
- [x] Render projects/cases from local state.
- [x] Append a local-only user message from composer.
- [x] Save message to `conversation.md`.
- [x] Refresh right panel from real file tree.
- [x] Search local project, case, and file names from the sidebar search entry.

Acceptance:

- User can create/restore the demo project and case.
- Right panel reflects the real case folder.
- Search results show source type and location.
- UI does not claim real SAP/model/Feishu integration.

## Task 5: Verification And Adversarial Review

Run:

```powershell
npm run check
npm run build
powershell -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
Run a business-label scan for old real-looking customer, system, client, user, and custom object names before committing.
```

Manual runtime checks:

- [x] Start app or dev server.
- [x] Confirm `local-data/workbench` is created.
- [x] Confirm current case files exist.
- [x] Confirm right file panel lists real files.
- [x] Confirm search returns case/file results.
- [x] Confirm no delete, SAP write, login, SaaS, API key, SAP password, or Feishu token UI exists.

Security checks:

- [x] `local-data/` remains ignored.
- [x] Path reads are constrained to the workspace root.
- [x] No arbitrary path input exists in UI.
- [x] No real business labels appear in tracked files.
