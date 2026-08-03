# SAP AI 顾问工作台项目上下文

最后更新：2026-08-03

## 用途

这个文件是给 Agent 使用的仓库级上下文入口。它不替代 `docs/` 下已有文档，而是说明哪些文档是权威来源，以及应该怎样读取它们。

## 文档语言规范

本项目文档默认使用中文。路径、命令、包名、函数名、配置键、Git branch、GitHub label、API、SDK、CLI、IPC、ADR、PRD、MVP、SAP、ADT、ABAP、Feishu/Lark、Electron、React、TypeScript、SQLite 等技术标识保留英文。

写文档时优先让非程序员能看懂。必要英文术语可以保留，但不要用英文替代清楚的中文解释。

## 当前真实状态

这个仓库已经不是空的文档仓库。当前实现位于 `apps/desktop`，技术路线是 Electron + React + TypeScript，根目录已有 `dev`、`build`、`check`、`start` 脚本。

截至 2026-07-16：

- 当前主开发 branch 是 `codex/production-readiness`，已完成到 Phase 49 的任务会话、模型流式体验、Project SAP landscape 和本地文件夹绑定能力。
- Work/Chat 核心回复直接调用用户配置的模型渠道，不经过 Codex CLI。
- Phase 50-56 已实现独立 Agent Runtime 首个基线：Work/Chat 回合进入本地 Thread/Turn/Item 事件账本，Work 支持受控工具循环，长会话使用可追溯 checkpoint，明确提出的长期要求只生成待确认记忆。
- 能力中心已提供 `插件 | Skills | MCP | 提示词 | 记忆` 五个页签；Skill、声明式 Plugin、分层提示词和已确认记忆按 Project/Case 范围进入新回合。
- 应用随附 9 个正式 SAP 运维 Skills 和 1 个旧 ID 兼容入口，依据 SAP Activate Run、SAP Cloud ALM、SAP ITSM/ChaRM、Signavio、ATC/ABAP Unit 和 CTS 组织；首次启动自动安装但默认停用，只有用户明确启用后才进入模型上下文；升级时同步内容并保留用户明确选择，内置 Skill 不能被移除。
- MCP 稳定版只开放 HTTPS Streamable HTTP 的连接配置、测试和 tools/resources/prompts 发现。任何外部工具都不会进入 Work 自动执行目录；Server 的 `readOnlyHint` 只作展示，不能提权。外部 MCP 执行、STDIO、任意脚本和受限子 Agent 尚未正式开放。
- Codex 只作为公开源码参考和可选兼容工具，不是 Work/Chat、能力中心或 Agent Runtime 的运行依赖。
- 工作区可能存在前序任务留下的未提交改动。每次开始前必须检查并保留，不得为了文档或 Runtime 工作回滚无关文件。

每次开始工作前，都要重新检查当前状态：

```powershell
git status --short
git log --oneline -10 --decorate
npm run check
```

## 权威文档读取顺序

| 优先级 | 位置 | 用途 |
|---|---|---|
| 1 | `CONTEXT.md` | 快速了解仓库上下文、核心词汇、硬边界和文档地图。 |
| 2 | `docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md` | 产品范围、用户流程、MVP 边界、UI 行为和验收标准。 |
| 3 | `docs/product-prototype/TECHNICAL_IMPLEMENTATION.md` | 架构、本地存储、连接器、案件动作、权限模式、知识流、搜索和验证策略。 |
| 4 | `docs/architecture/FIRST_PRINCIPLES_STRATEGY.md` | 第一性原理产品方向和阶段门禁。 |
| 5 | `docs/architecture/ADVERSARIAL_AUDIT_MATRIX.md` | 每个功能都要对照的安全和产品审计矩阵。 |
| 6 | `docs/architecture/INDEPENDENT_AGENT_RUNTIME.md` | 独立运行时的消息链路、工具、上下文、记忆、Skill、MCP 和子 Agent 总体架构。 |
| 7 | `docs/adr/0002-independent-agent-runtime.md` | 核心 AI 不依赖 Codex 中转的长期决策。 |
| 8 | `docs/research/2026-07-15-codex-runtime-primary-source-study.md` | 基于 OpenAI 官方文档和固定源码 commit 的 Codex Runtime 研究证据。 |
| 9 | `docs/superpowers/specs/2026-07-15-capability-center-skills-mcp-prompt-memory-design.md` | Phase 51-54 能力中心、Skills、MCP、提示词和分层记忆的完整方案。 |
| 10 | `docs/superpowers/specs/` | 具体 phase 的冻结设计说明。 |
| 11 | `docs/superpowers/plans/` | 历史和当前实现计划。读取相关 phase，但必须判断是否仍然是当前状态。 |
| 12 | `docs/architecture/reviews/` | 对抗式 review、验证证据和剩余风险。 |

如果 plan 文件和源码不一致，先检查源码、最新 review 和 probe 证据，再下结论。

## docs 目录地图

| 目录 | 含义 |
|---|---|
| `docs/product-prototype/` | 产品基线：原型索引、PRD、技术实现、新线程交接和原型图。 |
| `docs/architecture/` | 长期架构原则、审计矩阵、多 Agent 执行模型和功能 review 模板。 |
| `docs/research/` | 基于官方文档、开放规范和固定源码 commit 的研究记录。 |
| `docs/architecture/reviews/` | Phase review 记录，包含范围、风险、验证命令、实际结果和剩余风险。 |
| `docs/superpowers/plans/` | 按 phase 拆分的实现计划。部分早期文件是历史快照。 |
| `docs/superpowers/specs/` | 功能实现前冻结范围的设计说明。 |
| `docs/agents/` | 已安装工程技能的配置：issue tracker、triage labels、domain docs。 |
| `docs/adr/` | 后续 Architecture Decision Records。已有架构文档仍保留在 `docs/architecture/`，不要重复复制。 |

除非用户明确要求，不要擅自重命名或重组现有文档目录。如果文档布局改变，要同步更新这张地图。

## 产品核心词汇

| 词汇 | 含义 |
|---|---|
| 客户项目 / Customer Project | 公司或客户级边界，底层沿用 `Project`。例如 A 公司、B 公司。它拥有该客户的 SAP landscape、项目规范和知识；一套客户项目可以包含 DS4/DEV、QS4/QAS、PS4/PRD 等多套 SID 和 Client 登录连接。 |
| 运维项目 / Work Project | 客户项目下的一项持续工作，底层沿用 `Case`。例如“库龄分析报表开发”“销售报表开发”。每个运维项目对应一个共享本地文件夹，保存资料、成果、证据和多个对话线程的共同上下文。 |
| 运维项目文件夹 | 运维项目对应的真实本地文件夹，保存输出、证据、快照、技术文件、时间线和上下文包；可以由工作台创建，也可以绑定电脑已有文件夹。 |
| 对话线程 / Conversation Thread | 运维项目下的一次独立对话，底层沿用 `WorkThread`。需求分析、代码开发、测试验证可以拆成不同线程以控制上下文长度；同一运维项目的线程共享项目文件，并可通过受控只读工具读取兄弟线程的有限上下文。 |
| Daily chat | 普通日常 AI 对话，不绑定 Project 或 Case，必须和案件工作分开。 |
| Work | 需要沉淀成果的正式工作入口。当前实现使用 `Customer Project + Work Project + Conversation Thread`：线程对话独立，成果写入运维项目共享文件夹。 |
| Chat | 纯日常对话入口，不出现项目选择、文件夹选择和案件文件面板，也不读取 SAP。 |
| SAP 登录连接 | 客户项目内的一套独立只读登录上下文，由 SID、实例号、环境、Client、用户、密码引用和验证状态组成。DS4、QS4、PS4 及其多个 Client 应归属于同一个客户项目，而不是被拆成多个客户项目。 |
| 全局集成配置 | AI 模型渠道、API Key、Feishu/Lark CLI 与 Codex CLI 等个人工作台能力。它们由整个工作台共用，不随客户项目重复配置；SAP ADT 连接明确不属于全局配置。 |
| 内部占位工作区 | 为兼容旧数据结构保留的不可见内部 Case，不是用户业务对象。新的客户项目没有可见“收件箱”；旧收件箱若已有真实内容则迁移显示为“未归类工作”，不能静默删除。 |
| 其他工作 | 非 SAP 工作，或暂时不绑定已配置 SAP 项目的工作。它可以有本地工作文件夹，但不读取 SAP 配置。 |
| Task mode | 早期实现中的历史兼容字段。新 UI 不再要求用户发消息前选择任务模式。 |
| Case action | 案件动作，固定按钮，用来把当前对话和工作文件夹内容沉淀成笔记、开发说明书、流程图、候选知识或交付物。 |
| Action permission mode | 项目 / 案件权限模式，三档为请求批准、替我批准、完全访问；权限不按单个 Skill 配置。 |
| Current case files | 当前案件所属文件，在右侧面板展示。 |
| Evidence | 支撑结论的只读事实或记录，例如 SAP object evidence 或验证结果。 |
| Snapshot | 某个时间点保存的源码或数据快照，用于可追溯。 |
| Candidate knowledge | 待用户审核的候选知识，不是正式知识。 |
| Published knowledge | 用户确认后的正式知识，可被后续案件复用。 |
| Standards | 项目自己的 ABAP、文档、图示和输出规则，从模板或其他项目复制后独立演进。 |
| Safe model context | 传给模型的受限上下文，防止泄露密钥、原始 SAP 源码和未受控案件文件。 |
| Agent Runtime | 运行在 Electron main process 的核心 AI 执行层，当前负责 Thread/Turn/Item、模型流、本地内置只读工具循环、上下文、checkpoint、Skill 和记忆；MCP 执行与受限子 Agent 是后续受控能力。 |
| Event ledger | Agent Runtime 的本地事件账本，是回合和工具执行的事实源；`conversation.md` 等文件是面向用户的投影。 |
| 能力中心 | 管理 Plugin、Skills、MCP、提示词和记忆的独立页面；它是配置入口，不是新的运行时。 |
| Plugin / 插件包 | 本产品的声明式能力包，可组合 Skills、MCP 预设、提示词、模板和元数据；第一版不允许注入第三方 UI 代码或任意执行入口。 |
| Memory | 用于恢复任务的工作摘要、项目约定或用户偏好，不等于聊天历史，也不等于已发布知识。 |
| Memory candidate | 系统建议保存、但尚未由用户确认的记忆；不能自动成为正式知识或跨会话事实。 |
| Prompt Profile | 按安全、产品、个人、Project、Case 和 Skill 层级组合的提示词配置；低优先级内容不能覆盖安全硬规则。 |
| Skill | 可复用工作说明和资源包；只描述怎么做，不自行获得文件、网络、SAP 或命令权限。 |
| MCP | 连接外部工具和资源的开放协议；MCP Server 提供的能力仍受本产品权限和安全边界控制。 |
| Feishu handoff | 飞书/Lark 流程的本地草稿或交接产物。除非另行设计并授权，否则不是自动云端发布。 |

## 不可突破的产品规则

- MVP 是个人本地版。
- 不做团队版、注册登录、云端 SaaS、订阅流程或组织权限系统。
- SAP 默认只读。
- 不做 SAP 写入、激活、删除、创建传输、释放传输、过账或批量修改。
- 不自动正式发布知识。
- 不让原始密钥、敏感客户数据或业务数据进入 Git、日志、Markdown、model context、renderer state 或截图。
- AI 结论必须能追溯到 Case、文件、SAP 读取记录或 Published knowledge。
- 配置失败必须给出用户能理解的原因和下一步。
- UI 应该像真正的桌面工作台，不是装饰性 Dashboard。
- 主界面必须区分 `Work` 和 `Chat`：`Chat` 不显示客户项目、运维项目和文件夹；`Work` 使用“客户项目 → 运维项目 → 对话线程”三级结构。
- 新建运维项目时选择或创建一次文件夹；在已有运维项目下新增对话线程时不得再次要求选择文件夹。
- 对话线程与运维项目文件夹是两个概念：线程负责独立对话和生命周期，运维项目文件夹负责共享成果、证据与文件；归档、移除或后台写回不得串到其他运维项目。
- “已有文件夹”必须调用系统原生目录选择器，不能伪装成内部 Case 下拉框。绝对路径只保存在 Electron main process 的机器本地绑定表中，不进入 renderer state、日志、模型上下文或可迁移备份；绑定本身不批量读取或改写原目录。
- 客户项目是运维项目的父级。用户必须能看清某个运维项目、对话线程属于哪个客户项目。
- SAP ADT landscape 按客户项目隔离；AI 模型、API Key、Feishu/Lark CLI 和 Codex CLI 按工作台全局共用。
- 右侧默认展示当前工作文件夹文件；只有用户明确切换或点击项目配置时，才展示项目配置摘要或进入配置中心。
- 新 UI 不要求用户在发消息前选择任务模式；默认自由对话，固定案件动作负责沉淀成果。
- 案件动作可以绑定内置或导入 Skill，但执行权限按项目 / 案件权限模式管理。
- 核心 Agent Runtime 必须独立于 Codex CLI、Codex SDK 和 Codex app-server；缺少 Codex 不得影响核心能力。
- 记忆候选不能自动成为正式知识；跨 Project 检索必须显式隔离并带来源。
- Skill、MCP 和子 Agent 都只能通过 main process 的 Tool Registry 与 Policy Engine 获得受控能力；当前稳定版没有给外部 MCP 和子 Agent 注册执行能力。
- Plugin 第一版只能是声明式能力包；扩展故障或停用不得影响不使用该能力的 Chat/Work。
- Prompt instruction 和 Memory fact 必须分层处理；Memory、MCP 输出和 Skill 文本不能覆盖系统安全规则。
- 「完全访问」只表示当前项目 / 案件范围内尽量自动执行，不允许绕过 SAP 写入、批量删除、外部发布和密钥导出的硬确认。

## 当前实现形态

当前技术栈：

- Electron main process 负责本地文件系统、安全存储、连接器执行和 IPC。
- React + TypeScript renderer 负责 UI。
- Preload bridge 负责 renderer 和 main process 的窄接口。
- Case 和输出文件保存在本地文件系统。
- 不同功能区使用本地 JSON 或 SQLite-backed state。
- 密钥使用 Electron `safeStorage` 或等价安全存储。
- 通过 phase probe 和 `scripts/security-preflight.ps1` 做安全门禁。

关键边界：

- Renderer 不能直接解析密钥、读取任意文件、运行 shell command，或调用 SAP/model/Feishu 服务。
- Secrets 留在 main process 和 secure store。
- SAP object access 必须只读，并使用固定安全的 connector 路径。
- 多 SAP 连接必须先在 Project 范围内路由；未唯一匹配时先由用户确认，禁止静默猜测实例号 `00` 或读取错误系统。
- Feishu CLI command 必须固定，并显式指定 profile。
- Model execution 必须使用已验证 provider 和 safe context。
- Provider 流式输出、AgentRuntime、Tool Runtime 和 EventStore 已接入 Work/Chat；所有模型工具按 Project 默认关闭，只有用户明确授权后才注册。SAP 对象证据与 SAP ADT 通用数据读取是两个独立开关：对象工具只读命名 ABAP/DDIC 对象定义；通用数据工具根据用户意图路由到 Project 内对应 SID/Client，可先发现 DDIC table、view 或 CDS 字段，再用结构化筛选和有界行数读取数据、把完整明细写入当前工作文件夹，并向本轮模型返回有上限的分析行以继续完成任务。模型不能提交原始 SQL，工具不运行事务或任何 SAP 写入。MB52、订单、凭证、主数据和配置核对都只是通用链路的场景。OpenAI Responses API、受限子 Agent 和更完整的中断续跑仍属于后续增强，不能宣称已达到 Codex App 的全部编排能力。
- 文件访问必须限制在当前 Case/Project 边界内。

## Agent 开发流程

实现前：

1. 读取本文件。
2. 读取和当前请求相关的产品文档、技术文档。
3. 找到最新相关 phase spec、plan、review。
4. 检查当前源码和 Git 状态。

实现中：

- 保持改动范围小。
- 保留无关 dirty files。
- 不要静默修改架构方向、UI 方向或安全策略。
- 如果文档说某个 phase 未实现，但代码证明已经实现，把该文档当历史记录；只有用户要求时才更新上下文。

完成前：

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

还要运行 plan 或 review 中点名的相关 phase probe。例如 Phase 27 相关工作会引用 `scripts/phase27-core-config-wizard-probe.mjs` 和若干回归 probe。

## 和用户沟通

默认使用中文。先说结论。表达要实用，不要堆代码细节。汇报时说明：

- 完成了什么。
- 验证了什么。
- 什么无法验证，以及原因。
- 真实剩余风险。
