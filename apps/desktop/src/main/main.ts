import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { SecureSecretStore } from "./secureSecretStore";
import { WorkspaceStore } from "./workspaceStore";
import type { ProjectSecretInput, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

function response<T>(promise: Promise<T>): Promise<WorkbenchResponse<T>> {
  return promise
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "本地工作台操作失败。"
    }));
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

function registerWorkbenchHandlers(store: WorkspaceStore, secretStore: SecureSecretStore): void {
  ipcMain.handle("workbench:get-state", () => response(store.getState()));
  ipcMain.handle("workbench:create-demo-project", () => response(store.createDemoProject()));
  ipcMain.handle("workbench:create-demo-case", () => response(store.createDemoCase()));
  ipcMain.handle("workbench:append-message", (_event, content: string) => response(store.appendMessage(content)));
  ipcMain.handle("workbench:get-case-files", () => response(store.getCaseFiles()));
  ipcMain.handle("workbench:search", (_event, query: string) => response(store.search(query)));
  ipcMain.handle("workbench:save-project-config", (_event, projectId: string, config: unknown) => response(store.saveProjectConfig(projectId, config)));
  ipcMain.handle("workbench:save-project-secret", (_event, projectId: string, input: unknown) => response(saveProjectSecret(store, secretStore, projectId, input)));
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
