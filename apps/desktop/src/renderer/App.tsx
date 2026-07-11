import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  ChevronDown,
  Database,
  Eye,
  EyeOff,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  MessageSquare,
  PanelLeft,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  WandSparkles,
  X,
} from "lucide-react";
import ConfigCenter from "./ConfigCenter";
import KnowledgeCenter from "./KnowledgeCenter";
import StandardsCenter from "./StandardsCenter";
import type { ActionPermissionMode, AdtVerificationReport, ApiProviderConfig, CaseActionId, CaseFileNode, CaseFilePreview, CaseMessage, CodexVerificationReport, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, DailyChatMessage, DailyChatThread, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuVerificationReport, KnowledgeCaseReferenceInput, KnowledgeEditInput, KnowledgeImportLocalTextInput, KnowledgeImportTextFileResult, KnowledgeItemActionInput, KnowledgeReviewInput, LocalAiInstallResult, LocalAiScanResult, ModelCapability, ModelProviderVerificationReport, ModelSummary, ProjectSecretInput, ProjectSummary, SapObjectEvidenceType, SaveProjectStandardsInput, SearchResult, TaskMode, WorkbenchState, WorkspaceBackupResult, WorkspaceImportResult } from "../shared/workbenchTypes";

type NewProjectSapVersion = ProjectSummary["sapVersion"];

const caseActions: { id: CaseActionId; label: string; description: string; taskMode: TaskMode; outputPath: string }[] = [
  { id: "read-source", label: "梳理资料", description: "梳理当前对话、工作文件夹和可用只读证据，列出已知信息与缺口。", taskMode: "problem-analysis", outputPath: "evidence/资料梳理与缺口清单.md" },
  { id: "capture-note", label: "沉淀笔记", description: "把当前讨论沉淀成后续可复习的案件笔记和待办。", taskMode: "problem-analysis", outputPath: "outputs/案件沉淀笔记.md" },
  { id: "development-spec", label: "生成开发说明书", description: "按项目规范生成开发说明、影响范围和上线前核对内容。", taskMode: "document-generation", outputPath: "outputs/开发说明书.md" },
  { id: "draw-flow", label: "画流程图", description: "从当前案件上下文提取业务流程和技术逻辑，优先生成 Mermaid。", taskMode: "flow-diagram", outputPath: "outputs/逻辑说明图.mmd" },
  { id: "candidate-knowledge", label: "整理候选知识", description: "整理可复用经验，但必须等待人工确认后才能进入正式知识库。", taskMode: "problem-analysis", outputPath: "knowledge_candidates/问题处理经验候选.md" },
  { id: "export-handoff", label: "整理交付物", description: "整理当前案件的交付说明、文件清单和飞书本地草稿准备内容。", taskMode: "document-generation", outputPath: "outputs/交付物清单与交接说明.md" }
];

const permissionModes: { id: ActionPermissionMode; label: string; summary: string }[] = [
  { id: "request_approval", label: "每步确认", summary: "记录偏好：每个成果动作都先确认；系统安全边界始终生效。" },
  { id: "approve_for_me", label: "低风险自动", summary: "记录偏好：本地低风险步骤尽量连续处理；风险操作仍需确认。" },
  { id: "full_access", label: "尽量自动", summary: "记录偏好：在当前案件内尽量自动推进；不绕过 SAP 只读与安全确认。" }
];

const sapEvidenceTypes: { id: SapObjectEvidenceType; label: string }[] = [
  { id: "program", label: "程序" },
  { id: "class", label: "类" },
  { id: "function", label: "函数" },
  { id: "include", label: "Include" },
  { id: "table", label: "表" },
  { id: "structure", label: "结构" }
];

const workComposerPlaceholder = "描述问题、补充资料或继续讨论；需要沉淀成果时，打开“成果动作”。";

function verificationModeLabel(mode: "fake" | "cli" | "http" | "adt" | null | undefined): string {
  if (mode === "fake") return "模拟验证";
  if (mode === "cli") return "真实 CLI 验证";
  if (mode === "http") return "真实 HTTP 验证";
  if (mode === "adt") return "ADT 只读验证";
  return "未验证";
}

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "green" | "orange" | "blue" }) {
  return <span className={`status-pill status-${tone}`}>{label}</span>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function searchResultLabel(result: SearchResult): string {
  if (result.id.startsWith("file-summary-")) return "安全摘要";
  return result.type === "project" ? "项目" : result.type === "case" ? "案件" : result.type === "knowledge" ? "知识" : "文件";
}

function fileIcon(node: CaseFileNode) {
  if (node.kind === "directory") return Folder;
  if (node.fileType === "xlsx" || node.fileType === "xls" || node.fileType === "csv" || node.name.includes("核对") || node.name.includes("清单")) return FileSpreadsheet;
  return File;
}

const PHASE25_CASE_FILE_KNOWLEDGE_STATUS_MARKER = "phase25-case-file-knowledge-status-clarity";

function caseFilePurposeLabel(node: CaseFileNode): string {
  if (node.purpose === "output") return "交付物";
  if (node.purpose === "candidate_knowledge") return "待确认知识";
  if (node.purpose === "technical" || node.purpose === "evidence" || node.purpose === "snapshot") return "技术证据/过程材料";
  if (node.purpose === "summary" || node.purpose === "conversation") return "案件记录";
  return node.kind === "directory" ? "文件夹" : "文件";
}

function caseFilePurposeTone(node: CaseFileNode): "blue" | "orange" | "green" | "neutral" {
  if (node.purpose === "candidate_knowledge") return "orange";
  if (node.purpose === "output") return "green";
  if (node.purpose === "technical" || node.purpose === "evidence" || node.purpose === "snapshot") return "blue";
  return "neutral";
}

function fileAnchorId(relativePath: string): string {
  return `file-${encodeURIComponent(relativePath)}`;
}

function filePreviewSubtitle(filePreview: CaseFilePreview | null, selectedPreviewNode: CaseFileNode | null): string {
  if (selectedPreviewNode) return `当前工作文件夹文件 · ${caseFilePurposeLabel(selectedPreviewNode)}`;
  if (filePreview) return "当前工作文件夹文件 · 安全文本预览";
  return "点击上方文件查看安全文本预览";
}

function isPreviewableFile(node: CaseFileNode): boolean {
  return node.kind === "file" && ["md", "txt", "csv", "mmd"].includes(node.fileType.toLowerCase());
}

function flattenFiles(nodes: CaseFileNode[]): CaseFileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenFiles(node.children) : [])]);
}

function filterFileNodes(nodes: CaseFileNode[], query: string): CaseFileNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes.flatMap((node) => {
    const children = node.children ? filterFileNodes(node.children, query) : [];
    const matched = [node.name, node.displayName, caseFilePurposeLabel(node), node.purpose]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
    if (!matched && children.length === 0) return [];
    return [{ ...node, children }];
  });
}

function activeProject(state: WorkbenchState | null): ProjectSummary | undefined {
  return state?.projects.find((project) => project.id === state.activeProjectId);
}

function activeCase(state: WorkbenchState | null) {
  return activeProject(state)?.cases.find((caseItem) => caseItem.id === state?.activeCaseId);
}

function activeChatThread(state: WorkbenchState | null): DailyChatThread | undefined {
  return state?.chatThreads.find((thread) => thread.id === state.activeChatThreadId) ?? state?.chatThreads[0];
}

function isSapBoundProject(project: ProjectSummary | undefined): boolean {
  return project?.sapVersion === "S4" || project?.sapVersion === "ECC";
}

function isLegacyDemoProject(project: ProjectSummary): boolean {
  return project.id === "demo-s4hana";
}

function projectKindLabel(project: ProjectSummary): string {
  if (project.sapVersion === "S4") return "S4HANA";
  if (project.sapVersion === "ECC") return "ECC";
  return "其他工作";
}

function sapSidebarStatus(project: ProjectSummary): { label: string; tone: "green" | "orange" | "blue" } {
  const adt = project.config.adt;
  if (adt.connectionStatus === "verified" && adt.minimalReadStatus === "verified" && adt.lastVerificationMode === "adt") {
    return { label: "SAP 已验证", tone: "green" };
  }
  if (adt.connectionStatus === "failed" || adt.minimalReadStatus === "failed" || adt.configStatus === "failed") {
    return { label: "SAP 需检查", tone: "orange" };
  }
  return { label: "SAP 未验证", tone: "blue" };
}

function threadTimestamp(thread: DailyChatThread): string {
  return thread.lastOpenedAt || thread.updatedAt || thread.createdAt;
}

function sidebarDateGroup(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更早";
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysAgo = Math.floor((today - day) / 86400000);
  if (daysAgo <= 0) return "今天";
  if (daysAgo === 1) return "昨天";
  if (daysAgo <= 7) return "近 7 天";
  return "更早";
}

function groupDailyChatThreads(threads: DailyChatThread[]): { label: string; threads: DailyChatThread[] }[] {
  const sortedThreads = [...threads].sort((a, b) => new Date(threadTimestamp(b)).getTime() - new Date(threadTimestamp(a)).getTime());
  const groups = new Map<string, DailyChatThread[]>();
  for (const thread of sortedThreads) {
    const group = sidebarDateGroup(threadTimestamp(thread));
    groups.set(group, [...(groups.get(group) ?? []), thread]);
  }
  return ["今天", "昨天", "近 7 天", "更早"]
    .map((label) => ({ label, threads: groups.get(label) ?? [] }))
    .filter((group) => group.threads.length > 0);
}

type ComposerModelOption = {
  key: string;
  provider: ApiProviderConfig;
  model: ModelSummary;
};

const selectableCapabilities: Exclude<ModelCapability, "chat">[] = ["vision", "reasoning", "tools", "web", "free"];

const capabilityLabels: Record<ModelCapability, string> = {
  chat: "文本",
  vision: "视觉",
  reasoning: "推理",
  tools: "工具",
  web: "联网",
  free: "免费"
};

function modelOptionKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function isProviderSafeForDraft(item: ApiProviderConfig): boolean {
  return (
    item.enabled &&
    item.credential.state === "set-in-secure-store" &&
    item.modelSyncStatus === "verified" &&
    item.chatTestStatus === "verified" &&
    item.lastVerificationMode === "http" &&
    item.verifiedModelIds.length > 0 &&
    item.models.length > 0
  );
}

function providerModelStatus(provider: ApiProviderConfig): string | null {
  if (!provider.enabled) return "渠道未启用";
  if (provider.credential.state !== "set-in-secure-store") return "API Key 未保存到安全存储";
  if (provider.lastVerificationMode === "fake") return "仅模拟验证，不能用于正式案件草稿";
  if (provider.lastVerificationMode !== "http") return "尚未通过真实 HTTP 验证";
  if (provider.modelSyncStatus === "failed") return "模型列表获取失败，请到配置中心重新验证";
  if (provider.chatTestStatus === "failed") return "最小对话测试失败，请到配置中心检查";
  if (provider.modelSyncStatus !== "verified") return "模型列表尚未验证";
  if (provider.chatTestStatus !== "verified") return "最小对话尚未验证";
  if (provider.verifiedModelIds.length === 0) return "没有单独测试通过的模型，请到配置中心选择模型并测试";
  if (provider.models.length === 0) return "未获取到可用模型";
  if (provider.verifiedModelIds.some((modelId) => !provider.models.some((model) => model.id === modelId))) return "已验证模型不在当前模型列表，请重新验证";
  return null;
}

function safeDraftModelOptions(project: ProjectSummary | undefined): ComposerModelOption[] {
  return (project?.config.apiProviders ?? []).flatMap((provider) => {
    if (!isProviderSafeForDraft(provider)) return [];
    return provider.verifiedModelIds.flatMap((modelId) => {
      const model = provider.models.find((item) => item.id === modelId);
      return model ? [{ key: modelOptionKey(provider.id, model.id), provider, model }] : [];
    });
  });
}

function providerErrorStates(project: ProjectSummary | undefined): { provider: ApiProviderConfig; reason: string }[] {
  return (project?.config.apiProviders ?? []).flatMap((provider) => {
    const reason = providerModelStatus(provider);
    return reason ? [{ provider, reason }] : [];
  });
}

function FileRows({ nodes, level = 0, selectedPath, onPreview }: { nodes: CaseFileNode[]; level?: number; selectedPath: string | null; onPreview: (node: CaseFileNode) => void }) {
  return (
    <>
      {nodes.map((node) => {
        const Icon = fileIcon(node);
        const isSelected = node.relativePath === selectedPath;
        const previewable = isPreviewableFile(node);
        const rowContent = (
          <>
            <Icon size={18} />
            <span title={caseFilePurposeLabel(node)}>{node.name}</span>
            <em className={`file-purpose file-purpose-${caseFilePurposeTone(node)}`}>
              {node.kind === "directory" ? caseFilePurposeLabel(node) : `${caseFilePurposeLabel(node)} · ${formatSize(node.sizeBytes)}`}
            </em>
          </>
        );
        return (
          <div className="file-node" id={fileAnchorId(node.relativePath)} key={node.relativePath}>
            {previewable ? (
              <button
                type="button"
                className={`file-row file-row-button file-${node.kind}${isSelected ? " selected" : ""}`}
                style={{ paddingLeft: `${level * 16}px` }}
                onClick={() => onPreview(node)}
                title="只读预览当前工作文件夹文本文件"
              >
                {rowContent}
              </button>
            ) : (
              <div className={`file-row file-${node.kind}`} style={{ paddingLeft: `${level * 16}px` }}>
                {rowContent}
              </div>
            )}
            {node.children?.length ? <FileRows nodes={node.children} level={level + 1} selectedPath={selectedPath} onPreview={onPreview} /> : null}
          </div>
        );
      })}
    </>
  );
}

function MessageBubble({ message, files, onPreview }: { message: CaseMessage; files: CaseFileNode[]; onPreview: (node: CaseFileNode) => void }) {
  if (message.role === "user") {
    return (
      <div className="user-message">
        {message.content}
        <time>{formatTime(message.createdAt)}</time>
      </div>
    );
  }

  const linkedFiles = message.linkedFileIds
    .map((fileId) => files.find((file) => file.relativePath === fileId))
    .filter((file): file is CaseFileNode => Boolean(file));

  const isModelDraft = message.modelId !== "local-workflow" && message.modelId !== "demo-model";

  return (
    <article className="assistant-message">
      <div className="run-time">{isModelDraft ? "模型草稿回复" : "本地输出回复"} · {formatTime(message.createdAt)} &gt;</div>
      <p>{message.content}</p>
      {linkedFiles.length > 0 ? (
        <div className="file-chips">
          {linkedFiles.map((node) => {
            const Icon = fileIcon(node);
            return (
              <button type="button" onClick={() => onPreview(node)} key={node.relativePath} title="打开本地只读预览">
                <Icon size={22} />
                {node.name}
                <span>{formatSize(node.sizeBytes)} · 预览</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function DailyChatBubble({ message }: { message: DailyChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="user-message">
        {message.content}
        <time>{formatTime(message.createdAt)}</time>
      </div>
    );
  }

  return (
    <article className="assistant-message daily-chat-message">
      <div className="run-time">
        {message.responseMode === "model-failed" ? "模型调用失败" : message.responseMode === "model-success" ? `${message.providerName ?? "模型渠道"} · ${message.modelId}` : "本地记录"}
        {` · ${formatTime(message.createdAt)} >`}
      </div>
      <p>{message.content}</p>
    </article>
  );
}

function App() {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<CaseFilePreview | null>(null);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [activeView, setActiveView] = useState<"chat" | "case" | "config" | "standards" | "knowledge">("case");
  const [filesPanelVisible, setFilesPanelVisible] = useState(() => window.innerWidth > 1180);
  const [createPanel, setCreatePanel] = useState<"project" | "case" | null>(null);
  const [hiddenProjectsVisible, setHiddenProjectsVisible] = useState(false);
  const [selectedCaseActionId, setSelectedCaseActionId] = useState<CaseActionId>("capture-note");
  const [caseActionConfirmationVisible, setCaseActionConfirmationVisible] = useState(false);
  const [actionPermissionMode, setActionPermissionMode] = useState<ActionPermissionMode>("request_approval");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [codexAssistEnabled, setCodexAssistEnabled] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [modelCapabilityFilters, setModelCapabilityFilters] = useState<ModelCapability[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectSapVersion, setNewProjectSapVersion] = useState<NewProjectSapVersion>("S4");
  const [newProjectSystemLabel, setNewProjectSystemLabel] = useState("Local");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [newCaseProjectId, setNewCaseProjectId] = useState("");
  const [creatingCase, setCreatingCase] = useState(false);
  const [sapEvidenceType, setSapEvidenceType] = useState<SapObjectEvidenceType>("program");
  const [sapEvidenceName, setSapEvidenceName] = useState("");
  const [sapEvidenceFunctionGroup, setSapEvidenceFunctionGroup] = useState("");
  const [sapEvidencePanelOpen, setSapEvidencePanelOpen] = useState(false);
  const [sapEvidenceBusy, setSapEvidenceBusy] = useState(false);
  const [feishuHandoffBusy, setFeishuHandoffBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [knowledgeFocusItemId, setKnowledgeFocusItemId] = useState("");
  const [centerDraftDirty, setCenterDraftDirty] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);
  const newCaseInputRef = useRef<HTMLInputElement>(null);
  const workflowContextRef = useRef("");
  const messageDraftsRef = useRef(new Map<string, string>());

  const bridge = window.workbench;
  const project = activeProject(state);
  const currentCase = activeCase(state);
  const activeChat = activeChatThread(state);
  const visibleProjects = useMemo(() => {
    return (state?.projects ?? [])
      .filter((item) => item.isVisible !== false)
      .sort((a, b) => a.visibleOrder - b.visibleOrder || a.name.localeCompare(b.name, "zh-CN"));
  }, [state]);

  function canLeaveCurrentCenter(): boolean {
    if (!centerDraftDirty || (activeView !== "config" && activeView !== "standards" && activeView !== "knowledge")) return true;
    return window.confirm("当前页面有未保存内容。离开后这些修改会丢失，确定继续吗？");
  }

  function navigateView(nextView: typeof activeView): void {
    if (nextView === activeView) return;
    if (!canLeaveCurrentCenter()) return;
    setCenterDraftDirty(false);
    setActiveView(nextView);
  }
  const hiddenProjects = useMemo(() => (state?.projects ?? []).filter((item) => item.isVisible === false), [state]);
  const legacyDemoProjects = useMemo(() => visibleProjects.filter(isLegacyDemoProject), [visibleProjects]);
  const sapProjects = useMemo(
    () => visibleProjects.filter((item) => isSapBoundProject(item) && !isLegacyDemoProject(item)),
    [visibleProjects]
  );
  const otherWorkProjects = useMemo(
    () => visibleProjects.filter((item) => !isSapBoundProject(item) && !isLegacyDemoProject(item)),
    [visibleProjects]
  );
  const chatGroups = useMemo(() => groupDailyChatThreads(state?.chatThreads ?? []), [state?.chatThreads]);
  const safeDraftOptions = useMemo(() => safeDraftModelOptions(project), [project]);
  const modelProviderErrors = useMemo(() => providerErrorStates(project), [project]);
  const selectedSafeDraftModel = useMemo(() => {
    return safeDraftOptions.find((option) => option.key === selectedModelKey) ?? safeDraftOptions[0] ?? null;
  }, [safeDraftOptions, selectedModelKey]);
  const filteredModelOptions = useMemo(() => {
    const normalized = modelSearchQuery.trim().toLowerCase();
    return safeDraftOptions.filter((option) => {
      const textMatched = !normalized || [
        option.provider.name,
        option.provider.id,
        option.model.id,
        option.model.displayName,
        ...option.model.capabilities.map((capability) => capabilityLabels[capability])
      ].join(" ").toLowerCase().includes(normalized);
      const capabilityMatched = modelCapabilityFilters.every((capability) => option.model.capabilities.includes(capability));
      return textMatched && capabilityMatched;
    });
  }, [safeDraftOptions, modelSearchQuery, modelCapabilityFilters]);
  const groupedModelOptions = useMemo(() => {
    return project?.config.apiProviders.flatMap((provider) => {
      const options = filteredModelOptions.filter((option) => option.provider.id === provider.id);
      return options.length > 0 ? [{ provider, options }] : [];
    }) ?? [];
  }, [project, filteredModelOptions]);
  const adtReady = Boolean(
    project?.config.adt.readOnly &&
    project.config.adt.connectionStatus === "verified" &&
    project.config.adt.minimalReadStatus === "verified" &&
    project.config.adt.lastVerificationMode === "adt"
  );
  const adtEvidenceStatus = project && !isSapBoundProject(project)
    ? "其他工作 · 不读取 SAP"
    : project?.config.adt
    ? adtReady
      ? `${project.config.adt.alias || "SAP"} / Client ${project.config.adt.client || "-"} / readonly / ${verificationModeLabel(project.config.adt.lastVerificationMode)}`
      : `${project.config.adt.alias || "SAP"} · 未完成只读验证`
    : "未选择 SAP 项目";
  const codexAssistAvailable = Boolean(
    project?.config.codex.integrationType === "cli" &&
    project.config.codex.cliStatus === "verified" &&
    project.config.codex.loginStatus === "verified" &&
    project.config.codex.readonlyTaskStatus === "verified"
  );
  const codexAssistTitle = codexAssistAvailable
    ? "开启后，本次发送会让 Codex 生成一份工程辅助分析并保存到当前案件文件"
    : "Codex 还未通过配置中心测试；先到配置中心点击测试 Codex";
  const selectedCaseAction = caseActions.find((item) => item.id === selectedCaseActionId) ?? caseActions[0];
  const currentPermissionMode = permissionModes.find((item) => item.id === actionPermissionMode) ?? permissionModes[0];
  const flatFiles = useMemo(() => flattenFiles(state?.activeCaseFiles ?? []), [state]);
  const filteredCaseFiles = useMemo(() => filterFileNodes(state?.activeCaseFiles ?? [], fileSearchQuery), [state, fileSearchQuery]);
  const filteredFileCount = useMemo(() => flattenFiles(filteredCaseFiles).filter((node) => node.kind === "file").length, [filteredCaseFiles]);
  const fileCount = useMemo(() => flatFiles.filter((node) => node.kind === "file").length, [flatFiles]);
  const outputFileCount = useMemo(() => flatFiles.filter((node) => node.kind === "file" && node.relativePath.startsWith("outputs/")).length, [flatFiles]);
  const selectedPreviewNode = useMemo(() => selectedPreviewPath ? flatFiles.find((node) => node.relativePath === selectedPreviewPath) ?? null : null, [flatFiles, selectedPreviewPath]);

  useEffect(() => {
    if (!selectedModelKey || safeDraftOptions.some((option) => option.key === selectedModelKey)) return;
    setSelectedModelKey(safeDraftOptions[0]?.key ?? "");
  }, [safeDraftOptions, selectedModelKey]);

  useEffect(() => {
    if (!codexAssistAvailable && codexAssistEnabled) {
      setCodexAssistEnabled(false);
    }
  }, [codexAssistAvailable, codexAssistEnabled]);

  useEffect(() => {
    const lastPermission = [...(currentCase?.messages ?? [])]
      .reverse()
      .find((item) => item.permissionModeUsed)?.permissionModeUsed;
    setActionPermissionMode(lastPermission ?? "request_approval");
  }, [currentCase?.id]);

  useEffect(() => {
    const contextKey = activeView === "chat"
      ? `chat:${activeChat?.id ?? ""}`
      : `case:${project?.id ?? ""}:${currentCase?.id ?? ""}`;
    if (workflowContextRef.current && workflowContextRef.current !== contextKey) {
      messageDraftsRef.current.set(workflowContextRef.current, message);
      setMessage(messageDraftsRef.current.get(contextKey) ?? "");
      setCaseActionConfirmationVisible(false);
      setSapEvidencePanelOpen(false);
      setSapEvidenceName("");
      setSapEvidenceFunctionGroup("");
      setCodexAssistEnabled(false);
      setModelPickerOpen(false);
    }
    workflowContextRef.current = contextKey;
  }, [activeView, activeChat?.id, project?.id, currentCase?.id]);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!message.trim()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [message]);

  useEffect(() => {
    if (visibleProjects.length === 0) {
      if (newCaseProjectId) setNewCaseProjectId("");
      return;
    }
    if (newCaseProjectId && visibleProjects.some((item) => item.id === newCaseProjectId)) return;
    const activeVisibleProjectId = project?.id && visibleProjects.some((item) => item.id === project.id) ? project.id : "";
    setNewCaseProjectId(activeVisibleProjectId || visibleProjects[0].id);
  }, [newCaseProjectId, project?.id, visibleProjects]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelPickerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modelPickerOpen]);

  useEffect(() => {
    const collapseContextPanel = () => {
      if (window.innerWidth <= 1180) setFilesPanelVisible(false);
    };
    window.addEventListener("resize", collapseContextPanel);
    return () => window.removeEventListener("resize", collapseContextPanel);
  }, []);

  async function applyCaseWorkflowResponse<T extends WorkbenchState>(
    responsePromise: Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    target: { projectId: string; caseId: string; caseTitle: string }
  ): Promise<"active" | "background" | null> {
    const response = await responsePromise;
    if (response.ok) {
      setState(response.data);
      const targetStillActive = response.data.activeProjectId === target.projectId && response.data.activeCaseId === target.caseId;
      if (targetStillActive) {
        setNotice("当前工作文件夹及本地输出文件已更新。");
        return "active";
      }
      setNotice(`请求已完成，结果只写入发送时的工作文件夹「${target.caseTitle}」。`);
      return "background";
    } else {
      setNotice(response.error);
      return null;
    }
  }

  useEffect(() => {
    if (!bridge) {
      setNotice("浏览器预览仅显示界面；请用桌面应用启动本地文件闭环。");
      return;
    }

    bridge.getState().then((response) => {
      if (response.ok) {
        setState(response.data);
        if (response.data.startupNotice) setNotice(response.data.startupNotice);
      }
      else setNotice(response.error);
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      bridge.search(searchQuery).then((response) => {
        if (response.ok) setSearchResults(response.data);
        else setNotice(response.error);
      });
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [bridge, searchQuery]);

  async function createProject() {
    if (!bridge) {
      setNotice("请在桌面应用中创建本地项目。");
      return;
    }
    const name = newProjectName.trim();
    const systemLabel = newProjectSystemLabel.trim();
    if (!name || !systemLabel) {
      setNotice("请输入项目名称和系统/本地标签。");
      return;
    }
    const response = await bridge.createLocalProject({ name, sapVersion: newProjectSapVersion, systemLabel });
    if (response.ok) {
      setState(response.data);
      setActiveView("case");
      setNewCaseProjectId(response.data.activeProjectId);
      setNewProjectName("");
      setNewProjectSystemLabel("Local");
      setCreatePanel(null);
      setNotice(newProjectSapVersion === "UNKNOWN"
        ? "其他工作项目已创建，可在它下面新建本地工作文件夹；这里不会读取 SAP。"
        : "SAP 项目已创建，可在它下面新建工作文件夹，并独立配置连接、规范和知识。");
    } else {
      setNotice(response.error);
    }
  }

  async function createCase() {
    if (creatingCase) return;
    if (!bridge) {
      setNotice("请在桌面应用中创建本地案件。");
      return;
    }
    if (visibleProjects.length === 0) {
      setNotice("请先创建或选择一个本地项目，再新建案件。");
      return;
    }
    const targetProject = visibleProjects.find((item) => item.id === newCaseProjectId);
    if (!targetProject) {
      setNotice("请先为新工作文件夹选择一个 SAP 项目或其他工作项目。");
      return;
    }
    const title = newCaseTitle.trim();
    if (!title) {
      setNotice("请输入工作文件夹名称。");
      newCaseInputRef.current?.focus();
      return;
    }
    setCreatingCase(true);
    try {
      const response = await bridge.createLocalCase({ projectId: targetProject.id, title });
      if (response.ok) {
        setState(response.data);
        setActiveView("case");
        setNewCaseProjectId(targetProject.id);
        setNewCaseTitle("");
        setCreatePanel(null);
        setNotice("新工作文件夹已创建，并已切换到当前工作。右侧文件页签会显示它的本地文件。");
      } else {
        setNotice(response.error);
      }
    } finally {
      setCreatingCase(false);
    }
  }

  async function createDailyChat() {
    if (!bridge) {
      setNotice("请在桌面应用中创建日常对话。");
      return;
    }
    const response = await bridge.createDailyChatThread({});
    if (response.ok) {
      setState(response.data);
      setActiveView("chat");
      setMessage("");
      setSelectedPreviewPath(null);
      setFilePreview(null);
      setFilePreviewError(null);
      setNotice("新对话已创建。它不关联项目、案件或文件夹。");
    } else {
      setNotice(response.error);
    }
  }

  async function switchDailyChat(threadId: string) {
    if (!bridge) {
      setNotice("请在桌面应用中切换日常对话。");
      return;
    }
    const response = await bridge.switchDailyChatThread({ threadId });
    if (response.ok) {
      setState(response.data);
      setActiveView("chat");
      setSelectedPreviewPath(null);
      setFilePreview(null);
      setFilePreviewError(null);
      setNotice("已切换到独立日常对话；这里不读取案件文件夹。");
    } else {
      setNotice(response.error);
    }
  }

  async function openSearchResult(result: SearchResult) {
    if (!bridge) {
      setNotice("请在桌面应用中打开本地搜索结果。");
      return;
    }
    const targetProjectId = result.projectId
      ?? state?.projects.find((item) => item.cases.some((caseItem) => caseItem.id === result.caseId))?.id;
    if (!targetProjectId) {
      setNotice("搜索结果没有可打开的项目位置。");
      return;
    }

    const hiddenTarget = state?.projects.find((item) => item.id === targetProjectId && item.isVisible === false);
    if (hiddenTarget) {
      const restoreResponse = await bridge.restoreProjectToSidebar({ projectId: targetProjectId });
      if (!restoreResponse.ok) {
        setNotice(restoreResponse.error);
        return;
      }
      setState(restoreResponse.data);
    }

    const response = result.caseId
      ? await bridge.switchCase({ projectId: targetProjectId, caseId: result.caseId })
      : await bridge.switchProject({ projectId: targetProjectId });
    if (!response.ok) {
      setNotice(response.error);
      return;
    }

    setState(response.data);
    setSelectedPreviewPath(null);
    setFilePreview(null);
    setFilePreviewError(null);
    if (result.type === "knowledge") {
      const prefix = `knowledge-${targetProjectId}-`;
      setKnowledgeFocusItemId(result.id.startsWith(prefix) ? result.id.slice(prefix.length) : "");
      setActiveView("knowledge");
      setNotice(`已打开 ${result.title} 所属项目的知识库。`);
      return;
    }

    setActiveView("case");
    if (result.type === "file") {
      setFilesPanelVisible(true);
      const matchedFile = flattenFiles(response.data.activeCaseFiles).find((node) => (
        node.kind === "file" && Boolean(result.sourcePath) && node.relativePath === result.sourcePath
      ));
      if (matchedFile) {
        setSearchQuery("");
        setSearchResults([]);
        await previewCaseFile(matchedFile);
        setNotice(`已打开文件：${result.title}`);
        return;
      }
      setNotice(`已打开“${result.title}”所属案件；当前文件路径已发生变化，请重新搜索。`);
      return;
    }
    setNotice(result.type === "project" ? `已切换到项目：${result.title}` : `已打开：${result.title}`);
  }

  function focusNewCaseInput() {
    setActiveView("case");
    setCreatePanel("case");
    if (!project) {
      setNotice("请先创建或选择一个 SAP 项目或其他工作项目，再新建工作文件夹。");
      return;
    }
    window.setTimeout(() => newCaseInputRef.current?.focus(), 0);
  }

  async function switchProject(projectId: string, nextView: "case" | "config" = "case") {
    if (!canLeaveCurrentCenter()) return;
    if (!bridge) {
      setNotice("请在桌面应用中切换项目。");
      return;
    }
    const response = await bridge.switchProject({ projectId });
    if (response.ok) {
      setState(response.data);
      setNewCaseProjectId(projectId);
      setActiveView(nextView);
      setSelectedPreviewPath(null);
      setFilePreview(null);
      setFilePreviewError(null);
      setNotice(nextView === "config" ? "已切换项目，配置中心现在指向该项目。" : "已切换项目，当前工作和右侧文件面板现在指向该项目。");
    } else {
      setNotice(response.error);
    }
  }

  async function hideProjectFromSidebar(projectId: string) {
    if (!bridge) {
      setNotice("请在桌面应用中隐藏项目。");
      return;
    }
    const response = await bridge.hideProjectFromSidebar({ projectId });
    if (response.ok) {
      setState(response.data);
      setActiveView("case");
      setSelectedPreviewPath(null);
      setFilePreview(null);
      setFilePreviewError(null);
      setNotice("项目仅从侧边栏隐藏；工作文件夹、文件、配置、规范和知识仍保存在本机。");
    } else {
      setNotice(response.error);
    }
  }

  async function restoreProjectToSidebar(projectId: string) {
    if (!bridge) {
      setNotice("请在桌面应用中恢复项目。");
      return;
    }
    const response = await bridge.restoreProjectToSidebar({ projectId });
    if (response.ok) {
      setState(response.data);
      setNotice("项目已恢复到侧边栏。");
      if (response.data.projects.every((item) => item.isVisible !== false)) setHiddenProjectsVisible(false);
    } else {
      setNotice(response.error);
    }
  }

  async function switchCase(projectId: string, caseId: string) {
    if (!canLeaveCurrentCenter()) return;
    if (!bridge) {
      setNotice("请在桌面应用中切换工作文件夹。");
      return;
    }
    const response = await bridge.switchCase({ projectId, caseId });
    if (response.ok) {
      setState(response.data);
      setActiveView("case");
      setSelectedPreviewPath(null);
      setFilePreview(null);
      setFilePreviewError(null);
      setNotice("工作文件夹已切换，右侧文件页签正在读取该文件夹。");
    } else {
      setNotice(response.error);
    }
  }

  function toggleModelCapabilityFilter(capability: Exclude<ModelCapability, "chat">) {
    setModelCapabilityFilters((filters) => (
      filters.includes(capability)
        ? filters.filter((item) => item !== capability)
        : [...filters, capability]
    ));
  }

  async function sendMessage() {
    if (sendingMessage) return;
    if (!bridge) {
      setNotice("浏览器预览不会写入本地文件；请用桌面应用发送。");
      return;
    }
    if (!message.trim()) {
      setNotice(activeView === "chat" ? "请输入日常对话内容。" : "请输入案件问题或补充说明。");
      return;
    }
    setSendingMessage(true);
    try {
      if (activeView === "chat") {
        const response = await bridge.appendDailyChatMessage({
          threadId: activeChat?.id,
          content: message,
          projectId: selectedSafeDraftModel ? project?.id : undefined,
          providerId: selectedSafeDraftModel?.provider.id,
          modelId: selectedSafeDraftModel?.model.id ?? "local-chat"
        });
        if (response.ok) {
          setState(response.data);
          setMessage("");
          const thread = response.data.chatThreads.find((item) => item.id === response.data.activeChatThreadId);
          const reply = thread?.messages[thread.messages.length - 1];
          setNotice(reply?.responseMode === "model-success"
            ? `模型回复已保存为独立对话；渠道来自 ${reply.providerName ?? "当前 Project"}，内容未写入案件。`
            : reply?.responseMode === "model-failed"
              ? "模型调用失败；问题和失败原因已保存为本地日常对话记录。"
              : "日常对话已保存为本地记录；未写入 Project 或案件文件。");
        } else {
          setNotice(response.error);
        }
        return;
      }
      if (!project || !currentCase) {
        setNotice("请先选择一个 Project 和工作文件夹。");
        return;
      }
      const target = { projectId: project.id, caseId: currentCase.id, caseTitle: currentCase.title };
      const sent = await applyCaseWorkflowResponse(bridge.appendMessage({
        projectId: target.projectId,
        caseId: target.caseId,
        content: message,
        taskMode: "problem-analysis",
        modelId: selectedSafeDraftModel?.model.id ?? "local-workflow",
        actionId: null,
        permissionMode: actionPermissionMode,
        providerId: selectedSafeDraftModel?.provider.id,
        codexAssistEnabled: codexAssistEnabled && codexAssistAvailable
      }), target);
      if (!sent) return;
      if (sent === "active") setMessage("");
      if (sent === "active" && codexAssistEnabled && codexAssistAvailable) {
        setNotice("当前案件已更新，Codex 工程辅助分析会出现在右侧 outputs 文件里。");
      }
    } finally {
      setSendingMessage(false);
    }
  }

  async function runCaseAction() {
    if (sendingMessage) return;
    if (!bridge) {
      setNotice("浏览器预览不会执行案件动作；请用桌面应用操作。");
      return;
    }
    if (!project || !currentCase) {
      setNotice("请先选择一个 Project 和工作文件夹。");
      return;
    }
    const target = { projectId: project.id, caseId: currentCase.id, caseTitle: currentCase.title };
    setSendingMessage(true);
    try {
      const content = [
        `案件动作：${selectedCaseAction.label}`,
        `动作说明：${selectedCaseAction.description}`,
        `上下文范围：本次补充、案件安全摘要、已引用正式知识、相关规范摘要和 outputs 文件安全摘要。`,
        `保存位置：${selectedCaseAction.outputPath}`,
        `当前权限：${currentPermissionMode.label}。${currentPermissionMode.summary}`,
        message.trim() ? `用户补充：${message.trim()}` : "用户补充：无，请基于当前案件上下文沉淀结果。"
      ].join("\n");
      const sent = await applyCaseWorkflowResponse(bridge.appendMessage({
        projectId: target.projectId,
        caseId: target.caseId,
        content,
        taskMode: selectedCaseAction.taskMode,
        modelId: selectedSafeDraftModel?.model.id ?? "local-workflow",
        actionId: selectedCaseAction.id,
        permissionMode: actionPermissionMode,
        providerId: selectedSafeDraftModel?.provider.id,
        codexAssistEnabled: codexAssistEnabled && codexAssistAvailable
      }), target);
      if (!sent) return;
      if (sent === "active") {
        setMessage("");
        setCaseActionConfirmationVisible(false);
        setNotice(`已执行「${selectedCaseAction.label}」，结果已保存到当前工作文件夹。`);
      }
    } finally {
      setSendingMessage(false);
    }
  }

  async function readSapEvidence() {
    if (!bridge) {
      setNotice("请使用桌面应用补充 SAP 只读证据。");
      return;
    }
    const objectName = sapEvidenceName.trim();
    if (!isSapBoundProject(project)) {
      setNotice("其他工作或未绑定 SAP 的项目不提供 SAP 只读取证；请先切换到具体 SAP 项目。");
      return;
    }
    if (!objectName) {
      setNotice("请先填写一个 SAP 对象名，再补充只读证据。");
      return;
    }
    setSapEvidenceBusy(true);
    try {
      const functionGroup = sapEvidenceType === "function" ? sapEvidenceFunctionGroup.trim() : "";
      if (sapEvidenceType === "function" && !functionGroup) {
        setNotice("读取 Function 证据需要填写 Function Group，例如 ZFG_MM001。");
        return;
      }
      const response = await bridge.readSapObjectEvidence({
        objectType: sapEvidenceType,
        objectName,
        ...(functionGroup ? { functionGroup } : {})
      });
      if (response.ok) {
        setState(response.data.state);
        setSapEvidenceName("");
        setSapEvidenceFunctionGroup("");
        setNotice(`已补充 SAP 只读证据：${response.data.summary.objectType} ${response.data.summary.objectName}；新文件可在右侧案件文件面板查看。`);
      } else {
        setNotice(response.error);
      }
    } finally {
      setSapEvidenceBusy(false);
    }
  }

  async function prepareFeishuHandoff() {
    if (!bridge) {
      setNotice("请使用桌面应用准备 Feishu/Lark 本地交接草稿。");
      return;
    }
    setFeishuHandoffBusy(true);
    try {
      const response = await bridge.prepareFeishuHandoff();
      if (response.ok) {
        setState(response.data.state);
        setNotice(`飞书本地草稿已生成，云端创建仍关闭；本次生成 ${response.data.generatedFiles.length} 个本地草稿文件，可在右侧案件文件面板查看。`);
      } else {
        setNotice(response.error);
      }
    } finally {
      setFeishuHandoffBusy(false);
    }
  }

  async function previewCaseFile(node: CaseFileNode) {
    if (node.kind !== "file") return;
    document.getElementById(fileAnchorId(node.relativePath))?.scrollIntoView({ block: "center" });
    setSelectedPreviewPath(node.relativePath);
    setFilePreview(null);
    setFilePreviewError(null);

    if (!bridge) {
      const error = "请在桌面应用中预览当前案件文件。";
      setFilePreviewError(error);
      setNotice(error);
      return;
    }

    const response = await bridge.previewCurrentCaseFile({ relativePath: node.relativePath });
    if (response.ok) {
      setFilePreview(response.data);
      setNotice("已读取当前案件文件的本地只读预览。");
    } else {
      setFilePreviewError(response.error);
      setNotice(response.error);
    }
  }

  async function createWorkspaceBackup(): Promise<WorkspaceBackupResult | null> {
    if (!bridge) return null;
    const response = await bridge.createWorkspaceBackup();
    if (!response.ok) {
      setNotice(response.error);
      return null;
    }
    return response.data;
  }

  async function importExistingWorkspace(): Promise<WorkspaceImportResult | null> {
    if (!bridge) return null;
    const response = await bridge.importWorkspace();
    if (!response.ok) {
      setNotice(response.error);
      return null;
    }
    return response.data;
  }

  async function saveProjectConfig(projectId: string, config: ProjectSummary["config"]): Promise<boolean> {
    if (!bridge) {
      setNotice("请在桌面应用中保存项目配置。");
      return false;
    }
    const response = await bridge.saveProjectConfig(projectId, config);
    if (response.ok) {
      setState(response.data);
      setNotice("配置已保存；未改动的连接状态会继续保留，改动过的连接需要重新测试。");
      return true;
    } else {
      setNotice(response.error);
      return false;
    }
  }

  async function saveProjectSecret(projectId: string, input: ProjectSecretInput): Promise<boolean> {
    if (!bridge) {
      setNotice("请在桌面应用中保存密钥。");
      return false;
    }
    const response = await bridge.saveProjectSecret(projectId, input);
    if (response.ok) {
      setState(response.data);
      const targetLabel = input.target.kind === "adt-password" ? "SAP 密码" : input.target.kind === "api-key" ? "API Key" : input.target.kind === "feishu-token" ? "飞书 App Secret" : "密钥";
      setNotice(`${targetLabel}已保存到系统安全存储；输入框已清空，已保存值不会回显到页面。`);
      return true;
    }
    setNotice(response.error);
    return false;
  }

  async function verifyAdtReadonly(projectId: string): Promise<AdtVerificationReport | null> {
    if (!bridge) {
      setNotice("请在桌面应用中执行 ADT 只读验证。");
      return null;
    }
    const response = await bridge.verifyAdtReadonly(projectId);
    if (response.ok) {
      setState(response.data.state);
      const firstError = response.data.report.errors[0];
      setNotice(response.data.report.ok
        ? response.data.report.mode === "fake"
          ? "ADT 模拟验证通过：只证明本地验证流程可跑通，不代表真实 SAP 已连通。"
          : "ADT 真实只读验证通过：T000 最小读取已完成。"
        : `ADT 只读验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
      return response.data.report;
    }
    setNotice(response.error);
    return null;
  }

  async function verifyFeishuCli(projectId: string): Promise<FeishuVerificationReport | null> {
    if (!bridge) {
      setNotice("请在桌面应用中验证飞书 CLI。");
      return null;
    }
    const response = await bridge.verifyFeishuCli(projectId);
    if (response.ok) {
      setState(response.data.state);
      const firstError = response.data.report.errors[0];
      const authAction = response.data.report.authAction;
      setNotice(response.data.report.ok
        ? `${verificationModeLabel(response.data.report.mode)}通过：仅代表 CLI、登录和权限状态可用，尚未创建或发布文档。`
        : authAction?.status === "opened"
          ? "已打开飞书授权页。请在浏览器中确认授权；完成后回到这里再次点击测试连接。"
          : `飞书 CLI 验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
      return response.data.report;
    }
    setNotice(response.error);
    return null;
  }

  async function discoverFeishuCli(): Promise<FeishuCliDiscoveryReport | null> {
    if (!bridge) {
      setNotice("请在桌面应用中识别飞书 CLI。");
      return null;
    }
    const response = await bridge.discoverFeishuCli();
    if (response.ok) {
      setNotice(response.data.installed ? "已识别飞书 CLI 和本机 profile。" : "未检测到飞书 CLI，可点击自动安装。");
      return response.data;
    }
    setNotice(response.error);
    return null;
  }

  async function installFeishuCli(): Promise<FeishuCliInstallResult | null> {
    if (!bridge) {
      setNotice("请在桌面应用中安装飞书 CLI。");
      return null;
    }
    const response = await bridge.installFeishuCli();
    if (response.ok) {
      setNotice(response.data.ok ? "飞书 CLI 已安装并识别完成。" : `飞书 CLI 自动安装未完成：${response.data.errors[0]?.message ?? response.data.message}`);
      return response.data;
    }
    setNotice(response.error);
    return null;
  }

  async function saveFeishuCliProfile(projectId: string): Promise<FeishuCliProfileSetupResult | null> {
    if (!bridge) {
      setNotice("请在桌面应用中写入飞书 CLI profile。");
      return null;
    }
    const response = await bridge.saveFeishuCliProfile(projectId);
    if (response.ok) {
      setNotice(response.data.ok ? "飞书 CLI profile 已写入；请继续测试连接。" : `飞书 CLI profile 未写入：${response.data.errors[0]?.message ?? response.data.message}`);
      return response.data;
    }
    setNotice(response.error);
    return null;
  }

  async function openFeishuDeveloperConsole(): Promise<boolean> {
    if (!bridge) {
      setNotice("请在桌面应用中打开飞书开发者后台。");
      return false;
    }
    const response = await bridge.openFeishuDeveloperConsole();
    if (response.ok) {
      setNotice("已打开飞书开发者后台，请创建或查看企业自建应用后复制 App ID/App Secret。");
      return true;
    }
    setNotice(response.error);
    return false;
  }

  async function verifyModelProvider(projectId: string, providerId: string): Promise<ModelProviderVerificationReport | null> {
    if (!bridge) {
      setNotice("请在桌面应用中验证模型渠道。");
      return null;
    }
    const response = await bridge.verifyModelProvider(projectId, providerId);
    if (response.ok) {
      setState(response.data.state);
      const firstError = response.data.report.errors[0];
      setNotice(response.data.report.ok
        ? response.data.report.mode === "fake"
          ? "模型渠道模拟验证通过：只证明本地模型验证流程可跑通，不能用于案件模型草稿。"
          : "模型渠道真实验证通过：可用于案件安全草稿；仍不读取 SAP、不发布飞书。"
        : `模型渠道验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
      return response.data.report;
    }
    setNotice(response.error);
    return null;
  }

  async function verifyCodexCli(projectId: string): Promise<CodexVerificationReport | null> {
    if (!bridge) {
      setNotice("请在桌面应用中验证 Codex 能力。");
      return null;
    }
    const response = await bridge.verifyCodexCli(projectId);
    if (response.ok) {
      setState(response.data.state);
      const firstError = response.data.report.errors[0];
      setNotice(response.data.report.ok
        ? "Codex CLI 真实验证通过：本机工程执行器可用；本次只做临时只读试跑，不读取历史聊天。"
        : `Codex CLI 验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
      return response.data.report;
    }
    setNotice(response.error);
    return null;
  }

  async function scanLocalAiCapabilities(silent = false): Promise<LocalAiScanResult | null> {
    if (!bridge) {
      if (!silent) setNotice("请在桌面应用中扫描本机 AI 增强能力。");
      return null;
    }
    const response = await bridge.scanLocalAiCapabilities();
    if (response.ok) {
      if (!silent) setNotice(response.data.message);
      return response.data;
    }
    if (!silent) setNotice(response.error);
    return null;
  }

  async function installLocalAiCapability(): Promise<LocalAiInstallResult | null> {
    if (!bridge) {
      setNotice("请在桌面应用中安装本机 AI 增强能力。");
      return null;
    }
    const response = await bridge.installLocalAiCapability({ capabilityId: "codex-cli" });
    if (response.ok) {
      setNotice(response.data.message);
      return response.data;
    }
    setNotice(response.error);
    return null;
  }

  async function copyProjectStandardsTemplate(projectId: string, input: CopyProjectStandardsInput) {
    if (!bridge) {
      setNotice("请在桌面应用中复制规范模板。");
      return;
    }
    const response = await bridge.copyProjectStandardsTemplate(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("模板已复制为当前项目的独立规范副本。");
    } else {
      setNotice(response.error);
    }
  }

  async function copyProjectStandardsFromProject(projectId: string, input: CopyProjectStandardsFromProjectInput) {
    if (!bridge) {
      setNotice("请在桌面应用中复制其他项目规范。");
      return;
    }
    const response = await bridge.copyProjectStandardsFromProject(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("已从其他项目复制规范，当前项目得到新的独立副本。");
    } else {
      setNotice(response.error);
    }
  }

  async function saveProjectStandards(projectId: string, input: SaveProjectStandardsInput) {
    if (!bridge) {
      setNotice("请在桌面应用中保存项目规范。");
      return;
    }
    const response = await bridge.saveProjectStandards(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("当前项目规范已保存；不会影响模板或其他项目。");
    } else {
      setNotice(response.error);
    }
  }

  async function publishKnowledge(projectId: string, input: KnowledgeItemActionInput) {
    if (!bridge) {
      setNotice("请在桌面应用中确认知识入库。");
      return;
    }
    const response = await bridge.publishKnowledge(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("知识已人工确认入库；候选知识不会自动发布。");
    } else {
      setNotice(response.error);
    }
  }

  async function importKnowledgeLocalText(input: KnowledgeImportLocalTextInput): Promise<boolean> {
    if (!bridge) {
      setNotice("请在桌面应用中导入本地知识候选。");
      return false;
    }
    const response = await bridge.importKnowledgeLocalText(input);
    if (response.ok) {
      setState(response.data.state);
      setNotice("知识候选已创建，仍需人工确认后才会正式入库。");
      return true;
    } else {
      setNotice(response.error);
      return false;
    }
  }

  async function importKnowledgeTextFile(projectId: string): Promise<KnowledgeImportTextFileResult | null> {
    if (!bridge) {
      setNotice("请在桌面应用中导入 Markdown/TXT 文件。");
      return null;
    }
    const response = await bridge.importKnowledgeTextFile({ projectId });
    if (!response.ok) {
      setNotice(response.error);
      return null;
    }
    if (response.data.cancelled) {
      setNotice(response.data.message);
      return response.data;
    }
    setState(response.data.state);
    setNotice(`已从 ${response.data.file.sourceName} 生成待确认知识候选；仍需人工审核后才能入库。`);
    return response.data;
  }

  async function reviewKnowledgeForPublish(projectId: string, input: KnowledgeReviewInput) {
    if (!bridge) {
      setNotice("请在桌面应用中记录知识审核。");
      return;
    }
    const response = await bridge.reviewKnowledgeForPublish(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("已记录人工审核；内容未变化且无冲突时才可确认入库。");
    } else {
      setNotice(response.error);
    }
  }

  async function editKnowledgeCandidate(projectId: string, input: KnowledgeEditInput): Promise<boolean> {
    if (!bridge) {
      setNotice("请在桌面应用中编辑知识候选。");
      return false;
    }
    const response = await bridge.editKnowledgeCandidate(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("候选知识已保存为待确认；需要重新审核后才能入库。");
      return true;
    } else {
      setNotice(response.error);
      return false;
    }
  }

  async function attachKnowledgeToCurrentCase(projectId: string, input: KnowledgeCaseReferenceInput) {
    if (!bridge) {
      setNotice("请在桌面应用中把已发布知识加入当前案件上下文。");
      return;
    }
    const response = await bridge.attachKnowledgeToCurrentCase(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("已把这条已发布知识加入当前案件上下文；不会复制知识正文。");
    } else {
      setNotice(response.error);
    }
  }

  async function detachKnowledgeFromCurrentCase(projectId: string, input: KnowledgeCaseReferenceInput) {
    if (!bridge) {
      setNotice("请在桌面应用中解除案件知识引用。");
      return;
    }
    const response = await bridge.detachKnowledgeFromCurrentCase(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("已从当前工作文件夹解除知识引用；正式知识本身仍完整保留。");
    } else {
      setNotice(response.error);
    }
  }

  async function markKnowledgeConflicted(projectId: string, input: KnowledgeItemActionInput) {
    if (!bridge) {
      setNotice("请在桌面应用中标记知识冲突。");
      return;
    }
    const response = await bridge.markKnowledgeConflicted(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("知识已标记为有冲突，不会覆盖已发布知识。");
    } else {
      setNotice(response.error);
    }
  }

  async function expireKnowledge(projectId: string, input: KnowledgeItemActionInput) {
    if (!bridge) {
      setNotice("请在桌面应用中标记知识失效。");
      return;
    }
    const response = await bridge.expireKnowledge(projectId, input);
    if (response.ok) {
      setState(response.data);
      setNotice("知识已标记为失效，历史记录仍保留。");
    } else {
      setNotice(response.error);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-context">
          <span>{activeView === "chat" ? "Chat" : "Work"}</span>
          <strong>{activeView === "chat" ? activeChat?.title ?? "日常对话" : project?.name ?? "未选择项目"}</strong>
          {activeView !== "chat" ? <><span>/</span><em>{activeView === "case" ? currentCase?.title ?? "当前工作文件夹" : activeView === "config" ? "配置中心" : activeView === "standards" ? "规范中心" : "知识库"}</em></> : null}
        </div>
        <div className="topbar-status">
          <ShieldCheck size={15} />
          <span>本地模式</span>
        </div>
      </header>

      <section className={`workspace ${filesPanelVisible && activeView !== "chat" ? "" : "files-collapsed"}`}>
        <aside className="sidebar">
          <div className="workspace-switch" role="tablist" aria-label="主工作模式">
            <button
              type="button"
              className={activeView === "chat" ? "" : "active"}
              onClick={() => navigateView("case")}
              title="正式工作必须绑定工作文件夹"
              role="tab"
              aria-selected={activeView !== "chat"}
            >
              <Folder size={17} />
              Work
            </button>
            <button
              type="button"
              className={activeView === "chat" ? "active" : ""}
              onClick={() => navigateView("chat")}
              title="日常对话不绑定项目或文件夹"
              role="tab"
              aria-selected={activeView === "chat"}
            >
              <MessageSquare size={17} />
              Chat
            </button>
          </div>

          <div className="primary-nav">
            {activeView === "chat" ? (
              <>
                <button className="active" onClick={() => void createDailyChat()} title="创建一个不关联项目、工作文件夹或 SAP 的日常 AI 对话"><MessageSquare size={18} />新对话</button>
              </>
            ) : (
              <>
                <button onClick={focusNewCaseInput} title={project ? "填写名称后在所选项目下创建工作文件夹" : "请先创建或选择一个项目"}><FolderPlus size={18} />新文件夹</button>
                <button className={activeView === "config" ? "active" : ""} onClick={() => navigateView("config")} title="打开当前项目配置中心"><Settings size={18} />配置中心</button>
                <button className={activeView === "standards" ? "active" : ""} onClick={() => navigateView("standards")} title="编辑当前项目的独立规范副本"><BookOpen size={18} />规范中心</button>
                <button className={activeView === "knowledge" ? "active" : ""} onClick={() => navigateView("knowledge")} title="候选知识人工确认后入库"><Archive size={18} />知识库</button>
              </>
            )}
          </div>

          <label className="sidebar-search">
            <Search size={15} />
            <input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索项目或文件" aria-label="搜索工作台" />
          </label>

          {searchResults.length > 0 ? (
            <section className="search-results">
              <strong>搜索结果 · 含本地案件安全输出摘要</strong>
              {searchResults.map((result) => (
                <button type="button" className="search-result search-result-button" onClick={() => void openSearchResult(result)} key={result.id} title={`打开${searchResultLabel(result)}：${result.title}`}>
                  <span>{searchResultLabel(result)}</span>
                  <b>{result.title}</b>
                  <small>{result.location}</small>
                  <p>{result.snippet}</p>
                </button>
              ))}
            </section>
          ) : null}

          {activeView === "chat" ? (
            <section className="conversation-sidebar-section chat-only-section">
              <div className="project-header sidebar-subheader">
                <span>对话</span>
              </div>
              <p className="sidebar-empty-note">Chat 不绑定项目，也没有文件夹选项。</p>
              {chatGroups.length === 0 ? (
                <p className="sidebar-empty-note">暂无对话</p>
              ) : chatGroups.map((group) => (
                <div className="conversation-group" key={group.label}>
                  <span className="conversation-group-label">{group.label}</span>
                  {group.threads.map((thread) => (
                    <button type="button" onClick={() => void switchDailyChat(thread.id)} className={thread.id === state?.activeChatThreadId && activeView === "chat" ? "conversation-row active" : "conversation-row"} key={thread.id} title="打开独立日常对话">
                      <MessageSquare size={15} />
                      <span>{thread.title}</span>
                      <small>独立对话 · 无文件夹</small>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          ) : (
            <>
              <div className="project-header">
                <span>SAP 项目</span>
                <button
                  type="button"
                  className={createPanel === "project" ? "active" : ""}
                  onClick={() => {
                    setCreatePanel((current) => current === "project" ? null : "project");
                    window.setTimeout(() => newProjectInputRef.current?.focus(), 0);
                  }}
                  aria-label="新建 Project"
                  title="创建 SAP 项目或其他工作项目"
                ><Plus size={16} /></button>
                {hiddenProjects.length > 0 ? (
                  <button type="button" className={hiddenProjectsVisible ? "active" : ""} onClick={() => setHiddenProjectsVisible((visible) => !visible)} title="查看并恢复已隐藏项目">
                    <Eye size={15} />{hiddenProjects.length}
                  </button>
                ) : null}
              </div>

              {hiddenProjectsVisible && hiddenProjects.length > 0 ? (
                <div className="hidden-project-list">
                  {hiddenProjects.map((item) => (
                    <div key={item.id}>
                      <span title={`${item.name} · ${item.systemLabel}`}>{item.name}</span>
                      <button type="button" onClick={() => void restoreProjectToSidebar(item.id)}>恢复</button>
                    </div>
                  ))}
                </div>
              ) : null}

              {createPanel === "project" ? <div className="create-dialog-backdrop">
                <form className="quick-create create-dialog" role="dialog" aria-modal="true" aria-label="新建 Project" onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
                <div className="create-dialog-heading"><div><strong>新建 Project</strong><span>Project 隔离客户、SAP 版本、规范和知识</span></div><button type="button" className="icon-button" onClick={() => setCreatePanel(null)} aria-label="关闭"><X size={17} /></button></div>
                <input ref={newProjectInputRef} value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="项目名称，例如 SAP 演示 ECC" aria-label="项目名称" />
                <div className="quick-create-row">
                  <select value={newProjectSapVersion} onChange={(event) => setNewProjectSapVersion(event.target.value as NewProjectSapVersion)} aria-label="项目类型">
                    <option value="S4">S4HANA</option>
                    <option value="ECC">ECC</option>
                    <option value="UNKNOWN">其他工作</option>
                  </select>
                  <input value={newProjectSystemLabel} onChange={(event) => setNewProjectSystemLabel(event.target.value)} placeholder="DEV/100 或 LOCAL" aria-label="系统或本地标签" />
                </div>
                <button type="submit" disabled={!newProjectName.trim() || !newProjectSystemLabel.trim()}><Plus size={15} />创建项目</button>
              </form></div> : null}

              {createPanel === "case" ? <div className="create-dialog-backdrop"><div className="create-case-panel create-dialog" role="dialog" aria-modal="true" aria-label="新建工作文件夹">
              <div className="create-dialog-heading"><div><strong>新建工作文件夹</strong><span>选择归属 Project 后创建本地案件目录</span></div><button type="button" className="icon-button" onClick={() => setCreatePanel(null)} aria-label="关闭"><X size={17} /></button></div>
              <form className="quick-create case-create phase28-new-case-flow phase36-work-chat-project-folder-layout" onSubmit={(event) => { event.preventDefault(); void createCase(); }}>
                <input ref={newCaseInputRef} value={newCaseTitle} onChange={(event) => setNewCaseTitle(event.target.value)} placeholder="输入工作文件夹名称" aria-label="工作文件夹名称" disabled={!project || creatingCase} />
                <button type="submit" disabled={!project || creatingCase || !newCaseTitle.trim()} title={!project ? "请先创建或选择项目" : !newCaseTitle.trim() ? "请输入工作文件夹名称" : "在所选项目下创建工作文件夹"}>
                  <FolderPlus size={15} />
                  {creatingCase ? "创建中" : "创建文件夹"}
                </button>
              </form>

              <div className="new-case-project-picker">
                <span>新工作文件夹归属</span>
                <select value={newCaseProjectId} onChange={(event) => setNewCaseProjectId(event.target.value)} disabled={visibleProjects.length === 0 || creatingCase} aria-label="新工作文件夹项目/配置">
                  {visibleProjects.map((item) => (
                    <option key={item.id} value={item.id}>{projectKindLabel(item)} · {item.name} / {item.systemLabel}</option>
                  ))}
                </select>
              </div>
              </div></div> : null}

              <div className="project-list work-project-list">
                {sapProjects.map((item) => (
                  <section className={`project-card sap-project-card${item.id === state?.activeProjectId ? " active" : ""}`} key={item.id}>
                    <div className="project-card-title">
                      <button type="button" className="project-switch" onClick={() => void switchProject(item.id)} title="切换到这个 SAP 项目">
                        <strong>{item.name}</strong>
                        <div className="project-tags">
                          <StatusPill label={projectKindLabel(item)} tone="blue" />
                          <StatusPill {...sapSidebarStatus(item)} />
                        </div>
                      </button>
                      <div className="project-actions">
                        <button
                          aria-label={`从侧边栏隐藏 ${item.name}`}
                          className="icon-button project-hide-button"
                          disabled={visibleProjects.length <= 1}
                          onClick={() => void hideProjectFromSidebar(item.id)}
                          title="只从侧边栏隐藏，不删除项目文件"
                          type="button"
                        >
                          <EyeOff size={16} />
                        </button>
                      </div>
                    </div>
                    {item.id === state?.activeProjectId ? <div className="case-list">
                      <span className="project-case-label">工作文件夹</span>
                      {item.cases.length ? item.cases.map((caseItem) => (
                        <button type="button" onClick={() => void switchCase(item.id, caseItem.id)} className={activeView === "case" && caseItem.id === state?.activeCaseId && item.id === state?.activeProjectId ? "case-row active" : "case-row"} key={caseItem.id}>
                          <Folder size={14} />
                          <span className="case-row-title">{caseItem.title}</span>
                          <time>{formatTime(caseItem.updatedAt)}</time>
                        </button>
                      )) : <p className="sidebar-empty-note">暂无工作文件夹</p>}
                    </div> : null}
                  </section>
                ))}
              </div>

              {otherWorkProjects.length ? <section className="other-work-section">
                <div className="project-header sidebar-subheader">
                  <span>其他工作</span>
                </div>
                <div className="project-list other-project-list">
                  {otherWorkProjects.map((item) => (
                    <section className={`project-card other-project-card${item.id === state?.activeProjectId ? " active" : ""}`} key={item.id}>
                      <div className="project-card-title">
                        <button type="button" className="project-switch" onClick={() => void switchProject(item.id)} title="切换到这个本地工作项目">
                          <strong>{item.name}</strong>
                          <div className="project-tags">
                            <StatusPill label="其他工作" tone="neutral" />
                            <StatusPill label={item.systemLabel} tone="neutral" />
                          </div>
                        </button>
                      </div>
                      {item.id === state?.activeProjectId ? <div className="case-list">
                        <span className="project-case-label">本地工作文件夹</span>
                        {item.cases.map((caseItem) => (
                          <button type="button" onClick={() => void switchCase(item.id, caseItem.id)} className={activeView === "case" && caseItem.id === state?.activeCaseId && item.id === state?.activeProjectId ? "case-row active" : "case-row"} key={caseItem.id}>
                            <Folder size={14} />
                            <span className="case-row-title">{caseItem.title}</span>
                            <time>{formatTime(caseItem.updatedAt)}</time>
                          </button>
                        ))}
                      </div> : null}
                    </section>
                  ))}
                </div>
              </section> : null}

              {legacyDemoProjects.length ? (
                <section className="legacy-demo-section">
                  <div className="project-header sidebar-subheader">
                    <span>旧示例</span>
                  </div>
                  <p className="sidebar-section-note">历史演示，仅为兼容保留。</p>
                  <div className="project-list legacy-demo-project-list">
                    {legacyDemoProjects.map((item) => (
                      <section className={`project-card legacy-demo-project-card${item.id === state?.activeProjectId ? " active" : ""}`} key={item.id}>
                        <div className="project-card-title">
                          <button type="button" className="project-switch" onClick={() => void switchProject(item.id)} title="打开保留的旧示例项目">
                            <strong>{item.name}</strong>
                            <div className="project-tags">
                              <StatusPill label="旧示例" tone="neutral" />
                              <StatusPill label={item.systemLabel} tone="neutral" />
                            </div>
                          </button>
                        </div>
                        {item.id === state?.activeProjectId ? <div className="case-list">
                          <span className="project-case-label">示例工作文件夹</span>
                          {item.cases.map((caseItem) => (
                            <button type="button" onClick={() => void switchCase(item.id, caseItem.id)} className={activeView === "case" && caseItem.id === state?.activeCaseId && item.id === state?.activeProjectId ? "case-row active" : "case-row"} key={caseItem.id}>
                              <Folder size={14} />
                              <span className="case-row-title">{caseItem.title}</span>
                              <time>{formatTime(caseItem.updatedAt)}</time>
                            </button>
                          ))}
                        </div> : null}
                      </section>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}

        </aside>

        {activeView === "config" ? (
          <ConfigCenter
            project={project}
            notice={notice}
            onBack={() => navigateView("case")}
            onDirtyChange={setCenterDraftDirty}
            onCreateWorkspaceBackup={createWorkspaceBackup}
            onImportWorkspace={importExistingWorkspace}
            onSave={saveProjectConfig}
            onSaveSecret={saveProjectSecret}
            onVerifyAdt={verifyAdtReadonly}
            onVerifyFeishu={verifyFeishuCli}
            onDiscoverFeishu={discoverFeishuCli}
            onInstallFeishu={installFeishuCli}
            onSetupFeishuProfile={saveFeishuCliProfile}
            onOpenFeishuDeveloperConsole={openFeishuDeveloperConsole}
            onVerifyModelProvider={verifyModelProvider}
            onVerifyCodex={verifyCodexCli}
            onScanLocalAi={scanLocalAiCapabilities}
            onInstallLocalAi={installLocalAiCapability}
          />
        ) : activeView === "standards" ? (
          <StandardsCenter
            project={project}
            projects={state?.projects ?? []}
            notice={notice}
            onBack={() => navigateView("case")}
            onDirtyChange={setCenterDraftDirty}
            onCopyTemplate={(projectId, templateId) => copyProjectStandardsTemplate(projectId, { templateId })}
            onCopyFromProject={(projectId, sourceProjectId) => copyProjectStandardsFromProject(projectId, { sourceProjectId })}
            onSave={saveProjectStandards}
          />
        ) : activeView === "knowledge" ? (
          <KnowledgeCenter
            project={project}
            initialItemId={knowledgeFocusItemId}
            currentCaseId={currentCase?.id}
            currentCaseKnowledgeReferenceIds={(currentCase?.knowledgeReferences ?? []).map((item) => item.itemId)}
            notice={notice}
            onBack={() => navigateView("case")}
            onDirtyChange={setCenterDraftDirty}
            onImport={importKnowledgeLocalText}
            onImportTextFile={importKnowledgeTextFile}
            onReview={reviewKnowledgeForPublish}
            onEdit={editKnowledgeCandidate}
            onAttachToCurrentCase={attachKnowledgeToCurrentCase}
            onDetachFromCurrentCase={detachKnowledgeFromCurrentCase}
            onPublish={publishKnowledge}
            onMarkConflict={markKnowledgeConflicted}
            onExpire={expireKnowledge}
          />
        ) : activeView === "chat" ? (
          <section className="conversation-panel daily-chat-panel">
            <div className="case-heading">
              <div>
                <h1>{activeChat?.title ?? "日常对话"}</h1>
                <p>独立保存 · 可临时使用当前 Project 的已授权模型渠道，内容不进入案件</p>
              </div>
            </div>

            {notice ? <div className="phase-notice" role="status" aria-live="polite">
              <ShieldCheck size={16} />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button>
            </div> : null}

            <div className="conversation-flow">
              {(activeChat?.messages ?? []).map((item) => (
                <DailyChatBubble message={item} key={item.id} />
              ))}
              {!activeChat?.messages.length ? (
                <article className="assistant-message daily-chat-empty">
                  <div className="run-time">独立对话 &gt;</div>
                  <p>直接输入日常问题即可。选择模型时只借用当前 Project 的授权渠道，不读取案件内容，也不写入案件文件。</p>
                </article>
              ) : null}
            </div>

            <form className="composer daily-chat-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} aria-label="日常对话输入" placeholder="直接提问，或先把想法记在这里；需要沉淀成果时再新建正式案件。" />
              <div className="composer-footer">
                <div className="composer-tools">
                  <span className="daily-chat-boundary"><MessageSquare size={15} />独立对话，不进入案件文件夹</span>
                  {selectedSafeDraftModel ? (
                    <label className="daily-model-control">
                      <span>渠道模型</span>
                      <select value={selectedModelKey || selectedSafeDraftModel.key} onChange={(event) => setSelectedModelKey(event.target.value)} aria-label="日常对话渠道和模型">
                        {safeDraftOptions.map((option) => <option value={option.key} key={option.key}>{option.provider.name} / {option.model.displayName}</option>)}
                      </select>
                    </label>
                  ) : <span className="daily-chat-boundary">本地记录</span>}
                </div>
                <div className="composer-actions">
                  <button type="submit" aria-label="发送日常对话" className="send-button" disabled={sendingMessage}>{sendingMessage ? <Bot size={18} /> : <Send size={18} />}</button>
                </div>
              </div>
            </form>
          </section>
        ) : (
        <>
        <section className="conversation-panel">
          <div className="case-heading">
            <div>
              <h1>{currentCase?.title ?? "当前工作文件夹"}</h1>
              <p>{project ? `${projectKindLabel(project)} · ${project.name} · ${project.systemLabel}` : "请创建 SAP 项目或其他工作项目"}</p>
            </div>
            <div className="case-heading-actions">
              {adtReady ? <button type="button" className="context-panel-trigger" onClick={() => setSapEvidencePanelOpen((open) => !open)} aria-expanded={sapEvidencePanelOpen} title="从已验证 SAP 连接读取单个对象证据，不执行写入"><Database size={16} />{sapEvidencePanelOpen ? "收起取证" : "SAP 取证"}</button> : null}
              {!filesPanelVisible ? <button type="button" className="context-panel-trigger" onClick={() => setFilesPanelVisible(true)} title="显示当前工作文件夹文件"><FileText size={16} />文件 {fileCount}</button> : null}
            </div>
          </div>

          {notice ? <div className="phase-notice" role="status" aria-live="polite">
            <ShieldCheck size={16} />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button>
          </div> : null}

          <div className="conversation-flow">
            {(currentCase?.messages ?? []).map((item) => (
              <MessageBubble message={item} files={flatFiles} onPreview={previewCaseFile} key={item.id} />
            ))}

          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            {isSapBoundProject(project) && adtReady && sapEvidencePanelOpen ? (
              <div className="sap-evidence-bar">
                <div className="sap-evidence-status" title="当前 SAP 只读取证上下文；本功能不写入 SAP">
                  <Database size={15} />
                  <span>{adtEvidenceStatus}</span>
                </div>
                <select value={sapEvidenceType} onChange={(event) => setSapEvidenceType(event.target.value as SapObjectEvidenceType)} aria-label="SAP 对象类型">
                  {sapEvidenceTypes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
                <input value={sapEvidenceName} onChange={(event) => setSapEvidenceName(event.target.value)} placeholder="ZDEMO_REPORT 或 /UI2/CL_JSON" aria-label="SAP 对象名" />
                {sapEvidenceType === "function" ? (
                  <input value={sapEvidenceFunctionGroup} onChange={(event) => setSapEvidenceFunctionGroup(event.target.value)} placeholder="函数组，例如 ZFG_MM001" aria-label="SAP 函数组" />
                ) : null}
                <button type="button" onClick={() => void readSapEvidence()} disabled={sapEvidenceBusy || !sapEvidenceName.trim()} title="把单个 SAP 只读对象证据写入当前工作文件夹">
                  <Database size={15} />
                  {sapEvidenceBusy ? "取证中" : "补充 SAP 只读证据"}
                </button>
              </div>
            ) : null}
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} aria-label="继续追问" placeholder={workComposerPlaceholder} />
            {caseActionConfirmationVisible ? (
              <div className="action-confirmation-preview" role="region" aria-label="案件动作确认">
                <div className="action-confirmation-settings">
                  <label className="case-action-control">
                    <span>成果类型</span>
                    <select value={selectedCaseActionId} onChange={(event) => setSelectedCaseActionId(event.target.value as CaseActionId)} aria-label="选择成果动作">
                      {caseActions.map((action) => <option value={action.id} key={action.id}>{action.label}</option>)}
                    </select>
                  </label>
                  <label className="permission-mode-control" title={currentPermissionMode.summary}>
                    <span>执行偏好</span>
                    <select value={actionPermissionMode} onChange={(event) => setActionPermissionMode(event.target.value as ActionPermissionMode)} aria-label="执行偏好">
                      {permissionModes.map((mode) => <option value={mode.id} key={mode.id}>{mode.label}</option>)}
                    </select>
                  </label>
                  <p>{selectedCaseAction.description}</p>
                </div>
                <div className="action-target-line"><span>保存到</span><code>{selectedCaseAction.outputPath}</code></div>
                <div className="action-confirmation-buttons">
                  <button type="button" onClick={() => setCaseActionConfirmationVisible(false)}>取消</button>
                  <button type="button" className="primary" onClick={() => void runCaseAction()} disabled={sendingMessage}>{sendingMessage ? "生成中" : "开始生成"}</button>
                </div>
              </div>
            ) : null}
            <div className="composer-footer">
              <div className="composer-tools">
                <button type="button" className="case-action-run-button" onClick={() => setCaseActionConfirmationVisible((visible) => !visible)} disabled={sendingMessage} aria-expanded={caseActionConfirmationVisible} title="从当前案件生成笔记、说明书、流程图或候选知识">
                  <WandSparkles size={15} />成果动作<ChevronDown size={14} />
                </button>
                {codexAssistAvailable ? <label className={`codex-assist-toggle ${codexAssistEnabled ? "active ready" : "ready"}`} title={codexAssistTitle}>
                  <input
                    type="checkbox"
                    checked={codexAssistEnabled}
                    disabled={sendingMessage}
                    onChange={(event) => setCodexAssistEnabled(event.target.checked)}
                    aria-label="开启 Codex 工程辅助"
                  />
                  <Bot size={15} />
                  <strong>Codex 辅助</strong>
                </label> : null}
              <div className="model-picker">
                <button
                  type="button"
                  className={`model-select ${selectedSafeDraftModel ? "ready" : "disabled"}`}
                  title={selectedSafeDraftModel ? `案件发送会尝试使用 ${selectedSafeDraftModel.provider.name} / ${selectedSafeDraftModel.model.id} 生成安全本地草稿` : "没有真实 HTTP 验证通过的模型渠道；发送时只生成本地草稿"}
                  aria-expanded={modelPickerOpen}
                  onClick={() => setModelPickerOpen((open) => !open)}
                >
                  {selectedSafeDraftModel ? (
                    <>
                      <span>渠道模型</span>
                      <strong>{selectedSafeDraftModel.model.displayName}</strong>
                      <em>{selectedSafeDraftModel.provider.name}</em>
                    </>
                  ) : (
                    <>
                      <span>未验证模型</span>
                      <strong>使用本地草稿</strong>
                    </>
                  )}
                  <ChevronDown size={15} />
                </button>
                {modelPickerOpen ? (
                  <div className="model-picker-panel" role="dialog" aria-label="选择模型">
                    <div className="model-picker-search">
                      <Search size={15} />
                      <input
                        value={modelSearchQuery}
                        onChange={(event) => setModelSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.preventDefault();
                        }}
                        placeholder="搜索模型或渠道"
                        aria-label="搜索模型"
                      />
                    </div>
                    <div className="model-filter-row" aria-label="按能力筛选">
                      {selectableCapabilities.map((capability) => (
                        <button
                          type="button"
                          className={modelCapabilityFilters.includes(capability) ? "active" : ""}
                          onClick={() => toggleModelCapabilityFilter(capability)}
                          key={capability}
                        >
                          {capabilityLabels[capability]}
                        </button>
                      ))}
                    </div>
                    <div className="model-picker-current">
                      <span>当前选择</span>
                      <strong>{selectedSafeDraftModel ? `${selectedSafeDraftModel.provider.name} / ${selectedSafeDraftModel.model.displayName}` : "本地草稿"}</strong>
                    </div>
                    <div className="model-picker-list">
                      {groupedModelOptions.length > 0 ? groupedModelOptions.map((group) => (
                        <section key={group.provider.id}>
                          <header>
                            <span>{group.provider.name}</span>
                            <small>{group.provider.providerType} · 渠道已验证 · 模型已获取</small>
                          </header>
                          {group.options.map((option) => (
                            <button
                              type="button"
                              className={option.key === selectedSafeDraftModel?.key ? "active" : ""}
                              onClick={() => {
                                setSelectedModelKey(option.key);
                                setModelPickerOpen(false);
                              }}
                              key={option.key}
                            >
                              <span>{option.model.displayName}</span>
                              <small>{option.model.id}</small>
                              <em>{option.model.capabilities.map((capability) => capabilityLabels[capability]).join(" / ")}</em>
                            </button>
                          ))}
                        </section>
                      )) : (
                        <div className="model-picker-empty">
                          <strong>没有匹配的已验证模型</strong>
                          <span>请清空搜索或能力筛选；如果仍没有结果，到配置中心验证 API 渠道。</span>
                        </div>
                      )}
                    </div>
                    {modelProviderErrors.length > 0 ? (
                      <div className="model-provider-errors">
                        <strong>不可用渠道</strong>
                        {modelProviderErrors.slice(0, 4).map((item) => (
                          <span key={item.provider.id}>{item.provider.name}：{item.reason}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              </div>
              <div className="composer-actions">
                <button type="submit" aria-label="保存到当前案件" className="send-button" disabled={sendingMessage}>{sendingMessage ? <Bot size={18} /> : <Send size={18} />}</button>
              </div>
            </div>
          </form>
        </section>

        {filesPanelVisible ? <aside className="files-panel" aria-label="当前工作文件夹文件" data-phase="phase40-files-only-context">
          <div className="files-heading">
            <div>
              <h2>当前工作文件夹</h2>
              <span>{currentCase?.title ?? "未选择工作文件夹"}</span>
            </div>
            <button aria-label="隐藏右侧面板" title="只隐藏显示，不影响文件保存" className="icon-button" onClick={() => setFilesPanelVisible(false)}><PanelLeft size={17} /></button>
          </div>
          <label className="file-search">
            <Search size={16} />
            <input value={fileSearchQuery} onChange={(event) => setFileSearchQuery(event.target.value)} placeholder="搜索文件" aria-label="搜索当前工作文件夹文件" />
          </label>
          <div className="file-panel-actions">
            <button type="button" onClick={() => void prepareFeishuHandoff()} disabled={feishuHandoffBusy || outputFileCount === 0} title="只生成本地飞书草稿，不发布或更新云端文档。">
              <FileText size={15} />
              {feishuHandoffBusy ? "生成中" : "飞书本地草稿"}
            </button>
          </div>
          <div className="file-purpose-legend" aria-label="文件状态" data-phase={PHASE25_CASE_FILE_KNOWLEDGE_STATUS_MARKER}>
            <span><b className="legend-dot legend-green" />交付物</span>
            <span><b className="legend-dot legend-orange" />待确认知识</span>
            <span><b className="legend-dot legend-blue" />证据与过程</span>
          </div>
          <div className="file-tree">
            {state?.activeCaseFiles.length ? (
              filteredCaseFiles.length ? <FileRows nodes={filteredCaseFiles} selectedPath={selectedPreviewPath} onPreview={previewCaseFile} /> : <div className="empty-state">没有匹配文件。</div>
            ) : <div className="empty-state">当前工作文件夹还没有文件。</div>}
          </div>
          <section className={`file-preview${filePreviewError ? " file-preview-blocked" : ""}`}>
            <div className="file-preview-heading">
              <div>
                <strong>{filePreview?.displayName ?? selectedPreviewNode?.displayName ?? "本地只读预览"}</strong>
                <span>{filePreviewSubtitle(filePreview, selectedPreviewNode)}</span>
              </div>
              <Eye size={16} />
            </div>
            {filePreview ? (
              <>
                <div className="file-preview-meta">
                  <span>{filePreview.fileType || "text"}</span>
                  <span>{formatSize(filePreview.sizeBytes)}</span>
                  {filePreview.truncated ? <span>已截断</span> : null}
                  {filePreview.redactions > 0 ? <span>已脱敏 {filePreview.redactions} 处</span> : null}
                </div>
                <pre>{filePreview.content}</pre>
              </>
            ) : filePreviewError ? <p>{filePreviewError}</p> : <p>选择 Markdown、文本、CSV 或 Mermaid 文件进行只读预览。</p>}
          </section>
          <div className="files-footer">
            <span>{fileSearchQuery.trim() ? `${filteredFileCount} / ${fileCount} 个文件` : `${fileCount} 个文件`}</span>
            <span><ShieldCheck size={15} />本地文件</span>
          </div>
        </aside> : null}
        </>
        )}
      </section>
    </main>
  );
}

export default App;
