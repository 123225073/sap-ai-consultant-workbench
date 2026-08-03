import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ArrowDown,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  Plug,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  RotateCcw,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import ConfigCenter from "./ConfigCenter";
import CapabilityCenter, { type CapabilityMcpDraft, type CapabilityMcpConnection, type CapabilityMemoryDraft, type CapabilityMemoryItem, type CapabilityPluginItem, type CapabilityPromptItem, type CapabilitySkillItem } from "./CapabilityCenter";
import KnowledgeCenter from "./KnowledgeCenter";
import StandardsCenter from "./StandardsCenter";
import MermaidPreview from "./MermaidPreview";
import type { ActionPermissionMode, AdtConfig, AdtVerificationReport, AiConversationStreamEvent, ApiProviderConfig, AppendDailyChatMessageInput, CaseActionId, CaseFileNode, CaseFilePreview, CaseMessage, CaseSummary, CaseWorkflowInput, CodexVerificationReport, ConversationThreadStatus, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, DailyChatMessage, DailyChatThread, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuVerificationReport, KnowledgeCaseReferenceInput, KnowledgeEditInput, KnowledgeImportLocalTextInput, KnowledgeImportTextFileResult, KnowledgeItemActionInput, KnowledgeReviewInput, LocalAiInstallResult, LocalAiScanResult, ModelCapability, ModelProviderVerificationReport, ModelSummary, ProjectSecretInput, ProjectSummary, SapGuiDiscoveryReport, SapObjectEvidenceType, SaveProjectStandardsInput, SearchResult, TaskMode, WorkbenchState, WorkThread, WorkspaceBackupResult, WorkspaceImportResult } from "../shared/workbenchTypes";
import type { AgentRuntimeEvent, AgentThreadSnapshot } from "../shared/agentRuntimeTypes";
import type { CapabilityCenterSnapshot, CapabilitySkillDiscoveryReport } from "../shared/capabilityCenterTypes";
import type { PromptProfileScope } from "../shared/promptMemoryTypes";
import { routeSapConnections, type SapConnectionRouteDecision } from "../shared/sapConnectionRouting";

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

function samePromptScope(left: PromptProfileScope, right: PromptProfileScope): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "personal" && right.type === "personal") return true;
  if (left.type === "project" && right.type === "project") return left.projectId === right.projectId;
  if (left.type === "case" && right.type === "case") return left.projectId === right.projectId && left.caseId === right.caseId;
  return false;
}

function isVisibleWorkProject(caseItem: CaseSummary): boolean {
  return caseItem.isPlaceholder !== true;
}

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

function readableHistoricalText(value: string, fallback: string): string {
  const questionMarks = value.match(/\?/g)?.length ?? 0;
  return value.includes("????") && questionMarks / Math.max(value.length, 1) > 0.25 ? fallback : value;
}

function searchResultLabel(result: SearchResult): string {
  if (result.id.startsWith("file-summary-")) return "安全摘要";
  if (result.type === "work-thread") return "任务";
  if (result.type === "chat-thread") return "对话";
  return result.type === "project" ? "项目" : result.type === "case" ? "工作文件夹" : result.type === "knowledge" ? "知识" : "文件";
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
  if (selectedPreviewNode) return `当前运维项目文件 · ${caseFilePurposeLabel(selectedPreviewNode)}`;
  if (filePreview) return "当前运维项目文件 · 安全文本预览";
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

function activeWorkThread(state: WorkbenchState | null): WorkThread | undefined {
  return state?.workThreads.find((thread) => thread.id === state.activeWorkThreadId)
    ?? state?.workThreads.find((thread) => thread.status === "active");
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
  const connections = project.config.adtConnections.length > 0 ? project.config.adtConnections : [project.config.adt];
  const verifiedCount = connections.filter((adt) => adt.connectionStatus === "verified" && adt.minimalReadStatus === "verified" && adt.lastVerificationMode === "adt").length;
  const failedCount = connections.filter((adt) => adt.connectionStatus === "failed" || adt.minimalReadStatus === "failed" || adt.configStatus === "failed").length;
  if (verifiedCount === connections.length) {
    return { label: `SAP ${verifiedCount} 个可用`, tone: "green" };
  }
  if (verifiedCount > 0) {
    return { label: `SAP ${verifiedCount}/${connections.length} 可用`, tone: "orange" };
  }
  if (failedCount > 0) {
    return { label: "SAP 需检查", tone: "orange" };
  }
  return { label: "SAP 未验证", tone: "blue" };
}

function threadTimestamp(thread: Pick<DailyChatThread, "lastOpenedAt" | "updatedAt" | "createdAt">): string {
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
  const sortedThreads = threads.filter((thread) => thread.status === "active").sort((a, b) => new Date(threadTimestamp(b)).getTime() - new Date(threadTimestamp(a)).getTime());
  const groups = new Map<string, DailyChatThread[]>();
  for (const thread of sortedThreads) {
    const group = sidebarDateGroup(threadTimestamp(thread));
    groups.set(group, [...(groups.get(group) ?? []), thread]);
  }
  return ["今天", "昨天", "近 7 天", "更早"]
    .map((label) => ({ label, threads: groups.get(label) ?? [] }))
    .filter((group) => group.threads.length > 0);
}

function FloatingActionMenu({
  label,
  title,
  disabled = false,
  className = "",
  panelClassName = "",
  children
}: {
  label: string;
  title: string;
  disabled?: boolean;
  className?: string;
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelWidth = panel.offsetWidth || 160;
      const panelHeight = panel.offsetHeight || 120;
      const gutter = 8;
      const gap = 4;
      const left = Math.min(Math.max(gutter, triggerRect.right - panelWidth), window.innerWidth - panelWidth - gutter);
      const spaceBelow = window.innerHeight - triggerRect.bottom - gutter;
      const top = spaceBelow >= panelHeight + gap
        ? triggerRect.bottom + gap
        : Math.max(gutter, triggerRect.top - panelHeight - gap);
      setPosition({ left, top });
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    const frame = window.requestAnimationFrame(updatePosition);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return <span className={`floating-action-menu ${className}`.trim()}>
    <button
      ref={triggerRef}
      type="button"
      className="floating-menu-trigger"
      disabled={disabled}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="menu"
      title={title}
      onClick={() => setOpen((current) => !current)}
    >
      <MoreHorizontal size={16} />
    </button>
    {open ? createPortal(
      <div ref={panelRef} className={`floating-action-menu-panel ${panelClassName}`.trim()} style={position} role="menu">
        {children(() => setOpen(false))}
      </div>,
      document.body
    ) : null}
  </span>;
}

function ConversationThreadRow({
  title,
  subtitle,
  active,
  status,
  busy,
  onOpen,
  onCopyId,
  onStatus
}: {
  title: string;
  subtitle: string;
  active: boolean;
  status: ConversationThreadStatus;
  busy: boolean;
  onOpen: () => void;
  onCopyId: () => void;
  onStatus: (status: ConversationThreadStatus) => void;
}) {
  return (
    <div className={`conversation-row-shell${active ? " active" : ""}`}>
      <button type="button" className="conversation-row-main" onClick={onOpen}>
        <MessageSquare size={15} />
        <span><strong>{title}</strong><small>{subtitle}</small></span>
      </button>
      <FloatingActionMenu className="thread-menu" panelClassName="thread-menu-panel" disabled={busy} label={`管理会话 ${title}`} title={busy ? "当前有回复正在生成，完成后可管理会话" : "管理会话"}>
        {(close) => <>
          <button type="button" onClick={() => { close(); onCopyId(); }}><Copy size={14} />复制会话 ID</button>
          {status === "active" ? <button type="button" disabled={busy} onClick={() => { close(); onStatus("archived"); }}><Archive size={14} />归档</button> : null}
          {status === "active" ? <button type="button" disabled={busy} onClick={() => { close(); onStatus("removed"); }}><Trash2 size={14} />移除</button> : null}
          {status !== "active" ? <button type="button" disabled={busy} onClick={() => { close(); onStatus("active"); }}><RotateCcw size={14} />恢复</button> : null}
        </>}
      </FloatingActionMenu>
    </div>
  );
}

function CustomerProjectTree({
  item,
  workThreads,
  active,
  activeView,
  activeThreadId,
  busy,
  legacy = false,
  onSwitch,
  onConfig,
  onCreateWorkProject,
  onCreateThread,
  onOpenThread,
  onCopyThreadId,
  onThreadStatus
}: {
  item: ProjectSummary;
  workThreads: WorkThread[];
  active: boolean;
  activeView: string;
  activeThreadId?: string;
  busy: boolean;
  legacy?: boolean;
  onSwitch: () => void;
  onConfig?: () => void;
  onCreateWorkProject: () => void;
  onCreateThread: (caseId: string) => void;
  onOpenThread: (threadId: string) => void;
  onCopyThreadId: (threadId: string) => void;
  onThreadStatus: (threadId: string, status: ConversationThreadStatus) => void;
}) {
  const workProjects = item.cases.filter(isVisibleWorkProject);
  const [expanded, setExpanded] = useState(active);
  const [expandedWorkProjectIds, setExpandedWorkProjectIds] = useState<Set<string>>(() => new Set(workProjects.map((workProject) => workProject.id)));

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  useEffect(() => {
    setExpandedWorkProjectIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const workProject of workProjects) {
        if (!next.has(workProject.id)) {
          next.add(workProject.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [workProjects.map((workProject) => workProject.id).join("|")]);

  function toggleCustomerProject() {
    if (!active) {
      onSwitch();
      setExpanded(true);
      return;
    }
    setExpanded((current) => !current);
  }

  function toggleWorkProject(workProjectId: string) {
    setExpandedWorkProjectIds((current) => {
      const next = new Set(current);
      if (next.has(workProjectId)) next.delete(workProjectId);
      else next.add(workProjectId);
      return next;
    });
  }

  const customerExpanded = active && expanded;
  return <section className={`project-card customer-project-card${active ? " active" : ""}${legacy ? " legacy-demo-project-card" : ""}`}>
    <div className="project-card-title">
      <button type="button" className="project-switch" onClick={toggleCustomerProject} aria-expanded={customerExpanded} aria-controls={`work-project-tree-${item.id}`} title={customerExpanded ? `收起客户项目：${item.name}` : `展开客户项目：${item.name}`}>
        {customerExpanded ? <ChevronDown className="tree-chevron" size={15} /> : <ChevronRight className="tree-chevron" size={15} />}
        <span className="project-switch-copy">
          <strong>{item.name}</strong>
          <span className="project-tags">
            <StatusPill label={projectKindLabel(item)} tone={legacy ? "neutral" : "blue"} />
            {item.sapVersion === "UNKNOWN" ? <StatusPill label={item.systemLabel} tone="neutral" /> : <StatusPill {...sapSidebarStatus(item)} />}
          </span>
        </span>
      </button>
      <div className="project-actions">
        <button type="button" className="icon-button project-add-work-button" onClick={onCreateWorkProject} aria-label={`在 ${item.name} 下新建运维项目`} title="新建运维项目"><FolderPlus size={15} /><span>项目</span></button>
        {onConfig ? <FloatingActionMenu className="project-menu" panelClassName="project-menu-panel" label={`管理客户项目 ${item.name}`} title="更多客户项目操作">
          {(close) => <button type="button" onClick={() => { close(); onConfig(); }}><Settings size={14} />配置 SAP 系统</button>}
        </FloatingActionMenu> : null}
      </div>
    </div>
    {customerExpanded ? <div className="work-project-tree" id={`work-project-tree-${item.id}`}>
      {workProjects.length === 0 ? <div className="work-project-empty"><span>暂无运维项目</span><button type="button" onClick={onCreateWorkProject}><Plus size={14} />新建</button></div> : workProjects.map((workProject) => {
        const threads = workThreads.filter((thread) => thread.projectId === item.id && thread.caseId === workProject.id && thread.status === "active");
        const workProjectExpanded = expandedWorkProjectIds.has(workProject.id);
        return <section className={`work-project-group${workProjectExpanded ? " expanded" : " collapsed"}`} key={workProject.id}>
          <header>
            <button type="button" className="work-project-open" onClick={() => toggleWorkProject(workProject.id)} aria-expanded={workProjectExpanded} aria-controls={`work-project-threads-${workProject.id}`} title={workProjectExpanded ? `收起运维项目：${workProject.title}` : `展开运维项目：${workProject.title}`}>
              {workProjectExpanded ? <ChevronDown className="tree-chevron" size={14} /> : <ChevronRight className="tree-chevron" size={14} />}
              <Folder size={14} /><span><strong>{workProject.title}</strong><small>{workProject.folderSource === "linked-local" ? workProject.linkedFolderName || "电脑文件夹" : "共享项目文件夹"}</small></span>
            </button>
            <button type="button" className="icon-button work-project-add-thread" onClick={() => onCreateThread(workProject.id)} aria-label={`在 ${workProject.title} 下新建对话`} title="新建对话线程"><Plus size={14} /><span>对话</span></button>
          </header>
          {workProjectExpanded ? <div className="work-project-threads" id={`work-project-threads-${workProject.id}`}>
            {threads.map((thread) => <ConversationThreadRow
              key={thread.id}
              title={thread.title}
              subtitle="对话线程"
              active={activeView === "case" && thread.id === activeThreadId}
              status={thread.status}
              busy={busy}
              onOpen={() => onOpenThread(thread.id)}
              onCopyId={() => onCopyThreadId(thread.id)}
              onStatus={(status) => onThreadStatus(thread.id, status)}
            />)}
          </div> : null}
        </section>;
      })}
    </div> : null}
  </section>;
}

type ComposerModelOption = {
  key: string;
  provider: ApiProviderConfig;
  model: ModelSummary;
};

type StreamingTurn = {
  scope: "daily-chat" | "case";
  contextKey: string;
  userContent: string;
  assistantContent: string;
  providerName: string;
  modelId: string;
  activityLabel?: string;
};

type ActiveAgentRun = {
  turnId: string;
  requestId: string;
  scope: AgentRuntimeEvent["scope"];
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
  if (provider.models.length === 0) return "未获取到可用模型";
  return null;
}

function isChatModel(model: ModelSummary): boolean {
  const nonChatModel = /(embedding|embed|rerank|moderation|image|imagine|video|sora|nano-banana|tts|speech|audio|whisper)/i;
  return model.capabilities.includes("chat") && !nonChatModel.test(model.id);
}

function enabledCatalogModelOptions(project: ProjectSummary | undefined): ComposerModelOption[] {
  return (project?.config.apiProviders ?? []).flatMap((provider) => {
    if (!isProviderSafeForDraft(provider)) return [];
    return provider.models.map((model) => ({ key: modelOptionKey(provider.id, model.id), provider, model }));
  });
}

function safeDraftModelOptions(project: ProjectSummary | undefined): ComposerModelOption[] {
  return enabledCatalogModelOptions(project).filter((option) => isChatModel(option.model));
}

function providerErrorStates(project: ProjectSummary | undefined): { provider: ApiProviderConfig; reason: string }[] {
  return (project?.config.apiProviders ?? []).flatMap((provider) => {
    const reason = providerModelStatus(provider);
    return reason ? [{ provider, reason }] : [];
  });
}

function ComposerModelPicker({
  options,
  providerErrors,
  selected,
  onSelect
}: {
  options: ComposerModelOption[];
  providerErrors: { provider: ApiProviderConfig; reason: string }[];
  selected: ComposerModelOption | null;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [capabilityFilters, setCapabilityFilters] = useState<Exclude<ModelCapability, "chat">[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = `model-picker-${selected?.provider.id ?? "none"}`;
  const filteredOptions = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return options.filter((option) => {
      const textMatched = !normalized || [
        option.provider.name,
        option.model.id,
        option.model.displayName,
        ...option.model.capabilities.map((capability) => capabilityLabels[capability])
      ].join(" ").toLowerCase().includes(normalized);
      const capabilityMatched = capabilityFilters.every((capability) => option.model.capabilities.includes(capability));
      return textMatched && capabilityMatched;
    });
  }, [options, searchQuery, capabilityFilters]);
  const groups = useMemo(() => {
    const providerIds = [...new Set(filteredOptions.map((option) => option.provider.id))];
    return providerIds.map((providerId) => ({
      provider: filteredOptions.find((option) => option.provider.id === providerId)!.provider,
      options: filteredOptions.filter((option) => option.provider.id === providerId)
    }));
  }, [filteredOptions]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closePicker = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event instanceof PointerEvent && !panelRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", closePicker);
    window.addEventListener("pointerdown", closePicker);
    return () => {
      window.removeEventListener("keydown", closePicker);
      window.removeEventListener("pointerdown", closePicker);
    };
  }, [open]);

  function toggleCapability(capability: Exclude<ModelCapability, "chat">) {
    setCapabilityFilters((filters) => filters.includes(capability)
      ? filters.filter((item) => item !== capability)
      : [...filters, capability]);
  }

  return (
    <div className="model-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`model-select ${selected ? "ready" : "disabled"}`}
        title={selected ? `${selected.provider.name} / ${selected.model.id}` : "没有已启用且验证通过的对话模型"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <Bot size={16} />
        <strong>{selected?.model.displayName ?? "选择模型"}</strong>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div ref={panelRef} id={panelId} className="model-picker-panel" role="dialog" aria-label="选择模型">
          <div className="model-picker-search">
            <Search size={15} />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
              placeholder="搜索模型或渠道"
              aria-label="搜索模型"
            />
          </div>
          <div className="model-filter-row" aria-label="按能力筛选">
            {selectableCapabilities.map((capability) => (
              <button type="button" className={capabilityFilters.includes(capability) ? "active" : ""} onClick={() => toggleCapability(capability)} key={capability}>
                {capabilityLabels[capability]}
              </button>
            ))}
          </div>
          <div className="model-picker-current">
            <span>当前模型</span>
            <strong>{selected ? `${selected.provider.name} / ${selected.model.displayName}` : "尚未选择"}</strong>
          </div>
          <div className="model-picker-list">
            {groups.length > 0 ? groups.map((group) => (
              <section key={group.provider.id}>
                <header>
                  <span>{group.provider.name}</span>
                  <small>{group.options.filter((option) => isChatModel(option.model)).length} 个可对话 / 共 {group.options.length} 个</small>
                </header>
                {group.options.map((option) => (
                  <button
                    type="button"
                    className={option.key === selected?.key ? "active" : ""}
                    onClick={() => {
                      onSelect(option.key);
                      setOpen(false);
                      window.setTimeout(() => triggerRef.current?.focus(), 0);
                    }}
                    disabled={!isChatModel(option.model)}
                    title={isChatModel(option.model) ? `选择 ${option.model.displayName}` : "该模型不支持文本对话，不能在消息输入区使用"}
                    key={option.key}
                  >
                    <span>{option.model.displayName}</span>
                    <small>{option.model.id}</small>
                    <em>{isChatModel(option.model) ? option.model.capabilities.map((capability) => capabilityLabels[capability]).join(" / ") : "不可用于文本对话"}</em>
                  </button>
                ))}
              </section>
            )) : (
              <div className="model-picker-empty">
                <strong>没有匹配的可对话模型</strong>
                <span>请清空筛选，或到配置中心启用并测试模型渠道。</span>
              </div>
            )}
          </div>
          {providerErrors.length > 0 ? (
            <div className="model-provider-errors">
              <strong>未启用或不可用渠道</strong>
              {providerErrors.map((item) => <span key={item.provider.id}>{item.provider.name}：{item.reason}</span>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function sapConnectionLabel(connection: AdtConfig): string {
  return `${connection.systemId || connection.alias || "SAP"} / Client ${connection.client || "未填"}`;
}

function SapConnectionPicker({
  connections,
  route,
  mode,
  selectedIds,
  onModeChange,
  onSelectedIdsChange
}: {
  connections: AdtConfig[];
  route: SapConnectionRouteDecision;
  mode: "auto" | "manual";
  selectedIds: string[];
  onModeChange: (mode: "auto" | "manual") => void;
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedConnections = connections.filter((connection) => selectedIds.includes(connection.id));
  const autoConnections = connections.filter((connection) => route.connectionIds.includes(connection.id));
  const label = mode === "auto"
    ? `自动 · ${autoConnections.map(sapConnectionLabel).join("、") || "待匹配"}`
    : selectedConnections.map(sapConnectionLabel).join("、") || "手动选择连接";

  useEffect(() => {
    if (!open) return;
    const closePicker = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event instanceof PointerEvent && !panelRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", closePicker);
    window.addEventListener("pointerdown", closePicker);
    return () => {
      window.removeEventListener("keydown", closePicker);
      window.removeEventListener("pointerdown", closePicker);
    };
  }, [open]);

  function toggleConnection(connectionId: string, checked: boolean) {
    onModeChange("manual");
    if (checked && !selectedIds.includes(connectionId) && selectedIds.length >= 6) return;
    onSelectedIdsChange(checked
      ? [...new Set([...selectedIds, connectionId])]
      : selectedIds.filter((id) => id !== connectionId));
  }

  return <div className="sap-connection-picker">
    <button ref={triggerRef} type="button" className={route.needsConfirmation && mode === "auto" ? "needs-confirmation" : ""} onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="dialog" title={route.reason}>
      <Database size={15} /><span>{label}</span><ChevronDown size={14} />
    </button>
    {open ? <div ref={panelRef} className="sap-connection-picker-panel" role="dialog" aria-label="选择 SAP 只读连接">
      <label className="sap-route-auto-option">
        <input type="radio" name="sap-connection-mode" checked={mode === "auto"} onChange={() => onModeChange("auto")} />
        <span><strong>根据当前问题自动选择</strong><small>{route.reason}</small></span>
      </label>
      <div className="sap-route-list">
        <header><strong>手动指定连接</strong><small>可多选后执行交叉验证</small></header>
        {connections.map((connection) => <label key={connection.id}>
          <input type="checkbox" checked={mode === "manual" && selectedIds.includes(connection.id)} disabled={mode === "manual" && !selectedIds.includes(connection.id) && selectedIds.length >= 6} onChange={(event) => toggleConnection(connection.id, event.target.checked)} />
          <span><strong>{sapConnectionLabel(connection)}</strong><small>{connection.alias || "未命名连接"}</small></span>
        </label>)}
        <small className="sap-route-limit">单次最多选择 6 个连接；更大范围请拆分任务，便于逐项核对证据。</small>
      </div>
    </div> : null}
  </div>;
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
                title="只读预览当前运维项目文本文件"
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

const MessageContent = memo(function MessageContent({ content }: { content: string }) {
  return <div className="message-body">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>
      }}
    >
      {content}
    </ReactMarkdown>
  </div>;
});

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
      <MessageContent content={message.content} />
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
  const content = readableHistoricalText(message.content, "这条历史记录的字符编码已损坏，无法可靠显示原文。");
  if (message.role === "user") {
    return (
      <div className="user-message">
        {content}
        <time>{formatTime(message.createdAt)}</time>
      </div>
    );
  }

  return (
    <article className="assistant-message daily-chat-message">
      <div className="run-time">
        {message.responseMode === "model-failed" ? "模型调用失败" : message.responseMode === "model-success" ? `${message.providerName ?? "模型渠道"} · ${message.modelId}` : "本地记录"}
        {` · ${formatTime(message.createdAt)}`}
      </div>
      <MessageContent content={content} />
    </article>
  );
}

function StreamingTurnBubble({ turn }: { turn: StreamingTurn }) {
  return (
    <>
      <div className="user-message streaming-user-message">
        {turn.userContent}
        <time>刚刚</time>
      </div>
      <article className="assistant-message streaming-assistant-message" data-streaming-chars={turn.assistantContent.length} aria-live="polite" aria-busy="true">
        <div className="run-time">{turn.providerName} · {turn.modelId} · {turn.activityLabel ?? "正在回复"}</div>
        <div className="streaming-message-body">
          <MessageContent content={turn.assistantContent || turn.activityLabel || "正在连接模型"} />
          <span className="streaming-cursor" aria-hidden="true" />
        </div>
      </article>
    </>
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
  const [activeView, setActiveView] = useState<"chat" | "case" | "config" | "standards" | "knowledge" | "capabilities">("case");
  const [filesPanelVisible, setFilesPanelVisible] = useState(() => window.innerWidth > 1180);
  const [createPanel, setCreatePanel] = useState<"project" | "case" | null>(null);
  const [hiddenProjectsVisible, setHiddenProjectsVisible] = useState(false);
  const [selectedCaseActionId, setSelectedCaseActionId] = useState<CaseActionId>("capture-note");
  const [caseActionConfirmationVisible, setCaseActionConfirmationVisible] = useState(false);
  const [actionPermissionMode, setActionPermissionMode] = useState<ActionPermissionMode>("request_approval");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [codexAssistEnabled, setCodexAssistEnabled] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [streamingTurn, setStreamingTurn] = useState<StreamingTurn | null>(null);
  const [activeAgentRun, setActiveAgentRun] = useState<ActiveAgentRun | null>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectSapVersion, setNewProjectSapVersion] = useState<NewProjectSapVersion>("S4");
  const [newProjectSystemLabel, setNewProjectSystemLabel] = useState("Local");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [newCaseProjectId, setNewCaseProjectId] = useState("");
  const [newTaskFolderMode, setNewTaskFolderMode] = useState<"new" | "existing">("new");
  const [newTaskFolderName, setNewTaskFolderName] = useState("");
  const [newTaskFolderSelectionToken, setNewTaskFolderSelectionToken] = useState("");
  const [newTaskSelectedFolderName, setNewTaskSelectedFolderName] = useState("");
  const [selectingTaskFolder, setSelectingTaskFolder] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [createTaskError, setCreateTaskError] = useState("");
  const [sapEvidenceType, setSapEvidenceType] = useState<SapObjectEvidenceType>("program");
  const [sapEvidenceName, setSapEvidenceName] = useState("");
  const [sapEvidenceFunctionGroup, setSapEvidenceFunctionGroup] = useState("");
  const [sapEvidencePanelOpen, setSapEvidencePanelOpen] = useState(false);
  const [sapEvidenceBusy, setSapEvidenceBusy] = useState(false);
  const [sapConnectionMode, setSapConnectionMode] = useState<"auto" | "manual">("auto");
  const [manualSapConnectionIds, setManualSapConnectionIds] = useState<string[]>([]);
  const [feishuHandoffBusy, setFeishuHandoffBusy] = useState(false);
  const [attachmentImportBusy, setAttachmentImportBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [knowledgeFocusItemId, setKnowledgeFocusItemId] = useState("");
  const [centerDraftDirty, setCenterDraftDirty] = useState(false);
  const [capabilitySnapshot, setCapabilitySnapshot] = useState<CapabilityCenterSnapshot | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);
  const newCaseInputRef = useRef<HTMLInputElement>(null);
  const newTaskButtonRef = useRef<HTMLButtonElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const searchRequestRef = useRef(0);
  const workflowContextRef = useRef("");
  const messageDraftsRef = useRef(new Map<string, string>());
  const modelSelectionsRef = useRef(new Map<string, string>());
  const conversationFlowRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const pendingStreamRef = useRef<{ scope: StreamingTurn["scope"]; contextKey: string; delta: string; providerName?: string; modelId?: string } | null>(null);
  const streamFrameRef = useRef<number | null>(null);
  const cancelRequestedRef = useRef(false);
  const pendingStopRef = useRef(false);
  const activeAgentRunRef = useRef<ActiveAgentRun | null>(null);
  const directStreamRequestIdsRef = useRef(new Set<string>());

  const bridge = window.workbench;

  useEffect(() => {
    const closeOutsideMenus = (event: PointerEvent) => {
      const target = event.target as Node | null;
      document.querySelectorAll<HTMLDetailsElement>('details[data-dismiss-on-outside="true"][open]').forEach((menu) => {
        if (target && !menu.contains(target)) menu.open = false;
      });
    };
    const closeMenusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll<HTMLDetailsElement>('details[data-dismiss-on-outside="true"][open]').forEach((menu) => {
        menu.open = false;
        menu.querySelector<HTMLElement>("summary")?.focus();
      });
    };
    window.addEventListener("pointerdown", closeOutsideMenus);
    window.addEventListener("keydown", closeMenusOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutsideMenus);
      window.removeEventListener("keydown", closeMenusOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onAgentRuntimeEvent((event) => {
      const eventContextKey = event.scope === "chat" ? `chat:${event.legacyThreadId}` : `work:${event.legacyThreadId}`;
      if (eventContextKey !== activeConversationKeyRef.current) return;
      if (event.type === "assistant-delta") {
        if (directStreamRequestIdsRef.current.has(event.requestId)) return;
        const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
        if (!delta) return;
        setStreamingTurn((current) => current && current.contextKey === eventContextKey
          ? {
              ...current,
              assistantContent: current.assistantContent + delta,
              providerName: typeof event.payload.providerName === "string" ? event.payload.providerName : current.providerName,
              modelId: typeof event.payload.modelId === "string" ? event.payload.modelId : current.modelId
            }
          : current);
        return;
      }
      if (event.type === "tool-call") {
        setStreamingTurn((current) => current?.scope === "case"
          ? { ...current, activityLabel: "正在读取已启用的只读工具" }
          : current);
        return;
      }
      if (event.type === "tool-decision") {
        const outcome = event.payload.outcome === "allowed" ? "allowed" : "denied";
        setStreamingTurn((current) => current?.scope === "case"
          ? { ...current, activityLabel: outcome === "allowed" ? "只读检查已通过，正在获取结果" : "工具未执行，正在继续处理" }
          : current);
        return;
      }
      if (event.type === "tool-result") {
        setStreamingTurn((current) => current?.scope === "case"
          ? { ...current, activityLabel: event.payload.isError === true ? "工具未返回结果，正在继续处理" : "已取得只读结果，正在整理" }
          : current);
        return;
      }
      if (event.type !== "turn-status") return;
      const status = typeof event.payload.status === "string" ? event.payload.status : "";
      if (status === "running") {
        const run = { requestId: event.requestId, turnId: event.turnId, scope: event.scope };
        activeAgentRunRef.current = run;
        setActiveAgentRun(run);
        if (pendingStopRef.current) {
          pendingStopRef.current = false;
          cancelRequestedRef.current = true;
          void bridge.cancelAgentTurn({ requestId: run.requestId }).then((response) => {
            setNotice(response.ok ? response.data.message : response.error);
          });
        }
        return;
      }
      if (status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted") {
        directStreamRequestIdsRef.current.delete(event.requestId);
        if (activeAgentRunRef.current?.turnId === event.turnId) activeAgentRunRef.current = null;
        setActiveAgentRun((current) => current?.turnId === event.turnId ? null : current);
        setSendingMessage(false);
        finishStreamingTurn();
        void bridge.getState().then((response) => {
          if (response.ok && activeConversationKeyRef.current === eventContextKey) setState(response.data);
        });
      }
    });
  }, [bridge]);

  const project = activeProject(state);
  const currentCase = activeCase(state);
  const currentWorkThread = activeWorkThread(state);
  const activeChat = activeChatThread(state);
  const activeConversationKey = activeView === "chat"
    ? `chat:${activeChat?.id ?? "new"}`
    : `work:${currentWorkThread?.id ?? "new"}`;
  const activeConversationKeyRef = useRef(activeConversationKey);
  activeConversationKeyRef.current = activeConversationKey;

  useEffect(() => {
    if (!bridge) return;
    const scope = activeView === "chat" ? "chat" as const : "work" as const;
    const legacyThreadId = activeView === "chat" ? activeChat?.id : currentWorkThread?.id;
    if (!legacyThreadId) return;
    const contextKey = `${scope}:${legacyThreadId}`;
    let disposed = false;
    let observedActiveTurn = false;
    let polling = false;

    const applySnapshot = async (snapshot: AgentThreadSnapshot | null) => {
      if (disposed || activeConversationKeyRef.current !== contextKey) return;
      const turn = snapshot?.activeTurn;
      if (!turn) {
        if (!observedActiveTurn) return;
        observedActiveTurn = false;
        activeAgentRunRef.current = null;
        setActiveAgentRun(null);
        setSendingMessage(false);
        finishStreamingTurn();
        const refreshed = await bridge.getState();
        if (!disposed && refreshed.ok) setState(refreshed.data);
        return;
      }
      observedActiveTurn = true;
      const turnItems = snapshot.items.filter((item) => item.turnId === turn.id);
      const userContent = turnItems.find((item) => item.type === "user-message")?.payload.content;
      const deltas = turnItems
        .filter((item) => item.type === "assistant-delta")
        .map((item) => typeof item.payload.delta === "string" ? item.payload.delta : "")
        .join("");
      const lastDelta = [...turnItems].reverse().find((item) => item.type === "assistant-delta");
      const run = { requestId: turn.requestId, turnId: turn.id, scope };
      activeAgentRunRef.current = run;
      setActiveAgentRun(run);
      setSendingMessage(true);
      setStreamingTurn((current) => {
        const existingContent = current?.contextKey === contextKey ? current.assistantContent : "";
        const assistantContent = deltas.length >= existingContent.length && deltas.startsWith(existingContent) ? deltas : existingContent;
        return {
          scope: scope === "chat" ? "daily-chat" : "case",
          contextKey,
          userContent: typeof userContent === "string" ? userContent : current?.userContent ?? "正在恢复上次任务",
          assistantContent,
          providerName: typeof lastDelta?.payload.providerName === "string" ? lastDelta.payload.providerName : current?.providerName ?? "模型渠道",
          modelId: typeof lastDelta?.payload.modelId === "string" ? lastDelta.payload.modelId : current?.modelId ?? turn.modelId ?? "恢复中",
          activityLabel: assistantContent ? "正在续接回复" : "正在恢复连接"
        };
      });
    };

    const poll = async () => {
      if (polling || disposed) return;
      polling = true;
      try {
        const response = await bridge.readAgentThread({ scope, legacyThreadId, afterSequence: 0, limit: 500 });
        if (response.ok) await applySnapshot(response.data);
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [bridge, activeView, activeChat?.id, currentWorkThread?.id]);
  const visibleProjects = useMemo(() => {
    return (state?.projects ?? [])
      .filter((item) => item.isVisible !== false)
      .sort((a, b) => a.visibleOrder - b.visibleOrder || a.name.localeCompare(b.name, "zh-CN"));
  }, [state]);

  function canLeaveCurrentCenter(): boolean {
    if (!centerDraftDirty || (activeView !== "config" && activeView !== "standards" && activeView !== "knowledge" && activeView !== "capabilities")) return true;
    return window.confirm("当前页面有未保存内容。离开后这些修改会丢失，确定继续吗？");
  }

  function navigateView(nextView: typeof activeView): void {
    if (nextView === activeView) return;
    if (!canLeaveCurrentCenter()) return;
    setCenterDraftDirty(false);
    setNotice("");
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
  const archivedChatThreads = useMemo(() => (state?.chatThreads ?? []).filter((thread) => thread.status === "archived"), [state?.chatThreads]);
  const removedChatThreads = useMemo(() => (state?.chatThreads ?? []).filter((thread) => thread.status === "removed"), [state?.chatThreads]);
  const archivedWorkThreads = useMemo(() => (state?.workThreads ?? []).filter((thread) => thread.status === "archived"), [state?.workThreads]);
  const removedWorkThreads = useMemo(() => (state?.workThreads ?? []).filter((thread) => thread.status === "removed"), [state?.workThreads]);
  const catalogModelOptions = useMemo(() => enabledCatalogModelOptions(project), [project]);
  const safeDraftOptions = useMemo(() => safeDraftModelOptions(project), [project]);
  const safeDraftOptionSignature = safeDraftOptions.map((option) => option.key).join("|");
  const modelProviderErrors = useMemo(() => providerErrorStates(project), [project]);
  const capabilitySkills = useMemo<CapabilitySkillItem[]>(() => (capabilitySnapshot?.skills ?? []).map((item) => ({
    id: item.id,
    name: item.frontmatter.metadata.title || item.name,
    technicalName: item.name,
    description: item.description,
    source: item.source.label,
    categoryLabel: item.frontmatter.metadata.workstream === "sap-operations"
      ? "SAP 运维"
      : item.frontmatter.metadata.workstream === "sap-operations-compat"
        ? "兼容入口"
        : item.frontmatter.metadata.workstream === "sap-implementation"
          ? "SAP 实施"
          : undefined,
    workflowStage: item.frontmatter.metadata.stage || undefined,
    scope: item.scope.kind === "global" ? "global" : "project",
    scopeLabel: item.scope.kind === "global" ? "全局" : project?.name ?? "当前 Project",
    enabled: item.enabled,
    validationStatus: item.validation.status === "valid" ? "valid" : item.validation.status === "warning" ? "warning" : "invalid",
    validationMessage: item.validation.diagnostics.map((diagnostic) => diagnostic.message).slice(0, 3).join("；") || undefined,
    scriptsStatus: item.scriptStatus === "present-listed-not-executable" ? "present-disabled" : "none",
    resources: item.resources.map((resource) => resource.relativePath),
    updatedAt: item.updatedAt
  })), [capabilitySnapshot?.skills, project?.name]);
  const capabilityPlugins = useMemo<CapabilityPluginItem[]>(() => (capabilitySnapshot?.plugins ?? []).map((item) => {
    const components = [
      item.components.inlineSkills + item.components.skillReferences ? `Skills ${item.components.inlineSkills + item.components.skillReferences}` : "",
      item.components.mcpPresets ? `MCP ${item.components.mcpPresets}` : "",
      item.components.promptFragments ? `提示词 ${item.components.promptFragments}` : "",
      item.components.templates ? `模板 ${item.components.templates}` : ""
    ].filter(Boolean);
    return {
      id: item.id,
      name: item.displayName,
      description: item.description,
      version: item.version,
      source: item.source.label,
      scopeLabel: item.scope.kind === "global" ? "全局" : project?.name ?? "当前 Project",
      includedCapabilities: components,
      enabled: item.enabled,
      validationStatus: item.validation.status,
      lastValidatedAt: item.validation.checkedAt
    };
  }), [capabilitySnapshot?.plugins, project?.name]);
  const capabilityPrompts = useMemo<CapabilityPromptItem[]>(() => {
    if (!capabilitySnapshot) return [];
    const conflicts = new Map(capabilitySnapshot.compiledPrompt.conflicts.map((item) => [item.ref, item.reason]));
    const immutable = capabilitySnapshot.compiledPrompt.layers.filter((item) => item.layer === "product-safety" || item.layer === "product-base").map((item, index) => ({
      id: item.ref,
      name: item.layer === "product-safety" ? `安全规则 ${index + 1}` : "产品基础提示词",
      summary: item.layer === "product-safety" ? "不可被低层提示词覆盖的安全边界" : "定义 SAP AI 顾问工作台的基础工作方式",
      content: item.content,
      layer: item.layer === "product-safety" ? "safety" as const : "product" as const,
      scopeLabel: "全局",
      enabled: true,
      editable: false,
      canToggle: false,
      estimatedTokens: item.tokenEstimate,
      status: "active" as const
    }));
    const target = capabilitySnapshot.target;
    const editableScopes: Array<{ id: string; name: string; summary: string; layer: "personal" | "project" | "case"; scope: PromptProfileScope; scopeLabel: string }> = [
      { id: "profile:personal", name: "个人偏好", summary: "语言、表达和交付格式偏好", layer: "personal", scope: { type: "personal" }, scopeLabel: "个人" }
    ];
    if (target.projectId) editableScopes.push({ id: "profile:project", name: "Project 指令", summary: "当前 Project 的业务约定和术语", layer: "project", scope: { type: "project", projectId: target.projectId }, scopeLabel: project?.name ?? "当前 Project" });
    if (target.projectId && target.caseId) editableScopes.push({ id: "profile:case", name: "Case 指令", summary: "当前任务的目标、边界和验收标准", layer: "case", scope: { type: "case", projectId: target.projectId, caseId: target.caseId }, scopeLabel: currentCase?.title ?? "当前 Case" });
    const editable = editableScopes.map((item) => {
      const profile = capabilitySnapshot.promptProfiles.find((candidate) => samePromptScope(candidate.scope, item.scope));
      const profileRef = profile ? `prompt-profile:${profile.id}:v${profile.version}` : undefined;
      const compiledLayer = profileRef ? capabilitySnapshot.compiledPrompt.layers.find((layer) => layer.ref === profileRef) : undefined;
      const conflict = profileRef ? conflicts.get(profileRef) : undefined;
      return {
        id: item.id,
        name: item.name,
        summary: item.summary,
        content: profile?.content ?? "",
        layer: item.layer,
        scopeLabel: item.scopeLabel,
        enabled: profile?.enabled ?? false,
        editable: true,
        canToggle: Boolean(profile),
        estimatedTokens: compiledLayer?.tokenEstimate ?? 0,
        status: conflict ? "conflict" as const : "active" as const,
        statusMessage: conflict,
        updatedAt: profile?.updatedAt
      };
    });
    return [...immutable, ...editable];
  }, [capabilitySnapshot, currentCase?.title, project?.name]);
  const capabilityMemories = useMemo<CapabilityMemoryItem[]>(() => (capabilitySnapshot?.memories ?? []).map((item) => {
    const expired = Boolean(item.validUntil && item.validUntil <= new Date().toISOString());
    const status = expired ? "expired" : item.hasConflict ? "conflict" : item.status === "candidate" ? "candidate" : item.status === "confirmed" ? "confirmed" : "disabled";
    const typeLabels = { preference: "偏好", fact: "事实", constraint: "约束", decision: "决策" } as const;
    const sourceLabels = { user: "用户输入", thread: "对话", "case-file": "案件文件", "published-knowledge": "已发布知识", "sap-evidence": "SAP 只读证据", runtime: "运行时" } as const;
    const scope = item.scope.type === "personal" ? "personal" : item.scope.type === "project" ? "project" : "case";
    const compact = item.content.replace(/\s+/g, " ").trim();
    return {
      id: item.id,
      summary: compact.length > 52 ? `${compact.slice(0, 52)}...` : compact,
      content: item.content,
      typeLabel: typeLabels[item.kind],
      scope,
      scopeLabel: item.scope.type === "personal" ? "个人" : item.scope.type === "project" ? project?.name : currentCase?.title,
      status,
      enabled: status === "confirmed",
      editable: status === "candidate",
      sourceLabel: sourceLabels[item.provenance.sourceType],
      sourceDetail: item.provenance.sourceRef,
      updatedAt: item.updatedAt,
      validUntil: item.validUntil ?? undefined
    };
  }), [capabilitySnapshot?.memories, currentCase?.title, project?.name]);
  const capabilityMcpConnections = useMemo<CapabilityMcpConnection[]>(() => (capabilitySnapshot?.mcpConnections ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description || "未填写说明",
    transport: item.transport === "stdio" ? "STDIO" : "Streamable HTTP",
    scopeLabel: item.scope.type === "global" ? "全局" : project?.name ?? "当前 Project",
    enabled: item.enabled,
    status: item.state === "connecting" ? "checking" : item.state,
    capabilityCount: item.capabilityCount,
    lastCheckedAt: item.lastTestedAt ?? undefined,
    statusMessage: item.statusMessage,
    tools: item.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSummary: tool.inputSummary,
      risk: tool.risk,
      reportedReadOnlyHint: tool.reportedReadOnlyHint,
      enabled: tool.enabled,
      userApprovedReadOnly: tool.userApprovedReadOnly,
      canApproveReadOnly: tool.canApproveReadOnly,
      policyLabel: tool.policyLabel
    }))
  })), [capabilitySnapshot?.mcpConnections, project?.name]);
  const selectedSafeDraftModel = useMemo(() => {
    return safeDraftOptions.find((option) => option.key === selectedModelKey) ?? safeDraftOptions[0] ?? null;
  }, [safeDraftOptions, selectedModelKey]);
  const verifiedAdtConnections = useMemo(() => (project?.config.adtConnections ?? []).filter((connection) => (
    connection.readOnly === true &&
    connection.connectionStatus === "verified" &&
    connection.minimalReadStatus === "verified" &&
    connection.lastVerificationMode === "adt"
  )), [project]);
  const sapRoutingContext = useMemo(() => [
    ...(currentWorkThread?.messages ?? []).slice(-12).map((item) => item.content),
    message
  ].join("\n").slice(-6000), [currentWorkThread?.messages, message]);
  const sapRouteDecision = useMemo(() => routeSapConnections(
    project?.config.adtConnections ?? [],
    sapRoutingContext,
    project?.config.activeAdtConnectionId ?? ""
  ), [project, sapRoutingContext]);
  const adtReady = verifiedAdtConnections.length > 0;
  const sapReadonlyEnabled = project?.config.agentTools.sapReadonlyEnabled === true;
  const adtEvidenceStatus = project && !isSapBoundProject(project)
    ? "其他工作 · 不读取 SAP"
    : project?.config.adt
    ? adtReady
      ? sapRouteDecision.reason
      : "当前 Project 还没有通过真实 T000 只读验证的 SAP 连接"
    : "未选择客户项目";
  const codexAssistAvailable = Boolean(
    project?.config.codex.integrationType === "cli" &&
    project.config.codex.cliStatus === "verified" &&
    project.config.codex.loginStatus === "verified"
  );
  const codexAssistTitle = codexAssistAvailable
    ? "开启后，本次发送会让 Codex 生成一份工程辅助分析并保存到当前案件文件"
    : "Codex CLI 尚未完成安装与登录检查；工程试跑状态不会影响核心 AI 对话";
  const selectedCaseAction = caseActions.find((item) => item.id === selectedCaseActionId) ?? caseActions[0];
  const currentPermissionMode = permissionModes.find((item) => item.id === actionPermissionMode) ?? permissionModes[0];
  const flatFiles = useMemo(() => flattenFiles(state?.activeCaseFiles ?? []), [state]);
  const filteredCaseFiles = useMemo(() => filterFileNodes(state?.activeCaseFiles ?? [], fileSearchQuery), [state, fileSearchQuery]);
  const filteredFileCount = useMemo(() => flattenFiles(filteredCaseFiles).filter((node) => node.kind === "file").length, [filteredCaseFiles]);
  const fileCount = useMemo(() => flatFiles.filter((node) => node.kind === "file").length, [flatFiles]);
  const outputFileCount = useMemo(() => flatFiles.filter((node) => node.kind === "file" && node.relativePath.startsWith("outputs/")).length, [flatFiles]);
  const selectedPreviewNode = useMemo(() => selectedPreviewPath ? flatFiles.find((node) => node.relativePath === selectedPreviewPath) ?? null : null, [flatFiles, selectedPreviewPath]);

  useEffect(() => {
    const rememberedKey = modelSelectionsRef.current.get(activeConversationKey) ?? "";
    const priorModelKey = activeView === "chat"
      ? (() => {
          const lastModelReply = [...(activeChat?.messages ?? [])].reverse().find((item) => item.role === "assistant" && item.responseMode === "model-success");
          return lastModelReply?.providerId ? modelOptionKey(lastModelReply.providerId, lastModelReply.modelId) : "";
        })()
      : (() => {
          const lastModelReply = [...(currentWorkThread?.messages ?? [])].reverse().find((item) => item.role === "assistant" && item.modelId !== "local-workflow");
          if (!lastModelReply) return "";
          return lastModelReply.providerId
            ? modelOptionKey(lastModelReply.providerId, lastModelReply.modelId)
            : safeDraftOptions.find((option) => option.model.id === lastModelReply.modelId)?.key ?? "";
        })();
    const preferredKey = safeDraftOptions.some((option) => option.key === rememberedKey) ? rememberedKey : priorModelKey;
    setSelectedModelKey(safeDraftOptions.some((option) => option.key === preferredKey)
      ? preferredKey
      : safeDraftOptions[0]?.key ?? "");
  }, [activeConversationKey, safeDraftOptionSignature]);

  function selectComposerModel(key: string) {
    modelSelectionsRef.current.set(activeConversationKey, key);
    setSelectedModelKey(key);
  }

  useEffect(() => {
    setSapConnectionMode("auto");
    setManualSapConnectionIds([]);
  }, [project?.id]);

  useEffect(() => {
    const validIds = new Set(verifiedAdtConnections.map((connection) => connection.id));
    setManualSapConnectionIds((ids) => ids.filter((id) => validIds.has(id)));
  }, [verifiedAdtConnections.map((connection) => connection.id).join("|")]);

  useEffect(() => {
    if (!codexAssistAvailable && codexAssistEnabled) {
      setCodexAssistEnabled(false);
    }
  }, [codexAssistAvailable, codexAssistEnabled]);

  useEffect(() => {
    const lastPermission = [...(currentWorkThread?.messages ?? [])]
      .reverse()
      .find((item) => item.permissionModeUsed)?.permissionModeUsed;
    setActionPermissionMode(lastPermission ?? "request_approval");
  }, [currentWorkThread?.id]);

  useEffect(() => {
    const contextKey = activeView === "chat"
      ? `chat:${activeChat?.id ?? ""}`
      : `work:${currentWorkThread?.id ?? ""}`;
    if (workflowContextRef.current && workflowContextRef.current !== contextKey) {
      messageDraftsRef.current.set(workflowContextRef.current, message);
      setMessage(messageDraftsRef.current.get(contextKey) ?? "");
      setCaseActionConfirmationVisible(false);
      setSapEvidencePanelOpen(false);
      setSapEvidenceName("");
      setSapEvidenceFunctionGroup("");
      setCodexAssistEnabled(false);
    }
    workflowContextRef.current = contextKey;
  }, [activeView, activeChat?.id, currentWorkThread?.id]);

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
    const collapseContextPanel = () => {
      if (window.innerWidth <= 1180) setFilesPanelVisible(false);
    };
    window.addEventListener("resize", collapseContextPanel);
    return () => window.removeEventListener("resize", collapseContextPanel);
  }, []);

  async function applyCaseWorkflowResponse<T extends WorkbenchState>(
    responsePromise: Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    target: { projectId: string; caseId: string; threadId: string; caseTitle: string }
  ): Promise<"active" | "background" | null> {
    const response = await responsePromise;
    if (response.ok) {
      setState(response.data);
      const targetStillActive = response.data.activeWorkThreadId === target.threadId;
      const completedThread = response.data.workThreads.find((item) => item.id === target.threadId);
      const reply = [...(completedThread?.messages ?? [])].reverse().find((item) => item.role === "assistant");
      const fallbackModel = selectedSafeDraftModel && reply && reply.modelId !== selectedSafeDraftModel.model.id && reply.modelId !== "local-workflow"
        ? reply.modelId
        : null;
      if (targetStillActive) {
        setNotice(fallbackModel
          ? `所选模型暂时不可用，已自动改用同渠道已验证模型 ${fallbackModel}；当前运维项目文件已更新。`
          : "当前运维项目文件及本地输出已更新。");
        return "active";
      }
      setNotice(`请求已完成，结果只写入发送时的对话线程及运维项目「${target.caseTitle}」。`);
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
    if (!bridge || activeView !== "capabilities") return;
    let active = true;
    bridge.getCapabilityCenterSnapshot().then((response) => {
      if (!active) return;
      if (response.ok) setCapabilitySnapshot(response.data);
      else setNotice(response.error);
    });
    return () => { active = false; };
  }, [activeView, bridge, state?.activeProjectId, state?.activeCaseId]);

  async function applyCapabilityMutation(promise: Promise<{ ok: true; data: CapabilityCenterSnapshot } | { ok: false; error: string }>): Promise<void> {
    const result = await promise;
    if (!result.ok) throw new Error(result.error);
    setCapabilitySnapshot(result.data);
  }

  function capabilityPromptScope(id: string): PromptProfileScope {
    const target = capabilitySnapshot?.target;
    if (id === "profile:personal") return { type: "personal" };
    if (id === "profile:project" && target?.projectId) return { type: "project", projectId: target.projectId };
    if (id === "profile:case" && target?.projectId && target.caseId) return { type: "case", projectId: target.projectId, caseId: target.caseId };
    throw new Error("当前提示词范围已经变化，请重新打开能力中心。");
  }

  function capabilityMemoryScope(memoryId: string): PromptProfileScope {
    const memory = capabilitySnapshot?.memories.find((item) => item.id === memoryId);
    if (!memory) throw new Error("记忆已不存在，请刷新后重试。");
    return memory.scope;
  }

  function capabilityNewMemoryScope(scope: CapabilityMemoryDraft["scope"]): PromptProfileScope {
    const target = capabilitySnapshot?.target;
    if (scope === "personal") return { type: "personal" };
    if (scope === "project" && target?.projectId) return { type: "project", projectId: target.projectId };
    if (scope === "case" && target?.projectId && target.caseId) return { type: "case", projectId: target.projectId, caseId: target.caseId };
    throw new Error("当前记忆范围已经变化，请重新打开能力中心。");
  }

  async function importCapabilityPlugin(): Promise<void> {
    if (!bridge) throw new Error("请在桌面应用中导入 Plugin。");
    const projectId = capabilitySnapshot?.target.projectId;
    await applyCapabilityMutation(bridge.importCapabilityPlugin({ scope: projectId ? { kind: "project", projectId } : { kind: "global" } }));
  }

  async function importCapabilitySkill(): Promise<void> {
    if (!bridge) throw new Error("请在桌面应用中导入 Skill。");
    const projectId = capabilitySnapshot?.target.projectId;
    await applyCapabilityMutation(bridge.importCapabilitySkill({ scope: projectId ? { kind: "project", projectId } : { kind: "global" } }));
  }

  async function discoverCapabilitySkills(): Promise<CapabilitySkillDiscoveryReport> {
    if (!bridge) throw new Error("请在桌面应用中扫描 Skills。");
    const projectId = capabilitySnapshot?.target.projectId;
    const result = await bridge.discoverCapabilitySkills({ scope: projectId ? { kind: "project", projectId } : { kind: "global" } });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  async function importDiscoveredCapabilitySkills(report: CapabilitySkillDiscoveryReport, skillIds: string[]): Promise<void> {
    if (!bridge) throw new Error("请在桌面应用中导入 Skills。");
    const projectId = capabilitySnapshot?.target.projectId;
    await applyCapabilityMutation(bridge.importDiscoveredCapabilitySkills({
      sessionId: report.sessionId,
      skillIds,
      scope: projectId ? { kind: "project", projectId } : { kind: "global" }
    }));
  }

  async function addCapabilityMcp(draft: CapabilityMcpDraft): Promise<void> {
    if (!bridge) throw new Error("请在桌面应用中添加 MCP 连接。");
    const projectId = capabilitySnapshot?.target.projectId;
    const scope = draft.scope === "project" && projectId ? { type: "project" as const, projectId } : { type: "global" as const };
    const input = {
      name: draft.name,
      description: draft.description,
      scope,
      transport: { type: "streamable-http" as const, endpoint: draft.endpoint.trim(), headerRefs: {} }
    };
    await applyCapabilityMutation(bridge.saveCapabilityMcp(input));
  }

  useEffect(() => {
    if (!createPanel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setCreatePanel(null);
      setCreateTaskError("");
      if (createPanel === "case") window.setTimeout(() => newTaskButtonRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createPanel]);

  useEffect(() => {
    if (!bridge || !searchQuery.trim()) {
      searchRequestRef.current += 1;
      setSearchResults([]);
      return;
    }

    const requestId = ++searchRequestRef.current;
    const timeout = window.setTimeout(() => {
      bridge.search(searchQuery).then((response) => {
        if (requestId !== searchRequestRef.current) return;
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
      setActiveView(newProjectSapVersion === "UNKNOWN" ? "case" : "config");
      setNewCaseProjectId(response.data.activeProjectId);
      setNewProjectName("");
      setNewProjectSystemLabel("Local");
      setCreatePanel(null);
      setNotice(newProjectSapVersion === "UNKNOWN"
        ? "客户项目已创建，可继续新建运维项目；这里不会读取 SAP。"
        : "客户项目已创建。请先登记该客户的 DEV、QAS、PRD 等 SAP 只读连接，再新建运维项目。");
    } else {
      setNotice(response.error);
    }
  }

  async function createCase() {
    if (creatingCase) return;
    if (!bridge) {
      setCreateTaskError("请在桌面应用中创建任务。");
      return;
    }
    if (visibleProjects.length === 0) {
      setCreateTaskError("请先创建或选择一个客户项目，再新建运维项目。");
      return;
    }
    const targetProject = visibleProjects.find((item) => item.id === newCaseProjectId);
    if (!targetProject) {
      setCreateTaskError("请先选择新运维项目所属的客户项目。");
      return;
    }
    const title = newCaseTitle.trim();
    if (!title) {
      setCreateTaskError("请输入任务名称。");
      newCaseInputRef.current?.focus();
      return;
    }
    setCreatingCase(true);
    setCreateTaskError("");
    try {
      if (newTaskFolderMode === "existing" && !newTaskFolderSelectionToken) {
        setCreateTaskError("请先从电脑中选择一个已有文件夹。");
        return;
      }
      const response = await bridge.createWorkThread({
        projectId: targetProject.id,
        title: "新对话",
        folderMode: newTaskFolderMode,
        folderName: newTaskFolderMode === "new" ? (newTaskFolderName.trim() || title) : title,
        folderSelectionToken: newTaskFolderMode === "existing" ? newTaskFolderSelectionToken : undefined
      });
      if (response.ok) {
        setState(response.data);
        setActiveView("case");
        setNewCaseProjectId(targetProject.id);
        setNewCaseTitle("");
        setNewTaskFolderName("");
        setNewTaskFolderSelectionToken("");
        setNewTaskSelectedFolderName("");
        setCreatePanel(null);
        setNotice(newTaskFolderMode === "new"
          ? "运维项目已创建，并已打开第一个新对话。"
          : "运维项目已绑定电脑文件夹，并已打开第一个新对话；原目录不会被自动批量读取或改写。");
      } else {
        setCreateTaskError(response.error);
        setNotice(response.error);
      }
    } finally {
      setCreatingCase(false);
    }
  }

  async function createConversationThread(projectId: string, caseId: string) {
    if (!bridge || sendingMessage) return;
    const response = await bridge.createWorkThread({
      projectId,
      caseId,
      title: "新对话",
      folderMode: "existing"
    });
    if (response.ok) {
      setState(response.data);
      setActiveView("case");
      setNotice("新对话已创建。发送第一条消息后会自动生成标题。");
      window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
    } else {
      setNotice(response.error);
    }
  }

  async function selectExistingTaskFolder() {
    if (!bridge || selectingTaskFolder) return;
    const targetProject = visibleProjects.find((item) => item.id === newCaseProjectId);
    if (!targetProject) {
      setCreateTaskError("请先选择任务所属 Project。");
      return;
    }
    setSelectingTaskFolder(true);
    setCreateTaskError("");
    try {
      const response = await bridge.selectLocalTaskFolder({ projectId: targetProject.id });
      if (!response.ok) {
        setCreateTaskError(response.error);
        return;
      }
      if (response.data.cancelled) return;
      const selectedFolderName = response.data.folderName;
      setNewTaskFolderSelectionToken(response.data.selectionToken);
      setNewTaskSelectedFolderName(selectedFolderName);
      setNewCaseTitle((currentTitle) => currentTitle.trim() ? currentTitle : selectedFolderName);
    } finally {
      setSelectingTaskFolder(false);
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

  async function switchWorkTask(threadId: string) {
    if (!canLeaveCurrentCenter()) return;
    if (!bridge) {
      setNotice("请在桌面应用中切换任务。");
      return;
    }
    const response = await bridge.switchWorkThread({ threadId });
    if (response.ok) {
      setState(response.data);
      setActiveView("case");
      setSelectedPreviewPath(null);
      setFilePreview(null);
      setFilePreviewError(null);
      setNotice("");
    } else {
      setNotice(response.error);
    }
  }

  async function updateThreadStatus(scope: "work" | "chat", threadId: string, status: ConversationThreadStatus) {
    if (!bridge) {
      setNotice("请在桌面应用中管理会话。");
      return;
    }
    const response = await bridge.updateConversationThreadStatus({ scope, threadId, status });
    if (response.ok) {
      setState(response.data);
      if (scope === "work") setActiveView("case");
      else setActiveView("chat");
      setNotice(status === "active" ? "会话已恢复。" : status === "archived" ? "会话已归档，可随时恢复。" : "会话已从常用列表移除，本地记录仍然保留。");
    } else {
      setNotice(response.error);
    }
  }

  async function restoreAndOpenThread(scope: "work" | "chat", threadId: string) {
    if (!bridge) return;
    const response = await bridge.updateConversationThreadStatus({ scope, threadId, status: "active" });
    if (!response.ok) {
      setNotice(response.error);
      return;
    }
    setState(response.data);
    if (scope === "work") await switchWorkTask(threadId);
    else await switchDailyChat(threadId);
  }

  async function copyThreadId(threadId: string) {
    try {
      await navigator.clipboard.writeText(threadId);
      setNotice(`会话 ID 已复制：${threadId}`);
    } catch {
      setNotice(`会话 ID：${threadId}`);
    }
  }

  async function openSearchResult(result: SearchResult) {
    if (!bridge) {
      setNotice("请在桌面应用中打开本地搜索结果。");
      return;
    }
    if (result.type === "chat-thread" && result.threadId) {
      const thread = state?.chatThreads.find((item) => item.id === result.threadId);
      if (thread && thread.status !== "active") {
        setNotice("该日常对话已归档或移除，请在左侧“会话管理”中明确恢复后再打开。");
        return;
      }
      await switchDailyChat(result.threadId);
      setSearchQuery("");
      setSearchResults([]);
      return;
    }
    if (result.type === "work-thread" && result.threadId) {
      const thread = state?.workThreads.find((item) => item.id === result.threadId);
      if (thread && thread.status !== "active") {
        setNotice("该任务已归档或移除，请在左侧“任务管理”中明确恢复后再打开。");
        return;
      }
      await switchWorkTask(result.threadId);
      setSearchQuery("");
      setSearchResults([]);
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

  function focusNewCaseInput(projectId = project?.id) {
    setActiveView("case");
    setCreatePanel("case");
    setCreateTaskError("");
    if (projectId) setNewCaseProjectId(projectId);
    if (!projectId) {
      setNotice("请先创建或选择一个客户项目，再新建运维项目。");
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
      setNotice("请在桌面应用中切换运维项目。");
      return;
    }
    const response = await bridge.switchCase({ projectId, caseId });
    if (response.ok) {
      setState(response.data);
      setActiveView("case");
      setSelectedPreviewPath(null);
      setFilePreview(null);
      setFilePreviewError(null);
      setNotice("运维项目已切换，右侧文件面板正在读取其共享文件夹。");
    } else {
      setNotice(response.error);
    }
  }

  function scrollConversationToLatest(force = false) {
    if (force) followLatestRef.current = true;
    if (!force && !followLatestRef.current) return;
    window.requestAnimationFrame(() => {
      if (!force && !followLatestRef.current) return;
      const flow = conversationFlowRef.current;
      if (!flow) return;
      flow.scrollTop = flow.scrollHeight;
      setShowScrollToLatest(false);
    });
  }

  function handleConversationScroll() {
    const flow = conversationFlowRef.current;
    if (!flow) return;
    const nearBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight < 96;
    followLatestRef.current = nearBottom;
    setShowScrollToLatest(!nearBottom);
  }

  function finishStreamingTurn() {
    if (streamFrameRef.current !== null) window.cancelAnimationFrame(streamFrameRef.current);
    streamFrameRef.current = null;
    pendingStreamRef.current = null;
    setStreamingTurn(null);
  }

  function restoreSubmittedMessage(contextKey: string, content: string) {
    messageDraftsRef.current.set(contextKey, content);
    if (activeConversationKeyRef.current !== contextKey) return;
    setMessage((current) => {
      const restored = current || content;
      messageDraftsRef.current.set(contextKey, restored);
      return restored;
    });
  }

  function receiveStreamEvent(event: AiConversationStreamEvent, expectedContextKey: string) {
    if (event.phase === "completed") {
      directStreamRequestIdsRef.current.delete(event.requestId);
      return;
    }
    directStreamRequestIdsRef.current.add(event.requestId);
    if (event.phase !== "delta" || !event.delta) return;
    const pending = pendingStreamRef.current;
    pendingStreamRef.current = pending && pending.scope === event.scope && pending.contextKey === expectedContextKey
      ? {
          ...pending,
          delta: pending.delta + event.delta,
          providerName: event.providerName ?? pending.providerName,
          modelId: event.modelId ?? pending.modelId
        }
      : {
          scope: event.scope,
          contextKey: expectedContextKey,
          delta: event.delta,
          providerName: event.providerName,
          modelId: event.modelId
        };
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = window.requestAnimationFrame(() => {
      streamFrameRef.current = null;
      const update = pendingStreamRef.current;
      pendingStreamRef.current = null;
      if (!update) return;
      setStreamingTurn((current) => current && current.scope === update.scope && current.contextKey === expectedContextKey && update.contextKey === expectedContextKey
        ? {
            ...current,
            assistantContent: current.assistantContent + update.delta,
            providerName: update.providerName ?? current.providerName,
            modelId: update.modelId ?? current.modelId
          }
        : current);
    });
  }

  useEffect(() => {
    followLatestRef.current = true;
    setShowScrollToLatest(false);
    scrollConversationToLatest(true);
  }, [activeConversationKey]);

  useEffect(() => {
    scrollConversationToLatest();
  }, [activeChat?.messages.length, currentWorkThread?.messages.length, streamingTurn?.assistantContent.length, streamingTurn?.contextKey]);

  useEffect(() => () => {
    if (streamFrameRef.current !== null) window.cancelAnimationFrame(streamFrameRef.current);
  }, []);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 36), 180)}px`;
  }, [message, activeConversationKey]);

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function stopCurrentTurn() {
    if (!bridge) return;
    const run = activeAgentRunRef.current ?? activeAgentRun;
    if (!run) {
      if (!sendingMessage) {
        setNotice("当前没有正在运行的任务。");
        return;
      }
      pendingStopRef.current = true;
      cancelRequestedRef.current = true;
      setNotice("已收到停止请求，任务启动后会立即停止。");
      return;
    }
    cancelRequestedRef.current = true;
    const response = await bridge.cancelAgentTurn({ requestId: run.requestId });
    setNotice(response.ok ? response.data.message : response.error);
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
    if (activeView !== "chat" && (!project || !currentCase || !currentWorkThread)) {
      setNotice("请先选择一个对话线程及其运维项目。");
      return;
    }
    const submittedMessage = message;
    const submittedContextKey = activeConversationKey;
    setMessage("");
    messageDraftsRef.current.set(submittedContextKey, "");
    followLatestRef.current = true;
    setShowScrollToLatest(false);
    cancelRequestedRef.current = false;
    pendingStopRef.current = false;
    setSendingMessage(true);
    try {
      if (activeView === "chat") {
        const streamContextKey = `chat:${activeChat?.id ?? "new"}`;
        const chatInput: AppendDailyChatMessageInput = {
          threadId: activeChat?.id,
          content: submittedMessage,
          projectId: selectedSafeDraftModel ? project?.id : undefined,
          providerId: selectedSafeDraftModel?.provider.id,
          modelId: selectedSafeDraftModel?.model.id ?? "local-chat"
        };
        setStreamingTurn({
          scope: "daily-chat",
          contextKey: streamContextKey,
          userContent: submittedMessage,
          assistantContent: "",
          providerName: selectedSafeDraftModel?.provider.name ?? "本地工作台",
          modelId: selectedSafeDraftModel?.model.id ?? "本地记录"
        });
        scrollConversationToLatest(true);
        const response = selectedSafeDraftModel
          ? await bridge.appendDailyChatMessageStreaming(chatInput, (event) => receiveStreamEvent(event, streamContextKey))
          : await bridge.appendDailyChatMessage(chatInput);
        if (response.ok) {
          setState(response.data);
          const thread = response.data.chatThreads.find((item) => item.id === response.data.activeChatThreadId);
          const reply = thread?.messages[thread.messages.length - 1];
          const usedFallbackModel = reply?.responseMode === "model-success" && selectedSafeDraftModel && reply.modelId !== selectedSafeDraftModel.model.id;
          setNotice(reply?.responseMode === "model-success"
            ? usedFallbackModel
              ? `所选模型暂时不可用，已自动改用同渠道已验证模型 ${reply.modelId}；回复已保存为独立对话。`
              : `模型回复已保存为独立对话；渠道来自 ${reply.providerName ?? "当前 Project"}，内容未写入案件。`
            : reply?.responseMode === "model-failed"
              ? "模型调用失败；问题和失败原因已保存为本地日常对话记录。"
              : "日常对话已保存为本地记录；未写入 Project 或案件文件。");
        } else {
          setNotice(response.error);
          restoreSubmittedMessage(submittedContextKey, submittedMessage);
        }
        return;
      }
      if (!project || !currentCase || !currentWorkThread) return;
      const target = { projectId: project.id, caseId: currentCase.id, threadId: currentWorkThread.id, caseTitle: currentCase.title };
      const streamContextKey = `work:${target.threadId}`;
      const caseInput: CaseWorkflowInput = {
        projectId: target.projectId,
        caseId: target.caseId,
        threadId: target.threadId,
        content: submittedMessage,
        taskMode: "problem-analysis",
        modelId: selectedSafeDraftModel?.model.id ?? "local-workflow",
        actionId: null,
        permissionMode: actionPermissionMode,
        providerId: selectedSafeDraftModel?.provider.id,
        codexAssistEnabled: false
      };
      setStreamingTurn({
        scope: "case",
        contextKey: streamContextKey,
        userContent: submittedMessage,
        assistantContent: "",
        providerName: selectedSafeDraftModel?.provider.name ?? "本地工作台",
        modelId: selectedSafeDraftModel?.model.id ?? "本地处理"
      });
      scrollConversationToLatest(true);
      const sent = await applyCaseWorkflowResponse(
        selectedSafeDraftModel
          ? bridge.appendMessageStreaming(caseInput, (event) => receiveStreamEvent(event, streamContextKey))
          : bridge.appendMessage(caseInput),
        target
      );
      if (!sent) {
        restoreSubmittedMessage(submittedContextKey, submittedMessage);
        return;
      }
    } catch {
      restoreSubmittedMessage(submittedContextKey, submittedMessage);
      if (cancelRequestedRef.current) {
        setNotice("本次任务已停止，原消息已恢复到输入框；已经完成的只读记录继续保留。");
      } else {
        setNotice("发送失败：桌面通信暂时中断，原消息已恢复，请稍后重试。");
      }
    } finally {
      pendingStopRef.current = false;
      finishStreamingTurn();
      setSendingMessage(false);
    }
  }

  async function runCaseAction() {
    if (sendingMessage) return;
    if (!bridge) {
      setNotice("浏览器预览不会执行案件动作；请用桌面应用操作。");
      return;
    }
    if (!project || !currentCase || !currentWorkThread) {
      setNotice("请先选择一个对话线程及其运维项目。");
      return;
    }
    const target = { projectId: project.id, caseId: currentCase.id, threadId: currentWorkThread.id, caseTitle: currentCase.title };
    const streamContextKey = `work:${target.threadId}`;
    cancelRequestedRef.current = false;
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
      const actionInput: CaseWorkflowInput = {
        projectId: target.projectId,
        caseId: target.caseId,
        threadId: target.threadId,
        content,
        taskMode: selectedCaseAction.taskMode,
        modelId: selectedSafeDraftModel?.model.id ?? "local-workflow",
        actionId: selectedCaseAction.id,
        permissionMode: actionPermissionMode,
        providerId: selectedSafeDraftModel?.provider.id,
        codexAssistEnabled: codexAssistEnabled && codexAssistAvailable
      };
      if (selectedSafeDraftModel) {
        setStreamingTurn({
          scope: "case",
          contextKey: streamContextKey,
          userContent: message.trim() || `生成${selectedCaseAction.label}`,
          assistantContent: "",
          providerName: selectedSafeDraftModel.provider.name,
          modelId: selectedSafeDraftModel.model.id
        });
      }
      const sent = await applyCaseWorkflowResponse(
        selectedSafeDraftModel
          ? bridge.appendMessageStreaming(actionInput, (event) => receiveStreamEvent(event, streamContextKey))
          : bridge.appendMessage(actionInput),
        target
      );
      setStreamingTurn(null);
      if (!sent) return;
      if (sent === "active") {
        setMessage("");
        setCaseActionConfirmationVisible(false);
        setCodexAssistEnabled(false);
        setNotice(`已执行「${selectedCaseAction.label}」，结果已保存到当前运维项目文件夹。`);
      }
    } catch {
      setNotice(`「${selectedCaseAction.label}」执行失败，输入内容仍保留，请稍后重试。`);
    } finally {
      setStreamingTurn(null);
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
      setNotice("未绑定 SAP 的客户项目不提供 SAP 只读取证；请先切换到已配置 SAP landscape 的客户项目。");
      return;
    }
    if (!sapReadonlyEnabled) {
      setNotice("SAP 只读功能尚未启用。请到配置中心 → AI 工具，启用并保存“SAP ADT 只读对象证据”。");
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
      let connectionMode: "auto" | "manual" = sapConnectionMode;
      let connectionIds = sapConnectionMode === "manual" ? manualSapConnectionIds : sapRouteDecision.connectionIds;
      if (connectionMode === "manual" && connectionIds.length === 0) {
        setNotice("请先选择至少一个已通过真实只读验证的 SAP 连接。");
        return;
      }
      if (connectionMode === "auto" && sapRouteDecision.needsConfirmation) {
        const labels = verifiedAdtConnections
          .filter((connection) => connectionIds.includes(connection.id))
          .map(sapConnectionLabel);
        const confirmed = window.confirm(`${sapRouteDecision.reason}\n\n本次将读取：${labels.join("、")}。\n\n确认继续只读取证吗？`);
        if (!confirmed) {
          setNotice("已取消 SAP 只读取证，没有访问任何 SAP 系统。");
          return;
        }
        connectionMode = "manual";
      }
      const response = await bridge.readSapObjectEvidence({
        objectType: sapEvidenceType,
        objectName,
        ...(functionGroup ? { functionGroup } : {}),
        connectionMode,
        connectionIds,
        queryContext: sapRoutingContext
      });
      if (response.ok) {
        setState(response.data.state);
        setSapEvidenceName("");
        setSapEvidenceFunctionGroup("");
        setNotice(`已从 ${response.data.summaries.length} 个 SAP 登录连接补充只读证据：${response.data.summary.objectType} ${response.data.summary.objectName}；新文件可在右侧运维项目文件面板查看。`);
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

  async function importCaseAttachments() {
    if (!bridge || !project || !currentCase || !currentWorkThread) {
      setNotice("请先选择一个有效的运维项目及其对话线程。");
      return;
    }
    setAttachmentImportBusy(true);
    try {
      const response = await bridge.importCaseAttachments({ projectId: project.id, caseId: currentCase.id, threadId: currentWorkThread.id });
      if (!response.ok) {
        setNotice(response.error);
        return;
      }
      if (response.data.state) setState(response.data.state);
      setNotice(response.data.message);
    } finally {
      setAttachmentImportBusy(false);
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

  async function discoverSapGuiConnections(): Promise<SapGuiDiscoveryReport | null> {
    if (!bridge) {
      setNotice("请在桌面应用中扫描本机 SAP Logon 配置。");
      return null;
    }
    const response = await bridge.discoverSapGuiConnections();
    if (response.ok) {
      setNotice(response.data.entries.length > 0
        ? `已从本机 SAP Logon 识别 ${response.data.entries.length} 个系统连接定义；导入前不会修改 Project。`
        : "没有发现可导入的 SAP Logon 连接；可以手工填写 SID、实例号和应用服务器。");
      return response.data;
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
      setNotice("已从当前运维项目解除知识引用；正式知识本身仍完整保留。");
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
          <strong>{activeView === "chat" ? readableHistoricalText(activeChat?.title ?? "日常对话", "历史对话（编码异常）") : project?.name ?? "未选择项目"}</strong>
          {activeView !== "chat" ? <><span>/</span><em>{activeView === "case" ? currentCase?.isPlaceholder ? "尚无运维项目" : currentCase?.title ?? "当前运维项目" : activeView === "config" ? "配置中心" : activeView === "standards" ? "规范中心" : activeView === "knowledge" ? "知识库" : "能力中心"}</em></> : null}
        </div>
        <div className="topbar-status">
          <ShieldCheck size={15} />
          <span>本地模式</span>
        </div>
      </header>

      <section className={`workspace ${filesPanelVisible && activeView !== "chat" && !currentCase?.isPlaceholder ? "" : "files-collapsed"}`}>
        <aside className="sidebar">
          <div className="workspace-switch" role="tablist" aria-label="主工作模式">
            <button
              type="button"
              className={activeView === "chat" ? "" : "active"}
              onClick={() => navigateView("case")}
              title="正式工作必须绑定运维项目文件夹"
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
                <button className="active" onClick={() => void createDailyChat()} title="创建一个不关联客户项目、运维项目或 SAP 的日常 AI 对话"><MessageSquare size={18} />新对话</button>
              </>
            ) : (
              <>
                <button ref={newTaskButtonRef} className="new-work-project-nav" onClick={() => focusNewCaseInput()} title={project ? "在当前客户项目下新建运维项目" : "请先创建或选择客户项目"}><FolderPlus size={18} />新建运维项目</button>
                <button className={activeView === "config" ? "active" : ""} onClick={() => navigateView("config")} title="打开当前项目配置中心"><Settings size={18} />配置中心</button>
                <button className={activeView === "standards" ? "active" : ""} onClick={() => navigateView("standards")} title="编辑当前项目的独立规范副本"><BookOpen size={18} />规范中心</button>
                <button className={activeView === "knowledge" ? "active" : ""} onClick={() => navigateView("knowledge")} title="候选知识人工确认后入库"><Archive size={18} />知识库</button>
                <button className={activeView === "capabilities" ? "active" : ""} onClick={() => navigateView("capabilities")} title="管理 Plugins、Skills、MCP、提示词和记忆"><Plug size={18} />能力中心</button>
              </>
            )}
          </div>

          <label className="sidebar-search">
            <Search size={15} />
            <input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索任务、对话或文件" aria-label="搜索工作台" />
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
                    <ConversationThreadRow
                      key={thread.id}
                      title={readableHistoricalText(thread.title, "历史对话（编码异常）")}
                      subtitle="独立对话 · 无文件夹"
                      active={thread.id === state?.activeChatThreadId && activeView === "chat"}
                      status={thread.status}
                      busy={sendingMessage}
                      onOpen={() => void switchDailyChat(thread.id)}
                      onCopyId={() => void copyThreadId(thread.id)}
                      onStatus={(status) => void updateThreadStatus("chat", thread.id, status)}
                    />
                  ))}
                </div>
              ))}
              {archivedChatThreads.length || removedChatThreads.length ? <details className="thread-history-section"><summary>会话管理 · {archivedChatThreads.length + removedChatThreads.length}</summary>
                {[...archivedChatThreads, ...removedChatThreads].map((thread) => <ConversationThreadRow
                  key={thread.id}
                  title={readableHistoricalText(thread.title, "历史对话（编码异常）")}
                  subtitle={thread.status === "archived" ? "已归档" : "已移除 · 本地保留"}
                  active={false}
                  status={thread.status}
                  busy={sendingMessage}
                  onOpen={() => void restoreAndOpenThread("chat", thread.id)}
                  onCopyId={() => void copyThreadId(thread.id)}
                  onStatus={(status) => void updateThreadStatus("chat", thread.id, status)}
                />)}
              </details> : null}
            </section>
          ) : (
            <>
              <div className="project-header">
                <span>客户项目</span>
                <button
                  type="button"
                  className={`new-customer-project-button${createPanel === "project" ? " active" : ""}`}
                  onClick={() => {
                    setCreatePanel((current) => current === "project" ? null : "project");
                    window.setTimeout(() => newProjectInputRef.current?.focus(), 0);
                  }}
                  aria-label="新建客户项目"
                  title="新建公司或客户项目"
                ><Plus size={14} /><span>客户</span></button>
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

              {createPanel === "project" ? <div className="create-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setCreatePanel(null); }}>
                <form className="quick-create create-dialog" role="dialog" aria-modal="true" aria-label="新建客户项目" onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
                <div className="create-dialog-heading"><div><strong>新建客户项目</strong><span>例如 A 公司；SAP landscape 按客户项目独立管理</span></div><button type="button" className="icon-button" onClick={() => setCreatePanel(null)} aria-label="关闭"><X size={17} /></button></div>
                <input ref={newProjectInputRef} value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="客户或公司名称，例如 A 公司" aria-label="客户项目名称" />
                <div className="quick-create-row">
                  <select value={newProjectSapVersion} onChange={(event) => setNewProjectSapVersion(event.target.value as NewProjectSapVersion)} aria-label="项目类型">
                    <option value="S4">S4HANA</option>
                    <option value="ECC">ECC</option>
                    <option value="UNKNOWN">其他工作</option>
                  </select>
                  <input value={newProjectSystemLabel} onChange={(event) => setNewProjectSystemLabel(event.target.value)} placeholder="DEV/100 或 LOCAL" aria-label="系统或本地标签" />
                </div>
                <button type="submit" disabled={!newProjectName.trim() || !newProjectSystemLabel.trim()}><Plus size={15} />创建客户项目</button>
              </form></div> : null}

              {createPanel === "case" ? <div className="create-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) { setCreatePanel(null); setCreateTaskError(""); window.setTimeout(() => newTaskButtonRef.current?.focus(), 0); } }}><div className="create-case-panel create-dialog" role="dialog" aria-modal="true" aria-label="新建运维项目">
              <div className="create-dialog-heading"><div><strong>新建运维项目</strong><span>运维项目拥有一个共享文件夹，创建后可随时增加对话线程</span></div><button type="button" className="icon-button" onClick={() => { setCreatePanel(null); setCreateTaskError(""); window.setTimeout(() => newTaskButtonRef.current?.focus(), 0); }} aria-label="关闭"><X size={17} /></button></div>
              <form className="quick-create case-create phase28-new-case-flow phase36-work-chat-project-folder-layout" onSubmit={(event) => { event.preventDefault(); void createCase(); }}>
                <label><span>运维项目名称</span><input ref={newCaseInputRef} value={newCaseTitle} onChange={(event) => setNewCaseTitle(event.target.value)} placeholder="例如：库龄分析报表开发" aria-label="运维项目名称" disabled={!project || creatingCase} /></label>
                <label><span>归属客户项目</span><select value={newCaseProjectId} onChange={(event) => { setNewCaseProjectId(event.target.value); setNewTaskFolderSelectionToken(""); setNewTaskSelectedFolderName(""); }} disabled={visibleProjects.length === 0 || creatingCase} aria-label="运维项目所属客户项目">
                  {visibleProjects.map((item) => (
                    <option key={item.id} value={item.id}>{projectKindLabel(item)} · {item.name} / {item.systemLabel}</option>
                  ))}
                </select></label>
                <div className="task-folder-mode" role="tablist" aria-label="工作文件夹绑定方式">
                  <button type="button" className={newTaskFolderMode === "new" ? "active" : ""} onClick={() => setNewTaskFolderMode("new")} role="tab" aria-selected={newTaskFolderMode === "new"}>新建文件夹</button>
                  <button type="button" className={newTaskFolderMode === "existing" ? "active" : ""} onClick={() => setNewTaskFolderMode("existing")} role="tab" aria-selected={newTaskFolderMode === "existing"}>已有文件夹</button>
                </div>
                {newTaskFolderMode === "new" ? (
                  <label><span>文件夹名称</span><input value={newTaskFolderName} onChange={(event) => setNewTaskFolderName(event.target.value)} placeholder="留空时与任务同名" aria-label="新工作文件夹名称" /></label>
                ) : (
                  <div className="local-folder-picker">
                    <button type="button" onClick={() => void selectExistingTaskFolder()} disabled={selectingTaskFolder || creatingCase}>
                      <FolderOpen size={16} />
                      {selectingTaskFolder ? "正在打开" : newTaskFolderSelectionToken ? "重新选择" : "选择电脑文件夹"}
                    </button>
                    {newTaskSelectedFolderName ? <div className="local-folder-selection" title={newTaskSelectedFolderName}><Folder size={16} /><span>{newTaskSelectedFolderName}</span></div> : null}
                  </div>
                )}
                {createTaskError ? <p className="create-task-error" role="alert">{createTaskError}</p> : null}
                <button type="submit" disabled={!project || creatingCase || !newCaseTitle.trim() || (newTaskFolderMode === "existing" && !newTaskFolderSelectionToken)} title="创建运维项目并打开第一个对话">
                  <Plus size={15} />
                  {creatingCase ? "创建中" : "创建运维项目"}
                </button>
              </form>
              </div></div> : null}

              <div className="project-list work-project-list">
                {sapProjects.map((item) => <CustomerProjectTree key={item.id} item={item} workThreads={state?.workThreads ?? []} active={item.id === state?.activeProjectId} activeView={activeView} activeThreadId={state?.activeWorkThreadId} busy={sendingMessage} onSwitch={() => void switchProject(item.id)} onConfig={() => void switchProject(item.id, "config")} onCreateWorkProject={() => focusNewCaseInput(item.id)} onCreateThread={(caseId) => void createConversationThread(item.id, caseId)} onOpenThread={(threadId) => void switchWorkTask(threadId)} onCopyThreadId={(threadId) => void copyThreadId(threadId)} onThreadStatus={(threadId, status) => void updateThreadStatus("work", threadId, status)} />)}
              </div>

              {otherWorkProjects.length ? <section className="other-work-section">
                <div className="project-header sidebar-subheader">
                  <span>其他工作</span>
                </div>
                <div className="project-list other-project-list">
                  {otherWorkProjects.map((item) => <CustomerProjectTree key={item.id} item={item} workThreads={state?.workThreads ?? []} active={item.id === state?.activeProjectId} activeView={activeView} activeThreadId={state?.activeWorkThreadId} busy={sendingMessage} onSwitch={() => void switchProject(item.id)} onCreateWorkProject={() => focusNewCaseInput(item.id)} onCreateThread={(caseId) => void createConversationThread(item.id, caseId)} onOpenThread={(threadId) => void switchWorkTask(threadId)} onCopyThreadId={(threadId) => void copyThreadId(threadId)} onThreadStatus={(threadId, status) => void updateThreadStatus("work", threadId, status)} />)}
                </div>
              </section> : null}

              {legacyDemoProjects.length ? (
                <section className="legacy-demo-section">
                  <div className="project-header sidebar-subheader">
                    <span>旧示例</span>
                  </div>
                  <p className="sidebar-section-note">历史演示，仅为兼容保留。</p>
                  <div className="project-list legacy-demo-project-list">
                    {legacyDemoProjects.map((item) => <CustomerProjectTree key={item.id} item={item} workThreads={state?.workThreads ?? []} active={item.id === state?.activeProjectId} activeView={activeView} activeThreadId={state?.activeWorkThreadId} busy={sendingMessage} legacy onSwitch={() => void switchProject(item.id)} onCreateWorkProject={() => focusNewCaseInput(item.id)} onCreateThread={(caseId) => void createConversationThread(item.id, caseId)} onOpenThread={(threadId) => void switchWorkTask(threadId)} onCopyThreadId={(threadId) => void copyThreadId(threadId)} onThreadStatus={(threadId, status) => void updateThreadStatus("work", threadId, status)} />)}
                  </div>
                </section>
              ) : null}

              {archivedWorkThreads.length || removedWorkThreads.length ? <details className="thread-history-section work-thread-history"><summary>任务管理 · {archivedWorkThreads.length + removedWorkThreads.length}</summary>
                {[...archivedWorkThreads, ...removedWorkThreads].map((thread) => {
                  const owner = state?.projects.find((item) => item.id === thread.projectId);
                  const folder = owner?.cases.find((caseItem) => caseItem.id === thread.caseId);
                  return <ConversationThreadRow
                    key={thread.id}
                    title={thread.title}
                    subtitle={`${thread.status === "archived" ? "已归档" : "已移除"} · ${owner?.name ?? "未知 Project"} / ${folder?.title ?? "未知文件夹"}`}
                    active={false}
                    status={thread.status}
                    busy={sendingMessage}
                    onOpen={() => void restoreAndOpenThread("work", thread.id)}
                    onCopyId={() => void copyThreadId(thread.id)}
                    onStatus={(status) => void updateThreadStatus("work", thread.id, status)}
                  />;
                })}
              </details> : null}
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
            onDiscoverSapGui={discoverSapGuiConnections}
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
        ) : activeView === "capabilities" ? (
          <CapabilityCenter
            capabilityFlags={{ plugins: true, mcp: true }}
            skills={capabilitySkills}
            prompts={capabilityPrompts}
            memories={capabilityMemories}
            plugins={{
              items: capabilityPlugins,
              onImport: importCapabilityPlugin,
              onToggle: async (id, enabled) => {
                if (!bridge) throw new Error("请在桌面应用中管理 Plugin。");
                await applyCapabilityMutation(bridge.setCapabilityPluginEnabled({ pluginId: id, enabled }));
              }
            }}
            mcp={{
              connections: capabilityMcpConnections,
              onAdd: addCapabilityMcp,
              onToggle: async (id, enabled) => {
                if (!bridge) throw new Error("请在桌面应用中管理 MCP。");
                await applyCapabilityMutation(bridge.setCapabilityMcpEnabled({ connectionId: id, enabled }));
              },
              onToggleTool: async (connectionId, toolName, enabled, confirmReadOnly) => {
                if (!bridge) throw new Error("请在桌面应用中管理 MCP 工具。");
                await applyCapabilityMutation(bridge.setCapabilityMcpToolEnabled({ connectionId, toolName, enabled, confirmReadOnly }));
              },
              onTest: async (id) => {
                if (!bridge) throw new Error("请在桌面应用中测试 MCP。");
                await applyCapabilityMutation(bridge.testCapabilityMcp({ connectionId: id }));
              },
              onRemove: async (id) => {
                if (!bridge) throw new Error("请在桌面应用中移除 MCP。");
                await applyCapabilityMutation(bridge.removeCapabilityMcp({ connectionId: id }));
              }
            }}
            contextLabel={`${project?.name ?? "个人工作台"} · ${capabilitySkills.length} 个 Skills · ${capabilityMcpConnections.length} 个 MCP 连接`}
            availableMemoryScopes={[
              "personal",
              ...(capabilitySnapshot?.target.projectId ? ["project" as const] : []),
              ...(capabilitySnapshot?.target.projectId && capabilitySnapshot.target.caseId ? ["case" as const] : [])
            ]}
            notice={notice || capabilitySnapshot?.promptMemoryHealth.warning || ""}
            promptPreview={capabilitySnapshot ? {
              title: "当前提示词组合预览",
              content: capabilitySnapshot.compiledPrompt.systemPrompt,
              estimatedTokens: capabilitySnapshot.compiledPrompt.tokenEstimate,
              conflicts: capabilitySnapshot.compiledPrompt.conflicts.map((item) => item.reason)
            } : undefined}
            onBack={() => navigateView("case")}
            onDirtyChange={setCenterDraftDirty}
            onImportSkill={importCapabilitySkill}
            onDiscoverSkills={discoverCapabilitySkills}
            onImportDiscoveredSkills={importDiscoveredCapabilitySkills}
            onToggleSkill={async (id, enabled) => {
              if (!bridge) throw new Error("请在桌面应用中管理 Skill。");
              await applyCapabilityMutation(bridge.setCapabilitySkillEnabled({ skillId: id, enabled }));
            }}
            onSavePrompt={async (id, content) => {
              if (!bridge) throw new Error("请在桌面应用中保存提示词。");
              const current = capabilityPrompts.find((item) => item.id === id);
              const scope = capabilityPromptScope(id);
              const existing = capabilitySnapshot?.promptProfiles.some((item) => JSON.stringify(item.scope) === JSON.stringify(scope));
              await applyCapabilityMutation(bridge.saveCapabilityPrompt({ scope, content, enabled: existing ? current?.enabled ?? true : true }));
            }}
            onTogglePrompt={async (id, enabled) => {
              if (!bridge) throw new Error("请在桌面应用中管理提示词。");
              await applyCapabilityMutation(bridge.setCapabilityPromptEnabled({ scope: capabilityPromptScope(id), enabled }));
            }}
            onSaveMemory={async (id, content) => {
              if (!bridge) throw new Error("请在桌面应用中保存记忆。");
              await applyCapabilityMutation(bridge.updateCapabilityMemory({ memoryId: id, expectedScope: capabilityMemoryScope(id), content }));
            }}
            onCreateMemory={async (draft) => {
              if (!bridge) throw new Error("请在桌面应用中新增记忆。");
              await applyCapabilityMutation(bridge.createCapabilityMemory({
                scope: capabilityNewMemoryScope(draft.scope),
                kind: draft.scope === "personal" ? "preference" : draft.kind,
                content: draft.content,
                topicKey: draft.topicKey.trim() || null
              }));
            }}
            onToggleMemory={async (id, enabled) => {
              if (enabled) throw new Error("已撤回的记忆不能直接重新启用，请重新创建候选并确认。");
              if (!bridge) throw new Error("请在桌面应用中管理记忆。");
              await applyCapabilityMutation(bridge.revokeCapabilityMemory({ memoryId: id, expectedScope: capabilityMemoryScope(id) }));
            }}
            onConfirmMemory={async (id) => {
              if (!bridge) throw new Error("请在桌面应用中确认记忆。");
              await applyCapabilityMutation(bridge.reviewCapabilityMemory({ memoryId: id, expectedScope: capabilityMemoryScope(id), decision: "confirm" }));
            }}
            onRejectMemory={async (id) => {
              if (!bridge) throw new Error("请在桌面应用中拒绝记忆。");
              await applyCapabilityMutation(bridge.reviewCapabilityMemory({ memoryId: id, expectedScope: capabilityMemoryScope(id), decision: "reject" }));
            }}
            onDeleteMemory={async (id) => {
              if (!bridge) throw new Error("请在桌面应用中移除记忆。");
              const memory = capabilitySnapshot?.memories.find((item) => item.id === id);
              if (!memory) throw new Error("记忆已不存在。");
              if (memory.status === "candidate") {
                await applyCapabilityMutation(bridge.reviewCapabilityMemory({ memoryId: id, expectedScope: memory.scope, decision: "reject" }));
              } else {
                await applyCapabilityMutation(bridge.revokeCapabilityMemory({ memoryId: id, expectedScope: memory.scope }));
              }
            }}
          />
        ) : activeView === "chat" ? (
          <section className="conversation-panel daily-chat-panel">
            <div className="case-heading">
              <div>
                <h1>{readableHistoricalText(activeChat?.title ?? "日常对话", "历史对话（编码异常）")}</h1>
                <p>独立保存 · 可临时使用当前 Project 的已授权模型渠道，内容不进入案件</p>
              </div>
            </div>

            {notice ? <div className="phase-notice" role="status" aria-live="polite">
              <ShieldCheck size={16} />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button>
            </div> : null}

            <div className="conversation-flow" ref={conversationFlowRef} onScroll={handleConversationScroll}>
              <div className="conversation-content">
                {(activeChat?.messages ?? []).map((item) => (
                  <DailyChatBubble message={item} key={item.id} />
                ))}
                {streamingTurn?.scope === "daily-chat" && streamingTurn.contextKey === `chat:${activeChat?.id ?? "new"}` ? <StreamingTurnBubble turn={streamingTurn} /> : null}
                {!activeChat?.messages.length && !(streamingTurn?.scope === "daily-chat" && streamingTurn.contextKey === `chat:${activeChat?.id ?? "new"}`) ? (
                  <article className="assistant-message daily-chat-empty">
                    <div className="run-time">独立对话 &gt;</div>
                    <div className="message-body"><p>直接输入日常问题即可。选择模型时只借用当前 Project 的授权渠道，不读取案件内容，也不写入案件文件。</p></div>
                  </article>
                ) : null}
                <div className="conversation-end" ref={conversationEndRef} aria-hidden="true" />
              </div>
              {showScrollToLatest ? <button type="button" className="scroll-latest-button" onClick={() => scrollConversationToLatest(true)} aria-label="回到最新消息" title="回到最新消息"><ArrowDown size={17} /></button> : null}
            </div>

            <form className="composer daily-chat-composer compact-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
              <textarea ref={composerTextareaRef} rows={1} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleComposerKeyDown} aria-label="日常对话输入" placeholder="输入消息，Enter 发送，Shift + Enter 换行" />
              <div className="composer-footer">
                <div className="composer-tools" />
                <div className="composer-actions composer-model-actions">
                  <ComposerModelPicker options={catalogModelOptions} providerErrors={modelProviderErrors} selected={selectedSafeDraftModel} onSelect={selectComposerModel} />
                  <button
                    type={sendingMessage ? "button" : "submit"}
                    aria-label={sendingMessage ? "停止当前回复" : "发送日常对话"}
                    className="send-button"
                    onClick={sendingMessage ? () => void stopCurrentTurn() : undefined}
                    title={sendingMessage ? "停止当前回复" : "发送"}
                  >{sendingMessage ? <Square size={16} fill="currentColor" /> : <Send size={18} />}</button>
                </div>
              </div>
            </form>
          </section>
        ) : currentCase?.isPlaceholder ? (
          <section className="conversation-panel customer-project-empty-state">
            <div>
              <FolderPlus size={30} />
              <h1>{project?.name ?? "客户项目"}</h1>
              <p>这个客户项目还没有运维项目。先登记 SAP landscape，或直接新建第一个运维项目。</p>
              <div>
                {isSapBoundProject(project) ? <button type="button" onClick={() => navigateView("config")}><Settings size={16} />配置 SAP 系统</button> : null}
                <button type="button" className="primary" onClick={() => focusNewCaseInput(project?.id)}><Plus size={16} />新建运维项目</button>
              </div>
            </div>
          </section>
        ) : (
        <>
        <section className="conversation-panel">
          <div className="case-heading">
            <div>
              <h1>{currentWorkThread?.title ?? "当前对话"}</h1>
              <p>{project ? `${project.name} · ${currentCase?.title ?? "当前运维项目"} · 对话线程` : "请先创建客户项目"}</p>
            </div>
            <div className="case-heading-actions">
              {adtReady && sapReadonlyEnabled ? <button type="button" className="context-panel-trigger" onClick={() => setSapEvidencePanelOpen((open) => !open)} aria-expanded={sapEvidencePanelOpen} title="从已验证 SAP 连接读取单个对象证据，不执行写入"><Database size={16} />{sapEvidencePanelOpen ? "收起取证" : "SAP 取证"}</button> : null}
              {!filesPanelVisible ? <button type="button" className="context-panel-trigger" onClick={() => setFilesPanelVisible(true)} title="显示当前运维项目文件"><FileText size={16} />文件 {fileCount}</button> : null}
            </div>
          </div>

          {notice ? <div className="phase-notice" role="status" aria-live="polite">
            <ShieldCheck size={16} />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button>
          </div> : null}

          <div className="conversation-flow" ref={conversationFlowRef} onScroll={handleConversationScroll}>
            <div className="conversation-content">
              {(currentWorkThread?.messages ?? []).map((item) => (
                <MessageBubble message={item} files={flatFiles} onPreview={previewCaseFile} key={item.id} />
              ))}
              {streamingTurn?.scope === "case" && streamingTurn.contextKey === `work:${currentWorkThread?.id ?? ""}` ? <StreamingTurnBubble turn={streamingTurn} /> : null}
              <div className="conversation-end" ref={conversationEndRef} aria-hidden="true" />
            </div>
            {showScrollToLatest ? <button type="button" className="scroll-latest-button" onClick={() => scrollConversationToLatest(true)} aria-label="回到最新消息" title="回到最新消息"><ArrowDown size={17} /></button> : null}
          </div>

          <form className={`composer compact-composer${caseActionConfirmationVisible || sapEvidencePanelOpen ? " expanded" : ""}`} onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            {isSapBoundProject(project) && adtReady && sapReadonlyEnabled && sapEvidencePanelOpen ? (
              <div className="sap-evidence-bar">
                <div className="sap-evidence-status" title="当前 SAP 只读取证上下文；本功能不写入 SAP">
                  <Database size={15} />
                  <span>{adtEvidenceStatus}</span>
                </div>
                <SapConnectionPicker
                  connections={verifiedAdtConnections}
                  route={sapRouteDecision}
                  mode={sapConnectionMode}
                  selectedIds={manualSapConnectionIds}
                  onModeChange={setSapConnectionMode}
                  onSelectedIdsChange={setManualSapConnectionIds}
                />
                <select value={sapEvidenceType} onChange={(event) => setSapEvidenceType(event.target.value as SapObjectEvidenceType)} aria-label="SAP 对象类型">
                  {sapEvidenceTypes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
                <input value={sapEvidenceName} onChange={(event) => setSapEvidenceName(event.target.value)} placeholder="ZDEMO_REPORT 或 /UI2/CL_JSON" aria-label="SAP 对象名" />
                {sapEvidenceType === "function" ? (
                  <input value={sapEvidenceFunctionGroup} onChange={(event) => setSapEvidenceFunctionGroup(event.target.value)} placeholder="函数组，例如 ZFG_MM001" aria-label="SAP 函数组" />
                ) : null}
                <button type="button" onClick={() => void readSapEvidence()} disabled={sapEvidenceBusy || !sapEvidenceName.trim() || (sapConnectionMode === "manual" && manualSapConnectionIds.length === 0)} title="把单个 SAP 只读对象证据写入当前运维项目文件夹">
                  <Database size={15} />
                  {sapEvidenceBusy ? "取证中" : "补充 SAP 只读证据"}
                </button>
              </div>
            ) : null}
            <textarea ref={composerTextareaRef} rows={1} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleComposerKeyDown} aria-label="继续追问" placeholder="输入消息，Enter 发送，Shift + Enter 换行" />
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
                {codexAssistAvailable ? <label className={`codex-assist-toggle ${codexAssistEnabled ? "active ready" : "ready"}`} title={codexAssistTitle}>
                  <input
                    type="checkbox"
                    checked={codexAssistEnabled}
                    disabled={sendingMessage}
                    onChange={(event) => setCodexAssistEnabled(event.target.checked)}
                    aria-label="使用 Codex 工程辅助"
                  />
                  <Bot size={15} />
                  <strong>使用 Codex 工程辅助</strong>
                </label> : null}
                <div className="action-target-line"><span>保存到</span><code>{selectedCaseAction.outputPath}</code></div>
                <div className="action-confirmation-buttons">
                  <button type="button" onClick={() => { setCaseActionConfirmationVisible(false); setCodexAssistEnabled(false); }}>取消</button>
                  <button type="button" className="primary" onClick={() => void runCaseAction()} disabled={sendingMessage}>{sendingMessage ? "生成中" : "开始生成"}</button>
                </div>
              </div>
            ) : null}
            <div className="composer-footer">
              <div className="composer-tools">
                <button type="button" className="case-action-run-button" onClick={() => setCaseActionConfirmationVisible((visible) => { if (visible) setCodexAssistEnabled(false); return !visible; })} disabled={sendingMessage} aria-expanded={caseActionConfirmationVisible} title="从当前案件生成笔记、说明书、流程图或候选知识">
                  <WandSparkles size={15} />成果动作<ChevronDown size={14} />
                </button>
              </div>
              <div className="composer-actions composer-model-actions">
                <ComposerModelPicker options={catalogModelOptions} providerErrors={modelProviderErrors} selected={selectedSafeDraftModel} onSelect={selectComposerModel} />
                <button
                  type={sendingMessage ? "button" : "submit"}
                  aria-label={sendingMessage ? "停止当前任务" : "保存到当前案件"}
                  className="send-button"
                  onClick={sendingMessage ? () => void stopCurrentTurn() : undefined}
                  title={sendingMessage ? "停止当前任务" : "发送"}
                >{sendingMessage ? <Square size={16} fill="currentColor" /> : <Send size={18} />}</button>
              </div>
            </div>
          </form>
        </section>

        {filesPanelVisible ? <aside className="files-panel" aria-label="当前运维项目文件" data-phase="phase40-files-only-context">
          <div className="files-heading">
            <div>
              <h2>当前运维项目</h2>
              <span>{currentCase?.title ?? "未选择运维项目"}</span>
            </div>
            <button aria-label="隐藏右侧面板" title="只隐藏显示，不影响文件保存" className="icon-button" onClick={() => setFilesPanelVisible(false)}><PanelLeft size={17} /></button>
          </div>
          <label className="file-search">
            <Search size={16} />
            <input value={fileSearchQuery} onChange={(event) => setFileSearchQuery(event.target.value)} placeholder="搜索文件" aria-label="搜索当前运维项目文件" />
          </label>
          <div className="file-panel-actions">
            <button type="button" onClick={() => void importCaseAttachments()} disabled={attachmentImportBusy || !currentCase || !currentWorkThread} title="导入 PDF、Word、Excel、CSV 或文本；原件仅本地保存，另生成脱敏摘录。">
              <Paperclip size={15} />
              {attachmentImportBusy ? "解析中" : "添加资料"}
            </button>
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
            ) : <div className="empty-state">当前运维项目还没有文件。</div>}
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
                {filePreview.fileType === "mmd" && !filePreview.truncated
                  ? <MermaidPreview preview={filePreview} onStateChange={setState} onNotice={setNotice} />
                  : <pre>{filePreview.content}</pre>}
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
