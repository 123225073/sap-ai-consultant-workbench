import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import path from "node:path";
import { createAdtReadonlyConnector, createAdtValidationFailureReport, FakeAdtReadonlyConnector, type AdtConnectorInput } from "./adtReadonlyConnector";
import { createFeishuCliConnector, createFeishuValidationFailureReport, type FeishuCliConnectorInput } from "./feishuCliConnector";
import { createModelProviderConnector, createModelProviderValidationFailureReport, type ModelProviderConnectorInput } from "./modelProviderConnector";
import { SecureSecretStore } from "./secureSecretStore";
import { WorkspaceStore } from "./workspaceStore";
import { safeModelDraftDisplayValue, type SafeModelDraftRun } from "./safeModelCaseDraftService";
import { readControlledKnowledgeTextFile } from "./controlledTextFileImportService";
import {
  createKnowledgeImportInputFromTextFile,
  KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_EXTENSIONS,
  parseKnowledgeImportTextFileInput
} from "./knowledgeService";
import { parseSapObjectEvidenceRequest } from "./sapObjectEvidenceService";
import { assertTrustedRendererEvent, isTrustedRendererUrl } from "./trustedRenderer";
import type { AdtVerificationErrorCode, AdtVerificationResult, ApiProviderConfig, FeishuConfig, FeishuHandoffResult, FeishuVerificationErrorCode, FeishuVerificationResult, KnowledgeImportTextFileResult, ModelProviderVerificationErrorCode, ModelProviderVerificationResult, ProjectConfig, ProjectSecretInput, SapObjectEvidenceResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

const SENSITIVE_ERROR_PATTERNS = [
  /bearer\s+[a-z0-9._-]+/gi,
  /authorization:\s*[^\s]+/gi,
  /cookie:\s*[^\s]+/gi,
  /x-csrf-token:\s*[^\s]+/gi,
  /secure-store:sec_[a-f0-9]{32}/gi,
  /sk-[a-z0-9]{20,}/gi,
  /api[_-]?key\s*[:=]\s*[^\s]+/gi,
  /tenant[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
  /user[_-]?access[_-]?token\s*[:=]\s*[^\s]+/gi,
  /verification_uri\s*[:=]\s*[^\s]+/gi,
  /device_code\s*[:=]\s*[^\s]+/gi
];

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "本地工作台操作失败。";
  return SENSITIVE_ERROR_PATTERNS.reduce((message, pattern) => message.replace(pattern, "[已脱敏]"), raw);
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

function adtInputWithoutPassword(config: ProjectConfig): Omit<AdtConnectorInput, "password"> {
  return {
    alias: config.adt.alias,
    url: config.adt.url,
    client: config.adt.client,
    username: config.adt.username,
    language: config.adt.language,
    sslMode: config.adt.sslMode,
    readOnly: true
  };
}

function adtValidationFailure(config: ProjectConfig, code: AdtVerificationErrorCode, message: string, suggestion: string) {
  return createAdtValidationFailureReport(adtInputWithoutPassword(config), code, message, suggestion);
}

function feishuInput(config: FeishuConfig): FeishuCliConnectorInput {
  return {
    cliPath: config.cliPath,
    profile: config.profile
  };
}

function feishuFailure(config: FeishuConfig, code: FeishuVerificationErrorCode, message: string, suggestion: string) {
  return createFeishuValidationFailureReport(feishuInput(config), code, message, suggestion);
}

function modelProviderInputWithoutKey(provider: ApiProviderConfig): Omit<ModelProviderConnectorInput, "apiKey"> {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl
  };
}

function modelProviderFailure(provider: ApiProviderConfig, code: ModelProviderVerificationErrorCode, message: string, suggestion: string) {
  return createModelProviderValidationFailureReport(modelProviderInputWithoutKey(provider), code, message, suggestion);
}

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isDemoModelHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  return host === "api-demo.example.com" || host === "fake-models.local" || host === "fake-models.test";
}

function isDemoAdtHost(url: string): boolean {
  try {
    const host = normalizedHostname(new URL(url).hostname);
    return host === "sap-demo.example.com" || host === "fake-sap.local" || host === "fake-sap.test";
  } catch {
    return false;
  }
}

function ipv4Parts(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers;
}

function isUnsafeModelHost(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host === "metadata.google" || host === "metadata") return true;
  if (host.startsWith("::ffff:")) {
    const mapped = ipv4Parts(host.slice("::ffff:".length));
    return mapped ? isUnsafeModelHost(mapped.join(".")) : true;
  }
  if (host.includes(":") && (host === "::" || host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"))) return true;

  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function validateFeishuConfig(config: FeishuConfig): { ok: true } | { ok: false; code: FeishuVerificationErrorCode; message: string; suggestion: string } {
  const missing = [
    ["CLI 路径", config.cliPath],
    ["Profile", config.profile]
  ].filter(([, value]) => typeof value !== "string" || value.trim().length === 0).map(([label]) => label);

  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing-config",
      message: `飞书 CLI 配置不完整：${missing.join("、")} 还没有填写。`,
      suggestion: "请先填写 CLI 路径和 Profile，并保存后再验证飞书 CLI。"
    };
  }

  if (/[\u0000-\u001f\u007f]/.test(config.cliPath) || /^https?:\/\//i.test(config.cliPath.trim())) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "飞书 CLI 路径格式不安全。",
      suggestion: "请填写固定命令 lark-cli 或 feishu-cli，不要填写 URL、本地文件路径或带控制字符的内容。"
    };
  }

  const cliCommand = config.cliPath.trim().toLowerCase();
  const allowedRealCliCommands = new Set(["lark-cli", "lark-cli.exe", "feishu-cli", "feishu-cli.exe"]);
  const fakeCliAllowed = process.env.WORKBENCH_ALLOW_FAKE_FEISHU_CLI === "1";
  if (cliCommand === "fake-lark-cli" && !fakeCliAllowed) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "演示飞书 CLI 只允许开发自测使用。",
      suggestion: "请把 CLI 配置改为 lark-cli 或 feishu-cli；正式配置不会执行 fake-lark-cli。"
    };
  }

  if (cliCommand !== "fake-lark-cli" && !allowedRealCliCommands.has(cliCommand)) {
    return {
      ok: false,
      code: "invalid-cli-path",
      message: "当前只允许验证固定的 lark-cli 或 feishu-cli 命令。",
      suggestion: "请把 CLI 配置改为 lark-cli 或 feishu-cli；本功能不会执行任意本地路径或其他程序。"
    };
  }

  if (!/^[A-Za-z0-9._-]{1,80}$/.test(config.profile.trim())) {
    return {
      ok: false,
      code: "missing-config",
      message: "飞书 Profile 名称格式不支持。",
      suggestion: "请使用 1-80 位英文、数字、点、下划线或短横线作为 Profile 名称。"
    };
  }

  return { ok: true };
}

function validateAdtConfig(config: ProjectConfig): { ok: true } | { ok: false; code: AdtVerificationErrorCode; message: string; suggestion: string } {
  const missing = [
    ["系统别名", config.adt.alias],
    ["SAP URL", config.adt.url],
    ["Client", config.adt.client],
    ["用户", config.adt.username],
    ["语言", config.adt.language]
  ].filter(([, value]) => typeof value !== "string" || value.trim().length === 0).map(([label]) => label);

  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing-config",
      message: `ADT 配置不完整：${missing.join("、")} 还没有填写。`,
      suggestion: "请先在当前项目配置中心补齐 ADT 非密钥配置，并保存后再验证。"
    };
  }

  try {
    const parsed = new URL(config.adt.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    return {
      ok: false,
      code: "invalid-url",
      message: "SAP URL 格式不正确。",
      suggestion: "请填写完整的 HTTP 或 HTTPS 地址，例如 https://sap-host:44300。"
    };
  }

  if (config.adt.readOnly !== true) {
    return {
      ok: false,
      code: "readonly-disabled",
      message: "当前 ADT 写入模式没有锁定为只读。",
      suggestion: "MVP 只允许只读验证，请保持 ADT 写入模式为只读锁定。"
    };
  }

  if (config.adt.credential.state !== "set-in-secure-store") {
    return {
      ok: false,
      code: "missing-credential",
      message: "当前项目还没有保存 SAP 密码到系统安全存储。",
      suggestion: "请先保存或替换 SAP 密码；保存后仍需再次执行只读验证。"
    };
  }

  return { ok: true };
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
      throw new Error("unsupported protocol");
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

async function verifyAdtReadonly(store: WorkspaceStore, secretStore: SecureSecretStore, projectId: unknown): Promise<AdtVerificationResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new Error("ADT 只读验证请求缺少项目 ID。");
  }
  const config = await store.getProjectConfig(projectId);
  const configCheck = validateAdtConfig(config);
  if (!configCheck.ok) {
    const report = adtValidationFailure(config, configCheck.code, configCheck.message, configCheck.suggestion);
    const state = await store.updateAdtVerification(projectId, report);
    return { report, state };
  }

  let password = "";
  try {
    password = await secretStore.resolveProjectSecret(projectId, { kind: "adt-password" });
  } catch {
    const report = adtValidationFailure(
      config,
      "secret-unavailable",
      "系统安全存储里的 SAP 密码无法读取。",
      "请重新保存当前项目 SAP 密码，然后再执行只读验证。"
    );
    const state = await store.updateAdtVerification(projectId, report);
    return { report, state };
  }

  const connector = createAdtReadonlyConnector();
  const report = await connector.verify({ ...adtInputWithoutPassword(config), password });
  const state = await store.updateAdtVerification(projectId, report);
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
  const report = await connector.verify(feishuInput(config.feishu));
  const state = await store.updateFeishuVerification(projectId, report);
  return { report, state };
}

async function verifyModelProvider(store: WorkspaceStore, secretStore: SecureSecretStore, projectId: unknown, providerId: unknown): Promise<ModelProviderVerificationResult> {
  if (typeof projectId !== "string" || projectId.trim().length === 0 || typeof providerId !== "string" || providerId.trim().length === 0) {
    throw new Error("模型渠道验证请求缺少项目或渠道 ID。");
  }
  const provider = await store.getApiProviderConfig(projectId, providerId);
  const configCheck = validateModelProvider(provider);
  if (!configCheck.ok) {
    const report = modelProviderFailure(provider, configCheck.code, configCheck.message, configCheck.suggestion);
    const state = await store.updateModelProviderVerification(projectId, providerId, report);
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
    const state = await store.updateModelProviderVerification(projectId, providerId, report);
    return { report, state };
  }

  const connector = createModelProviderConnector(provider.baseUrl);
  const report = await connector.verify({ ...modelProviderInputWithoutKey(provider), apiKey });
  const state = await store.updateModelProviderVerification(projectId, providerId, report);
  return { report, state };
}

async function appendCaseMessage(store: WorkspaceStore, secretStore: SecureSecretStore, input: unknown): Promise<WorkbenchState> {
  const prepared = await store.prepareSafeModelDraftRequest(input, {
    allowFakeModelExecution: process.env.WORKBENCH_ALLOW_FAKE_MODEL_EXECUTION === "1"
  });
  let modelDraft: SafeModelDraftRun | undefined;

  if (prepared) {
    try {
      const apiKey = await secretStore.resolveProjectSecret(prepared.projectId, {
        kind: "api-key",
        providerId: prepared.providerId
      });
      const connector = createModelProviderConnector(prepared.baseUrl);
      const draft = await connector.generateSafeDraft({
        id: prepared.providerId,
        name: prepared.providerName,
        providerType: prepared.providerType,
        baseUrl: prepared.baseUrl,
        apiKey,
        modelId: prepared.modelId,
        context: prepared.context
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

  return store.appendMessage(input, modelDraft);
}

async function readSapObjectEvidence(store: WorkspaceStore, secretStore: SecureSecretStore, input: unknown): Promise<SapObjectEvidenceResult> {
  const request = parseSapObjectEvidenceRequest(input);
  const { projectId, caseId, config } = await store.getActiveProjectConfig();
  const configCheck = validateAdtConfig(config);
  if (!configCheck.ok) {
    throw new Error(`${configCheck.message} ${configCheck.suggestion}`);
  }
  if (config.adt.connectionStatus !== "verified" || config.adt.minimalReadStatus !== "verified") {
    throw new Error("ADT read-only evidence requires verified connection and T000 minimal read first.");
  }

  const allowFakeEvidence = (
    process.env.WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE === "1" &&
    config.adt.lastVerificationMode === "fake" &&
    isDemoAdtHost(config.adt.url)
  );
  const allowRealEvidence = config.adt.lastVerificationMode === "adt";
  if (!allowRealEvidence && !allowFakeEvidence) {
    throw new Error("SAP object evidence is blocked until a real ADT read-only verification is available. Fake evidence requires an explicit local probe flag and demo SAP host.");
  }

  let password = "";
  try {
    password = await secretStore.resolveProjectSecret(projectId, { kind: "adt-password" });
  } catch {
    throw new Error("SAP password is unavailable in secure storage. Save the current project SAP password and verify ADT read-only mode again.");
  }

  const connector = allowFakeEvidence ? new FakeAdtReadonlyConnector() : createAdtReadonlyConnector();
  const evidence = await connector.readObjectEvidence({ ...adtInputWithoutPassword(config), password }, request, {
    allowFakeEvidence
  });
  return store.appendSapObjectEvidence(evidence, { projectId, caseId });
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
  ipcMain.handle("workbench:create-local-project", (event, input: unknown) => trustedResponse(event, appRoot, () => store.createLocalProject(input)));
  ipcMain.handle("workbench:create-local-case", (event, input: unknown) => trustedResponse(event, appRoot, () => store.createLocalCase(input)));
  ipcMain.handle("workbench:switch-project", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchProject(input)));
  ipcMain.handle("workbench:hide-project-from-sidebar", (event, input: unknown) => trustedResponse(event, appRoot, () => store.hideProjectFromSidebar(input)));
  ipcMain.handle("workbench:switch-case", (event, input: unknown) => trustedResponse(event, appRoot, () => store.switchCase(input)));
  ipcMain.handle("workbench:append-message", (event, input: unknown) => trustedResponse(event, appRoot, () => appendCaseMessage(store, secretStore, input)));
  ipcMain.handle("workbench:get-case-files", (event) => trustedResponse(event, appRoot, () => store.getCaseFiles()));
  ipcMain.handle("workbench:preview-current-case-file", (event, input: unknown) => trustedResponse(event, appRoot, () => store.previewCurrentCaseFile(input)));
  ipcMain.handle("workbench:search", (event, query: string) => trustedResponse(event, appRoot, () => store.search(query)));
  ipcMain.handle("workbench:read-sap-object-evidence", (event, input: unknown) => trustedResponse(event, appRoot, () => readSapObjectEvidence(store, secretStore, input)));
  ipcMain.handle("workbench:prepare-feishu-handoff", (event) => trustedResponse(event, appRoot, () => prepareFeishuHandoff(store)));
  ipcMain.handle("workbench:save-project-config", (event, projectId: string, config: unknown) => trustedResponse(event, appRoot, () => store.saveProjectConfig(projectId, config)));
  ipcMain.handle("workbench:save-project-secret", (event, projectId: string, input: unknown) => trustedResponse(event, appRoot, () => saveProjectSecret(store, secretStore, projectId, input)));
  ipcMain.handle("workbench:adt-verify-readonly", (event, projectId: unknown) => trustedResponse(event, appRoot, () => verifyAdtReadonly(store, secretStore, projectId)));
  ipcMain.handle("workbench:feishu-verify-cli", (event, projectId: unknown) => trustedResponse(event, appRoot, () => verifyFeishuCli(store, projectId)));
  ipcMain.handle("workbench:model-provider-verify", (event, projectId: unknown, providerId: unknown) => trustedResponse(event, appRoot, () => verifyModelProvider(store, secretStore, projectId, providerId)));
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
  ipcMain.handle("workbench:knowledge-publish", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.publishKnowledge(validProjectId(projectId, "确认知识入库"), input)));
  ipcMain.handle("workbench:knowledge-mark-conflict", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.markKnowledgeConflicted(validProjectId(projectId, "标记知识冲突"), input)));
  ipcMain.handle("workbench:knowledge-expire", (event, projectId: unknown, input: unknown) => trustedResponse(event, appRoot, () => store.expireKnowledge(validProjectId(projectId, "标记知识失效"), input)));
}

function createMainWindow(): void {
  const appRoot = app.getAppPath();
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "SAP AI 顾问工作台",
    backgroundColor: "#f7f8fb",
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

  if (rendererUrl && isTrustedRendererUrl(rendererUrl, appRoot, rendererUrl)) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(appRoot, "dist/renderer/index.html"));
  }
}

app.whenReady().then(() => {
  const appRoot = app.getAppPath();
  const repoRoot = process.env.WORKBENCH_REPO_ROOT ?? path.resolve(appRoot, "../..");
  registerWorkbenchHandlers(new WorkspaceStore(repoRoot), new SecureSecretStore(repoRoot), appRoot);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
