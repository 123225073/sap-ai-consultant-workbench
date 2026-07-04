/// <reference types="vite/client" />

import type { AdtVerificationResult, CaseFileNode, CaseFilePreview, CaseFilePreviewInput, CaseWorkflowInput, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, CreateLocalCaseInput, CreateLocalProjectInput, FeishuHandoffResult, FeishuVerificationResult, KnowledgeEditInput, KnowledgeImportLocalTextInput, KnowledgeImportLocalTextResult, KnowledgeImportTextFileInput, KnowledgeImportTextFileResult, KnowledgeItemActionInput, KnowledgeReviewInput, ModelProviderVerificationResult, ProjectConfig, ProjectKnowledgeView, ProjectSecretInput, ProjectStandardsView, SapObjectEvidenceRequest, SapObjectEvidenceResult, SaveProjectStandardsInput, SearchResult, SwitchCaseInput, SwitchProjectInput, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

interface WorkbenchBridge {
  getAppInfo: () => {
    name: string;
    edition: string;
    phase: string;
  };
  getState: () => Promise<WorkbenchResponse<WorkbenchState>>;
  createLocalProject: (input: CreateLocalProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  createLocalCase: (input: CreateLocalCaseInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchProject: (input: SwitchProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchCase: (input: SwitchCaseInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  appendMessage: (input: CaseWorkflowInput | string) => Promise<WorkbenchResponse<WorkbenchState>>;
  getCaseFiles: () => Promise<WorkbenchResponse<CaseFileNode[]>>;
  previewCurrentCaseFile: (input: CaseFilePreviewInput) => Promise<WorkbenchResponse<CaseFilePreview>>;
  search: (query: string) => Promise<WorkbenchResponse<SearchResult[]>>;
  readSapObjectEvidence: (input: SapObjectEvidenceRequest) => Promise<WorkbenchResponse<SapObjectEvidenceResult>>;
  prepareFeishuHandoff: () => Promise<WorkbenchResponse<FeishuHandoffResult>>;
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
  importKnowledgeLocalText: (input: KnowledgeImportLocalTextInput) => Promise<WorkbenchResponse<KnowledgeImportLocalTextResult>>;
  importKnowledgeTextFile: (input: KnowledgeImportTextFileInput) => Promise<WorkbenchResponse<KnowledgeImportTextFileResult>>;
  reviewKnowledgeForPublish: (projectId: string, input: KnowledgeReviewInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  editKnowledgeCandidate: (projectId: string, input: KnowledgeEditInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  publishKnowledge: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  markKnowledgeConflicted: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  expireKnowledge: (projectId: string, input: KnowledgeItemActionInput) => Promise<WorkbenchResponse<WorkbenchState>>;
}

declare global {
  interface Window {
    workbench?: WorkbenchBridge;
  }
}
