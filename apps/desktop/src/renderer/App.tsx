import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  HelpCircle,
  Mic,
  PanelLeft,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import ConfigCenter from "./ConfigCenter";
import KnowledgeCenter from "./KnowledgeCenter";
import StandardsCenter from "./StandardsCenter";
import type { AdtVerificationReport, CaseFileNode, CaseFilePreview, CaseMessage, CopyProjectStandardsFromProjectInput, CopyProjectStandardsInput, FeishuVerificationReport, KnowledgeItemActionInput, ModelProviderVerificationReport, ProjectSecretInput, ProjectSummary, SapObjectEvidenceType, SaveProjectStandardsInput, SearchResult, TaskMode, WorkbenchState } from "../shared/workbenchTypes";

const modes: { id: TaskMode; label: string }[] = [
  { id: "problem-analysis", label: "问题分析" },
  { id: "abap-development", label: "ABAP开发" },
  { id: "document-generation", label: "文档生成" },
  { id: "flow-diagram", label: "画流程图" }
];

const sapEvidenceTypes: { id: SapObjectEvidenceType; label: string }[] = [
  { id: "program", label: "程序" },
  { id: "class", label: "类" },
  { id: "function", label: "函数" },
  { id: "include", label: "Include" },
  { id: "table", label: "表" },
  { id: "structure", label: "结构" }
];

const modePlaceholder: Record<TaskMode, string> = {
  "problem-analysis": "描述 SAP 问题或补充现象；将生成结论、核对清单、证据和候选知识",
  "abap-development": "描述 ABAP 开发或修改需求；将生成只读开发草稿、请求说明和快照说明",
  "document-generation": "说明要生成的文档；将生成开发说明书、上线清单和飞书发布准备说明",
  "flow-diagram": "描述业务流程或逻辑；将生成 Mermaid 图、说明和节点清单"
};

function verificationModeLabel(mode: "fake" | "cli" | "http" | "adt" | null | undefined): string {
  if (mode === "fake") return "模拟验证";
  if (mode === "cli") return "真实 CLI 验证";
  if (mode === "http") return "真实 HTTP 验证";
  return "验证";
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

function searchResultPreviewPath(result: SearchResult, state: WorkbenchState | null): string | null {
  if (
    result.type !== "file" ||
    !result.sourcePath ||
    result.projectId !== state?.activeProjectId ||
    result.caseId !== state?.activeCaseId
  ) return null;
  return result.sourcePath;
}

function fileIcon(node: CaseFileNode) {
  if (node.kind === "directory") return Folder;
  if (node.fileType === "xlsx" || node.fileType === "xls" || node.fileType === "csv" || node.name.includes("核对") || node.name.includes("清单")) return FileSpreadsheet;
  return File;
}

function fileAnchorId(relativePath: string): string {
  return `file-${encodeURIComponent(relativePath)}`;
}

function flattenFiles(nodes: CaseFileNode[]): CaseFileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenFiles(node.children) : [])]);
}

function filterFileNodes(nodes: CaseFileNode[], query: string): CaseFileNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes.flatMap((node) => {
    const children = node.children ? filterFileNodes(node.children, query) : [];
    const matched = node.name.toLowerCase().includes(normalized) || node.relativePath.toLowerCase().includes(normalized);
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

function safeDraftModel(project: ProjectSummary | undefined) {
  const provider = project?.config.apiProviders.find((item) => (
    item.enabled &&
    item.modelSyncStatus === "verified" &&
    item.chatTestStatus === "verified" &&
    item.lastVerificationMode === "http" &&
    item.models.length > 0
  ));
  const model = provider?.models[0];
  return provider && model ? { provider, model } : null;
}

function FileRows({ nodes, level = 0, selectedPath, onPreview }: { nodes: CaseFileNode[]; level?: number; selectedPath: string | null; onPreview: (node: CaseFileNode) => void }) {
  return (
    <>
      {nodes.map((node) => {
        const Icon = fileIcon(node);
        const isSelected = node.relativePath === selectedPath;
        const rowContent = (
          <>
            <Icon size={18} />
            <span title={node.relativePath}>{node.name}</span>
            <em>{node.kind === "directory" ? "" : `${formatSize(node.sizeBytes)} · 预览`}</em>
          </>
        );
        return (
          <div className="file-node" id={fileAnchorId(node.relativePath)} key={node.relativePath}>
            {node.kind === "file" ? (
              <button
                type="button"
                className={`file-row file-row-button file-${node.kind}${isSelected ? " selected" : ""}`}
                style={{ paddingLeft: `${level * 16}px` }}
                onClick={() => onPreview(node)}
                title="预览当前案件文件"
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
      <ul>
        <li><strong>边界：</strong>{isModelDraft ? "只调用已验证模型生成安全本地草稿，不读取 SAP、不发布飞书。" : "当前仅保存本地案件文件，不调用真实模型、SAP 或飞书。"}</li>
        <li><strong>安全：</strong>所有文件位于被忽略的 local-data，候选知识不会自动入库。</li>
      </ul>
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

function App() {
  const appInfo = window.workbench?.getAppInfo();
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<CaseFilePreview | null>(null);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [activeView, setActiveView] = useState<"case" | "config" | "standards" | "knowledge">("case");
  const [filesPanelVisible, setFilesPanelVisible] = useState(true);
  const [selectedTaskMode, setSelectedTaskMode] = useState<TaskMode>("problem-analysis");
  const [sapEvidenceType, setSapEvidenceType] = useState<SapObjectEvidenceType>("program");
  const [sapEvidenceName, setSapEvidenceName] = useState("");
  const [sapEvidenceFunctionGroup, setSapEvidenceFunctionGroup] = useState("");
  const [sapEvidenceBusy, setSapEvidenceBusy] = useState(false);
  const [feishuHandoffBusy, setFeishuHandoffBusy] = useState(false);
  const [notice, setNotice] = useState("Phase 13：真实 ADT 只读取证仅允许单个固定对象 GET；不写 SAP、不跑 SQL、不发飞书。");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const bridge = window.workbench;
  const project = activeProject(state);
  const currentCase = activeCase(state);
  const selectedSafeDraftModel = useMemo(() => safeDraftModel(project), [project]);
  const adtEvidenceStatus = project?.config.adt
    ? `${project.config.adt.alias || "SAP"} / Client ${project.config.adt.client || "-"} / ${project.config.adt.readOnly ? "readonly" : "blocked"} / ${verificationModeLabel(project.config.adt.lastVerificationMode)}`
    : "No active SAP project";
  const flatFiles = useMemo(() => flattenFiles(state?.activeCaseFiles ?? []), [state]);
  const filteredCaseFiles = useMemo(() => filterFileNodes(state?.activeCaseFiles ?? [], fileSearchQuery), [state, fileSearchQuery]);
  const filteredFileCount = useMemo(() => flattenFiles(filteredCaseFiles).filter((node) => node.kind === "file").length, [filteredCaseFiles]);
  const fileCount = useMemo(() => flatFiles.filter((node) => node.kind === "file").length, [flatFiles]);
  const outputFileCount = useMemo(() => flatFiles.filter((node) => node.kind === "file" && node.relativePath.startsWith("outputs/")).length, [flatFiles]);
  const selectedPreviewNode = useMemo(() => selectedPreviewPath ? flatFiles.find((node) => node.relativePath === selectedPreviewPath) ?? null : null, [flatFiles, selectedPreviewPath]);

  async function applyResponse<T extends WorkbenchState>(responsePromise: Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
    const response = await responsePromise;
    if (response.ok) {
      setState(response.data);
      setNotice("本地案件输出文件已更新，可在右侧文件面板查看。");
    } else {
      setNotice(response.error);
    }
  }

  useEffect(() => {
    if (!bridge) {
      setNotice("浏览器预览仅显示界面；请用桌面应用启动本地文件闭环。");
      return;
    }

    bridge.getState().then((response) => {
      if (response.ok) setState(response.data);
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
    await applyResponse(bridge.createDemoProject());
  }

  async function createCase() {
    if (!bridge) {
      setNotice("请在桌面应用中创建本地案件。");
      return;
    }
    await applyResponse(bridge.createDemoCase());
  }

  async function sendMessage() {
    if (!bridge) {
      setNotice("浏览器预览不会写入本地文件；请用桌面应用发送。");
      return;
    }
    await applyResponse(bridge.appendMessage({ content: message, taskMode: selectedTaskMode, modelId: selectedSafeDraftModel?.model.id ?? "local-workflow" }));
    setMessage("");
  }

  async function readSapEvidence() {
    if (!bridge) {
      setNotice("Please use the desktop app to attach SAP read-only evidence.");
      return;
    }
    const objectName = sapEvidenceName.trim();
    if (!objectName) {
      setNotice("Please enter one SAP object name before attaching evidence.");
      return;
    }
    setSapEvidenceBusy(true);
    try {
      const functionGroup = sapEvidenceType === "function" ? sapEvidenceFunctionGroup.trim() : "";
      if (sapEvidenceType === "function" && !functionGroup) {
        setNotice("Function evidence requires the function group name, for example ZFG_MM001.");
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
        setNotice(`SAP read-only evidence attached: ${response.data.summary.objectType} ${response.data.summary.objectName}. Files: ${response.data.generatedFiles.join(", ")}`);
      } else {
        setNotice(response.error);
      }
    } finally {
      setSapEvidenceBusy(false);
    }
  }

  async function prepareFeishuHandoff() {
    if (!bridge) {
      setNotice("Please use the desktop app to prepare a Feishu local handoff draft.");
      return;
    }
    setFeishuHandoffBusy(true);
    try {
      const response = await bridge.prepareFeishuHandoff();
      if (response.ok) {
        setState(response.data.state);
        setNotice(`Local Feishu draft prepared. Publish status: ${response.data.publishStatus}. Files: ${response.data.generatedFiles.join(", ")}`);
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

  async function previewSearchResult(result: SearchResult) {
    const previewPath = searchResultPreviewPath(result, state);
    if (!previewPath) return;
    const node = flatFiles.find((file) => file.kind === "file" && file.relativePath === previewPath);
    if (node) await previewCaseFile(node);
  }

  async function saveProjectConfig(projectId: string, config: ProjectSummary["config"]) {
    if (!bridge) {
      setNotice("请在桌面应用中保存项目配置。");
      return;
    }
    const response = await bridge.saveProjectConfig(projectId, config);
    if (response.ok) {
      setState(response.data);
      setNotice("配置草稿已保存；相关验证状态已回到待验证。");
    } else {
      setNotice(response.error);
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
      setNotice("密钥已保存到系统安全存储；请继续执行 ADT 只读验证。");
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
      setNotice(response.data.report.ok ? `${verificationModeLabel(response.data.report.mode)}通过：仅代表 CLI、登录和权限状态可用，尚未创建或发布文档。` : `飞书 CLI 验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
      return response.data.report;
    }
    setNotice(response.error);
    return null;
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
        <div className="topbar-left">
          <button aria-label="折叠侧边栏" className="icon-button"><PanelLeft size={18} /></button>
          <button aria-label="后退" className="icon-button"><ChevronLeft size={18} /></button>
          <button aria-label="前进" className="icon-button muted"><ChevronRight size={18} /></button>
          <nav className="menu-links" aria-label="应用菜单">
            <span>文件</span>
            <span>编辑</span>
            <span>视图</span>
            <span>帮助</span>
          </nav>
        </div>
        <div className="product-title">
          <span className="local-dot" aria-hidden="true" />
          <strong>{appInfo?.name ?? "SAP AI 顾问工作台"}</strong>
          <span>{appInfo?.phase ?? "Phase 13"} · 本地模式</span>
        </div>
        <div className="window-actions" aria-hidden="true">
          <span>－</span>
          <span>□</span>
          <span>×</span>
        </div>
      </header>

      <section className={`workspace ${filesPanelVisible ? "" : "files-collapsed"}`}>
        <aside className="sidebar">
          <div className="primary-nav">
            <button onClick={createCase} title="创建一个新的本地案件文件夹"><PenLine size={18} />新案件</button>
            <button onClick={() => searchInputRef.current?.focus()} title="聚焦本地搜索框，可搜索项目、案件、文件名、知识和安全输出摘要"><Search size={18} />搜索</button>
            <button className={activeView === "config" ? "active" : ""} onClick={() => setActiveView("config")} title="保存当前项目的非密钥配置草稿"><Settings size={18} />配置中心</button>
            <button className={activeView === "standards" ? "active" : ""} onClick={() => setActiveView("standards")} title="编辑当前项目的独立规范副本"><BookOpen size={18} />规范中心</button>
            <button className={activeView === "knowledge" ? "active" : ""} onClick={() => setActiveView("knowledge")} title="候选知识人工确认后入库"><Archive size={18} />知识库</button>
          </div>

          <label className="sidebar-search">
            <Search size={15} />
            <input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索项目、案件、文件名、本地案件安全输出摘要" />
          </label>

          {searchResults.length > 0 ? (
            <section className="search-results">
              <strong>搜索结果 · 含本地案件安全输出摘要</strong>
              {searchResults.map((result) => {
                const canPreview = Boolean(searchResultPreviewPath(result, state));
                const content = (
                  <>
                    <span>{searchResultLabel(result)}</span>
                    <b>{result.title}</b>
                    <small>{result.location}</small>
                    <p>{result.snippet}</p>
                  </>
                );
                return canPreview ? (
                  <button className="search-result search-result-button" type="button" onClick={() => void previewSearchResult(result)} title="在右侧打开当前案件只读预览" key={result.id}>
                    {content}
                  </button>
                ) : (
                  <div className="search-result" key={result.id}>
                    {content}
                  </div>
                );
              })}
            </section>
          ) : null}

          <div className="project-header">
            <span>项目</span>
            <button onClick={createProject} title="创建本地项目，不连接真实 SAP"><Plus size={16} />添加本地项目</button>
            <button aria-label="项目更多" title="当前阶段暂无更多项目动作"><ChevronDown size={16} /></button>
          </div>

          <div className="project-list">
            {(state?.projects ?? []).map((item) => (
              <section className="project-card" key={item.id}>
                <div className="project-card-title">
                  <div>
                    <strong>SAP&nbsp;&nbsp;{item.name}</strong>
                    <div className="project-tags">
                      <StatusPill label={item.systemLabel} tone="blue" />
                      <StatusPill label={item.connectionState === "local-demo" ? "本地模式" : "未验证"} tone={item.connectionState === "local-demo" ? "blue" : "orange"} />
                    </div>
                  </div>
                  <button aria-label={`${item.name} 设置`} className="icon-button" onClick={() => setActiveView("config")} title="打开当前项目配置"><Settings size={16} /></button>
                </div>
                <div className="case-list">
                  {item.cases.map((caseItem) => (
                    <button className={caseItem.id === state?.activeCaseId ? "case-row active" : "case-row"} key={caseItem.id}>
                      <span>{caseItem.title}</span>
                      <time>{formatTime(caseItem.updatedAt)}</time>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="profile">
            <div className="avatar">DE</div>
            <div>
              <strong>演示用户</strong>
              <span>本地个人版</span>
            </div>
            <button aria-label="编辑个人信息" className="icon-button" title="当前阶段暂不编辑个人信息"><PenLine size={15} /></button>
          </footer>
        </aside>

        {activeView === "config" ? (
          <ConfigCenter project={project} notice={notice} onBack={() => setActiveView("case")} onSave={saveProjectConfig} onSaveSecret={saveProjectSecret} onVerifyAdt={verifyAdtReadonly} onVerifyFeishu={verifyFeishuCli} onVerifyModelProvider={verifyModelProvider} />
        ) : activeView === "standards" ? (
          <StandardsCenter
            project={project}
            projects={state?.projects ?? []}
            notice={notice}
            onBack={() => setActiveView("case")}
            onCopyTemplate={(projectId, templateId) => copyProjectStandardsTemplate(projectId, { templateId })}
            onCopyFromProject={(projectId, sourceProjectId) => copyProjectStandardsFromProject(projectId, { sourceProjectId })}
            onSave={saveProjectStandards}
          />
        ) : activeView === "knowledge" ? (
          <KnowledgeCenter
            project={project}
            notice={notice}
            onBack={() => setActiveView("case")}
            onPublish={publishKnowledge}
            onMarkConflict={markKnowledgeConflicted}
            onExpire={expireKnowledge}
          />
        ) : (
        <>
        <section className="conversation-panel">
          <div className="case-heading">
            <div>
              <h1>{currentCase?.title ?? "本地案件"}</h1>
              <p>{project ? `${project.name} · ${project.systemLabel} · 本地输出` : "请创建本地项目"}</p>
            </div>
            <div className="case-heading-actions">
              {!filesPanelVisible ? <button aria-label="显示文件面板" title="显示当前案件文件" className="icon-button" onClick={() => setFilesPanelVisible(true)}><PanelLeft size={18} /></button> : null}
              <button aria-label="当前案件帮助" title="案件=对话+文件夹+可追溯成果" className="icon-button"><HelpCircle size={18} /></button>
            </div>
          </div>

          <div className="phase-notice">
            <ShieldCheck size={16} />
            <span>{notice}</span>
          </div>

          <div className="conversation-flow">
            {(currentCase?.messages ?? []).map((item) => (
              <MessageBubble message={item} files={flatFiles} onPreview={previewCaseFile} key={item.id} />
            ))}

            {state?.activeCaseFiles.length ? (
              <article className="assistant-message">
                <div className="run-time">本地文件树已读取 &gt;</div>
                <p>当前案件目录已经生成，右侧文件面板来自真实本地目录。</p>
                <div className="file-chips">
                  {flatFiles.filter((node) => node.kind === "file").slice(0, 3).map((node) => {
                    const Icon = fileIcon(node);
                    return (
                      <button type="button" onClick={() => previewCaseFile(node)} key={node.relativePath} title="打开本地只读预览">
                        <Icon size={22} />
                        {node.name}
                        <span>{formatSize(node.sizeBytes)} · 预览</span>
                      </button>
                    );
                  })}
                </div>
              </article>
            ) : null}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
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
              <button type="button" onClick={() => void readSapEvidence()} disabled={sapEvidenceBusy || !sapEvidenceName.trim()} title="把单个 SAP 只读对象证据写入当前案件">
                <Database size={15} />
                {sapEvidenceBusy ? "取证中" : "补充 SAP 只读证据"}
              </button>
            </div>
            <div className="mode-tabs" role="tablist" aria-label="任务模式">
              {modes.map((mode, index) => (
                <button className={mode.id === selectedTaskMode ? "selected" : ""} type="button" key={mode.id} title="Phase 13 支持真实 ADT 单对象只读取证，仍保留安全模型草稿能力" onClick={() => setSelectedTaskMode(mode.id)}>
                  {index === 0 ? <Sparkles size={15} /> : index === 1 ? <Bot size={15} /> : <File size={15} />}
                  {mode.label}
                </button>
              ))}
            </div>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} aria-label="继续追问" placeholder={modePlaceholder[selectedTaskMode]} />
            <div className="composer-footer">
              <button type="button" className={`model-select ${selectedSafeDraftModel ? "ready" : "disabled"}`} title={selectedSafeDraftModel ? `案件发送会尝试使用 ${selectedSafeDraftModel.provider.name} / ${selectedSafeDraftModel.model.id} 生成安全本地草稿` : "没有真实 HTTP 验证通过的模型渠道；发送时只生成本地草稿"}>
                {selectedSafeDraftModel ? `已验证模型 · ${selectedSafeDraftModel.model.displayName}` : "未验证模型 · 使用本地草稿"} <ChevronDown size={15} />
              </button>
              <div className="composer-actions">
                <button type="button" aria-label="添加附件暂不可用" title="当前阶段暂不支持附件" className="icon-button" disabled><Paperclip size={18} /></button>
                <button type="button" aria-label="语音输入暂不可用" title="当前阶段暂不支持语音" className="icon-button" disabled><Mic size={18} /></button>
                <button type="submit" aria-label="保存到当前案件" className="send-button"><Send size={18} /></button>
              </div>
            </div>
          </form>
        </section>

        {filesPanelVisible ? <aside className="files-panel">
          <div className="files-heading">
            <h2>当前案件文件</h2>
            <button aria-label="隐藏文件面板" title="只隐藏显示，不影响文件保存" className="icon-button" onClick={() => setFilesPanelVisible(false)}><PanelLeft size={17} /></button>
          </div>
          <label className="file-search">
            <Search size={16} />
            <input value={fileSearchQuery} onChange={(event) => setFileSearchQuery(event.target.value)} placeholder="搜索当前案件文件名" />
          </label>
          <div className="file-panel-actions">
            <button type="button" onClick={() => void prepareFeishuHandoff()} disabled={feishuHandoffBusy || outputFileCount === 0} title="Generate local Feishu-ready draft files from current case outputs. This does not publish or update cloud documents.">
              <FileText size={15} />
              {feishuHandoffBusy ? "Preparing local draft" : "Prepare local Feishu draft"}
            </button>
          </div>
          <div className="file-tree">
            {state?.activeCaseFiles.length ? (
              filteredCaseFiles.length ? <FileRows nodes={filteredCaseFiles} selectedPath={selectedPreviewPath} onPreview={previewCaseFile} /> : <div className="empty-state">没有匹配的当前案件文件。</div>
            ) : <div className="empty-state">请在桌面应用中创建本地案件。</div>}
          </div>
          <section className={`file-preview${filePreviewError ? " file-preview-blocked" : ""}`}>
            <div className="file-preview-heading">
              <div>
                <strong>{filePreview?.displayName ?? selectedPreviewNode?.displayName ?? "本地只读预览"}</strong>
                <span>{filePreview?.relativePath ?? selectedPreviewNode?.relativePath ?? "点击上方文件查看安全文本预览"}</span>
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
            ) : filePreviewError ? (
              <p>{filePreviewError}</p>
            ) : (
              <p>只支持预览当前案件里的 Markdown、文本、CSV 和 Mermaid 文件；不会打开电脑上的任意路径。</p>
            )}
          </section>
          <div className="files-footer">
            <span>{fileSearchQuery.trim() ? `${filteredFileCount} / ${fileCount} 个文件` : `${fileCount} 个文件`}</span>
            <span><ShieldCheck size={15} />本地输出数据</span>
          </div>
        </aside> : null}
        </>
        )}
      </section>
    </main>
  );
}

export default App;
