import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  File,
  FileSpreadsheet,
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
import type { AdtVerificationReport, CaseFileNode, CaseMessage, FeishuVerificationReport, ModelProviderVerificationReport, ProjectSecretInput, ProjectSummary, SearchResult, TaskMode, WorkbenchState } from "../shared/workbenchTypes";

const modes: { id: TaskMode; label: string }[] = [
  { id: "problem-analysis", label: "问题分析" },
  { id: "abap-development", label: "ABAP开发" },
  { id: "document-generation", label: "文档生成" },
  { id: "flow-diagram", label: "画流程图" }
];

const modePlaceholder: Record<TaskMode, string> = {
  "problem-analysis": "描述 SAP 问题或补充现象；本阶段会沉淀到当前案件文件",
  "abap-development": "描述 ABAP 开发或修改需求；本阶段会生成只读开发说明和快照占位",
  "document-generation": "说明要生成的文档；本阶段会生成本地 Markdown 草稿",
  "flow-diagram": "描述业务流程或逻辑；本阶段会生成 Mermaid 流程图草稿"
};

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

function fileIcon(node: CaseFileNode) {
  if (node.kind === "directory") return Folder;
  if (node.fileType === "xlsx" || node.fileType === "xls" || node.name.includes("核对")) return FileSpreadsheet;
  return File;
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

function FileRows({ nodes, level = 0 }: { nodes: CaseFileNode[]; level?: number }) {
  return (
    <>
      {nodes.map((node) => {
        const Icon = fileIcon(node);
        return (
          <div className="file-node" key={node.relativePath}>
            <div className={`file-row file-${node.kind}`} style={{ paddingLeft: `${level * 16}px` }}>
              <Icon size={18} />
              <span title={node.relativePath}>{node.name}</span>
              <em>{node.kind === "directory" ? "" : formatSize(node.sizeBytes)}</em>
            </div>
            {node.children?.length ? <FileRows nodes={node.children} level={level + 1} /> : null}
          </div>
        );
      })}
    </>
  );
}

function MessageBubble({ message, files }: { message: CaseMessage; files: CaseFileNode[] }) {
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

  return (
    <article className="assistant-message">
      <div className="run-time">本地演示回复 · {formatTime(message.createdAt)} &gt;</div>
      <p>{message.content}</p>
      <ul>
        <li><strong>边界：</strong>当前仅保存本地案件文件，不调用真实模型、SAP 或飞书。</li>
        <li><strong>安全：</strong>所有文件位于被忽略的 local-data，候选知识不会自动入库。</li>
      </ul>
      {linkedFiles.length > 0 ? (
        <div className="file-chips">
          {linkedFiles.map((node) => {
            const Icon = fileIcon(node);
            return (
              <a href={`#${node.relativePath}`} key={node.relativePath}>
                <Icon size={22} />
                {node.name}
                <span>{formatSize(node.sizeBytes)}</span>
              </a>
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
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [activeView, setActiveView] = useState<"case" | "config">("case");
  const [filesPanelVisible, setFilesPanelVisible] = useState(true);
  const [selectedTaskMode, setSelectedTaskMode] = useState<TaskMode>("problem-analysis");
  const [notice, setNotice] = useState("Phase 4：本地案件工作流会保存对话、时间线、上下文包和模式输出；不调用真实 SAP / 飞书 / 模型。");

  const bridge = window.workbench;
  const project = activeProject(state);
  const currentCase = activeCase(state);
  const flatFiles = useMemo(() => flattenFiles(state?.activeCaseFiles ?? []), [state]);
  const filteredCaseFiles = useMemo(() => filterFileNodes(state?.activeCaseFiles ?? [], fileSearchQuery), [state, fileSearchQuery]);
  const filteredFileCount = useMemo(() => flattenFiles(filteredCaseFiles).filter((node) => node.kind === "file").length, [filteredCaseFiles]);
  const fileCount = useMemo(() => flatFiles.filter((node) => node.kind === "file").length, [flatFiles]);

  async function applyResponse<T extends WorkbenchState>(responsePromise: Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
    const response = await responsePromise;
    if (response.ok) {
      setState(response.data);
      setNotice("本地案件文件已更新。");
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
      setNotice("请在桌面应用中创建本地演示项目。");
      return;
    }
    await applyResponse(bridge.createDemoProject());
  }

  async function createCase() {
    if (!bridge) {
      setNotice("请在桌面应用中创建本地演示案件。");
      return;
    }
    await applyResponse(bridge.createDemoCase());
  }

  async function sendMessage() {
    if (!bridge) {
      setNotice("浏览器预览不会写入本地文件；请用桌面应用发送。");
      return;
    }
    await applyResponse(bridge.appendMessage({ content: message, taskMode: selectedTaskMode, modelId: "local-workflow" }));
    setMessage("");
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
      setNotice(response.data.report.ok ? "ADT 只读验证通过：T000 最小读取已完成。" : `ADT 只读验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
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
      setNotice(response.data.report.ok ? "飞书 CLI 验证通过：仅代表 CLI、登录和权限状态可用，尚未创建或发布文档。" : `飞书 CLI 验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
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
      setNotice(response.data.report.ok ? "模型渠道验证通过：仅代表渠道连通和最小对话通过，尚未进入案件任务。" : `模型渠道验证未通过：${firstError?.message ?? "请查看验证报告。"}`);
      return response.data.report;
    }
    setNotice(response.error);
    return null;
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
          <span>{appInfo?.phase ?? "Phase 4"} · 本地模式</span>
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
            <button title="当前只搜索本地项目、案件和文件名"><Search size={18} />搜索</button>
            <button className={activeView === "config" ? "active" : ""} onClick={() => setActiveView("config")} title="保存当前项目的非密钥配置草稿"><Settings size={18} />配置中心</button>
            <button title="Phase 4 暂不编辑真实规范"><BookOpen size={18} />规范中心</button>
            <button title="候选知识后续人工确认入库"><Archive size={18} />知识库</button>
          </div>

          <label className="sidebar-search">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索本地项目、案件、文件名" />
          </label>

          {searchResults.length > 0 ? (
            <section className="search-results">
              <strong>搜索结果</strong>
              {searchResults.map((result) => (
                <div className="search-result" key={result.id}>
                  <span>{result.type === "project" ? "项目" : result.type === "case" ? "案件" : "文件"}</span>
                  <b>{result.title}</b>
                  <small>{result.location}</small>
                </div>
              ))}
            </section>
          ) : null}

          <div className="project-header">
            <span>项目</span>
            <button onClick={createProject} title="创建本地演示项目，不连接真实 SAP"><Plus size={16} />添加演示项目</button>
            <button aria-label="项目更多" title="Phase 4 暂无更多项目动作"><ChevronDown size={16} /></button>
          </div>

          <div className="project-list">
            {(state?.projects ?? []).map((item) => (
              <section className="project-card" key={item.id}>
                <div className="project-card-title">
                  <div>
                    <strong>SAP&nbsp;&nbsp;{item.name}</strong>
                    <div className="project-tags">
                      <StatusPill label={item.systemLabel} tone="blue" />
                      <StatusPill label={item.connectionState === "local-demo" ? "本地演示" : "未验证"} tone={item.connectionState === "local-demo" ? "blue" : "orange"} />
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
            <button aria-label="编辑个人信息" className="icon-button" title="Phase 4 暂不编辑个人信息"><PenLine size={15} /></button>
          </footer>
        </aside>

        {activeView === "config" ? (
          <ConfigCenter project={project} notice={notice} onBack={() => setActiveView("case")} onSave={saveProjectConfig} onSaveSecret={saveProjectSecret} onVerifyAdt={verifyAdtReadonly} onVerifyFeishu={verifyFeishuCli} onVerifyModelProvider={verifyModelProvider} />
        ) : (
        <>
        <section className="conversation-panel">
          <div className="case-heading">
            <div>
              <h1>{currentCase?.title ?? "本地演示案件"}</h1>
              <p>{project ? `${project.name} · ${project.systemLabel} · 本地演示` : "请创建本地演示项目"}</p>
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
              <MessageBubble message={item} files={flatFiles} key={item.id} />
            ))}

            {state?.activeCaseFiles.length ? (
              <article className="assistant-message">
                <div className="run-time">本地文件树已读取 &gt;</div>
                <p>当前案件目录已经生成，右侧文件面板来自真实本地目录。</p>
                <div className="file-chips">
                  {flatFiles.filter((node) => node.kind === "file").slice(0, 3).map((node) => {
                    const Icon = fileIcon(node);
                    return (
                      <a href={`#${node.relativePath}`} key={node.relativePath}>
                        <Icon size={22} />
                        {node.name}
                        <span>{formatSize(node.sizeBytes)}</span>
                      </a>
                    );
                  })}
                </div>
              </article>
            ) : null}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <div className="mode-tabs" role="tablist" aria-label="任务模式">
              {modes.map((mode, index) => (
                <button className={mode.id === selectedTaskMode ? "selected" : ""} type="button" key={mode.id} title="Phase 4 会按该模式生成本地案件文件" onClick={() => setSelectedTaskMode(mode.id)}>
                  {index === 0 ? <Sparkles size={15} /> : index === 1 ? <Bot size={15} /> : <File size={15} />}
                  {mode.label}
                </button>
              ))}
            </div>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} aria-label="继续追问" placeholder={modePlaceholder[selectedTaskMode]} />
            <div className="composer-footer">
              <button type="button" className="model-select disabled" title="Phase 4 仍不调用真实模型">本地工作流 · 不接模型 <ChevronDown size={15} /></button>
              <div className="composer-actions">
                <button type="button" aria-label="添加附件暂不可用" title="Phase 4 暂不支持附件" className="icon-button" disabled><Paperclip size={18} /></button>
                <button type="button" aria-label="语音输入暂不可用" title="Phase 4 暂不支持语音" className="icon-button" disabled><Mic size={18} /></button>
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
          <div className="file-tree">
            {state?.activeCaseFiles.length ? (
              filteredCaseFiles.length ? <FileRows nodes={filteredCaseFiles} /> : <div className="empty-state">没有匹配的当前案件文件。</div>
            ) : <div className="empty-state">请在桌面应用中创建本地演示案件。</div>}
          </div>
          <div className="files-footer">
            <span>{fileSearchQuery.trim() ? `${filteredFileCount} / ${fileCount} 个文件` : `${fileCount} 个文件`}</span>
            <span><ShieldCheck size={15} />本地演示数据</span>
          </div>
        </aside> : null}
        </>
        )}
      </section>
    </main>
  );
}

export default App;
