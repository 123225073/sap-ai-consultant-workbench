import { contextBridge, ipcRenderer } from "electron";
import type { AdtVerificationResult, CaseFileNode, CaseFilePreview, CaseFilePreviewInput, CaseWorkflowInput, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, FeishuVerificationResult, KnowledgeItemActionInput, ModelProviderVerificationResult, ProjectConfig, ProjectKnowledgeView, ProjectSecretInput, ProjectStandardsView, SaveProjectStandardsInput, SearchResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

contextBridge.exposeInMainWorld("workbench", {
  getAppInfo: () => ({
    name: "SAP AI 顾问工作台",
    edition: "个人版 MVP",
    phase: "Phase 11"
  }),
  getState: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:get-state"),
  createDemoProject: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-demo-project"),
  createDemoCase: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-demo-case"),
  appendMessage: (input: CaseWorkflowInput | string): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:append-message", input),
  getCaseFiles: (): Promise<WorkbenchResponse<CaseFileNode[]>> => ipcRenderer.invoke("workbench:get-case-files"),
  previewCurrentCaseFile: (input: CaseFilePreviewInput): Promise<WorkbenchResponse<CaseFilePreview>> => ipcRenderer.invoke("workbench:preview-current-case-file", input),
  search: (query: string): Promise<WorkbenchResponse<SearchResult[]>> => ipcRenderer.invoke("workbench:search", query),
  saveProjectConfig: (projectId: string, config: ProjectConfig): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:save-project-config", projectId, config),
  saveProjectSecret: (projectId: string, input: ProjectSecretInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:save-project-secret", projectId, input),
  verifyAdtReadonly: (projectId: string): Promise<WorkbenchResponse<AdtVerificationResult>> => ipcRenderer.invoke("workbench:adt-verify-readonly", projectId),
  verifyFeishuCli: (projectId: string): Promise<WorkbenchResponse<FeishuVerificationResult>> => ipcRenderer.invoke("workbench:feishu-verify-cli", projectId),
  verifyModelProvider: (projectId: string, providerId: string): Promise<WorkbenchResponse<ModelProviderVerificationResult>> => ipcRenderer.invoke("workbench:model-provider-verify", projectId, providerId),
  getProjectStandards: (projectId: string): Promise<WorkbenchResponse<ProjectStandardsView>> => ipcRenderer.invoke("workbench:get-project-standards", projectId),
  copyProjectStandardsTemplate: (projectId: string, input: CopyProjectStandardsInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:standards-copy-template", projectId, input),
  copyProjectStandardsFromProject: (projectId: string, input: CopyProjectStandardsFromProjectInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:standards-copy-project", projectId, input),
  saveProjectStandards: (projectId: string, input: SaveProjectStandardsInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:standards-save", projectId, input),
  getProjectKnowledge: (projectId: string): Promise<WorkbenchResponse<ProjectKnowledgeView>> => ipcRenderer.invoke("workbench:get-project-knowledge", projectId),
  publishKnowledge: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-publish", projectId, input),
  markKnowledgeConflicted: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-mark-conflict", projectId, input),
  expireKnowledge: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-expire", projectId, input)
});
