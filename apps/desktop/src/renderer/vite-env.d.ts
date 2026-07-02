/// <reference types="vite/client" />

import type { AdtVerificationResult, CaseFileNode, CaseFilePreview, CaseFilePreviewInput, CaseWorkflowInput, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, FeishuVerificationResult, KnowledgeItemActionInput, ModelProviderVerificationResult, ProjectConfig, ProjectKnowledgeView, ProjectSecretInput, ProjectStandardsView, SaveProjectStandardsInput, SearchResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

interface WorkbenchBridge {
  getAppInfo: () => {
    name: string;
    edition: string;
    phase: string;
  };
  getState: () => Promise<WorkbenchResponse<WorkbenchState>>;
  createDemoProject: () => Promise<WorkbenchResponse<WorkbenchState>>;
  createDemoCase: () => Promise<WorkbenchResponse<WorkbenchState>>;
  appendMessage: (input: CaseWorkflowInput | string) => Promise<WorkbenchResponse<WorkbenchState>>;
  getCaseFiles: () => Promise<WorkbenchResponse<CaseFileNode[]>>;
  previewCurrentCaseFile: (input: CaseFilePreviewInput) => Promise<WorkbenchResponse<CaseFilePreview>>;
  search: (query: string) => Promise<WorkbenchResponse<SearchResult[]>>;
  saveProjectConfig: (projectId: string, config: ProjectConfig) => Promise<WorkbenchResponse<WorkbenchState>>;
  saveProjectSecret: (projectId: string, input: ProjectSecretInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  verifyAdtReadonly: (projectId: string) => Promise<WorkbenchResponse<AdtVerificationResult>>;
  verifyFeishuCli: (projectId: string) => Promise<WorkbenchResponse<FeishuVerificationResult>>;
  verifyModelProvider: (projectId: string, providerId: string) => Promise<WorkbenchResponse<ModelProviderVerificationResult>>;
  getProjectStandards: (projectId: string) => Promise<WorkbenchResponse<ProjectStandardsView>>;
  copyProjectStandardsTemplate: (projectId: string, input: CopyProjectStandardsInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  copyProjectStandardsFromProject: (projectId: string, input: CopyProjectStandardsFromProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  saveProjectStandards: (projectId: string, input: SaveProjectStandardsInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  getProjectKnowledge: (projectId: string) => Promise<WorkbenchResponse<ProjectKnowledgeView>>;
  publishKnowledge: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  markKnowledgeConflicted: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  expireKnowledge: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
}

declare global {
  interface Window {
    workbench?: WorkbenchBridge;
  }
}
