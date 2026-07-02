import { contextBridge, ipcRenderer } from "electron";
import type { AdtVerificationResult, CaseFileNode, CaseWorkflowInput, FeishuVerificationResult, ModelProviderVerificationResult, ProjectConfig, ProjectSecretInput, SearchResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

contextBridge.exposeInMainWorld("workbench", {
  getAppInfo: () => ({
    name: "SAP AI 顾问工作台",
    edition: "个人版 MVP",
    phase: "Phase 4"
  }),
  getState: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:get-state"),
  createDemoProject: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-demo-project"),
  createDemoCase: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-demo-case"),
  appendMessage: (input: CaseWorkflowInput | string): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:append-message", input),
  getCaseFiles: (): Promise<WorkbenchResponse<CaseFileNode[]>> => ipcRenderer.invoke("workbench:get-case-files"),
  search: (query: string): Promise<WorkbenchResponse<SearchResult[]>> => ipcRenderer.invoke("workbench:search", query),
  saveProjectConfig: (projectId: string, config: ProjectConfig): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:save-project-config", projectId, config),
  saveProjectSecret: (projectId: string, input: ProjectSecretInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:save-project-secret", projectId, input),
  verifyAdtReadonly: (projectId: string): Promise<WorkbenchResponse<AdtVerificationResult>> => ipcRenderer.invoke("workbench:adt-verify-readonly", projectId),
  verifyFeishuCli: (projectId: string): Promise<WorkbenchResponse<FeishuVerificationResult>> => ipcRenderer.invoke("workbench:feishu-verify-cli", projectId),
  verifyModelProvider: (projectId: string, providerId: string): Promise<WorkbenchResponse<ModelProviderVerificationResult>> => ipcRenderer.invoke("workbench:model-provider-verify", projectId, providerId)
});
