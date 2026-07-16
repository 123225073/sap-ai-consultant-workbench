import { createHash } from "node:crypto";
import type { AgentInterruptedTurnRecovery, AgentItemType, AgentRuntimeEvent, AgentThreadSnapshot, AgentThreadScope, AgentTurnRecord } from "../shared/agentRuntimeTypes";
import { AgentEventStore } from "./agentEventStore";

export interface AgentTurnTarget {
  requestId: string;
  scope: AgentThreadScope;
  legacyThreadId: string;
  projectId?: string | null;
  caseId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  userContent: string;
}

export interface AgentTurnExecutionContext {
  signal: AbortSignal;
  turn: AgentTurnRecord;
  emitDelta: (delta: string, providerName: string, modelId: string) => void;
  emitItem: (type: AgentItemType, payload: Record<string, unknown>, idempotencyKey?: string) => Promise<void>;
}

export interface AgentTurnExecutionResult<T> {
  value: T;
  assistantContent: string;
  providerName?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  terminalStatus?: "completed" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
  committed?: boolean;
}

export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;

interface ActiveRun {
  threadId: string;
  turnId: string;
  requestId: string;
  controller: AbortController;
}

const MAX_EVENT_TEXT_CHARS = 12_000;

export class AgentRuntime {
  private readonly eventStore: AgentEventStore;
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(workspaceRoot: string, private readonly onEvent?: AgentRuntimeEventListener) {
    this.eventStore = new AgentEventStore(workspaceRoot);
  }

  async initialize() {
    return this.eventStore.initialize();
  }

  getHealth() {
    return this.eventStore.getHealth();
  }

  async runTurn<T>(target: AgentTurnTarget, execute: (context: AgentTurnExecutionContext) => Promise<AgentTurnExecutionResult<T>>): Promise<T> {
    const thread = await this.eventStore.ensureThread({
      legacyThreadId: target.legacyThreadId,
      scope: target.scope,
      projectId: target.scope === "work" ? target.projectId ?? null : null,
      caseId: target.scope === "work" ? target.caseId ?? null : null
    });
    const turn = await this.eventStore.startTurn({
      threadId: thread.id,
      requestId: target.requestId,
      providerId: target.providerId,
      modelId: target.modelId
    });
    const controller = new AbortController();
    this.activeRuns.set(target.requestId, { threadId: thread.id, turnId: turn.id, requestId: target.requestId, controller });

    let deltaIndex = 0;
    let itemIndex = 0;
    let writeChain = Promise.resolve();
    let streamedContent = "";
    let pendingDelta: { content: string; providerName: string; modelId: string } | null = null;
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;
    const durabilityTimer = setInterval(() => {
      void this.eventStore.flush().catch(() => undefined);
    }, 1_000);
    const flushPendingDelta = () => {
      if (deltaTimer) clearTimeout(deltaTimer);
      deltaTimer = null;
      const batch = pendingDelta;
      pendingDelta = null;
      if (!batch || controller.signal.aborted) return;
      deltaIndex += 1;
      const index = deltaIndex;
      writeChain = writeChain.then(async () => {
        if (controller.signal.aborted) return;
        await this.appendAndEmit(target, turn, "assistant-delta", {
          delta: batch.content,
          providerName: batch.providerName,
          modelId: batch.modelId
        }, `${turn.id}:delta:${index}`, true);
      });
    };
    const emitDelta = (delta: string, providerName: string, modelId: string) => {
      if (!delta || controller.signal.aborted) return;
      streamedContent += delta;
      if (pendingDelta && (pendingDelta.providerName !== providerName || pendingDelta.modelId !== modelId)) flushPendingDelta();
      pendingDelta = pendingDelta
        ? { ...pendingDelta, content: pendingDelta.content + delta }
        : { content: delta, providerName, modelId };
      if (pendingDelta.content.length >= 2_048) {
        flushPendingDelta();
      } else if (!deltaTimer) {
        deltaTimer = setTimeout(flushPendingDelta, 50);
      }
    };
    const emitItem = (type: AgentItemType, payload: Record<string, unknown>, idempotencyKey?: string): Promise<void> => {
      itemIndex += 1;
      const key = idempotencyKey?.trim() || `${turn.id}:${type}:${itemIndex}`;
      writeChain = writeChain.then(async () => {
        if (controller.signal.aborted) return;
        await this.appendAndEmit(target, turn, type, payload, key, true);
      });
      return writeChain;
    };

    try {
      await this.appendAndEmit(target, turn, "turn-status", { status: "running" }, `${turn.id}:status:running`);
      await this.appendAndEmit(target, turn, "user-message", { content: target.userContent }, `${turn.id}:user-message`);
      const result = await execute({ signal: controller.signal, turn, emitDelta, emitItem });
      flushPendingDelta();
      await writeChain;
      if (controller.signal.aborted && result.committed !== true) throw cancelledError();
      const assistantContent = result.assistantContent || streamedContent;
      const assistantParts = assistantContent.length > MAX_EVENT_TEXT_CHARS
        ? splitEventText(assistantContent, MAX_EVENT_TEXT_CHARS)
        : [];
      for (let index = 0; index < assistantParts.length; index += 1) {
        await this.appendAndEmit(target, turn, "assistant-message-part", {
          index,
          total: assistantParts.length,
          content: assistantParts[index]
        }, `${turn.id}:assistant-message-part:${index}`, true);
      }
      await this.appendAndEmit(target, turn, "assistant-message", {
        content: assistantParts.length > 0 ? assistantParts[0] : assistantContent,
        contentLength: assistantContent.length,
        contentTruncated: assistantParts.length > 0,
        contentSha256: createHash("sha256").update(assistantContent, "utf8").digest("hex"),
        partCount: assistantParts.length,
        providerName: result.providerName ?? null,
        providerId: result.providerId ?? target.providerId ?? null,
        modelId: result.modelId ?? target.modelId ?? null
      }, `${turn.id}:assistant-message`);
      const terminalStatus = result.terminalStatus === "failed" ? "failed" : "completed";
      const errorCode = terminalStatus === "failed" ? result.errorCode?.trim() || "model-call-failed" : null;
      if (terminalStatus === "failed") {
        await this.appendAndEmit(target, turn, "error", {
          code: errorCode,
          message: result.errorMessage?.trim() || "模型调用失败，已保留本地失败说明。"
        }, `${turn.id}:error:${errorCode}`);
      }
      const persistedTurn = await this.eventStore.updateTurnStatus(turn.id, terminalStatus, errorCode);
      await this.appendAndEmit(target, turn, "turn-status", { status: persistedTurn.status }, `${turn.id}:status:${persistedTurn.status}`);
      return result.value;
    } catch (error) {
      if (!controller.signal.aborted) flushPendingDelta();
      await writeChain.catch(() => undefined);
      const cancelled = controller.signal.aborted || isCancellationError(error);
      const status = cancelled ? "cancelled" : "failed";
      const code = cancelled ? "user-cancelled" : runtimeErrorCode(error);
      const persistedTurn = await this.eventStore.updateTurnStatus(turn.id, status, code).catch(() => null);
      await this.appendAndEmit(target, turn, "error", {
        code,
        message: cancelled ? "用户已停止本次任务。" : safeRuntimeErrorMessage(error)
      }, `${turn.id}:error:${code}`).catch(() => undefined);
      const persistedStatus = persistedTurn?.status ?? status;
      await this.appendAndEmit(target, turn, "turn-status", { status: persistedStatus }, `${turn.id}:status:${persistedStatus}`).catch(() => undefined);
      throw error;
    } finally {
      if (deltaTimer) clearTimeout(deltaTimer);
      clearInterval(durabilityTimer);
      const active = this.activeRuns.get(target.requestId);
      if (active?.turnId === turn.id) this.activeRuns.delete(target.requestId);
    }
  }

  async cancelRequest(requestId: string): Promise<{ cancelled: boolean; message: string }> {
    const active = this.activeRuns.get(requestId);
    if (!active) return { cancelled: false, message: "该任务已经结束或不在当前进程中运行。" };
    active.controller.abort(cancelledError());
    return { cancelled: true, message: "正在停止本次任务，已经完成的只读结果会保留。" };
  }

  readThread(threadId: string, afterSequence = 0, limit = 500): AgentThreadSnapshot {
    return this.eventStore.readThreadSnapshot(threadId, afterSequence, limit);
  }

  getPendingInterruptedTurns(): AgentInterruptedTurnRecovery[] {
    return this.eventStore.readPendingInterruptedTurns();
  }

  acknowledgeInterruptedTurn(turnId: string, outcome: "projected" | "committed" | "unmatched"): Promise<void> {
    return this.eventStore.acknowledgeInterruptedTurn(turnId, outcome);
  }

  close(): void {
    for (const run of this.activeRuns.values()) run.controller.abort(new Error("应用正在关闭。"));
    this.activeRuns.clear();
    this.eventStore.close();
  }

  private async appendAndEmit(
    target: AgentTurnTarget,
    turn: AgentTurnRecord,
    type: Parameters<AgentEventStore["appendItem"]>[0]["type"],
    payload: Record<string, unknown>,
    idempotencyKey: string,
    deferPersist = false
  ): Promise<void> {
    const item = await this.eventStore.appendItem({ threadId: turn.threadId, turnId: turn.id, type, payload, idempotencyKey, deferPersist });
    this.onEvent?.({
      ...item,
      requestId: target.requestId,
      scope: target.scope,
      projectId: target.scope === "work" ? target.projectId ?? null : null,
      caseId: target.scope === "work" ? target.caseId ?? null : null
    });
  }
}

function cancelledError(): Error {
  const error = new Error("用户已停止本次任务。");
  error.name = "AbortError";
  return error;
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /已停止|已取消|aborted/i.test(error.message));
}

function runtimeErrorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code ?? "") : "";
  if (/^[A-Za-z0-9_.:-]{1,40}$/.test(code)) return code.toLowerCase();
  if (error instanceof Error && error.name) return error.name.replace(/[^A-Za-z0-9_.:-]/g, "-").toLowerCase().slice(0, 40);
  return "runtime-failed";
}

function safeRuntimeErrorMessage(error: unknown): string {
  const raw = error instanceof Error && error.message.trim() ? error.message : "任务执行失败。";
  return raw
    .replace(/secure-store:sec_[a-f0-9]{32}/gi, "[安全存储引用]")
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "[授权信息]")
    .replace(/sk-(?:proj-)?[a-z0-9_-]{16,}/gi, "[API Key]")
    .replace(/api[_-]?key\s*[:=]\s*[^\n\r]+/gi, "API Key=[已脱敏]")
    .slice(0, 800);
}

function splitEventText(value: string, maxChars: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + maxChars);
    if (end < value.length && end > start && /[\uD800-\uDBFF]/.test(value[end - 1])) end -= 1;
    if (end <= start) end = Math.min(value.length, start + maxChars);
    parts.push(value.slice(start, end));
    start = end;
  }
  return parts;
}
