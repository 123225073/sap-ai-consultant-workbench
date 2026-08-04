import { app, BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAdtReadonlyConnector, createAdtValidationFailureReport, FakeAdtReadonlyConnector, type AdtConnectorInput, type AdtObjectSearchResult } from "./adtReadonlyConnector";
import { discoverLocalSapGuiConnections, resolveAdtEndpointCandidates, type AdtEndpointCandidate } from "./adtEndpointResolver";
import { createFeishuCliConnector, createFeishuValidationFailureReport, discoverFeishuCli, installFeishuCli, saveFeishuCliProfile, type FeishuCliConnectorInput } from "./feishuCliConnector";
import { createCodexCliConnector, createCodexValidationFailureReport, type CodexCliConnectorInput } from "./codexCliConnector";
import { createModelProviderConnector, createModelProviderValidationFailureReport, type ModelProviderConnectorInput, type ModelToolLoopEvent } from "./modelProviderConnector";
import { SecureSecretStore, WORKSPACE_SHARED_SECRET_SCOPE } from "./secureSecretStore";
import { isChatCapableModel, parseAppendDailyChatMessageInput, parseCreateWorkThreadInput, WorkspaceStore, type DailyChatAssistantReply } from "./workspaceStore";
import { applyAgentContextToSafeModelDraft, safeModelDraftDisplayValue, type SafeModelDraftRun } from "./safeModelCaseDraftService";
import { readControlledKnowledgeTextFile } from "./controlledTextFileImportService";
import {
  createKnowledgeImportInputFromTextFile,
  KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_EXTENSIONS,
  parseKnowledgeImportTextFileInput
} from "./knowledgeService";
import { parseSapObjectEvidenceRequest, type SapObjectEvidenceConnectorResult } from "./sapObjectEvidenceService";
import { createAdtDataPreviewConnector } from "./adtDataPreviewConnector";
import { parseSapDataPreviewRequest, type SapDataPreviewConnectorResult } from "./sapDataPreviewService";
import { assertTrustedRendererEvent, isTrustedRendererUrl } from "./trustedRenderer";
import { createAppLifecycleLogger } from "./appLifecycleLogger";
import { installLocalAiCapability, parseLocalAiInstallInput, scanLocalAiCapabilities } from "./localAiCapabilityService";
import { assertPublicModelEndpoint, isDemoModelHost, isUnsafeModelHost } from "./modelEndpointSecurity";
import { createWorkspaceBackup, importWorkspace } from "./workspaceTransferService";
import { AgentRuntime } from "./agentRuntime";
import { AgentToolService } from "./agentToolService";
import { AgentContextService } from "./agentContextService";
import { CapabilityCenterService } from "./capabilityCenterService";
import { ContextEngine } from "./contextEngine";
import { McpConnectionManager } from "./mcpConnectionManager";
import { PromptMemoryService } from "./promptMemoryService";
import { PluginPackageService } from "./pluginPackageService";
import { SkillPackageService } from "./skillPackageService";
import { SkillDiscoveryService } from "./skillDiscoveryService";
import { assertNoSensitiveCaseContent } from "./caseWorkflowService";
import { parseAgentThreadReplayInput, parseCancelAgentTurnInput, type AgentInterruptedTurnRecovery, type AgentRuntimeEvent } from "../shared/agentRuntimeTypes";
import { ExclusiveWorkflowQueue } from "./exclusiveWorkflowQueue";
import type { CreateCapabilityMemoryInput, DiscoverCapabilitySkillsInput, ImportCapabilityPluginInput, ImportCapabilitySkillInput, ImportDiscoveredCapabilitySkillsInput, RemoveCapabilityMcpInput, ReviewCapabilityMemoryInput, RevokeCapabilityMemoryInput, SaveCapabilityMcpInput, SaveCapabilityPromptInput, SetCapabilityMcpEnabledInput, SetCapabilityMcpToolEnabledInput, SetCapabilityPluginEnabledInput, SetCapabilityPromptEnabledInput, SetCapabilitySkillEnabledInput, TestCapabilityMcpInput, UpdateCapabilityMemoryInput } from "../shared/capabilityCenterTypes";
import type { AdtConfig, AdtVerificationErrorCode, AdtVerificationReport, AdtVerificationResult, AiConversationStreamEvent, AiConversationStreamScope, ApiProviderConfig, AppendDailyChatMessageInput, CodexCaseAssistRun, CodexConfig, CodexVerificationErrorCode, CodexVerificationResult, ExportCaseDiagramInput, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuConfig, FeishuHandoffResult, FeishuVerificationErrorCode, FeishuVerificationResult, ImportCaseAttachmentsInput, KnowledgeImportTextFileResult, LocalAiInstallResult, LocalTaskFolderSelectionResult, ModelProviderVerificationErrorCode, ModelProviderVerificationResult, ProjectConfig, ProjectSecretInput, SapDataPreviewRequest, SapDataPreviewResult, SapObjectEvidenceResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";
import { routeSapConnections } from "../shared/sapConnectionRouting";
import { prepareCaseAttachments } from "./caseAttachmentService";
import { convertSanitizedSvg } from "./mermaidExportService";

const SENSITIVE_ERROR_PATTERNS = [
  /bearer\s+[a-z0-9._-]+/gi,
  /authorization:\s*[^\s]+/gi,
  /cookie:\s*[^\s]+/gi,
  /x-csrf-token:\s*[^\s]+/gi,
  /secure-store:sec_[a-f0-9]{32}/gi,
  /sk-[a-z0-9_-]{16,}/gi,
  /api[_-]?key\s*[:=]\s*[^\s]+/gi,
  /app[_-]?secret\s*[:=]\s*[^\s]+/gi,
  /appsecret\s*[:=]\s*[^\s]+/gi,
  /tenant[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
  /user[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
  /verification_uri\s*[:=]\s*[^\s]+/gi,
  /device_code\s*[:=]\s*[^\s]+/gi
];
const FEISHU_DEVELOPER_CONSOLE_URL = "https://open.feishu.cn/app";
const FEISHU_AUTHORIZATION_HOST_SUFFIXES = ["feishu.cn", "larksuite.com", "larkoffice.com"] as const;
const caseWorkflowQueue = new ExclusiveWorkflowQueue();
const activeSapEvidenceRuns = new Set<string>();
const SAP_EVIDENCE_TOTAL_TIMEOUT_MS = 90_000;
const AI_STREAM_EVENT_CHANNEL = "workbench:ai-conversation-stream";
const AGENT_RUNTIME_EVENT_CHANNEL = "workbench:agent-runtime-event";
const agentRunOwners = new Map<string, number>();

type ModelDeltaHandler = (delta: string, providerName: string, modelId: string) => void;

function validStreamRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value)) {
    throw new Error("AI 流式请求标识无效，请重新发送。");
  }
  return value;
}

function streamEventSender(event: IpcMainInvokeEvent, requestId: string, scope: AiConversationStreamScope): ModelDeltaHandler & { complete: () => void } {
  let started = false;
  const send = (payload: Omit<AiConversationStreamEvent, "requestId" | "scope">) => {
    if (!event.sender.isDestroyed()) event.sender.send(AI_STREAM_EVENT_CHANNEL, { requestId, scope, ...payload } satisfies AiConversationStreamEvent);
  };
  const handler = ((delta: string, providerName: string, modelId: string) => {
    if (!started) {
      started = true;
      send({ phase: "started", providerName, modelId });
    }
    send({ phase: "delta", delta, providerName, modelId });
  }) as ModelDeltaHandler & { complete: () => void };
  handler.complete = () => {
    if (started) send({ phase: "completed" });
  };
  return handler;
}

async function runOwnedAgentRequest<T>(event: IpcMainInvokeEvent, requestId: string, operation: () => Promise<T>): Promise<T> {
  if (agentRunOwners.has(requestId)) throw new Error("AI 请求标识正在使用，请重新发送。");
  agentRunOwners.set(requestId, event.sender.id);
  try {
    return await operation();
  } finally {
    if (agentRunOwners.get(requestId) === event.sender.id) agentRunOwners.delete(requestId);
  }
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "本地工作台操作失败。";
  const sanitized = SENSITIVE_ERROR_PATTERNS.reduce((message, pattern) => message.replace(pattern, "[已脱敏]"), raw).trim();
  if (/[㐀-鿿]/.test(sanitized)) return sanitized;

  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const technical = `${code} ${sanitized}`.toUpperCase();
  if (/ENOTFOUND|EAI_AGAIN|GETADDRINFO/.test(technical)) return "无法解析服务主机（DNS/ENOTFOUND），请检查地址和网络设置。";
  if (/ECONNREFUSED/.test(technical)) return "目标服务拒绝连接（ECONNREFUSED），请检查服务地址、端口和运行状态。";
  if (/ETIMEDOUT|TIMED?\s*OUT/.test(technical)) return "连接目标服务超时（ETIMEDOUT），请检查网络、代理或服务状态。";
  if (/ECONNRESET|SOCKET\s+HANG\s+UP/.test(technical)) return "连接被目标服务重置（ECONNRESET），请稍后重试或检查代理设置。";
  if (/ENOENT|NO SUCH FILE|NOT FOUND/.test(technical)) return "未找到所需文件或本机命令（ENOENT），请检查安装状态和路径。";
  if (/FETCH FAILED|NETWORK ERROR|FAILED TO FETCH/.test(technical)) return "网络请求失败，请检查网络、代理、Base URL 或目标服务状态。";
  const httpStatus = sanitized.match(/HTTP\s+(\d{3})/i)?.[1];
  if (httpStatus) {
    const labels: Record<string, string> = { "400": "请求格式错误", "401": "身份验证失败", "403": "权限不足", "404": "接口不存在", "408": "请求超时", "429": "请求过于频繁", "500": "服务内部错误", "502": "网关错误", "503": "服务暂时不可用", "504": "网关超时" };
    return `目标服务返回 HTTP ${httpStatus}${labels[httpStatus] ? `（${labels[httpStatus]}）` : ""}，请检查配置或稍后重试。`;
  }
  if (/TYPEERROR|SYNTAXERROR|RANGEERROR/.test(technical)) return "本地处理出现数据格式错误，请重试；如果持续失败，请重新验证相关配置。";
  return "操作未完成，系统返回了未识别错误。请重试；如果持续失败，请重新验证相关配置。";
}

function mayRetryWithVerifiedModel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /HTTP (?:429|500|502|503|504)\b|超时|连接重置|ECONNRESET|ETIMEDOUT/i.test(message);
}

function lifecycleErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if ((typeof code === "string" || typeof code === "number") && /^[A-Za-z0-9_.:-]{1,40}$/.test(String(code))) {
      return String(code);
    }
  }
  if (error instanceof TypeError) return "type-error";
  if (error instanceof RangeError) return "range-error";
  if (error instanceof SyntaxError) return "syntax-error";
  return "unclassified";
}

function wantsCodexCaseAssist(input: unknown): boolean {
  return Boolean(input && typeof input === "object" && !Array.isArray(input) && (input as { codexAssistEnabled?: unknown }).codexAssistEnabled === true);
}

function codexCaseAssistFailure(error: unknown): CodexCaseAssistRun {
  return {
    status: "failed",
    generatedAt: new Date().toISOString(),
    executorLabel: "Codex CLI",
    errorMessage: safeErrorMessage(error),
    outputCharCount: 0
  };
}

function response<T>(promise: Promise<T>): Promise<WorkbenchResponse<T>> {
  return promise
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => ({
      ok: false as const,
      error: safeErrorMessage(error)
    }));
}

function trustedResponse<T>(event: IpcMainInvokeEvent, appRoot: string, task: () => Promise<T>): Promise<WorkbenchResponse<T>> {
  try {
    assertTrustedRendererEvent(event, appRoot);
  } catch (error) {
    return response(Promise.reject(error));
  }
  return response(Promise.resolve().then(task));
}

function adtInputWithoutPassword(config: ProjectConfig, resolvedUrl = config.adt.url, sslMode = config.adt.sslMode): Omit<AdtConnectorInput, "password"> {
  let resolvedInstanceNumber = config.adt.instanceNumber;
  if (!resolvedInstanceNumber) {
    try {
      const port = new URL(resolvedUrl).port;
      resolvedInstanceNumber = /^443\d{2}$/.test(port) ? port.slice(-2) : "";
    } catch {
      resolvedInstanceNumber = "";
    }
  }
  return {
    alias: config.adt.alias,
    systemId: config.adt.systemId,
    instanceNumber: resolvedInstanceNumber,
    environment: config.adt.environment,
    url: resolvedUrl,
    client: config.adt.client,
    username: config.adt.username,
    language: config.adt.language,
    sslMode,
    readOnly: true
  };
}

function adtValidationFailure(config: ProjectConfig, code: AdtVerificationErrorCode, message: string, suggestion: string, resolvedUrl = config.adt.url) {
  return createAdtValidationFailureReport(adtInputWithoutPassword(config, resolvedUrl), code, message, suggestion);
}

function feishuInput(config: FeishuConfig): FeishuCliConnectorInput {
  return {
    cliPath: config.cliPath,
    profile: config.profile,
    appId: config.appId
  };
}

function feishuFailure(config: FeishuConfig, code: FeishuVerificationErrorCode, message: string, suggestion: string) {
  return createFeishuValidationFailureReport(feishuInput(config), code, message, suggestion);
}

function safeFeishuConsentUrl(value: string): string {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase();
  const allowed = FEISHU_AUTHORIZATION_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (parsed.protocol !== "https:" || !allowed || parsed.username || parsed.password) {
    throw new Error("飞书授权链接未通过安全校验，已阻止自动打开。");
  }
  return parsed.toString();
}

async function openFeishuConsentUrl(value: string): Promise<void> {
  const safeUrl = safeFeishuConsentUrl(value);
  await shell.openExternal(safeUrl);
}

function modelProviderInputWithoutKey(provider: ApiProviderConfig): Omit<ModelProviderConnectorInput, "apiKey"> {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    catalogMode: "remote-with-manual-fallback",
    testModelId: provider.testModelId ?? "",
    manualModelIds: provider.manualModelIds ?? []
  };
}

function modelProviderFailure(provider: ApiProviderConfig, code: ModelProviderVerificationErrorCode, message: string, suggestion: string) {
  return createModelProviderValidationFailureReport(modelProviderInputWithoutKey(provider), code, message, suggestion);
}

function codexInput(config: ProjectConfig): CodexCliConnectorInput {
  return {
    integrationType: config.codex.integrationType,
    executablePath: config.codex.executablePath,
    workspaceRoot: path.resolve(config.localStorage.workspaceRoot || "local-data/workbench")
  };
}

function codexFailure(config: ProjectConfig, code: CodexVerificationErrorCode, message: string, suggestion: string) {
  return createCodexValidationFailureReport(codexInput(config), code, message, suggestion);
}

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isDemoAdtHost(url: string): boolean {
  try {
    const host = normalizedHostname(new URL(url).hostname);
    return host === "sap-demo.example.com" || host === "fake-sap.local" || host === "fake-sap.test";
  } catch {
    return false;
  }
}

function validateFeishuConfig(config: FeishuConfig): { ok: true } | { ok: false; code: FeishuVerificationErrorCode; message: string; suggestion: string } {
  if (/[\u0000-\u001f\u007f]/.test(config.cliPath) || /^https?:\/\//i.test(config.cliPath.trim())) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "飞书 CLI 路径格式不安全。",
      suggestion: "请使用自动识别到的 lark-cli 路径，不要填写 URL 或带控制字符的内容。"
    };
  }

  const cliText = config.cliPath.trim();
  const cliName = cliText ? path.basename(cliText).toLowerCase() : "";
  const allowedRealCliCommands = new Set(["lark-cli", "lark-cli.cmd", "lark-cli.exe", "feishu-cli", "feishu-cli.cmd", "feishu-cli.exe"]);
  const fakeCliAllowed = process.env.WORKBENCH_ALLOW_FAKE_FEISHU_CLI === "1";
  if (cliName === "fake-lark-cli" && !fakeCliAllowed) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "演示飞书 CLI 只允许开发自测使用。",
      suggestion: "请把 CLI 配置改为 lark-cli 或 feishu-cli；正式配置不会执行 fake-lark-cli。"
    };
  }

  if (cliName && cliName !== "fake-lark-cli" && !allowedRealCliCommands.has(cliName)) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "当前只允许验证 lark-cli 或 feishu-cli。",
      suggestion: "请点击自动识别 CLI，系统会使用检测到的飞书 CLI 路径；本功能不会执行任意本地程序。"
    };
  }

  if (config.profile.trim() && !/^[A-Za-z0-9._-]{1,80}$/.test(config.profile.trim())) {
    return {
      ok: false,
      code: "missing-config",
      message: "飞书 Profile 名称格式不支持。",
      suggestion: "请使用 1-80 位英文、数字、点、下划线或短横线作为 Profile 名称。"
    };
  }

  if (config.appId.trim() && !/^cli_[A-Za-z0-9]+$/.test(config.appId.trim())) {
    return {
      ok: false,
      code: "missing-config",
      message: "飞书 App ID 格式不正确。",
      suggestion: "请填写飞书开发者后台里的 App ID，通常以 cli_ 开头；App Secret 请填在单独的密钥输入框。"
    };
  }

  return { ok: true };
}

function validateCodexConfig(config: CodexConfig): { ok: true } | { ok: false; code: CodexVerificationErrorCode; message: string; suggestion: string } {
  if (config.integrationType !== "cli") {
    return {
      ok: false,
      code: "unsupported-integration",
      message: "当前只支持本机 Codex CLI 接入。",
      suggestion: "请先使用本机 Codex 命令；SDK 接入后续作为可替换执行器扩展。"
    };
  }

  if (!config.executablePath.trim()) {
    return {
      ok: false,
      code: "missing-config",
      message: "Codex 命令位置还没有填写。",
      suggestion: "通常保持默认 codex 即可；系统会自动识别 codex.cmd 或 codex.exe。"
    };
  }

  if (/[\u0000-\u001f\u007f]/.test(config.executablePath) || /^https?:\/\//i.test(config.executablePath.trim())) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "Codex 命令位置格式不安全。",
      suggestion: "请填写 codex，或使用自动识别到的 codex.cmd/codex.exe 路径，不要填写 URL 或带控制字符的内容。"
    };
  }

  const cliName = path.basename(config.executablePath.trim()).toLowerCase();
  const allowedCodexCommands = new Set(["codex", "codex.cmd", "codex.exe"]);
  if (!allowedCodexCommands.has(cliName)) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "当前只允许验证 codex 命令。",
      suggestion: "请把执行路径设置为 codex，或自动识别到的 codex.cmd/codex.exe；本功能不会执行任意本地程序。"
    };
  }

  if (process.platform === "win32" && /[&|<>^]/.test(config.executablePath)) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "Codex 命令位置包含不安全字符。",
      suggestion: "请使用自动识别到的 codex 路径，不要拼接命令参数或脚本。"
    };
  }

  return { ok: true };
}

type AdtConfigCheck =
  | { ok: true; candidates: AdtEndpointCandidate[] }
  | { ok: false; code: AdtVerificationErrorCode; message: string; suggestion: string; resolvedUrl?: string };

async function validateAdtConfig(config: ProjectConfig): Promise<AdtConfigCheck> {
  const missing = [
    ["系统别名", config.adt.alias],
    ["System ID", config.adt.systemId],
    ["SAP GUI 地址 / ADT 地址", config.adt.url],
    ["Client", config.adt.client],
    ["用户", config.adt.username],
    ["语言", config.adt.language]
  ].filter(([, value]) => typeof value !== "string" || value.trim().length === 0).map(([label]) => label);

  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing-config",
      message: `ADT 配置不完整：${missing.join("、")} 还没有填写。`,
      suggestion: "请先补齐 SAP 只读配置；地址可以直接填写 SAP GUI 中的应用服务器，也可以填写完整 ADT 地址。"
    };
  }
  if (!/^[A-Z0-9]{3}$/.test(config.adt.systemId.trim().toUpperCase())) {
    return {
      ok: false,
      code: "missing-config",
      message: "System ID（SID）必须是 3 位字母或数字。",
      suggestion: "请按 SAP Logon 中的系统标识填写，例如 DS4、QS4 或 PS4。"
    };
  }
  if (config.adt.instanceNumber && !/^\d{2}$/.test(config.adt.instanceNumber)) {
    return {
      ok: false,
      code: "missing-config",
      message: "SAP 实例编号必须是两位数字。",
      suggestion: "请填写例如 00 或 02；也可以从本机 SAP Logon 导入。"
    };
  }
  if (!/^\d{3}$/.test(config.adt.client)) {
    return {
      ok: false,
      code: "missing-config",
      message: "SAP Client 必须是 3 位数字。",
      suggestion: "请填写例如 200、610 或 800。"
    };
  }

  let candidates: AdtEndpointCandidate[] = [];
  try {
    candidates = await resolveAdtEndpointCandidates(config.adt.url, { instanceNumber: config.adt.instanceNumber });
  } catch (error) {
    return {
      ok: false,
      code: "invalid-url",
      message: "SAP 地址格式不正确。",
      suggestion: error instanceof Error ? error.message : "请填写 SAP GUI 主机名，或完整的 HTTP/HTTPS ADT 地址。"
    };
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "invalid-url",
      message: "SAP 地址无法推导 ADT 连接。",
      suggestion: "请填写两位实例编号（例如 02），或从 SAP Logon 导入；完整 ADT 地址也可以直接填写，例如 https://sap-host:44302。"
    };
  }

  if (config.adt.instanceNumber && /^https:\/\//i.test(config.adt.url.trim())) {
    try {
      const explicitPort = new URL(config.adt.url.trim()).port;
      const portInstance = /^443\d{2}$/.test(explicitPort) ? explicitPort.slice(-2) : "";
      if (portInstance && portInstance !== config.adt.instanceNumber) {
        return {
          ok: false,
          code: "invalid-url",
          message: `ADT 地址端口对应实例 ${portInstance}，与填写的实例编号 ${config.adt.instanceNumber} 不一致。`,
          suggestion: "请统一实例编号和 HTTPS 端口；例如实例 02 通常使用 44302。"
        };
      }
    } catch {
      // URL validity is reported by the endpoint resolver above.
    }
  }

  if (config.adt.readOnly !== true) {
    return {
      ok: false,
      code: "readonly-disabled",
      message: "当前 ADT 写入模式没有锁定为只读。",
      suggestion: "MVP 只允许只读验证，请保持 ADT 写入模式为只读锁定。",
      resolvedUrl: candidates[0].url
    };
  }

  if (config.adt.credential.state !== "set-in-secure-store") {
    return {
      ok: false,
      code: "missing-credential",
      message: "当前项目还没有保存 SAP 密码到系统安全存储。",
      suggestion: "请先保存或替换 SAP 密码；保存后仍需再次执行只读验证。",
      resolvedUrl: candidates[0].url
    };
  }

  return { ok: true, candidates };
}

function projectConfigForAdtConnection(config: ProjectConfig, connection: AdtConfig): ProjectConfig {
  return { ...config, adt: { ...connection }, activeAdtConnectionId: connection.id };
}

function validateModelProvider(provider: ApiProviderConfig): { ok: true } | { ok: false; code: ModelProviderVerificationErrorCode; message: string; suggestion: string } {
  const missing = [
    ["渠道名称", provider.name],
    ["Base URL", provider.baseUrl]
  ].filter(([, value]) => typeof value !== "string" || value.trim().length === 0).map(([label]) => label);

  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing-config",
      message: `模型渠道配置不完整：${missing.join("、")} 还没有填写。`,
      suggestion: "请先填写渠道名称和 Base URL，并保存后再验证模型渠道。"
    };
  }

  try {
    const parsed = new URL(provider.baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("不支持的模型服务协议");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return {
        ok: false,
        code: "invalid-base-url",
        message: "模型 Base URL 不能包含账号、密码、查询参数或片段。",
        suggestion: "请只填写模型服务根地址，例如 https://api.example.com/v1，不要把 API Key 或参数放进 URL。"
      };
    }
    if (!isDemoModelHost(parsed.hostname) && parsed.protocol !== "https:") {
      return {
        ok: false,
        code: "invalid-base-url",
        message: "真实模型渠道必须使用 HTTPS。",
        suggestion: "请改用模型服务的 HTTPS 地址；本地、内网或明文 HTTP 地址不会携带 API Key 执行验证。"
      };
    }
    if (!isDemoModelHost(parsed.hostname) && isUnsafeModelHost(parsed.hostname)) {
      return {
        ok: false,
        code: "invalid-base-url",
        message: "模型 Base URL 指向本机、内网或云元数据地址，已阻止验证。",
        suggestion: "请填写公开模型服务的 HTTPS 根地址；本地调试渠道需要后续单独白名单能力。"
      };
    }
  } catch {
    return {
      ok: false,
      code: "invalid-base-url",
      message: "模型 Base URL 格式不正确。",
      suggestion: "请填写完整的 HTTP 或 HTTPS 地址，例如 https://api.example.com/v1。"
    };
  }

  if (provider.credential.state !== "set-in-secure-store") {
    return {
      ok: false,
      code: "missing-credential",
      message: "当前模型渠道还没有保存 API Key 到系统安全存储。",
      suggestion: "请先保存或替换 API Key；保存后仍需再次验证模型渠道。"
    };
  }

  return { ok: true };
}

async function saveProjectSecret(store: WorkspaceStore, secretStore: SecureSecretStore, projectId: string, input: unknown): Promise<WorkbenchState> {
  if (!input || typeof input !== "object") {
    throw new Error("密钥保存请求无效。");
  }
  const candidate = input as Partial<ProjectSecretInput>;
  if (typeof candidate.value !== "string") {
    throw new Error("请输入需要保存到系统安全存储的密钥。");
  }
  const { target, existingRef } = await store.prepareProjectSecret(projectId, candidate.target);
  const secretScope = target.kind === "adt-password" || target.kind === "mcp-header"
    ? projectId
    : WORKSPACE_SHARED_SECRET_SCOPE;
  const handle = await secretStore.save(secretScope, target, candidate.value, existingRef);
  return store.attachProjectSecret(projectId, target, handle);
}

async function saveProjectConfig(store: WorkspaceStore, secretStore: SecureSecretStore, projectId: string, input: unknown): Promise<WorkbenchState> {
  const before = await store.getProjectConfig(projectId);
  const requestedIds = input && typeof input === "object" && Array.isArray((input as Partial<ProjectConfig>).adtConnections)
    ? new Set((input as Partial<ProjectConfig>).adtConnections?.flatMap((item) => typeof item?.id === "string" ? [item.id] : []) ?? [])
    : new Set(before.adtConnections.map((item) => item.id));
  const requestedRemovals = before.adtConnections.filter((item) => !requestedIds.has(item.id));
  if (requestedRemovals.length > 1) {
    throw new Error("一次只能移除一个 SAP 连接，请逐个确认后保存。");
  }
  const requestedProviderIds = input && typeof input === "object" && Array.isArray((input as Partial<ProjectConfig>).apiProviders)
    ? new Set((input as Partial<ProjectConfig>).apiProviders?.flatMap((item) => typeof item?.id === "string" ? [item.id] : []) ?? [])
    : new Set(before.apiProviders.map((item) => item.id));
  const requestedProviderRemovals = before.apiProviders.filter((item) => !requestedProviderIds.has(item.id));
  if (requestedProviderRemovals.length > 1) {
    throw new Error("一次只能移除一个模型渠道，请逐个确认后保存。");
  }

  const state = await store.saveProjectConfig(projectId, input);
  const project = state.projects.find((item) => item.id === projectId);
  const savedIds = new Set(project?.config.adtConnections.map((item) => item.id) ?? []);
  const removed = before.adtConnections.filter((item) => !savedIds.has(item.id));
  if (removed.length > 1) {
    throw new Error("检测到多个 SAP 连接被同时移除，已停止自动清理密钥。");
  }
  if (removed[0]) {
    await secretStore.removeProjectTarget(projectId, { kind: "adt-password", connectionId: removed[0].id });
  }
  const savedProviderIds = new Set(project?.config.apiProviders.map((item) => item.id) ?? []);
  const removedProviders = before.apiProviders.filter((item) => !savedProviderIds.has(item.id));
  if (removedProviders.length > 1) {
    throw new Error("检测到多个模型渠道被同时移除，已停止自动清理密钥。");
  }
  if (removedProviders[0]) {
    await secretStore.removeProjectTarget(WORKSPACE_SHARED_SECRET_SCOPE, { kind: "api-key", providerId: removedProviders[0].id });
  }
  return state;
}

function adtReportScore(report: AdtVerificationReport): number {
  if (report.ok) return 3;
  if (report.connectionStatus === "verified") return 2;
  if (report.steps.some((step) => step.id === "config" && step.status === "passed")) return 1;
  return 0;
}

async function verifyAdtCandidate(
  connector: ReturnType<typeof createAdtReadonlyConnector>,
  config: ProjectConfig,
  candidate: AdtEndpointCandidate,
  password: string
): Promise<AdtVerificationReport> {
  return connector.verify({ ...adtInputWithoutPassword(config, candidate.url), password });
}

async function verifyAdtReadonly(store: WorkspaceStore, secretStore: SecureSecretStore, projectId: unknown): Promise<AdtVerificationResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error("ADT 只读验证请求缺少项目 ID。");
  }
  const config = await store.getProjectConfig(projectId);
  const connectionId = config.adt.id;
  const verificationSequence = store.beginAdtVerification(projectId, connectionId);
  const configCheck = await validateAdtConfig(config);
  if (!configCheck.ok) {
    const report = adtValidationFailure(config, configCheck.code, configCheck.message, configCheck.suggestion, configCheck.resolvedUrl);
    const state = await store.updateAdtVerification(projectId, connectionId, verificationSequence, config.adt, report);
    return { report, state };
  }

  let password = "";
  try {
    password = await secretStore.resolveProjectSecret(projectId, { kind: "adt-password", connectionId: config.adt.id });
  } catch {
    const report = adtValidationFailure(
      config,
      "secret-unavailable",
      "系统安全存储里的 SAP 密码无法读取。",
      "请重新保存当前项目 SAP 密码，然后再执行只读验证。",
      configCheck.candidates[0].url
    );
    const state = await store.updateAdtVerification(projectId, connectionId, verificationSequence, config.adt, report);
    return { report, state };
  }

  const connector = createAdtReadonlyConnector();
  let report = await verifyAdtCandidate(connector, config, configCheck.candidates[0], password);
  for (const candidate of configCheck.candidates.slice(1)) {
    if (report.ok) break;
    const nextReport = await verifyAdtCandidate(connector, config, candidate, password);
    if (adtReportScore(nextReport) > adtReportScore(report)) {
      report = nextReport;
    }
  }
  const state = await store.updateAdtVerification(projectId, connectionId, verificationSequence, config.adt, report);
  return { report, state };
}

async function verifyAdtReadonlyWithConsent(event: IpcMainInvokeEvent, store: WorkspaceStore, secretStore: SecureSecretStore, projectId: unknown): Promise<AdtVerificationResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error("ADT 只读验证请求缺少项目 ID。");
  }
  const config = await store.getProjectConfig(projectId);
  if (config.adt.sslMode === "skip-certificate") {
    const options = {
      type: "warning" as const,
      title: "确认跳过 SAP 证书校验",
      message: "当前连接将跳过 TLS 证书真实性校验。是否继续发送 SAP 登录凭据并执行只读验证？",
      detail: "仅应在受控企业内网和已确认的 SAP 主机上使用。恶意代理或错误主机可能截获用户名和密码；有受信任证书时请改用“严格校验”。",
      buttons: ["取消", "确认并验证"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const confirmation = parentWindow
      ? await dialog.showMessageBox(parentWindow, options)
      : await dialog.showMessageBox(options);
    if (confirmation.response !== 1) throw new Error("已取消跳过证书校验的 SAP 只读验证；其他功能不受影响。");
  }
  return verifyAdtReadonly(store, secretStore, projectId);
}

async function verifyFeishuCli(store: WorkspaceStore, projectId: unknown): Promise<FeishuVerificationResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error("飞书 CLI 验证请求缺少项目 ID。");
  }
  const config = await store.getProjectConfig(projectId);
  const configCheck = validateFeishuConfig(config.feishu);
  if (!configCheck.ok) {
    const report = feishuFailure(config.feishu, configCheck.code, configCheck.message, configCheck.suggestion);
    const state = await store.updateFeishuVerification(projectId, report);
    return { report, state };
  }

  const connector = createFeishuCliConnector(config.feishu);
  const report = await connector.verify(feishuInput(config.feishu), {
    startUserAuthOnFailure: true,
    openConsentUrl: openFeishuConsentUrl
  });
  const state = await store.updateFeishuVerification(projectId, report);
  return { report, state };
}

async function setupFeishuCliProfile(store: WorkspaceStore, secretStore: SecureSecretStore, projectId: unknown): Promise<FeishuCliProfileSetupResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error("飞书 Profile 写入请求缺少项目 ID。");
  }
  const config = await store.getProjectConfig(projectId);
  if (!config.feishu.appId.trim() || !config.feishu.profile.trim()) {
    return {
      checkedAt: new Date().toISOString(),
      ok: false,
      profile: config.feishu.profile || "未填写",
      appIdMasked: config.feishu.appId ? `${config.feishu.appId.slice(0, 8)}***` : "未填写",
      message: "飞书 App ID 或 Profile 未填写。",
      errors: [{
        code: "missing-config",
        message: "飞书 App ID 或 Profile 未填写。",
        suggestion: "请先填写 App ID 和 Profile，再保存配置。"
      }]
    };
  }

  let appSecret = "";
  try {
    appSecret = await secretStore.resolveWorkspaceSharedSecret(
      { kind: "feishu-token" },
      config.feishu.credential.secretRef,
      projectId
    );
  } catch {
    return {
      checkedAt: new Date().toISOString(),
      ok: false,
      profile: config.feishu.profile,
      appIdMasked: `${config.feishu.appId.slice(0, 8)}***`,
      message: "飞书 App Secret 还没有保存。",
      errors: [{
        code: "missing-config",
        message: "飞书 App Secret 还没有保存。",
        suggestion: "请填写 App Secret 后点击保存配置。"
      }]
    };
  }

  return saveFeishuCliProfile({
    cliPath: config.feishu.cliPath,
    profile: config.feishu.profile,
    appId: config.feishu.appId,
    appSecret
  });
}

async function openFeishuDeveloperConsole(): Promise<{ opened: true; url: string }> {
  await shell.openExternal(FEISHU_DEVELOPER_CONSOLE_URL);
  return { opened: true, url: FEISHU_DEVELOPER_CONSOLE_URL };
}

async function installFeishuCliWithConsent(): Promise<FeishuCliInstallResult> {
  const confirmation = await dialog.showMessageBox({
    type: "question",
    title: "确认安装 Feishu/Lark CLI",
    message: "是否允许工作台在本机安装 Feishu/Lark CLI？",
    detail: "安装只用于可选的 Feishu/Lark 文档连接；取消不会影响 Work、Chat、SAP、AI 模型、规范或知识库。",
    buttons: ["取消", "确认安装"],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) {
    return {
      checkedAt: new Date().toISOString(),
      ok: false,
      cliPath: null,
      installDir: null,
      version: null,
      message: "已取消安装 Feishu/Lark CLI，其他功能不受影响。",
      errors: []
    };
  }
  return installFeishuCli();
}

async function installLocalAiCapabilityWithConsent(event: IpcMainInvokeEvent, input: unknown): Promise<LocalAiInstallResult> {
  const parsed = parseLocalAiInstallInput(input);
  const options = {
    type: "question" as const,
    title: "确认修复或更新 Codex CLI",
    message: "是否允许工作台安装、修复或更新 Codex CLI？",
    detail: "确认后将通过官方 npm install -g @openai/codex 安装最新可用版本。取消不会报错，也不会影响 Work、Chat、SAP、模型、规范或知识库等核心功能。",
    buttons: ["取消", "确认修复或更新"],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  };
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const confirmation = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  if (confirmation.response !== 1) {
    return {
      checkedAt: new Date().toISOString(),
      capabilityId: parsed.capabilityId,
      status: "cancelled",
      installed: false,
      version: null,
      pathLabel: null,
      message: "已取消安装 Codex CLI，工作台核心功能不受影响。"
    };
  }
  return installLocalAiCapability(parsed);
}

async function verifyModelProvider(store: WorkspaceStore, secretStore: SecureSecretStore, projectId: unknown, providerId: unknown): Promise<ModelProviderVerificationResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0 || typeof providerId !== "string" || providerId.trim().length === 0) {
    throw new Error("模型渠道验证请求缺少项目或渠道 ID。");
  }
  const provider = await store.getApiProviderConfig(projectId, providerId);
  const verificationSequence = store.beginModelProviderVerification(projectId, providerId);
  const configCheck = validateModelProvider(provider);
  if (!configCheck.ok) {
    const report = modelProviderFailure(provider, configCheck.code, configCheck.message, configCheck.suggestion);
    const state = await store.updateModelProviderVerification(projectId, providerId, verificationSequence, provider, report);
    return { report, state };
  }

  try {
    await assertPublicModelEndpoint(provider.baseUrl);
  } catch (error) {
    const report = modelProviderFailure(
      provider,
      "invalid-base-url",
      safeErrorMessage(error),
      "请使用解析到公开网络地址的 HTTPS 模型服务；系统不会向本机、内网或重定向目标发送 API Key。"
    );
    const state = await store.updateModelProviderVerification(projectId, providerId, verificationSequence, provider, report);
    return { report, state };
  }

  let apiKey = "";
  try {
    apiKey = await secretStore.resolveWorkspaceSharedSecret(
      { kind: "api-key", providerId },
      provider.credential.secretRef,
      projectId
    );
  } catch {
    const report = modelProviderFailure(
      provider,
      "secret-unavailable",
      "系统安全存储里的 API Key 无法读取。",
      "请重新保存当前模型渠道的 API Key，然后再执行验证。"
    );
    const state = await store.updateModelProviderVerification(projectId, providerId, verificationSequence, provider, report);
    return { report, state };
  }

  const connector = createModelProviderConnector(provider.baseUrl, provider.providerType);
  const report = await connector.verify({ ...modelProviderInputWithoutKey(provider), apiKey });
  const state = await store.updateModelProviderVerification(projectId, providerId, verificationSequence, provider, report);
  return { report, state };
}

async function verifyCodexCli(store: WorkspaceStore, projectId: unknown): Promise<CodexVerificationResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error("Codex 验证请求缺少项目 ID。");
  }
  const config = await store.getProjectConfig(projectId);
  const configCheck = validateCodexConfig(config.codex);
  if (!configCheck.ok) {
    const report = codexFailure(config, configCheck.code, configCheck.message, configCheck.suggestion);
    const state = await store.updateCodexVerification(projectId, report);
    return { report, state };
  }

  const connector = createCodexCliConnector();
  const report = await connector.verify(codexInput(config));
  const state = await store.updateCodexVerification(projectId, report);
  return { report, state };
}

async function appendCaseMessage(
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  agentContextService: AgentContextService,
  agentToolService: AgentToolService,
  requestId: string,
  agentTurnId: string,
  input: unknown,
  onDelta?: ModelDeltaHandler,
  signal?: AbortSignal,
  onToolEvent?: (event: ModelToolLoopEvent) => void | Promise<void>
): Promise<{ state: WorkbenchState; modelFailed: boolean; modelErrorMessage: string | null }> {
  const targetedInput = await store.bindCaseWorkflowTarget(input);
  const threadId = targetedInput.threadId;
  const projectId = targetedInput.projectId;
  const caseId = targetedInput.caseId;
  if (!threadId || !projectId || !caseId) throw new Error("当前任务缺少 Project、工作文件夹或会话标识。");
  const workflowKey = `${targetedInput.projectId}:${targetedInput.caseId}`;
  return caseWorkflowQueue.run(workflowKey, async () => {
    const prepared = await store.prepareSafeModelDraftRequest(targetedInput, {
      allowFakeModelExecution: process.env.WORKBENCH_ALLOW_FAKE_MODEL_EXECUTION === "1"
    });
    let modelDraft: SafeModelDraftRun | undefined;
    let codexAssist: CodexCaseAssistRun | undefined;

  if (prepared) {
    let effectiveContext = prepared.context;
    try {
      const conversationMessages = await store.getWorkAgentContextHistory(threadId);
      const projectConfig = await store.getProjectConfig(projectId);
      const preparedProvider = projectConfig.apiProviders.find((provider) => provider.id === prepared.providerId);
      const contextModel = preparedProvider?.models
        .find((model) => model.id === prepared.modelId);
      const assembledContext = await agentContextService.build({
        requestId,
        target: {
          threadId,
          projectId,
          caseId
        },
        userContent: targetedInput.content,
        conversationMessages,
        contextWindowTokens: contextModel?.contextWindowTokens,
        reservedOutputTokens: contextModel?.maxOutputTokens ? Math.min(1_200, contextModel.maxOutputTokens) : 1_200
      });
      effectiveContext = applyAgentContextToSafeModelDraft(prepared.context, assembledContext);
      await assertPublicModelEndpoint(prepared.baseUrl);
      const apiKey = await secretStore.resolveWorkspaceSharedSecret(
        { kind: "api-key", providerId: prepared.providerId },
        preparedProvider?.credential.secretRef ?? null,
        prepared.projectId
      );
      const connector = createModelProviderConnector(prepared.baseUrl, prepared.providerType);
      const toolSession = await agentToolService.createSession(
        { threadId, projectId, caseId },
        { userContent: targetedInput.content }
      );
      let emittedDelta = false;
      let toolActivityStarted = false;
      const generate = (modelId: string) => connector.generateSafeDraft({
        id: prepared.providerId,
        name: prepared.providerName,
        providerType: prepared.providerType,
        baseUrl: prepared.baseUrl,
        apiKey,
        modelId,
        context: effectiveContext,
        toolSession,
        onToolEvent: async (event) => {
          if (event.type === "tool-call" || event.type === "tool-result") toolActivityStarted = true;
          await onToolEvent?.(event);
        },
        signal,
        onDelta: onDelta ? (delta) => {
          emittedDelta = true;
          onDelta(delta, prepared.providerName, modelId);
        } : undefined
      });
      let draft: Awaited<ReturnType<typeof generate>>;
      try {
        draft = await generate(prepared.modelId);
      } catch (error) {
        const config = await store.getProjectConfig(prepared.projectId);
        const provider = config.apiProviders.find((item) => item.id === prepared.providerId);
        const fallbackModelId = provider?.lastVerifiedModelId;
        if (!emittedDelta && !toolActivityStarted && fallbackModelId && fallbackModelId !== prepared.modelId && mayRetryWithVerifiedModel(error)) {
          draft = await generate(fallbackModelId);
        } else {
          throw error;
        }
      }
      modelDraft = {
        status: "success",
        providerName: safeModelDraftDisplayValue("模型渠道", prepared.providerName, "已验证模型渠道"),
        modelId: safeModelDraftDisplayValue("模型名称", draft.modelId, "已验证模型"),
        generatedAt: draft.generatedAt,
        content: draft.content,
        contextAudit: effectiveContext.audit
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      modelDraft = {
        status: "failed",
        providerName: safeModelDraftDisplayValue("模型渠道", prepared.providerName, "已验证模型渠道"),
        modelId: safeModelDraftDisplayValue("模型名称", prepared.modelId, "已验证模型"),
        generatedAt: new Date().toISOString(),
        errorMessage: safeErrorMessage(error),
        contextAudit: effectiveContext.audit
      };
    }
  }

  if (wantsCodexCaseAssist(targetedInput)) {
    try {
      const preparedCodex = await store.prepareCodexCaseAssistRequest(targetedInput);
      if (preparedCodex) {
        codexAssist = await createCodexCliConnector().runCaseAssist({
          integrationType: preparedCodex.integrationType,
          executablePath: preparedCodex.executablePath,
          workspaceRoot: preparedCodex.workspaceRoot,
          context: preparedCodex.context
        });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      codexAssist = codexCaseAssistFailure(error);
    }
  }

    signal?.throwIfAborted();
    const state = await store.appendMessage(targetedInput, modelDraft, codexAssist, agentTurnId);
    return {
      state,
      modelFailed: modelDraft?.status === "failed",
      modelErrorMessage: modelDraft?.status === "failed" ? modelDraft.errorMessage : null
    };
  }, signal);
}

function isProviderReadyForDailyChat(provider: ApiProviderConfig): boolean {
  return (
    provider.enabled &&
    provider.credential.state === "set-in-secure-store" &&
    provider.modelSyncStatus === "verified" &&
    provider.chatTestStatus === "verified" &&
    provider.lastVerificationMode === "http" &&
    provider.models.length > 0
  );
}

async function prepareDailyChatAssistantReply(
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  agentContextService: AgentContextService,
  requestId: string,
  request: AppendDailyChatMessageInput,
  onDelta?: ModelDeltaHandler,
  signal?: AbortSignal
): Promise<DailyChatAssistantReply | undefined> {
  if (!request.projectId || !request.providerId || !request.content.trim()) return undefined;
  try {
    const projectId = request.projectId;
    const config = await store.getProjectConfig(projectId);
    const provider = config.apiProviders.find((item) => item.id === request.providerId);
    if (!provider || !isProviderReadyForDailyChat(provider)) return undefined;
    const modelId = request.modelId ?? provider.lastVerifiedModelId ?? provider.models.find(isChatCapableModel)?.id;
    const selectedModel = provider.models.find((model) => model.id === modelId);
    if (!modelId || !isChatCapableModel(selectedModel)) return undefined;
    await assertPublicModelEndpoint(provider.baseUrl);
    const apiKey = await secretStore.resolveWorkspaceSharedSecret(
      { kind: "api-key", providerId: provider.id },
      provider.credential.secretRef,
      projectId
    );
    const connector = createModelProviderConnector(provider.baseUrl, provider.providerType);
    const conversationMessages = await store.getDailyChatAgentContextHistory(request.threadId, projectId, provider.id);
    const assembledContext = await agentContextService.build({
      requestId,
      target: {
        threadId: request.threadId ?? `daily-${requestId}`,
        projectId: null,
        caseId: null
      },
      userContent: request.content,
      conversationMessages,
      contextWindowTokens: selectedModel?.contextWindowTokens,
      reservedOutputTokens: selectedModel?.maxOutputTokens ? Math.min(1_200, selectedModel.maxOutputTokens) : 1_200
    });
    let emittedDelta = false;
    const generate = async (activeModelId: string) => {
      return connector.generateDailyChat({
        ...modelProviderInputWithoutKey(provider),
        apiKey,
        modelId: activeModelId,
        content: request.content,
        systemInstructions: assembledContext.instructions,
        confirmedContext: assembledContext.items
          .filter((item) => item.kind !== "recent-message")
          .map((item) => item.content),
        history: assembledContext.history.map(({ role, content }) => ({ role, content })),
        signal,
        onDelta: onDelta ? (delta) => {
          emittedDelta = true;
          onDelta(delta, provider.name, activeModelId);
        } : undefined
      });
    };
    let result: Awaited<ReturnType<typeof generate>>;
    try {
      result = await generate(modelId);
    } catch (error) {
      const fallbackModelId = provider.lastVerifiedModelId;
      if (!emittedDelta && fallbackModelId && fallbackModelId !== modelId && mayRetryWithVerifiedModel(error)) {
        result = await generate(fallbackModelId);
      } else {
        throw error;
      }
    }
    return {
      content: result.content,
      modelId: result.modelId,
      responseMode: "model-success",
      projectId,
      providerId: provider.id,
      providerName: provider.name
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      content: `模型调用失败：${safeErrorMessage(error)}。你的问题已作为本地日常对话记录保存。`,
      modelId: request.modelId ?? "local-chat",
      responseMode: "model-failed",
      projectId: request.projectId,
      providerId: request.providerId,
      providerName: "所选模型渠道"
    };
  }
}

async function appendDailyChatMessage(
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  agentContextService: AgentContextService,
  requestId: string,
  agentTurnId: string,
  input: unknown,
  onDelta?: ModelDeltaHandler,
  signal?: AbortSignal
): Promise<WorkbenchState> {
  const parsedInput = parseAppendDailyChatMessageInput(input);
  const workflowKey = `daily-chat:${parsedInput.threadId ?? "active"}`;
  return caseWorkflowQueue.run(workflowKey, async () => {
    const assistantReply = await prepareDailyChatAssistantReply(store, secretStore, agentContextService, requestId, parsedInput, onDelta, signal);
    signal?.throwIfAborted();
    return store.appendDailyChatMessage(parsedInput, assistantReply, agentTurnId);
  }, signal);
}

async function runTrackedCaseMessage(
  runtime: AgentRuntime,
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  agentContextService: AgentContextService,
  agentToolService: AgentToolService,
  requestId: string,
  input: unknown,
  onDelta?: ModelDeltaHandler,
  recoveryOfTurnId?: string
): Promise<WorkbenchState> {
  const target = await store.bindCaseWorkflowTarget(input);
  if (!target.threadId || !target.projectId || !target.caseId) throw new Error("当前任务缺少 Project、工作文件夹或会话标识。");
  assertNoSensitiveCaseContent(target.content);
  return runtime.runTurn({
    requestId,
    scope: "work",
    legacyThreadId: target.threadId,
    projectId: target.projectId,
    caseId: target.caseId,
    providerId: target.providerId ?? null,
    modelId: target.modelId || null,
    userContent: target.content,
    resumeInput: target as unknown as Record<string, unknown>,
    recoveryOfTurnId: recoveryOfTurnId ?? null
  }, async ({ signal, turn, emitDelta, emitItem }) => {
    if (target.rewindRevisionId) {
      await emitItem("conversation-rewind", { revisionId: target.rewindRevisionId }, `${turn.id}:conversation-rewind`);
    }
    const execution = await appendCaseMessage(store, secretStore, agentContextService, agentToolService, requestId, turn.id, target, (delta, providerName, modelId) => {
      emitDelta(delta, providerName, modelId);
      onDelta?.(delta, providerName, modelId);
    }, signal, async (event) => {
      if (event.type === "tool-call") {
        const argumentJson = JSON.stringify(event.call.arguments);
        await emitItem("tool-call", {
          callId: event.call.callId,
          toolName: event.call.name,
          argumentKeys: Object.keys(event.call.arguments).slice(0, 40),
          argumentBytes: Buffer.byteLength(argumentJson, "utf8"),
          argumentsValid: !event.call.argumentsError
        }, `${turn.id}:tool-call:${event.call.callId}`);
        return;
      }
      if (event.type === "tool-decision") {
        await emitItem("tool-decision", {
          callId: event.callId,
          toolName: event.toolName,
          outcome: event.outcome,
          message: event.message
        }, `${turn.id}:tool-decision:${event.callId}`);
        return;
      }
      await emitItem("tool-result", {
        callId: event.result.callId,
        toolName: event.result.name,
        content: event.result.content.slice(0, 12_000),
        isError: event.result.isError,
        trust: event.result.trust
      }, `${turn.id}:tool-result:${event.result.callId}`);
    });
    const state = execution.state;
    await agentContextService.captureExplicitUserMemory({
      requestId,
      target: { threadId: target.threadId!, projectId: target.projectId!, caseId: target.caseId! },
      userContent: target.content
    }).catch(() => null);
    const thread = state.workThreads.find((item) => item.id === target.threadId);
    const assistant = thread ? [...thread.messages].reverse().find((message) => message.role === "assistant" && message.agentTurnId === turn.id) : undefined;
    const project = state.projects.find((item) => item.id === target.projectId);
    const providerName = project?.config.apiProviders.find((item) => item.id === assistant?.providerId)?.name ?? null;
    return {
      value: state,
      assistantContent: assistant?.content ?? "",
      providerName,
      providerId: assistant?.providerId ?? target.providerId ?? null,
      modelId: assistant?.modelId ?? target.modelId ?? null,
      terminalStatus: execution.modelFailed ? "failed" : "completed",
      errorCode: execution.modelFailed ? "model-call-failed" : null,
      errorMessage: execution.modelErrorMessage,
      committed: true
    };
  });
}

async function runTrackedDailyChatMessage(
  runtime: AgentRuntime,
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  agentContextService: AgentContextService,
  requestId: string,
  input: unknown,
  onDelta?: ModelDeltaHandler,
  recoveryOfTurnId?: string
): Promise<WorkbenchState> {
  const request = parseAppendDailyChatMessageInput(input);
  const before = await store.getState();
  const legacyThreadId = request.threadId ?? before.activeChatThreadId;
  if (!legacyThreadId) throw new Error("当前日常对话缺少会话标识，请新建对话后重试。");
  return runtime.runTurn({
    requestId,
    scope: "chat",
    legacyThreadId,
    providerId: request.providerId ?? null,
    modelId: request.modelId ?? null,
    userContent: request.content,
    resumeInput: { ...request, threadId: legacyThreadId } as unknown as Record<string, unknown>,
    recoveryOfTurnId: recoveryOfTurnId ?? null
  }, async ({ signal, turn, emitDelta, emitItem }) => {
    if (request.rewindRevisionId) {
      await emitItem("conversation-rewind", { revisionId: request.rewindRevisionId }, `${turn.id}:conversation-rewind`);
    }
    const state = await appendDailyChatMessage(store, secretStore, agentContextService, requestId, turn.id, { ...request, threadId: legacyThreadId }, (delta, providerName, modelId) => {
      emitDelta(delta, providerName, modelId);
      onDelta?.(delta, providerName, modelId);
    }, signal);
    await agentContextService.captureExplicitUserMemory({
      requestId,
      target: { threadId: legacyThreadId, projectId: null, caseId: null },
      userContent: request.content
    }).catch(() => null);
    const thread = state.chatThreads.find((item) => item.id === legacyThreadId);
    const assistant = thread ? [...thread.messages].reverse().find((message) => message.role === "assistant" && message.agentTurnId === turn.id) : undefined;
    return {
      value: state,
      assistantContent: assistant?.content ?? "",
      providerName: assistant?.providerName ?? null,
      providerId: assistant?.providerId ?? request.providerId ?? null,
      modelId: assistant?.modelId ?? request.modelId ?? null,
      terminalStatus: assistant?.responseMode === "model-failed" ? "failed" : "completed",
      errorCode: assistant?.responseMode === "model-failed" ? "model-call-failed" : null,
      errorMessage: assistant?.responseMode === "model-failed" ? assistant.content : null,
      committed: true
    };
  });
}

async function readSapObjectEvidence(
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  input: unknown,
  target?: { projectId: string; caseId: string; threadId: string },
  signal?: AbortSignal
): Promise<SapObjectEvidenceResult> {
  const request = parseSapObjectEvidenceRequest(input);
  const { projectId, caseId, threadId, config } = target
    ? await store.getProjectWorkTargetConfig(target)
    : await store.getActiveProjectConfig();
  const runKey = `${projectId}\u0000${caseId}\u0000${threadId}`;
  if (activeSapEvidenceRuns.has(runKey)) {
    throw new Error("当前任务正在执行 SAP 只读取证，请等待完成后再试。");
  }
  activeSapEvidenceRuns.add(runKey);
  const controller = new AbortController();
  const cancelFromCaller = () => controller.abort();
  signal?.addEventListener("abort", cancelFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), SAP_EVIDENCE_TOTAL_TIMEOUT_MS);
  try {
  const allConnections = config.adtConnections.length > 0 ? config.adtConnections : [config.adt];
  let selectedConnections: AdtConfig[] = [];
  if (request.connectionMode === "manual") {
    const selectedIds = new Set(request.connectionIds ?? []);
    selectedConnections = allConnections.filter((connection) => selectedIds.has(connection.id));
    if (selectedConnections.length !== selectedIds.size) {
      throw new Error("所选 SAP 连接已不存在，请重新打开连接选择器确认。");
    }
  } else {
    const route = routeSapConnections(allConnections, request.queryContext ?? "", config.activeAdtConnectionId);
    if (route.connectionIds.length === 0) throw new Error(route.reason);
    if (route.needsConfirmation) {
      throw new Error(`${route.reason} 为避免读取错误系统，请先确认具体 SAP 连接。`);
    }
    const selectedIds = new Set(route.connectionIds);
    selectedConnections = allConnections.filter((connection) => selectedIds.has(connection.id));
  }
  if (selectedConnections.length === 0 || selectedConnections.length > 6) {
    throw new Error("本次 SAP 只读取证必须选择 1 至 6 个登录连接。");
  }

  const evidenceResults: SapObjectEvidenceConnectorResult[] = [];
  for (const connection of selectedConnections) {
    const scopedConfig = projectConfigForAdtConnection(config, connection);
    const configCheck = await validateAdtConfig(scopedConfig);
    if (!configCheck.ok) {
      throw new Error(`${connection.alias || connection.systemId || "SAP 连接"}：${configCheck.message} ${configCheck.suggestion}`);
    }
    if (connection.connectionStatus !== "verified" || connection.minimalReadStatus !== "verified") {
      throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 尚未完成 ADT 连接和 T000 最小读取验证。`);
    }

    const allowFakeEvidence = (
      process.env.WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE === "1" &&
      connection.lastVerificationMode === "fake" &&
      configCheck.candidates.some((candidate) => isDemoAdtHost(candidate.url))
    );
    const allowRealEvidence = connection.lastVerificationMode === "adt";
    if (!allowRealEvidence && !allowFakeEvidence) {
      throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 尚未完成真实 ADT 只读验证，已阻止读取对象证据。`);
    }

    let password = "";
    try {
      password = await secretStore.resolveProjectSecret(projectId, { kind: "adt-password", connectionId: connection.id });
    } catch {
      throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 在系统安全存储中没有可用密码，请重新保存并验证。`);
    }

    const connector = allowFakeEvidence ? new FakeAdtReadonlyConnector() : createAdtReadonlyConnector();
    let lastError: unknown = null;
    let evidenceResult: SapObjectEvidenceConnectorResult | null = null;
    for (const candidate of configCheck.candidates) {
      try {
        evidenceResult = await connector.readObjectEvidence({ ...adtInputWithoutPassword(scopedConfig, candidate.url), password }, request, {
          allowFakeEvidence,
          signal: controller.signal
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!evidenceResult) {
      throw lastError instanceof Error ? lastError : new Error(`${connection.alias || connection.systemId || "SAP 连接"} 的所有已解析 ADT 地址都无法读取对象证据。`);
    }
    evidenceResults.push(evidenceResult);
  }
  return store.appendSapObjectEvidenceBatch(evidenceResults, { projectId, caseId, threadId });
  } finally {
    signal?.removeEventListener("abort", cancelFromCaller);
    clearTimeout(timeout);
    activeSapEvidenceRuns.delete(runKey);
  }
}

async function readSapDataPreview(
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  input: SapDataPreviewRequest,
  target: { projectId: string; caseId: string; threadId: string },
  signal?: AbortSignal
): Promise<SapDataPreviewResult> {
  const request = parseSapDataPreviewRequest(input);
  const { projectId, caseId, threadId, config } = await store.getProjectWorkTargetConfig(target);
  if (config.agentTools.sapDataPreviewEnabled !== true) {
    throw new Error("SAP 通用 ADT 数据预览尚未获得当前 Project 的显式授权。请到配置中心 → AI 工具启用并保存。");
  }
  const runKey = `data-preview\u0000${projectId}\u0000${caseId}\u0000${threadId}`;
  if (activeSapEvidenceRuns.has(runKey)) throw new Error("当前任务正在读取 SAP 业务数据，请等待完成后再试。");
  activeSapEvidenceRuns.add(runKey);
  const controller = new AbortController();
  const cancelFromCaller = () => controller.abort();
  signal?.addEventListener("abort", cancelFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), SAP_EVIDENCE_TOTAL_TIMEOUT_MS);
  try {
    const allConnections = config.adtConnections.length > 0 ? config.adtConnections : [config.adt];
    const route = routeSapConnections(allConnections, request.queryContext ?? "", config.activeAdtConnectionId);
    if (route.connectionIds.length === 0) throw new Error(route.reason);
    if (route.needsConfirmation || route.connectionIds.length !== 1) {
      throw new Error(`${route.reason} 为避免读取错误生产系统，请在问题中明确 SID 或 Client 后重试。`);
    }
    const connection = allConnections.find((item) => item.id === route.connectionIds[0]);
    if (!connection) throw new Error("建议的 SAP 连接已不存在，请重新检查 Project 配置。");
    const scopedConfig = projectConfigForAdtConnection(config, connection);
    const configCheck = await validateAdtConfig(scopedConfig);
    if (!configCheck.ok) throw new Error(`${connection.alias || connection.systemId || "SAP 连接"}：${configCheck.message} ${configCheck.suggestion}`);
    if (connection.connectionStatus !== "verified" || connection.minimalReadStatus !== "verified" || connection.lastVerificationMode !== "adt") {
      throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 尚未完成真实 ADT 与 T000 只读验证。`);
    }
    let password = "";
    try {
      password = await secretStore.resolveProjectSecret(projectId, { kind: "adt-password", connectionId: connection.id });
    } catch {
      throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 在系统安全存储中没有可用密码，请重新保存并验证。`);
    }
    const connector = createAdtDataPreviewConnector();
    let connectorResult: SapDataPreviewConnectorResult | null = null;
    let lastError: unknown = null;
    for (const candidate of configCheck.candidates) {
      try {
        connectorResult = await connector.readDataPreview(
          { ...adtInputWithoutPassword(scopedConfig, candidate.url), password },
          request,
          controller.signal
        );
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!connectorResult) {
      const detail = lastError instanceof Error ? lastError.message : "所有已解析 ADT 地址均未返回结果。";
      throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 无法执行受控 ADT 数据预览：${detail} T000 通过只代表连接和元数据读取可用，请让 Basis 同时检查 /sap/bc/adt/datapreview/*、目标对象与当前账号的数据权限。`);
    }
    return store.appendSapDataPreview(connectorResult, { projectId, caseId, threadId });
  } finally {
    signal?.removeEventListener("abort", cancelFromCaller);
    clearTimeout(timeout);
    activeSapEvidenceRuns.delete(runKey);
  }
}

async function searchSapObjects(
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  target: { projectId: string; caseId: string; threadId: string },
  query: string,
  maxResults: number,
  queryContext: string,
  signal?: AbortSignal
): Promise<AdtObjectSearchResult> {
  const { projectId, config } = await store.getProjectWorkTargetConfig(target);
  if (config.agentTools.sapReadonlyEnabled !== true && config.agentTools.sapDataPreviewEnabled !== true) {
    throw new Error("SAP 对象搜索尚未获得当前客户项目的显式授权，请先在配置中心启用对应的 SAP 只读 AI 工具。");
  }
  const allConnections = config.adtConnections.length > 0 ? config.adtConnections : [config.adt];
  const route = routeSapConnections(allConnections, queryContext, config.activeAdtConnectionId);
  if (route.connectionIds.length === 0) throw new Error(route.reason);
  if (route.needsConfirmation || route.connectionIds.length !== 1) {
    throw new Error(`${route.reason} 为避免搜索错误 SAP 系统，请在问题中明确 SID 或 Client 后重试。`);
  }
  const connection = allConnections.find((item) => item.id === route.connectionIds[0]);
  if (!connection) throw new Error("建议的 SAP 连接已不存在，请重新检查客户项目配置。");
  const scopedConfig = projectConfigForAdtConnection(config, connection);
  const configCheck = await validateAdtConfig(scopedConfig);
  if (!configCheck.ok) throw new Error(`${connection.alias || connection.systemId || "SAP 连接"}：${configCheck.message} ${configCheck.suggestion}`);
  if (connection.connectionStatus !== "verified" || connection.minimalReadStatus !== "verified" || connection.lastVerificationMode !== "adt") {
    throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 尚未完成真实 ADT 与 T000 只读验证。`);
  }
  let password = "";
  try {
    password = await secretStore.resolveProjectSecret(projectId, { kind: "adt-password", connectionId: connection.id });
  } catch {
    throw new Error(`${connection.alias || connection.systemId || "SAP 连接"} 在系统安全存储中没有可用密码，请重新保存并验证。`);
  }
  const connector = createAdtReadonlyConnector();
  let lastError: unknown = null;
  for (const candidate of configCheck.candidates) {
    try {
      return await connector.searchObjects(
        { ...adtInputWithoutPassword(scopedConfig, candidate.url), password },
        query,
        maxResults,
        signal
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${connection.alias || connection.systemId || "SAP 连接"} 的 ADT 对象搜索未返回结果。`);
}

async function prepareFeishuHandoff(store: WorkspaceStore): Promise<FeishuHandoffResult> {
  return store.prepareFeishuHandoff();
}

function validProjectId(projectId: unknown, action: string): string {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(projectId)) {
    throw new Error(`${action}请求缺少有效项目 ID。`);
  }
  return projectId;
}

function parseImportCaseAttachmentsInput(input: unknown): ImportCaseAttachmentsInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("附件导入请求无效。");
  const value = input as Partial<ImportCaseAttachmentsInput>;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "caseId,projectId,threadId") throw new Error("附件导入请求字段无效。");
  for (const [label, id] of [["Project", value.projectId], ["Case", value.caseId], ["任务", value.threadId]] as const) {
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error(`${label} ID 无效。`);
  }
  return { projectId: value.projectId!, caseId: value.caseId!, threadId: value.threadId! };
}

function parseExportCaseDiagramInput(input: unknown): ExportCaseDiagramInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("流程图导出请求无效。");
  const value = input as Partial<ExportCaseDiagramInput>;
  if (Object.keys(value).sort().join(",") !== "contentBase64,format,sourceRelativePath,sourceSha256") throw new Error("流程图导出请求字段无效。");
  if (typeof value.sourceRelativePath !== "string" || value.sourceRelativePath.length > 240) throw new Error("流程图来源无效。");
  if (typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sourceSha256)) throw new Error("流程图来源校验值无效。");
  if (value.format !== "svg" && value.format !== "png" && value.format !== "pdf") throw new Error("流程图格式无效。");
  if (typeof value.contentBase64 !== "string" || value.contentBase64.length < 12 || value.contentBase64.length > 22 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.contentBase64)) {
    throw new Error("流程图导出内容无效。");
  }
  return { sourceRelativePath: value.sourceRelativePath, sourceSha256: value.sourceSha256, format: value.format, contentBase64: value.contentBase64 };
}

async function importKnowledgeTextFile(event: IpcMainInvokeEvent, store: WorkspaceStore, input: unknown): Promise<KnowledgeImportTextFileResult> {
  const request = parseKnowledgeImportTextFileInput(input);
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: "导入 Markdown/TXT 知识候选",
    properties: ["openFile"],
    filters: [{ name: "Markdown/TXT", extensions: ["md", "markdown", "txt"] }]
  };
  const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
  if (selection.canceled || selection.filePaths.length === 0) {
    return { cancelled: true, message: "已取消文本文件导入。" };
  }
  if (selection.filePaths.length !== 1) {
    throw new Error("一次只能导入一个 Markdown 或 TXT 文件。");
  }

  const selectedPath = selection.filePaths[0];
  const sourceName = path.basename(selectedPath);
  const lowerName = sourceName.toLowerCase();
  if (!KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    throw new Error("只支持导入 Markdown 或 TXT 文件。");
  }

  const textFile = await readControlledKnowledgeTextFile(selectedPath);
  const { importInput, metadata } = createKnowledgeImportInputFromTextFile({
    projectId: request.projectId,
    fileName: textFile.sourceName,
    sizeBytes: textFile.sizeBytes,
    body: textFile.body
  });
  const result = await store.importKnowledgeLocalText(importInput);
  return {
    ...result,
    cancelled: false,
    file: metadata
  };
}

function registerWorkbenchHandlers(
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  runtime: AgentRuntime,
  agentContextService: AgentContextService,
  agentToolService: AgentToolService,
  promptMemory: PromptMemoryService,
  capabilities: CapabilityCenterService,
  appRoot: string
): void {
  const pendingLocalFolderSelections = new Map<string, { projectId: string; folderPath: string; folderName: string; expiresAt: number }>();
  ipcMain.handle("workbench:get-state", (event) => trustedResponse(event, appRoot, () => store.getState()));
  ipcMain.handle("workbench:create-workspace-backup", (event) => trustedResponse(event, appRoot, () => createWorkspaceBackup(store.getWorkspaceRoot())));
  ipcMain.handle("workbench:import-workspace", (event) => trustedResponse(event, appRoot, async () => {
    const selection = await dialog.showOpenDialog({
      title: "选择旧工作台目录",
      properties: ["openDirectory"]
    });
    if (selection.canceled || selection.filePaths.length !== 1) {
      return { status: "cancelled" as const, restartRequired: false };
    }
    const result = await importWorkspace(selection.filePaths[0], store.getWorkspaceRoot());
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 800);
    return result;
  }));
  ipcMain.handle("workbench:create-local-project", (event, input: unknown) => trustedResponse(event, appRoot, () => store.createLocalProject(input)));
  ipcMain.handle("workbench:create-local-case", (event, input: unknown) => trustedResponse(event, appRoot, () => store.createLocalCase(input)));
  ipcMain.handle("workbench:select-local-task-folder", (event, input: unknown) => trustedResponse(event, appRoot, async (): Promise<LocalTaskFolderSelectionResult> => {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1) {
      throw new Error("选择任务文件夹请求无效。");
    }
    const projectId = validProjectId((input as { projectId?: unknown }).projectId, "选择任务文件夹");
    const state = await store.getState();
    if (!state.projects.some((project) => project.id === projectId && project.isVisible !== false)) {
      throw new Error("目标 Project 已不存在或已隐藏。");
    }
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "选择任务要绑定的电脑文件夹",
      buttonLabel: "选择此文件夹",
      properties: ["openDirectory"]
    };
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) return { cancelled: true };
    if (selection.filePaths.length !== 1) throw new Error("一次只能绑定一个电脑文件夹。");
    const folder = await store.inspectLocalTaskFolder(selection.filePaths[0]);
    const selectionToken = randomUUID();
    const now = Date.now();
    for (const [token, pending] of pendingLocalFolderSelections) {
      if (pending.expiresAt <= now) pendingLocalFolderSelections.delete(token);
    }
    pendingLocalFolderSelections.set(selectionToken, { projectId, ...folder, expiresAt: now + 10 * 60 * 1000 });
    return { cancelled: false, selectionToken, folderName: folder.folderName };
  }));
  ipcMain.handle("workbench:create-work-thread", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const request = parseCreateWorkThreadInput(input);
    if (request.folderMode !== "existing" || !request.folderSelectionToken) {
      return store.createWorkThread(request);
    }
    const pending = pendingLocalFolderSelections.get(request.folderSelectionToken);
    pendingLocalFolderSelections.delete(request.folderSelectionToken);
    if (!pending || pending.expiresAt <= Date.now()) {
      throw new Error("电脑文件夹选择已失效，请重新选择后创建任务。");
    }
    if (pending.projectId !== request.projectId) {
      throw new Error("所选电脑文件夹与当前 Project 不一致，请重新选择。");
    }
    return store.createWorkThread(request, { folderPath: pending.folderPath, folderName: pending.folderName });
  }));
  ipcMain.handle("workbench:switch-work-thread", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchWorkThread(input)));
  ipcMain.handle("workbench:update-conversation-thread-status", (event, input: unknown) => trustedResponse(event, appRoot, () => store.updateConversationThreadStatus(input)));
  ipcMain.handle("workbench:rewind-conversation", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const result = await store.rewindConversation(input);
    const request = input as { scope?: unknown; threadId?: unknown };
    if (request.scope === "work" && typeof request.threadId === "string") {
      const thread = result.state.workThreads.find((item) => item.id === request.threadId);
      if (thread) await promptMemory.revokeThreadCheckpoint({ threadId: thread.id, projectId: thread.projectId, caseId: thread.caseId });
    } else if (request.scope === "chat" && typeof request.threadId === "string") {
      await promptMemory.revokeThreadCheckpoint({ threadId: request.threadId, projectId: null, caseId: null });
    }
    return result;
  }));
  ipcMain.handle("workbench:restore-conversation-revision", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const state = await store.restoreConversationRevision(input);
    const request = input as { scope?: unknown; threadId?: unknown };
    if (request.scope === "work" && typeof request.threadId === "string") {
      const thread = state.workThreads.find((item) => item.id === request.threadId);
      if (thread) await promptMemory.revokeThreadCheckpoint({ threadId: thread.id, projectId: thread.projectId, caseId: thread.caseId });
    } else if (request.scope === "chat" && typeof request.threadId === "string") {
      await promptMemory.revokeThreadCheckpoint({ threadId: request.threadId, projectId: null, caseId: null });
    }
    return state;
  }));
  ipcMain.handle("workbench:create-daily-chat-thread", (event, input: unknown) => trustedResponse(event, appRoot, () => store.createDailyChatThread(input)));
  ipcMain.handle("workbench:switch-daily-chat-thread", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchDailyChatThread(input)));
  ipcMain.handle("workbench:agent-runtime-health", (event) => trustedResponse(event, appRoot, async () => runtime.getHealth()));
  ipcMain.handle("workbench:agent-runtime-read-thread", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const request = parseAgentThreadReplayInput(input);
    return runtime.readThreadByLegacyId(request.scope, request.legacyThreadId, request.afterSequence, request.limit);
  }));
  ipcMain.handle("workbench:agent-runtime-cancel-turn", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const request = parseCancelAgentTurnInput(input);
    if (agentRunOwners.get(request.requestId) !== event.sender.id) {
      return { cancelled: false, message: "该任务不属于当前窗口，或已经结束。" };
    }
    return runtime.cancelRequest(request.requestId);
  }));
  ipcMain.handle("workbench:capability-center-snapshot", (event) => trustedResponse(event, appRoot, () => capabilities.getSnapshot()));
  ipcMain.handle("workbench:capability-plugin-import", (event, input: ImportCapabilityPluginInput) => trustedResponse(event, appRoot, async () => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { title: "选择要导入的 Plugin 文件夹", buttonLabel: "检查此 Plugin", properties: ["openDirectory"] };
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) return capabilities.getSnapshot();
    if (selection.filePaths.length !== 1) throw new Error("一次只能导入一个 Plugin 文件夹。");
    const preview = await capabilities.preflightPluginImport(selection.filePaths[0], input);
    const totalComponents = preview.components.skillReferences + preview.components.inlineSkills + preview.components.mcpPresets + preview.components.promptFragments + preview.components.templates;
    const confirmationOptions = {
      type: preview.validation.status === "warning" ? "warning" : "info",
      title: "确认导入 Plugin",
      message: `${preview.displayName} · v${preview.version}`,
      detail: `${preview.description}\n\n包含 ${totalComponents} 项声明式能力。插件不能注入页面代码，也不会自动执行脚本或获得额外权限。`,
      buttons: ["确认导入", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    } satisfies Electron.MessageBoxOptions;
    const confirmation = parentWindow ? await dialog.showMessageBox(parentWindow, confirmationOptions) : await dialog.showMessageBox(confirmationOptions);
    if (confirmation.response !== 0) {
      await capabilities.cancelPluginImport(preview.importId);
      return capabilities.getSnapshot();
    }
    await capabilities.confirmPluginImport(preview.importId);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-plugin-enabled", (event, input: SetCapabilityPluginEnabledInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.setPluginEnabled(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-skill-import", (event, input: ImportCapabilitySkillInput) => trustedResponse(event, appRoot, async () => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "选择单个 Skill 文件夹（应直接包含 SKILL.md）",
      buttonLabel: "检查此 Skill",
      properties: ["openDirectory"]
    };
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) return capabilities.getSnapshot();
    if (selection.filePaths.length !== 1) throw new Error("一次只能导入一个 Skill 文件夹。");
    const preview = await capabilities.preflightSkillImport(selection.filePaths[0], input);
    const warningCount = preview.validation.diagnostics.filter((item) => item.level === "warning").length;
    const scriptNotice = preview.scriptStatus === "present-listed-not-executable"
      ? "检测到 scripts 目录；为保证安全，脚本只会列出，不会执行。"
      : "未检测到可执行脚本。";
    const confirmationOptions = {
      type: warningCount > 0 ? "warning" : "info",
      title: "确认导入 Skill",
      message: preview.name,
      detail: `${preview.description}\n\n${preview.stats.fileCount} 个文件，${preview.resources.length} 个资源。${scriptNotice}\n导入只会增加说明和参考资料，不会自动获得 SAP、文件或命令执行权限。${warningCount ? `\n另有 ${warningCount} 项提示，请导入后查看校验详情。` : ""}`,
      buttons: ["确认导入", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    } satisfies Electron.MessageBoxOptions;
    const confirmation = parentWindow
      ? await dialog.showMessageBox(parentWindow, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions);
    if (confirmation.response !== 0) {
      await capabilities.cancelSkillImport(preview.importId);
      return capabilities.getSnapshot();
    }
    await capabilities.confirmSkillImport(preview.importId);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-skill-discover", (event, input: DiscoverCapabilitySkillsInput) => trustedResponse(event, appRoot, async () => (
    capabilities.discoverLocalSkills(input)
  )));
  ipcMain.handle("workbench:capability-skill-import-discovered", (event, input: ImportDiscoveredCapabilitySkillsInput) => trustedResponse(event, appRoot, async () => {
    const previews = await capabilities.preflightDiscoveredSkillImports(input);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const scriptCount = previews.filter((item) => item.scriptStatus === "present-listed-not-executable").length;
    const previewNames = previews.slice(0, 20).map((item) => `• ${item.name}`).join("\n");
    const remainingCount = Math.max(0, previews.length - 20);
    const confirmationOptions = {
      type: scriptCount > 0 ? "warning" : "info",
      title: "确认导入本机 Skills",
      message: `将导入 ${previews.length} 个 Skills`,
      detail: `${previewNames}${remainingCount ? `\n• 另有 ${remainingCount} 个` : ""}\n\n${scriptCount ? `其中 ${scriptCount} 个包含 scripts；脚本只会列出，不会执行。\n` : ""}导入不会自动获得 SAP、文件或命令执行权限。`,
      buttons: ["确认导入", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    } satisfies Electron.MessageBoxOptions;
    const confirmation = parentWindow ? await dialog.showMessageBox(parentWindow, confirmationOptions) : await dialog.showMessageBox(confirmationOptions);
    if (confirmation.response !== 0) {
      await Promise.all(previews.map((preview) => capabilities.cancelSkillImport(preview.importId)));
      return capabilities.getSnapshot();
    }
    let importedCount = 0;
    try {
      for (const preview of previews) {
        await capabilities.confirmSkillImport(preview.importId);
        importedCount += 1;
      }
    } catch (error) {
      await Promise.all(previews.slice(importedCount).map((preview) => capabilities.cancelSkillImport(preview.importId).catch(() => undefined)));
      const reason = error instanceof Error ? error.message : "来源文件发生变化";
      throw new Error(importedCount > 0
        ? `已导入 ${importedCount} 个 Skills，其余项目未导入：${reason}`
        : `Skills 导入失败：${reason}`);
    }
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-skill-enabled", (event, input: SetCapabilitySkillEnabledInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.setSkillEnabled(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-prompt-save", (event, input: SaveCapabilityPromptInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.savePrompt(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-prompt-enabled", (event, input: SetCapabilityPromptEnabledInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.setPromptEnabled(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-memory-create", (event, input: CreateCapabilityMemoryInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.createMemory(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-memory-update", (event, input: UpdateCapabilityMemoryInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.updateMemory(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-memory-review", (event, input: ReviewCapabilityMemoryInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.reviewMemory(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-memory-revoke", (event, input: RevokeCapabilityMemoryInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.revokeMemory(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-mcp-save", (event, input: SaveCapabilityMcpInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.saveMcpConnection(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-mcp-test", (event, input: TestCapabilityMcpInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.testMcpConnection(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-mcp-enabled", (event, input: SetCapabilityMcpEnabledInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.setMcpEnabled(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-mcp-tool-enabled", (event, input: SetCapabilityMcpToolEnabledInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.setMcpToolEnabled(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:capability-mcp-remove", (event, input: RemoveCapabilityMcpInput) => trustedResponse(event, appRoot, async () => {
    await capabilities.removeMcpConnection(input);
    return capabilities.getSnapshot();
  }));
  ipcMain.handle("workbench:append-daily-chat-message", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const requestId = randomUUID();
    return runOwnedAgentRequest(event, requestId, () => runTrackedDailyChatMessage(runtime, store, secretStore, agentContextService, requestId, input));
  }));
  ipcMain.handle("workbench:append-daily-chat-message-stream", (event, requestId: unknown, input: unknown) => trustedResponse(event, appRoot, async () => {
    const validRequestId = validStreamRequestId(requestId);
    const stream = streamEventSender(event, validRequestId, "daily-chat");
    const state = await runOwnedAgentRequest(event, validRequestId, () => runTrackedDailyChatMessage(runtime, store, secretStore, agentContextService, validRequestId, input, stream));
    stream.complete();
    return state;
  }));
  ipcMain.handle("workbench:switch-project", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchProject(input)));
  ipcMain.handle("workbench:hide-project-from-sidebar", (event, input: unknown) => trustedResponse(event, appRoot, () => store.hideProjectFromSidebar(input)));
  ipcMain.handle("workbench:restore-project-to-sidebar", (event, input: unknown) => trustedResponse(event, appRoot, () => store.restoreProjectToSidebar(input)));
  ipcMain.handle("workbench:switch-case", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchCase(input)));
  ipcMain.handle("workbench:append-message", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const requestId = randomUUID();
    return runOwnedAgentRequest(event, requestId, () => runTrackedCaseMessage(runtime, store, secretStore, agentContextService, agentToolService, requestId, input));
  }));
  ipcMain.handle("workbench:append-message-stream", (event, requestId: unknown, input: unknown) => trustedResponse(event, appRoot, async () => {
    const validRequestId = validStreamRequestId(requestId);
    const stream = streamEventSender(event, validRequestId, "case");
    const state = await runOwnedAgentRequest(event, validRequestId, () => runTrackedCaseMessage(runtime, store, secretStore, agentContextService, agentToolService, validRequestId, input, stream));
    stream.complete();
    return state;
  }));
  ipcMain.handle("workbench:get-case-files", (event) => trustedResponse(event, appRoot, () => store.getCaseFiles()));
  ipcMain.handle("workbench:preview-current-case-file", (event, input: unknown) => trustedResponse(event, appRoot, () => store.previewCurrentCaseFile(input)));
  ipcMain.handle("workbench:import-case-attachments", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const target = parseImportCaseAttachmentsInput(input);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "导入当前 Case 的资料附件",
      buttonLabel: "导入并生成安全摘录",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "支持的资料", extensions: ["pdf", "docx", "xlsx", "csv", "txt", "md"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Word", extensions: ["docx"] },
        { name: "Excel/CSV", extensions: ["xlsx", "csv"] },
        { name: "文本", extensions: ["txt", "md"] }
      ]
    };
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) {
      return { cancelled: true, message: "已取消附件导入。", items: [] };
    }
    const prepared = await prepareCaseAttachments(selection.filePaths);
    return store.importCaseAttachments(target, prepared);
  }));
  ipcMain.handle("workbench:export-case-diagram", (event, input: unknown) => trustedResponse(event, appRoot, async () => {
    const request = parseExportCaseDiagramInput(input);
    const output = await convertSanitizedSvg(Buffer.from(request.contentBase64, "base64"), request.format);
    return store.exportCurrentCaseDiagram({ ...request, contentBase64: output.toString("base64") });
  }));
  ipcMain.handle("workbench:search", (event, query: string) => trustedResponse(event, appRoot, () => store.search(query)));
  ipcMain.handle("workbench:read-sap-object-evidence", (event, input: unknown) => trustedResponse(event, appRoot, () => readSapObjectEvidence(store, secretStore, input)));
  ipcMain.handle("workbench:sap-gui-discover", (event) => trustedResponse(event, appRoot, () => discoverLocalSapGuiConnections()));
  ipcMain.handle("workbench:prepare-feishu-handoff", (event) => trustedResponse(event, appRoot, () => prepareFeishuHandoff(store)));
  ipcMain.handle("workbench:feishu-discover-cli", (event) => trustedResponse(event, appRoot, () => discoverFeishuCli()));
  ipcMain.handle("workbench:feishu-install-cli", (event) => trustedResponse(event, appRoot, () => installFeishuCliWithConsent()));
  ipcMain.handle("workbench:feishu-save-profile", (event, projectId: unknown) => trustedResponse(event, appRoot, () => setupFeishuCliProfile(store, secretStore, projectId)));
  ipcMain.handle("workbench:open-feishu-developer-console", (event) => trustedResponse(event, appRoot, () => openFeishuDeveloperConsole()));
  ipcMain.handle("workbench:save-project-config", (event, projectId: string, config: unknown) => trustedResponse(event, appRoot, () => saveProjectConfig(store, secretStore, projectId, config)));
  ipcMain.handle("workbench:save-project-secret", (event, projectId: string, input: unknown) => trustedResponse(event, appRoot, () => saveProjectSecret(store, secretStore, projectId, input)));
  ipcMain.handle("workbench:adt-verify-readonly", (event, projectId: unknown) => trustedResponse(event, appRoot, () => verifyAdtReadonlyWithConsent(event, store, secretStore, projectId)));
  ipcMain.handle("workbench:feishu-verify-cli", (event, projectId: unknown) => trustedResponse(event, appRoot, () => verifyFeishuCli(store, projectId)));
  ipcMain.handle("workbench:model-provider-verify", (event, projectId: unknown, providerId: unknown) => trustedResponse(event, appRoot, () => verifyModelProvider(store, secretStore, projectId, providerId)));
  ipcMain.handle("workbench:codex-verify-cli", (event, projectId: unknown) => trustedResponse(event, appRoot, () => verifyCodexCli(store, projectId)));
  ipcMain.handle("local-ai-scan", (event) => trustedResponse(event, appRoot, () => scanLocalAiCapabilities()));
  ipcMain.handle("local-ai-install", (event, input: unknown) => trustedResponse(event, appRoot, () => installLocalAiCapabilityWithConsent(event, input)));
  ipcMain.handle("workbench:get-project-standards", (event, projectId: unknown) => trustedResponse(event, appRoot, () => store.getProjectStandards(validProjectId(projectId, "读取项目规范"))));
  ipcMain.handle("workbench:standards-copy-template", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.copyProjectStandardsTemplate(validProjectId(projectId, "复制规范模板"), input)));
  ipcMain.handle("workbench:standards-copy-project", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.copyProjectStandardsFromProject(validProjectId(projectId, "复制其他项目规范"), input)));
  ipcMain.handle("workbench:standards-save", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.saveProjectStandards(validProjectId(projectId, "保存项目规范"), input)));
  ipcMain.handle("workbench:get-project-knowledge", (event, projectId: unknown) => trustedResponse(event, appRoot, () => store.getProjectKnowledge(validProjectId(projectId, "读取项目知识库"))));
  ipcMain.handle("workbench:knowledge-import-local-text", (event, input: unknown) => trustedResponse(event, appRoot, () => store.importKnowledgeLocalText(input)));
  ipcMain.handle("workbench:knowledge-import-text-file", (event, input: unknown) => trustedResponse(event, appRoot, () => importKnowledgeTextFile(event, store, input)));
  ipcMain.handle("workbench:knowledge-review-for-publish", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.reviewKnowledgeForPublish(validProjectId(projectId, "记录知识审核"), input)));
  ipcMain.handle("workbench:knowledge-edit-candidate", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.editKnowledgeCandidate(validProjectId(projectId, "编辑知识候选"), input)));
  ipcMain.handle("workbench:knowledge-attach-to-current-case", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.attachPublishedKnowledgeToCurrentCase(validProjectId(projectId, "引用已发布知识到当前案件"), input)));
  ipcMain.handle("workbench:knowledge-detach-from-current-case", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.detachPublishedKnowledgeFromCurrentCase(validProjectId(projectId, "解除当前案件知识引用"), input)));
  ipcMain.handle("workbench:knowledge-publish", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.publishKnowledge(validProjectId(projectId, "确认知识入库"), input)));
  ipcMain.handle("workbench:knowledge-mark-conflict", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.markKnowledgeConflicted(validProjectId(projectId, "标记知识冲突"), input)));
  ipcMain.handle("workbench:knowledge-expire", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.expireKnowledge(validProjectId(projectId, "标记知识失效"), input)));
}

const lifecycleLogger = createAppLifecycleLogger(app.getPath("userData"));
let mainWindow: BrowserWindow | null = null;
let agentRuntime: AgentRuntime | null = null;
let promptMemoryService: PromptMemoryService | null = null;
let mcpConnectionManager: McpConnectionManager | null = null;

function broadcastAgentRuntimeEvent(event: AgentRuntimeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(AGENT_RUNTIME_EVENT_CHANNEL, event);
  }
}

function isSafeAutomaticRecovery(record: AgentInterruptedTurnRecovery): boolean {
  const input = record.resumeInput;
  if (!record.canAutoResume || !input || typeof input.content !== "string" || !input.content.trim()) return false;
  if (record.scope === "chat") return input.threadId === record.legacyThreadId;
  return input.threadId === record.legacyThreadId
    && input.projectId === record.projectId
    && input.caseId === record.caseId
    && input.permissionMode === "request_approval"
    && input.codexAssistEnabled !== true;
}

async function resumeInterruptedAgentTurns(
  records: AgentInterruptedTurnRecovery[],
  runtime: AgentRuntime,
  store: WorkspaceStore,
  secretStore: SecureSecretStore,
  agentContextService: AgentContextService,
  agentToolService: AgentToolService
): Promise<void> {
  for (const record of records) {
    if (!isSafeAutomaticRecovery(record) || !record.resumeInput) continue;
    const requestId = randomUUID();
    const ownerId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null;
    if (ownerId !== null) agentRunOwners.set(requestId, ownerId);
    lifecycleLogger.write("agent-runtime-auto-resume-started", { scope: record.scope, turnId: record.turnId });
    try {
      if (record.scope === "chat") {
        await runTrackedDailyChatMessage(runtime, store, secretStore, agentContextService, requestId, record.resumeInput, undefined, record.turnId);
      } else {
        await runTrackedCaseMessage(runtime, store, secretStore, agentContextService, agentToolService, requestId, record.resumeInput, undefined, record.turnId);
      }
      lifecycleLogger.write("agent-runtime-auto-resume-completed", { scope: record.scope, turnId: record.turnId });
    } catch (error) {
      lifecycleLogger.write("agent-runtime-auto-resume-failed", { scope: record.scope, turnId: record.turnId, message: safeErrorMessage(error) });
      const recovery = await store.reconcileInterruptedAgentTurns([record]).catch(() => null);
      if (recovery) {
        await Promise.all([
          ...recovery.projected.map((turnId) => runtime.acknowledgeInterruptedTurn(turnId, "projected")),
          ...recovery.committed.map((turnId) => runtime.acknowledgeInterruptedTurn(turnId, "committed")),
          ...recovery.unmatched.map((turnId) => runtime.acknowledgeInterruptedTurn(turnId, "unmatched"))
        ]).catch(() => undefined);
      }
    } finally {
      if (agentRunOwners.get(requestId) === ownerId) agentRunOwners.delete(requestId);
    }
  }
}
let rendererRecoveryUsed = false;
let applicationCloseReason: "application-quit" | "window-close" | null = null;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function focusMainWindow(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const minimized = window.isMinimized();
  if (minimized) window.restore();
  window.show();
  window.focus();
  lifecycleLogger.write("existing-window-focused", { minimized });
}

async function notifyRendererLoadFailure(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return;
  await dialog.showMessageBox(window, {
    type: "error",
    title: "工作台加载失败",
    message: "工作台界面未能加载。请关闭应用后重新启动；如果问题持续，请检查本地生命周期日志。",
    buttons: ["关闭"],
    defaultId: 0,
    noLink: true
  });
}

function reloadRendererOnce(window: BrowserWindow, source?: "probe"): void {
  lifecycleLogger.write("renderer-controlled-reload", { recoveryUsed: true, ...(source ? { source } : {}) });
  window.webContents.reload();
}

async function handleRendererGone(window: BrowserWindow, reason: string, exitCode: number): Promise<void> {
  const recoveryOffered = !rendererRecoveryUsed;
  lifecycleLogger.write("renderer-process-gone", {
    reason,
    exitCode,
    recoveryOffered,
    recoveryUsed: rendererRecoveryUsed
  });
  if (window.isDestroyed()) return;

  if (process.env.WORKBENCH_LIFECYCLE_PROBE === "1") {
    if (recoveryOffered) {
      rendererRecoveryUsed = true;
      reloadRendererOnce(window, "probe");
    } else {
      lifecycleLogger.write("renderer-recovery-limit-reached", { recoveryUsed: true, source: "probe" });
    }
    return;
  }

  if (!recoveryOffered) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "工作台界面已停止",
      message: "工作台界面再次异常停止。为避免反复重启，应用不会继续自动恢复，请关闭后重新启动。",
      buttons: ["关闭"],
      defaultId: 0,
      noLink: true
    });
    return;
  }

  rendererRecoveryUsed = true;
  const result = await dialog.showMessageBox(window, {
    type: "warning",
    title: "工作台界面异常停止",
    message: "工作台界面异常停止。可以安全地重新加载一次；如果再次失败，应用将停止自动恢复。",
    buttons: ["重新加载一次", "暂不重载"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0 && !window.isDestroyed()) {
    reloadRendererOnce(window);
  } else {
    lifecycleLogger.write("renderer-reload-declined", { recoveryUsed: true });
  }
}

async function loadRenderer(window: BrowserWindow, appRoot: string, rendererUrl: string | undefined): Promise<void> {
  const useDevelopmentServer = Boolean(rendererUrl && isTrustedRendererUrl(rendererUrl, appRoot, rendererUrl));
  const method = useDevelopmentServer ? "loadURL" : "loadFile";
  lifecycleLogger.write("renderer-load-started", { method });
  try {
    if (useDevelopmentServer) {
      await window.loadURL(rendererUrl as string);
    } else {
      await window.loadFile(path.join(appRoot, "dist/renderer/index.html"));
    }
    lifecycleLogger.write("renderer-load-completed", { method });
  } catch (error) {
    lifecycleLogger.write("renderer-load-rejected", { method, errorName: errorName(error) });
    await notifyRendererLoadFailure(window);
  }
}

function createMainWindow(): BrowserWindow {
  const appRoot = app.getAppPath();
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const windowMargin = 24;
  const width = Math.min(1440, Math.max(640, workArea.width - windowMargin));
  const height = Math.min(920, Math.max(480, workArea.height - windowMargin));
  const window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(680, width),
    minHeight: Math.min(520, height),
    title: "SAP AI 顾问工作台",
    backgroundColor: "#f7f8fb",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(appRoot, "dist/preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl, appRoot, rendererUrl)) {
      event.preventDefault();
    }
  });
  window.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedUrl, isMainFrame) => {
    lifecycleLogger.write("renderer-did-fail-load", { errorCode, isMainFrame });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    void handleRendererGone(window, details.reason, details.exitCode);
  });
  window.on("close", () => {
    if (!applicationCloseReason) applicationCloseReason = "window-close";
    lifecycleLogger.write("window-close-requested", { reason: applicationCloseReason });
  });
  window.on("closed", () => {
    lifecycleLogger.write("window-closed", { reason: applicationCloseReason ?? "unknown" });
    if (mainWindow === window) mainWindow = null;
  });

  mainWindow = window;
  lifecycleLogger.write("window-created", { platform: process.platform });
  void loadRenderer(window, appRoot, rendererUrl);
  return window;
}

process.on("unhandledRejection", (error) => {
  lifecycleLogger.write("unhandled-rejection", { errorName: errorName(error), errorCode: lifecycleErrorCode(error), source: "process" });
});

let handlingUncaughtException = false;
process.on("uncaughtException", (error) => {
  if (handlingUncaughtException) return;
  handlingUncaughtException = true;
  lifecycleLogger.write("uncaught-exception", { errorName: errorName(error), errorCode: lifecycleErrorCode(error), source: "process" });
  if (app.isReady()) {
    dialog.showErrorBox("工作台发生严重错误", "主程序发生未处理错误，应用将安全退出。请重新启动后再试。");
    app.quit();
  } else {
    app.exit(1);
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
lifecycleLogger.write("single-instance-lock", { lockAcquired: hasSingleInstanceLock });

if (!hasSingleInstanceLock) {
  lifecycleLogger.write("secondary-instance-exit");
  app.quit();
} else {
  lifecycleLogger.beginSession();
  app.on("second-instance", () => {
    lifecycleLogger.write("second-instance-requested");
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    const appRoot = app.getAppPath();
    const workspaceHostRoot = app.isPackaged
      ? app.getPath("userData")
      : process.env.WORKBENCH_REPO_ROOT ?? path.resolve(appRoot, "../..");
    const store = new WorkspaceStore(workspaceHostRoot);
    const secretStore = new SecureSecretStore(workspaceHostRoot);
    agentRuntime = new AgentRuntime(workspaceHostRoot, broadcastAgentRuntimeEvent);
    const runtimeHealth = await agentRuntime.initialize();
    const pendingRecoveries = agentRuntime.getPendingInterruptedTurns();
    let automaticRecoveries: AgentInterruptedTurnRecovery[] = [];
    if (pendingRecoveries.length > 0) {
      try {
        const classification = await store.classifyInterruptedAgentTurns(pendingRecoveries);
        const projectedIds = new Set(classification.projected);
        automaticRecoveries = pendingRecoveries.filter((record) => projectedIds.has(record.turnId) && isSafeAutomaticRecovery(record));
        const manualRecoveries = pendingRecoveries.filter((record) => projectedIds.has(record.turnId) && !isSafeAutomaticRecovery(record));
        const manualRecovery = manualRecoveries.length > 0
          ? await store.reconcileInterruptedAgentTurns(manualRecoveries)
          : { projected: [] as string[], committed: [] as string[], unmatched: [] as string[] };
        await Promise.all([
          ...manualRecovery.projected.map((turnId) => agentRuntime!.acknowledgeInterruptedTurn(turnId, "projected")),
          ...classification.committed.map((turnId) => agentRuntime!.acknowledgeInterruptedTurn(turnId, "committed")),
          ...classification.unmatched.map((turnId) => agentRuntime!.acknowledgeInterruptedTurn(turnId, "unmatched"))
        ]);
        lifecycleLogger.write("agent-runtime-recovery-classified", {
          automatic: automaticRecoveries.length,
          projected: manualRecovery.projected.length,
          committed: classification.committed.length,
          unmatched: classification.unmatched.length
        });
      } catch (error) {
        automaticRecoveries = [];
        lifecycleLogger.write("agent-runtime-recovery-failed", { message: safeErrorMessage(error) });
      }
    }
    lifecycleLogger.write("agent-runtime-ready", {
      schemaVersion: runtimeHealth.schemaVersion,
      recoveredInterruptedTurns: runtimeHealth.recoveredInterruptedTurns,
      hasWarning: Boolean(runtimeHealth.warning)
    });
    promptMemoryService = new PromptMemoryService(store.getWorkspaceRoot());
    const skillPackageService = new SkillPackageService(path.join(store.getWorkspaceRoot(), "capabilities", "skills"));
    const skillDiscoveryService = new SkillDiscoveryService(skillPackageService);
    const pluginPackageService = new PluginPackageService(path.join(store.getWorkspaceRoot(), "capabilities", "plugins"));
    mcpConnectionManager = new McpConnectionManager(
      path.join(store.getWorkspaceRoot(), "capabilities"),
      (ref, context) => {
        if (context.scope.type !== "project") {
          throw new Error("全局 MCP 暂不允许引用 Project 密钥；请改为 Project 范围连接。");
        }
        return secretStore.resolveProjectTargetValue(ref, context.scope.projectId, {
          kind: "mcp-header",
          connectionId: context.connectionId,
          headerName: context.headerName
        });
      }
    );
    await Promise.all([
      promptMemoryService.initialize(),
      skillPackageService.initialize(),
      pluginPackageService.initialize(),
      mcpConnectionManager.initialize()
    ]);
    const builtinSkillsRoot = app.isPackaged
      ? path.join(process.resourcesPath, "builtin-skills")
      : path.join(appRoot, "resources", "builtin-skills");
    try {
      const builtinSkills = await skillPackageService.syncBuiltinSkills(builtinSkillsRoot);
      lifecycleLogger.write("builtin-skills-ready", { count: builtinSkills.length });
    } catch (error) {
      lifecycleLogger.write("builtin-skills-failed", { message: safeErrorMessage(error) });
    }
    const agentContextService = new AgentContextService(
      new ContextEngine(promptMemoryService),
      skillPackageService,
      pluginPackageService,
      promptMemoryService
    );
    const agentToolService = new AgentToolService(
      store,
      mcpConnectionManager,
      skillPackageService,
      (target, request, signal) => readSapObjectEvidence(store, secretStore, request, target, signal),
      (target, request, signal) => readSapDataPreview(store, secretStore, request, target, signal),
      (target, query, maxResults, queryContext, signal) => searchSapObjects(store, secretStore, target, query, maxResults, queryContext, signal)
    );
    const capabilityCenter = new CapabilityCenterService(store, promptMemoryService, skillPackageService, mcpConnectionManager, pluginPackageService, skillDiscoveryService);
    registerWorkbenchHandlers(store, secretStore, agentRuntime, agentContextService, agentToolService, promptMemoryService, capabilityCenter, appRoot);
    createMainWindow();
    if (automaticRecoveries.length > 0) {
      setTimeout(() => {
        void resumeInterruptedAgentTurns(automaticRecoveries, agentRuntime!, store, secretStore, agentContextService, agentToolService);
      }, 750);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        focusMainWindow();
      }
    });
  }).catch((error) => {
    lifecycleLogger.write("app-ready-rejected", { errorName: errorName(error), errorCode: lifecycleErrorCode(error), source: "startup" });
    dialog.showErrorBox("工作台启动失败", "工作台主程序未能完成启动，请关闭后重试。");
    app.quit();
  });

  app.on("before-quit", () => {
    if (!applicationCloseReason) applicationCloseReason = "application-quit";
    lifecycleLogger.write("app-before-quit", { reason: applicationCloseReason });
  });
  app.on("will-quit", () => {
    agentRuntime?.close();
    agentRuntime = null;
    void promptMemoryService?.close();
    promptMemoryService = null;
    void mcpConnectionManager?.close();
    mcpConnectionManager = null;
    lifecycleLogger.write("app-will-quit", { reason: applicationCloseReason ?? "unknown" });
    lifecycleLogger.endSession();
  });
  app.on("window-all-closed", () => {
    lifecycleLogger.write("all-windows-closed", {
      platform: process.platform,
      reason: applicationCloseReason ?? "unknown",
      windowCount: BrowserWindow.getAllWindows().length
    });
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
