import fs from "node:fs/promises";
import path from "node:path";
import type sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Database, Sqlite3Static, SqlValue } from "@sqlite.org/sqlite-wasm";
import type { SearchResult } from "../shared/workbenchTypes";

export interface DatabaseHealth {
  ok: boolean;
  databasePath: string;
  fts5Available: boolean;
  runtime: "sqlite-wasm";
  error: string | null;
  warnings: string[];
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

interface SearchDocumentRow {
  id?: SqlValue;
  type?: SqlValue;
  project_id?: SqlValue;
  case_id?: SqlValue;
  title?: SqlValue;
  location?: SqlValue;
  snippet?: SqlValue;
  source_path?: SqlValue;
}

const VIRTUAL_DB_PATH = "/workbench-app.db";
const MAX_INDEX_TEXT_LENGTH = 1200;

const unsafeSearchPatterns = [
  /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /secure-store:sec_[a-f0-9]{32}/i,
  /bearer\s+[a-z0-9._~+/=-]{12,}/i,
  /sk-(?:proj-)?[a-z0-9_-]{20,}/i,
  /github_pat_[a-z0-9_]{20,}/i,
  /ghp_[a-z0-9]{20,}/i,
  /xox[baprs]-[a-z0-9-]{20,}/i,
  /akia[0-9a-z]{16}/i,
  /authorization\s*[:=]\s*[^\n\r]+/i,
  /cookie\s*[:=]\s*[^\n\r]+/i,
  /sap_sessionid/i,
  /mysapsso2/i,
  /api[_-]?key\s*[:=]/i,
  /client[_-]?secret\s*[:=]/i,
  /access[_-]?key\s*[:=]/i,
  /secret\s*[:=]/i,
  /password\s*[:=]/i,
  /token\s*[:=]/i,
  /\b(report|class|interface|function)\s+z[a-z0-9_]{2,}/i,
  /\b(form|module|method)\s+[a-z0-9_]+\b[\s\S]{0,300}\bend(form|module|method)\b/i,
  /\bselect\s+[\s\S]{0,300}\s+from\s+[a-z0-9_/]+\b/i
];

export class DatabaseService {
  private readonly databasePath: string;
  private sqlite: Sqlite3Static | null = null;
  private db: Database | null = null;
  private health: DatabaseHealth;

  constructor(workspaceRoot: string) {
    this.databasePath = path.join(workspaceRoot, "app.db");
    this.health = {
      ok: false,
      databasePath: this.databasePath,
      fts5Available: false,
      runtime: "sqlite-wasm",
      error: "Database has not been initialized.",
      warnings: []
    };
  }

  async initialize(): Promise<DatabaseHealth> {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    try {
      this.sqlite = await loadSqlite();
      this.db = new this.sqlite.oo1.DB(VIRTUAL_DB_PATH, "cw");
      this.migrate();
      this.probeFts5();
      await this.persist();
      this.health = {
        ok: true,
        databasePath: this.databasePath,
        fts5Available: true,
        runtime: "sqlite-wasm",
        error: null,
        warnings: []
      };
    } catch (error) {
      this.close();
      this.health = {
        ok: false,
        databasePath: this.databasePath,
        fts5Available: false,
        runtime: "sqlite-wasm",
        error: this.safeError(error),
        warnings: []
      };
    }
    return this.health;
  }

  getHealth(): DatabaseHealth {
    return this.health;
  }

  async replaceSearchDocuments(records: SearchDocumentRecord[]): Promise<void> {
    if (!this.db || !this.health.ok) return;
    const warnings: string[] = [];
    const safeRecords = records.flatMap((record) => {
      const combined = [
        record.id,
        record.type,
        record.projectId,
        record.caseId ?? "",
        record.title,
        record.location,
        record.snippet,
        record.sourcePath ?? "",
        record.status ?? "",
        record.content
      ].join("\n");
      if (unsafeSearchPatterns.some((pattern) => pattern.test(combined))) {
        warnings.push(`Skipped unsafe search document: ${record.id}`);
        return [];
      }
      return [this.limitRecord(record)];
    });

    let transactionStarted = false;
    try {
      this.db.exec("BEGIN");
      transactionStarted = true;
      this.recreateSearchIndexTables();
      const insertDocument = this.db.prepare(`
        INSERT INTO search_documents (
          rowid, id, type, project_id, case_id, title, location, snippet, source_path, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO search_documents_fts(rowid, title, location, snippet, source_path, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      try {
        safeRecords.forEach((record, index) => {
          const rowid = index + 1;
          insertDocument.bind([
            rowid,
            record.id,
            record.type,
            record.projectId,
            record.caseId,
            record.title,
            record.location,
            record.snippet,
            record.sourcePath,
            record.status,
            record.updatedAt
          ]).step();
          insertDocument.reset(true);

          insertFts.bind([
            rowid,
            record.title,
            record.location,
            record.snippet,
            record.sourcePath ?? "",
            this.indexableText(record)
          ]).step();
          insertFts.reset(true);
        });
      } finally {
        insertDocument.finalize();
        insertFts.finalize();
      }
      this.db.exec("COMMIT");
      transactionStarted = false;
      this.db.exec("VACUUM");
      await this.persist();
    } catch (error) {
      if (transactionStarted) {
        try {
          this.db.exec("ROLLBACK");
        } catch (rollbackError) {
          warnings.push(`SQLite rollback failed: ${this.safeError(rollbackError)}`);
        }
      }
      this.health = {
        ...this.health,
        ok: false,
        fts5Available: false,
        error: this.safeError(error),
        warnings
      };
      return;
    }

    this.health = { ...this.health, warnings };
  }

  search(query: string, limit = 12): SearchResult[] {
    if (!this.db || !this.health.ok || !this.health.fts5Available) return [];
    const phrase = ftsPhrase(query);
    if (!phrase) return [];
    const rows = this.db.exec({
      sql: `
        SELECT search_documents.id, search_documents.type, search_documents.title, search_documents.location, search_documents.snippet
          , search_documents.project_id, search_documents.case_id, search_documents.source_path
        FROM search_documents_fts
        JOIN search_documents ON search_documents_fts.rowid = search_documents.rowid
        WHERE search_documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `,
      bind: [phrase, limit],
      rowMode: "object",
      returnValue: "resultRows"
    }) as SearchDocumentRow[];
    return rows.flatMap((row) => {
      if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.location !== "string" || typeof row.snippet !== "string") return [];
      if (row.type !== "project" && row.type !== "case" && row.type !== "file" && row.type !== "knowledge") return [];
      return [{
        id: row.id,
        type: row.type,
        title: row.title,
        location: row.location,
        snippet: row.snippet,
        projectId: typeof row.project_id === "string" ? row.project_id : undefined,
        caseId: typeof row.case_id === "string" ? row.case_id : null,
        sourcePath: typeof row.source_path === "string" ? row.source_path : null
      }];
    });
  }

  close(): void {
    if (this.db?.isOpen()) {
      this.db.close();
    }
    this.db = null;
  }

  private migrate(): void {
    this.assertOpen().exec(`
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
        content
      );

      PRAGMA secure_delete = ON;

      CREATE INDEX IF NOT EXISTS idx_search_documents_type ON search_documents(type);
      CREATE INDEX IF NOT EXISTS idx_search_documents_project ON search_documents(project_id);
      CREATE INDEX IF NOT EXISTS idx_search_documents_case ON search_documents(case_id);

      INSERT INTO app_meta(key, value, updated_at)
      VALUES ('schema_version', '1', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    `);
  }

  private recreateSearchIndexTables(): void {
    this.assertOpen().exec(`
      DROP TABLE IF EXISTS search_documents_fts;
      DROP TABLE IF EXISTS search_documents;

      CREATE TABLE search_documents (
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

      CREATE VIRTUAL TABLE search_documents_fts USING fts5(
        title,
        location,
        snippet,
        source_path,
        content
      );

      CREATE INDEX idx_search_documents_type ON search_documents(type);
      CREATE INDEX idx_search_documents_project ON search_documents(project_id);
      CREATE INDEX idx_search_documents_case ON search_documents(case_id);
    `);
  }

  private probeFts5(): void {
    const db = this.assertOpen();
    db.exec(`
      DROP TABLE IF EXISTS fts5_probe;
      CREATE VIRTUAL TABLE fts5_probe USING fts5(value);
      INSERT INTO fts5_probe(value) VALUES ('sqlite fts5 probe');
    `);
    const rows = db.exec({
      sql: "SELECT rowid FROM fts5_probe WHERE fts5_probe MATCH 'fts5'",
      rowMode: "object",
      returnValue: "resultRows"
    });
    db.exec("DROP TABLE fts5_probe;");
    if (rows.length < 1) {
      throw new Error("SQLite FTS5 probe returned no rows.");
    }
  }

  private async persist(): Promise<void> {
    if (!this.sqlite || !this.db?.pointer) return;
    const bytes = this.sqlite.capi.sqlite3_js_db_export(this.db.pointer);
    await fs.writeFile(this.databasePath, bytes);
  }

  private assertOpen(): Database {
    if (!this.db) throw new Error("SQLite database is not open.");
    return this.db;
  }

  private limitRecord(record: SearchDocumentRecord): SearchDocumentRecord {
    return {
      ...record,
      title: record.title.slice(0, 240),
      location: record.location.slice(0, 500),
      snippet: record.snippet.slice(0, 800),
      sourcePath: record.sourcePath?.slice(0, 500) ?? null,
      content: record.content.slice(0, MAX_INDEX_TEXT_LENGTH)
    };
  }

  private indexableText(record: SearchDocumentRecord): string {
    return [
      record.title,
      record.location,
      record.snippet,
      record.sourcePath ?? "",
      record.status ?? "",
      record.content
    ].join(" ").slice(0, MAX_INDEX_TEXT_LENGTH);
  }

  private safeError(error: unknown): string {
    const raw = error instanceof Error ? error.message : "SQLite database operation failed.";
    return raw
      .replace(/secure-store:sec_[a-f0-9]{32}/gi, "[secure-store-ref]")
      .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "[authorization]")
      .replace(/sk-(?:proj-)?[a-z0-9_-]{20,}/gi, "[api-key]")
      .replace(/github_pat_[a-z0-9_]{20,}/gi, "[github-token]")
      .replace(/ghp_[a-z0-9]{20,}/gi, "[github-token]")
      .replace(/xox[baprs]-[a-z0-9-]{20,}/gi, "[slack-token]")
      .replace(/akia[0-9a-z]{16}/gi, "[aws-access-key]")
      .replace(/authorization\s*[:=]\s*[^\n\r]+/gi, "authorization=[redacted]")
      .replace(/cookie\s*[:=]\s*[^\n\r]+/gi, "cookie=[redacted]");
  }
}

function ftsPhrase(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!normalized) return "";
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

async function loadSqlite(): Promise<Sqlite3Static> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ default: typeof sqlite3InitModule }>;
  const module = await dynamicImport("@sqlite.org/sqlite-wasm");
  return module.default();
}
