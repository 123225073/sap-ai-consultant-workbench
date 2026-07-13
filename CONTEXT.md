# SAP AI 顾问工作台项目上下文

最后更新：2026-07-07

## 用途

这个文件是给 Agent 使用的仓库级上下文入口。它不替代 `docs/` 下已有文档，而是说明哪些文档是权威来源，以及应该怎样读取它们。

## 文档语言规范

本项目文档默认使用中文。路径、命令、包名、函数名、配置键、Git branch、GitHub label、API、SDK、CLI、IPC、ADR、PRD、MVP、SAP、ADT、ABAP、Feishu/Lark、Electron、React、TypeScript、SQLite 等技术标识保留英文。

写文档时优先让非程序员能看懂。必要英文术语可以保留，但不要用英文替代清楚的中文解释。

## 当前真实状态

这个仓库已经不是空的文档仓库。当前实现位于 `apps/desktop`，技术路线是 Electron + React + TypeScript，根目录已有 `dev`、`build`、`check`、`start` 脚本。

创建本上下文文件时：

- 当前 branch 是 `codex/phase-22-published-knowledge-case-context`。
- 工作区已有前序开发留下的未提交改动，包括后续 phase 文档和 probe 脚本。
- 本机 PATH 中没有检测到 `gh`，因此 GitHub issue 操作没有在本机完成验证。

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
| 6 | `docs/superpowers/specs/` | 具体 phase 的冻结设计说明。 |
| 7 | `docs/superpowers/plans/` | 历史和当前实现计划。读取相关 phase，但必须判断是否仍然是当前状态。 |
| 8 | `docs/architecture/reviews/` | 对抗式 review、验证证据和剩余风险。 |

如果 plan 文件和源码不一致，先检查源码、最新 review 和 probe 证据，再下结论。

## docs 目录地图

| 目录 | 含义 |
|---|---|
| `docs/product-prototype/` | 产品基线：原型索引、PRD、技术实现、新线程交接和原型图。 |
| `docs/architecture/` | 长期架构原则、审计矩阵、多 Agent 执行模型和功能 review 模板。 |
| `docs/architecture/reviews/` | Phase review 记录，包含范围、风险、验证命令、实际结果和剩余风险。 |
| `docs/superpowers/plans/` | 按 phase 拆分的实现计划。部分早期文件是历史快照。 |
| `docs/superpowers/specs/` | 功能实现前冻结范围的设计说明。 |
| `docs/agents/` | 已安装工程技能的配置：issue tracker、triage labels、domain docs。 |
| `docs/adr/` | 后续 Architecture Decision Records。已有架构文档仍保留在 `docs/architecture/`，不要重复复制。 |

除非用户明确要求，不要擅自重命名或重组现有文档目录。如果文档布局改变，要同步更新这张地图。

## 产品核心词汇

| 词汇 | 含义 |
|---|---|
| Project | 客户或业务项目边界，用来隔离 SAP landscape（系统版图）、连接配置、项目规范、案件和知识；一个 SAP Project 可以包含多套 SID 和 Client 登录连接。 |
| Case | 案件，一个 SAP 问题、ABAP 任务、文档、流程图、调查或交付事项对应一个 Case。 |
| Case folder | 真实本地文件夹，保存输出、证据、快照、技术文件、时间线和上下文包。 |
| Daily chat | 普通日常 AI 对话，不绑定 Project 或 Case，必须和案件工作分开。 |
| Work | 需要沉淀成果的正式工作入口。当前实现使用 `Project + WorkThread + Case`：任务会话独立，成果写入绑定的工作文件夹。 |
| Chat | 纯日常对话入口，不出现项目选择、文件夹选择和案件文件面板，也不读取 SAP。 |
| SAP 项目 | 已配置或准备配置 SAP 连接、规范、知识和模型能力的 Project，例如 `SAP 演示 S4HANA`、`SAP 演示 ECC`。 |
| SAP 登录连接 | Project 内的一套独立只读登录上下文，由 SID、实例号、环境、Client、用户、密码引用和验证状态组成。DS4、QS4、PS4 及其多个 Client 应归属于同一个业务 Project，而不是被拆成多个 Project。 |
| 工作文件夹 | 用户在 Work 下看到的成果容器，当前实现对应底层 Case。它必须归属到某个 SAP 项目或“其他工作”项目；可以由工作台新建，也可以通过 Windows 原生目录选择器绑定电脑已有文件夹。 |
| Task / WorkThread | Work 下的任务和独立会话。每个任务有稳定会话 ID，可绑定新建或电脑已有文件夹；重复选择同一 Project 下的同一电脑文件夹时复用同一个 Case，但会话历史必须隔离。 |
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
- 主界面必须区分 `Work` 和 `Chat`：`Chat` 不显示文件夹选择；`Work` 下新建任务必须选择或创建工作文件夹。
- 任务会话与工作文件夹是两个概念：任务负责独立对话和生命周期，工作文件夹负责共享成果、证据与文件；归档、移除或后台写回不得串到其他会话。
- “已有文件夹”必须调用系统原生目录选择器，不能伪装成内部 Case 下拉框。绝对路径只保存在 Electron main process 的机器本地绑定表中，不进入 renderer state、日志、模型上下文或可迁移备份；绑定本身不批量读取或改写原目录。
- `SAP 项目` 是工作文件夹的父级。用户必须能看清某个工作文件夹属于哪个 SAP 项目。
- 右侧默认展示当前工作文件夹文件；只有用户明确切换或点击项目配置时，才展示项目配置摘要或进入配置中心。
- 新 UI 不要求用户在发消息前选择任务模式；默认自由对话，固定案件动作负责沉淀成果。
- 案件动作可以绑定内置或导入 Skill，但执行权限按项目 / 案件权限模式管理。
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
