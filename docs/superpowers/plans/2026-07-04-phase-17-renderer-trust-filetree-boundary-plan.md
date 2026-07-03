# Phase 17 Renderer Trust And File Tree Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two important local security gaps: every workbench IPC must only accept calls from the trusted renderer, and the current-case file tree must not follow symlinks or junctions outside the active case.

**Architecture:** Add one main-process trust module and route every `ipcMain.handle` through a common `trustedResponse` wrapper. Harden `WorkspaceStore.readDirectory` to use `lstat` plus realpath containment before reading metadata or descending into directories. Prove the boundary with a Phase 17 probe, update security preflight, and document the adversarial review.

**Tech Stack:** Electron, TypeScript, Node filesystem APIs, esbuild probe scripts, PowerShell security preflight.

---

## Scope

Allowed in Phase 17:

- allow packaged renderer `file://` pages created from `dist/renderer`;
- allow development renderer only on loopback hosts `127.0.0.1`, `[::1]`, or `localhost` when `ELECTRON_RENDERER_URL` points there;
- reject IPC calls from `https://`, external hosts, `file://` pages outside the app renderer root, and malformed sender URLs;
- prevent navigation and new-window escapes from loading arbitrary web content in the workbench window;
- ignore or block symlink/junction entries while reading the current case file tree;
- reject a project/cases/case directory that has itself been replaced by a symlink or junction;
- keep existing safe file preview rejection behavior.

Blocked in Phase 17:

- no Codex task execution;
- no SAP write, SQL, transport, activation, Data Preview, or generic SAP browser;
- no Feishu auth, sync, create, update, publish, or device-code flow;
- no arbitrary file picker, arbitrary path read, generic command runner, URL proxy, or delete operation;
- no changes to knowledge publish semantics beyond preserving existing behavior.

## File Structure

- Create `apps/desktop/src/main/trustedRenderer.ts`: trusted sender URL parser and IPC assertion.
- Modify `apps/desktop/src/main/main.ts`: wrap all IPC handlers with the trust assertion and block unexpected navigation/new-window attempts.
- Modify `apps/desktop/src/main/workspaceStore.ts`: harden case file tree reads with `lstat`, symlink detection, and realpath containment.
- Modify `scripts/security-preflight.ps1`: add trusted renderer markers, all-IPC wrapper check, navigation guard check, and file-tree symlink markers.
- Create `scripts/phase17-renderer-trust-filetree-probe.mjs`: prove trusted URL decisions and file tree symlink handling.
- Create `docs/architecture/reviews/2026-07-04-phase-17-renderer-trust-filetree-boundary-review.md`: adversarial review and verification evidence.

## Task 1: Trusted Renderer IPC Boundary

**Files:**
- Create `apps/desktop/src/main/trustedRenderer.ts`
- Modify `apps/desktop/src/main/main.ts`

- [ ] **Step 1: Add a pure trust decision helper**

Create `trustedRenderer.ts` with:

```ts
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function isTrustedRendererUrl(rawUrl: string, appRoot: string, developmentRendererUrl = process.env.ELECTRON_RENDERER_URL): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "file:") {
      const rendererRoot = pathToFileURL(path.join(appRoot, "dist", "renderer") + path.sep).href;
      return parsed.href.startsWith(rendererRoot);
    }
    if (parsed.protocol !== "http:") return false;
    const developmentUrl = developmentRendererUrl ? new URL(developmentRendererUrl) : null;
    const allowedDevHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
    return Boolean(
      developmentUrl &&
      developmentUrl.protocol === "http:" &&
      allowedDevHosts.has(developmentUrl.hostname) &&
      parsed.origin === developmentUrl.origin
    );
  } catch {
    return false;
  }
}

export function assertTrustedRendererEvent(event: IpcMainInvokeEvent, appRoot: string): void {
  if (!isTrustedRendererUrl(event.senderFrame.url, appRoot)) {
    throw new Error("Blocked untrusted renderer IPC request.");
  }
}
```

- [ ] **Step 2: Route every IPC through the assertion**

In `main.ts`, add:

```ts
function trustedResponse<T>(event: IpcMainInvokeEvent, appRoot: string, task: () => Promise<T>): Promise<WorkbenchResponse<T>> {
  try {
    assertTrustedRendererEvent(event, appRoot);
  } catch (error) {
    return response(Promise.reject(error));
  }
  return response(task());
}
```

Change `registerWorkbenchHandlers` to accept `appRoot: string`, and change every `ipcMain.handle` from:

```ts
ipcMain.handle("workbench:get-state", () => response(store.getState()));
```

to:

```ts
ipcMain.handle("workbench:get-state", (event) => trustedResponse(event, appRoot, () => store.getState()));
```

Apply the same wrapper to every existing `workbench:*` channel.

- [ ] **Step 3: Prevent renderer navigation escape**

In `createMainWindow`, add:

```ts
window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
window.webContents.on("will-navigate", (event, targetUrl) => {
  if (!isTrustedRendererUrl(targetUrl, appRoot, rendererUrl)) {
    event.preventDefault();
  }
});
```

Keep development loading limited to the configured loopback URL and packaged loading limited to `dist/renderer/index.html`.

## Task 2: Case File Tree Symlink Boundary

**Files:**
- Modify `apps/desktop/src/main/workspaceStore.ts`

- [ ] **Step 1: Add realpath containment helper**

Add a private helper near the existing case-root/path guard helpers:

```ts
private async assertRealPathInside(root: string, target: string, message: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(message);
  }
  return realTarget;
}
```

- [ ] **Step 2: Harden `readDirectory`**

Change `readDirectory` to use `fs.lstat(absolutePath)` instead of `fs.stat(absolutePath)` before deciding kind and size.

For each entry:

```ts
const stats = await fs.lstat(absolutePath);
if (stats.isSymbolicLink()) continue;
const kind = entry.isDirectory() ? "directory" : "file";
if (!entry.isDirectory() && !stats.isFile()) continue;
await this.assertRealPathInside(this.caseRootFor(activeProject, activeCase), absolutePath, "案件文件树包含越界文件，已阻止。");
```

Because `readDirectory` currently only receives `directory`, `relativeBase`, and `caseId`, extend the signature to include `caseRoot`:

```ts
private async readDirectory(caseRoot: string, directory: string, relativeBase: string, caseId: string): Promise<CaseFileNode[]>
```

Then call it from `readCaseTree` and `readCaseTreeForCase` with the active `caseRoot`.

- [ ] **Step 3: Preserve safe preview behavior**

Do not relax `previewCurrentCaseFile`, `assertPreviewRelativePath`, `assertSafePreviewFileType`, or the existing `lstat + realpath` preview checks.

## Task 3: Probe, Preflight, And Adversarial Review

**Files:**
- Create `scripts/phase17-renderer-trust-filetree-probe.mjs`
- Modify `scripts/security-preflight.ps1`
- Create `docs/architecture/reviews/2026-07-04-phase-17-renderer-trust-filetree-boundary-review.md`

- [ ] **Step 1: Add Phase 17 probe**

The probe must build/import `WorkspaceStore` and `trustedRenderer.ts`, then verify:

- packaged `file://.../dist/renderer/index.html` is trusted;
- `file://` outside `dist/renderer` is rejected;
- loopback development URL matching `ELECTRON_RENDERER_URL` is trusted;
- external `https://example.com` and external `http://example.com` are rejected;
- `getCaseFiles()` ignores a symlink/junction inside the active case;
- `previewCurrentCaseFile()` rejects the symlink/junction path;
- `getCaseFiles()` rejects when the active case root itself is a symlink/junction;
- no outside symlink target file metadata appears in the returned file tree.

- [ ] **Step 2: Update security preflight**

Add required markers:

- `isTrustedRendererUrl`;
- `assertTrustedRendererEvent`;
- `trustedResponse`;
- `setWindowOpenHandler`;
- `will-navigate`;
- `assertRealPathInside`;
- `ensurePlainDirectory`;
- `safeCaseRootForAccess`;
- `fs.lstat(absolutePath)`;
- `stats.isSymbolicLink()`;
- `phase17-renderer-trust-filetree-probe`.

Add scans that fail when any `ipcMain.handle("workbench:` line does not include `trustedResponse`.

Keep the existing scans for dangerous IPC names, file dialogs, URL openers, command execution, SAP write-like actions, Feishu auth/publish actions, arbitrary path reads, and delete operations.

- [ ] **Step 3: Write adversarial review**

Document:

- why IPC caller trust is a prerequisite before adding more capabilities;
- why development mode is limited to loopback;
- why external navigation/new windows are blocked;
- why file tree reads must match preview symlink protection;
- residual risk that an already-compromised local process can still modify local files, but the workbench will not follow symlink/junction entries as trusted case files.

## Verification

Run these commands before commit:

```powershell
npm run check
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase12-sap-readonly-evidence-probe.mjs
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
node scripts\phase14-feishu-safe-handoff-probe.mjs
node scripts\phase15-real-project-case-lifecycle-probe.mjs
node scripts\phase16-document-ingestion-firewall-probe.mjs
node scripts\phase17-renderer-trust-filetree-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

## Commit

```powershell
git add apps/desktop/src scripts docs/superpowers/plans docs/architecture/reviews
git commit -m "fix: harden renderer trust and file tree boundaries"
```
