export type AgentThreadScope = "work" | "chat";
export type AgentThreadStatus = "active" | "archived" | "removed";
export type AgentTurnStatus = "queued" | "running" | "waiting-approval" | "completed" | "failed" | "cancelled" | "interrupted";

export type AgentItemType =
  | "user-message"
  | "resume-request"
  | "assistant-delta"
  | "assistant-message"
  | "assistant-message-part"
  | "tool-call"
  | "tool-decision"
  | "tool-result"
  | "artifact-reference"
  | "context-audit"
  | "usage"
  | "error"
  | "turn-status";

export interface AgentThreadRecord {
  id: string;
  legacyThreadId: string;
  scope: AgentThreadScope;
  projectId: string | null;
  caseId: string | null;
  status: AgentThreadStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTurnRecord {
  id: string;
  threadId: string;
  requestId: string;
  status: AgentTurnStatus;
  providerId: string | null;
  modelId: string | null;
  startedAt: string;
  completedAt: string | null;
  lastSequence: number;
  errorCode: string | null;
}

export interface AgentItemRecord {
  id: string;
  threadId: string;
  turnId: string;
  sequence: number;
  type: AgentItemType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
}

export interface AgentRuntimeEvent extends AgentItemRecord {
  requestId: string;
  legacyThreadId: string;
  scope: AgentThreadScope;
  projectId: string | null;
  caseId: string | null;
}

export interface AgentThreadSnapshot {
  thread: AgentThreadRecord;
  activeTurn: AgentTurnRecord | null;
  items: AgentItemRecord[];
  nextSequence: number;
}

export interface CancelAgentTurnInput {
  requestId: string;
}

export interface AgentRuntimeHealth {
  ok: boolean;
  databasePath: string;
  schemaVersion: number;
  recoveredInterruptedTurns: number;
  warning: string | null;
}

export interface AgentInterruptedTurnRecovery {
  turnId: string;
  agentThreadId: string;
  legacyThreadId: string;
  scope: AgentThreadScope;
  projectId: string | null;
  caseId: string | null;
  startedAt: string;
  providerId: string | null;
  modelId: string | null;
  resumeInput: Record<string, unknown> | null;
  canAutoResume: boolean;
}

export interface AgentThreadReplayInput {
  scope: AgentThreadScope;
  legacyThreadId: string;
  afterSequence?: number;
  limit?: number;
}

export function parseCancelAgentTurnInput(input: unknown): CancelAgentTurnInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("取消任务请求无效。");
  const value = input as Partial<CancelAgentTurnInput>;
  return {
    requestId: safeRuntimeId(value.requestId, "请求 ID")
  };
}

export function parseAgentThreadReplayInput(input: unknown): AgentThreadReplayInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("恢复会话请求无效。");
  const value = input as Partial<AgentThreadReplayInput>;
  if (value.scope !== "work" && value.scope !== "chat") throw new Error("恢复会话范围无效。");
  const afterSequence = Number.isFinite(value.afterSequence) ? Math.max(0, Math.trunc(value.afterSequence as number)) : 0;
  const limit = Number.isFinite(value.limit) ? Math.max(1, Math.min(500, Math.trunc(value.limit as number))) : 500;
  return {
    scope: value.scope,
    legacyThreadId: safeRuntimeId(value.legacyThreadId, "会话 ID"),
    afterSequence,
    limit
  };
}

export function safeRuntimeId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}无效。`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) throw new Error(`${label}格式无效。`);
  return normalized;
}
