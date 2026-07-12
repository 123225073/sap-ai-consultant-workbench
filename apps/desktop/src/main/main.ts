import { app, BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import path from "node:path";
import { createAdtReadonlyConnector, createAdtValidationFailureReport, FakeAdtReadonlyConnector, type AdtConnectorInput } from "./adtReadonlyConnector";
import { resolveAdtEndpointCandidates, type AdtEndpointCandidate } from "./adtEndpointResolver";
import { createFeishuCliConnector, createFeishuValidationFailureReport, discoverFeishuCli, installFeishuCli, saveFeishuCliProfile, type FeishuCliConnectorInput } from "./feishuCliConnector";
import { createCodexCliConnector, createCodexValidationFailureReport, type CodexCliConnectorInput } from "./codexCliConnector";
import { createModelProviderConnector, createModelProviderValidationFailureReport, type ModelProviderConnectorInput } from "./modelProviderConnector";
import { SecureSecretStore } from "./secureSecretStore";
import { parseAppendDailyChatMessageInput, WorkspaceStore, type DailyChatAssistantReply } from "./workspaceStore";
import { safeModelDraftDisplayValue, type SafeModelDraftRun } from "./safeModelCaseDraftService";
import { readControlledKnowledgeTextFile } from "./controlledTextFileImportService";
import {
  createKnowledgeImportInputFromTextFile,
  KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_EXTENSIONS,
  parseKnowledgeImportTextFileInput
} from "./knowledgeService";
import { parseSapObjectEvidenceRequest } from "./sapObjectEvidenceService";
import { assertTrustedRendererEvent, isTrustedRendererUrl } from "./trustedRenderer";
import { createAppLifecycleLogger } from "./appLifecycleLogger";
import { installLocalAiCapability, parseLocalAiInstallInput, scanLocalAiCapabilities } from "./localAiCapabilityService";
import { assertPublicModelEndpoint, isDemoModelHost, isUnsafeModelHost } from "./modelEndpointSecurity";
import { createWorkspaceBackup, importWorkspace } from "./workspaceTransferService";
import type { AdtVerificationErrorCode, AdtVerificationReport, AdtVerificationResult, AiConversationStreamEvent, AiConversationStreamScope, ApiProviderConfig, AppendDailyChatMessageInput, CodexCaseAssistRun, CodexConfig, CodexVerificationErrorCode, CodexVerificationResult, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuConfig, FeishuHandoffResult, FeishuVerificationErrorCode, FeishuVerificationResult, KnowledgeImportTextFileResult, LocalAiInstallResult, ModelProviderVerificationErrorCode, ModelProviderVerificationResult, ProjectConfig, ProjectSecretInput, SapObjectEvidenceResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

const SENSITIVE_ERROR_PATTERNS = [
  /bearer\s+[a-z0-9._-]+/gi,
  /authorization:\s*[^\s]+/gi,
  /cookie:\s*[^\s]+/gi,
  /x-csrf-token:\s*[^\s]+/gi,
  /secure-store:sec_[a-f0-9]{32}/gi,
  /sk-[a-z0-9]{20,}/gi,
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
const caseWorkflowQueues = new Map<string, Promise<void>>();
const AI_STREAM_EVENT_CHANNEL = "workbench:ai-conversation-stream";

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

async function runCaseWorkflowExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = caseWorkflowQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  caseWorkflowQueues.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (caseWorkflowQueues.get(key) === tail) caseWorkflowQueues.delete(key);
  }
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "本地工作台操作失败。";
  return SENSITIVE_ERROR_PATTERNS.reduce((message, pattern) => message.replace(pattern, "[已脱敏]"), raw);
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
  return {
    alias: config.adt.alias,
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
    catalogMode: provider.catalogMode ?? "remote",
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

  let candidates: AdtEndpointCandidate[] = [];
  try {
    candidates = await resolveAdtEndpointCandidates(config.adt.url);
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
      suggestion: "请填写 SAP GUI 中的应用服务器，例如 sap-dev.example.com；或填写完整 ADT 地址，例如 https://sap-host:44300。"
    };
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
  const handle = await secretStore.save(projectId, target, candidate.value, existingRef);
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
    await secretStore.removeProjectTarget(projectId, { kind: "api-key", providerId: removedProviders[0].id });
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
    appSecret = await secretStore.resolveProjectSecret(projectId, { kind: "feishu-token" });
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
    title: "确认安装 Codex CLI",
    message: "是否允许工作台在本机安装 Codex CLI？",
    detail: "确认后将通过官方 npm install -g @openai/codex 安装。取消不会报错，也不会影响 Work、Chat、SAP、模型、规范或知识库等核心功能。",
    buttons: ["取消", "确认安装"],
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
    apiKey = await secretStore.resolveProjectSecret(projectId, { kind: "api-key", providerId });
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

async function appendCaseMessage(store: WorkspaceStore, secretStore: SecureSecretStore, input: unknown, onDelta?: ModelDeltaHandler): Promise<WorkbenchState> {
  const targetedInput = await store.bindCaseWorkflowTarget(input);
  const workflowKey = `${targetedInput.projectId}:${targetedInput.caseId}`;
  return runCaseWorkflowExclusive(workflowKey, async () => {
  const prepared = await store.prepareSafeModelDraftRequest(targetedInput, {
    allowFakeModelExecution: process.env.WORKBENCH_ALLOW_FAKE_MODEL_EXECUTION === "1"
  });
  let modelDraft: SafeModelDraftRun | undefined;
  let codexAssist: CodexCaseAssistRun | undefined;

  if (prepared) {
    try {
      await assertPublicModelEndpoint(prepared.baseUrl);
      const apiKey = await secretStore.resolveProjectSecret(prepared.projectId, {
        kind: "api-key",
        providerId: prepared.providerId
      });
      const connector = createModelProviderConnector(prepared.baseUrl, prepared.providerType);
      const draft = await connector.generateSafeDraft({
        id: prepared.providerId,
        name: prepared.providerName,
        providerType: prepared.providerType,
        baseUrl: prepared.baseUrl,
        apiKey,
        modelId: prepared.modelId,
        context: prepared.context,
        onDelta: onDelta ? (delta) => onDelta(delta, prepared.providerName, prepared.modelId) : undefined
      });
      modelDraft = {
        status: "success",
        providerName: safeModelDraftDisplayValue("模型渠道", prepared.providerName, "已验证模型渠道"),
        modelId: safeModelDraftDisplayValue("模型名称", draft.modelId, "已验证模型"),
        generatedAt: draft.generatedAt,
        content: draft.content,
        contextAudit: prepared.context.audit
      };
    } catch (error) {
      modelDraft = {
        status: "failed",
        providerName: safeModelDraftDisplayValue("模型渠道", prepared.providerName, "已验证模型渠道"),
        modelId: safeModelDraftDisplayValue("模型名称", prepared.modelId, "已验证模型"),
        generatedAt: new Date().toISOString(),
        errorMessage: safeErrorMessage(error),
        contextAudit: prepared.context.audit
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
      codexAssist = codexCaseAssistFailure(error);
    }
  }

    return store.appendMessage(targetedInput, modelDraft, codexAssist);
  });
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

async function prepareDailyChatAssistantReply(store: WorkspaceStore, secretStore: SecureSecretStore, request: AppendDailyChatMessageInput, onDelta?: ModelDeltaHandler): Promise<DailyChatAssistantReply | undefined> {
  if (!request.projectId || !request.providerId || !request.content.trim()) return undefined;
  try {
    const config = await store.getProjectConfig(request.projectId);
    const provider = config.apiProviders.find((item) => item.id === request.providerId);
    if (!provider || !isProviderReadyForDailyChat(provider)) return undefined;
    const modelId = request.modelId ?? provider.lastVerifiedModelId ?? provider.models[0]?.id;
    if (!modelId || !provider.models.some((model) => model.id === modelId)) return undefined;
    await assertPublicModelEndpoint(provider.baseUrl);
    const apiKey = await secretStore.resolveProjectSecret(request.projectId, { kind: "api-key", providerId: provider.id });
    const connector = createModelProviderConnector(provider.baseUrl, provider.providerType);
    const history = await store.getDailyChatModelHistory(request.threadId, request.projectId, provider.id, modelId);
    const result = await connector.generateDailyChat({
      ...modelProviderInputWithoutKey(provider),
      apiKey,
      modelId,
      content: request.content,
      history,
      onDelta: onDelta ? (delta) => onDelta(delta, provider.name, modelId) : undefined
    });
    return {
      content: result.content,
      modelId: result.modelId,
      responseMode: "model-success",
      projectId: request.projectId,
      providerId: provider.id,
      providerName: provider.name
    };
  } catch (error) {
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

async function appendDailyChatMessage(store: WorkspaceStore, secretStore: SecureSecretStore, input: unknown, onDelta?: ModelDeltaHandler): Promise<WorkbenchState> {
  const parsedInput = parseAppendDailyChatMessageInput(input);
  const assistantReply = await prepareDailyChatAssistantReply(store, secretStore, parsedInput, onDelta);
  return store.appendDailyChatMessage(parsedInput, assistantReply);
}

async function readSapObjectEvidence(store: WorkspaceStore, secretStore: SecureSecretStore, input: unknown): Promise<SapObjectEvidenceResult> {
  const request = parseSapObjectEvidenceRequest(input);
  const { projectId, caseId, config } = await store.getActiveProjectConfig();
  const configCheck = await validateAdtConfig(config);
  if (!configCheck.ok) {
    throw new Error(`${configCheck.message} ${configCheck.suggestion}`);
  }
  if (config.adt.connectionStatus !== "verified" || config.adt.minimalReadStatus !== "verified") {
    throw new Error("补充 SAP 只读证据前，必须先完成 ADT 连接和 T000 最小读取验证。");
  }

  const allowFakeEvidence = (
    process.env.WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE === "1" &&
    config.adt.lastVerificationMode === "fake" &&
    configCheck.candidates.some((candidate) => isDemoAdtHost(candidate.url))
  );
  const allowRealEvidence = config.adt.lastVerificationMode === "adt";
  if (!allowRealEvidence && !allowFakeEvidence) {
    throw new Error("尚未完成真实 ADT 只读验证，已阻止读取 SAP 对象证据。Fake evidence 仅允许在显式本地 probe 和演示 SAP 主机下使用。");
  }

  let password = "";
  try {
    password = await secretStore.resolveProjectSecret(projectId, { kind: "adt-password", connectionId: config.adt.id });
  } catch {
    throw new Error("系统安全存储中没有可用的 SAP 密码。请重新保存当前 Project 的 SAP 密码，再验证 ADT 只读连接。");
  }

  const connector = allowFakeEvidence ? new FakeAdtReadonlyConnector() : createAdtReadonlyConnector();
  let lastError: unknown = null;
  for (const candidate of configCheck.candidates) {
    try {
      const evidence = await connector.readObjectEvidence({ ...adtInputWithoutPassword(config, candidate.url), password }, request, {
        allowFakeEvidence
      });
      return store.appendSapObjectEvidence(evidence, { projectId, caseId });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("所有已解析的 ADT 地址都无法读取只读对象证据。");
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

function registerWorkbenchHandlers(store: WorkspaceStore, secretStore: SecureSecretStore, appRoot: string): void {
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
  ipcMain.handle("workbench:create-daily-chat-thread", (event, input: unknown) => trustedResponse(event, appRoot, () => store.createDailyChatThread(input)));
  ipcMain.handle("workbench:switch-daily-chat-thread", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchDailyChatThread(input)));
  ipcMain.handle("workbench:append-daily-chat-message", (event, input: unknown) => trustedResponse(event, appRoot, () => appendDailyChatMessage(store, secretStore, input)));
  ipcMain.handle("workbench:append-daily-chat-message-stream", (event, requestId: unknown, input: unknown) => trustedResponse(event, appRoot, async () => {
    const stream = streamEventSender(event, validStreamRequestId(requestId), "daily-chat");
    const state = await appendDailyChatMessage(store, secretStore, input, stream);
    stream.complete();
    return state;
  }));
  ipcMain.handle("workbench:switch-project", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchProject(input)));
  ipcMain.handle("workbench:hide-project-from-sidebar", (event, input: unknown) => trustedResponse(event, appRoot, () => store.hideProjectFromSidebar(input)));
  ipcMain.handle("workbench:restore-project-to-sidebar", (event, input: unknown) => trustedResponse(event, appRoot, () => store.restoreProjectToSidebar(input)));
  ipcMain.handle("workbench:switch-case", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchCase(input)));
  ipcMain.handle("workbench:append-message", (event, input: unknown) => trustedResponse(event, appRoot, () => appendCaseMessage(store, secretStore, input)));
  ipcMain.handle("workbench:append-message-stream", (event, requestId: unknown, input: unknown) => trustedResponse(event, appRoot, async () => {
    const stream = streamEventSender(event, validStreamRequestId(requestId), "case");
    const state = await appendCaseMessage(store, secretStore, input, stream);
    stream.complete();
    return state;
  }));
  ipcMain.handle("workbench:get-case-files", (event) => trustedResponse(event, appRoot, () => store.getCaseFiles()));
  ipcMain.handle("workbench:preview-current-case-file", (event, input: unknown) => trustedResponse(event, appRoot, () => store.previewCurrentCaseFile(input)));
  ipcMain.handle("workbench:search", (event, query: string) => trustedResponse(event, appRoot, () => store.search(query)));
  ipcMain.handle("workbench:read-sap-object-evidence", (event, input: unknown) => trustedResponse(event, appRoot, () => readSapObjectEvidence(store, secretStore, input)));
  ipcMain.handle("workbench:prepare-feishu-handoff", (event) => trustedResponse(event, appRoot, () => prepareFeishuHandoff(store)));
  ipcMain.handle("workbench:feishu-discover-cli", (event) => trustedResponse(event, appRoot, () => discoverFeishuCli()));
  ipcMain.handle("workbench:feishu-install-cli", (event) => trustedResponse(event, appRoot, () => installFeishuCliWithConsent()));
  ipcMain.handle("workbench:feishu-save-profile", (event, projectId: unknown) => trustedResponse(event, appRoot, () => setupFeishuCliProfile(store, secretStore, projectId)));
  ipcMain.handle("workbench:open-feishu-developer-console", (event) => trustedResponse(event, appRoot, () => openFeishuDeveloperConsole()));
  ipcMain.handle("workbench:save-project-config", (event, projectId: string, config: unknown) => trustedResponse(event, appRoot, () => saveProjectConfig(store, secretStore, projectId, config)));
  ipcMain.handle("workbench:save-project-secret", (event, projectId: string, input: unknown) => trustedResponse(event, appRoot, () => saveProjectSecret(store, secretStore, projectId, input)));
  ipcMain.handle("workbench:adt-verify-readonly", (event, projectId: unknown) => trustedResponse(event, appRoot, () => verifyAdtReadonly(store, secretStore, projectId)));
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

  app.whenReady().then(() => {
    const appRoot = app.getAppPath();
    const workspaceHostRoot = app.isPackaged
      ? app.getPath("userData")
      : process.env.WORKBENCH_REPO_ROOT ?? path.resolve(appRoot, "../..");
    registerWorkbenchHandlers(new WorkspaceStore(workspaceHostRoot), new SecureSecretStore(workspaceHostRoot), appRoot);
    createMainWindow();

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
