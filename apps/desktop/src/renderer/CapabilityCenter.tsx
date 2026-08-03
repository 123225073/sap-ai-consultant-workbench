import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  FileText,
  FolderInput,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Package,
  Plug,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import "./capability-center.css";
import type { CapabilitySkillDiscoveryReport } from "../shared/capabilityCenterTypes";

export type CapabilityTab = "plugins" | "skills" | "mcp" | "prompts" | "memories";
export type CapabilityScope = "global" | "personal" | "project" | "case" | "thread";
export type CapabilityValidationStatus = "valid" | "warning" | "invalid";

export interface CapabilityFlags {
  mcp: boolean;
  plugins: boolean;
}

export interface CapabilitySkillItem {
  id: string;
  name: string;
  technicalName?: string;
  description: string;
  source: string;
  categoryLabel?: string;
  workflowStage?: string;
  scope: CapabilityScope;
  scopeLabel?: string;
  enabled: boolean;
  validationStatus: CapabilityValidationStatus;
  validationMessage?: string;
  scriptsStatus: "none" | "present-disabled";
  resources?: readonly string[];
  updatedAt?: string;
}

export type CapabilityPromptLayer = "safety" | "product" | "personal" | "project" | "case" | "skill";

export interface CapabilityPromptItem {
  id: string;
  name: string;
  summary: string;
  content: string;
  layer: CapabilityPromptLayer;
  scopeLabel?: string;
  enabled: boolean;
  editable: boolean;
  canToggle?: boolean;
  estimatedTokens?: number;
  status?: "active" | "overridden" | "conflict";
  statusMessage?: string;
  updatedAt?: string;
}

export type CapabilityMemoryStatus = "candidate" | "confirmed" | "conflict" | "disabled" | "expired";

export interface CapabilityMemoryItem {
  id: string;
  summary: string;
  content: string;
  typeLabel: string;
  scope: CapabilityScope;
  scopeLabel?: string;
  status: CapabilityMemoryStatus;
  enabled: boolean;
  editable?: boolean;
  sourceLabel: string;
  sourceDetail?: string;
  updatedAt?: string;
  lastUsedAt?: string;
  validUntil?: string;
}

export interface CapabilityPluginItem {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  scopeLabel: string;
  includedCapabilities: readonly string[];
  enabled: boolean;
  validationStatus: CapabilityValidationStatus;
  lastValidatedAt?: string;
}

export interface CapabilityMcpConnection {
  id: string;
  name: string;
  description: string;
  transport: "STDIO" | "Streamable HTTP";
  scopeLabel: string;
  enabled: boolean;
  status: "connected" | "disconnected" | "checking" | "failed";
  capabilityCount: number;
  lastCheckedAt?: string;
  statusMessage?: string;
  tools: readonly CapabilityMcpTool[];
}

export interface CapabilityMcpTool {
  name: string;
  title: string;
  description: string;
  inputSummary: string;
  risk: "read-only" | "unknown" | "destructive";
  reportedReadOnlyHint: boolean | null;
  enabled: boolean;
  userApprovedReadOnly: boolean;
  canApproveReadOnly: boolean;
  policyLabel: string;
}

export interface CapabilityMcpDraft {
  name: string;
  description: string;
  transport: "streamable-http";
  scope: "global" | "project";
  endpoint: string;
}

export interface CapabilityMemoryDraft {
  scope: "personal" | "project" | "case";
  kind: "preference" | "fact" | "constraint" | "decision";
  topicKey: string;
  content: string;
}

export interface CapabilityPromptPreview {
  title: string;
  content: string;
  estimatedTokens?: number;
  conflicts?: readonly string[];
}

export interface CapabilityPluginControls {
  items: readonly CapabilityPluginItem[];
  onImport: () => void | Promise<void>;
  onToggle: (id: string, enabled: boolean) => void | Promise<void>;
}

export interface CapabilityMcpControls {
  connections: readonly CapabilityMcpConnection[];
  onAdd: (draft: CapabilityMcpDraft) => void | Promise<void>;
  onToggle: (id: string, enabled: boolean) => void | Promise<void>;
  onToggleTool: (connectionId: string, toolName: string, enabled: boolean, confirmReadOnly?: boolean) => void | Promise<void>;
  onTest: (id: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
}

export interface CapabilityCenterProps {
  capabilityFlags: CapabilityFlags;
  skills: readonly CapabilitySkillItem[];
  prompts: readonly CapabilityPromptItem[];
  memories: readonly CapabilityMemoryItem[];
  plugins?: CapabilityPluginControls;
  mcp?: CapabilityMcpControls;
  contextLabel?: string;
  notice?: string;
  initialTab?: CapabilityTab;
  promptPreview?: CapabilityPromptPreview;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onImportSkill: () => void | Promise<void>;
  onDiscoverSkills: () => Promise<CapabilitySkillDiscoveryReport>;
  onImportDiscoveredSkills: (report: CapabilitySkillDiscoveryReport, skillIds: string[]) => void | Promise<void>;
  onToggleSkill: (id: string, enabled: boolean) => void | Promise<void>;
  onSavePrompt: (id: string, content: string) => void | Promise<void>;
  onResetPrompt?: (id: string) => void | Promise<void>;
  onTogglePrompt: (id: string, enabled: boolean) => void | Promise<void>;
  onSaveMemory: (id: string, content: string) => void | Promise<void>;
  onCreateMemory: (draft: CapabilityMemoryDraft) => void | Promise<void>;
  availableMemoryScopes?: readonly CapabilityMemoryDraft["scope"][];
  onToggleMemory: (id: string, enabled: boolean) => void | Promise<void>;
  onConfirmMemory: (id: string) => void | Promise<void>;
  onRejectMemory: (id: string) => void | Promise<void>;
  onDeleteMemory: (id: string) => void | Promise<void>;
}

type EnabledFilter = "all" | "enabled" | "disabled";
type MemoryScopeFilter = "all" | CapabilityScope | "candidate";

const tabLabels: Record<CapabilityTab, string> = {
  plugins: "插件",
  skills: "Skills",
  mcp: "MCP",
  prompts: "提示词",
  memories: "记忆"
};

const scopeLabels: Record<CapabilityScope, string> = {
  global: "全局",
  personal: "个人",
  project: "Project",
  case: "Case",
  thread: "Thread"
};

const promptLayerLabels: Record<CapabilityPromptLayer, string> = {
  safety: "产品安全规则",
  product: "产品基础",
  personal: "个人偏好",
  project: "Project 指令",
  case: "Case 指令",
  skill: "Skill 指令"
};

const memoryStatusLabels: Record<CapabilityMemoryStatus, string> = {
  candidate: "待确认",
  confirmed: "已确认",
  conflict: "有冲突",
  disabled: "已停用",
  expired: "已过期"
};

function formatDate(value?: string): string {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function itemScopeLabel(scope: CapabilityScope, custom?: string): string {
  return custom?.trim() || scopeLabels[scope];
}

function operationError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "操作未完成，请重试。";
}

function ValidationPill({ status }: { status: CapabilityValidationStatus }) {
  const labels: Record<CapabilityValidationStatus, string> = {
    valid: "校验通过",
    warning: "需留意",
    invalid: "校验失败"
  };
  return <span className={`capability-pill capability-pill-${status}`}>{labels[status]}</span>;
}

function MemoryStatusPill({ status }: { status: CapabilityMemoryStatus }) {
  return <span className={`capability-pill capability-memory-${status}`}>{memoryStatusLabels[status]}</span>;
}

function McpStatusPill({ status }: { status: CapabilityMcpConnection["status"] }) {
  const labels: Record<CapabilityMcpConnection["status"], string> = {
    connected: "已连接",
    disconnected: "未连接",
    checking: "检查中",
    failed: "连接失败"
  };
  return <span className={`capability-pill capability-mcp-${status}`}>{labels[status]}</span>;
}

function ToggleControl({
  checked,
  busy,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  busy: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const stateLabel = busy ? "处理中" : checked ? "已启用" : "已停用";
  return (
    <button
      type="button"
      className="capability-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={`${checked ? "停用" : "启用"}${label}`}
      title={disabled && !busy ? `${label}当前不可更改` : `${checked ? "停用" : "启用"}${label}`}
      disabled={disabled || busy}
      onClick={onChange}
    >
      <span className="capability-toggle-track" aria-hidden="true">
        <span className="capability-toggle-thumb" />
      </span>
      <span>{stateLabel}</span>
    </button>
  );
}

function EmptyList({ children }: { children: ReactNode }) {
  return (
    <div className="capability-empty-list">
      <Search size={18} />
      <span>{children}</span>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="capability-empty-detail">
      <FileText size={20} />
      <span>选择一项查看详情</span>
    </div>
  );
}

function CapabilityModal({
  title,
  icon,
  children,
  footer,
  onClose
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="capability-modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="capability-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <span className="capability-modal-title">{icon}<strong>{title}</strong></span>
          <button type="button" className="capability-icon-button" onClick={onClose} aria-label="关闭弹层" title="关闭"><X size={17} /></button>
        </header>
        <div className="capability-modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </section>
    </div>
  );
}

function CapabilityCenter({
  capabilityFlags,
  skills,
  prompts,
  memories,
  plugins,
  mcp,
  contextLabel,
  notice,
  initialTab,
  promptPreview,
  onBack,
  onDirtyChange,
  onImportSkill,
  onDiscoverSkills,
  onImportDiscoveredSkills,
  onToggleSkill,
  onSavePrompt,
  onResetPrompt,
  onTogglePrompt,
  onSaveMemory,
  onCreateMemory,
  availableMemoryScopes = ["personal"],
  onToggleMemory,
  onConfirmMemory,
  onRejectMemory,
  onDeleteMemory
}: CapabilityCenterProps) {
  const availableTabs = useMemo<CapabilityTab[]>(() => {
    const tabs: CapabilityTab[] = [];
    if (capabilityFlags.plugins && plugins) tabs.push("plugins");
    tabs.push("skills");
    if (capabilityFlags.mcp && mcp) tabs.push("mcp");
    tabs.push("prompts", "memories");
    return tabs;
  }, [capabilityFlags.mcp, capabilityFlags.plugins, mcp, plugins]);
  const [activeTab, setActiveTab] = useState<CapabilityTab>(() => {
    const requestedTab = initialTab ?? "skills";
    return availableTabs.includes(requestedTab) ? requestedTab : "skills";
  });
  const [queries, setQueries] = useState<Partial<Record<CapabilityTab, string>>>({});
  const [enabledFilters, setEnabledFilters] = useState<Partial<Record<CapabilityTab, EnabledFilter>>>({});
  const [memoryScopeFilter, setMemoryScopeFilter] = useState<MemoryScopeFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Partial<Record<CapabilityTab, string>>>({});
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(() => new Set());
  const [localNotice, setLocalNotice] = useState("");
  const [localError, setLocalError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sourceMemoryId, setSourceMemoryId] = useState("");
  const [deleteMemoryId, setDeleteMemoryId] = useState("");
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [memoryEditorOpen, setMemoryEditorOpen] = useState(false);
  const [skillDiscovery, setSkillDiscovery] = useState<CapabilitySkillDiscoveryReport | null>(null);
  const [selectedDiscoveredSkillIds, setSelectedDiscoveredSkillIds] = useState<Set<string>>(() => new Set());
  const [mcpDraft, setMcpDraft] = useState<CapabilityMcpDraft>({
    name: "",
    description: "",
    transport: "streamable-http",
    scope: "project",
    endpoint: ""
  });
  const [newMemoryDraft, setNewMemoryDraft] = useState<CapabilityMemoryDraft>({
    scope: availableMemoryScopes.includes("project") ? "project" : "personal",
    kind: availableMemoryScopes.includes("project") ? "fact" : "preference",
    topicKey: "",
    content: ""
  });

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) setActiveTab("skills");
  }, [activeTab, availableTabs]);

  const promptDirty = useMemo(() => Object.entries(promptDrafts).some(([id, draft]) => {
    const item = prompts.find((prompt) => prompt.id === id);
    return Boolean(item && item.content !== draft);
  }), [promptDrafts, prompts]);
  const memoryDirty = useMemo(() => Object.entries(memoryDrafts).some(([id, draft]) => {
    const item = memories.find((memory) => memory.id === id);
    return Boolean(item && item.content !== draft);
  }), [memoryDrafts, memories]);
  const dirty = promptDirty || memoryDirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const modalOpen = previewOpen || Boolean(sourceMemoryId) || Boolean(deleteMemoryId) || mcpEditorOpen || memoryEditorOpen;
  useEffect(() => {
    if (!modalOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPreviewOpen(false);
      setSourceMemoryId("");
      setDeleteMemoryId("");
      setMcpEditorOpen(false);
      setMemoryEditorOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [modalOpen]);

  const query = queries[activeTab] ?? "";
  const enabledFilter = enabledFilters[activeTab] ?? "all";
  const normalizedQuery = query.trim().toLowerCase();

  function textMatches(parts: readonly (string | undefined)[]): boolean {
    return !normalizedQuery || parts.filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery);
  }

  function enabledMatches(enabled: boolean): boolean {
    return enabledFilter === "all" || (enabledFilter === "enabled" ? enabled : !enabled);
  }

  const skillCategoryOrder: Record<string, number> = { "SAP 运维": 0, "SAP 实施": 1, "兼容入口": 2, "通用与用户 Skills": 3 };
  const filteredSkills = [...skills].filter((item) => enabledMatches(item.enabled) && textMatches([
    item.name,
    item.technicalName,
    item.description,
    item.source,
    item.categoryLabel,
    item.workflowStage,
    item.scopeLabel,
    item.validationMessage,
    ...item.resources ?? []
  ])).sort((left, right) => {
    const leftCategory = left.categoryLabel ?? "通用与用户 Skills";
    const rightCategory = right.categoryLabel ?? "通用与用户 Skills";
    return (skillCategoryOrder[leftCategory] ?? 99) - (skillCategoryOrder[rightCategory] ?? 99)
      || (left.workflowStage ?? "99").localeCompare(right.workflowStage ?? "99", "zh-CN", { numeric: true })
      || left.name.localeCompare(right.name, "zh-CN");
  });
  const filteredPrompts = prompts.filter((item) => enabledMatches(item.enabled) && textMatches([
    item.name,
    item.summary,
    item.content,
    promptLayerLabels[item.layer],
    item.scopeLabel,
    item.statusMessage
  ]));
  const filteredMemories = memories.filter((item) => {
    const scopeMatched = memoryScopeFilter === "all"
      || (memoryScopeFilter === "candidate" ? item.status === "candidate" : item.scope === memoryScopeFilter);
    return scopeMatched && enabledMatches(item.enabled) && textMatches([
      item.summary,
      item.content,
      item.typeLabel,
      item.scopeLabel,
      item.sourceLabel,
      item.sourceDetail
    ]);
  });
  const filteredPlugins = (plugins?.items ?? []).filter((item) => enabledMatches(item.enabled) && textMatches([
    item.name,
    item.description,
    item.version,
    item.source,
    item.scopeLabel,
    ...item.includedCapabilities
  ]));
  const filteredMcp = (mcp?.connections ?? []).filter((item) => enabledMatches(item.enabled) && textMatches([
    item.name,
    item.description,
    item.transport,
    item.scopeLabel,
    item.statusMessage
  ]));

  const selectedSkill = filteredSkills.find((item) => item.id === selectedIds.skills) ?? filteredSkills[0];
  const groupedSkills = filteredSkills.reduce<Array<{ label: string; items: CapabilitySkillItem[] }>>((groups, item) => {
    const label = item.categoryLabel ?? "通用与用户 Skills";
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.items.push(item);
    else groups.push({ label, items: [item] });
    return groups;
  }, []);
  const selectedPrompt = filteredPrompts.find((item) => item.id === selectedIds.prompts) ?? filteredPrompts[0];
  const selectedMemory = filteredMemories.find((item) => item.id === selectedIds.memories) ?? filteredMemories[0];
  const selectedPlugin = filteredPlugins.find((item) => item.id === selectedIds.plugins) ?? filteredPlugins[0];
  const selectedMcp = filteredMcp.find((item) => item.id === selectedIds.mcp) ?? filteredMcp[0];
  const sourceMemory = memories.find((item) => item.id === sourceMemoryId);
  const memoryToDelete = memories.find((item) => item.id === deleteMemoryId);

  const promptDraft = selectedPrompt ? promptDrafts[selectedPrompt.id] ?? selectedPrompt.content : "";
  const selectedPromptDirty = Boolean(selectedPrompt && promptDraft !== selectedPrompt.content);
  const memoryDraft = selectedMemory ? memoryDrafts[selectedMemory.id] ?? selectedMemory.content : "";
  const selectedMemoryDirty = Boolean(selectedMemory && memoryDraft !== selectedMemory.content);

  function isPending(key: string): boolean {
    return pendingOperations.has(key);
  }

  async function runOperation(key: string, operation: () => void | Promise<void>, successMessage?: string): Promise<boolean> {
    if (pendingOperations.has(key)) return false;
    setPendingOperations((current) => new Set(current).add(key));
    setLocalError("");
    if (successMessage) setLocalNotice("");
    try {
      await operation();
      if (successMessage) setLocalNotice(successMessage);
      return true;
    } catch (error) {
      setLocalError(operationError(error));
      return false;
    } finally {
      setPendingOperations((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function setSelected(tab: CapabilityTab, id: string) {
    setSelectedIds((current) => ({ ...current, [tab]: id }));
  }

  function clearPromptDraft(id: string) {
    setPromptDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function clearMemoryDraft(id: string) {
    setMemoryDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function renderToolbarAction(): ReactNode {
    if (activeTab === "skills") {
      const busy = isPending("import-skill");
      return (
        <div className="capability-skill-actions">
          <button type="button" className="capability-secondary-action" disabled={busy || isPending("discover-skills")} onClick={() => void discoverSkills()}>
            {isPending("discover-skills") ? <LoaderCircle className="capability-spin" size={16} /> : <RefreshCw size={16} />}
            {isPending("discover-skills") ? "扫描中" : "发现本机 Skills"}
          </button>
          <button type="button" className="capability-primary-action" disabled={busy} onClick={() => void runOperation("import-skill", onImportSkill)}>
            {busy ? <LoaderCircle className="capability-spin" size={16} /> : <FolderInput size={16} />}
            {busy ? "导入中" : "选择文件夹"}
          </button>
        </div>
      );
    }
    if (activeTab === "plugins" && plugins) {
      const busy = isPending("import-plugin");
      return (
        <button type="button" className="capability-primary-action" disabled={busy} onClick={() => void runOperation("import-plugin", plugins.onImport)}>
          {busy ? <LoaderCircle className="capability-spin" size={16} /> : <FolderInput size={16} />}
          {busy ? "导入中" : "导入插件包"}
        </button>
      );
    }
    if (activeTab === "mcp" && mcp) {
      return (
        <button type="button" className="capability-primary-action" onClick={() => setMcpEditorOpen(true)}>
          <Plug size={16} />添加连接
        </button>
      );
    }
    if (activeTab === "prompts" && promptPreview) {
      return <button type="button" className="capability-secondary-action" onClick={() => setPreviewOpen(true)}><FileText size={16} />组合预览</button>;
    }
    if (activeTab === "memories") {
      return <button type="button" className="capability-primary-action" onClick={() => setMemoryEditorOpen(true)}><Brain size={16} />新增记忆</button>;
    }
    return null;
  }

  async function discoverSkills(): Promise<void> {
    if (pendingOperations.has("discover-skills")) return;
    setPendingOperations((current) => new Set(current).add("discover-skills"));
    setLocalError("");
    try {
      const report = await onDiscoverSkills();
      setSkillDiscovery(report);
      const selectedNames = new Set<string>();
      setSelectedDiscoveredSkillIds(new Set(report.items
        .filter((item) => {
          const name = item.name.toLocaleLowerCase();
          if (item.validationStatus !== "valid" || item.alreadyInstalled || selectedNames.has(name) || selectedNames.size >= 100) return false;
          selectedNames.add(name);
          return true;
        })
        .map((item) => item.id)));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "扫描本机 Skills 失败。");
    } finally {
      setPendingOperations((current) => {
        const next = new Set(current);
        next.delete("discover-skills");
        return next;
      });
    }
  }

  function toggleDiscoveredSkill(id: string): void {
    setSelectedDiscoveredSkillIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 100) {
          setLocalError("一次最多导入 100 个 Skills，请先完成当前批次。");
          return current;
        }
        const selectedItem = skillDiscovery?.items.find((item) => item.id === id);
        if (selectedItem) {
          for (const item of skillDiscovery?.items ?? []) {
            if (item.name.toLocaleLowerCase() === selectedItem.name.toLocaleLowerCase()) next.delete(item.id);
          }
        }
        next.add(id);
      }
      return next;
    });
  }

  function listCount(): number {
    if (activeTab === "plugins") return filteredPlugins.length;
    if (activeTab === "skills") return filteredSkills.length;
    if (activeTab === "mcp") return filteredMcp.length;
    if (activeTab === "prompts") return filteredPrompts.length;
    return filteredMemories.length;
  }

  function searchPlaceholder(): string {
    if (activeTab === "skills") return "搜索 Skill 名称、说明或来源";
    if (activeTab === "prompts") return "搜索提示词名称或内容";
    if (activeTab === "memories") return "搜索记忆内容、类型或来源";
    if (activeTab === "mcp") return "搜索 MCP 连接";
    return "搜索插件名称或能力";
  }

  function renderSkillList() {
    return (
      <>
        <div className="capability-list-header capability-list-grid capability-list-grid-skill" role="row">
          <span>名称</span><span>范围</span><span className="capability-hide-900">脚本</span><span>校验</span><span>状态</span>
        </div>
        <div className="capability-list-body" role="rowgroup">
          {filteredSkills.length === 0 ? <EmptyList>没有符合当前筛选的 Skill</EmptyList> : groupedSkills.map((group) => (
            <section className="capability-skill-group" aria-label={group.label} key={group.label}>
              <header className="capability-skill-group-heading">
                <span>{group.label}</span>
                <small>{group.items.length} 个</small>
              </header>
              {group.items.map((item) => {
                const busy = isPending(`skill:${item.id}`);
                return (
                  <div key={item.id} className={`capability-list-row capability-list-grid capability-list-grid-skill${selectedSkill?.id === item.id ? " active" : ""}`} role="row">
                    <button type="button" className="capability-row-select" onClick={() => setSelected("skills", item.id)} title={`查看 ${item.name}`}>
                      <span className="capability-name-cell"><strong>{item.name}</strong><small>{item.workflowStage ? `${item.workflowStage} · ` : ""}{item.description}</small></span>
                      <span>{itemScopeLabel(item.scope, item.scopeLabel)}</span>
                      <span className="capability-hide-900">{item.scriptsStatus === "present-disabled" ? "有，未执行" : "无"}</span>
                      <span><ValidationPill status={item.validationStatus} /></span>
                    </button>
                    <ToggleControl
                      checked={item.enabled}
                      busy={busy}
                      disabled={!item.enabled && item.validationStatus === "invalid"}
                      label={item.name}
                      onChange={() => void runOperation(`skill:${item.id}`, () => onToggleSkill(item.id, !item.enabled))}
                    />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </>
    );
  }

  function renderPromptList() {
    return (
      <>
        <div className="capability-list-header capability-list-grid capability-list-grid-prompt" role="row">
          <span>名称</span><span>层级</span><span className="capability-hide-900">估算 token</span><span>状态</span><span>启停</span>
        </div>
        <div className="capability-list-body" role="rowgroup">
          {filteredPrompts.length === 0 ? <EmptyList>没有符合当前筛选的提示词</EmptyList> : filteredPrompts.map((item) => {
            const busy = isPending(`prompt-toggle:${item.id}`);
            const canToggle = item.canToggle ?? item.editable;
            return (
              <div key={item.id} className={`capability-list-row capability-list-grid capability-list-grid-prompt${selectedPrompt?.id === item.id ? " active" : ""}`} role="row">
                <button type="button" className="capability-row-select" onClick={() => setSelected("prompts", item.id)} title={`查看 ${item.name}`}>
                  <span className="capability-name-cell"><strong>{item.name}</strong><small>{item.summary}</small></span>
                  <span>{promptLayerLabels[item.layer]}</span>
                  <span className="capability-hide-900">{typeof item.estimatedTokens === "number" ? item.estimatedTokens.toLocaleString("zh-CN") : "未估算"}</span>
                  <span className={`capability-prompt-status capability-prompt-${item.status ?? "active"}`}>{item.status === "conflict" ? "有冲突" : item.status === "overridden" ? "部分覆盖" : "生效中"}</span>
                </button>
                <ToggleControl
                  checked={item.enabled}
                  busy={busy}
                  disabled={!canToggle}
                  label={item.name}
                  onChange={() => void runOperation(`prompt-toggle:${item.id}`, () => onTogglePrompt(item.id, !item.enabled))}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderMemoryList() {
    return (
      <>
        <div className="capability-list-header capability-list-grid capability-list-grid-memory" role="row">
          <span>内容</span><span className="capability-hide-900">类型</span><span>范围</span><span>状态</span><span className="capability-hide-900">更新时间</span><span>启停</span>
        </div>
        <div className="capability-list-body" role="rowgroup">
          {filteredMemories.length === 0 ? <EmptyList>没有符合当前筛选的记忆</EmptyList> : filteredMemories.map((item) => {
            const busy = isPending(`memory-toggle:${item.id}`);
            return (
              <div key={item.id} className={`capability-list-row capability-list-grid capability-list-grid-memory${selectedMemory?.id === item.id ? " active" : ""}`} role="row">
                <button type="button" className="capability-row-select" onClick={() => setSelected("memories", item.id)} title="查看记忆详情">
                  <span className="capability-name-cell"><strong>{item.summary}</strong><small>{item.sourceLabel}</small></span>
                  <span className="capability-hide-900">{item.typeLabel}</span>
                  <span>{itemScopeLabel(item.scope, item.scopeLabel)}</span>
                  <span><MemoryStatusPill status={item.status} /></span>
                  <span className="capability-hide-900">{formatDate(item.updatedAt)}</span>
                </button>
                <ToggleControl
                  checked={item.enabled}
                  busy={busy}
                  disabled={item.status !== "confirmed"}
                  label={item.summary}
                  onChange={() => void runOperation(`memory-toggle:${item.id}`, () => onToggleMemory(item.id, !item.enabled))}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderPluginList() {
    return (
      <>
        <div className="capability-list-header capability-list-grid capability-list-grid-plugin" role="row">
          <span>名称</span><span>版本</span><span>范围</span><span>校验</span><span className="capability-hide-900">最近校验</span><span>状态</span>
        </div>
        <div className="capability-list-body" role="rowgroup">
          {filteredPlugins.length === 0 ? <EmptyList>尚无符合当前筛选的插件包</EmptyList> : filteredPlugins.map((item) => {
            const busy = isPending(`plugin:${item.id}`);
            return (
              <div key={item.id} className={`capability-list-row capability-list-grid capability-list-grid-plugin${selectedPlugin?.id === item.id ? " active" : ""}`} role="row">
                <button type="button" className="capability-row-select" onClick={() => setSelected("plugins", item.id)} title={`查看 ${item.name}`}>
                  <span className="capability-name-cell"><strong>{item.name}</strong><small>{item.description}</small></span>
                  <span>{item.version}</span><span>{item.scopeLabel}</span><span><ValidationPill status={item.validationStatus} /></span><span className="capability-hide-900">{formatDate(item.lastValidatedAt)}</span>
                </button>
                <ToggleControl checked={item.enabled} busy={busy} disabled={!item.enabled && item.validationStatus === "invalid"} label={item.name} onChange={() => void runOperation(`plugin:${item.id}`, () => plugins?.onToggle(item.id, !item.enabled))} />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderMcpList() {
    return (
      <>
        <div className="capability-list-header capability-list-grid capability-list-grid-mcp" role="row">
          <span>连接</span><span>方式</span><span>范围</span><span>状态</span><span className="capability-hide-900">能力</span><span>启停</span>
        </div>
        <div className="capability-list-body" role="rowgroup">
          {filteredMcp.length === 0 ? <EmptyList>尚无符合当前筛选的 MCP 连接</EmptyList> : filteredMcp.map((item) => {
            const busy = isPending(`mcp:${item.id}`);
            return (
              <div key={item.id} className={`capability-list-row capability-list-grid capability-list-grid-mcp${selectedMcp?.id === item.id ? " active" : ""}`} role="row">
                <button type="button" className="capability-row-select" onClick={() => setSelected("mcp", item.id)} title={`查看 ${item.name}`}>
                  <span className="capability-name-cell"><strong>{item.name}</strong><small>{item.description}</small></span>
                  <span>{item.transport}</span><span>{item.scopeLabel}</span><span><McpStatusPill status={item.status} /></span><span className="capability-hide-900">{item.capabilityCount} 项</span>
                </button>
                <ToggleControl checked={item.enabled} busy={busy} label={item.name} onChange={() => void runOperation(`mcp:${item.id}`, () => mcp?.onToggle(item.id, !item.enabled))} />
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderList() {
    if (activeTab === "plugins") return renderPluginList();
    if (activeTab === "skills") return renderSkillList();
    if (activeTab === "mcp") return renderMcpList();
    if (activeTab === "prompts") return renderPromptList();
    return renderMemoryList();
  }

  function renderSkillDetail() {
    if (!selectedSkill) return <EmptyDetail />;
    return (
      <div className="capability-detail-content">
        <div className="capability-detail-heading">
          <div><span className="capability-detail-kicker"><FileText size={14} />SKILL.md</span><h2>{selectedSkill.name}</h2><p>{selectedSkill.description}</p></div>
          <ValidationPill status={selectedSkill.validationStatus} />
        </div>
        <dl className="capability-detail-meta">
          {selectedSkill.technicalName && selectedSkill.technicalName !== selectedSkill.name ? <div><dt>Skill ID</dt><dd>{selectedSkill.technicalName}</dd></div> : null}
          {selectedSkill.categoryLabel ? <div><dt>工作域</dt><dd>{selectedSkill.categoryLabel}{selectedSkill.workflowStage ? ` · ${selectedSkill.workflowStage}` : ""}</dd></div> : null}
          <div><dt>来源</dt><dd>{selectedSkill.source}</dd></div>
          <div><dt>范围</dt><dd>{itemScopeLabel(selectedSkill.scope, selectedSkill.scopeLabel)}</dd></div>
          <div><dt>脚本</dt><dd>{selectedSkill.scriptsStatus === "present-disabled" ? "已发现，执行未启用" : "未包含"}</dd></div>
          <div><dt>更新时间</dt><dd>{formatDate(selectedSkill.updatedAt)}</dd></div>
        </dl>
        {selectedSkill.validationMessage ? <p className={`capability-inline-message capability-inline-${selectedSkill.validationStatus}`}><AlertTriangle size={15} />{selectedSkill.validationMessage}</p> : null}
        <div className="capability-resource-line"><strong>资源</strong><span>{selectedSkill.resources?.length ? selectedSkill.resources.join(" · ") : "无附加资源"}</span></div>
      </div>
    );
  }

  function renderPromptDetail() {
    if (!selectedPrompt) return <EmptyDetail />;
    const saving = isPending(`prompt-save:${selectedPrompt.id}`);
    const resetting = isPending(`prompt-reset:${selectedPrompt.id}`);
    return (
      <div className="capability-detail-content capability-editor-content">
        <div className="capability-detail-heading">
          <div><span className="capability-detail-kicker"><ShieldCheck size={14} />{promptLayerLabels[selectedPrompt.layer]}</span><h2>{selectedPrompt.name}</h2><p>{selectedPrompt.summary}</p></div>
          {!selectedPrompt.editable ? <span className="capability-readonly-label"><LockKeyhole size={14} />只读</span> : null}
        </div>
        {selectedPrompt.statusMessage ? <p className={`capability-inline-message capability-inline-${selectedPrompt.status === "conflict" ? "invalid" : "warning"}`}><AlertTriangle size={15} />{selectedPrompt.statusMessage}</p> : null}
        {selectedPrompt.editable ? (
          <textarea
            className="capability-editor"
            value={promptDraft}
            onChange={(event) => setPromptDrafts((current) => ({ ...current, [selectedPrompt.id]: event.target.value }))}
            aria-label={`编辑${selectedPrompt.name}`}
          />
        ) : <pre className="capability-readonly-content">{selectedPrompt.content}</pre>}
        <div className="capability-editor-footer">
          <span>{typeof selectedPrompt.estimatedTokens === "number" ? `约 ${selectedPrompt.estimatedTokens.toLocaleString("zh-CN")} token` : "尚未估算 token"}</span>
          <div>
            {selectedPrompt.editable && onResetPrompt ? <button type="button" className="capability-secondary-action" disabled={resetting || saving} onClick={() => void runOperation(`prompt-reset:${selectedPrompt.id}`, () => onResetPrompt(selectedPrompt.id), "已恢复默认提示词。").then((completed) => { if (completed) clearPromptDraft(selectedPrompt.id); })}><RotateCcw size={15} />{resetting ? "恢复中" : "恢复默认"}</button> : null}
            {selectedPrompt.editable ? <button type="button" className="capability-primary-action" disabled={!selectedPromptDirty || saving || resetting} onClick={() => void runOperation(`prompt-save:${selectedPrompt.id}`, () => onSavePrompt(selectedPrompt.id, promptDraft), "提示词已保存。").then((completed) => { if (completed) clearPromptDraft(selectedPrompt.id); })}>{saving ? <LoaderCircle className="capability-spin" size={15} /> : <Save size={15} />}{saving ? "保存中" : selectedPromptDirty ? "保存修改" : "没有变化"}</button> : null}
          </div>
        </div>
      </div>
    );
  }

  function renderMemoryDetail() {
    if (!selectedMemory) return <EmptyDetail />;
    const saving = isPending(`memory-save:${selectedMemory.id}`);
    const confirming = isPending(`memory-confirm:${selectedMemory.id}`);
    const rejecting = isPending(`memory-reject:${selectedMemory.id}`);
    const editable = selectedMemory.editable !== false && selectedMemory.status !== "expired";
    return (
      <div className="capability-detail-content capability-editor-content">
        <div className="capability-detail-heading">
          <div><span className="capability-detail-kicker"><Brain size={14} />{selectedMemory.typeLabel}</span><h2>{selectedMemory.summary}</h2><p>{itemScopeLabel(selectedMemory.scope, selectedMemory.scopeLabel)} · {selectedMemory.sourceLabel}</p></div>
          <MemoryStatusPill status={selectedMemory.status} />
        </div>
        {editable ? (
          <textarea
            className="capability-editor"
            value={memoryDraft}
            onChange={(event) => setMemoryDrafts((current) => ({ ...current, [selectedMemory.id]: event.target.value }))}
            aria-label="编辑记忆内容"
          />
        ) : <pre className="capability-readonly-content">{selectedMemory.content}</pre>}
        <div className="capability-memory-meta">
          <span>更新：{formatDate(selectedMemory.updatedAt)}</span>
          <span>最近使用：{formatDate(selectedMemory.lastUsedAt)}</span>
          <span>有效期：{selectedMemory.validUntil ? formatDate(selectedMemory.validUntil) : "长期"}</span>
        </div>
        <div className="capability-editor-footer">
          <button type="button" className="capability-link-action" onClick={() => setSourceMemoryId(selectedMemory.id)}><Link2 size={15} />查看来源</button>
          <div>
            {selectedMemory.status === "candidate" ? <button type="button" className="capability-secondary-action capability-reject-action" disabled={rejecting || confirming} onClick={() => void runOperation(`memory-reject:${selectedMemory.id}`, () => onRejectMemory(selectedMemory.id), "已拒绝这条记忆候选。")}><XCircle size={15} />{rejecting ? "处理中" : "拒绝"}</button> : null}
            {selectedMemory.status === "candidate" ? <button type="button" className="capability-secondary-action capability-confirm-action" disabled={confirming || rejecting} onClick={() => void runOperation(`memory-confirm:${selectedMemory.id}`, () => onConfirmMemory(selectedMemory.id), "记忆已确认。")}>{confirming ? <LoaderCircle className="capability-spin" size={15} /> : <CheckCircle2 size={15} />}{confirming ? "确认中" : "确认记忆"}</button> : null}
            <button type="button" className="capability-icon-button capability-delete-action" onClick={() => setDeleteMemoryId(selectedMemory.id)} aria-label="删除记忆" title="删除记忆"><Trash2 size={16} /></button>
            {editable ? <button type="button" className="capability-primary-action" disabled={!selectedMemoryDirty || saving} onClick={() => void runOperation(`memory-save:${selectedMemory.id}`, () => onSaveMemory(selectedMemory.id, memoryDraft), "记忆已保存。").then((completed) => { if (completed) clearMemoryDraft(selectedMemory.id); })}>{saving ? <LoaderCircle className="capability-spin" size={15} /> : <Save size={15} />}{saving ? "保存中" : selectedMemoryDirty ? "保存修改" : "没有变化"}</button> : null}
          </div>
        </div>
      </div>
    );
  }

  function renderPluginDetail() {
    if (!selectedPlugin) return <EmptyDetail />;
    return (
      <div className="capability-detail-content">
        <div className="capability-detail-heading"><div><span className="capability-detail-kicker"><Package size={14} />声明式插件包</span><h2>{selectedPlugin.name} <small>v{selectedPlugin.version}</small></h2><p>{selectedPlugin.description}</p></div><ValidationPill status={selectedPlugin.validationStatus} /></div>
        <dl className="capability-detail-meta"><div><dt>来源</dt><dd>{selectedPlugin.source}</dd></div><div><dt>范围</dt><dd>{selectedPlugin.scopeLabel}</dd></div><div><dt>最近校验</dt><dd>{formatDate(selectedPlugin.lastValidatedAt)}</dd></div></dl>
        <div className="capability-resource-line"><strong>声明清单</strong><span>{selectedPlugin.includedCapabilities.length ? selectedPlugin.includedCapabilities.join(" · ") : "无"}；Skills 与提示词可按范围进入新回合，MCP 预设和模板当前仅登记，不自动执行</span></div>
      </div>
    );
  }

  function renderMcpDetail() {
    if (!selectedMcp) return <EmptyDetail />;
    return (
      <div className="capability-detail-content">
        <div className="capability-detail-heading"><div><span className="capability-detail-kicker"><Plug size={14} />{selectedMcp.transport}</span><h2>{selectedMcp.name}</h2><p>{selectedMcp.description}</p></div><McpStatusPill status={selectedMcp.status} /></div>
        <dl className="capability-detail-meta"><div><dt>范围</dt><dd>{selectedMcp.scopeLabel}</dd></div><div><dt>发现能力</dt><dd>{selectedMcp.capabilityCount} 项</dd></div><div><dt>最近检查</dt><dd>{formatDate(selectedMcp.lastCheckedAt)}</dd></div></dl>
        {selectedMcp.statusMessage ? <p className={`capability-inline-message capability-inline-${selectedMcp.status === "failed" ? "invalid" : "warning"}`}><AlertTriangle size={15} />{selectedMcp.statusMessage}</p> : null}
        <div className="capability-detail-actions">
          <button type="button" className="capability-secondary-action" disabled={isPending(`mcp-test:${selectedMcp.id}`)} onClick={() => void runOperation(`mcp-test:${selectedMcp.id}`, () => mcp?.onTest(selectedMcp.id), "MCP 连接检查已完成。")}>
            {isPending(`mcp-test:${selectedMcp.id}`) ? <LoaderCircle className="capability-spin" size={15} /> : <RefreshCw size={15} />}测试连接
          </button>
          <button type="button" className="capability-secondary-action capability-reject-action" disabled={isPending(`mcp-remove:${selectedMcp.id}`)} onClick={() => {
            if (!window.confirm(`确定移除 MCP 连接“${selectedMcp.name}”吗？`)) return;
            void runOperation(`mcp-remove:${selectedMcp.id}`, () => mcp?.onRemove(selectedMcp.id), "MCP 连接已移除。");
          }}><Trash2 size={15} />移除</button>
        </div>
        <div className="capability-mcp-tools">
          <div className="capability-resource-line">
            <strong>工具权限</strong>
            <span>{selectedMcp.tools.length ? `${selectedMcp.tools.length} 个已发现，稳定版暂不自动执行` : "请先测试连接以读取工具清单"}</span>
          </div>
          {selectedMcp.tools.map((tool) => {
            const busy = isPending(`mcp-tool:${selectedMcp.id}:${tool.name}`);
            const blocked = true;
            return (
              <div className="capability-mcp-tool-row" key={tool.name}>
                <div className="capability-mcp-tool-copy">
                  <div>
                    <strong>{tool.title}</strong>
                    <span className={`capability-pill capability-tool-${tool.risk}`}>
                      {tool.risk === "destructive" ? "已阻止" : "仅发现"}
                    </span>
                  </div>
                  <p>{tool.description}</p>
                  <small>{tool.inputSummary} · 外部 MCP 工具暂不进入自动执行链{tool.reportedReadOnlyHint ? " · Server 声明只读（仅供参考）" : ""}</small>
                </div>
                <ToggleControl
                  checked={tool.enabled}
                  busy={busy}
                  disabled={!selectedMcp.enabled || selectedMcp.status !== "connected" || blocked}
                  label={`${selectedMcp.name} 的 ${tool.title}`}
                  onChange={() => undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderDetail() {
    if (activeTab === "plugins") return renderPluginDetail();
    if (activeTab === "skills") return renderSkillDetail();
    if (activeTab === "mcp") return renderMcpDetail();
    if (activeTab === "prompts") return renderPromptDetail();
    return renderMemoryDetail();
  }

  return (
    <section className="capability-center">
      <header className="capability-heading">
        <button type="button" className="capability-icon-button" onClick={onBack} aria-label="返回工作区" title="返回工作区"><ArrowLeft size={18} /></button>
        <div><h1>能力中心</h1><p>{contextLabel ?? `${skills.length} 个 Skills · ${prompts.length} 组提示词 · ${memories.length} 条记忆`}</p></div>
      </header>

      <div className="capability-tabs" role="tablist" aria-label="能力中心页签">
        {availableTabs.map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tabLabels[tab]}</button>
        ))}
      </div>

      <div className="capability-toolbar">
        <label className="capability-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQueries((current) => ({ ...current, [activeTab]: event.target.value }))} placeholder={searchPlaceholder()} aria-label={searchPlaceholder()} />
          {query ? <button type="button" onClick={() => setQueries((current) => ({ ...current, [activeTab]: "" }))} aria-label="清除搜索" title="清除搜索"><X size={15} /></button> : null}
        </label>
        <select value={enabledFilter} onChange={(event) => setEnabledFilters((current) => ({ ...current, [activeTab]: event.target.value as EnabledFilter }))} aria-label="筛选启用状态">
          <option value="all">全部状态</option><option value="enabled">仅已启用</option><option value="disabled">仅已停用</option>
        </select>
        <span className="capability-result-count">{listCount()} 项</span>
        <div className="capability-toolbar-action">{renderToolbarAction()}</div>
      </div>

      {activeTab === "memories" ? (
        <div className="capability-scope-filters" aria-label="按记忆范围筛选">
          {(["all", "personal", "project", "case", "thread", "candidate"] as const).map((scope) => (
            <button key={scope} type="button" className={memoryScopeFilter === scope ? "active" : ""} onClick={() => setMemoryScopeFilter(scope)}>
              {scope === "all" ? "全部" : scope === "candidate" ? "待确认" : scopeLabels[scope]}
            </button>
          ))}
        </div>
      ) : null}

      {notice || localNotice || localError ? (
        <div className={`capability-notice${localError ? " error" : ""}`} role={localError ? "alert" : "status"}>
          {localError ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          <span>{localError || localNotice || notice}</span>
          {(localError || localNotice) ? <button type="button" onClick={() => { setLocalError(""); setLocalNotice(""); }} aria-label="关闭提示" title="关闭提示"><X size={14} /></button> : null}
        </div>
      ) : null}

      <div className="capability-work-area" role="tabpanel" aria-label={tabLabels[activeTab]}>
        <section className="capability-list" role="table" aria-label={`${tabLabels[activeTab]}列表`}>{renderList()}</section>
        <section className="capability-detail" aria-label={`${tabLabels[activeTab]}详情`}>{renderDetail()}</section>
      </div>

      {skillDiscovery ? (
        <CapabilityModal
          title="发现本机 Skills"
          icon={<RefreshCw size={17} />}
          onClose={() => setSkillDiscovery(null)}
          footer={<>
            <button type="button" className="capability-secondary-action" onClick={() => setSkillDiscovery(null)}>取消</button>
            <button
              type="button"
              className="capability-primary-action"
              disabled={selectedDiscoveredSkillIds.size === 0 || isPending("import-discovered-skills")}
              onClick={() => void runOperation("import-discovered-skills", async () => {
                await onImportDiscoveredSkills(skillDiscovery, [...selectedDiscoveredSkillIds]);
                setSkillDiscovery(null);
              }, "Skills 已导入，可按需启用。")}
            >
              {isPending("import-discovered-skills") ? <LoaderCircle className="capability-spin" size={16} /> : <FolderInput size={16} />}
              导入所选 {selectedDiscoveredSkillIds.size || ""}
            </button>
          </>}
        >
          <div className="capability-discovery-summary">
            {skillDiscovery.roots.map((root) => <span key={root.source}>{root.label} · {root.available ? `${root.skillCount} 个` : "未找到"}</span>)}
          </div>
          <div className="capability-discovery-list">
            {skillDiscovery.items.length === 0 ? <div className="capability-discovery-empty">没有发现可导入的 Skill。可将 Skill 文件夹放入 <code>~/.sap-ai-workbench/skills</code> 后重新扫描。</div> : skillDiscovery.items.map((item) => {
              const disabled = item.validationStatus !== "valid" || item.alreadyInstalled;
              return <label key={item.id} className={`capability-discovery-item${disabled ? " disabled" : ""}`}>
                <input type="checkbox" checked={selectedDiscoveredSkillIds.has(item.id)} disabled={disabled} onChange={() => toggleDiscoveredSkill(item.id)} />
                <span className="capability-discovery-copy"><strong>{item.name}</strong><small>{item.sourceLabel} · {item.relativePath}</small><span>{item.description}</span></span>
                <span className={`capability-validation-pill ${item.validationStatus === "valid" ? "valid" : "invalid"}`}>{item.alreadyInstalled ? "已导入" : item.validationStatus === "valid" ? item.hasScripts ? "含脚本（禁用）" : "可导入" : "格式错误"}</span>
              </label>;
            })}
          </div>
          {skillDiscovery.skippedSymlinkCount > 0 ? <p className="capability-discovery-footnote">为防止越界读取，已跳过 {skillDiscovery.skippedSymlinkCount} 个符号链接。</p> : null}
        </CapabilityModal>
      ) : null}

      {previewOpen && promptPreview ? (
        <CapabilityModal title={promptPreview.title} icon={<FileText size={17} />} onClose={() => setPreviewOpen(false)}>
          <div className="capability-preview-meta">{typeof promptPreview.estimatedTokens === "number" ? `约 ${promptPreview.estimatedTokens.toLocaleString("zh-CN")} token` : "尚未估算 token"}</div>
          {promptPreview.conflicts?.length ? <div className="capability-preview-conflicts"><strong>需要处理的冲突</strong>{promptPreview.conflicts.map((conflict) => <p key={conflict}><AlertTriangle size={14} />{conflict}</p>)}</div> : null}
          <pre className="capability-modal-text">{promptPreview.content}</pre>
        </CapabilityModal>
      ) : null}

      {mcpEditorOpen && mcp ? (
        <CapabilityModal
          title="添加 MCP 连接"
          icon={<Plug size={17} />}
          onClose={() => setMcpEditorOpen(false)}
          footer={<>
            <button type="button" className="capability-secondary-action" onClick={() => setMcpEditorOpen(false)}>取消</button>
            <button
              type="button"
              className="capability-primary-action"
              disabled={isPending("add-mcp") || !mcpDraft.name.trim() || !mcpDraft.endpoint.trim()}
              onClick={() => void runOperation("add-mcp", () => mcp.onAdd(mcpDraft), "MCP 连接已保存，默认保持停用；请先测试再启用。").then((completed) => {
                if (!completed) return;
                setMcpEditorOpen(false);
                setMcpDraft({ name: "", description: "", transport: "streamable-http", scope: "project", endpoint: "" });
              })}
            >
              {isPending("add-mcp") ? <LoaderCircle className="capability-spin" size={15} /> : <Save size={15} />}
              {isPending("add-mcp") ? "保存中" : "保存连接"}
            </button>
          </>}
        >
          <div className="capability-form-grid">
            <label><span>连接名称</span><input value={mcpDraft.name} onChange={(event) => setMcpDraft((value) => ({ ...value, name: event.target.value }))} placeholder="例如：本地文档工具" /></label>
            <label><span>范围</span><select value={mcpDraft.scope} onChange={(event) => setMcpDraft((value) => ({ ...value, scope: event.target.value as "global" | "project" }))}><option value="project">当前 Project</option><option value="global">全局</option></select></label>
            <label className="capability-form-wide"><span>说明（可选）</span><input value={mcpDraft.description} onChange={(event) => setMcpDraft((value) => ({ ...value, description: event.target.value }))} placeholder="说明这个连接提供什么能力" /></label>
            <label className="capability-form-wide"><span>HTTPS 地址</span><input value={mcpDraft.endpoint} onChange={(event) => setMcpDraft((value) => ({ ...value, endpoint: event.target.value }))} placeholder="https://example.com/mcp" /></label>
          </div>
          <p className="capability-form-note">稳定版只支持 HTTPS Streamable HTTP。连接和工具默认停用；Server 返回的 instructions 与只读声明都不会被直接信任。</p>
        </CapabilityModal>
      ) : null}

      {memoryEditorOpen ? (
        <CapabilityModal
          title="新增记忆候选"
          icon={<Brain size={17} />}
          onClose={() => setMemoryEditorOpen(false)}
          footer={<>
            <button type="button" className="capability-secondary-action" onClick={() => setMemoryEditorOpen(false)}>取消</button>
            <button
              type="button"
              className="capability-primary-action"
              disabled={isPending("create-memory") || !newMemoryDraft.content.trim()}
              onClick={() => void runOperation("create-memory", () => onCreateMemory(newMemoryDraft), "记忆候选已创建，请确认后再让它进入模型上下文。").then((completed) => {
                if (!completed) return;
                setMemoryEditorOpen(false);
                setNewMemoryDraft({
                  scope: availableMemoryScopes.includes("project") ? "project" : "personal",
                  kind: availableMemoryScopes.includes("project") ? "fact" : "preference",
                  topicKey: "",
                  content: ""
                });
              })}
            >
              {isPending("create-memory") ? <LoaderCircle className="capability-spin" size={15} /> : <Save size={15} />}
              {isPending("create-memory") ? "保存中" : "保存为待确认"}
            </button>
          </>}
        >
          <div className="capability-form-grid">
            <label><span>保存范围</span><select value={newMemoryDraft.scope} onChange={(event) => {
              const scope = event.target.value as CapabilityMemoryDraft["scope"];
              setNewMemoryDraft((value) => ({ ...value, scope, kind: scope === "personal" ? "preference" : value.kind }));
            }}>{availableMemoryScopes.map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label>
            <label><span>记忆类型</span><select value={newMemoryDraft.kind} onChange={(event) => setNewMemoryDraft((value) => ({ ...value, kind: event.target.value as CapabilityMemoryDraft["kind"] }))}>
              <option value="preference">表达偏好</option>
              {newMemoryDraft.scope !== "personal" ? <option value="fact">已确认事实</option> : null}
              {newMemoryDraft.scope !== "personal" ? <option value="constraint">约束条件</option> : null}
              {newMemoryDraft.scope !== "personal" ? <option value="decision">已确认决策</option> : null}
            </select></label>
            <label className="capability-form-wide"><span>主题（可选）</span><input value={newMemoryDraft.topicKey} onChange={(event) => setNewMemoryDraft((value) => ({ ...value, topicKey: event.target.value }))} placeholder="例如：输出格式、项目约束" /></label>
            <label className="capability-form-wide"><span>记忆内容</span><textarea className="capability-form-textarea capability-form-textarea-large" value={newMemoryDraft.content} onChange={(event) => setNewMemoryDraft((value) => ({ ...value, content: event.target.value }))} placeholder="只记录已经确认、后续确实需要复用的内容" /></label>
          </div>
          <p className="capability-form-note">新增内容默认是“待确认”，确认前不会进入任何模型上下文。个人范围只允许保存表达和格式偏好。</p>
        </CapabilityModal>
      ) : null}

      {sourceMemory ? (
        <CapabilityModal title="记忆来源" icon={<Link2 size={17} />} onClose={() => setSourceMemoryId("")}>
          <dl className="capability-source-detail"><div><dt>来源</dt><dd>{sourceMemory.sourceLabel}</dd></div><div><dt>范围</dt><dd>{itemScopeLabel(sourceMemory.scope, sourceMemory.scopeLabel)}</dd></div><div><dt>更新时间</dt><dd>{formatDate(sourceMemory.updatedAt)}</dd></div></dl>
          <pre className="capability-modal-text">{sourceMemory.sourceDetail || "没有更多来源说明。"}</pre>
        </CapabilityModal>
      ) : null}

      {memoryToDelete ? (
        <CapabilityModal
          title="删除记忆"
          icon={<Trash2 size={17} />}
          onClose={() => setDeleteMemoryId("")}
          footer={<><button type="button" className="capability-secondary-action" onClick={() => setDeleteMemoryId("")}>取消</button><button type="button" className="capability-danger-action" disabled={isPending(`memory-delete:${memoryToDelete.id}`)} onClick={() => void runOperation(`memory-delete:${memoryToDelete.id}`, () => onDeleteMemory(memoryToDelete.id), "记忆已删除。").then((completed) => { if (completed) setDeleteMemoryId(""); })}>{isPending(`memory-delete:${memoryToDelete.id}`) ? <LoaderCircle className="capability-spin" size={15} /> : <Trash2 size={15} />}{isPending(`memory-delete:${memoryToDelete.id}`) ? "删除中" : "确认删除"}</button></>}
        >
          <p className="capability-confirm-copy">将删除“{memoryToDelete.summary}”。删除后不会再进入后续上下文。</p>
        </CapabilityModal>
      ) : null}
    </section>
  );
}

export default CapabilityCenter;
