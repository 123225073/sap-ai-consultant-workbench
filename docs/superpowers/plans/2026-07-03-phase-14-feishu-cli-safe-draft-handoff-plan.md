# Phase 14 Feishu CLI Safe Draft Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only Feishu handoff draft action for the current case, producing Feishu-ready Markdown/Mermaid/manifest files without creating, updating, or publishing any Feishu cloud document.

**Architecture:** Keep Feishu cloud interaction out of this phase. The renderer triggers one narrow IPC action; Electron main reuses the active project/case store, reads only safe current-case `outputs/` summaries through existing workspace guards, and writes only fixed local handoff artifacts under the current case `outputs/` and `technical/` folders.

**Tech Stack:** Electron main process, React/TypeScript renderer, local JSON/SQLite search foundation, current case filesystem writer, existing Feishu CLI verification status, security preflight, esbuild probe scripts.

---

## Scope

Phase 14 builds a "prepare Feishu handoff" feature, not Feishu publishing.

Allowed:

- Generate local handoff artifacts under the current case.
- Use existing Feishu verification status as context.
- Include exact publish commands as inert text only.
- Refresh the right-side current case file tree.

Blocked:

- No `lark-cli docs +create`, `docs +update`, or `docs +whiteboard-update` execution.
- No `auth login`, device-code flow, authorization URL, or token handling.
- No arbitrary CLI command, arbitrary path read, or generic file bridge.
- No SAP write, no knowledge auto-publish, no cloud document creation.
- No copying old SAP ABAP workspace data or old FeiShu CLI runtime outputs.

## Reference Reuse

- Reuse the old SAP ABAP/FeiShu CLI operating pattern only as process guidance: status first, fixed commands, local draft handoff, human final confirmation.
- Reuse SAP Skills guidance only as safety policy: ADT stays read-only, Feishu/CSDN publish stops at draft/handoff unless explicitly confirmed.
- Treat `shrek-abaper/sap-engineering-skill` as the ADT safety reference for "read-only by default, write requires explicit confirmation"; do not vendor or copy its code into this repo.

## Files

- Create: `apps/desktop/src/main/feishuHandoffService.ts`
- Create: `scripts/phase14-feishu-safe-handoff-probe.mjs`
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `scripts/security-preflight.ps1`
- Create: `docs/architecture/reviews/2026-07-03-phase-14-feishu-cli-safe-draft-handoff-review.md`

## Tasks

### Task 1: Local Handoff Contract And Renderer

**Files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Create: `apps/desktop/src/main/feishuHandoffService.ts`

- [x] Add `FeishuHandoffPublishStatus = "not-published"` and `FeishuHandoffResult`.
- [x] Implement `renderFeishuHandoffArtifacts(...)` that accepts only project/case metadata, Feishu verification status, and safe output summaries.
- [x] Generate three fixed artifacts:
  - `outputs/feishu-handoff-<timestamp>.md`
  - `outputs/feishu-whiteboard-<timestamp>.mmd`
  - `technical/feishu-handoff-manifest-<timestamp>.json`
- [x] Include "local draft", "not published", "human confirmation required", and blocked actions in the Markdown/manifest.
- [x] Ensure generated text does not include raw tokens, auth URLs, document IDs, or cloud document URLs.

### Task 2: Workspace Integration

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`

- [x] Add `prepareFeishuHandoff()` on `WorkspaceStore`.
- [x] Reuse `ensureCaseFiles`, `readCaseTree`, and `readSafeOutputSummariesForCase`; do not add a new arbitrary file read path.
- [x] Refuse to prepare handoff when the active case has no safe `outputs/` summaries.
- [x] Return an updated file tree plus generated file paths for the renderer notice.
- [x] Preserve `publishStatus: "not-published"` in the return value and generated manifest.
- [x] Avoid rewriting case maintenance files, messages, app state, search database, or project metadata during this action.

### Task 3: Narrow IPC And UI Entry

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [x] Register one IPC only: `workbench:prepare-feishu-handoff`.
- [x] Expose one preload method only: `prepareFeishuHandoff()`.
- [x] Add a compact action in the current case file panel: "Prepare local Feishu draft".
- [x] Disable the action while running; show a plain notice after success/failure.
- [x] Keep the action local-only in copy and tooltip; do not claim "published".
- [x] Keep the visual style consistent with existing file panel controls.

### Task 4: Probe And Security Preflight

**Files:**
- Create: `scripts/phase14-feishu-safe-handoff-probe.mjs`
- Modify: `scripts/security-preflight.ps1`

- [x] Probe actual disk changes and fail if the action writes anything except the three handoff files under `outputs/` and `technical/`.
- [x] Probe that generated artifacts include `not-published` and exclude `document_id`, `tenant_access_token`, `user_access_token`, `Authorization`, `Cookie`, and `secure-store:sec_`.
- [x] Probe that handoff preparation does not require or execute Feishu CLI.
- [x] Extend security preflight with markers for the new service and IPC.
- [x] Extend security preflight to reject Feishu publishing/auth commands in app source, including `docs +create`, `docs +update`, `docs +publish`, `whiteboard-update`, and `auth login`.
- [x] Keep child-process execution restricted to `feishuCliConnector.ts`.

### Task 5: Verification, Review, Commit, Push

**Files:**
- Modify: `docs/architecture/reviews/2026-07-03-phase-14-feishu-cli-safe-draft-handoff-review.md`
- Modify: this plan file, marking completed boxes.

- [x] Run `npm run check`.
- [x] Run `node scripts\phase11-safe-model-case-execution-probe.mjs`.
- [x] Run `node scripts\phase12-sap-readonly-evidence-probe.mjs`.
- [x] Run `node scripts\phase13-real-adt-readonly-evidence-probe.mjs`.
- [x] Run `node scripts\phase14-feishu-safe-handoff-probe.mjs`.
- [x] Run `npm run build`.
- [x] Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`.
- [x] Run `git diff --check`.
- [x] Update the adversarial review with actual evidence.
- [x] Commit as `feat: add Feishu CLI safe draft handoff`.
- [x] Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1 -RequireClean`.
- [x] Push `codex/phase-14-feishu-cli-safe-draft-handoff`.

## Acceptance Criteria

- The user can prepare a Feishu-ready local handoff from the current case.
- The right file panel shows the generated Markdown, Mermaid, and manifest files.
- No Feishu cloud document is created, updated, or published.
- No new generic command, file, URL, SAP, or Feishu proxy is exposed.
- Search/model-safe context remains limited to safe `outputs/` summaries.
- Security preflight and the Phase 14 probe prove the local-only boundary.
- The handoff action does not rewrite case maintenance files such as `README.md`, `timeline.md`, `context_pack.md`, `metadata.json`, `messages.json`, `project.json`, `app-state.json`, or the search database.
