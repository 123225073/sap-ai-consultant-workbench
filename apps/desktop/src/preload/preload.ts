import { contextBridge, ipcRenderer } from "electron";
import type { AdtVerificationResult, AiConversationStreamEvent, AppendDailyChatMessageInput, CaseAttachmentImportResult, CaseFileNode, CaseFilePreview, CaseFilePreviewInput, CaseWorkflowInput, CodexVerificationResult, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, CreateDailyChatThreadInput, CreateLocalCaseInput, CreateLocalProjectInput, CreateWorkThreadInput, ExportCaseDiagramInput, ExportCaseDiagramResult, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuHandoffResult, FeishuVerificationResult, HideProjectFromSidebarInput, ImportCaseAttachmentsInput, KnowledgeCaseReferenceInput, KnowledgeEditInput, KnowledgeImportLocalTextInput, KnowledgeImportLocalTextResult, KnowledgeImportTextFileInput, KnowledgeImportTextFileResult, KnowledgeItemActionInput, KnowledgeReviewInput, LocalAiInstallInput, LocalAiInstallResult, LocalAiScanResult, LocalTaskFolderSelectionResult, ModelProviderVerificationResult, ProjectConfig, ProjectKnowledgeView, ProjectSecretInput, ProjectStandardsView, RestoreProjectToSidebarInput, SapGuiDiscoveryReport, SapObjectEvidenceRequest, SapObjectEvidenceResult, SaveProjectStandardsInput, SearchResult, SelectLocalTaskFolderInput, SwitchCaseInput, SwitchDailyChatThreadInput, SwitchProjectInput, SwitchWorkThreadInput, UpdateConversationThreadStatusInput, WorkbenchResponse, WorkbenchState, WorkspaceBackupResult, WorkspaceImportResult } from "../shared/workbenchTypes";
import type { AgentRuntimeEvent, AgentRuntimeHealth, AgentThreadReplayInput, AgentThreadSnapshot, CancelAgentTurnInput } from "../shared/agentRuntimeTypes";
import type { CapabilityCenterSnapshot, CapabilitySkillDiscoveryReport, CreateCapabilityMemoryInput, DiscoverCapabilitySkillsInput, ImportCapabilityPluginInput, ImportCapabilitySkillInput, ImportDiscoveredCapabilitySkillsInput, RemoveCapabilityMcpInput, ReviewCapabilityMemoryInput, RevokeCapabilityMemoryInput, SaveCapabilityMcpInput, SaveCapabilityPromptInput, SetCapabilityMcpEnabledInput, SetCapabilityMcpToolEnabledInput, SetCapabilityPluginEnabledInput, SetCapabilityPromptEnabledInput, SetCapabilitySkillEnabledInput, TestCapabilityMcpInput, UpdateCapabilityMemoryInput } from "../shared/capabilityCenterTypes";

const AI_STREAM_EVENT_CHANNEL = "workbench:ai-conversation-stream";
const AGENT_RUNTIME_EVENT_CHANNEL = "workbench:agent-runtime-event";

function invokeWithAiStream(
  channel: "workbench:append-daily-chat-message-stream" | "workbench:append-message-stream",
  input: AppendDailyChatMessageInput | CaseWorkflowInput,
  onEvent: (event: AiConversationStreamEvent) => void
): Promise<WorkbenchResponse<WorkbenchState>> {
  const requestId = crypto.randomUUID();
  const listener = (_event: Electron.IpcRendererEvent, payload: AiConversationStreamEvent) => {
    if (payload?.requestId === requestId) onEvent(payload);
  };
  ipcRenderer.on(AI_STREAM_EVENT_CHANNEL, listener);
  return ipcRenderer.invoke(channel, requestId, input).finally(() => {
    ipcRenderer.removeListener(AI_STREAM_EVENT_CHANNEL, listener);
  });
}

contextBridge.exposeInMainWorld("workbench", {
  getAppInfo: () => ({
    name: "SAP AI 顾问工作台",
    edition: "个人版",
    phase: "0.1.0 Release Candidate"
  }),
  getState: (): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:get-state"),
  getAgentRuntimeHealth: (): Promise<WorkbenchResponse<AgentRuntimeHealth>> => ipcRenderer.invoke("workbench:agent-runtime-health"),
  readAgentThread: (input: AgentThreadReplayInput): Promise<WorkbenchResponse<AgentThreadSnapshot | null>> => ipcRenderer.invoke("workbench:agent-runtime-read-thread", input),
  cancelAgentTurn: (input: CancelAgentTurnInput): Promise<WorkbenchResponse<{ cancelled: boolean; message: string }>> => ipcRenderer.invoke("workbench:agent-runtime-cancel-turn", input),
  getCapabilityCenterSnapshot: (): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-center-snapshot"),
  importCapabilityPlugin: (input: ImportCapabilityPluginInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-plugin-import", input),
  setCapabilityPluginEnabled: (input: SetCapabilityPluginEnabledInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-plugin-enabled", input),
  importCapabilitySkill: (input: ImportCapabilitySkillInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-skill-import", input),
  discoverCapabilitySkills: (input: DiscoverCapabilitySkillsInput): Promise<WorkbenchResponse<CapabilitySkillDiscoveryReport>> => ipcRenderer.invoke("workbench:capability-skill-discover", input),
  importDiscoveredCapabilitySkills: (input: ImportDiscoveredCapabilitySkillsInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-skill-import-discovered", input),
  setCapabilitySkillEnabled: (input: SetCapabilitySkillEnabledInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-skill-enabled", input),
  saveCapabilityPrompt: (input: SaveCapabilityPromptInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-prompt-save", input),
  setCapabilityPromptEnabled: (input: SetCapabilityPromptEnabledInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-prompt-enabled", input),
  createCapabilityMemory: (input: CreateCapabilityMemoryInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-memory-create", input),
  updateCapabilityMemory: (input: UpdateCapabilityMemoryInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-memory-update", input),
  reviewCapabilityMemory: (input: ReviewCapabilityMemoryInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-memory-review", input),
  revokeCapabilityMemory: (input: RevokeCapabilityMemoryInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-memory-revoke", input),
  saveCapabilityMcp: (input: SaveCapabilityMcpInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-mcp-save", input),
  testCapabilityMcp: (input: TestCapabilityMcpInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-mcp-test", input),
  setCapabilityMcpEnabled: (input: SetCapabilityMcpEnabledInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-mcp-enabled", input),
  setCapabilityMcpToolEnabled: (input: SetCapabilityMcpToolEnabledInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-mcp-tool-enabled", input),
  removeCapabilityMcp: (input: RemoveCapabilityMcpInput): Promise<WorkbenchResponse<CapabilityCenterSnapshot>> => ipcRenderer.invoke("workbench:capability-mcp-remove", input),
  onAgentRuntimeEvent: (handler: (event: AgentRuntimeEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentRuntimeEvent) => handler(payload);
    ipcRenderer.on(AGENT_RUNTIME_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(AGENT_RUNTIME_EVENT_CHANNEL, listener);
  },
  createWorkspaceBackup: (): Promise<WorkbenchResponse<WorkspaceBackupResult>> => ipcRenderer.invoke("workbench:create-workspace-backup"),
  importWorkspace: (): Promise<WorkbenchResponse<WorkspaceImportResult>> => ipcRenderer.invoke("workbench:import-workspace"),
  createLocalProject: (input: CreateLocalProjectInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-local-project", input),
  createLocalCase: (input: CreateLocalCaseInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-local-case", input),
  selectLocalTaskFolder: (input: SelectLocalTaskFolderInput): Promise<WorkbenchResponse<LocalTaskFolderSelectionResult>> => ipcRenderer.invoke("workbench:select-local-task-folder", input),
  createWorkThread: (input: CreateWorkThreadInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-work-thread", input),
  switchWorkThread: (input: SwitchWorkThreadInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:switch-work-thread", input),
  updateConversationThreadStatus: (input: UpdateConversationThreadStatusInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:update-conversation-thread-status", input),
  createDailyChatThread: (input: CreateDailyChatThreadInput = {}): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:create-daily-chat-thread", input),
  switchDailyChatThread: (input: SwitchDailyChatThreadInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:switch-daily-chat-thread", input),
  appendDailyChatMessage: (input: AppendDailyChatMessageInput | string): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:append-daily-chat-message", input),
  appendDailyChatMessageStreaming: (input: AppendDailyChatMessageInput, onEvent: (event: AiConversationStreamEvent) => void): Promise<WorkbenchResponse<WorkbenchState>> => invokeWithAiStream("workbench:append-daily-chat-message-stream", input, onEvent),
  switchProject: (input: SwitchProjectInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:switch-project", input),
  hideProjectFromSidebar: (input: HideProjectFromSidebarInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:hide-project-from-sidebar", input),
  restoreProjectToSidebar: (input: RestoreProjectToSidebarInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:restore-project-to-sidebar", input),
  switchCase: (input: SwitchCaseInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:switch-case", input),
  appendMessage: (input: CaseWorkflowInput | string): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:append-message", input),
  appendMessageStreaming: (input: CaseWorkflowInput, onEvent: (event: AiConversationStreamEvent) => void): Promise<WorkbenchResponse<WorkbenchState>> => invokeWithAiStream("workbench:append-message-stream", input, onEvent),
  getCaseFiles: (): Promise<WorkbenchResponse<CaseFileNode[]>> => ipcRenderer.invoke("workbench:get-case-files"),
  previewCurrentCaseFile: (input: CaseFilePreviewInput): Promise<WorkbenchResponse<CaseFilePreview>> => ipcRenderer.invoke("workbench:preview-current-case-file", input),
  importCaseAttachments: (input: ImportCaseAttachmentsInput): Promise<WorkbenchResponse<CaseAttachmentImportResult>> => ipcRenderer.invoke("workbench:import-case-attachments", input),
  exportCaseDiagram: (input: ExportCaseDiagramInput): Promise<WorkbenchResponse<ExportCaseDiagramResult>> => ipcRenderer.invoke("workbench:export-case-diagram", input),
  search: (query: string): Promise<WorkbenchResponse<SearchResult[]>> => ipcRenderer.invoke("workbench:search", query),
  readSapObjectEvidence: (input: SapObjectEvidenceRequest): Promise<WorkbenchResponse<SapObjectEvidenceResult>> => ipcRenderer.invoke("workbench:read-sap-object-evidence", input),
  discoverSapGuiConnections: (): Promise<WorkbenchResponse<SapGuiDiscoveryReport>> => ipcRenderer.invoke("workbench:sap-gui-discover"),
  prepareFeishuHandoff: (): Promise<WorkbenchResponse<FeishuHandoffResult>> => ipcRenderer.invoke("workbench:prepare-feishu-handoff"),
  discoverFeishuCli: (): Promise<WorkbenchResponse<FeishuCliDiscoveryReport>> => ipcRenderer.invoke("workbench:feishu-discover-cli"),
  installFeishuCli: (): Promise<WorkbenchResponse<FeishuCliInstallResult>> => ipcRenderer.invoke("workbench:feishu-install-cli"),
  saveFeishuCliProfile: (projectId: string): Promise<WorkbenchResponse<FeishuCliProfileSetupResult>> => ipcRenderer.invoke("workbench:feishu-save-profile", projectId),
  openFeishuDeveloperConsole: (): Promise<WorkbenchResponse<{ opened: true; url: string }>> => ipcRenderer.invoke("workbench:open-feishu-developer-console"),
  saveProjectConfig: (projectId: string, config: ProjectConfig): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:save-project-config", projectId, config),
  saveProjectSecret: (projectId: string, input: ProjectSecretInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:save-project-secret", projectId, input),
  verifyAdtReadonly: (projectId: string): Promise<WorkbenchResponse<AdtVerificationResult>> => ipcRenderer.invoke("workbench:adt-verify-readonly", projectId),
  verifyFeishuCli: (projectId: string): Promise<WorkbenchResponse<FeishuVerificationResult>> => ipcRenderer.invoke("workbench:feishu-verify-cli", projectId),
  verifyModelProvider: (projectId: string, providerId: string): Promise<WorkbenchResponse<ModelProviderVerificationResult>> => ipcRenderer.invoke("workbench:model-provider-verify", projectId, providerId),
  verifyCodexCli: (projectId: string): Promise<WorkbenchResponse<CodexVerificationResult>> => ipcRenderer.invoke("workbench:codex-verify-cli", projectId),
  scanLocalAiCapabilities: (): Promise<WorkbenchResponse<LocalAiScanResult>> => ipcRenderer.invoke("local-ai-scan"),
  installLocalAiCapability: (input: LocalAiInstallInput): Promise<WorkbenchResponse<LocalAiInstallResult>> => ipcRenderer.invoke("local-ai-install", input),
  getProjectStandards: (projectId: string): Promise<WorkbenchResponse<ProjectStandardsView>> => ipcRenderer.invoke("workbench:get-project-standards", projectId),
  copyProjectStandardsTemplate: (projectId: string, input: CopyProjectStandardsInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:standards-copy-template", projectId, input),
  copyProjectStandardsFromProject: (projectId: string, input: CopyProjectStandardsFromProjectInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:standards-copy-project", projectId, input),
  saveProjectStandards: (projectId: string, input: SaveProjectStandardsInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:standards-save", projectId, input),
  getProjectKnowledge: (projectId: string): Promise<WorkbenchResponse<ProjectKnowledgeView>> => ipcRenderer.invoke("workbench:get-project-knowledge", projectId),
  importKnowledgeLocalText: (input: KnowledgeImportLocalTextInput): Promise<WorkbenchResponse<KnowledgeImportLocalTextResult>> => ipcRenderer.invoke("workbench:knowledge-import-local-text", input),
  importKnowledgeTextFile: (input: KnowledgeImportTextFileInput): Promise<WorkbenchResponse<KnowledgeImportTextFileResult>> => ipcRenderer.invoke("workbench:knowledge-import-text-file", input),
  reviewKnowledgeForPublish: (projectId: string, input: KnowledgeReviewInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-review-for-publish", projectId, input),
  editKnowledgeCandidate: (projectId: string, input: KnowledgeEditInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-edit-candidate", projectId, input),
  attachKnowledgeToCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-attach-to-current-case", projectId, input),
  detachKnowledgeFromCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-detach-from-current-case", projectId, input),
  publishKnowledge: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-publish", projectId, input),
  markKnowledgeConflicted: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-mark-conflict", projectId, input),
  expireKnowledge: (projectId: string, input: KnowledgeItemActionInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:knowledge-expire", projectId, input)
});
