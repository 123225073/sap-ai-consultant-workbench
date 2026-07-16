export type AgentThreadScope = "work" | "chat";
export type AgentThreadStatus = "active" | "archived" | "removed";
export type AgentTurnStatus = "queued" | "running" | "waiting-approval" | "completed" | "failed" | "cancelled" | "interrupted";

export type AgentItemType =
  | "user-message"
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
}

export function parseCancelAgentTurnInput(input: unknown): CancelAgentTurnInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("取消任务请求无效。");
  const value = input as Partial<CancelAgentTurnInput>;
  return {
    requestId: safeRuntimeId(value.requestId, "请求 ID")
  };
}

export function safeRuntimeId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}无效。`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) throw new Error(`${label}格式无效。`);
  return normalized;
}
