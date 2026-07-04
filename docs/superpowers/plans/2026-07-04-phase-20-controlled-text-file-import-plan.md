# Controlled Text File Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow Markdown/TXT file import path that creates pending knowledge candidates and still requires the Phase 19 human review gate before publishing.

**Architecture:** The renderer can request a controlled import but never receives or supplies an absolute path. The Electron main process owns the native file picker and one-time file read, then passes only sanitized text and basename metadata into the existing local-text import pipeline.

**Tech Stack:** Electron, React, TypeScript, local filesystem, existing knowledge import/review services, PowerShell security preflight, Node probe scripts.

---

### Task 1: Define the Controlled Import Contract

**Files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`

- [ ] Add a new shared input type with only `projectId`.
- [ ] Add a new shared result type that extends the existing import result with safe display metadata: basename, extension, byte size, and imported character count.
- [ ] Expose `importKnowledgeTextFile(input)` through the preload bridge.
- [ ] Do not expose any absolute filesystem path to the renderer.

### Task 2: Add Main-Process File Picker and Read Guard

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/knowledgeService.ts`

- [ ] Add one IPC channel: `workbench:knowledge-import-text-file`.
- [ ] In the main process, use `dialog.showOpenDialog` with a single-file filter for `.md`, `.markdown`, and `.txt`.
- [ ] Reject cancellation with a safe user-facing result.
- [ ] Validate extension before reading.
- [ ] Validate file size before reading; cap at a small limit aligned to the existing 8,000-character body guard.
- [ ] Read the selected file once as UTF-8.
- [ ] Reject NUL/control-heavy content as non-text.
- [ ] Build a `KnowledgeImportLocalTextInput` with safe basename only, not the absolute path.
- [ ] Reuse `parseKnowledgeImportLocalTextInput` and `importKnowledgeLocalText`.

### Task 3: Update Knowledge Center UI

**Files:**
- Modify: `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] Replace the disabled "file read closed" action with a real "import Markdown/TXT" button.
- [ ] Keep QA spreadsheet read and Feishu sync disabled.
- [ ] Show a concise import status using safe metadata only: filename, size, imported text length.
- [ ] Keep the pasted-text import form intact.
- [ ] Ensure successful file import selects the pending view and refreshes state.
- [ ] Do not add a file preview, generic file browser, or path display.

### Task 4: Add Phase 20 Probe and Security Preflight

**Files:**
- Create: `scripts/phase20-controlled-text-file-import-probe.mjs`
- Modify: `scripts/security-preflight.ps1`

- [ ] Probe valid Markdown and TXT imports through the main/store path without persisting absolute paths.
- [ ] Probe blocked extensions, oversized files, binary-like files, path-like source names, secrets/tokens, Feishu links, ABAP source/write snippets, and structured row dumps.
- [ ] Probe imported items remain `pending`, are recognized by Phase 19 review gate, cannot publish before review, and can publish only after review.
- [ ] Update preflight markers for the new IPC, preload method, renderer method, and probe.
- [ ] Allow `dialog.showOpenDialog` and `readFile` only in the controlled Phase 20 main-process file-import block; continue blocking them from the renderer, preload, parser, candidate builder, and sourceFilePath usage.

### Task 5: Adversarial Review and Verification

**Files:**
- Create: `docs/architecture/reviews/2026-07-04-phase-20-controlled-text-file-import-review.md`

- [ ] Document what was allowed and blocked.
- [ ] Run `npm run check`.
- [ ] Run Phase 11 through Phase 20 probe scripts.
- [ ] Run `npm run build`.
- [ ] Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`.
- [ ] Run `git diff --check`.
- [ ] Request code review with a fresh subagent if available; fix Critical and Important issues.
- [ ] Commit and push the branch only after verification passes.

## Self-Review

- Spec coverage: This plan covers the MVP requirement "upload/import documents and generate pending knowledge" for the safest first slice: Markdown/TXT only.
- Explicit exclusions: Word, PDF, Excel, ABAP source import, Feishu sync/publish, SAP writes, generic file browser, arbitrary path read, auto-publish, and conflict auto-merge stay out of scope.
- Safety gates: The file import path still flows into Phase 16 content firewall and Phase 19 human review gate.
