# Phase 9 Case File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user click a current-case file and preview safe text content inside the app without creating a generic file reader.

**Architecture:** Add one narrow Electron IPC that reads only files inside the active case folder. `WorkspaceStore` owns path validation, file type allowlisting, size limits, symlink rejection, and redaction; `preload.ts` exposes only this fixed preview call; the renderer shows a compact read-only preview in the existing right-side file panel.

**Tech Stack:** Electron main process, React + TypeScript renderer, local case filesystem, existing PowerShell security preflight.

---

## 1. First-Principles Decision

Phase 8 already generates useful local case files, but the user still cannot inspect the contents in-app. The highest-value next step is a safe read-only preview because it closes the loop from "file generated" to "file usable" while preserving the local-first and SAP-read-only boundaries.

This phase is not a general file opener. It must not open arbitrary paths, shell-open files, read the old SAP workspace, publish to Feishu, call a model, write SAP, or auto-publish knowledge.

## 2. File Structure

- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
  - Add preview request/result types.
- Modify: `apps/desktop/src/main/workspaceStore.ts`
  - Add `previewCurrentCaseFile(input)` and private guards.
- Modify: `apps/desktop/src/main/main.ts`
  - Register `workbench:preview-current-case-file`.
- Modify: `apps/desktop/src/preload/preload.ts`
  - Expose `previewCurrentCaseFile(input)`.
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
  - Add bridge typing.
- Modify: `apps/desktop/src/renderer/App.tsx`
  - Make file rows and chips request safe preview.
  - Add a read-only preview area inside the right-side file panel.
- Modify: `apps/desktop/src/renderer/styles.css`
  - Style selected file rows and compact preview.
- Modify: `scripts/security-preflight.ps1`
  - Add IPC whitelist entry and preview safety marker scans.
- Create: `docs/architecture/reviews/2026-07-02-phase-9-case-file-preview-review.md`
  - Record product, security, UX, multi-agent findings, verification evidence, and residual risk.

## 3. Security Contract

The implementation must enforce all of these rules:

- IPC name is exactly `workbench:preview-current-case-file`.
- Input is exactly `{ relativePath: string }`.
- Only active current-case files are eligible.
- Reject absolute paths, drive paths, URL-like input, backslash path tricks, `..`, empty path segments, and hidden control characters.
- Resolve from `caseRoot()` and verify with `lstat` plus `realpath`.
- Reject symlinks, junctions, shortcuts, and anything whose real path leaves the active case folder.
- Allow only `.md`, `.txt`, `.csv`, and `.mmd`.
- Reject `.json` in Phase 9 to avoid leaking `messages.json`, `metadata.json`, `project.json`, or app state.
- Reject dangerous extensions such as `.exe`, `.ps1`, `.bat`, `.cmd`, `.dll`, `.pfx`, `.pem`, `.key`, `.db`, `.sqlite`.
- Reject files larger than `256 KB`.
- Return at most `64 KB` of text.
- Redact secret-like content before returning it to the renderer.
- Return plain text only; do not render Markdown or execute HTML.

## 4. Task 1: Add Shared Preview Types

**Files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`

- [ ] **Step 1: Add preview interfaces near `CaseFileNode`**

```ts
export interface CaseFilePreviewInput {
  relativePath: string;
}

export interface CaseFilePreview {
  relativePath: string;
  displayName: string;
  fileType: string;
  sizeBytes: number;
  truncated: boolean;
  content: string;
  redactions: number;
}
```

- [ ] **Step 2: Run type check**

Run:

```powershell
npm run check
```

Expected: TypeScript reports no new type errors.

## 5. Task 2: Implement Safe Preview In Main Store

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`

- [ ] **Step 1: Add constants and redaction helpers**

Add near existing file helpers:

```ts
const MAX_PREVIEW_FILE_BYTES = 256 * 1024;
const MAX_PREVIEW_BYTES = 64 * 1024;
const SAFE_PREVIEW_EXTENSIONS = new Set([".md", ".txt", ".csv", ".mmd"]);
const BLOCKED_PREVIEW_FILENAMES = new Set(["messages.json", "metadata.json", "project.json", "app-state.json"]);

function redactPreviewContent(input: string): { content: string; redactions: number } {
  const patterns = [
    /bearer\s+[a-z0-9._-]{12,}/gi,
    /authorization\s*[:=]\s*[^\s]+/gi,
    /cookie\s*[:=]\s*[^\n\r]+/gi,
    /SAP_SESSIONID\s*[:=]\s*[^\s]+/gi,
    /MYSAPSSO2\s*[:=]\s*[^\s]+/gi,
    /secure-store:sec_[a-f0-9]{32}/gi,
    /sk-[a-z0-9]{20,}/gi,
    /api[_-]?key\s*[:=]\s*[^\s]+/gi,
    /tenant[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
    /user[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
    /device_code\s*[:=]\s*[^\s]+/gi,
    /verification_uri\s*[:=]\s*[^\s]+/gi
  ];
  let redactions = 0;
  let content = input;
  for (const pattern of patterns) {
    content = content.replace(pattern, () => {
      redactions += 1;
      return "[已脱敏]";
    });
  }
  return { content, redactions };
}
```

- [ ] **Step 2: Add path and file-type guards**

Add private methods in `WorkspaceStore`:

```ts
private assertPreviewRelativePath(input: unknown): string {
  if (!input || typeof input !== "object") throw new Error("文件预览请求无效。");
  const relativePath = (input as { relativePath?: unknown }).relativePath;
  if (typeof relativePath !== "string") throw new Error("文件预览请求缺少相对路径。");
  const normalized = relativePath.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || /^[a-z]+:\/\//i.test(normalized)) throw new Error("只能预览当前案件里的相对文件路径。");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("文件预览路径无效。");
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error("文件预览路径包含不安全字符。");
  return normalized;
}

private assertSafePreviewFileType(relativePath: string): void {
  const basename = path.basename(relativePath).toLowerCase();
  const extension = path.extname(relativePath).toLowerCase();
  if (BLOCKED_PREVIEW_FILENAMES.has(basename)) throw new Error("该文件属于内部状态文件，不能在界面预览。");
  if (!SAFE_PREVIEW_EXTENSIONS.has(extension)) throw new Error("当前只支持预览 Markdown、文本、CSV 和 Mermaid 文件。");
}
```

- [ ] **Step 3: Add public preview method**

Add a public method:

```ts
async previewCurrentCaseFile(input: unknown): Promise<CaseFilePreview> {
  const state = await this.loadOrCreateState();
  await this.ensureCaseFiles(state);
  const relativePath = this.assertPreviewRelativePath(input);
  this.assertSafePreviewFileType(relativePath);

  const caseRoot = this.caseRoot(state);
  const target = this.assertInsideWorkspace(path.join(caseRoot, relativePath));
  const resolvedCaseRoot = await fs.realpath(caseRoot);
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("只能预览当前案件里的普通文本文件。");
  if (stat.size > MAX_PREVIEW_FILE_BYTES) throw new Error("文件超过预览大小限制，请在本地文件夹中打开。");
  const realTarget = await fs.realpath(target);
  if (realTarget !== resolvedCaseRoot && !realTarget.startsWith(`${resolvedCaseRoot}${path.sep}`)) throw new Error("文件真实路径超出当前案件目录，已阻止预览。");

  const buffer = await fs.readFile(realTarget);
  const truncated = buffer.length > MAX_PREVIEW_BYTES;
  const sliced = buffer.subarray(0, MAX_PREVIEW_BYTES).toString("utf8");
  const redacted = redactPreviewContent(sliced);
  return {
    relativePath,
    displayName: path.basename(relativePath),
    fileType: path.extname(relativePath).replace(".", "").toLowerCase() || "text",
    sizeBytes: stat.size,
    truncated,
    content: redacted.content,
    redactions: redacted.redactions
  };
}
```

- [ ] **Step 4: Run type check**

Run:

```powershell
npm run check
```

Expected: TypeScript passes.

## 6. Task 3: Wire Narrow IPC And Renderer Preview

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Register IPC**

Add to `registerWorkbenchHandlers()`:

```ts
ipcMain.handle("workbench:preview-current-case-file", (_event, input: unknown) => response(store.previewCurrentCaseFile(input)));
```

- [ ] **Step 2: Expose bridge method**

In `preload.ts`, import the new types and expose:

```ts
previewCurrentCaseFile: (input: CaseFilePreviewInput): Promise<WorkbenchResponse<CaseFilePreview>> => ipcRenderer.invoke("workbench:preview-current-case-file", input),
```

Update `vite-env.d.ts` with the same method signature.

- [ ] **Step 3: Add renderer state and click handling**

Add state:

```ts
const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
const [filePreview, setFilePreview] = useState<CaseFilePreview | null>(null);
const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
```

Add function:

```ts
async function previewCaseFile(node: CaseFileNode) {
  if (node.kind !== "file") return;
  if (!bridge) {
    setNotice("请在桌面应用中预览当前案件文件。");
    return;
  }
  setSelectedPreviewPath(node.relativePath);
  setFilePreview(null);
  setFilePreviewError(null);
  const response = await bridge.previewCurrentCaseFile({ relativePath: node.relativePath });
  if (response.ok) {
    setFilePreview(response.data);
    setNotice("已读取当前案件文件的本地只读预览。");
  } else {
    setFilePreviewError(response.error);
    setNotice(response.error);
  }
}
```

- [ ] **Step 4: Make file rows and chips previewable**

Pass `onPreview` and `selectedPath` into `FileRows`. File rows use a button only for files. Directory rows remain non-action rows.

File chips should call `previewCaseFile(node)` instead of only jumping to an anchor.

- [ ] **Step 5: Add right-panel preview area**

Below the file tree, show:

```tsx
<section className="file-preview">
  <div className="file-preview-heading">...</div>
  <pre>{filePreview.content}</pre>
</section>
```

The text must say it is a "本地只读预览". Show `truncated` and `redactions` notes when relevant. Do not render Markdown as HTML.

- [ ] **Step 6: Style selected rows and preview**

Add compact CSS for `.file-row-button`, `.file-row.selected`, `.file-preview`, `.file-preview pre`, and error/empty states. Keep the Codex-like right panel; do not add dashboard cards.

- [ ] **Step 7: Run type check**

Run:

```powershell
npm run check
```

Expected: TypeScript passes.

## 7. Task 4: Extend Security Preflight

**Files:**
- Modify: `scripts/security-preflight.ps1`

- [ ] **Step 1: Add IPC whitelist entry**

Add:

```powershell
"workbench:preview-current-case-file",
```

- [ ] **Step 2: Add preview safety marker scan**

Add a section that requires these markers:

```text
previewCurrentCaseFile
assertPreviewRelativePath
assertSafePreviewFileType
redactPreviewContent
MAX_PREVIEW_BYTES
MAX_PREVIEW_FILE_BYTES
SAFE_PREVIEW_EXTENSIONS
BLOCKED_PREVIEW_FILENAMES
realpath
lstat
```

- [ ] **Step 3: Add generic preview danger scans**

Reject dangerous IPC-like names:

```text
preview-any-file
open-file
open-path
read-current-file
file-preview
readFileArbitrary
```

Reject desktop openers in source:

```text
shell.openPath
shell.openExternal
dialog.showOpenDialog
```

Allow `fs.readFile` only in approved main-process files.

- [ ] **Step 4: Run preflight**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
```

Expected: `Security preflight passed.`

## 8. Task 5: Add Phase 9 Adversarial Review

**Files:**
- Create: `docs/architecture/reviews/2026-07-02-phase-9-case-file-preview-review.md`

- [ ] **Step 1: Record multi-agent findings**

The review must include:

```text
功能范围
用户价值审计
MVP 边界审计
安全审计
体验审计
多 Agent 发现和处理
验证命令
运行时攻击探针
剩余风险
结论
```

- [ ] **Step 2: Record required probes**

Probe checklist:

```text
allowed .md preview succeeds
allowed .csv preview succeeds
allowed .mmd preview succeeds
../app-state.json rejected
absolute drive path rejected
URL path rejected
metadata.json rejected
project.json rejected
disallowed extension rejected
oversized file rejected
secret-like content redacted
symlink or junction escape rejected when platform supports it
no SAP write, model call, Feishu publish, knowledge auto-publish, generic IPC, shell open introduced
```

## 9. Task 6: Final Verification, Commit, Push

- [ ] **Step 1: Run runtime probe**

Run a local Node probe that creates a temporary `WorkspaceStore`, appends a message to generate outputs, and verifies preview success/rejection/redaction.

Expected key lines:

```text
previewAllowedMd=ok
previewAllowedCsv=ok
previewAllowedMmd=ok
rejectPathTraversal=ok
rejectAbsolutePath=ok
rejectUrlPath=ok
rejectInternalJson=ok
rejectDisallowedExtension=ok
rejectOversized=ok
redaction=ok
```

- [ ] **Step 2: Run required checks**

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

Expected: all exit code 0.

- [ ] **Step 3: Commit**

```powershell
git add .
git commit -m "feat: add safe case file preview"
```

- [ ] **Step 4: Clean-tree preflight**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
```

Expected: exit code 0.

- [ ] **Step 5: Push**

```powershell
git -c http.proxy= -c https.proxy= push -u origin phase-9-case-file-preview
```

Expected: branch pushed to GitHub.

## 10. Exit Criteria

- Current-case safe text preview works for `.md`, `.csv`, `.mmd`, and `.txt`.
- Preview is only available for active case files.
- Internal JSON, disallowed extensions, path traversal, absolute paths, URLs, oversized files, and symlink/junction escapes are rejected.
- Secret-like text is redacted before reaching the renderer.
- UI remains a Codex-style right file panel, not a dashboard or generic file browser.
- `npm run check`, `npm run build`, security preflight, runtime probe, and `git diff --check` pass.
- Phase 9 adversarial review exists and records P0/P1/P2 findings and fixes.
