# Phase 16 Document Ingestion Firewall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow local document ingestion firewall that turns user-pasted local text into pending knowledge candidates without reading arbitrary files, syncing Feishu, or publishing knowledge automatically.

**Architecture:** The renderer submits only structured plain text fields through a single IPC channel. The main process validates exact keys, size, type, source labels, source names, SAP object labels, secret patterns, ABAP-source patterns, and path-like content before creating a document job and pending knowledge item inside the active project's knowledge store. Optional local artifacts are written only under the active case `knowledge_candidates/` directory through the existing generated-file path guard.

**Tech Stack:** Electron, React, TypeScript, local JSON state, SQLite FTS search, esbuild probe scripts, PowerShell security preflight.

---

## Scope

Allowed in Phase 16:

- paste or type local text-like document content into the Knowledge Center;
- classify source as `local-text`, `markdown-note`, or `qa-text`;
- create one `KnowledgeDocumentJob` with `needs-review`;
- create one `KnowledgeItem` with `pending`;
- preserve title, source name, optional SAP object labels, and generated source metadata;
- write a sanitized candidate Markdown file under the active case `knowledge_candidates/`;
- refresh local search.

Blocked in Phase 16:

- no `showOpenDialog`, drag-drop file access, arbitrary filesystem path, upload picker, or system opener;
- no Word/PDF/Excel binary parsing;
- no Feishu auth, sync, create, update, publish, or device-code flow;
- no SAP write, transport, SQL, or generic SAP browser;
- no model execution as part of import;
- no knowledge status `published` from the import path;
- no delete or history removal.

## File Structure

- Modify `apps/desktop/src/shared/workbenchTypes.ts`: add narrow document-import input/result types and source type labels.
- Modify `apps/desktop/src/main/knowledgeService.ts`: validate import input and build a document job plus pending knowledge item.
- Modify `apps/desktop/src/main/workspaceStore.ts`: add a serialized import method, persist knowledge, optionally write an active-case candidate file, and refresh search.
- Modify `apps/desktop/src/main/main.ts`: expose one narrow IPC handler.
- Modify `apps/desktop/src/preload/preload.ts`: expose one bridge method.
- Modify `apps/desktop/src/renderer/vite-env.d.ts`: type the bridge method.
- Modify `apps/desktop/src/renderer/KnowledgeCenter.tsx`: replace disabled upload/QA controls with a controlled local text import form and explicit safety copy.
- Modify `apps/desktop/src/renderer/styles.css`: add compact import form styling consistent with the existing app.
- Modify `scripts/security-preflight.ps1`: whitelist the new IPC and add import firewall checks.
- Create `scripts/phase16-document-ingestion-firewall-probe.mjs`: prove allowed import and blocked attacks.
- Create `docs/architecture/reviews/2026-07-04-phase-16-document-ingestion-firewall-review.md`: adversarial review evidence.

## Task 1: Shared Contract And Knowledge Firewall

**Files:**
- Modify `apps/desktop/src/shared/workbenchTypes.ts`
- Modify `apps/desktop/src/main/knowledgeService.ts`

- [ ] **Step 1: Add strict shared input and result types**

Add:

```ts
export type KnowledgeImportSourceKind = "local-text" | "markdown-note" | "qa-text";

export interface KnowledgeImportLocalTextInput {
  projectId: string;
  title: string;
  sourceKind: KnowledgeImportSourceKind;
  sourceName: string;
  body: string;
  sapObjects?: string[];
}

export interface KnowledgeImportLocalTextResult {
  state: WorkbenchState;
  documentJobId: string;
  knowledgeItemId: string;
  generatedFiles: string[];
}
```

- [ ] **Step 2: Add parser and guard constants**

Create in `knowledgeService.ts`:

```ts
const KNOWLEDGE_IMPORT_ALLOWED_KEYS = new Set(["projectId", "title", "sourceKind", "sourceName", "body", "sapObjects"]);
const KNOWLEDGE_IMPORT_ALLOWED_SOURCE_KINDS = new Set(["local-text", "markdown-note", "qa-text"]);
const MAX_KNOWLEDGE_IMPORT_BODY_LENGTH = 8000;
const MAX_KNOWLEDGE_IMPORT_TITLE_LENGTH = 120;
const MAX_KNOWLEDGE_IMPORT_SOURCE_NAME_LENGTH = 160;
```

Add exported `parseKnowledgeImportLocalTextInput(input: unknown): KnowledgeImportLocalTextInput` that rejects:

- non-object and arrays;
- extra keys;
- missing `projectId`, `title`, `sourceKind`, `sourceName`, or `body`;
- `projectId` outside `^[A-Za-z0-9_-]{1,80}$`;
- unsupported source kind;
- empty body or body over 8000 characters;
- source names containing `/`, `\`, drive paths, URL schemes, `.env`, `.sap-adt-cli`, `.sap-abap-cli`, `messages.json`, `metadata.json`, `app-state.json`, `project.json`, `secret`, `credential`, `token`, `cookie`, or `password`;
- content blocked by `assertNoSensitiveKnowledgeContent`.

- [ ] **Step 3: Build document job and pending item only**

Add exported `createImportedKnowledgeCandidate(projectId, input, sourceFilePath)` returning:

- `KnowledgeDocumentJob` with `source: input.sourceKind === "qa-text" ? "qa-import" : "local-text"`, `status: "needs-review"`, and detail saying it is waiting for human confirmation;
- `KnowledgeItem` with `type: input.sourceKind === "qa-text" ? "qa" : "doc"`, `sourceType: input.sourceKind === "qa-text" ? "qa-import" : "document-import"`, `status: "pending"`, `publishedAt: null`, `reviewer: null`, and source metadata pointing at the generated candidate file.

Do not call `publishKnowledgeItem` or set `status: "published"`.

## Task 2: Store, IPC, And UI

**Files:**
- Modify `apps/desktop/src/main/workspaceStore.ts`
- Modify `apps/desktop/src/main/main.ts`
- Modify `apps/desktop/src/preload/preload.ts`
- Modify `apps/desktop/src/renderer/vite-env.d.ts`
- Modify `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- Modify `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add serialized store method**

Add `async importKnowledgeLocalText(input: unknown): Promise<KnowledgeImportLocalTextResult>` to `WorkspaceStore`:

```ts
return this.runExclusive(async () => {
  const importInput = parseKnowledgeImportLocalTextInput(input);
  const state = await this.loadOrCreateState();
  const project = state.projects.find((item) => item.id === importInput.projectId);
  if (!project) throw new Error("未找到当前项目，无法导入知识候选。");
  const caseItem = project.cases.find((item) => item.id === state.activeCaseId && item.projectId === project.id) ?? project.cases[0];
  if (!caseItem) throw new Error("当前项目没有可写入候选文件的本地案件。");
  const relativePath = `knowledge_candidates/${safe import file name}.md`;
  const { job, item, artifact } = createImportedKnowledgeCandidate(project.id, importInput, relativePath);
  project.knowledge = append/import new job and item with max-size trimming;
  project.updatedAt = nowIso();
  await this.saveState(state);
  await this.writeProjectKnowledge(project);
  await this.writeProjectMetadata(project);
  await this.writeCaseGeneratedFiles(project, caseItem, [artifact]);
  await this.ensureCaseFiles(state);
  await this.refreshSearchIndex(state);
  return { state: await this.withFiles(state), documentJobId: job.id, knowledgeItemId: item.id, generatedFiles: [relativePath] };
});
```

The actual implementation must reuse existing path guards through `writeCaseGeneratedFiles`; no new raw file path parameter is allowed.

- [ ] **Step 2: Add one IPC and bridge method**

Register:

```ts
ipcMain.handle("workbench:knowledge-import-local-text", (_event, input: unknown) => response(store.importKnowledgeLocalText(input)));
```

Expose:

```ts
importKnowledgeLocalText: (input: KnowledgeImportLocalTextInput) => Promise<WorkbenchResponse<KnowledgeImportLocalTextResult>>;
```

Do not expose file path, open dialog, read file, Feishu, SAP, SQL, command, URL, or delete APIs.

- [ ] **Step 3: Add controlled Knowledge Center import form**

In `KnowledgeCenter.tsx`, add fields:

- title;
- source kind segmented/select control: local text, Markdown note, QA text;
- source name;
- optional SAP object labels;
- body textarea.

Submit through `window.workbench.importKnowledgeLocalText`.

User-facing copy must say:

- "仅粘贴已脱敏的本地文本";
- "不会读取文件路径";
- "不会连接飞书";
- "不会自动正式入库";
- "导入后仍需人工确认"。

Keep the existing disabled Feishu sync wording closed.

## Task 3: Probe, Security Preflight, And Review

**Files:**
- Create `scripts/phase16-document-ingestion-firewall-probe.mjs`
- Modify `scripts/security-preflight.ps1`
- Create `docs/architecture/reviews/2026-07-04-phase-16-document-ingestion-firewall-review.md`

- [ ] **Step 1: Add phase probe**

The probe must build/import the store and verify:

- safe local text import creates exactly one document job with `needs-review`;
- safe local text import creates one knowledge item with `pending`, not `published`;
- source metadata is preserved as a safe relative `knowledge_candidates/*.md` string;
- generated candidate file exists under the active case `knowledge_candidates/`;
- project knowledge JSON/Markdown are updated;
- search finds the imported candidate by title;
- extra fields are rejected;
- wrong project ID is rejected;
- path-like source names are rejected: `../escape.md`, `C:/temp/a.md`, `https://example.com/a.md`, `.env`, `.sap-adt-cli/config.json`, `messages.json`;
- secret-like bodies are rejected: `password=`, `token=`, `Authorization: Bearer`, `Cookie:`, `SAP_SESSIONID`, `MYSAPSSO2`, `secure-store:sec_`;
- ABAP-source-like bodies are rejected: `REPORT z...`, `CLASS z...`, `SELECT ... FROM ...`, `CALL FUNCTION`, `UPDATE`, `DELETE FROM`;
- no `publishedAt` or reviewer is set by import;
- no document import IPC uses `showOpenDialog`, `readFile`, `fetch`, `execFile`, `spawn`, `openExternal`, or Feishu sync markers.

- [ ] **Step 2: Update security preflight**

Add `workbench:knowledge-import-local-text` to the IPC whitelist.

Add required markers:

- `parseKnowledgeImportLocalTextInput`;
- `KNOWLEDGE_IMPORT_ALLOWED_KEYS`;
- `MAX_KNOWLEDGE_IMPORT_BODY_LENGTH`;
- `createImportedKnowledgeCandidate`;
- `importKnowledgeLocalText`;
- `workbench:knowledge-import-local-text`;
- `documentJobId`;
- `knowledgeItemId`;
- `phase16-document-ingestion-firewall-probe`.

Keep or strengthen scans that block:

- `showOpenDialog`, `dialog.show`, `readFile(`, `fetch(`, `execFile(`, `spawn(`, `exec(`, `openExternal`, `loadURL`, `feishu-sync`;
- `readFile(.*sourceFilePath` and `path.join(.*sourceFilePath`;
- `status: "published"` or `status: 'published'` in new import paths;
- knowledge delete patterns.

- [ ] **Step 3: Write adversarial review**

Document:

- why structured text import is the first safe ingestion step;
- why file picker, Feishu sync, and binary parsing are out of scope;
- exact blocked attack classes;
- residual risk that user-pasted business text can still be sensitive and must be manually redacted;
- verification commands and probe evidence.

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
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

## Commit

```powershell
git add apps/desktop/src scripts docs/superpowers/plans docs/architecture/reviews
git commit -m "feat: add document ingestion firewall"
```
