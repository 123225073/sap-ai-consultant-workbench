# Phase 2B Secret Store Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe local secret-store foundation so SAP passwords and API keys can be stored as encrypted local secrets while project config only keeps opaque `secretRef` values.

**Architecture:** Keep raw secret handling inside Electron main only. Use Electron `safeStorage` to encrypt secret values and store encrypted blobs under ignored `local-data/workbench/secure-store`; `WorkspaceStore` only persists opaque references in `app-state.json` and `project.json`. Renderer sends a secret value through a narrow IPC method and never receives it back.

**Tech Stack:** Electron `safeStorage`, Electron IPC, React, TypeScript, local JSON metadata under ignored `local-data/workbench`, Lucide React.

---

## File Structure

Create:

```text
apps/desktop/src/main/secureSecretStore.ts
docs/architecture/reviews/2026-07-02-phase-2b-secret-store-review.md
```

Modify:

```text
apps/desktop/src/shared/workbenchTypes.ts
apps/desktop/src/main/workspaceStore.ts
apps/desktop/src/main/main.ts
apps/desktop/src/preload/preload.ts
apps/desktop/src/renderer/vite-env.d.ts
apps/desktop/src/renderer/App.tsx
apps/desktop/src/renderer/ConfigCenter.tsx
apps/desktop/src/renderer/styles.css
scripts/security-preflight.ps1
```

## Task 1: Secret Handle Contract

- [x] Extend `SecretHandle.state` with `set-in-secure-store`.
- [x] Add `updatedAt: string | null` to `SecretHandle`.
- [x] Add `SecretKind = "adt-password" | "api-key" | "feishu-token" | "codex-token"`.
- [x] Add `ProjectSecretTarget` with `kind` and optional `providerId`.
- [x] Add `ProjectSecretInput` with `target` and `value`.
- [x] Keep all config objects free of raw secret fields.

Acceptance:

- `ProjectConfig` still has no raw password/API key/token value field.
- Secret refs are represented only by `secretRef`.
- Status values still do not imply real external validation.

## Task 2: Main-Only Secure Secret Store

- [x] Create `SecureSecretStore`.
- [x] Store encrypted blobs only under `local-data/workbench/secure-store`.
- [x] Generate refs like `secure-store:sec_<random>`.
- [x] Encrypt values with Electron `safeStorage`.
- [x] Reject empty, oversized, or malformed inputs.
- [x] Add a read method for future connectors, but do not expose it through IPC.

Acceptance:

- Raw values are never written to `app-state.json`, `project.json`, Markdown, logs, or UI state.
- `secretRef` does not include SAP URL, username, key suffix, or token fragments.
- No `get-secret` IPC exists.

## Task 3: Project Config Attachment

- [x] Add `WorkspaceStore.attachProjectSecret(projectId, target, handle)`.
- [x] Update ADT credential handle for `adt-password`.
- [x] Update matching API provider credential for `api-key`.
- [x] Keep Feishu and Codex credential attachment typed for future use, but UI does not validate those services yet.
- [x] Preserve existing valid credential handles when saving non-secret config.
- [x] Reject renderer-forged new secret refs through normal config save.

Acceptance:

- Saving a non-secret config after saving a secret does not clear the secret ref.
- A forged `secretRef` in `saveProjectConfig` does not replace the stored handle.
- All external validation statuses remain `pending-verification`.

## Task 4: Safe IPC

- [x] Add only `workbench:save-project-secret`.
- [x] Return updated `WorkbenchState`.
- [x] Do not expose raw `ipcRenderer`.
- [x] Do not expose `getSecret`, `readSecret`, generic file access, shell, exec, or delete IPC.
- [x] Return Chinese, user-readable errors.

Acceptance:

- Renderer can save ADT/API secret values.
- Renderer cannot read secrets back.
- Renderer cannot trigger SAP, Feishu, API, or Codex validation.

## Task 5: Config Center UI

- [x] Add local password state for ADT credential input.
- [x] Add local password state for API key input.
- [x] Clear input after save.
- [x] Show “已安全保存，未验证” when `SecretHandle.state` is `set-in-secure-store`.
- [x] Keep “测试连接 / 读取 T000 / 获取模型 / 测试对话 / 验证飞书 / 测试 Codex” disabled.
- [x] Update side safety notes from “不接收密钥” to “密钥只进系统安全加密存储”.

Acceptance:

- UI never displays the saved secret value.
- UI does not say ADT/API/Feishu/Codex is verified after saving a secret.
- Users can distinguish “草稿已保存”, “密钥已安全保存”, and “真实验证未执行”.

## Task 6: Verification And Adversarial Review

Run:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
```

Runtime checks:

- [x] Save an ADT password through the main-process secret store.
- [x] Save an API key through the main-process secret store.
- [x] Confirm `app-state.json` and `project.json` only contain opaque refs.
- [x] Confirm encrypted blobs exist only under ignored `local-data/workbench/secure-store`.
- [x] Confirm raw fake secret values do not appear in tracked files or runtime JSON.
- [x] Confirm no IPC can read a secret back.
- [x] Confirm validation statuses remain `pending-verification`.

Security checks:

- [x] Forged `secretRef` in `saveProjectConfig` is ignored.
- [x] Empty secret values are rejected.
- [x] Oversized secret values are rejected.
- [x] `secretRef` path traversal is rejected.
- [x] No delete operation is added.
