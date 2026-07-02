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

export interface ModelProviderConnectorInput {
  id: string;
  name: string;
  providerType: ApiProviderConfig["providerType"];
  baseUrl: string;
  apiKey: string;
}

export interface ModelProviderConnector {
  verify(input: ModelProviderConnectorInput): Promise<ModelProviderVerificationReport>;
}

interface OpenAiModelListResponse {
  data?: Array<{ id?: unknown; object?: unknown }>;
}

interface ChatCompletionResponse {
  id?: unknown;
  choices?: unknown[];
}

const DEFAULT_TIMEOUT_MS = 15000;

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
    const host = new URL(baseUrl).host.toLowerCase();
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

async function fetchJson(url: string, options: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`http-${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function chooseTestModel(models: ModelSummary[]): string | null {
  return models[0]?.id ?? null;
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
}

export class OpenAiCompatibleModelProviderConnector implements ModelProviderConnector {
  async verify(input: ModelProviderConnectorInput): Promise<ModelProviderVerificationReport> {
    const checkedAt = nowIso();
    const steps: ModelProviderVerificationStep[] = [];
    const errors: ModelProviderVerificationError[] = [];
    let models: ModelSummary[] = [];

    try {
      const modelsPayload = await fetchJson(endpoint(input.baseUrl, "/models"), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          Accept: "application/json"
        }
      }) as OpenAiModelListResponse;
      models = (modelsPayload.data ?? [])
        .map((item) => typeof item.id === "string" ? safeModelId(item.id) : null)
        .filter((id): id is string => typeof id === "string")
        .slice(0, 200)
        .map((id) => modelSummary(id, checkedAt));
    } catch {
      steps.push(step("models", "获取模型列表", "failed", "模型服务没有返回可用模型列表。", checkedAt));
      steps.push(step("chat", "最小对话测试", "skipped", "模型列表未获取成功，未执行最小对话测试。", checkedAt));
      errors.push(error("models-failed", "无法获取模型列表。", "请检查 Base URL、API Key、网络代理或模型服务状态。"));
      return buildReport("http", input, steps, [], null, errors, checkedAt);
    }

    if (models.length === 0) {
      steps.push(step("models", "获取模型列表", "failed", "模型服务返回为空列表。", checkedAt));
      steps.push(step("chat", "最小对话测试", "skipped", "没有可测试模型，未执行最小对话测试。", checkedAt));
      errors.push(error("no-models", "模型列表为空。", "请确认该渠道账号是否有可用模型，或切换其他模型服务。"));
      return buildReport("http", input, steps, [], null, errors, checkedAt);
    }

    steps.push(step("models", "获取模型列表", "passed", `已获取 ${models.length} 个模型摘要。`, checkedAt));
    const selectedModelId = chooseTestModel(models);

    try {
      const chatPayload = await fetchJson(endpoint(input.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          model: selectedModelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 4,
          temperature: 0
        })
      }) as ChatCompletionResponse;

      if (!chatPayload || !Array.isArray(chatPayload.choices)) {
        throw new Error("invalid-chat-response");
      }
      steps.push(step("chat", "最小对话测试", "passed", `已用 ${selectedModelId} 完成最小对话测试。`, checkedAt));
    } catch {
      steps.push(step("chat", "最小对话测试", "failed", "模型服务未能完成最小对话测试。", checkedAt));
      errors.push(error("chat-failed", "最小对话测试未通过。", "模型列表可用，但当前模型无法完成最小对话，请换模型或检查服务兼容性。"));
    }

    return buildReport("http", input, steps, models, selectedModelId, errors, checkedAt);
  }
}

export function createModelProviderConnector(baseUrl: string): ModelProviderConnector {
  return isFakeProvider(baseUrl) ? new FakeModelProviderConnector() : new OpenAiCompatibleModelProviderConnector();
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
