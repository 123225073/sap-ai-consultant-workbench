import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createAdtReadonlyConnector, createAdtValidationFailureReport, type AdtConnectorInput } from "./adtReadonlyConnector";
import { SecureSecretStore } from "./secureSecretStore";
import { WorkspaceStore } from "./workspaceStore";
import { isManagedSecretRef } from "../shared/secretHandle";
import type { AdtVerificationErrorCode, AdtVerificationResult, ProjectConfig, ProjectSecretInput, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

const SENSITIVE_ERROR_PATTERNS = [
  /bearer\s+[a-z0-9._-]+/gi,
  /authorization:\s*[^\s]+/gi,
  /cookie:\s*[^\s]+/gi,
  /x-csrf-token:\s*[^\s]+/gi,
  /secure-store:sec_[a-f0-9]{32}/gi,
  /sk-[a-z0-9]{20,}/gi
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

  if (config.adt.credential.state !== "set-in-secure-store" || !isManagedSecretRef(config.adt.credential.secretRef)) {
    return {
      ok: false,
      code: "missing-credential",
      message: "当前项目还没有保存 SAP 密码到系统安全存储。",
      suggestion: "请先保存或替换 SAP 密码；保存后仍需再次执行只读验证。"
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
    password = await secretStore.resolveValue(config.adt.credential.secretRef as string);
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

function registerWorkbenchHandlers(store: WorkspaceStore, secretStore: SecureSecretStore): void {
  ipcMain.handle("workbench:get-state", () => response(store.getState()));
  ipcMain.handle("workbench:create-demo-project", () => response(store.createDemoProject()));
  ipcMain.handle("workbench:create-demo-case", () => response(store.createDemoCase()));
  ipcMain.handle("workbench:append-message", (_event, content: string) => response(store.appendMessage(content)));
  ipcMain.handle("workbench:get-case-files", () => response(store.getCaseFiles()));
  ipcMain.handle("workbench:search", (_event, query: string) => response(store.search(query)));
  ipcMain.handle("workbench:save-project-config", (_event, projectId: string, config: unknown) => response(store.saveProjectConfig(projectId, config)));
  ipcMain.handle("workbench:save-project-secret", (_event, projectId: string, input: unknown) => response(saveProjectSecret(store, secretStore, projectId, input)));
  ipcMain.handle("workbench:adt-verify-readonly", (_event, projectId: unknown) => response(verifyAdtReadonly(store, secretStore, projectId)));
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

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(appRoot, "dist/renderer/index.html"));
  }
}

app.whenReady().then(() => {
  const repoRoot = process.env.WORKBENCH_REPO_ROOT ?? path.resolve(app.getAppPath(), "../..");
  registerWorkbenchHandlers(new WorkspaceStore(repoRoot), new SecureSecretStore(repoRoot));
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
