# Phase 4 Case Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the local workbench case loop into a real case-workflow foundation where each task-mode interaction updates the current case conversation, timeline, context pack, metadata, and mode-specific local outputs.

**Architecture:** Keep the renderer thin: it sends only message text, selected task mode, and selected model ID through the existing narrow `workbench:append-message` IPC. The Electron main process validates the request, blocks obvious secret-like content, generates deterministic local Phase 4 outputs, writes only inside the active case folder, and refreshes the right-side file tree. No real SAP, model, Codex, or Feishu execution is introduced in this phase.

**Tech Stack:** Electron main process, React + TypeScript renderer, local JSON state, local file system writes inside `local-data/workbench`, existing PowerShell security preflight.

---

## File Structure

- `apps/desktop/src/shared/workbenchTypes.ts`
  - Add `TaskMode`, `CaseWorkflowInput`, and `CaseGeneratedFile` contracts.
- `apps/desktop/src/main/caseWorkflowService.ts`
  - Centralize task-mode labels, local deterministic assistant responses, context pack rendering, timeline rendering, metadata rendering, output file plans, and secret-like content blocking.
- `apps/desktop/src/main/workspaceStore.ts`
  - Use the workflow service in `appendMessage`.
  - Append both user and assistant messages.
  - Write `README.md`, `conversation.md`, `timeline.md`, `context_pack.md`, `metadata.json`, `messages.json`, and mode-specific files.
- `apps/desktop/src/main/main.ts`
  - Keep the existing `workbench:append-message` channel, but allow the payload object shape.
- `apps/desktop/src/preload/preload.ts`
  - Expose `appendMessage(input: CaseWorkflowInput | string)`.
- `apps/desktop/src/renderer/vite-env.d.ts`
  - Match the preload bridge typing.
- `apps/desktop/src/renderer/App.tsx`
  - Store selected task mode in state.
  - Pass selected task mode/model ID when sending.
  - Update visible copy from Phase 2 to Phase 4.
  - Show linked files from assistant messages as chips.
- `scripts/security-preflight.ps1`
  - Add case-workflow secret and boundary markers.
- `docs/architecture/reviews/2026-07-02-phase-4-case-workflow-review.md`
  - Record product, UX, security, and verification review.

## Task 1: Shared Contract And Workflow Service

- [x] Add a shared `TaskMode` union: `problem-analysis`, `abap-development`, `document-generation`, `flow-diagram`.
- [x] Add `CaseWorkflowInput` with `content`, `taskMode`, and `modelId`.
- [x] Add `CaseGeneratedFile` with `relativePath`, `purpose`, and `content`.
- [x] Create `caseWorkflowService.ts`.
- [x] Implement `normalizeTaskMode(value)` so unknown modes fall back to `problem-analysis`.
- [x] Implement `parseCaseWorkflowInput(input)` so the old string payload still works.
- [x] Implement `assertNoSensitiveCaseContent(content)` to block obvious `sk-*`, bearer token, `secure-store:sec_*`, password, API key, token, cookie, and authorization patterns before writing Markdown.
- [x] Implement deterministic output plans for the four task modes without calling any external service.

Expected checks:

```powershell
npm run check
```

## Task 2: Main Process Case Persistence

- [x] Update `WorkspaceStore.appendMessage` to accept `unknown` input and use `parseCaseWorkflowInput`.
- [x] Append a user message and a local assistant message for each send.
- [x] Set each message `taskMode` and `modelId`.
- [x] Update `currentSummary`, `updatedAt`, and `lastOpenedAt`.
- [x] Write `conversation.md` as ordered user/AI entries.
- [x] Write `timeline.md` with append-like case events based on persisted messages.
- [x] Write `context_pack.md` with current goal, confirmed local facts, recent files, boundaries, and next actions.
- [x] Write `metadata.json` with task mode, generated files, local-only status, and no secrets.
- [x] Write mode-specific files to `outputs/`, `knowledge_candidates/`, `snapshots/`, `evidence/`, or `technical/`.

Expected checks:

```powershell
npm run check
```

## Task 3: Renderer Task Mode Interaction

- [x] Make task mode tabs actually selectable.
- [x] Use selected task mode in the send payload.
- [x] Update placeholder and notice copy to Phase 4 local workflow wording.
- [x] Show assistant linked files as chips when `linkedFileIds` are present.
- [x] Keep disabled attachment, mic, and real model controls clearly marked as not connected.
- [x] Avoid adding dashboard panels or extra technical process cards.

Expected checks:

```powershell
npm run check
npm run build
```

## Task 4: Safety Preflight And Runtime Verification

- [x] Add preflight scans for case workflow secret-blocking markers.
- [x] Add preflight scans that prevent generic file/path IPC from appearing.
- [x] Run a runtime WorkspaceStore check that sends each task mode and verifies the expected files are created.
- [x] Run a runtime WorkspaceStore check that secret-like content is rejected before case Markdown is written.
- [x] Run targeted old SAP/customer keyword scan.

Expected checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
rg -n "secure-store:sec_|sk-[A-Za-z0-9]{20,}|tenant_access_token|user_access_token|password\\s*[:=]|api[_-]?key\\s*[:=]" apps/desktop/src
```

## Task 5: Adversarial Review, Commit, And Push

- [x] Wait for product/UX and security review agents.
- [x] Fix all high and must-fix findings.
- [x] Create `docs/architecture/reviews/2026-07-02-phase-4-case-workflow-review.md`.
- [x] Mark this plan complete.
- [x] Run final verification.
- [x] Commit as `feat: add local case workflow foundation`.
- [x] Run clean-tree security preflight.
- [x] Push `phase-4-case-workflows`.

Expected commands:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
git add .
git commit -m "feat: add local case workflow foundation"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin phase-4-case-workflows
```
