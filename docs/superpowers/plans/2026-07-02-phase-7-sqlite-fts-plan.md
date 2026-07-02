# Phase 7 SQLite FTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a verified local SQLite + FTS5 persistence/search foundation without breaking the existing JSON-backed workbench flow.

**Architecture:** Keep `WorkspaceStore` as the current source of truth during Phase 7 and add SQLite as a local searchable mirror first. A new `databaseService.ts` owns database initialization, schema migration, FTS5 capability probing, and safe indexing. Search reads from SQLite when the probe succeeds and falls back to the existing in-memory/file search when unavailable.

**Tech Stack:** Electron main process, React + TypeScript renderer, local filesystem, `@sqlite.org/sqlite-wasm` as the first candidate SQLite runtime, SQLite FTS5 virtual tables, existing PowerShell security preflight.

---

## 1. First-Principles Design Decision

The product needs local-first search across projects, cases, files, and confirmed knowledge. It does not need a server database, cloud sync, or native desktop packaging risk at this stage.

Therefore Phase 7 must optimize for:

- local-only data
- no secrets in database tables
- no Electron native ABI dependency until necessary
- FTS5 proven by an executable capability probe
- no rewrite of all persistence before search value is proven
- no change to SAP, Feishu, model, or knowledge-publish boundaries

SQLite FTS5 will follow the official SQLite FTS5 virtual table model: create a virtual table with searchable text columns, write index rows, query with `MATCH`, and order by rank where supported.

## 2. File Structure

- `apps/desktop/package.json`
  - Add `@sqlite.org/sqlite-wasm` dependency only.
- `package-lock.json`
  - Update lockfile after install.
- `apps/desktop/src/main/databaseService.ts`
  - Create SQLite runtime loader, FTS5 probe, schema migration, indexing helpers, and search helpers.
- `apps/desktop/src/main/searchService.ts`
  - Create search result builder that uses SQLite if available and existing fallback otherwise.
- `apps/desktop/src/main/workspaceStore.ts`
  - Keep JSON state as source of truth; mirror projects/cases/files/knowledge into SQLite after state writes.
  - Route `search()` through `searchService`.
  - Update local storage metadata to report database path.
- `apps/desktop/src/shared/workbenchTypes.ts`
  - Add database health/status types if needed for local storage and future diagnostics.
- `scripts/security-preflight.ps1`
  - Add database file ignore/secret scan checks.
  - Add FTS5 schema marker checks.
- `docs/architecture/reviews/2026-07-02-phase-7-sqlite-fts-review.md`
  - Record adversarial review and verification evidence.

## 3. Agent Split

| Agent | Ownership | Write Scope |
|---|---|---|
| Controller | dependency choice, schema contract, final integration, commit/push | all files after review |
| Data Agent | `databaseService.ts`, schema SQL, migration/probe | `apps/desktop/src/main/databaseService.ts` |
| Search Agent | `searchService.ts`, `workspaceStore.search()` routing | `apps/desktop/src/main/searchService.ts`, narrow edits in `workspaceStore.ts` |
| Security Agent | database scans, no-secret review, IPC review | `scripts/security-preflight.ps1`, review doc |
| Product/UX Agent | search result wording, source/type labels | read-only review unless UI copy must change |

Do not run two write agents against `workspaceStore.ts`, `workbenchTypes.ts`, or `security-preflight.ps1` at the same time.

## 4. Schema Contract

Database path:

```text
local-data/workbench/app.db
```

Required tables:

```sql
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('project', 'case', 'file', 'knowledge')),
  project_id TEXT NOT NULL,
  case_id TEXT,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  snippet TEXT NOT NULL,
  source_path TEXT,
  status TEXT,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(
  title,
  location,
  snippet,
  source_path,
  content='search_documents',
  content_rowid='rowid'
);
```

Required mirror rule:

- `search_documents` contains only searchable metadata and summaries.
- It must not store raw secrets, encrypted blobs, SAP session artifacts, API keys, Feishu tokens, or large SAP source.
- It may store local case titles, file names, knowledge summaries, and user-visible snippets already shown in the app.

## 5. Task 1: Add SQLite Dependency And Capability Probe

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `package-lock.json`
- Create: `apps/desktop/src/main/databaseService.ts`

- [ ] **Step 1: Install official SQLite WASM package**

Run:

```powershell
npm --workspace apps/desktop install @sqlite.org/sqlite-wasm
```

Expected:

```text
added ... @sqlite.org/sqlite-wasm
```

- [ ] **Step 2: Add initial database service**

Create `apps/desktop/src/main/databaseService.ts` with this public shape:

```ts
import fs from "node:fs/promises";
import path from "node:path";

export interface DatabaseHealth {
  ok: boolean;
  databasePath: string;
  fts5Available: boolean;
  error: string | null;
}

export interface SearchDocumentRecord {
  id: string;
  type: "project" | "case" | "file" | "knowledge";
  projectId: string;
  caseId: string | null;
  title: string;
  location: string;
  snippet: string;
  sourcePath: string | null;
  status: string | null;
  content: string;
  updatedAt: string;
}

export class DatabaseService {
  private readonly databasePath: string;
  private health: DatabaseHealth | null = null;

  constructor(workspaceRoot: string) {
    this.databasePath = path.join(workspaceRoot, "app.db");
  }

  async initialize(): Promise<DatabaseHealth> {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    this.health = {
      ok: false,
      databasePath: this.databasePath,
      fts5Available: false,
      error: "SQLite runtime is not initialized yet."
    };
    return this.health;
  }

  getHealth(): DatabaseHealth {
    return this.health ?? {
      ok: false,
      databasePath: this.databasePath,
      fts5Available: false,
      error: "Database has not been initialized."
    };
  }

  async replaceSearchDocuments(_records: SearchDocumentRecord[]): Promise<void> {
    return;
  }
}
```

- [ ] **Step 3: Run type check**

Run:

```powershell
npm run check
```

Expected:

```text
tsc --noEmit
```

No TypeScript errors.

- [ ] **Step 4: Implement actual SQLite runtime probe**

Update `DatabaseService.initialize()` to load `@sqlite.org/sqlite-wasm`, open `local-data/workbench/app.db`, run:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS fts5_probe USING fts5(value);
INSERT INTO fts5_probe(value) VALUES ('sqlite fts5 probe');
SELECT rowid FROM fts5_probe WHERE fts5_probe MATCH 'fts5';
DROP TABLE fts5_probe;
```

Expected health when successful:

```ts
{
  ok: true,
  fts5Available: true,
  error: null
}
```

If the WASM runtime cannot load or FTS5 is unavailable, return a failed health object and do not crash the app.

- [ ] **Step 5: Run check and build**

Run:

```powershell
npm run check
npm run build
```

Expected:

- TypeScript passes.
- Main, preload, and renderer builds pass.

## 6. Task 2: Add Search Index Schema And Mirror Writer

**Files:**
- Modify: `apps/desktop/src/main/databaseService.ts`
- Modify: `scripts/security-preflight.ps1`

- [ ] **Step 1: Add schema migration**

Add migration SQL from section 4 plus:

```sql
CREATE INDEX IF NOT EXISTS idx_search_documents_type ON search_documents(type);
CREATE INDEX IF NOT EXISTS idx_search_documents_project ON search_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_search_documents_case ON search_documents(case_id);
```

Add `app_meta` key:

```text
schema_version = 1
```

- [ ] **Step 2: Add safe indexing guard**

Before inserting a `SearchDocumentRecord`, reject content matching:

```ts
const unsafeSearchPatterns = [
  /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /secure-store:sec_[a-f0-9]{32}/i,
  /bearer\s+[a-z0-9._-]{12,}/i,
  /authorization\s*[:=]/i,
  /cookie\s*[:=]/i,
  /sap_sessionid/i,
  /mysapsso2/i,
  /api[_-]?key\s*[:=]/i,
  /password\s*[:=]/i,
  /token\s*[:=]/i
];
```

If any pattern matches, skip that record and append a non-secret warning to health metadata.

- [ ] **Step 3: Add replace-all mirror behavior**

Implement `replaceSearchDocuments(records)` as a transaction:

```sql
DELETE FROM search_documents_fts;
DELETE FROM search_documents;
INSERT INTO search_documents (...);
INSERT INTO search_documents_fts(rowid, title, location, snippet, source_path) VALUES (...);
```

Use deterministic rowids from insert order. Do not store raw case message bodies in FTS during Phase 7.

- [ ] **Step 4: Add security preflight markers**

Update `scripts/security-preflight.ps1` to require:

```text
CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5
unsafeSearchPatterns
replaceSearchDocuments
local-data/workbench/app.db
```

Expected:

```text
OK SQLite FTS safety markers found.
```

## 7. Task 3: Build Search Service And Fallback

**Files:**
- Create: `apps/desktop/src/main/searchService.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`

- [ ] **Step 1: Create fallback search service**

Create `searchService.ts` with:

```ts
import type { CaseFileNode, ProjectSummary, SearchResult } from "../shared/workbenchTypes";
import type { DatabaseService, SearchDocumentRecord } from "./databaseService";

export function buildSearchDocuments(projects: ProjectSummary[], files: CaseFileNode[]): SearchDocumentRecord[] {
  // project, case, knowledge, and current file records
  return [];
}

export async function searchWorkbench(
  database: DatabaseService | null,
  projects: ProjectSummary[],
  files: CaseFileNode[],
  query: string
): Promise<SearchResult[]> {
  return fallbackSearch(projects, files, query);
}

function fallbackSearch(projects: ProjectSummary[], files: CaseFileNode[], query: string): SearchResult[] {
  // Copy the current workspaceStore.search behavior here first.
  return [];
}
```

- [ ] **Step 2: Move current search logic**

Move current `WorkspaceStore.search()` matching behavior into `fallbackSearch()` without changing labels or result shape.

Expected preserved behavior:

- project results
- case results
- knowledge results labeled as `knowledge`
- file results from current case tree
- max 20 results

- [ ] **Step 3: Add SQLite path**

If `database.getHealth().ok && database.getHealth().fts5Available`, query:

```sql
SELECT id, type, title, location, snippet
FROM search_documents_fts
JOIN search_documents ON search_documents_fts.rowid = search_documents.rowid
WHERE search_documents_fts MATCH ?
ORDER BY rank
LIMIT 20;
```

If the query fails, return fallback search and store no secret-bearing error.

- [ ] **Step 4: Run regression check**

Run:

```powershell
npm run check
npm run build
```

Expected:

No errors.

## 8. Task 4: Wire Database Mirror Into WorkspaceStore

**Files:**
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`

- [ ] **Step 1: Initialize DatabaseService**

In `WorkspaceStore` constructor or `load()` path:

```ts
this.database = new DatabaseService(this.workspaceRoot);
await this.database.initialize();
```

Do not block app startup if database initialization fails.

- [ ] **Step 2: Mirror after writes**

After these state-changing methods write JSON/files, call a shared mirror method:

```text
createDemoProject
createDemoCase
appendMessage
saveProjectConfig
saveProjectStandards
publishKnowledge
markKnowledgeConflicted
expireKnowledge
```

The mirror method:

```ts
private async refreshSearchIndex(state: StoredState): Promise<void> {
  if (!this.database?.getHealth().ok) return;
  const files = await this.getCaseFiles();
  await this.database.replaceSearchDocuments(buildSearchDocuments(state.projects, files));
}
```

- [ ] **Step 3: Update local storage metadata**

Set:

```ts
databasePath: "local-data/workbench/app.db"
```

when database initialization succeeds or the path is known.

- [ ] **Step 4: Run runtime smoke check**

Use a temp workspace and verify:

```text
app.db exists
FTS5 probe succeeded
search finds case
search finds file
search finds knowledge
fallback still works if database health is failed
```

## 9. Task 5: Adversarial Review And Verification

**Files:**
- Create: `docs/architecture/reviews/2026-07-02-phase-7-sqlite-fts-review.md`

- [ ] **Step 1: Dispatch Data/Search review agent**

Ask it to verify:

- SQLite mirror does not become the source of truth yet.
- FTS search returns the same user-facing types.
- JSON fallback still works.
- Search never stores raw secrets.

- [ ] **Step 2: Dispatch Security review agent**

Ask it to verify:

- no secrets in SQLite records
- no generic DB query IPC
- no renderer direct database access
- no SAP write path introduced
- `app.db` remains ignored by Git

- [ ] **Step 3: Dispatch Product/UX review agent**

Ask it to verify:

- search results remain understandable to non-programmers
- source/type labels are visible
- no new dashboard surface appears

- [ ] **Step 4: Write review note**

The review note must include:

```text
功能范围
MVP 边界
数据库路径
FTS5 探针结果
搜索覆盖范围
安全扫描结果
未解决风险
```

- [ ] **Step 5: Final verification**

Run:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

Expected:

All commands exit 0.

## 10. Commit And Push

- [ ] **Step 1: Commit**

```powershell
git add .
git commit -m "feat: add sqlite fts search foundation"
```

- [ ] **Step 2: Clean-tree security preflight**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
```

- [ ] **Step 3: Push**

```powershell
git push -u origin phase-7-sqlite-fts
```

## 11. Exit Criteria

- `origin/phase-7-sqlite-fts` exists.
- SQLite database path is fixed under ignored `local-data/workbench/app.db`.
- FTS5 capability is probed at runtime.
- Search uses SQLite when healthy and falls back safely when not.
- No renderer database IPC or generic SQL IPC exists.
- No SAP, Feishu, model, or knowledge-publish behavior changes.
- Every P0/P1 finding from adversarial review is fixed before commit.
