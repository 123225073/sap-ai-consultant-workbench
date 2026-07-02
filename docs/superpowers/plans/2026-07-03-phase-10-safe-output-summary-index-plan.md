# Phase 10 Safe Output Summary Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let global search find safe short summaries from all local project/case `outputs/` text deliverables without indexing full file bodies or sensitive technical material.

**Architecture:** Reuse the existing `workbench:search` IPC and SQLite FTS mirror. The Electron main process reads only direct `outputs/<file>` deliverables for local cases through Phase 9-style path guards, skips unsafe content, stores only short sanitized summaries in the search index, and labels results as safe output summaries. Only results from the active case can be opened in the right-side preview.

**Tech Stack:** Electron main process, React + TypeScript renderer, SQLite FTS5 search mirror, local case filesystem, existing PowerShell security preflight.

---

## 1. First-Principles Decision

Phase 9 made current-case file content safely previewable after a click. The next safest step is to make generated deliverables findable by their safe summary text, because the MVP promise is historical retrieval: the user must be able to find old case outputs without opening each file manually.

This phase is not generic full-text search. It must not index technical evidence, snapshots, SAP source, internal JSON, arbitrary paths, model prompts, Feishu artifacts, or the old SAP workspace. It must also not call SAP, call a model, publish to Feishu, or create a new IPC.

## 2. File Structure

- Modify: `apps/desktop/src/main/workspaceStore.ts`
  - Add safe output summary constants, sensitive-content guards, and internal indexing helpers.
- Modify: `apps/desktop/src/main/searchService.ts`
  - Add safe output summary records to search documents and fallback search.
- Modify: `apps/desktop/src/main/databaseService.ts`
  - Tighten search-index unsafe content scans for authorization/cookie/session variants.
- Modify: `apps/desktop/src/preload/preload.ts`
  - Update phase label only.
- Modify: `apps/desktop/src/main/caseWorkflowService.ts`
  - Update output phase label only.
- Modify: `apps/desktop/src/renderer/App.tsx`
  - Label search results and notice text as safe output summary search.
- Modify: `scripts/security-preflight.ps1`
  - Add safe output summary index marker scans.
- Create: `docs/architecture/reviews/2026-07-03-phase-10-safe-output-summary-index-review.md`
  - Record product, security, multi-agent findings, verification evidence, and residual risk.

## 3. Security Contract

- Do not add any IPC channel.
- Reuse only `workbench:search`.
- Read only direct files under each local case `outputs/` directory.
- Allow only `.md`, `.txt`, `.csv`, and `.mmd`.
- Reject or skip `snapshots/`, `technical/`, `evidence/`, `metadata.json`, `messages.json`, `project.json`, `app-state.json`, and every `.json`.
- Use `lstat` and `realpath`; reject symlink, junction-like escape, non-file entries, and anything outside the active case root.
- Reject files larger than `128 KB`.
- Read at most `32 KB` and index only a short normalized summary.
- If content contains secret-like text, SAP session markers, API keys, ABAP source shape, SQL query shape, private keys, or table-like sensitive rows, skip indexing the file entirely.
- Search result copy must say `安全输出摘要`, not full-text search.
- Do not call SAP, model APIs, Feishu CLI, shell openers, generic file readers, or SQL proxies.

## 4. Task 1: Add Safe Output Summary Records

**Files:**
- Modify: `apps/desktop/src/main/searchService.ts`

- [x] **Step 1: Add exported record type**

Add:

```ts
export interface SafeOutputSummaryRecord {
  projectId: string;
  caseId: string;
  projectName: string;
  caseTitle: string;
  relativePath: string;
  displayName: string;
  fileType: string;
  sizeBytes: number;
  snippet: string;
  content: string;
  updatedAt: string;
}
```

- [x] **Step 2: Update `buildSearchDocuments` signature**

Change it to accept `safeOutputSummaries: SafeOutputSummaryRecord[] = []`.

- [x] **Step 3: Add one extra search document per safe output summary**

Use id `file-summary-${projectId}-${caseId}-${relativePath}`, type `file`, location `${projectName} · ${caseTitle} · ${relativePath} · 安全输出摘要`, snippet `安全输出摘要：${snippet}`, and content as the short summary only.

- [x] **Step 4: Update fallback search**

Change `fallbackSearch(projects, files, safeOutputSummaries, query)` so summary text can match when the filename does not.

## 5. Task 2: Build Safe Summaries In Main Process

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`

- [x] **Step 1: Add constants and helper markers**

Add markers required by security preflight:

```ts
const SAFE_INDEX_DIRECTORIES = new Set(["outputs"]);
const SAFE_INDEX_EXTENSIONS = new Set([".md", ".txt", ".csv", ".mmd"]);
const MAX_INDEX_FILE_BYTES = 128 * 1024;
const MAX_INDEX_READ_BYTES = 32 * 1024;
const MAX_INDEX_SUMMARY_CHARS = 600;
```

- [x] **Step 2: Add `redactIndexableText`**

The function must redact authorization, cookie, SAP session, secure-store refs, API keys, Feishu device-code fields, and return a redaction count.

- [x] **Step 3: Add unsafe-content detection**

Reject content with private keys, secret-like fields, ABAP source shape, SQL `SELECT ... FROM`, or repeated table-like rows.

- [x] **Step 4: Add safe output summary readers**

For each local project/case file node, call an internal reader only when:

```text
relative path is a direct outputs/<file> path
extension is allowlisted
file is present in that case's file tree
file is a regular file
real path stays under case root
size is within cap
content passes unsafe-content guards
```

- [x] **Step 5: Wire indexing and search**

In `refreshSearchIndex` and `search`, pass safe summaries to `buildSearchDocuments` / `searchWorkbench`.

## 6. Task 3: Update Search UI Copy And Phase Labels

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/main/caseWorkflowService.ts`

- [x] **Step 1: Phase labels**

Change visible phase strings from Phase 9 to Phase 10 where they describe current app behavior.

- [x] **Step 2: Search result labels**

When a result id starts with `file-summary-`, show label `安全摘要`; otherwise keep the existing labels.

- [x] **Step 3: Search result heading**

Mention that search includes local-case safe output summaries, not full unrestricted file search.

## 7. Task 4: Extend Security Preflight

**Files:**
- Modify: `scripts/security-preflight.ps1`

- [x] **Step 1: Add required marker scan**

Require these markers in `workspaceStore.ts`:

```text
SAFE_INDEX_DIRECTORIES
SAFE_INDEX_EXTENSIONS
MAX_INDEX_FILE_BYTES
redactIndexableText
readSafeOutputSummaries
```

- [x] **Step 2: Enforce no new IPC**

Existing IPC whitelist must stay unchanged; `workbench:search` is the only search entry.

- [x] **Step 3: Add danger name scans**

Reject generic names like `query-sql`, `execute-sql`, `raw-sql`, `read-output-file`, `full-text-file-search`, and `index-any-file`.

## 8. Task 5: Add Adversarial Review

**Files:**
- Create: `docs/architecture/reviews/2026-07-03-phase-10-safe-output-summary-index-review.md`

- [x] **Step 1: Record product and security findings**

Include:

```text
功能范围
第一性原理
MVP 边界审计
安全审计
体验审计
多 Agent 发现和处理
运行探针
验证命令
剩余风险
结论
```

- [x] **Step 2: Record runtime probe checklist**

Probe:

```text
active outputs markdown body-only keyword can be found
historical outputs markdown body-only keyword can be found
technical/evidence/snapshots keyword cannot be found
json cannot be indexed
secret-like output cannot be indexed
ABAP/SQL-like output cannot be indexed
oversized output cannot be indexed
symlink escape is rejected or skipped when OS disallows creation
no new IPC was added
```

## 9. Task 6: Verification, Commit, Push

- [x] **Step 1: Run runtime probe**

Expected key lines:

```text
summaryBodySearch=ok
historicalSummaryBodySearch=ok
technicalNotIndexed=ok
evidenceNotIndexed=ok
snapshotNotIndexed=ok
jsonNotIndexed=ok
secretOutputSkipped=ok
abapOutputSkipped=ok
sqlOutputSkipped=ok
oversizedOutputSkipped=ok
symlinkEscape=ok|skipped
```

- [x] **Step 2: Run required checks**

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

- [x] **Step 3: Commit and clean preflight**

```powershell
git add .
git commit -m "feat: add safe output summary search"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
```

- [x] **Step 4: Push**

```powershell
git -c http.proxy= -c https.proxy= push -u origin codex/phase-10-safe-output-summary-index
```

## 10. Exit Criteria

- Search can find safe summary text inside local-case `outputs/*.md`, `.txt`, `.csv`, and `.mmd`.
- Current-case safe output summary hits can open the existing right-side read-only preview; historical hits only show source context.
- Search does not index internal JSON, technical, evidence, snapshot, or arbitrary files.
- Search stores only short safe summaries, not full file bodies.
- Sensitive, ABAP-like, SQL-like, oversized, and symlink/junction escape files are skipped.
- No new IPC channel is introduced.
- UI clearly labels these hits as `安全摘要`.
- Phase 10 adversarial review exists and records multi-agent findings.
- `npm run check`, `npm run build`, security preflight, runtime probe, and `git diff --check` pass.
