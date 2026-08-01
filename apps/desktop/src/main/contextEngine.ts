import { randomUUID } from "node:crypto";
import type {
  AssembledModelContext,
  BuildContextInput,
  ContextAuditExclusion,
  ContextAuditRecord,
  ContextAuditSelection,
  ContextBudgetReport,
  ContextCandidateItem,
  ContextExclusionReason,
  ContextItemKind,
  ContextItemScope,
  ContextTarget,
  MemoryItemRecord,
  PromptLayerName,
  SelectedContextItem
} from "../shared/promptMemoryTypes";
import { containsSensitiveContent, estimateTokenCount, PromptMemoryService } from "./promptMemoryService";

export const CONTEXT_WARNING_RATIO = 0.75 as const;
export const CONTEXT_HARD_RATIO = 0.88 as const;
const MAX_MEMORIES_PER_TURN = 12;

type ContextBudgetLevel = "within-budget" | "checkpoint-recommended" | "compaction-required";

interface InternalContextItem extends SelectedContextItem {
  priority: number;
  order: number;
}

export class ContextEngine {
  constructor(private readonly promptMemory: PromptMemoryService) {}

  async build(input: BuildContextInput): Promise<AssembledModelContext> {
    const turnId = safeRef(input.turnId, "Turn ID");
    const target = normalizeTarget(input.target);
    const contextWindowTokens = safePositiveInteger(input.contextWindowTokens, "模型上下文窗口");
    if (contextWindowTokens < 256) throw new Error("模型上下文窗口过小，至少需要 256 tokens。");
    const reservedOutputTokens = input.reservedOutputTokens === undefined
      ? Math.max(64, Math.min(4_096, Math.floor(contextWindowTokens * 0.12)))
      : safeNonNegativeInteger(input.reservedOutputTokens, "输出 token 预留");
    if (reservedOutputTokens >= Math.floor(contextWindowTokens * CONTEXT_HARD_RATIO)) {
      throw new Error("输出 token 预留过大，已超过 88% 上下文硬预算。");
    }
    const asOf = normalizeIso(input.now ?? new Date().toISOString(), "上下文时间");
    const prompt = this.promptMemory.compilePrompt({
      target,
      currentTaskInstruction: input.currentTaskInstruction,
      skillInstructions: input.skillInstructions
    });

    const selectedAudit: ContextAuditSelection[] = prompt.layers
      .filter((layer) => layer.included)
      .map((layer) => ({ ref: layer.ref, kind: layer.layer, estimatedTokens: layer.tokenEstimate }));
    const excludedAudit: ContextAuditExclusion[] = [];
    const candidates: InternalContextItem[] = [];
    let order = 0;

    const resolvedMemories = this.promptMemory.resolveMemoriesForTarget(target, asOf);
    const memoryById = this.memoryRecordsForTarget(target);
    for (const excluded of resolvedMemories.excluded) {
      const record = memoryById.get(excluded.memoryId);
      excludedAudit.push({
        ref: `memory:${excluded.memoryId}`,
        kind: record ? memoryContextKind(record) : "project-memory",
        reason: excluded.reason,
        estimatedTokens: record ? estimateTokenCount(record.content) : 0
      });
    }

    for (const message of input.recentMessages ?? []) {
      const recency = order;
      this.addExternalCandidate(message, target, 100 + recency, order++, candidates, excludedAudit);
    }

    const checkpoint = this.promptMemory.getActiveThreadCheckpoint(target);
    if (checkpoint) {
      candidates.push({
        ref: `checkpoint:${checkpoint.id}:v${checkpoint.version}`,
        kind: "thread-checkpoint",
        content: checkpoint.content,
        estimatedTokens: estimateTokenCount(checkpoint.content),
        priority: 90,
        order: order++
      });
    }

    const relevantMemories = selectRelevantMemories(
      resolvedMemories.included,
      input.currentTaskInstruction?.content ?? "",
      MAX_MEMORIES_PER_TURN
    );
    for (const excluded of relevantMemories.excluded) {
      excludedAudit.push({
        ref: `memory:${excluded.memory.id}`,
        kind: memoryContextKind(excluded.memory),
        reason: excluded.reason,
        estimatedTokens: estimateTokenCount(excluded.memory.content)
      });
    }
    for (const memory of relevantMemories.included) {
      candidates.push({
        ref: `memory:${memory.id}`,
        kind: memoryContextKind(memory),
        content: memory.content,
        estimatedTokens: estimateTokenCount(memory.content),
        priority: memoryPriority(memory),
        order: order++
      });
    }

    for (const evidence of input.evidence ?? []) {
      this.addExternalCandidate(evidence, target, evidencePriority(evidence), order++, candidates, excludedAudit);
    }

    const uniqueCandidates = removeDuplicateContent(candidates, excludedAudit);
    const instructionTokens = prompt.tokenEstimate;
    const initialInputTokens = instructionTokens + uniqueCandidates.reduce((sum, item) => sum + item.estimatedTokens, 0);
    const hardInputLimit = Math.floor(contextWindowTokens * CONTEXT_HARD_RATIO) - reservedOutputTokens;
    if (instructionTokens > hardInputLimit) {
      throw new Error("不可变安全提示词与产品基础提示词已超过当前模型的 88% 上下文硬预算，请选择更大上下文窗口的模型。");
    }

    const initialLevel = getContextBudgetLevel(initialInputTokens, contextWindowTokens, reservedOutputTokens);
    const selectedItems = initialLevel === "compaction-required"
      ? selectWithinBudget(uniqueCandidates, hardInputLimit - instructionTokens, excludedAudit)
      : uniqueCandidates;
    selectedItems.sort((left, right) => left.order - right.order);
    const selectedInputTokens = instructionTokens + selectedItems.reduce((sum, item) => sum + item.estimatedTokens, 0);
    const compactionApplied = excludedAudit.some((item) => item.reason === "budget-trimmed");
    const budget = makeBudgetReport({
      contextWindowTokens,
      reservedOutputTokens,
      initialInputTokens,
      selectedInputTokens,
      compactionApplied
    });

    selectedAudit.push(...selectedItems.map((item) => ({
      ref: item.ref,
      kind: item.kind,
      estimatedTokens: item.estimatedTokens
    })));

    const audit: ContextAuditRecord = {
      id: `context-audit-${randomUUID()}`,
      turnId,
      target,
      selected: selectedAudit,
      excluded: excludedAudit,
      promptConflictRefs: prompt.conflicts.map((conflict) => conflict.ref),
      budget,
      createdAt: new Date().toISOString()
    };
    const persistedAudit = await this.promptMemory.recordContextAudit(audit);
    return {
      instructions: prompt.systemPrompt,
      prompt,
      items: selectedItems.map(({ ref, kind, content, estimatedTokens }) => ({ ref, kind, content, estimatedTokens })),
      budget,
      audit: persistedAudit
    };
  }

  private addExternalCandidate(
    input: ContextCandidateItem,
    target: ContextTarget,
    defaultPriority: number,
    order: number,
    candidates: InternalContextItem[],
    excluded: ContextAuditExclusion[]
  ): void {
    if (!input || typeof input !== "object") throw new Error("上下文材料无效。");
    const ref = safeRef(input.ref, "上下文材料引用");
    const kind = safeExternalKind(input.kind);
    const content = safeExternalContent(input.content);
    const estimatedTokens = estimateTokenCount(content);
    const scopeReason = scopeExclusionReason(input.scope, target);
    if (scopeReason) {
      excluded.push({ ref, kind, reason: scopeReason, estimatedTokens });
      return;
    }
    if (containsSensitiveContent(content)) {
      excluded.push({ ref, kind, reason: "sensitive-content", estimatedTokens });
      return;
    }
    const priority = input.priority === undefined
      ? defaultPriority
      : Math.max(0, Math.min(1_000, safeNonNegativeInteger(input.priority, "上下文优先级")));
    candidates.push({ ref, kind, content, estimatedTokens, priority, order });
  }

  private memoryRecordsForTarget(target: ContextTarget): Map<string, MemoryItemRecord> {
    const records: MemoryItemRecord[] = [...this.promptMemory.listMemoryItems({ type: "personal" })];
    if (target.projectId) records.push(...this.promptMemory.listMemoryItems({ type: "project", projectId: target.projectId }));
    if (target.projectId && target.caseId) {
      records.push(...this.promptMemory.listMemoryItems({ type: "case", projectId: target.projectId, caseId: target.caseId }));
    }
    return new Map(records.map((record) => [record.id, record]));
  }
}

export function getContextBudgetLevel(
  inputTokens: number,
  contextWindowTokens: number,
  reservedOutputTokens = 0
): ContextBudgetLevel {
  const input = safeNonNegativeInteger(inputTokens, "输入 token 估算");
  const window = safePositiveInteger(contextWindowTokens, "模型上下文窗口");
  const reserved = safeNonNegativeInteger(reservedOutputTokens, "输出 token 预留");
  const ratio = (input + reserved) / window;
  if (ratio >= CONTEXT_HARD_RATIO) return "compaction-required";
  if (ratio >= CONTEXT_WARNING_RATIO) return "checkpoint-recommended";
  return "within-budget";
}

function makeBudgetReport(input: {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  initialInputTokens: number;
  selectedInputTokens: number;
  compactionApplied: boolean;
}): ContextBudgetReport {
  const initialUsageRatio = (input.initialInputTokens + input.reservedOutputTokens) / input.contextWindowTokens;
  const selectedUsageRatio = (input.selectedInputTokens + input.reservedOutputTokens) / input.contextWindowTokens;
  const checkpointRecommended = initialUsageRatio >= CONTEXT_WARNING_RATIO;
  return {
    contextWindowTokens: input.contextWindowTokens,
    reservedOutputTokens: input.reservedOutputTokens,
    initialInputTokens: input.initialInputTokens,
    selectedInputTokens: input.selectedInputTokens,
    initialUsageRatio: Number(initialUsageRatio.toFixed(6)),
    selectedUsageRatio: Number(selectedUsageRatio.toFixed(6)),
    warningThreshold: CONTEXT_WARNING_RATIO,
    hardThreshold: CONTEXT_HARD_RATIO,
    checkpointRecommended,
    compactionApplied: input.compactionApplied,
    status: input.compactionApplied ? "compacted" : checkpointRecommended ? "checkpoint-recommended" : "within-budget"
  };
}

function selectWithinBudget(
  candidates: InternalContextItem[],
  availableTokens: number,
  excluded: ContextAuditExclusion[]
): InternalContextItem[] {
  const selected: InternalContextItem[] = [];
  let used = 0;
  const ranked = [...candidates].sort((left, right) =>
    right.priority - left.priority || right.order - left.order || left.ref.localeCompare(right.ref));
  for (const candidate of ranked) {
    if (used + candidate.estimatedTokens <= Math.max(0, availableTokens)) {
      selected.push(candidate);
      used += candidate.estimatedTokens;
    } else {
      excluded.push({
        ref: candidate.ref,
        kind: candidate.kind,
        reason: "budget-trimmed",
        estimatedTokens: candidate.estimatedTokens
      });
    }
  }
  return selected;
}

function removeDuplicateContent(
  candidates: InternalContextItem[],
  excluded: ContextAuditExclusion[]
): InternalContextItem[] {
  const ranked = [...candidates].sort((left, right) =>
    right.priority - left.priority || right.order - left.order || left.ref.localeCompare(right.ref));
  const fingerprints = new Set<string>();
  const selected: InternalContextItem[] = [];
  for (const candidate of ranked) {
    const fingerprint = normalizeComparable(candidate.content);
    if (fingerprints.has(fingerprint)) {
      excluded.push({
        ref: candidate.ref,
        kind: candidate.kind,
        reason: "duplicate-content",
        estimatedTokens: candidate.estimatedTokens
      });
      continue;
    }
    fingerprints.add(fingerprint);
    selected.push(candidate);
  }
  return selected.sort((left, right) => left.order - right.order);
}

function memoryContextKind(memory: MemoryItemRecord): ContextItemKind {
  if (memory.scope.type === "personal") return "personal-memory";
  if (memory.scope.type === "project") return "project-memory";
  return "case-memory";
}

function selectRelevantMemories(
  memories: MemoryItemRecord[],
  query: string,
  topK: number
): {
  included: MemoryItemRecord[];
  excluded: Array<{ memory: MemoryItemRecord; reason: "memory-not-relevant" | "memory-top-k" }>;
} {
  const terms = tokenizeForRelevance(query);
  const constraints = memories.filter((memory) => memory.kind === "constraint");
  const ranked = memories.filter((memory) => memory.kind !== "constraint").map((memory) => {
    const haystack = `${memory.topicKey ?? ""} ${memory.content}`.normalize("NFKC").toLocaleLowerCase("zh-CN");
    const lexicalScore = terms.reduce(
      (score, term) => score + (haystack.includes(term) ? Math.min(30, term.length * 4) : 0),
      0
    );
    const scopeScore = memory.scope.type === "case" ? 30 : memory.scope.type === "project" ? 20 : 10;
    const kindScore = memory.kind === "preference" ? 35 : memory.kind === "decision" ? 25 : 0;
    return { memory, lexicalScore, score: lexicalScore + scopeScore + kindScore };
  });
  const relevant = terms.length === 0
    ? ranked
    : ranked.filter((entry) =>
      entry.lexicalScore > 0
      || entry.memory.kind === "constraint"
      || entry.memory.kind === "preference"
      || entry.memory.scope.type === "case"
    );
  relevant.sort((left, right) =>
    right.score - left.score
    || right.memory.updatedAt.localeCompare(left.memory.updatedAt)
    || left.memory.id.localeCompare(right.memory.id)
  );
  // User-confirmed constraints are hard working boundaries. They remain candidates
  // regardless of the ordinary relevance Top-K and can only be excluded by the
  // explicit context budget audit later in the pipeline.
  const includedIds = new Set([
    ...constraints.map((memory) => memory.id),
    ...relevant.slice(0, topK).map((entry) => entry.memory.id)
  ]);
  return {
    included: memories.filter((memory) => includedIds.has(memory.id)),
    excluded: memories
      .filter((memory) => !includedIds.has(memory.id))
      .map((memory) => ({
        memory,
        reason: relevant.some((entry) => entry.memory.id === memory.id) ? "memory-top-k" as const : "memory-not-relevant" as const
      }))
  };
}

function tokenizeForRelevance(value: string): string[] {
  return [...new Set(value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 32))];
}

function memoryPriority(memory: MemoryItemRecord): number {
  if (memory.scope.type === "case") return 80;
  if (memory.scope.type === "project") return 70;
  return 60;
}

function evidencePriority(item: ContextCandidateItem): number {
  if (item.kind === "sap-evidence") return 68;
  if (item.kind === "published-knowledge") return 64;
  if (item.kind === "tool-result") return 40;
  return 55;
}

function safeExternalKind(value: ContextCandidateItem["kind"]): ContextCandidateItem["kind"] {
  const allowed: ContextCandidateItem["kind"][] = [
    "recent-message", "published-knowledge", "sap-evidence", "tool-result"
  ];
  if (!allowed.includes(value)) throw new Error("上下文材料类型无效。");
  return value;
}

function safeExternalContent(value: unknown): string {
  if (typeof value !== "string") throw new Error("上下文材料正文无效。");
  const normalized = value.replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("上下文材料正文不能为空。");
  if (normalized.length > 200_000) throw new Error("单条上下文材料超过 200000 个字符的安全上限。");
  return normalized;
}

function scopeExclusionReason(scope: ContextItemScope, target: ContextTarget): ContextExclusionReason | null {
  if (!scope || typeof scope !== "object") throw new Error("上下文材料范围无效。");
  if (scope.type === "global") return null;
  if (scope.type === "project") {
    const projectId = safeRef(scope.projectId, "上下文 Project ID");
    return projectId === target.projectId ? null : "cross-project";
  }
  if (scope.type === "case") {
    const projectId = safeRef(scope.projectId, "上下文 Project ID");
    const caseId = safeRef(scope.caseId, "上下文 Case ID");
    if (projectId !== target.projectId) return "cross-project";
    return caseId === target.caseId ? null : "cross-case";
  }
  if (scope.type === "thread") {
    const threadId = safeRef(scope.threadId, "上下文 Thread ID");
    const projectId = scope.projectId === null ? null : safeRef(scope.projectId, "上下文 Project ID");
    const caseId = scope.caseId === null ? null : safeRef(scope.caseId, "上下文 Case ID");
    if (caseId && !projectId) throw new Error("上下文 Case 必须归属于一个 Project。");
    if (projectId !== target.projectId) return "cross-project";
    if (caseId !== target.caseId) return "cross-case";
    return threadId === target.threadId ? null : "cross-thread";
  }
  throw new Error("上下文材料范围无效。");
}

function normalizeTarget(target: ContextTarget): ContextTarget {
  if (!target || typeof target !== "object") throw new Error("上下文目标无效。");
  const threadId = safeRef(target.threadId, "Thread ID");
  const projectId = target.projectId === null ? null : safeRef(target.projectId, "Project ID");
  const caseId = target.caseId === null ? null : safeRef(target.caseId, "Case ID");
  if (caseId && !projectId) throw new Error("Case 必须明确归属于一个 Project。");
  return { threadId, projectId, caseId };
}

function safeRef(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}无效。`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(normalized)) throw new Error(`${label}格式无效。`);
  return normalized;
}

function normalizeIso(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${label}无效。`);
  return new Date(value).toISOString();
}

function safePositiveInteger(value: unknown, label: string): number {
  const result = safeNonNegativeInteger(value, label);
  if (result < 1) throw new Error(`${label}必须大于 0。`);
  return result;
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}无效。`);
  return value;
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}
