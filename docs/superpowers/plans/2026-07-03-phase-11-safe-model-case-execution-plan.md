# Phase 11 Safe Model Case Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an already verified model generate a local-only case draft from a bounded safe context, without exposing case files, technical evidence, secrets, SAP source, or generic prompt/model IPC.

**Architecture:** Reuse the existing `workbench:append-message` path. The renderer only sends the user message, task mode, and a selected model hint; the Electron main process chooses a verified provider, resolves the API key, builds a white-listed safe model context, calls the model connector, and stores only the sanitized local draft plus metadata in the current case outputs.

**Tech Stack:** Electron main process, React + TypeScript renderer, existing OpenAI-compatible model connector, local case filesystem, Phase 10 safe output summary reader, PowerShell security preflight, Node runtime probe.

---

## 1. First-Principles Decision

The product promise is not generic chat. It is a personal local SAP case workbench. The next useful step after safe output summary search is a controlled model draft that helps write the current case response while preserving the same boundaries: SAP remains read-only, Feishu is not published, knowledge is not auto-published, and technical files are not fed to the model.

Phase 11 must not add a generic `chat-completions` IPC. Model context must be built only in the main process and must use a strict allowlist.

## 2. Safe Model Context Contract

Allowed fields:

- Fixed task mode label.
- Current user input after the existing sensitive-content guard.
- Current case title and short current summary after another model-context guard.
- SAP version and short standards summary.
- Direct Phase 10 safe output summaries from the current case only, capped by count and character length.
- Fixed boundary statement: local draft only, no SAP write, no Feishu publish, no secret storage.

Forbidden fields:

- `ProjectConfig`, `WorkbenchState`, model verification reports, full search results, full knowledge content, full conversation history.
- `metadata.json`, `messages.json`, `project.json`, `app-state.json`.
- `technical/`, `evidence/`, `snapshots/`, ABAP source, SQL, tables, credentials, tokens, URLs, secure-store refs.
- Tools, function calling, web search, generic network proxying, raw prompt logging, raw response logging.

## 3. File Structure

- Create: `apps/desktop/src/main/safeModelCaseDraftService.ts`
  - Build and audit safe model contexts, sanitize model draft output, and render safe model draft files.
- Modify: `apps/desktop/src/main/modelProviderConnector.ts`
  - Add a narrow `generateSafeDraft()` method. It accepts only a prepared safe context and does not read workspace state.
- Modify: `apps/desktop/src/main/workspaceStore.ts`
  - Prepare safe model draft requests from current case state and append model draft results into existing case artifacts.
- Modify: `apps/desktop/src/main/caseWorkflowService.ts`
  - Add Phase 11 wording, local draft files, metadata, and assistant reply variants.
- Modify: `apps/desktop/src/main/main.ts`
  - Keep `workbench:append-message`, resolve API key in main, call safe model draft generation only after provider validation.
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
  - Track the last model verification mode so simulated validation does not silently qualify as real model execution.
- Modify: `apps/desktop/src/preload/preload.ts`
  - Phase label only; no new bridge method.
- Modify: `apps/desktop/src/renderer/App.tsx`
  - Show verified model status in the composer and update Phase 11 copy.
- Modify: `apps/desktop/src/renderer/ConfigCenter.tsx`
  - Display model verification mode as execution eligibility context.
- Modify: `apps/desktop/src/renderer/styles.css`
  - Small composer model status styling only.
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
  - Type updates only.
- Modify: `scripts/security-preflight.ps1`
  - Add Phase 11 safe model context and connector boundary checks.
- Create: `scripts/phase11-safe-model-case-execution-probe.mjs`
  - Runtime probe for context allowlist, unsafe exclusion, fake connector success, failure safety, and IPC boundary markers.
- Create: `docs/architecture/reviews/2026-07-03-phase-11-safe-model-case-execution-review.md`
  - Adversarial review and verification evidence.

## 4. Task 1: Write Runtime Probe First

**Files:**
- Create: `scripts/phase11-safe-model-case-execution-probe.mjs`

- [x] **Step 1: Add a probe that bundles a temporary TypeScript test entry with esbuild**

The probe must import the planned safe context builder and fake connector and fail before implementation exists.

- [x] **Step 2: Assert safe context shape**

Expected checks:

```text
contextAllowlist=ok
unsafeSecretBlocked=ok
unsafeAbapBlocked=ok
unsafeSqlBlocked=ok
unsafeUrlBlocked=ok
safeSummaryOnly=ok
```

- [x] **Step 3: Assert connector and artifact behavior**

Expected checks:

```text
fakeSafeDraft=ok
unsafeModelOutputBlocked=ok
draftArtifactNoRawPrompt=ok
noGenericIpc=ok
```

## 5. Task 2: Add Safe Model Draft Service

**Files:**
- Create: `apps/desktop/src/main/safeModelCaseDraftService.ts`

- [x] **Step 1: Define explicit allowed fields**

Add a constant marker:

```ts
export const SAFE_MODEL_CONTEXT_ALLOWED_FIELDS = [
  "taskMode",
  "taskLabel",
  "userInputSummary",
  "caseTitle",
  "caseSummary",
  "sapVersion",
  "standardsSummary",
  "safeOutputSummaries",
  "boundary"
] as const;
```

- [x] **Step 2: Add context safety guard**

Reject secret patterns, secure-store refs, URLs, ABAP source markers, SQL markers, repeated table-like rows, JSON state filenames, and technical directory names.

- [x] **Step 3: Build bounded messages**

Return only two messages: fixed system instruction and a bounded user context. Do not include tools, functions, web search, raw files, or full search results.

- [x] **Step 4: Render model draft files**

Generate only safe local files under `outputs/`, with no raw prompt, no raw model response metadata, and no secrets.

## 6. Task 3: Add Narrow Model Draft Connector

**Files:**
- Modify: `apps/desktop/src/main/modelProviderConnector.ts`

- [x] **Step 1: Extend connector interface**

Add `generateSafeDraft(input)` beside `verify(input)`.

- [x] **Step 2: Fake connector support**

Return a deterministic safe draft for `api-demo.example.com`, `fake-models.local`, or `fake-models.test`.

- [x] **Step 3: Real connector support**

Call `/chat/completions` with only `model`, `messages`, `max_tokens`, `temperature`, and `stream: false`. Do not send `tools`, `functions`, or web-search fields.

- [x] **Step 4: Sanitize response**

Extract only message text, cap it, and reject unsafe output before it can reach case files.

## 7. Task 4: Wire Existing Append Path

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/caseWorkflowService.ts`

- [x] **Step 1: Keep IPC unchanged**

`workbench:append-message` remains the only case send entry.

- [x] **Step 2: Select eligible model in main process**

Provider must be enabled, have `modelSyncStatus === "verified"`, `chatTestStatus === "verified"`, secure API key saved, and `lastVerificationMode === "http"`. Fake model execution is allowed only under a local probe environment flag.

- [x] **Step 3: Build safe context from current case**

Use only current case safe output summaries and the allowed fields above.

- [x] **Step 4: Append outcome**

Success writes a model draft output. Failure writes a safe failure note. Missing eligible model keeps the existing local workflow.

## 8. Task 5: Update UI Copy

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/ConfigCenter.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`

- [x] **Step 1: Phase label**

Change current user-facing phase copy to Phase 11.

- [x] **Step 2: Composer model status**

Show `已验证模型 · <model>` when a real verified model is eligible, otherwise show `未验证模型 · 使用本地草稿`.

- [x] **Step 3: Assistant reply copy**

Show model draft replies as `模型草稿回复` and keep the no-SAP/no-Feishu boundary visible.

## 9. Task 6: Extend Security Preflight And Review

**Files:**
- Modify: `scripts/security-preflight.ps1`
- Create: `docs/architecture/reviews/2026-07-03-phase-11-safe-model-case-execution-review.md`

- [x] **Step 1: Add required markers**

Require `SAFE_MODEL_CONTEXT_ALLOWED_FIELDS`, `buildSafeModelDraftContext`, `assertNoUnsafeModelContextText`, `generateSafeDraft`, and `safeModelDraftBoundary`.

- [x] **Step 2: Keep no generic IPC**

The IPC whitelist must remain unchanged.

- [x] **Step 3: Add adversarial review**

Record product/UX and security agent findings, implementation decisions, runtime probe results, command verification, and residual risk.

## 10. Verification

- [x] Run red probe before implementation:

```powershell
node scripts/phase11-safe-model-case-execution-probe.mjs
```

- [x] Run final probe:

```powershell
node scripts/phase11-safe-model-case-execution-probe.mjs
```

- [x] Run required checks:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

- [ ] Commit, clean preflight, and push:

```powershell
git add .
git commit -m "feat: add safe model case draft"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git -c http.proxy= -c https.proxy= push -u origin codex/phase-11-safe-model-case-execution
```

## 11. Exit Criteria

- No new IPC channel exists.
- Renderer cannot send raw prompt/messages to the model.
- Main process selects only eligible verified providers.
- Fake model execution is only possible under an explicit local probe flag.
- Model context contains only the allowlisted safe fields.
- Unsafe outputs, ABAP, SQL, URLs, secrets, technical/evidence/snapshot paths, and internal JSON names are rejected.
- Model request body does not include tools, functions, web search, raw files, full search results, or full conversation history.
- Case files store only local safe draft/failure notes and no raw prompt or raw response payload.
- UI communicates Phase 11 model draft behavior without becoming a dashboard.
- Runtime probe, `npm run check`, `npm run build`, security preflight, and `git diff --check` pass.
