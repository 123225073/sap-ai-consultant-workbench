import { contextBridge, ipcRenderer } from "electron";
import type { AdtVerificationResult, CaseFileNode, CaseFilePreview, CaseFilePreviewInput, CaseWorkflowInput, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, CreateLocalCaseInput, CreateLocalProjectInput, FeishuHandoffResult, FeishuVerificationResult, KnowledgeImportLocalTextInput, KnowledgeImportLocalTextResult, KnowledgeItemActionInput, ModelProviderVerificationResult, ProjectConfig, ProjectKnowledgeView, ProjectSecretInput, ProjectStandardsView, SapObjectEvidenceRequest, SapObjectEvidenceResult, SaveProjectStandardsInput, SearchResult, SwitchCaseInput, SwitchProjectInput, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

contextBridge.exposeInMainWorld("workbench", {
  getAppInfo: () => ({
    name: "SAP AI 顾问工作台",
    edition: "个人版 MVP",
    phase: "Phase 17"
  }),
  getState: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:get-state"),
  createLocalProject: (input: CreateLocalProjectInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-local-project", input),
  createLocalCase: (input: CreateLocalCaseInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-local-case", input),
  switchProject: (input: SwitchProjectInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:switch-project", input),
  switchCase: (input: SwitchCaseInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:switch-case", input),
  appendMessage: (input: CaseWorkflowInput | string): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:append-message", input),
  getCaseFiles: (): Promise<WorkbenchResponse<CaseFileNode[]>> => ipcRenderer.invoke("workbench:get-case-files"),
  previewCurrentCaseFile: (input: CaseFilePreviewInput): Promise<WorkbenchResponse<CaseFilePreview>> => ipcRenderer.invoke("workbench:preview-current-case-file", input),
  search: (query: string): Promise<WorkbenchResponse<SearchResult[]>> => ipcRenderer.invoke("workbench:search", query),
  readSapObjectEvidence: (input: SapObjectEvidenceRequest): Promise<WorkbenchResponse<SapObjectEvidenceResult>> => ipcRenderer.invoke("workbench:read-sap-object-evidence", input),
  prepareFeishuHandoff: (): Promise<WorkbenchResponse<FeishuHandoffResult>> => ipcRenderer.invoke("workbench:prepare-feishu-handoff"),
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
  importKnowledgeLocalText: (input: KnowledgeImportLocalTextInput): Promise<WorkbenchResponse<KnowledgeImportLocalTextResult>> => ipcRenderer.invoke("workbench:knowledge-import-local-text", input),
  publishKnowledge: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-publish", projectId, input),
  markKnowledgeConflicted: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-mark-conflict", projectId, input),
  expireKnowledge: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-expire", projectId, input)
});
