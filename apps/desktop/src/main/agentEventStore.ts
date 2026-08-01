import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Database, Sqlite3Static, SqlValue } from "@sqlite.org/sqlite-wasm";
import type {
  AgentItemRecord,
  AgentItemType,
  AgentRuntimeHealth,
  AgentInterruptedTurnRecovery,
  AgentThreadRecord,
  AgentThreadScope,
  AgentThreadSnapshot,
  AgentTurnRecord,
  AgentTurnStatus
} from "../shared/agentRuntimeTypes";

const VIRTUAL_DB_PATH = "/agent-events.db";
const SCHEMA_VERSION = 1;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_STRING_CHARS = 32_000;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;
const MAX_PAYLOAD_DEPTH = 8;
const SENSITIVE_FIELD_NAME = /(?:api[_-]?key|apiKey|access[_-]?key|accessKey|authorization|cookie|credential|password|passwd|private[_-]?key|privateKey|client[_-]?secret|clientSecret|secret|token)/i;

const SENSITIVE_PATTERNS = [
  /secure-store:sec_[a-f0-9]{32}/gi,
  /bearer\s+[a-z0-9._~+/=-]{12,}/gi,
  /sk-(?:proj-)?[a-z0-9_-]{16,}/gi,
  /github_pat_[a-z0-9_]{20,}/gi,
  /ghp_[a-z0-9]{20,}/gi,
  /xox[baprs]-[a-z0-9-]{20,}/gi,
  /authorization\s*[:=]\s*[^\n\r]+/gi,
  /cookie\s*[:=]\s*[^\n\r]+/gi,
  /api[_-]?key\s*[:=]\s*[^\n\r]+/gi,
  /api(?:[_-]?key|Key)\s*[:=]\s*[^\n\r]+/gi,
  /clientSecret\s*[:=]\s*[^\n\r]+/gi,
  /password\s*[:=]\s*[^\n\r]+/gi,
  /token\s*[:=]\s*[^\n\r]+/gi
];

interface ThreadRow {
  id?: SqlValue;
  legacy_thread_id?: SqlValue;
  scope?: SqlValue;
  project_id?: SqlValue;
  case_id?: SqlValue;
  status?: SqlValue;
  created_at?: SqlValue;
  updated_at?: SqlValue;
}

interface TurnRow {
  id?: SqlValue;
  thread_id?: SqlValue;
  request_id?: SqlValue;
  status?: SqlValue;
  provider_id?: SqlValue;
  model_id?: SqlValue;
  started_at?: SqlValue;
  completed_at?: SqlValue;
  last_sequence?: SqlValue;
  error_code?: SqlValue;
}

interface ItemRow {
  id?: SqlValue;
  thread_id?: SqlValue;
  turn_id?: SqlValue;
  sequence?: SqlValue;
  type?: SqlValue;
  payload_json?: SqlValue;
  idempotency_key?: SqlValue;
  created_at?: SqlValue;
}

export interface EnsureAgentThreadInput {
  legacyThreadId: string;
  scope: AgentThreadScope;
  projectId?: string | null;
  caseId?: string | null;
}

export interface StartAgentTurnInput {
  threadId: string;
  requestId: string;
  providerId?: string | null;
  modelId?: string | null;
  userContent?: string;
  resumeInput?: Record<string, unknown> | null;
  recoveryOfTurnId?: string | null;
}

export interface AppendAgentItemInput {
  threadId: string;
  turnId: string;
  type: AgentItemType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  itemId?: string;
  deferPersist?: boolean;
}

export class AgentEventStore {
  private readonly databasePath: string;
  private readonly backupPath: string;
  private sqlite: Sqlite3Static | null = null;
  private db: Database | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private health: AgentRuntimeHealth;

  constructor(workspaceRoot: string) {
    this.databasePath = path.join(workspaceRoot, "agent-events.db");
    this.backupPath = `${this.databasePath}.previous`;
    this.health = {
      ok: false,
      databasePath: this.databasePath,
      schemaVersion: SCHEMA_VERSION,
      recoveredInterruptedTurns: 0,
      warning: "运行时事件数据库尚未初始化。"
    };
  }

  async initialize(): Promise<AgentRuntimeHealth> {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    const restoredPrevious = await this.restorePreviousIfPrimaryMissing();
    this.sqlite = await loadSqlite();
    try {
      this.db = new this.sqlite.oo1.DB(VIRTUAL_DB_PATH, "cw");
      await this.restoreExistingDatabase();
      this.migrate();
      const recoveredInterruptedTurns = this.interruptUnfinishedTurns();
      await this.persist();
      this.health = {
        ok: true,
        databasePath: this.databasePath,
        schemaVersion: SCHEMA_VERSION,
        recoveredInterruptedTurns,
        warning: restoredPrevious ? "检测到上次保存未完成，已从上一份稳定运行记录恢复。" : null
      };
    } catch (error) {
      const warning = safeError(error, "运行时事件数据库初始化失败。");
      await this.recoverCorruptDatabase();
      const recoveredPrevious = await this.restorePreviousIfPrimaryMissing();
      if (recoveredPrevious) {
        try {
          this.db = new this.sqlite.oo1.DB(VIRTUAL_DB_PATH, "cw");
          await this.restoreExistingDatabase();
          this.migrate();
          const recoveredInterruptedTurns = this.interruptUnfinishedTurns();
          await this.persist();
          this.health = {
            ok: true,
            databasePath: this.databasePath,
            schemaVersion: SCHEMA_VERSION,
            recoveredInterruptedTurns,
            warning: `主运行记录损坏，已隔离并从上一份稳定备份恢复。${warning}`
          };
          return this.health;
        } catch {
          await this.recoverCorruptDatabase();
        }
      }
      this.db = new this.sqlite.oo1.DB(VIRTUAL_DB_PATH, "cw");
      this.migrate();
      await this.persist();
      this.health = {
        ok: true,
        databasePath: this.databasePath,
        schemaVersion: SCHEMA_VERSION,
        recoveredInterruptedTurns: 0,
        warning: `原运行记录已隔离保留，系统已建立新的事件数据库。${warning}`
      };
    }
    return this.health;
  }

  getHealth(): AgentRuntimeHealth {
    return this.health;
  }

  async ensureThread(input: EnsureAgentThreadInput): Promise<AgentThreadRecord> {
    const db = this.assertReady();
    const existing = this.readThreadByLegacyId(input.scope, input.legacyThreadId);
    if (existing) {
      const expectedProjectId = input.scope === "work" ? input.projectId ?? null : null;
      const expectedCaseId = input.scope === "work" ? input.caseId ?? null : null;
      if (existing.projectId !== expectedProjectId || existing.caseId !== expectedCaseId) {
        throw new Error("运行会话已经绑定到其他 Project 或 Case，已阻止跨边界复用。");
      }
      return existing;
    }

    const record: AgentThreadRecord = {
      id: `agent-thread-${randomUUID()}`,
      legacyThreadId: input.legacyThreadId,
      scope: input.scope,
      projectId: input.scope === "work" ? input.projectId ?? null : null,
      caseId: input.scope === "work" ? input.caseId ?? null : null,
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.exec({
      sql: `INSERT INTO agent_threads (id, legacy_thread_id, scope, project_id, case_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [record.id, record.legacyThreadId, record.scope, record.projectId, record.caseId, record.status, record.createdAt, record.updatedAt]
    });
    await this.persist();
    return record;
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurnRecord> {
    const db = this.assertReady();
    const active = this.readActiveTurn(input.threadId);
    if (active) throw new Error("当前会话已有任务正在运行，请等待完成或先停止该任务。");
    const startedAt = nowIso();
    const turn: AgentTurnRecord = {
      id: `agent-turn-${randomUUID()}`,
      threadId: input.threadId,
      requestId: input.requestId,
      status: "running",
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      startedAt,
      completedAt: null,
      lastSequence: 0,
      errorCode: null
    };
    let transactionStarted = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      if (input.recoveryOfTurnId) {
        const source = this.readTurn(input.recoveryOfTurnId);
        if (!source || source.threadId !== input.threadId || source.status !== "interrupted" || source.errorCode !== "application-restarted") {
          throw new Error("待续接任务已被处理或不属于当前会话。");
        }
      }
      db.exec({
        sql: `INSERT INTO agent_turns (id, thread_id, request_id, status, provider_id, model_id, started_at, completed_at, last_sequence, error_code)
              VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)`,
        bind: [turn.id, turn.threadId, turn.requestId, turn.status, turn.providerId, turn.modelId, turn.startedAt]
      });
      let nextSequence = numeric((db.exec({
        sql: "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM agent_items WHERE thread_id = ?",
        bind: [input.threadId], rowMode: "object", returnValue: "resultRows"
      }) as Array<{ next_sequence?: SqlValue }>)[0]?.next_sequence);
      const insertInitialItem = (type: AgentItemType, payload: Record<string, unknown>, idempotencyKey: string) => {
        const sanitized = sanitizePayload(payload);
        const payloadJson = JSON.stringify(sanitized);
        if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("运行记录内容超过 64 KB 安全上限，已拒绝保存。");
        db.exec({
          sql: `INSERT INTO agent_items (id, thread_id, turn_id, sequence, type, payload_json, idempotency_key, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          bind: [`agent-item-${randomUUID()}`, input.threadId, turn.id, nextSequence, type, payloadJson, idempotencyKey, startedAt]
        });
        nextSequence += 1;
      };
      if (typeof input.userContent === "string") {
        insertInitialItem("turn-status", { status: "running" }, `${turn.id}:status:running`);
        if (input.resumeInput) insertInitialItem("resume-request", { input: input.resumeInput }, `${turn.id}:resume-request`);
        insertInitialItem("user-message", { content: input.userContent }, `${turn.id}:user-message`);
        turn.lastSequence = nextSequence - 1;
        db.exec({ sql: "UPDATE agent_turns SET last_sequence = ? WHERE id = ?", bind: [turn.lastSequence, turn.id] });
      }
      if (input.recoveryOfTurnId) {
        db.exec({
          sql: `UPDATE agent_turns SET error_code = 'application-restarted-resumed'
                WHERE id = ? AND thread_id = ? AND status = 'interrupted' AND error_code = 'application-restarted'`,
          bind: [input.recoveryOfTurnId, input.threadId]
        });
      }
      db.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try { db.exec("ROLLBACK"); } catch { /* Preserve original error. */ }
      }
      throw error;
    }
    await this.persist();
    return turn;
  }

  async appendItem(input: AppendAgentItemInput): Promise<AgentItemRecord> {
    const db = this.assertReady();
    const existing = this.readItemByIdempotencyKey(input.threadId, input.idempotencyKey);
    if (existing) return existing;

    const payload = sanitizePayload(input.payload);
    const payloadJson = JSON.stringify(payload);
    if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("运行记录内容超过 64 KB 安全上限，已拒绝保存。");

    let transactionStarted = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const rows = db.exec({
        sql: "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM agent_items WHERE thread_id = ?",
        bind: [input.threadId],
        rowMode: "object",
        returnValue: "resultRows"
      }) as Array<{ next_sequence?: SqlValue }>;
      const sequence = numeric(rows[0]?.next_sequence);
      const item: AgentItemRecord = {
        id: input.itemId ?? `agent-item-${randomUUID()}`,
        threadId: input.threadId,
        turnId: input.turnId,
        sequence,
        type: input.type,
        payload,
        idempotencyKey: input.idempotencyKey,
        createdAt: nowIso()
      };
      db.exec({
        sql: `INSERT INTO agent_items (id, thread_id, turn_id, sequence, type, payload_json, idempotency_key, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        bind: [item.id, item.threadId, item.turnId, item.sequence, item.type, payloadJson, item.idempotencyKey, item.createdAt]
      });
      db.exec({
        sql: "UPDATE agent_turns SET last_sequence = ? WHERE id = ? AND thread_id = ?",
        bind: [sequence, input.turnId, input.threadId]
      });
      db.exec({ sql: "UPDATE agent_threads SET updated_at = ? WHERE id = ?", bind: [item.createdAt, input.threadId] });
      db.exec("COMMIT");
      transactionStarted = false;
      if (!input.deferPersist) await this.persist();
      return item;
    } catch (error) {
      if (transactionStarted) {
        try { db.exec("ROLLBACK"); } catch { /* Preserve the original error. */ }
      }
      const raced = this.readItemByIdempotencyKey(input.threadId, input.idempotencyKey);
      if (raced) return raced;
      throw error;
    }
  }

  async updateTurnStatus(turnId: string, status: AgentTurnStatus, errorCode: string | null = null): Promise<AgentTurnRecord> {
    const db = this.assertReady();
    const terminal = status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
    db.exec({
      sql: `UPDATE agent_turns SET status = ?, completed_at = ?, error_code = ?
            WHERE id = ? AND status IN ('queued', 'running', 'waiting-approval')`,
      bind: [status, terminal ? nowIso() : null, errorCode, turnId]
    });
    await this.persist();
    const turn = this.readTurn(turnId);
    if (!turn) throw new Error("运行任务已不存在。");
    return turn;
  }

  flush(): Promise<void> {
    return this.persist();
  }

  readThreadSnapshot(threadId: string, afterSequence = 0, limit = 500): AgentThreadSnapshot {
    const thread = this.readThread(threadId);
    if (!thread) throw new Error("运行会话不存在。");
    const activeTurn = this.readActiveTurn(threadId);
    const initialItems = this.readItems(threadId, afterSequence, limit);
    const activeItems = activeTurn && !initialItems.some((item) => item.turnId === activeTurn.id)
      ? this.readTurnItems(activeTurn.id)
      : [];
    const items = [...initialItems, ...activeItems]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .sort((left, right) => left.sequence - right.sequence);
    return {
      thread,
      activeTurn,
      items,
      nextSequence: items.at(-1)?.sequence ?? afterSequence
    };
  }

  readThreadSnapshotByLegacyId(scope: AgentThreadScope, legacyThreadId: string, afterSequence = 0, limit = 500): AgentThreadSnapshot | null {
    const thread = this.readThreadByLegacyId(scope, legacyThreadId);
    return thread ? this.readThreadSnapshot(thread.id, afterSequence, limit) : null;
  }

  readItems(threadId: string, afterSequence = 0, limit = 500): AgentItemRecord[] {
    const db = this.assertReady();
    const rows = db.exec({
      sql: `SELECT id, thread_id, turn_id, sequence, type, payload_json, idempotency_key, created_at
            FROM agent_items WHERE thread_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`,
      bind: [threadId, afterSequence, limit],
      rowMode: "object",
      returnValue: "resultRows"
    }) as ItemRow[];
    return rows.map(itemFromRow);
  }

  readPendingInterruptedTurns(limit = 100): AgentInterruptedTurnRecovery[] {
    const db = this.assertReady();
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = db.exec({
      sql: `SELECT t.id AS turn_id, t.thread_id AS agent_thread_id, t.started_at, t.provider_id, t.model_id,
                   th.legacy_thread_id, th.scope, th.project_id, th.case_id
            FROM agent_turns t
            JOIN agent_threads th ON th.id = t.thread_id
            WHERE t.status = 'interrupted' AND t.error_code = 'application-restarted'
            ORDER BY t.started_at ASC LIMIT ?`,
      bind: [safeLimit],
      rowMode: "object",
      returnValue: "resultRows"
    }) as Array<Record<string, SqlValue | undefined>>;
    return rows.map((row) => {
      const scope = textValue(row.scope);
      if (scope !== "work" && scope !== "chat") throw new Error("运行恢复记录范围损坏。");
      const turnId = textValue(row.turn_id);
      const turnItems = this.readTurnItems(turnId);
      const resumeItem = turnItems.find((item) => item.type === "resume-request");
      const resumeInput = resumeItem?.payload.input && typeof resumeItem.payload.input === "object" && !Array.isArray(resumeItem.payload.input)
        ? resumeItem.payload.input as Record<string, unknown>
        : null;
      const hasUnsafeProgress = turnItems.some((item) => item.type === "assistant-delta"
        || item.type === "assistant-message"
        || item.type === "assistant-message-part"
        || item.type === "tool-call"
        || item.type === "tool-decision"
        || item.type === "tool-result"
        || item.type === "artifact-reference");
      return {
        turnId,
        agentThreadId: textValue(row.agent_thread_id),
        legacyThreadId: textValue(row.legacy_thread_id),
        scope,
        projectId: nullableText(row.project_id),
        caseId: nullableText(row.case_id),
        startedAt: textValue(row.started_at),
        providerId: nullableText(row.provider_id),
        modelId: nullableText(row.model_id),
        resumeInput,
        canAutoResume: Boolean(resumeInput) && !hasUnsafeProgress
      };
    });
  }

  async acknowledgeInterruptedTurn(turnId: string, outcome: "projected" | "committed" | "unmatched" | "resumed"): Promise<void> {
    const db = this.assertReady();
    const turn = this.readTurn(turnId);
    if (!turn || turn.status !== "interrupted" || turn.errorCode !== "application-restarted") return;
    await this.appendItem({
      threadId: turn.threadId,
      turnId,
      type: "error",
      payload: {
        code: "application-restarted",
        message: outcome === "resumed"
          ? "应用已在安全条件下自动续接上次未完成的任务。"
          : outcome === "committed"
          ? "应用上次关闭前回复已经保存，但运行完成状态尚未来得及确认，已在原会话提示用户检查现有回复。"
          : outcome === "projected"
            ? "应用上次关闭时任务尚未完成，已在原会话显示中断提示。"
            : "应用上次关闭时任务尚未完成，但原会话已不存在，未自动恢复。"
      },
      idempotencyKey: `${turnId}:error:application-restarted`,
      deferPersist: true
    });
    await this.appendItem({
      threadId: turn.threadId,
      turnId,
      type: "turn-status",
      payload: { status: "interrupted", recovery: outcome },
      idempotencyKey: `${turnId}:status:interrupted`,
      deferPersist: true
    });
    db.exec({
      sql: `UPDATE agent_turns SET error_code = ?
            WHERE id = ? AND status = 'interrupted' AND error_code = 'application-restarted'`,
      bind: [`application-restarted-${outcome}`, turnId]
    });
    await this.persist();
  }

  readActiveTurn(threadId: string): AgentTurnRecord | null {
    const db = this.assertReady();
    const rows = db.exec({
      sql: `SELECT id, thread_id, request_id, status, provider_id, model_id, started_at, completed_at, last_sequence, error_code
            FROM agent_turns WHERE thread_id = ? AND status IN ('queued', 'running', 'waiting-approval') ORDER BY started_at DESC LIMIT 1`,
      bind: [threadId],
      rowMode: "object",
      returnValue: "resultRows"
    }) as TurnRow[];
    return rows[0] ? turnFromRow(rows[0]) : null;
  }

  close(): void {
    if (this.db?.isOpen()) this.db.close();
    this.db = null;
  }

  private readThread(id: string): AgentThreadRecord | null {
    const db = this.assertReady();
    const rows = db.exec({
      sql: "SELECT id, legacy_thread_id, scope, project_id, case_id, status, created_at, updated_at FROM agent_threads WHERE id = ? LIMIT 1",
      bind: [id], rowMode: "object", returnValue: "resultRows"
    }) as ThreadRow[];
    return rows[0] ? threadFromRow(rows[0]) : null;
  }

  private readThreadByLegacyId(scope: AgentThreadScope, legacyThreadId: string): AgentThreadRecord | null {
    const db = this.assertReady();
    const rows = db.exec({
      sql: "SELECT id, legacy_thread_id, scope, project_id, case_id, status, created_at, updated_at FROM agent_threads WHERE scope = ? AND legacy_thread_id = ? LIMIT 1",
      bind: [scope, legacyThreadId], rowMode: "object", returnValue: "resultRows"
    }) as ThreadRow[];
    return rows[0] ? threadFromRow(rows[0]) : null;
  }

  private readTurn(id: string): AgentTurnRecord | null {
    const db = this.assertReady();
    const rows = db.exec({
      sql: `SELECT id, thread_id, request_id, status, provider_id, model_id, started_at, completed_at, last_sequence, error_code
            FROM agent_turns WHERE id = ? LIMIT 1`,
      bind: [id], rowMode: "object", returnValue: "resultRows"
    }) as TurnRow[];
    return rows[0] ? turnFromRow(rows[0]) : null;
  }

  private readItemByIdempotencyKey(threadId: string, idempotencyKey: string): AgentItemRecord | null {
    const db = this.assertReady();
    const rows = db.exec({
      sql: `SELECT id, thread_id, turn_id, sequence, type, payload_json, idempotency_key, created_at
            FROM agent_items WHERE thread_id = ? AND idempotency_key = ? LIMIT 1`,
      bind: [threadId, idempotencyKey], rowMode: "object", returnValue: "resultRows"
    }) as ItemRow[];
    return rows[0] ? itemFromRow(rows[0]) : null;
  }

  private readTurnItems(turnId: string): AgentItemRecord[] {
    const db = this.assertReady();
    const rows = db.exec({
      sql: `SELECT id, thread_id, turn_id, sequence, type, payload_json, idempotency_key, created_at
            FROM agent_items WHERE turn_id = ? ORDER BY sequence ASC`,
      bind: [turnId], rowMode: "object", returnValue: "resultRows"
    }) as ItemRow[];
    return rows.map(itemFromRow);
  }

  private migrate(): void {
    const db = this.assertOpen();
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;

      CREATE TABLE IF NOT EXISTS runtime_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_threads (
        id TEXT PRIMARY KEY,
        legacy_thread_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('work', 'chat')),
        project_id TEXT,
        case_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'removed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope, legacy_thread_id)
      );

      CREATE TABLE IF NOT EXISTS agent_turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE RESTRICT,
        request_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting-approval', 'completed', 'failed', 'cancelled', 'interrupted')),
        provider_id TEXT,
        model_id TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        UNIQUE(thread_id, request_id)
      );

      CREATE TABLE IF NOT EXISTS agent_items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE RESTRICT,
        turn_id TEXT NOT NULL REFERENCES agent_turns(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, sequence),
        UNIQUE(thread_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_turns_thread_status ON agent_turns(thread_id, status);
      CREATE INDEX IF NOT EXISTS idx_agent_items_turn ON agent_items(turn_id, sequence);

      INSERT INTO runtime_meta(key, value, updated_at)
      VALUES ('schema_version', '${SCHEMA_VERSION}', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
    `);
  }

  private interruptUnfinishedTurns(): number {
    const db = this.assertOpen();
    const rows = db.exec({
      sql: "SELECT COUNT(*) AS count FROM agent_turns WHERE status IN ('queued', 'running', 'waiting-approval')",
      rowMode: "object", returnValue: "resultRows"
    }) as Array<{ count?: SqlValue }>;
    const count = numeric(rows[0]?.count);
    if (count > 0) {
      db.exec({
        sql: `UPDATE agent_turns SET status = 'interrupted', completed_at = ?, error_code = 'application-restarted'
              WHERE status IN ('queued', 'running', 'waiting-approval')`,
        bind: [nowIso()]
      });
    }
    return count;
  }

  private async restoreExistingDatabase(): Promise<void> {
    if (!this.sqlite || !this.db?.pointer) return;
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(this.databasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (bytes.byteLength === 0) return;
    if (Buffer.from(bytes.subarray(0, 16)).toString("binary") !== "SQLite format 3\u0000") {
      throw new Error("现有运行记录不是有效 SQLite 文件。");
    }
    // Node.js readFile returns Buffer; sqlite-wasm accepts it as a typed array
    // but its heap selector requires an exact Uint8Array constructor.
    const databaseImage = new Uint8Array(bytes);
    const pointer = this.sqlite.wasm.allocFromTypedArray(databaseImage);
    const flags = this.sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | this.sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const result = this.sqlite.capi.sqlite3_deserialize(this.db.pointer, "main", pointer, bytes.byteLength, bytes.byteLength, flags);
    if (result !== this.sqlite.capi.SQLITE_OK) {
      this.sqlite.wasm.dealloc(pointer);
      throw new Error(`现有运行记录数据库无法加载（SQLite ${result}）。`);
    }
    this.db.exec("PRAGMA quick_check;");
  }

  private persist(): Promise<void> {
    if (!this.sqlite || !this.db?.pointer) return Promise.resolve();
    const bytes = this.sqlite.capi.sqlite3_js_db_export(this.db.pointer);
    const write = this.persistQueue.then(() => this.persistDatabaseImage(bytes));
    this.persistQueue = write.catch(() => undefined);
    return write;
  }

  private async persistDatabaseImage(bytes: Uint8Array): Promise<void> {
    const tempPath = `${this.databasePath}.tmp-${process.pid}-${randomUUID()}`;
    await fs.writeFile(tempPath, bytes, { flag: "wx" });
    let movedCurrent = false;
    try {
      try {
        await fs.rm(this.backupPath, { force: true });
        await fs.rename(this.databasePath, this.backupPath);
        movedCurrent = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await fs.rename(tempPath, this.databasePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      if (movedCurrent) {
        try { await fs.rename(this.backupPath, this.databasePath); } catch { /* Preserve the original failure. */ }
      }
      throw error;
    }
  }

  private async restorePreviousIfPrimaryMissing(): Promise<boolean> {
    try {
      await fs.access(this.databasePath);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await fs.copyFile(this.backupPath, this.databasePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async recoverCorruptDatabase(): Promise<void> {
    this.close();
    const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "");
    try {
      await fs.rename(this.databasePath, `${this.databasePath}.corrupt-${suffix}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private assertReady(): Database {
    if (!this.health.ok && this.health.warning !== "运行时事件数据库尚未初始化。") throw new Error("运行时事件数据库不可用。");
    return this.assertOpen();
  }

  private assertOpen(): Database {
    if (!this.db) throw new Error("运行时事件数据库尚未打开。");
    return this.db;
  }
}

function sanitizePayload(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(value, 0) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_PAYLOAD_DEPTH) throw new Error("运行记录嵌套层级过深，已拒绝保存。");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redact(value).slice(0, MAX_STRING_CHARS);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_OBJECT_KEYS)
      .map(([key, item]) => [safeKey(key), SENSITIVE_FIELD_NAME.test(key) ? "[已脱敏]" : sanitizeValue(item, depth + 1)]));
  }
  return String(value).slice(0, 200);
}

function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80) || "value";
}

function redact(value: string): string {
  return SENSITIVE_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[已脱敏]"), value).replace(/\u0000/g, "");
}

function threadFromRow(row: ThreadRow): AgentThreadRecord {
  const scope = textValue(row.scope);
  const status = textValue(row.status);
  if (scope !== "work" && scope !== "chat") throw new Error("运行会话范围损坏。");
  if (status !== "active" && status !== "archived" && status !== "removed") throw new Error("运行会话状态损坏。");
  return {
    id: textValue(row.id), legacyThreadId: textValue(row.legacy_thread_id), scope,
    projectId: nullableText(row.project_id), caseId: nullableText(row.case_id), status,
    createdAt: textValue(row.created_at), updatedAt: textValue(row.updated_at)
  };
}

function turnFromRow(row: TurnRow): AgentTurnRecord {
  const status = textValue(row.status) as AgentTurnStatus;
  return {
    id: textValue(row.id), threadId: textValue(row.thread_id), requestId: textValue(row.request_id), status,
    providerId: nullableText(row.provider_id), modelId: nullableText(row.model_id), startedAt: textValue(row.started_at),
    completedAt: nullableText(row.completed_at), lastSequence: numeric(row.last_sequence), errorCode: nullableText(row.error_code)
  };
}

function itemFromRow(row: ItemRow): AgentItemRecord {
  const payloadJson = textValue(row.payload_json);
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  return {
    id: textValue(row.id), threadId: textValue(row.thread_id), turnId: textValue(row.turn_id), sequence: numeric(row.sequence),
    type: textValue(row.type) as AgentItemType, payload, idempotencyKey: textValue(row.idempotency_key), createdAt: textValue(row.created_at)
  };
}

function textValue(value: SqlValue | undefined): string {
  if (typeof value !== "string") throw new Error("运行记录字段损坏。");
  return value;
}

function nullableText(value: SqlValue | undefined): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function numeric(value: SqlValue | undefined): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) throw new Error("运行记录序号损坏。");
  return number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeError(error: unknown, fallback: string): string {
  const raw = error instanceof Error && error.message ? error.message : fallback;
  return redact(raw).slice(0, 500);
}

async function loadSqlite(): Promise<Sqlite3Static> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ default: typeof sqlite3InitModule }>;
  const module = await dynamicImport("@sqlite.org/sqlite-wasm");
  return module.default();
}
