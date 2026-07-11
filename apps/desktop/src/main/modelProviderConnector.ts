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
import { assertSafeModelDraftResponseText, type SafeModelDraftContext } from "./safeModelCaseDraftService";
import { secureModelJsonRequest, type SecureModelJsonRequester } from "./modelEndpointSecurity";

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
}

export interface DailyChatConnectorInput extends ModelProviderConnectorInput {
  modelId: string;
  content: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
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
  data?: Array<{ id?: unknown; object?: unknown }>;
}

interface ChatCompletionResponse {
  id?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
    text?: unknown;
  }>;
}

interface AnthropicMessageResponse {
  content?: Array<{ type?: unknown; text?: unknown }>;
}

type ChatMessagePayload = { role: "system" | "user" | "assistant"; content: string };

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
  const capabilities = new Set<ModelCapability>(["chat"]);
  if (lower.includes("vision") || lower.includes("vl") || lower.includes("image") || lower.includes("omni")) capabilities.add("vision");
  if (lower.includes("reason") || lower.includes("r1") || lower.includes("o1") || lower.includes("o3") || lower.includes("thinking")) capabilities.add("reasoning");
  if (lower.includes("tool") || lower.includes("function")) capabilities.add("tools");
  if (lower.includes("web") || lower.includes("search")) capabilities.add("web");
  if (lower.includes("free")) capabilities.add("free");
  return Array.from(capabilities);
}

function modelSummary(modelId: string, checkedAt: string): ModelSummary {
  return {
    id: modelId,
    displayName: modelId,
    capabilities: inferCapabilities(modelId),
    lastSeenAt: checkedAt
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
  if (/bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9]{20,}|api[_-]?key/i.test(trimmed)) return null;
  return trimmed;
}

function chooseTestModel(models: ModelSummary[], preferredModelId = ""): string | null {
  const preferred = safeModelId(preferredModelId);
  if (preferred && models.some((model) => model.id === preferred)) return preferred;
  const nonChatPattern = /(embedding|embed|rerank|moderation|image|vision-only|tts|speech|audio|whisper)/i;
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
  return Array.from(new Set(configured)).slice(0, 200);
}

function mergeModels(remoteModels: ModelSummary[], input: ModelProviderConnectorInput, checkedAt: string): ModelSummary[] {
  const merged = new Map(remoteModels.map((model) => [model.id, model]));
  for (const id of manualModelIds(input)) {
    if (!merged.has(id)) merged.set(id, modelSummary(id, checkedAt));
  }
  return Array.from(merged.values()).slice(0, 200);
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

function dailyChatMessages(input: DailyChatConnectorInput): ChatMessagePayload[] {
  return [
    {
      role: "system",
      content: "你是一个中文日常 AI 助手。回答要简洁、直接、可执行。不要声称已读取本机文件、SAP、飞书或案件资料。"
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
  const payload = await requester(endpoint(input.baseUrl, "/models"), `${protocol === "anthropic" ? "Anthropic API" : "OpenAI API"} /models`, {
    method: "GET",
    headers: protocolHeaders(protocol, input.apiKey)
  }) as OpenAiModelListResponse;
  return (payload.data ?? [])
    .map((item) => typeof item.id === "string" ? safeModelId(item.id) : null)
    .filter((id): id is string => id !== null)
    .slice(0, 200)
    .map((id) => modelSummary(id, checkedAt));
}

async function invokeChat(
  input: ModelProviderConnectorInput & { modelId: string },
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

async function verifyHttpProvider(input: ModelProviderConnectorInput, protocol: HttpModelProtocol, requester: SecureModelJsonRequester): Promise<ModelProviderVerificationReport> {
  const checkedAt = nowIso();
  const steps: ModelProviderVerificationStep[] = [];
  const errors: ModelProviderVerificationError[] = [];
  const catalogMode = input.catalogMode ?? "remote";
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
  constructor(private readonly protocol: HttpModelProtocol, private readonly requester: SecureModelJsonRequester) {}

  verify(input: ModelProviderConnectorInput): Promise<ModelProviderVerificationReport> {
    return verifyHttpProvider(input, this.protocol, this.requester);
  }

  async generateSafeDraft(input: SafeModelDraftConnectorInput): Promise<SafeModelDraftConnectorResult> {
    const content = await invokeChat(input, this.protocol, input.context.messages, 900, 0.2, this.requester);
    return connectorResult(input, content);
  }

  async generateDailyChat(input: DailyChatConnectorInput): Promise<DailyChatConnectorResult> {
    const content = await invokeChat(input, this.protocol, dailyChatMessages(input), 900, 0.4, this.requester);
    return dailyChatResult(input, content);
  }
}

export class OpenAiCompatibleModelProviderConnector extends HttpModelProviderConnector {
  constructor(requester: SecureModelJsonRequester = secureModelJsonRequest) {
    super("openai", requester);
  }
}

export class AnthropicCompatibleModelProviderConnector extends HttpModelProviderConnector {
  constructor(requester: SecureModelJsonRequester = secureModelJsonRequest) {
    super("anthropic", requester);
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
