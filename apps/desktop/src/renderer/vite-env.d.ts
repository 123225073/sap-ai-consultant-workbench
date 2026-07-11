/// <reference types="vite/client" />

import type { AdtVerificationResult, AppendDailyChatMessageInput, CaseFileNode, CaseFilePreview, CaseFilePreviewInput, CaseWorkflowInput, CodexVerificationResult, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, CreateDailyChatThreadInput, CreateLocalCaseInput, CreateLocalProjectInput, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuHandoffResult, FeishuVerificationResult, HideProjectFromSidebarInput, KnowledgeCaseReferenceInput, KnowledgeEditInput, KnowledgeImportLocalTextInput, KnowledgeImportLocalTextResult, KnowledgeImportTextFileInput, KnowledgeImportTextFileResult, KnowledgeItemActionInput, KnowledgeReviewInput, LocalAiInstallInput, LocalAiInstallResult, LocalAiScanResult, ModelProviderVerificationResult, ProjectConfig, ProjectKnowledgeView, ProjectSecretInput, ProjectStandardsView, RestoreProjectToSidebarInput, SapObjectEvidenceRequest, SapObjectEvidenceResult, SaveProjectStandardsInput, SearchResult, SwitchCaseInput, SwitchDailyChatThreadInput, SwitchProjectInput, WorkbenchResponse, WorkbenchState, WorkspaceBackupResult, WorkspaceImportResult } from "../shared/workbenchTypes";

interface WorkbenchBridge {
  getAppInfo: () => {
    name: string;
    edition: string;
    phase: string;
  };
  getState: () => Promise<WorkbenchResponse<WorkbenchState>>;
  createWorkspaceBackup: () => Promise<WorkbenchResponse<WorkspaceBackupResult>>;
  importWorkspace: () => Promise<WorkbenchResponse<WorkspaceImportResult>>;
  createLocalProject: (input: CreateLocalProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  createLocalCase: (input: CreateLocalCaseInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  createDailyChatThread: (input?: CreateDailyChatThreadInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchDailyChatThread: (input: SwitchDailyChatThreadInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  appendDailyChatMessage: (input: AppendDailyChatMessageInput | string) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchProject: (input: SwitchProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  hideProjectFromSidebar: (input: HideProjectFromSidebarInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  restoreProjectToSidebar: (input: RestoreProjectToSidebarInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchCase: (input: SwitchCaseInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  appendMessage: (input: CaseWorkflowInput | string) => Promise<WorkbenchResponse<WorkbenchState>>;
  getCaseFiles: () => Promise<WorkbenchResponse<CaseFileNode[]>>;
  previewCurrentCaseFile: (input: CaseFilePreviewInput) => Promise<WorkbenchResponse<CaseFilePreview>>;
  search: (query: string) => Promise<WorkbenchResponse<SearchResult[]>>;
  readSapObjectEvidence: (input: SapObjectEvidenceRequest) => Promise<WorkbenchResponse<SapObjectEvidenceResult>>;
  prepareFeishuHandoff: () => Promise<WorkbenchResponse<FeishuHandoffResult>>;
  discoverFeishuCli: () => Promise<WorkbenchResponse<FeishuCliDiscoveryReport>>;
  installFeishuCli: () => Promise<WorkbenchResponse<FeishuCliInstallResult>>;
  saveFeishuCliProfile: (projectId: string) => Promise<WorkbenchResponse<FeishuCliProfileSetupResult>>;
  openFeishuDeveloperConsole: () => Promise<WorkbenchResponse<{ opened: true; url: string }>>;
  saveProjectConfig: (projectId: string, config: ProjectConfig) => Promise<WorkbenchResponse<WorkbenchState>>;
  saveProjectSecret: (projectId: string, input: ProjectSecretInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  verifyAdtReadonly: (projectId: string) => Promise<WorkbenchResponse<AdtVerificationResult>>;
  verifyFeishuCli: (projectId: string) => Promise<WorkbenchResponse<FeishuVerificationResult>>;
  verifyModelProvider: (projectId: string, providerId: string) => Promise<WorkbenchResponse<ModelProviderVerificationResult>>;
  verifyCodexCli: (projectId: string) => Promise<WorkbenchResponse<CodexVerificationResult>>;
  scanLocalAiCapabilities: () => Promise<WorkbenchResponse<LocalAiScanResult>>;
  installLocalAiCapability: (input: LocalAiInstallInput) => Promise<WorkbenchResponse<LocalAiInstallResult>>;
  getProjectStandards: (projectId: string) => Promise<WorkbenchResponse<ProjectStandardsView>>;
  copyProjectStandardsTemplate: (projectId: string, input: CopyProjectStandardsInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  copyProjectStandardsFromProject: (projectId: string, input: CopyProjectStandardsFromProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  saveProjectStandards: (projectId: string, input: SaveProjectStandardsInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  getProjectKnowledge: (projectId: string) => Promise<WorkbenchResponse<ProjectKnowledgeView>>;
  importKnowledgeLocalText: (input: KnowledgeImportLocalTextInput) => Promise<WorkbenchResponse<KnowledgeImportLocalTextResult>>;
  importKnowledgeTextFile: (input: KnowledgeImportTextFileInput) => Promise<WorkbenchResponse<KnowledgeImportTextFileResult>>;
  reviewKnowledgeForPublish: (projectId: string, input: KnowledgeReviewInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  editKnowledgeCandidate: (projectId: string, input: KnowledgeEditInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  attachKnowledgeToCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  detachKnowledgeFromCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  publishKnowledge: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  markKnowledgeConflicted: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  expireKnowledge: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
}

declare global {
  interface Window {
    workbench?: WorkbenchBridge;
  }
}
