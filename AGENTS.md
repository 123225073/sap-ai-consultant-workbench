# Agent 工作说明

这个仓库是一个本地优先的 SAP AI 顾问工作台。用户不是程序员，沟通必须默认使用中文，结论先说，尽量少讲技术细节，但所有结论都要尽量真实验证。

## 文档语言规范

- 项目文档默认使用中文。
- 文件路径、命令、包名、函数名、配置键、Git branch、GitHub label、API、SDK、CLI、IPC、ADR、PRD、MVP、SAP、ADT、ABAP、Feishu/Lark、Electron、React、TypeScript、SQLite 等行业关键词或技术标识保留英文。
- 如果英文术语会影响非技术用户理解，第一次出现时用中文解释一句。
- 不要为了显得专业而堆英文术语。
- 新增或更新 `docs/` 下的说明文档时，除非外部模板强制要求英文，否则优先写中文。

## 开始前先读

修改代码或产品行为前，先读：

1. `CONTEXT.md`
2. `README.md`
3. `docs/product-prototype/README.md`
4. `docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md`
5. `docs/product-prototype/TECHNICAL_IMPLEMENTATION.md`
6. 和当前阶段或功能相关的 `docs/superpowers/plans/`、`docs/superpowers/specs/`、`docs/architecture/reviews/` 文件。

部分较早的计划文件会描述“只有文档”“还没有应用骨架”等早期状态。那些内容只能当历史记录，不能当当前事实。行动前必须用 `git status`、`git log`、package scripts 和源码确认仓库真实状态。

## 产品定位

SAP AI 顾问工作台是给 SAP 顾问个人使用的本地桌面工作台。它不是通用 AI 聊天工具，不是 SaaS Dashboard，也不是云端知识库平台。

核心产品模型：

- Project 用来隔离客户、SAP 版本、配置、规范和知识。
- Case 是处理 SAP 问题、ABAP 开发、文档、流程图和证据的主要工作单元。
- Case files 是长期可追溯的成果载体。
- Daily chat 是普通日常 AI 对话，必须和 Case 工作分开，不强制绑定 Project 或 Case。
- Knowledge 必须经过用户审核后，才能进入正式知识库。

## 硬边界

- SAP 默认只读。
- 未经用户明确确认，不要新增 SAP 写入、激活、删除、创建传输、释放传输、过账或批量更新能力。
- 不要提交 SAP password、API key、Feishu/Lark token、SAP source code、公司文档、客户数据或真实业务输出。
- 不要把旧 `SAP ABAP` 工作区里的敏感数据复制进这个仓库。
- 不要把原始密钥暴露到 renderer、Markdown、日志、SQLite/JSON state、截图、model context 或 GitHub。
- 不要把产品做成团队版、登录系统、订阅流程、云端 SaaS 或卡片堆叠式 Dashboard。
- 如果要批量删除或移动文件，必须先列出准确目标和原因，等用户确认。

## 开发规则

- 保留无关的 dirty worktree 改动，不要回滚自己没有明确修改的文件。
- 改动要小，直接服务当前请求。
- 沿用现有 Electron + React + TypeScript 写法。
- 有权限或本地系统能力的逻辑留在 Electron main process，并通过窄 IPC 暴露。
- Renderer 不能直接读取任意文件、运行命令、解析密钥，或直接调用 SAP/model/Feishu 服务。
- 每个可见按钮都要有清楚的用户用途。
- UI 遵循 Codex 风格工作台结构：左侧栏、中间对话、右侧当前案件文件、底部输入区。
- 技术证据、日志、快照和生成物应该进入 case folder，不要做成常驻 Dashboard 面板。

## 验证要求

代码改动优先运行这些已有验证命令：

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

如果是特定 Phase 的工作，还要运行对应计划或 review 中点名的 `scripts/phase*-probe.mjs`。

如果命令无法运行，要用中文说明准确原因。没有真实信号时，不要声称“已验证”。

## Agent 技能配置

### 问题跟踪（Issue tracker）

这个仓库的问题跟踪使用 GitHub Issues：`123225073/sap-ai-consultant-workbench`。外部 PR 不作为需求 triage 入口。详见 `docs/agents/issue-tracker.md`。

### 问题分类标签（Triage labels）

使用默认五个 label：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### 领域上下文文档（Domain docs）

这是 single-context repo。先读 `CONTEXT.md`，再读 `docs/` 下相关产品、架构、phase plan、spec 和 review 文档。后续长期 ADR 放在 `docs/adr/`。详见 `docs/agents/domain.md`。
