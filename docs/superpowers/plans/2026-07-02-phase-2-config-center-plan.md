# Phase 2 Config Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-level configuration center foundation that saves only non-secret local configuration, shows safe status, and prepares for later ADT/Feishu/API/Codex validation without performing real external calls.

**Architecture:** Keep all configuration persistence in Electron main through the existing `WorkspaceStore`. Renderer displays and edits config via a narrow IPC API. Secrets are never accepted or persisted in Phase 2; every sensitive capability is represented by `secretRef: null`, masked UI, and clear "待安全存储接入" status.

**Tech Stack:** Electron IPC, React, TypeScript, JSON persistence under ignored `local-data/workbench`, Lucide React.

---

## File Structure

Modify:

```text
apps/desktop/src/shared/workbenchTypes.ts
apps/desktop/src/main/workspaceStore.ts
apps/desktop/src/main/main.ts
apps/desktop/src/preload/preload.ts
apps/desktop/src/renderer/vite-env.d.ts
apps/desktop/src/renderer/App.tsx
apps/desktop/src/renderer/styles.css
docs/architecture/reviews/
```

Create:

```text
apps/desktop/src/renderer/ConfigCenter.tsx
docs/architecture/reviews/2026-07-02-phase-2-config-center-review.md
```

## Task 1: Configuration Type Contract

- [x] Define `ProjectConfig`.
- [x] Define `AdtConfig`.
- [x] Define `FeishuConfig`.
- [x] Define `ApiProviderConfig`.
- [x] Define `CodexConfig`.
- [x] Define `LocalStorageConfig`.
- [x] Ensure every sensitive item uses `secretRef: string | null`.

Acceptance:

- No type contains `password`, `apiKey`, `token`, or raw secret value fields.
- Status values distinguish `not-configured`, `saved`, `pending-verification`, and `failed`.
- No status implies real validation unless a later connector proves it.

## Task 2: JSON Persistence For Non-Secret Config

- [x] Add default config to each project during state normalization.
- [x] Persist non-secret config in `app-state.json` and `project.json`.
- [x] Add `saveProjectConfig(projectId, config)` to `WorkspaceStore`.
- [x] Reject attempts to save raw secret-looking fields.
- [x] Preserve `readOnly: true` for ADT config.

Acceptance:

- Config survives app restart.
- `app-state.json` contains no password/API key/token fields.
- ADT write mode cannot be enabled.

## Task 3: Safe IPC

- [x] Add `workbench:save-project-config`.
- [x] Return user-readable validation errors.
- [x] Do not expose raw `ipcRenderer`.
- [x] Do not add validation/test external-call IPC yet.

Acceptance:

- Renderer can save non-secret config.
- Renderer cannot trigger ADT, Feishu, model API, or Codex commands.

## Task 4: Config Center UI

- [x] Add sidebar navigation to open Config Center.
- [x] Render categories: 项目概览、ADT连接、飞书CLI、API与模型、Codex能力、本地存储.
- [x] Render project-level ADT non-secret fields: alias, URL, Client, username, language, SSL mode, read-only mode.
- [x] Render Feishu profile and status.
- [x] Render API provider base URL and provider type.
- [x] Render Codex capability status.
- [x] Render local workspace/project/case paths.
- [x] Save non-secret config through IPC.
- [x] Mark real validation actions as disabled/pending.

Acceptance:

- UI never shows "已验证" for ADT/API/Feishu/Codex in Phase 2.
- UI clearly says secrets are not stored yet and must use secure storage later.
- Config Center is a work surface, not a card-heavy dashboard.

## Task 5: Verification And Adversarial Review

Run:

```powershell
npm run check
npm run build
powershell -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
Run a business-label scan for old real-looking customer, system, client, user, and custom object names before committing.
```

Runtime checks:

- [x] Open Config Center from the sidebar.
- [x] Save non-secret ADT/API/Feishu config.
- [x] Confirm config persists to ignored `local-data/workbench/app-state.json`.
- [x] Confirm no raw password/API key/token field exists in tracked code or runtime JSON.
- [x] Confirm "测试连接/读取T000/获取模型/验证飞书/测试Codex" are disabled or marked pending.
- [x] Confirm ADT remains read-only.

Security checks:

- [x] No raw secret fields are persisted.
- [x] No external connector command is callable.
- [x] No delete operation exists.
- [x] No real SAP/API/Feishu validation is claimed.
