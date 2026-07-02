# Phase 3C Feishu CLI Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Feishu/Lark CLI validation path that proves the configured CLI/Profile is usable enough for later document workflows without creating documents, starting auth flows, or exposing tokens.

**Architecture:** Use one narrow IPC entry, `workbench:feishu-verify-cli`, with only `projectId` from the renderer. Main process reads saved Feishu CLI config, runs a connector abstraction with fixed commands or fake demo behavior, writes safe auth/document-permission statuses, and returns a redacted report.

**Tech Stack:** Electron main process, React + TypeScript renderer, local JSON state, `node:child_process` `execFile` with fixed args and timeout, existing PowerShell security preflight.

---

## File Structure

- `apps/desktop/src/shared/workbenchTypes.ts`
  - Add Feishu verification step, error, redacted profile, report, and result types.
- `apps/desktop/src/main/feishuCliConnector.ts`
  - Add fake connector behavior for demo profiles and a real connector using fixed `lark-cli` commands.
- `apps/desktop/src/main/workspaceStore.ts`
  - Add `updateFeishuVerification(projectId, report)`.
- `apps/desktop/src/main/main.ts`
  - Add `validateFeishuConfig`, `verifyFeishuCli`, and `workbench:feishu-verify-cli`.
- `apps/desktop/src/preload/preload.ts`
  - Expose `verifyFeishuCli(projectId)` only.
- `apps/desktop/src/renderer/vite-env.d.ts`
  - Add bridge typing.
- `apps/desktop/src/renderer/App.tsx`
  - Wire verification result into state and notice.
- `apps/desktop/src/renderer/ConfigCenter.tsx`
  - Replace disabled Feishu validation with executable validation and compact report.
- `apps/desktop/src/renderer/styles.css`
  - Reuse existing verification styles.
- `scripts/security-preflight.ps1`
  - Whitelist the new narrow IPC and add child-process/token-output boundary scans.
- `docs/architecture/reviews/2026-07-02-phase-3c-feishu-cli-validation-review.md`
  - Record adversarial review and evidence.

## Task 1: Shared Contract And Connector

- [x] Add `FeishuVerificationStepId`, `FeishuVerificationErrorCode`, `FeishuCliRedactedInfo`, `FeishuVerificationReport`, and `FeishuVerificationResult`.
- [x] Create `feishuCliConnector.ts` with fake behavior:
  - `cliPath=fake-lark-cli` and `profile=demo-profile` passes all steps.
  - `cliPath=fake-lark-cli` and `profile=not-logged-in` fails auth without docs check.
  - `cliPath=fake-lark-cli` and `profile=missing-scope` passes auth and fails docs permission.
  - `cliPath` containing `missing-cli` fails CLI detection.
- [x] Real connector uses only fixed commands:
  - `doctor`
  - `auth status --verify --profile <profile>`
- [x] Do not run document create/update commands in Phase 3C.
- [x] Return only redacted CLI path basename, profile, statuses, fixed error classes, and suggestions.

Expected checks:

```powershell
npm run check
```

## Task 2: Main Process And State Update

- [x] Add `WorkspaceStore.updateFeishuVerification(projectId, report)`.
- [x] Reset Feishu auth/document statuses when Feishu non-secret config changes.
- [x] Add `workbench:feishu-verify-cli`.
- [x] Validate `cliPath` and `profile` are present before connector execution.
- [x] Never return token, raw stdout/stderr, device code, auth URL, or document content.

Expected checks:

```powershell
npm run check
rg -n 'workbench:feishu-verify-cli|verifyFeishuCli|execFile|spawn|stdout|stderr|device|token' apps/desktop/src
```

## Task 3: Config Center UI

- [x] Add executable `验证飞书 CLI` action.
- [x] Show three steps: `CLI 检测`, `登录状态`, `文档权限`.
- [x] Show report fields: CLI, Profile, last checked time, auth conclusion, document permission conclusion, failure reason, next suggestion.
- [x] Avoid wording that implies documents are already being created or published.
- [x] Disable validation while config has unsaved draft changes.

Expected checks:

```powershell
npm run check
npm run build
```

## Task 4: Security Preflight And Adversarial Review

- [x] Add `workbench:feishu-verify-cli` to IPC whitelist.
- [x] Add child-process boundary scan that allows `execFile` only in `feishuCliConnector.ts`.
- [x] Add Feishu token/auth URL/device-code/raw-output scans.
- [x] Run targeted customer-data scans.
- [x] Create adversarial review with command outputs summarized.

Expected checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
rg -n 'lark.*token|feishu.*token|device_code|verification_uri|authUrl|rawStdout|rawStderr|stdout|stderr' apps/desktop/src
```

## Task 5: Runtime Verification, Commit, And Push

- [x] Run fake connector runtime checks for success, missing CLI, not logged in, and missing scope.
- [x] Review `git diff`.
- [x] Run final verification.
- [x] Commit as `feat: add Feishu CLI validation foundation`.
- [x] Run clean-tree security preflight.
- [x] Push `phase-3c-feishu-cli-validation`.

Expected commands:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
git add .
git commit -m "feat: add Feishu CLI validation foundation"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin phase-3c-feishu-cli-validation
```
