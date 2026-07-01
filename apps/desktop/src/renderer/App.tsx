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
import type { CaseFileNode, CaseMessage, ProjectSummary, SearchResult, WorkbenchState } from "../shared/workbenchTypes";

const modes = ["问题分析", "ABAP开发", "文档生成", "画流程图"];

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

function MessageBubble({ message }: { message: CaseMessage }) {
  if (message.role === "user") {
    return (
      <div className="user-message">
        {message.content}
        <time>{formatTime(message.createdAt)}</time>
      </div>
    );
  }

  return (
    <article className="assistant-message">
      <div className="run-time">本地演示回复 · {formatTime(message.createdAt)} &gt;</div>
      <p>{message.content}</p>
      <ul>
        <li><strong>边界：</strong>当前仅保存本地案件文件，不调用真实模型。</li>
        <li><strong>安全：</strong>SAP、飞书、API 尚未接入，所有文件位于被忽略的 local-data。</li>
      </ul>
    </article>
  );
}

function App() {
  const appInfo = window.workbench?.getAppInfo();
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [notice, setNotice] = useState("Phase 1B：本地案件闭环，未接入真实 SAP / 飞书 / 模型 API。");

  const bridge = window.workbench;
  const project = activeProject(state);
  const currentCase = activeCase(state);
  const fileCount = useMemo(() => flattenFiles(state?.activeCaseFiles ?? []).filter((node) => node.kind === "file").length, [state]);

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
    await applyResponse(bridge.appendMessage(message));
    setMessage("");
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
          <span>{appInfo?.phase ?? "Phase 1B"} · 本地模式</span>
        </div>
        <div className="window-actions" aria-hidden="true">
          <span>－</span>
          <span>□</span>
          <span>×</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="primary-nav">
            <button onClick={createCase} title="创建一个新的本地案件文件夹"><PenLine size={18} />新案件</button>
            <button title="当前只搜索本地项目、案件和文件名"><Search size={18} />搜索</button>
            <button title="Phase 1B 暂不接真实配置"><Settings size={18} />配置中心</button>
            <button title="Phase 1B 暂不编辑真实规范"><BookOpen size={18} />规范中心</button>
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
            <button aria-label="项目更多" title="Phase 1B 暂无更多项目动作"><ChevronDown size={16} /></button>
          </div>

          <div className="project-list">
            {(state?.projects ?? []).map((item) => (
              <section className="project-card" key={item.id}>
                <div className="project-card-title">
                  <div>
                    <strong>SAP&nbsp;&nbsp;{item.name}</strong>
                    <div className="project-tags">
                      <StatusPill label={item.systemLabel} tone="green" />
                      <StatusPill label={item.connectionState === "demo-readonly" ? "本地演示" : "未验证"} tone="green" />
                    </div>
                  </div>
                  <button aria-label={`${item.name} 设置`} className="icon-button" title="配置中心后续阶段启用"><Settings size={16} /></button>
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
            <button aria-label="编辑个人信息" className="icon-button" title="Phase 1B 暂不编辑个人信息"><PenLine size={15} /></button>
          </footer>
        </aside>

        <section className="conversation-panel">
          <div className="case-heading">
            <div>
              <h1>{currentCase?.title ?? "本地演示案件"}</h1>
              <p>{project ? `${project.name} · ${project.systemLabel} · 本地演示` : "请创建本地演示项目"}</p>
            </div>
            <button aria-label="当前案件帮助" title="案件=对话+文件夹+可追溯成果" className="icon-button"><HelpCircle size={18} /></button>
          </div>

          <div className="phase-notice">
            <ShieldCheck size={16} />
            <span>{notice}</span>
          </div>

          <div className="conversation-flow">
            {(currentCase?.messages ?? []).map((item) => (
              <MessageBubble message={item} key={item.id} />
            ))}

            {state?.activeCaseFiles.length ? (
              <article className="assistant-message">
                <div className="run-time">本地文件树已读取 &gt;</div>
                <p>当前案件目录已经生成，右侧文件面板来自真实本地目录。</p>
                <div className="file-chips">
                  {flattenFiles(state.activeCaseFiles).filter((node) => node.kind === "file").slice(0, 3).map((node) => {
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
                <button className={index === 0 ? "selected" : ""} type="button" key={mode} title="Phase 1B 仅保存本地案件对话">
                  {index === 0 ? <Sparkles size={15} /> : index === 1 ? <Bot size={15} /> : <File size={15} />}
                  {mode}
                </button>
              ))}
            </div>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} aria-label="继续追问" placeholder="继续追问；Phase 1B 会保存到当前案件 conversation.md" />
            <div className="composer-footer">
              <button type="button" className="model-select disabled" title="Phase 1B 未接入真实模型" disabled>本地演示 · 未接模型 <ChevronDown size={15} /></button>
              <div className="composer-actions">
                <button type="button" aria-label="添加附件暂不可用" title="Phase 1B 暂不支持附件" className="icon-button" disabled><Paperclip size={18} /></button>
                <button type="button" aria-label="语音输入暂不可用" title="Phase 1B 暂不支持语音" className="icon-button" disabled><Mic size={18} /></button>
                <button type="submit" aria-label="保存到当前案件" className="send-button"><Send size={18} /></button>
              </div>
            </div>
          </form>
        </section>

        <aside className="files-panel">
          <div className="files-heading">
            <h2>当前案件文件</h2>
            <button aria-label="隐藏文件面板" title="只隐藏显示，不影响文件保存" className="icon-button"><PanelLeft size={17} /></button>
          </div>
          <label className="file-search">
            <Search size={16} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索当前案件文件名" />
          </label>
          <div className="file-tree">
            {state?.activeCaseFiles.length ? <FileRows nodes={state.activeCaseFiles} /> : <div className="empty-state">请在桌面应用中创建本地演示案件。</div>}
          </div>
          <div className="files-footer">
            <span>{fileCount} 个文件</span>
            <span><ShieldCheck size={15} />本地演示数据</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;
