# Phase 3B Model Provider Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an executable API/model provider validation path that resolves API keys only in the Electron main process, fetches model metadata, runs a minimal chat test, stores safe provider status and model summaries, and shows a compact report in the config center.

**Architecture:** Use one narrow IPC entry, `workbench:model-provider-verify`, with only `projectId` and `providerId` from the renderer. Main process reads saved provider config, resolves the secure API key, calls a connector abstraction, writes safe status and model summaries to project config, and returns a redacted report.

**Tech Stack:** Electron main process, React + TypeScript renderer, local JSON state, Electron `safeStorage`, native `fetch`, existing PowerShell security preflight.

---

## File Structure

- `apps/desktop/src/shared/workbenchTypes.ts`
  - Add model summary, capability, verification report, and result types.
- `apps/desktop/src/main/modelProviderConnector.ts`
  - Add fake connector for demo/test hosts and HTTP OpenAI-compatible connector for real providers.
- `apps/desktop/src/main/workspaceStore.ts`
  - Add provider lookup and safe provider verification status/model list update.
- `apps/desktop/src/main/main.ts`
  - Add the single `workbench:model-provider-verify` IPC handler.
- `apps/desktop/src/preload/preload.ts`
  - Expose `verifyModelProvider(projectId, providerId)` only.
- `apps/desktop/src/renderer/vite-env.d.ts`
  - Add bridge typing.
- `apps/desktop/src/renderer/App.tsx`
  - Wire verification result into state and notice.
- `apps/desktop/src/renderer/ConfigCenter.tsx`
  - Replace disabled `获取模型` with executable provider validation and compact report.
- `apps/desktop/src/renderer/styles.css`
  - Reuse compact verification styling and add model chip styles.
- `scripts/security-preflight.ps1`
  - Whitelist only the new narrow IPC and scan for unsafe raw response/log fields.
- `docs/architecture/reviews/2026-07-02-phase-3b-model-provider-validation-review.md`
  - Record adversarial review and evidence.

## Task 1: Shared Contract And Connector

- [x] Add `ModelCapability`, `ModelSummary`, `ModelProviderVerificationReport`, and related types.
- [x] Add fake provider behavior for `api-demo.example.com`, `fake-models`, `fail-models`, and `fail-chat`.
- [x] Add HTTP OpenAI-compatible list-models and chat-test implementation.
- [x] Keep API key only in `ModelProviderConnectorInput`.
- [x] Return only redacted host, provider name/type, model summaries, statuses, and classified errors.

Expected checks:

```powershell
npm run check
```

## Task 2: Main Process And State Update

- [x] Add `WorkspaceStore.getApiProviderConfig(projectId, providerId)`.
- [x] Add `WorkspaceStore.updateModelProviderVerification(projectId, providerId, report)`.
- [x] Reset provider model/chat verification when provider config or API key changes.
- [x] Add `workbench:model-provider-verify`.
- [x] Resolve API key only in main process.
- [x] Never return API key, `secretRef`, Authorization header, raw response body, or raw provider errors.

Expected checks:

```powershell
npm run check
rg -n 'get-secret|read-secret|export-secret|run-command|exec-command|shell-command|open-any-path' apps/desktop/src/main apps/desktop/src/preload
```

## Task 3: Config Center UI

- [x] Add executable `验证模型渠道` action.
- [x] Show two steps: `获取模型列表` and `最小对话测试`.
- [x] Show report fields: provider name/type, host, model count, selected test model, last checked time, result, failure reason, next suggestion.
- [x] Display model capability chips without turning the page into a dashboard.
- [x] Avoid wording that implies the model is already used for case task execution.

Expected checks:

```powershell
npm run check
npm run build
```

## Task 4: Security Preflight And Adversarial Review

- [x] Add `workbench:model-provider-verify` to IPC whitelist.
- [x] Add scans for raw provider output fields and unsafe generic network proxy names.
- [x] Run targeted secret/customer-data scans.
- [x] Create adversarial review with real command outputs summarized.

Expected checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
rg -n 'Authorization|apiKey|secretRef|rawResponse|rawBody|rawHeaders' apps/desktop/src
```

## Task 5: Commit And Push

- [x] Review `git diff`.
- [x] Run final verification.
- [x] Commit as `feat: add model provider validation foundation`.
- [x] Run clean-tree security preflight.
- [x] Push `phase-3b-model-provider-validation`.

Expected commands:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
git add .
git commit -m "feat: add model provider validation foundation"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin phase-3b-model-provider-validation
```
