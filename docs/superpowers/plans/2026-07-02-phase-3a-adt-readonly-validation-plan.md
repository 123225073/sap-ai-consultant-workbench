# Phase 3A ADT Readonly Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an executable ADT read-only validation path that checks project config, resolves the secure ADT password only in the Electron main process, runs a fake `status + T000` verification connector, stores sanitized validation status, and shows a plain-language report in the config center.

**Architecture:** Use one narrow IPC entry, `workbench:adt-verify-readonly`, instead of exposing command execution or secret-read APIs. The renderer sends only `projectId`; the main process reads the saved project config, resolves the secure secret, calls a main-process connector abstraction, writes back only status metadata, and returns a redacted report.

**Tech Stack:** Electron main process, React + TypeScript renderer, local JSON state, Electron `safeStorage`, TypeScript-only connector abstraction, existing PowerShell security preflight.

---

## File Structure

- `apps/desktop/src/shared/workbenchTypes.ts`
  - Add `verified` status and ADT verification report types shared by main, preload, and renderer.
- `apps/desktop/src/main/adtReadonlyConnector.ts`
  - Create fake read-only ADT connector with config/status/T000 report assembly and redaction.
- `apps/desktop/src/main/workspaceStore.ts`
  - Add project config lookup and sanitized ADT verification status update.
  - Preserve verification status when loading saved state, but reset it when config or secret changes.
- `apps/desktop/src/main/main.ts`
  - Add the single `workbench:adt-verify-readonly` IPC handler.
- `apps/desktop/src/preload/preload.ts`
  - Expose `verifyAdtReadonly(projectId)` only.
- `apps/desktop/src/renderer/vite-env.d.ts`
  - Add bridge typing for the new narrow method.
- `apps/desktop/src/renderer/App.tsx`
  - Wire verification into app state and user notice.
- `apps/desktop/src/renderer/ConfigCenter.tsx`
  - Replace disabled ADT connection buttons with one read-only verification action and a three-step report.
- `apps/desktop/src/renderer/styles.css`
  - Add compact report and verification-step styles.
- `scripts/security-preflight.ps1`
  - Whitelist only the new narrow IPC and keep dangerous IPC scans.
- `docs/architecture/reviews/2026-07-02-phase-3a-adt-readonly-validation-review.md`
  - Record adversarial review and evidence.

## Task 1: Shared Contract And Connector

- [x] Add shared ADT verification types.
- [x] Create `AdtReadonlyConnector` with a fake connector.
- [x] Ensure `password` appears only in the internal main-process connector input type.
- [x] Redact host and username in the returned report.
- [x] Simulate `status` failure when alias, URL, or username contains `fail-status`.
- [x] Simulate `T000` failure when alias, URL, or username contains `fail-t000`.

Expected checks:

```powershell
npm run check
```

Expected result: type checking either passes or reports only later integration errors that the next task fixes.

## Task 2: Main Process And State Update

- [x] Add `WorkspaceStore.getProjectConfig(projectId)`.
- [x] Add `WorkspaceStore.updateAdtVerification(projectId, report)`.
- [x] Preserve saved verification status on state load.
- [x] Keep `saveProjectConfig` and `attachProjectSecret` resetting verification to pending.
- [x] Add `workbench:adt-verify-readonly`.
- [x] Resolve `secretRef` only in the main process.
- [x] Never return password, encrypted value, Authorization, Cookie, CSRF token, or `secretRef` to the renderer.

Expected checks:

```powershell
npm run check
rg -n 'get-secret|read-secret|export-secret|run-command|runCommand|exec-command|shell-command|read-file|write-file|open-any-path' apps/desktop/src/main apps/desktop/src/preload
```

Expected result: type checking passes; dangerous IPC scan returns no matches.

## Task 3: Config Center UI

- [x] Add the `verified` label.
- [x] Replace disabled `测试连接` and `读取 T000` buttons with `执行只读验证`.
- [x] Show three steps: `配置检查`, `ADT status`, `T000 最小读取`.
- [x] Show report fields: system alias, SAP host, Client, user, SSL mode, read-only mode, transport write mode, minimal object, last checked time, result, failure reason, next suggestion.
- [x] Avoid misleading text such as `连接成功`, `账号密码正确`, or `ADT 可用` before T000 succeeds.
- [x] Keep the section compact and aligned with the existing Codex-style config page.

Expected checks:

```powershell
npm run check
npm run build
```

Expected result: renderer and production build pass.

## Task 4: Security Preflight And Adversarial Review

- [x] Add `workbench:adt-verify-readonly` to IPC whitelist.
- [x] Keep the dangerous IPC scan blocking generic secret-read and command execution names.
- [x] Run sensitive keyword scans.
- [x] Create adversarial review with real command outputs summarized.

Expected checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
rg -n 'activate|transport|release|create.*sap|update.*sap|delete.*sap' apps/desktop/src
rg -n 'password|secretRef|Authorization|Cookie|csrf|encryptedValue' local-data -g '*.json'
```

Expected result: preflight passes; no SAP write path exists; local-data scan either has no files or contains no raw secret values in public project/config files.

## Task 5: Commit And Push

- [x] Review `git diff`.
- [x] Run final verification.
- [x] Commit as `feat: add ADT readonly validation foundation`.
- [x] Run clean-tree security preflight.
- [x] Push `phase-3a-adt-readonly-validation`.

Expected commands:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
git add .
git commit -m "feat: add ADT readonly validation foundation"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin phase-3a-adt-readonly-validation
```
