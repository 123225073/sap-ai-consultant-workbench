import { contextBridge, ipcRenderer } from "electron";
import type { CaseFileNode, ProjectConfig, SearchResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

contextBridge.exposeInMainWorld("workbench", {
  getAppInfo: () => ({
    name: "SAP AI 顾问工作台",
    edition: "个人版 MVP",
    phase: "Phase 2"
  }),
  getState: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:get-state"),
  createDemoProject: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-demo-project"),
  createDemoCase: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-demo-case"),
  appendMessage: (content: string): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:append-message", content),
  getCaseFiles: (): Promise<WorkbenchResponse<CaseFileNode[]>> => ipcRenderer.invoke("workbench:get-case-files"),
  search: (query: string): Promise<WorkbenchResponse<SearchResult[]>> => ipcRenderer.invoke("workbench:search", query),
  saveProjectConfig: (projectId: string, config: ProjectConfig): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:save-project-config", projectId, config)
});
