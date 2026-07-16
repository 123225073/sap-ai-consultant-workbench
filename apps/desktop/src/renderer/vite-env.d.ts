/// <reference types="vite/client" />

import type { AdtVerificationResult, AiConversationStreamEvent, AppendDailyChatMessageInput, CaseFileNode, CaseFilePreview, CaseFilePreviewInput, CaseWorkflowInput, CodexVerificationResult, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, CreateDailyChatThreadInput, CreateLocalCaseInput, CreateLocalProjectInput, CreateWorkThreadInput, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuHandoffResult, FeishuVerificationResult, HideProjectFromSidebarInput, KnowledgeCaseReferenceInput, KnowledgeEditInput, KnowledgeImportLocalTextInput, KnowledgeImportLocalTextResult, KnowledgeImportTextFileInput, KnowledgeImportTextFileResult, KnowledgeItemActionInput, KnowledgeReviewInput, LocalAiInstallInput, LocalAiInstallResult, LocalAiScanResult, LocalTaskFolderSelectionResult, ModelProviderVerificationResult, ProjectConfig, ProjectKnowledgeView, ProjectSecretInput, ProjectStandardsView, RestoreProjectToSidebarInput, SapGuiDiscoveryReport, SapObjectEvidenceRequest, SapObjectEvidenceResult, SaveProjectStandardsInput, SearchResult, SelectLocalTaskFolderInput, SwitchCaseInput, SwitchDailyChatThreadInput, SwitchProjectInput, SwitchWorkThreadInput, UpdateConversationThreadStatusInput, WorkbenchResponse, WorkbenchState, WorkspaceBackupResult, WorkspaceImportResult } from "../shared/workbenchTypes";
import type { AgentRuntimeEvent, AgentRuntimeHealth, CancelAgentTurnInput } from "../shared/agentRuntimeTypes";
import type { CapabilityCenterSnapshot, CreateCapabilityMemoryInput, ImportCapabilityPluginInput, ImportCapabilitySkillInput, RemoveCapabilityMcpInput, ReviewCapabilityMemoryInput, RevokeCapabilityMemoryInput, SaveCapabilityMcpInput, SaveCapabilityPromptInput, SetCapabilityMcpEnabledInput, SetCapabilityMcpToolEnabledInput, SetCapabilityPluginEnabledInput, SetCapabilityPromptEnabledInput, SetCapabilitySkillEnabledInput, TestCapabilityMcpInput, UpdateCapabilityMemoryInput } from "../shared/capabilityCenterTypes";

interface WorkbenchBridge {
  getAppInfo: () => {
    name: string;
    edition: string;
    phase: string;
  };
  getState: () => Promise<WorkbenchResponse<WorkbenchState>>;
  getAgentRuntimeHealth: () => Promise<WorkbenchResponse<AgentRuntimeHealth>>;
  cancelAgentTurn: (input: CancelAgentTurnInput) => Promise<WorkbenchResponse<{ cancelled: boolean; message: string }>>;
  getCapabilityCenterSnapshot: () => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  importCapabilityPlugin: (input: ImportCapabilityPluginInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  setCapabilityPluginEnabled: (input: SetCapabilityPluginEnabledInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  importCapabilitySkill: (input: ImportCapabilitySkillInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  setCapabilitySkillEnabled: (input: SetCapabilitySkillEnabledInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  saveCapabilityPrompt: (input: SaveCapabilityPromptInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  setCapabilityPromptEnabled: (input: SetCapabilityPromptEnabledInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  createCapabilityMemory: (input: CreateCapabilityMemoryInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  updateCapabilityMemory: (input: UpdateCapabilityMemoryInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  reviewCapabilityMemory: (input: ReviewCapabilityMemoryInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  revokeCapabilityMemory: (input: RevokeCapabilityMemoryInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  saveCapabilityMcp: (input: SaveCapabilityMcpInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  testCapabilityMcp: (input: TestCapabilityMcpInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  setCapabilityMcpEnabled: (input: SetCapabilityMcpEnabledInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  setCapabilityMcpToolEnabled: (input: SetCapabilityMcpToolEnabledInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  removeCapabilityMcp: (input: RemoveCapabilityMcpInput) => Promise<WorkbenchResponse<CapabilityCenterSnapshot>>;
  onAgentRuntimeEvent: (handler: (event: AgentRuntimeEvent) => void) => () => void;
  createWorkspaceBackup: () => Promise<WorkbenchResponse<WorkspaceBackupResult>>;
  importWorkspace: () => Promise<WorkbenchResponse<WorkspaceImportResult>>;
  createLocalProject: (input: CreateLocalProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  createLocalCase: (input: CreateLocalCaseInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  selectLocalTaskFolder: (input: SelectLocalTaskFolderInput) => Promise<WorkbenchResponse<LocalTaskFolderSelectionResult>>;
  createWorkThread: (input: CreateWorkThreadInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchWorkThread: (input: SwitchWorkThreadInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  updateConversationThreadStatus: (input: UpdateConversationThreadStatusInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  createDailyChatThread: (input?: CreateDailyChatThreadInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchDailyChatThread: (input: SwitchDailyChatThreadInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  appendDailyChatMessage: (input: AppendDailyChatMessageInput | string) => Promise<WorkbenchResponse<WorkbenchState>>;
  appendDailyChatMessageStreaming: (input: AppendDailyChatMessageInput, onEvent: (event: AiConversationStreamEvent) => void) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchProject: (input: SwitchProjectInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  hideProjectFromSidebar: (input: HideProjectFromSidebarInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  restoreProjectToSidebar: (input: RestoreProjectToSidebarInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  switchCase: (input: SwitchCaseInput) => Promise<WorkbenchResponse<WorkbenchState>>;
  appendMessage: (input: CaseWorkflowInput | string) => Promise<WorkbenchResponse<WorkbenchState>>;
  appendMessageStreaming: (input: CaseWorkflowInput, onEvent: (event: AiConversationStreamEvent) => void) => Promise<WorkbenchResponse<WorkbenchState>>;
  getCaseFiles: () => Promise<WorkbenchResponse<CaseFileNode[]>>;
  previewCurrentCaseFile: (input: CaseFilePreviewInput) => Promise<WorkbenchResponse<CaseFilePreview>>;
  search: (query: string) => Promise<WorkbenchResponse<SearchResult[]>>;
  readSapObjectEvidence: (input: SapObjectEvidenceRequest) => Promise<WorkbenchResponse<SapObjectEvidenceResult>>;
  discoverSapGuiConnections: () => Promise<WorkbenchResponse<SapGuiDiscoveryReport>>;
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
