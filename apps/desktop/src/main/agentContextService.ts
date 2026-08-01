import type {
  AssembledModelContext,
  ContextCandidateItem,
  ContextTarget,
  EphemeralPromptInstruction,
  MemoryItemRecord,
  MemoryKind,
  PromptProfileScope,
  ThreadCheckpointRecord
} from "../shared/promptMemoryTypes";
import type { ContextEngine } from "./contextEngine";
import type { PluginPackageService } from "./pluginPackageService";
import { containsSensitiveContent, estimateTokenCount } from "./promptMemoryService";
import type { SkillPackageService } from "./skillPackageService";

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768;
const MAX_ACTIVE_SKILLS_PER_TURN = 3;
const MAX_SKILL_INSTRUCTION_CHARS = 8_000;
const AUTO_CHECKPOINT_TOKEN_THRESHOLD = 12_000;
const AUTO_CHECKPOINT_MESSAGE_THRESHOLD = 32;
const RECENT_MESSAGES_AFTER_CHECKPOINT = 10;
const MAX_CONVERSATION_MESSAGES = 240;
const MAX_CONVERSATION_CHARS = 160_000;
const MAX_CHECKPOINT_LINES = MAX_CONVERSATION_MESSAGES;
const MAX_CHECKPOINT_CONTENT_CHARS = 23_000;
const MAX_CHECKPOINT_EXCERPT_CHARS = 180;
const CHECKPOINT_FORMAT_MARKER = "格式版本：3（确定性保留首尾与关键约束摘录，原始事件仍可追溯）";

export interface AgentConversationMessage {
  ref: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string | null;
}

export interface AssembledAgentTurnContext extends AssembledModelContext {
  history: AgentConversationMessage[];
  checkpointUpdated: boolean;
}

interface PromptMemoryLifecycleStore {
  getActiveThreadCheckpoint(target: ContextTarget): ThreadCheckpointRecord | null;
  saveThreadCheckpoint(input: {
    target: ContextTarget;
    content: string;
    sourceItemRefs: string[];
  }): Promise<ThreadCheckpointRecord>;
  listMemoryItems(scope: PromptProfileScope): MemoryItemRecord[];
  createMemoryCandidate(input: {
    scope: PromptProfileScope;
    kind: MemoryKind;
    topicKey?: string | null;
    content: string;
    provenance: { sourceType: "thread"; sourceRef: string; capturedAt: string };
  }): Promise<MemoryItemRecord>;
}

export interface BuildAgentTurnContextInput {
  requestId: string;
  target: ContextTarget;
  userContent: string;
  conversationMessages?: AgentConversationMessage[];
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
}

export class AgentContextService {
  constructor(
    private readonly contextEngine: ContextEngine,
    private readonly skills: SkillPackageService,
    private readonly plugins: Pick<PluginPackageService, "resolveTurnContextContributions"> | null = null,
    private readonly promptMemory: PromptMemoryLifecycleStore | null = null
  ) {}

  async build(input: BuildAgentTurnContextInput): Promise<AssembledAgentTurnContext> {
    const [skillInstructions, pluginInstructions] = await Promise.all([
      this.resolveRelevantSkills(input.userContent, input.target.projectId).catch(() => []),
      this.resolveRelevantPluginContributions(input.userContent, input.target.projectId).catch(() => [])
    ]);
    const compacted = await this.compactConversation(input.target, input.conversationMessages ?? []);
    const contextWindowTokens = normalizeContextWindowTokens(input.contextWindowTokens);
    const reservedOutputTokens = normalizeReservedOutputTokens(input.reservedOutputTokens, contextWindowTokens);
    if (reservedOutputTokens >= contextWindowTokens - 128) throw new Error("当前模型声明的上下文窗口小于实际回复预留，无法安全构建请求。请更换模型或修正模型元数据。");
    const assembled = await this.contextEngine.build({
      turnId: input.requestId,
      target: input.target,
      contextWindowTokens,
      reservedOutputTokens,
      currentTaskInstruction: {
        ref: `turn:${input.requestId}:request`,
        content: input.userContent
      },
      skillInstructions: [...skillInstructions, ...pluginInstructions],
      recentMessages: compacted.history.map((message): ContextCandidateItem => ({
        ref: message.ref,
        kind: "recent-message",
        content: `${message.role === "user" ? "用户" : "助手"}：${message.content}`,
        scope: { type: "thread", ...input.target },
        createdAt: message.createdAt ?? null
      }))
    });
    return { ...assembled, history: compacted.history, checkpointUpdated: compacted.checkpointUpdated };
  }

  async captureExplicitUserMemory(input: BuildAgentTurnContextInput): Promise<MemoryItemRecord | null> {
    if (!this.promptMemory) return null;
    const candidate = explicitMemoryCandidate(input.userContent, input.target);
    if (!candidate) return null;
    const normalizedContent = normalizeComparable(candidate.content);
    const duplicate = this.promptMemory.listMemoryItems(candidate.scope)
      .some((item) => item.status !== "rejected" && item.status !== "revoked"
        && normalizeComparable(item.content) === normalizedContent);
    if (duplicate) return null;
    return this.promptMemory.createMemoryCandidate({
      scope: candidate.scope,
      kind: candidate.kind,
      content: candidate.content,
      provenance: {
        sourceType: "thread",
        sourceRef: `thread:${input.target.threadId}:request:${input.requestId}`.slice(0, 190),
        capturedAt: new Date().toISOString()
      }
    });
  }

  private async compactConversation(
    target: ContextTarget,
    messages: AgentConversationMessage[]
  ): Promise<{ history: AgentConversationMessage[]; checkpointUpdated: boolean }> {
    const history = normalizeConversationMessages(messages);
    if (!this.promptMemory || history.length === 0) return { history, checkpointUpdated: false };

    const active = this.promptMemory.getActiveThreadCheckpoint(target);
    // Phase 56 以前的检查点可能把未实际写入摘要的中段消息标记为已覆盖。
    // 旧格式不再作为覆盖依据，下一次达到阈值时会用无损引用格式重建。
    const activeIsLossless = Boolean(active?.content.includes(CHECKPOINT_FORMAT_MARKER));
    const coveredRefs = new Set(activeIsLossless ? active?.sourceItemRefs ?? [] : []);
    const uncovered = history.filter((message) => !coveredRefs.has(message.ref));
    const estimatedTokens = estimateTokenCount(activeIsLossless ? active?.content ?? "" : "")
      + uncovered.reduce((total, message) => total + estimateTokenCount(message.content), 0);
    const checkpointBatchReady = active
      ? uncovered.length >= RECENT_MESSAGES_AFTER_CHECKPOINT * 2
      : uncovered.length > RECENT_MESSAGES_AFTER_CHECKPOINT;
    const shouldCheckpoint = checkpointBatchReady
      && (estimatedTokens >= AUTO_CHECKPOINT_TOKEN_THRESHOLD
        || uncovered.length >= AUTO_CHECKPOINT_MESSAGE_THRESHOLD);
    if (!shouldCheckpoint) return { history: uncovered, checkpointUpdated: false };

    const checkpointMessages = uncovered.slice(0, -RECENT_MESSAGES_AFTER_CHECKPOINT);
    if (checkpointMessages.length === 0) return { history: uncovered, checkpointUpdated: false };
    const checkpoint = buildDeterministicCheckpoint(activeIsLossless ? active : null, checkpointMessages);
    if (checkpoint.sourceItemRefs.length === (activeIsLossless ? active?.sourceItemRefs.length ?? 0 : 0)) return { history: uncovered, checkpointUpdated: false };
    try {
      await this.promptMemory.saveThreadCheckpoint({ target, content: checkpoint.content, sourceItemRefs: checkpoint.sourceItemRefs });
      const covered = new Set(checkpoint.sourceItemRefs);
      return {
        history: history.filter((message) => !covered.has(message.ref)),
        checkpointUpdated: true
      };
    } catch {
      // Checkpointing is an optimization. A malformed or sensitive old message must not block the current turn.
      return { history: uncovered, checkpointUpdated: false };
    }
  }

  private async resolveRelevantPluginContributions(
    userContent: string,
    projectId: string | null
  ): Promise<EphemeralPromptInstruction[]> {
    if (!this.plugins) return [];
    const contributions = await this.plugins.resolveTurnContextContributions(userContent, projectId);
    return contributions.map((contribution) => ({ ref: contribution.ref, content: contribution.content }));
  }

  private async resolveRelevantSkills(userContent: string, projectId: string | null): Promise<EphemeralPromptInstruction[]> {
    const normalizedInput = userContent.toLocaleLowerCase("zh-CN");
    const catalog = await this.skills.getCatalog(projectId);
    const ranked = catalog
      .map((entry) => ({ entry, score: skillRelevanceScore(normalizedInput, entry.name, entry.description) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
      .slice(0, MAX_ACTIVE_SKILLS_PER_TURN);

    const instructions: EphemeralPromptInstruction[] = [];
    for (const { entry } of ranked) {
      try {
        const activated = await this.skills.activateSkill(entry.name, projectId);
        instructions.push({
          ref: `skill:${activated.id}:${activated.sha256}`,
          content: activated.instructions.slice(0, MAX_SKILL_INSTRUCTION_CHARS)
        });
      } catch {
        // A damaged optional Skill must not block the core Chat or Work request.
      }
    }
    return instructions;
  }
}

function normalizeContextWindowTokens(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 256 && (value ?? 0) <= 4_000_000
    ? value as number
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

function normalizeReservedOutputTokens(value: number | undefined, contextWindowTokens: number | undefined): number {
  void contextWindowTokens;
  if (!Number.isSafeInteger(value) || (value ?? 0) < 64) return 1_200;
  return Math.min(value as number, 4_096);
}

function normalizeConversationMessages(messages: AgentConversationMessage[]): AgentConversationMessage[] {
  const selected: AgentConversationMessage[] = [];
  let totalChars = 0;
  for (const message of [...messages].reverse()) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const ref = typeof message.ref === "string" ? message.ref.trim() : "";
    const content = typeof message.content === "string"
      ? message.content.replace(/\u0000/g, "").trim().slice(0, 12_000)
      : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(ref) || !content || containsSensitiveContent(content)) continue;
    if (selected.length >= MAX_CONVERSATION_MESSAGES || totalChars + content.length > MAX_CONVERSATION_CHARS) continue;
    selected.unshift({ ref, role: message.role, content, createdAt: message.createdAt ?? null });
    totalChars += content.length;
  }
  return selected;
}

function buildDeterministicCheckpoint(
  active: ThreadCheckpointRecord | null,
  messages: AgentConversationMessage[]
): { content: string; sourceItemRefs: string[] } {
  const previousLines = active?.content.split("\n").filter((line) => /^- \[(用户|助手)\]/.test(line)) ?? [];
  const previousRefs = active?.sourceItemRefs ?? [];
  const pairs = previousLines.slice(-previousRefs.length).map((line, index) => ({ ref: previousRefs[index], line }));
  for (const message of messages) {
    const role = message.role === "user" ? "用户" : "助手";
    const line = `- [${role}] ${JSON.stringify(checkpointExcerpt(message.content))}`;
    if (line.length <= MAX_CHECKPOINT_CONTENT_CHARS / 2) pairs.push({ ref: message.ref, line });
  }
  const uniquePairs = pairs.filter((pair, index, all) => all.findIndex((candidate) => candidate.ref === pair.ref) === index).slice(-MAX_CHECKPOINT_LINES);
  while (uniquePairs.reduce((total, pair) => total + pair.line.length + 1, 0) > MAX_CHECKPOINT_CONTENT_CHARS && uniquePairs.length > 0) uniquePairs.shift();
  const sourceItemRefs = uniquePairs.map((pair) => pair.ref);
  const content = [
    "# 会话检查点",
    "",
    "此内容由本地程序按时间顺序提取首尾和关键约束，不是模型推断，也不是已确认的长期记忆；原始消息仍保存在事件与会话记录中。",
    CHECKPOINT_FORMAT_MARKER,
    `已覆盖 ${sourceItemRefs.length} 条历史消息；每条保留确定性摘录。`,
    "",
    ...uniquePairs.map((pair) => pair.line)
  ].join("\n");
  return { content, sourceItemRefs: uniqueRefs(sourceItemRefs) };
}

function checkpointExcerpt(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_CHECKPOINT_EXCERPT_CHARS) return normalized;
  const keySegments = normalized
    .split(/(?<=[。！？.!?；;])\s*/u)
    .filter((segment) => /必须|不得|只读|约束|目标|待办|决定|结论|风险|确认|生产|客户|SID|Client|工厂|公司|系统/i.test(segment))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 90);
  const head = normalized.slice(0, keySegments ? 50 : 90);
  const tail = normalized.slice(-(keySegments ? 36 : 72));
  return `${head} … ${keySegments ? `${keySegments} … ` : ""}${tail}`.slice(0, MAX_CHECKPOINT_EXCERPT_CHARS);
}

function explicitMemoryCandidate(
  rawContent: string,
  target: ContextTarget
): { scope: PromptProfileScope; kind: MemoryKind; content: string } | null {
  const content = rawContent.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, 1_200);
  if (!content || containsSensitiveContent(content)) return null;
  const hasDurableIntent = /请记住|以后(?:都|请|默认)|从现在开始|长期(?:保持|使用|遵循)|默认情况下|本项目约定|本案件约定|本任务约定/.test(content);
  if (!hasDurableIntent) return null;

  if (!target.projectId) return { scope: { type: "personal" }, kind: "preference", content };
  const scope: PromptProfileScope = /本项目约定|项目中|该项目/.test(content)
    ? { type: "project", projectId: target.projectId }
    : target.caseId
      ? { type: "case", projectId: target.projectId, caseId: target.caseId }
      : { type: "project", projectId: target.projectId };
  const kind: MemoryKind = /不要|禁止|必须|不得|只读/.test(content)
    ? "constraint"
    : /决定|确定采用|统一采用/.test(content)
      ? "decision"
      : /偏好|默认|以后|长期/.test(content)
        ? "preference"
        : "fact";
  return { scope, kind, content };
}

function uniqueRefs(refs: string[]): string[] {
  return [...new Set(refs.filter((ref) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(ref)))];
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

function skillRelevanceScore(input: string, name: string, description: string): number {
  const normalizedName = name.toLocaleLowerCase("zh-CN");
  if (input.includes(`@${normalizedName}`) || input.includes(`/${normalizedName}`)) return 1_000;

  let score = input.includes(normalizedName) ? 200 : 0;
  const terms = `${name} ${description}`
    .toLocaleLowerCase("zh-CN")
    .split(/[\s,，。;；:：/\\|()（）\[\]{}<>《》_+-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 32);
  for (const term of new Set(terms)) {
    if (input.includes(term)) score += Math.min(20, term.length * 2);
  }
  return score;
}
