import {
  Archive,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
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

const projects = [
  {
    name: "演示 S4HANA",
    system: "DEV/100",
    state: "只读",
    active: true,
    cases: [
      { title: "DEMO001 演示BOM清单", status: "", active: true, time: "10:24" },
      { title: "DEMO002 接口分析", status: "处理中", active: false, time: "" },
      { title: "DEMO003 演示物料逻辑", status: "已归档", active: false, time: "" }
    ]
  },
  {
    name: "演示 ECC",
    system: "QAS/200",
    state: "未验证",
    active: false,
    cases: [{ title: "DEMO004 库存差异", status: "待处理", active: false, time: "" }]
  }
];

const files = [
  { type: "file", icon: File, name: "README.md", meta: "10:20" },
  { type: "file", icon: File, name: "conversation.md", meta: "10:24" },
  { type: "folder", icon: Folder, name: "outputs/", meta: "" },
  { type: "excel", icon: FileSpreadsheet, name: "演示BOM核对.xlsx", meta: "10:26" },
  { type: "file", icon: File, name: "逻辑说明图.png", meta: "10:26" },
  { type: "file", icon: File, name: "开发说明书.md", meta: "10:26" },
  { type: "folder", icon: Folder, name: "knowledge_candidates/", meta: "" },
  { type: "file", icon: File, name: "演示BOM筛选规则.md", meta: "待确认" },
  { type: "folder", icon: Folder, name: "technical/", meta: "" }
];

const modes = ["问题分析", "ABAP开发", "文档生成", "画流程图"];

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "green" | "orange" | "blue" }) {
  return <span className={`status-pill status-${tone}`}>{label}</span>;
}

function App() {
  const appInfo = window.workbench?.getAppInfo();

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
          <span className="online-dot" aria-hidden="true" />
          <strong>{appInfo?.name ?? "SAP AI 顾问工作台"}</strong>
          <span>{appInfo?.edition ?? "个人版 MVP"}</span>
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
            <button><PenLine size={18} />新案件</button>
            <button><Search size={18} />搜索</button>
            <button><Settings size={18} />配置中心</button>
            <button><BookOpen size={18} />规范中心</button>
            <button><Archive size={18} />知识库</button>
          </div>

          <div className="project-header">
            <span>项目</span>
            <button><Plus size={16} />添加项目</button>
            <button aria-label="项目更多"><ChevronDown size={16} /></button>
          </div>

          <div className="project-list">
            {projects.map((project) => (
              <section className="project-card" key={project.name}>
                <div className="project-card-title">
                  <div>
                    <strong>SAP&nbsp;&nbsp;{project.name}</strong>
                    <div className="project-tags">
                      <StatusPill label={project.system} tone={project.active ? "green" : "orange"} />
                      <StatusPill label={project.state} tone={project.active ? "green" : "orange"} />
                    </div>
                  </div>
                  <button aria-label={`${project.name} 设置`} className="icon-button"><Settings size={16} /></button>
                </div>
                <div className="case-list">
                  {project.cases.map((item) => (
                    <button className={item.active ? "case-row active" : "case-row"} key={item.title}>
                      <span>{item.title}</span>
                      {item.time ? <time>{item.time}</time> : null}
                      {item.status ? <StatusPill label={item.status} tone={item.status === "处理中" ? "orange" : "neutral"} /> : null}
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
            <button aria-label="编辑个人信息" className="icon-button"><PenLine size={15} /></button>
          </footer>
        </aside>

        <section className="conversation-panel">
          <div className="case-heading">
            <div>
              <h1>DEMO001 演示BOM清单</h1>
              <p>演示 S4HANA · DEV/100 · 只读</p>
            </div>
            <button aria-label="当前案件帮助" className="icon-button"><HelpCircle size={18} /></button>
          </div>

          <div className="conversation-flow">
            <div className="user-message">
              帮我分析 DEMO001 演示BOM清单，确认为什么部分工厂没有数据。
              <time>10:24</time>
            </div>

            <article className="assistant-message">
              <div className="run-time">已处理 2m 58s &gt;</div>
              <p>已确认：问题来自演示BOM筛选口径与当前业务范围不一致。</p>
              <ul>
                <li><strong>原因：</strong>筛选条件中的工厂范围仍使用旧口径，部分工厂未被包含。</li>
                <li><strong>建议：</strong>调整为当前业务口径，并增加异常工厂提示。</li>
                <li><strong>已生成文件：</strong>演示BOM核对.xlsx、逻辑说明图.png、开发说明书.md</li>
              </ul>
              <div className="file-chips">
                <a href="#outputs"><FileSpreadsheet size={22} />演示BOM核对.xlsx<span>256 KB</span></a>
                <a href="#diagram"><File size={22} />逻辑说明图.png<span>128 KB</span></a>
                <a href="#doc"><File size={22} />开发说明书.md<span>18 KB</span></a>
              </div>
            </article>
          </div>

          <form className="composer">
            <div className="mode-tabs" role="tablist" aria-label="任务模式">
              {modes.map((mode, index) => (
                <button className={index === 0 ? "selected" : ""} type="button" key={mode}>
                  {index === 0 ? <Sparkles size={15} /> : index === 1 ? <Bot size={15} /> : <File size={15} />}
                  {mode}
                </button>
              ))}
            </div>
            <textarea aria-label="继续追问" placeholder="继续追问，或 @引用 SAP 对象 / 文档 / 历史案件" />
            <div className="composer-footer">
              <button type="button" className="model-select">演示渠道 · demo-model <ChevronDown size={15} /></button>
              <div className="composer-actions">
                <button type="button" aria-label="添加附件" className="icon-button"><Paperclip size={18} /></button>
                <button type="button" aria-label="语音输入" className="icon-button"><Mic size={18} /></button>
                <button type="button" aria-label="发送" className="send-button"><Send size={18} /></button>
              </div>
            </div>
          </form>
        </section>

        <aside className="files-panel">
          <div className="files-heading">
            <h2>当前案件文件</h2>
            <button aria-label="隐藏文件面板" className="icon-button"><PanelLeft size={17} /></button>
          </div>
          <label className="file-search">
            <Search size={16} />
            <input placeholder="搜索当前案件文件" />
          </label>
          <div className="file-tree">
            {files.map((item) => {
              const Icon = item.icon;
              return (
                <div className={`file-row file-${item.type}`} key={`${item.name}-${item.meta}`}>
                  <Icon size={18} />
                  <span>{item.name}</span>
                  {item.meta ? <em>{item.meta}</em> : null}
                </div>
              );
            })}
          </div>
          <div className="files-footer">
            <span>6 个项目</span>
            <span><ShieldCheck size={15} />只读演示数据</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;
