import type {
  ApiProviderConfig,
  ModelCapability,
  ModelProviderRedactedInfo,
  ModelProviderVerificationError,
  ModelProviderVerificationErrorCode,
  ModelProviderVerificationReport,
  ModelProviderVerificationStep,
  ModelSummary
} from "../shared/workbenchTypes";
import type { ToolJsonObject } from "../shared/toolRuntimeTypes";
import { assertSafeModelDraftResponseText, type SafeModelDraftContext } from "./safeModelCaseDraftService";
import {
  secureModelJsonRequest,
  secureModelStreamRequest,
  type SecureModelJsonRequester,
  type SecureModelStreamRequester
} from "./modelEndpointSecurity";
import type { AgentModelToolCall, AgentModelToolResult, AgentToolSession } from "./agentToolService";

export interface ModelProviderConnectorInput {
  id: string;
  name: string;
  providerType: ApiProviderConfig["providerType"];
  baseUrl: string;
  apiKey: string;
  catalogMode?: NonNullable<ApiProviderConfig["catalogMode"]>;
  testModelId?: string;
  manualModelIds?: string[];
}

export interface SafeModelDraftConnectorInput extends ModelProviderConnectorInput {
  modelId: string;
  context: SafeModelDraftContext;
  onDelta?: (delta: string) => void;
  toolSession?: AgentToolSession;
  onToolEvent?: (event: ModelToolLoopEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export type ModelToolLoopEvent =
  | { type: "tool-call"; call: AgentModelToolCall }
  | { type: "tool-decision"; callId: string; toolName: string; outcome: "allowed" | "denied"; message: string }
  | { type: "tool-result"; result: AgentModelToolResult };

export interface DailyChatConnectorInput extends ModelProviderConnectorInput {
  modelId: string;
  content: string;
  systemInstructions?: string;
  confirmedContext?: string[];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface SafeModelDraftConnectorResult {
  provider: ModelProviderRedactedInfo;
  modelId: string;
  content: string;
  generatedAt: string;
}

export interface DailyChatConnectorResult {
  provider: ModelProviderRedactedInfo;
  modelId: string;
  content: string;
  generatedAt: string;
}

export interface ModelProviderConnector {
  verify(input: ModelProviderConnectorInput): Promise<ModelProviderVerificationReport>;
  generateSafeDraft(input: SafeModelDraftConnectorInput): Promise<SafeModelDraftConnectorResult>;
  generateDailyChat(input: DailyChatConnectorInput): Promise<DailyChatConnectorResult>;
}

interface OpenAiModelListResponse {
  data?: Array<{
    id?: unknown;
    object?: unknown;
    context_length?: unknown;
    context_window?: unknown;
    max_model_len?: unknown;
    max_context_length?: unknown;
    max_output_tokens?: unknown;
    max_completion_tokens?: unknown;
  }>;
  has_more?: unknown;
  last_id?: unknown;
}

const MAX_MODEL_CATALOG_ITEMS = 50_000;
const MAX_MODEL_CATALOG_PAGES = 100;

interface ChatCompletionResponse {
  id?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown;
    };
    text?: unknown;
  }>;
}

interface OpenAiStreamPayload {
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: Array<{
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
    text?: unknown;
  }>;
}

interface AnthropicStreamPayload {
  type?: unknown;
  index?: unknown;
  delta?: { type?: unknown; text?: unknown; partial_json?: unknown };
  content_block?: { type?: unknown; id?: unknown; name?: unknown; input?: unknown; text?: unknown };
}

interface AnthropicMessageResponse {
  content?: Array<{ type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }>;
}

interface ToolAwareRound {
  content: string;
  calls: AgentModelToolCall[];
  assistantMessage: Record<string, unknown>;
}

type ChatMessagePayload = { role: "system" | "user" | "assistant"; content: string };
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CALLS_PER_ROUND = 8;
const STREAM_RETRY_DELAYS_MS = [800, 2_500, 6_000] as const;
// Validate every accumulated prefix before emitting its newest delta.
const SAFE_DRAFT_STREAM_HOLD_CHARS = 0;

function isTransientStreamFailure(caught: unknown): boolean {
  const message = caught instanceof Error ? `${caught.name} ${caught.message}` : String(caught);
  return /(ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|连接重置|网络连接失败|请求超时|HTTP\s+(408|425|429|500|502|503|504)\b)/i.test(message);
}

async function waitForStreamRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("请求已取消。", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function endpointHost(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "模型服务地址格式不可读取";
  }
}

function reportProvider(input: Omit<ModelProviderConnectorInput, "apiKey">): ModelProviderRedactedInfo {
  return {
    id: input.id,
    name: input.name,
    providerType: input.providerType,
    endpointHost: endpointHost(input.baseUrl)
  };
}

function error(code: ModelProviderVerificationErrorCode, message: string, suggestion: string): ModelProviderVerificationError {
  return { code, message, suggestion };
}

function step(id: ModelProviderVerificationStep["id"], title: string, status: ModelProviderVerificationStep["status"], detail: string, checkedAt: string): ModelProviderVerificationStep {
  return { id, title, status, detail, checkedAt };
}

function inferCapabilities(modelId: string): ModelCapability[] {
  const lower = modelId.toLowerCase();
  const nonChatPattern = /(embedding|embed|rerank|moderation|image|imagine|video|sora|nano-banana|tts|speech|audio|whisper)/i;
  const capabilities = new Set<ModelCapability>(nonChatPattern.test(lower) ? [] : ["chat"]);
  if (lower.includes("vision") || lower.includes("vl") || lower.includes("image") || lower.includes("omni")) capabilities.add("vision");
  if (lower.includes("reason") || lower.includes("r1") || lower.includes("o1") || lower.includes("o3") || lower.includes("thinking")) capabilities.add("reasoning");
  if (lower.includes("tool") || lower.includes("function")) capabilities.add("tools");
  if (lower.includes("web") || lower.includes("search")) capabilities.add("web");
  if (lower.includes("free")) capabilities.add("free");
  return Array.from(capabilities);
}

function safeTokenLimit(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (Number.isSafeInteger(parsed) && parsed >= 256 && parsed <= 4_000_000) return parsed;
  }
  return undefined;
}

function modelSummary(modelId: string, checkedAt: string, metadata?: OpenAiModelListResponse["data"] extends Array<infer Item> | undefined ? Item : never): ModelSummary {
  const contextWindowTokens = metadata
    ? safeTokenLimit(metadata.context_length, metadata.context_window, metadata.max_model_len, metadata.max_context_length)
    : undefined;
  const maxOutputTokens = metadata
    ? safeTokenLimit(metadata.max_output_tokens, metadata.max_completion_tokens)
    : undefined;
  return {
    id: modelId,
    displayName: modelId,
    capabilities: inferCapabilities(modelId),
    lastSeenAt: checkedAt,
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {})
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function endpoint(baseUrl: string, suffix: string): string {
  return `${normalizeBaseUrl(baseUrl)}${suffix}`;
}

function isFakeProvider(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api-demo.example.com" || host === "fake-models.local" || host === "fake-models.test";
  } catch {
    return false;
  }
}

function safeModelId(value: string): string | null {
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(trimmed)) return null;
  if (/bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9_-]{16,}|api[_-]?key/i.test(trimmed)) return null;
  return trimmed;
}

function chooseTestModel(models: ModelSummary[], preferredModelId = ""): string | null {
  const preferred = safeModelId(preferredModelId);
  if (preferred && models.some((model) => model.id === preferred)) return preferred;
  const nonChatPattern = /(embedding|embed|rerank|moderation|image|imagine|video|sora|nano-banana|vision-only|tts|speech|audio|whisper)/i;
  const likelyChatPattern = /(chat|instruct|gpt|deepseek|claude|gemini|qwen|glm|llama|mistral|command)/i;
  return models.find((model) => likelyChatPattern.test(model.id) && !nonChatPattern.test(model.id))?.id
    ?? models.find((model) => !nonChatPattern.test(model.id))?.id
    ?? models[0]?.id
    ?? null;
}

function manualModelIds(input: ModelProviderConnectorInput): string[] {
  const configured = [...(input.manualModelIds ?? []), input.testModelId ?? ""]
    .map((item) => safeModelId(item))
    .filter((item): item is string => item !== null);
  return Array.from(new Set(configured));
}

function activeCatalogMode(): NonNullable<ApiProviderConfig["catalogMode"]> {
  return "remote-with-manual-fallback";
}

function mergeModels(remoteModels: ModelSummary[], input: ModelProviderConnectorInput, checkedAt: string): ModelSummary[] {
  const merged = new Map(remoteModels.map((model) => [model.id, model]));
  for (const id of manualModelIds(input)) {
    if (!merged.has(id)) merged.set(id, modelSummary(id, checkedAt));
  }
  return Array.from(merged.values());
}

function caughtMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.trim() ? caught.message : fallback;
}

function extractAnthropicContent(payload: AnthropicMessageResponse): string {
  const content = (payload.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
  if (content) return content;
  throw new Error("Anthropic API /messages 没有返回可保存的文本内容。");
}

function anthropicMessages(promptMessages: ChatMessagePayload[]) {
  const system = promptMessages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n").trim();
  const messages = promptMessages
    .filter((message): message is ChatMessagePayload & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
  return { ...(system ? { system } : {}), messages };
}

function connectorResult(input: SafeModelDraftConnectorInput, content: string): SafeModelDraftConnectorResult {
  return {
    provider: reportProvider(input),
    modelId: input.modelId,
    content: assertSafeModelDraftResponseText(content),
    generatedAt: nowIso()
  };
}

function assertSafeDailyChatResponseText(value: string): string {
  const normalized = value.replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("模型服务没有返回可保存的日常对话内容。");
  if (normalized.length > 6000) return `${normalized.slice(0, 6000)}\n\n[内容过长，已截断]`;
  return normalized;
}

function dailyChatResult(input: DailyChatConnectorInput, content: string): DailyChatConnectorResult {
  return {
    provider: reportProvider(input),
    modelId: input.modelId,
    content: assertSafeDailyChatResponseText(content),
    generatedAt: nowIso()
  };
}

function guardedSafeDraftDeltaHandler(onDelta: (delta: string) => void): { push: (delta: string) => void; flush: () => void } {
  let accumulated = "";
  let emittedChars = 0;
  return {
    push(delta) {
      accumulated += delta;
      assertSafeModelDraftResponseText(accumulated);
      const safeEnd = Math.max(0, accumulated.length - SAFE_DRAFT_STREAM_HOLD_CHARS);
      if (safeEnd > emittedChars) {
        onDelta(accumulated.slice(emittedChars, safeEnd));
        emittedChars = safeEnd;
      }
    },
    flush() {
      assertSafeModelDraftResponseText(accumulated);
      if (emittedChars < accumulated.length) onDelta(accumulated.slice(emittedChars));
    }
  };
}

function dailyChatMessages(input: DailyChatConnectorInput): ChatMessagePayload[] {
  const productBoundary = "日常对话不得读取或声称读取 Project、Case、本机文件、SAP 或飞书资料；只可使用当前对话和已确认的个人记忆。";
  const confirmedContext = (input.confirmedContext ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
  return [
    {
      role: "system",
      content: [
        input.systemInstructions?.trim() || "你是 SAP AI 顾问工作台的中文日常 AI 助手。回答要简洁、直接、可执行。",
        productBoundary,
        confirmedContext.length > 0 ? `以下内容是用户已确认的个人记忆，只作为背景使用：\n${confirmedContext.join("\n")}` : ""
      ].filter(Boolean).join("\n\n")
    },
    ...(input.history ?? []).map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: input.content }
  ];
}

function extractChatContent(payload: ChatCompletionResponse): string {
  const choice = payload.choices?.[0];
  const messageContent = choice?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (typeof choice?.text === "string") return choice.text;
  throw new Error("模型服务没有返回可保存的草稿内容。");
}

function extractVerifiedOpenAiChatContent(chatPayload: ChatCompletionResponse): string {
  if (!extractChatContent(chatPayload).trim()) {
    throw new Error("OpenAI API /chat/completions 没有返回文本内容。");
  }
  return extractChatContent(chatPayload);
}

function buildReport(
  mode: ModelProviderVerificationReport["mode"],
  input: Omit<ModelProviderConnectorInput, "apiKey">,
  steps: ModelProviderVerificationStep[],
  models: ModelSummary[],
  selectedModelId: string | null,
  errors: ModelProviderVerificationError[],
  checkedAt: string
): ModelProviderVerificationReport {
  const modelSyncPassed = steps.some((item) => item.id === "models" && item.status === "passed");
  const chatPassed = steps.some((item) => item.id === "chat" && item.status === "passed");
  return {
    ok: modelSyncPassed && chatPassed,
    checkedAt,
    mode,
    provider: reportProvider(input),
    steps,
    modelSyncStatus: modelSyncPassed ? "verified" : "failed",
    chatTestStatus: chatPassed ? "verified" : modelSyncPassed ? "failed" : "pending-verification",
    models,
    selectedModelId,
    errors
  };
}

export class FakeModelProviderConnector implements ModelProviderConnector {
  async verify(input: ModelProviderConnectorInput): Promise<ModelProviderVerificationReport> {
    const checkedAt = nowIso();
    const trigger = `${input.name} ${input.baseUrl}`.toLowerCase();
    const models = [
      modelSummary("demo-chat-free", checkedAt),
      modelSummary("demo-reasoning-r1", checkedAt),
      modelSummary("demo-vision-vl", checkedAt)
    ];
    const steps: ModelProviderVerificationStep[] = [];
    const errors: ModelProviderVerificationError[] = [];

    if (trigger.includes("fail-models")) {
      steps.push(step("models", "获取模型列表", "failed", "模拟模型列表获取失败。", checkedAt));
      steps.push(step("chat", "最小对话测试", "skipped", "模型列表未获取成功，未执行最小对话测试。", checkedAt));
      errors.push(error("models-failed", "无法获取模型列表。", "请检查 Base URL、API Key、网络代理或模型服务状态。"));
      return buildReport("fake", input, steps, [], null, errors, checkedAt);
    }

    steps.push(step("models", "获取模型列表", "passed", `已获取 ${models.length} 个模型摘要。`, checkedAt));
    const selectedModelId = chooseTestModel(models);

    if (trigger.includes("fail-chat")) {
      steps.push(step("chat", "最小对话测试", "failed", "模拟最小对话测试失败。", checkedAt));
      errors.push(error("chat-failed", "最小对话测试未通过。", "模型列表可用，但当前模型无法完成最小对话，请换模型或检查服务兼容性。"));
      return buildReport("fake", input, steps, models, selectedModelId, errors, checkedAt);
    }

    steps.push(step("chat", "最小对话测试", "passed", `已用 ${selectedModelId} 完成最小对话测试。`, checkedAt));
    return buildReport("fake", input, steps, models, selectedModelId, errors, checkedAt);
  }

  async generateSafeDraft(input: SafeModelDraftConnectorInput): Promise<SafeModelDraftConnectorResult> {
    if (input.modelId === "unsafe-output") {
      return connectorResult(input, "api_key = abcdefghijklmnop");
    }

    const content = [
      "已生成本地草稿：当前案件可以先按安全摘要继续推进。",
      "",
      "## 初步结论",
      "",
      "- 现有信息只能支持草稿判断，最终结论仍需用户确认。",
      "- 本次没有读取 SAP，也没有发布飞书。",
      "",
      "## 建议下一步",
      "",
      "1. 补充业务影响范围和期望结果。",
      "2. 如需真实证据，请先完成 ADT 只读验证。",
      "3. 用户确认后，再决定是否生成候选知识。"
    ].join("\n");
    return connectorResult(input, content);
  }

  async generateDailyChat(input: DailyChatConnectorInput): Promise<DailyChatConnectorResult> {
    return dailyChatResult(input, [
      "这是本地模拟的日常对话回复。当前没有读取项目、案件文件、SAP 或飞书。",
      "",
      "真实模型渠道通过 HTTP 验证后，这里会返回模型生成的日常回复。"
    ].join("\n"));
  }
}

type HttpModelProtocol = "openai" | "anthropic";

function protocolHeaders(protocol: HttpModelProtocol, apiKey: string, includeContentType = false): Record<string, string> {
  const headers: Record<string, string> = protocol === "anthropic"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01", Accept: "application/json" }
    : { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  if (includeContentType) headers["Content-Type"] = "application/json";
  return headers;
}

async function fetchRemoteModels(input: ModelProviderConnectorInput, protocol: HttpModelProtocol, checkedAt: string, requester: SecureModelJsonRequester): Promise<ModelSummary[]> {
  const models = new Map<string, ModelSummary>();
  let nextUrl = endpoint(input.baseUrl, "/models");
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_MODEL_CATALOG_PAGES; page += 1) {
    const payload = await requester(nextUrl, `${protocol === "anthropic" ? "Anthropic API" : "OpenAI API"} /models`, {
      method: "GET",
      headers: protocolHeaders(protocol, input.apiKey)
    }) as OpenAiModelListResponse;
    for (const item of payload.data ?? []) {
      const id = typeof item.id === "string" ? safeModelId(item.id) : null;
      if (id) models.set(id, modelSummary(id, checkedAt, item));
      if (models.size > MAX_MODEL_CATALOG_ITEMS) {
        throw new Error(`模型目录超过 ${MAX_MODEL_CATALOG_ITEMS} 项安全预算，已停止读取；请联系渠道管理员缩小目录范围。`);
      }
    }
    if (protocol !== "anthropic" || payload.has_more !== true) return Array.from(models.values());
    const cursor = typeof payload.last_id === "string" ? safeModelId(payload.last_id) : null;
    if (!cursor || seenCursors.has(cursor)) throw new Error("Anthropic API /models 分页游标无效，已停止读取以避免重复请求。");
    seenCursors.add(cursor);
    const pageUrl = new URL(endpoint(input.baseUrl, "/models"));
    pageUrl.searchParams.set("after_id", cursor);
    pageUrl.searchParams.set("limit", "1000");
    nextUrl = pageUrl.toString();
  }
  throw new Error(`Anthropic API /models 分页超过 ${MAX_MODEL_CATALOG_PAGES} 页安全预算，已停止读取；请检查渠道是否返回了重复分页。`);
}

async function invokeChat(
  input: ModelProviderConnectorInput & { modelId: string; signal?: AbortSignal },
  protocol: HttpModelProtocol,
  promptMessages: ChatMessagePayload[],
  maxTokens: number,
  temperature: number | undefined,
  requester: SecureModelJsonRequester
): Promise<string> {
  if (protocol === "anthropic") {
    const anthropicPayload = anthropicMessages(promptMessages);
    const payload = await requester(endpoint(input.baseUrl, "/messages"), "Anthropic API /messages", {
      method: "POST",
      headers: protocolHeaders(protocol, input.apiKey, true),
      signal: input.signal,
      body: JSON.stringify({
        model: input.modelId,
        max_tokens: maxTokens,
        ...anthropicPayload
      })
    }) as AnthropicMessageResponse;
    return extractAnthropicContent(payload);
  }

  const messages = promptMessages;
  const payload = await requester(endpoint(input.baseUrl, "/chat/completions"), "OpenAI API /chat/completions", {
    method: "POST",
    headers: protocolHeaders(protocol, input.apiKey, true),
    signal: input.signal,
    body: JSON.stringify({
      model: input.modelId,
      messages,
      max_tokens: maxTokens,
      ...(typeof temperature === "number" ? { temperature } : {}),
      stream: false
    })
  }) as ChatCompletionResponse;
  return extractVerifiedOpenAiChatContent(payload);
}

function streamPayloadText(payload: unknown, protocol: HttpModelProtocol): string {
  if (!payload || typeof payload !== "object") return "";
  if (protocol === "anthropic") {
    const anthropic = payload as AnthropicStreamPayload;
    if (typeof anthropic.delta?.text === "string") return anthropic.delta.text;
    return typeof anthropic.content_block?.text === "string" ? anthropic.content_block.text : "";
  }
  const openAi = payload as OpenAiStreamPayload;
  const choice = openAi.choices?.[0];
  if (typeof choice?.delta?.content === "string") return choice.delta.content;
  return typeof choice?.text === "string" ? choice.text : "";
}

async function invokeChatStream(
  input: ModelProviderConnectorInput & { modelId: string; signal?: AbortSignal },
  protocol: HttpModelProtocol,
  promptMessages: ChatMessagePayload[],
  maxTokens: number,
  temperature: number | undefined,
  requester: SecureModelStreamRequester,
  onDelta: (delta: string) => void
): Promise<string> {
  const anthropicPayload = protocol === "anthropic" ? anthropicMessages(promptMessages) : null;
  const requestBody = protocol === "anthropic"
    ? {
        model: input.modelId,
        max_tokens: maxTokens,
        ...anthropicPayload,
        stream: true
      }
    : {
        model: input.modelId,
        messages: promptMessages,
        max_tokens: maxTokens,
        ...(typeof temperature === "number" ? { temperature } : {}),
        stream: true
      };
  const apiPath = protocol === "anthropic" ? "/messages" : "/chat/completions";
  const apiLabel = `${protocol === "anthropic" ? "Anthropic API" : "OpenAI API"} ${apiPath}`;
  let pending = "";
  let fallbackResponseText = "";
  let content = "";

  const emit = (delta: string) => {
    const safeDelta = delta.replace(/\u0000/g, "");
    if (!safeDelta) return;
    content += safeDelta;
    onDelta(safeDelta);
  };
  const consumeEvent = (eventText: string) => {
    const data = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    try {
      emit(streamPayloadText(JSON.parse(data) as unknown, protocol));
    } catch {
      throw new Error(`${apiLabel} 返回了无法解析的流式数据。`);
    }
  };

  let response: Awaited<ReturnType<SecureModelStreamRequester>> | null = null;
  for (let attempt = 0; attempt <= STREAM_RETRY_DELAYS_MS.length; attempt += 1) {
    let receivedChunk = false;
    pending = "";
    fallbackResponseText = "";
    try {
      response = await requester(endpoint(input.baseUrl, apiPath), apiLabel, {
        method: "POST",
        headers: {
          ...protocolHeaders(protocol, input.apiKey, true),
          Accept: "text/event-stream"
        },
        signal: input.signal,
        body: JSON.stringify(requestBody)
      }, (chunk) => {
        receivedChunk = true;
        fallbackResponseText += chunk;
        pending += chunk;
        const events = pending.split(/\r?\n\r?\n/);
        pending = events.pop() ?? "";
        for (const eventText of events) consumeEvent(eventText);
      });
      break;
    } catch (caught) {
      const retryDelay = STREAM_RETRY_DELAYS_MS[attempt];
      if (receivedChunk || content.length > 0 || retryDelay === undefined || !isTransientStreamFailure(caught)) throw caught;
      await waitForStreamRetry(retryDelay, input.signal);
    }
  }
  if (!response) throw new Error(`${apiLabel} 流式连接未建立。`);
  if (pending.trim()) consumeEvent(pending);

  if (!content.trim() && !response.contentType.toLowerCase().includes("text/event-stream")) {
    try {
      const payload = JSON.parse(fallbackResponseText) as unknown;
      content = protocol === "anthropic"
        ? extractAnthropicContent(payload as AnthropicMessageResponse)
        : extractVerifiedOpenAiChatContent(payload as ChatCompletionResponse);
      onDelta(content);
    } catch (caught) {
      throw new Error(caughtMessage(caught, `${apiLabel} 没有返回可读取的文本。`));
    }
  }
  if (!content.trim()) throw new Error(`${apiLabel} 没有返回可读取的流式文本。`);
  return content;
}

async function invokeAgentToolLoopStream(
  input: SafeModelDraftConnectorInput,
  protocol: HttpModelProtocol,
  promptMessages: ChatMessagePayload[],
  maxTokens: number,
  temperature: number | undefined,
  requester: SecureModelStreamRequester,
  onDelta: (delta: string) => void
): Promise<string> {
  const session = input.toolSession;
  if (!session || session.tools.length === 0) {
    return invokeChatStream(input, protocol, promptMessages, maxTokens, temperature, requester, onDelta);
  }

  const anthropicPayload = protocol === "anthropic" ? anthropicMessages(promptMessages) : null;
  const system = protocol === "anthropic" ? anthropicPayload?.system : undefined;
  const messages: Array<Record<string, unknown>> = protocol === "anthropic"
    ? [...(anthropicPayload?.messages ?? [])]
    : promptMessages.map((message) => ({ ...message }));
  let accumulated = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    input.signal?.throwIfAborted();
    const result = await invokeToolAwareStreamRound({
      input,
      protocol,
      messages,
      system,
      maxTokens,
      temperature,
      requester,
      round,
      onDelta: (delta) => {
        accumulated += delta;
        onDelta(delta);
      }
    });
    if (result.calls.length === 0) {
      if (!accumulated.trim() && result.content.trim()) {
        accumulated = result.content;
        onDelta(result.content);
      }
      if (!accumulated.trim()) throw new Error("模型没有返回文本或可执行工具调用。");
      return accumulated;
    }

    messages.push(result.assistantMessage);
    const toolResults: AgentModelToolResult[] = [];
    for (const [callIndex, call] of result.calls.entries()) {
      await input.onToolEvent?.({ type: "tool-call", call });
      const authorization = callIndex >= MAX_TOOL_CALLS_PER_ROUND
        ? { outcome: "denied" as const, message: `单轮工具调用不能超过 ${MAX_TOOL_CALLS_PER_ROUND} 个，超出的调用已拒绝执行。` }
        : session.authorize(call);
      await input.onToolEvent?.({
        type: "tool-decision",
        callId: call.callId,
        toolName: call.name,
        outcome: authorization.outcome,
        message: authorization.message
      });
      const toolResult = callIndex >= MAX_TOOL_CALLS_PER_ROUND
        ? rejectedToolResult(call, authorization.message)
        : await session.execute(call, input.signal);
      await input.onToolEvent?.({ type: "tool-result", result: toolResult });
      toolResults.push(toolResult);
    }
    appendProviderToolResults(protocol, messages, toolResults);
  }

  const stopped = "\n\n工具调用已达到安全轮数上限，我已停止继续调用。请缩小问题范围后重试。";
  accumulated += stopped;
  onDelta(stopped);
  return accumulated;
}

function rejectedToolResult(call: AgentModelToolCall, message: string): AgentModelToolResult {
  return {
    callId: call.callId,
    name: call.name,
    content: JSON.stringify({ error: message }),
    isError: true,
    trust: "untrusted-data"
  };
}

async function invokeToolAwareStreamRound(options: {
  input: SafeModelDraftConnectorInput;
  protocol: HttpModelProtocol;
  messages: Array<Record<string, unknown>>;
  system?: string;
  maxTokens: number;
  temperature: number | undefined;
  requester: SecureModelStreamRequester;
  round: number;
  onDelta: (delta: string) => void;
}): Promise<ToolAwareRound> {
  const { input, protocol, messages, system, maxTokens, temperature, requester, round, onDelta } = options;
  const requestBody = protocol === "anthropic"
    ? {
        model: input.modelId,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages,
        tools: input.toolSession?.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema
        })),
        stream: true
      }
    : {
        model: input.modelId,
        messages,
        tools: input.toolSession?.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
        })),
        tool_choice: "auto",
        max_tokens: maxTokens,
        ...(typeof temperature === "number" ? { temperature } : {}),
        stream: true
      };
  const apiPath = protocol === "anthropic" ? "/messages" : "/chat/completions";
  const apiLabel = `${protocol === "anthropic" ? "Anthropic API" : "OpenAI API"} ${apiPath}`;
  let pending = "";
  let fallbackResponseText = "";
  let content = "";
  const openAiCalls = new Map<number, { id: string; name: string; argumentsText: string }>();
  const anthropicCalls = new Map<number, { id: string; name: string; argumentsText: string }>();

  const emitText = (delta: string) => {
    const safe = delta.replace(/\u0000/g, "");
    if (!safe) return;
    content += safe;
    onDelta(safe);
  };
  const consumePayload = (payload: unknown) => {
    if (protocol === "anthropic") consumeAnthropicToolPayload(payload, anthropicCalls, emitText, round);
    else consumeOpenAiToolPayload(payload, openAiCalls, emitText, round);
  };
  const consumeEvent = (eventText: string) => {
    const data = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    try { consumePayload(JSON.parse(data)); }
    catch { throw new Error(`${apiLabel} 返回了无法解析的工具流数据。`); }
  };

  let response: Awaited<ReturnType<SecureModelStreamRequester>> | null = null;
  for (let attempt = 0; attempt <= STREAM_RETRY_DELAYS_MS.length; attempt += 1) {
    let receivedChunk = false;
    pending = "";
    fallbackResponseText = "";
    try {
      response = await requester(endpoint(input.baseUrl, apiPath), apiLabel, {
        method: "POST",
        headers: { ...protocolHeaders(protocol, input.apiKey, true), Accept: "text/event-stream" },
        signal: input.signal,
        body: JSON.stringify(requestBody)
      }, (chunk) => {
        receivedChunk = true;
        fallbackResponseText += chunk;
        pending += chunk;
        const events = pending.split(/\r?\n\r?\n/);
        pending = events.pop() ?? "";
        for (const eventText of events) consumeEvent(eventText);
      });
      break;
    } catch (caught) {
      const retryDelay = STREAM_RETRY_DELAYS_MS[attempt];
      const hasToolProgress = openAiCalls.size > 0 || anthropicCalls.size > 0;
      if (receivedChunk || content.length > 0 || hasToolProgress || retryDelay === undefined || !isTransientStreamFailure(caught)) throw caught;
      await waitForStreamRetry(retryDelay, input.signal);
    }
  }
  if (!response) throw new Error(`${apiLabel} 工具流式连接未建立。`);
  if (pending.trim()) consumeEvent(pending);
  if (!response.contentType.toLowerCase().includes("text/event-stream") && fallbackResponseText.trim()) {
    try { consumePayload(JSON.parse(fallbackResponseText)); }
    catch { throw new Error(`${apiLabel} 没有返回可解析的工具响应。`); }
  }

  const calls = protocol === "anthropic"
    ? toolCallsFromAccumulator(anthropicCalls)
    : toolCallsFromAccumulator(openAiCalls);
  const assistantMessage = protocol === "anthropic"
    ? {
        role: "assistant",
        content: [
          ...(content ? [{ type: "text", text: content }] : []),
          ...calls.map((call) => ({ type: "tool_use", id: call.callId, name: call.name, input: call.arguments }))
        ]
      }
    : {
        role: "assistant",
        content: content || null,
        ...(calls.length ? {
          tool_calls: calls.map((call) => ({
            id: call.callId,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) }
          }))
        } : {})
      };
  return { content, calls, assistantMessage };
}

function consumeOpenAiToolPayload(
  payload: unknown,
  calls: Map<number, { id: string; name: string; argumentsText: string }>,
  emitText: (delta: string) => void,
  round: number
): void {
  if (!payload || typeof payload !== "object") return;
  const response = payload as ChatCompletionResponse & OpenAiStreamPayload;
  const choice = response.choices?.[0];
  const message = choice?.message;
  if (typeof message?.content === "string") emitText(message.content);
  else if (typeof choice?.delta?.content === "string") emitText(choice.delta.content);
  else if (typeof choice?.text === "string") emitText(choice.text);

  const streamCalls = choice?.delta?.tool_calls ?? [];
  for (const candidate of streamCalls) {
    const index = typeof candidate.index === "number" ? candidate.index : calls.size;
    const current = calls.get(index) ?? { id: `tool-${round}-${index}`, name: "", argumentsText: "" };
    if (typeof candidate.id === "string") current.id = candidate.id;
    if (typeof candidate.function?.name === "string") current.name += candidate.function.name;
    if (typeof candidate.function?.arguments === "string") current.argumentsText += candidate.function.arguments;
    calls.set(index, current);
  }
  const completeCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (const [index, value] of completeCalls.entries()) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    calls.set(index, {
      id: typeof candidate.id === "string" ? candidate.id : `tool-${round}-${index}`,
      name: typeof candidate.function?.name === "string" ? candidate.function.name : "",
      argumentsText: typeof candidate.function?.arguments === "string" ? candidate.function.arguments : "{}"
    });
  }
}

function consumeAnthropicToolPayload(
  payload: unknown,
  calls: Map<number, { id: string; name: string; argumentsText: string }>,
  emitText: (delta: string) => void,
  round: number
): void {
  if (!payload || typeof payload !== "object") return;
  const response = payload as AnthropicMessageResponse & AnthropicStreamPayload;
  if (Array.isArray(response.content)) {
    for (const [index, block] of response.content.entries()) {
      if (block.type === "text" && typeof block.text === "string") emitText(block.text);
      if (block.type === "tool_use" && typeof block.name === "string") {
        calls.set(index, {
          id: typeof block.id === "string" ? block.id : `tool-${round}-${index}`,
          name: block.name,
          argumentsText: JSON.stringify(block.input ?? {})
        });
      }
    }
    return;
  }
  const index = typeof response.index === "number" ? response.index : calls.size;
  if (response.type === "content_block_start" && response.content_block?.type === "tool_use") {
    calls.set(index, {
      id: typeof response.content_block.id === "string" ? response.content_block.id : `tool-${round}-${index}`,
      name: typeof response.content_block.name === "string" ? response.content_block.name : "",
      argumentsText: response.content_block.input && typeof response.content_block.input === "object" && !Array.isArray(response.content_block.input)
        ? JSON.stringify(response.content_block.input)
        : ""
    });
    return;
  }
  if (response.delta?.type === "input_json_delta" && typeof response.delta.partial_json === "string") {
    const current = calls.get(index) ?? { id: `tool-${round}-${index}`, name: "", argumentsText: "" };
    if (current.argumentsText === "{}" && response.delta.partial_json.trim()) current.argumentsText = "";
    current.argumentsText += response.delta.partial_json;
    calls.set(index, current);
    return;
  }
  if (typeof response.delta?.text === "string") emitText(response.delta.text);
  else if (typeof response.content_block?.text === "string") emitText(response.content_block.text);
}

function toolCallsFromAccumulator(calls: Map<number, { id: string; name: string; argumentsText: string }>): AgentModelToolCall[] {
  return [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .filter(([, call]) => /^[A-Za-z0-9_-]{1,64}$/.test(call.name))
    .map(([, call]) => {
      const parsed = parseToolArguments(call.argumentsText);
      return {
        callId: call.id.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 120) || `tool-call-${Date.now()}`,
        name: call.name,
        arguments: parsed.value,
        ...(parsed.error ? { argumentsError: parsed.error } : {})
      };
    });
}

function parseToolArguments(value: string): { value: ToolJsonObject; error?: string } {
  if (!value.trim()) return { value: {}, error: "模型没有提供有效的工具参数，已拒绝执行。" };
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { value: parsed as ToolJsonObject }
      : { value: {}, error: "工具参数必须是 JSON 对象，已拒绝执行。" };
  } catch {
    return { value: {}, error: "模型返回的工具参数不是完整 JSON，已拒绝执行。" };
  }
}

function appendProviderToolResults(
  protocol: HttpModelProtocol,
  messages: Array<Record<string, unknown>>,
  results: AgentModelToolResult[]
): void {
  if (protocol === "anthropic") {
    messages.push({
      role: "user",
      content: results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.callId,
        content: result.content,
        is_error: result.isError
      }))
    });
    return;
  }
  for (const result of results) {
    messages.push({ role: "tool", tool_call_id: result.callId, content: result.content });
  }
}

async function verifyHttpProvider(input: ModelProviderConnectorInput, protocol: HttpModelProtocol, requester: SecureModelJsonRequester): Promise<ModelProviderVerificationReport> {
  const checkedAt = nowIso();
  const steps: ModelProviderVerificationStep[] = [];
  const errors: ModelProviderVerificationError[] = [];
  const catalogMode = activeCatalogMode();
  let remoteModels: ModelSummary[] = [];
  let remoteFailure = "";

  if (catalogMode !== "manual") {
    try {
      remoteModels = await fetchRemoteModels(input, protocol, checkedAt, requester);
      if (remoteModels.length === 0) remoteFailure = `${protocol === "anthropic" ? "Anthropic API" : "OpenAI API"} /models 返回空列表。`;
    } catch (caught) {
      remoteFailure = caughtMessage(caught, "API /models 请求失败。");
    }
  }

  const models = catalogMode === "remote" ? remoteModels : mergeModels(remoteModels, input, checkedAt);
  const manualCount = manualModelIds(input).length;
  const mayUseManualCatalog = catalogMode === "manual" || catalogMode === "remote-with-manual-fallback";
  if (catalogMode === "remote" && remoteFailure) {
    steps.push(step("models", "获取模型列表", "failed", remoteFailure, checkedAt));
    steps.push(step("chat", "最小对话测试", "skipped", "远程模型列表未获取成功，未执行最小对话测试。", checkedAt));
    errors.push(error("models-failed", remoteFailure, "请检查 Base URL、API Key、网络代理或模型服务状态。"));
    return buildReport("http", input, steps, [], null, errors, checkedAt);
  }
  if (models.length === 0 || (remoteFailure && (!mayUseManualCatalog || manualCount === 0))) {
    const detail = remoteFailure || "Project 配置中没有可用的远程或手工模型。";
    steps.push(step("models", "获取模型列表", "failed", detail, checkedAt));
    steps.push(step("chat", "最小对话测试", "skipped", "没有已保存的可测试模型，未执行最小对话测试。", checkedAt));
    errors.push(error("no-models", detail, "请先把手工模型 ID 保存进当前 Project，或确认远程 /models 可用。"));
    return buildReport("http", input, steps, [], null, errors, checkedAt);
  }

  const catalogDetail = remoteFailure
    ? `${remoteFailure} 已改用 Project 中保存的 ${manualCount} 个手工模型。`
    : catalogMode === "manual"
      ? `已读取 Project 中保存的 ${manualCount} 个手工模型。`
      : `已合并 ${remoteModels.length} 个远程模型和 ${manualCount} 个手工模型，共 ${models.length} 个。`;
  steps.push(step("models", "获取模型列表", "passed", catalogDetail, checkedAt));
  const selectedModelId = chooseTestModel(models, input.testModelId ?? "");
  if (!selectedModelId) {
    steps.push(step("chat", "最小对话测试", "skipped", "没有有效模型名，未执行最小对话测试。", checkedAt));
    errors.push(error("no-models", "Project 配置中的模型名无效。", "请保存有效模型 ID 后再验证。"));
    return buildReport("http", input, steps, models, null, errors, checkedAt);
  }

  try {
    const content = await invokeChat({ ...input, modelId: selectedModelId }, protocol, [{ role: "user", content: "ping" }], 4, 0, requester);
    if (!content.trim()) throw new Error(`${protocol === "anthropic" ? "Anthropic API /messages" : "OpenAI API /chat/completions"} 没有返回文本。`);
    steps.push(step("chat", "最小对话测试", "passed", `已用模型 ${selectedModelId} 完成最小对话测试。`, checkedAt));
  } catch (caught) {
    const detail = caughtMessage(caught, `模型 ${selectedModelId} 的最小对话测试失败。`);
    steps.push(step("chat", "最小对话测试", "failed", `${detail} 模型：${selectedModelId}。`, checkedAt));
    errors.push(error("chat-failed", `${detail} 模型：${selectedModelId}。`, "请检查 API 协议、模型名和当前账号权限。"));
  }
  return buildReport("http", input, steps, models, selectedModelId, errors, checkedAt);
}

abstract class HttpModelProviderConnector implements ModelProviderConnector {
  constructor(
    private readonly protocol: HttpModelProtocol,
    private readonly requester: SecureModelJsonRequester,
    private readonly streamRequester: SecureModelStreamRequester
  ) {}

  verify(input: ModelProviderConnectorInput): Promise<ModelProviderVerificationReport> {
    return verifyHttpProvider(input, this.protocol, this.requester);
  }

  async generateSafeDraft(input: SafeModelDraftConnectorInput): Promise<SafeModelDraftConnectorResult> {
    const guarded = input.onDelta ? guardedSafeDraftDeltaHandler(input.onDelta) : null;
    let content: string;
    if (input.toolSession?.tools.length) {
      let toolModeEmittedText = false;
      try {
        content = await invokeAgentToolLoopStream(
          input,
          this.protocol,
          input.context.messages,
          900,
          0.2,
          this.streamRequester,
          (delta) => {
            toolModeEmittedText = true;
            guarded?.push(delta);
          }
        );
      } catch (error) {
        if (toolModeEmittedText || !isToolProtocolUnsupported(error)) throw error;
        content = guarded
          ? await invokeChatStream(input, this.protocol, input.context.messages, 900, 0.2, this.streamRequester, guarded.push)
          : await invokeChat(input, this.protocol, input.context.messages, 900, 0.2, this.requester);
      }
    } else {
      content = guarded
        ? await invokeChatStream(input, this.protocol, input.context.messages, 900, 0.2, this.streamRequester, guarded.push)
        : await invokeChat(input, this.protocol, input.context.messages, 900, 0.2, this.requester);
    }
    guarded?.flush();
    return connectorResult(input, content);
  }

  async generateDailyChat(input: DailyChatConnectorInput): Promise<DailyChatConnectorResult> {
    const content = input.onDelta
      ? await invokeChatStream(input, this.protocol, dailyChatMessages(input), 900, 0.4, this.streamRequester, input.onDelta)
      : await invokeChat(input, this.protocol, dailyChatMessages(input), 900, 0.4, this.requester);
    return dailyChatResult(input, content);
  }
}

function isToolProtocolUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /HTTP (?:400|404|405|415|422)\b|(?:tools?|function(?: calling)?)\s+(?:is |are )?(?:unsupported|not supported|unknown|invalid)/i.test(message);
}

export class OpenAiCompatibleModelProviderConnector extends HttpModelProviderConnector {
  constructor(
    requester: SecureModelJsonRequester = secureModelJsonRequest,
    streamRequester: SecureModelStreamRequester = secureModelStreamRequest
  ) {
    super("openai", requester, streamRequester);
  }
}

export class AnthropicCompatibleModelProviderConnector extends HttpModelProviderConnector {
  constructor(
    requester: SecureModelJsonRequester = secureModelJsonRequest,
    streamRequester: SecureModelStreamRequester = secureModelStreamRequest
  ) {
    super("anthropic", requester, streamRequester);
  }
}

export function createModelProviderConnector(baseUrl: string, providerType: ApiProviderConfig["providerType"] = "openai-compatible"): ModelProviderConnector {
  if (isFakeProvider(baseUrl)) return new FakeModelProviderConnector();
  return providerType === "anthropic-compatible"
    ? new AnthropicCompatibleModelProviderConnector()
    : new OpenAiCompatibleModelProviderConnector();
}

export function createModelProviderValidationFailureReport(
  input: Omit<ModelProviderConnectorInput, "apiKey">,
  code: ModelProviderVerificationErrorCode,
  message: string,
  suggestion: string
): ModelProviderVerificationReport {
  const checkedAt = nowIso();
  const steps: ModelProviderVerificationStep[] = [
    step("models", "获取模型列表", "failed", message, checkedAt),
    step("chat", "最小对话测试", "skipped", "模型列表未通过，未执行最小对话测试。", checkedAt)
  ];
  return buildReport("fake", input, steps, [], null, [error(code, message, suggestion)], checkedAt);
}
