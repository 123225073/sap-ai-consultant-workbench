# SAP AI 顾问工作台

SAP AI 顾问工作台是一个面向 SAP 顾问的个人本地桌面工作台。

它的目标不是做一个普通聊天工具，也不是做一个通用知识库，而是围绕 SAP 顾问的真实工作方式，把项目、案件、对话、文件、规范、知识沉淀和只读 SAP 连接放到同一个本地工作台里。

## 当前状态

仓库已经实现可运行的 Electron + React + TypeScript 本地桌面应用，当前主流程包括：

- Work：按 Project 隔离 Case、对话、案件文件、规范、知识和连接配置。
- Chat：独立保存日常对话，可从已验证渠道的完整模型目录中选择模型并实时流式回复，但不会写入 Case。
- 配置中心：用独立页签纵向管理 Project 下按 SID 分组的多套 SAP ADT 只读连接、多个 OpenAI/Anthropic Compatible 模型渠道、Feishu/Lark CLI、本机 AI 增强和本地存储；可只读扫描本机 SAP Logon 的主机、SID 与实例号。
- 规范中心：Project 级规范模板、编辑、版本保存和任务调用。
- 知识库：本地文件导入、候选知识、人工审核、发布、过期、搜索以及 Case 关联/解除关联。
- 任务与文件夹：每个 Work 任务有独立会话 ID，可新建工作文件夹，或通过 Windows 原生目录选择器绑定电脑已有文件夹；本地绝对路径不会进入页面、模型上下文或可迁移备份。
- 本地可靠性：状态备份、损坏状态恢复、安全存储引用、Case 输出目标绑定和阶段探针。
- 独立 Agent Runtime：Work/Chat 使用本产品自己的 Thread/Turn/Item 事件账本、流式模型调用、上下文预算、自动 checkpoint 和分层记忆；Codex 不是核心中转。
- 能力中心：用 `插件 | Skills | MCP | 提示词 | 记忆` 五个页签管理声明式扩展；启用的 Skill/Plugin/提示词/已确认记忆会按范围进入新回合。MCP 当前只做 HTTPS 连接、测试和能力发现，外部工具不进入自动执行链。

Phase 40/41 已完成生产可用性收敛；Phase 42/43 补齐案件专用开发说明书与流程图、成果版本历史、完整备份、受控数据迁移、知识后端冲突门禁和桌面 UAT；Phase 44 完成完整模型目录选择、OpenAI/Anthropic 流式回复和真实已配置渠道回测。代码签名保留为可选发布能力，不是个人分发前提。

Phase 50-56 已完成独立 Agent Runtime 的首个可运行基线：事件账本、同 Thread 单回合编排、OpenAI/Anthropic Compatible 工具循环、本地内置只读 Tool Runtime、上下文预算、自动 checkpoint、分层提示词与记忆、Skills、声明式 Plugin、HTTPS Streamable HTTP MCP 连接/发现和能力中心均已有真实代码与专项探针。外部 MCP 工具执行、受限子 Agent、任意 Skill 脚本和 STDIO MCP 尚未作为正式功能开放。

项目名称中的 SAP 仅用于说明产品服务的业务领域。这是个人独立产品，不代表 SAP SE 官方产品或官方背书，也不使用 SAP Logo。

核心 AI 对话由用户配置并验证的模型渠道提供。Codex CLI、Codex SDK 和 Codex app-server 都不是核心依赖；没有安装 Codex 时，Work、Chat、规范中心、知识库和本地文件仍可正常使用。没有配置 SAP 时，只会停止 SAP 数据读取，不影响普通 AI 对话。

外部系统是否真正可用仍取决于本机配置和凭据。项目不会用模拟响应冒充 SAP、模型、Feishu 或 Codex 验证成功。

## MVP 边界

MVP 只做个人本地版：

- 不做团队版
- 不做注册登录
- 不做云端 SaaS
- 不自动写 SAP
- 不释放传输请求
- 不自动正式入库知识
- 不提交 SAP 源码、SAP 密码、API Key、飞书 Token 或公司业务数据

## 文档入口

- [产品原型索引](docs/product-prototype/README.md)
- [产品开发说明书](docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md)
- [技术实现文档](docs/product-prototype/TECHNICAL_IMPLEMENTATION.md)
- [新项目交接说明](docs/product-prototype/NEW_PROJECT_HANDOFF.md)
- [总开发计划](docs/superpowers/plans/2026-07-02-sap-ai-workbench-master-plan.md)
- [第一性原理推进策略](docs/architecture/FIRST_PRINCIPLES_STRATEGY.md)
- [对抗式审计矩阵](docs/architecture/ADVERSARIAL_AUDIT_MATRIX.md)
- [多 Agent 执行模型](docs/architecture/MULTI_AGENT_EXECUTION_MODEL.md)
- [独立 Agent Runtime 总体架构](docs/architecture/INDEPENDENT_AGENT_RUNTIME.md)
- [Codex 公开运行时官方源码研究](docs/research/2026-07-15-codex-runtime-primary-source-study.md)
- [ADR-0002：核心 AI 运行时独立于 Codex](docs/adr/0002-independent-agent-runtime.md)
- [Phase 50 基础设计](docs/superpowers/specs/2026-07-15-phase-50-independent-agent-runtime-foundation-design.md)
- [Phase 50 实施计划](docs/superpowers/plans/2026-07-15-phase-50-independent-agent-runtime-foundation-plan.md)
- [能力中心、Skills、MCP、提示词与分层记忆设计](docs/superpowers/specs/2026-07-15-capability-center-skills-mcp-prompt-memory-design.md)
- [功能对抗式审计模板](docs/architecture/FEATURE_ADVERSARIAL_REVIEW_TEMPLATE.md)
- [0.1.0 发布就绪审查](docs/release/2026-07-11-release-readiness.md)
- [Phase 42 正式发布加固审查](docs/architecture/reviews/2026-07-11-phase-42-production-hardening-review.md)
- [Phase 43 桌面正式 UAT](docs/release/PHASE43_DESKTOP_RELEASE_UAT.md)
- [内部试用操作手册](docs/release/INTERNAL_PILOT_RUNBOOK.md)
- [已知限制](docs/release/KNOWN_LIMITATIONS.md)
- [第二期：Codex 线程导入设计](docs/product-prototype/PHASE2_CODEX_THREAD_IMPORT.md)

## 本地运行

```powershell
npm install
npm run check
npm run build
npm start
```

`npm start` 启动桌面应用。首次使用应先创建 Project，再在配置中心验证需要使用的外部渠道。

## Windows 打包

个人分发使用普通构建即可：

```powershell
npm run package:win
```

生成的 Setup 和 Portable 可以正常安装或直接运行。未配置代码签名时，Windows 可能显示“未知发布者”提示；这是个人软件常见提示，不影响安装包功能。组织代码签名属于可选的高级发布能力，不是本产品正常构建和使用的前提。

构建完成后，`release/<version>/` 会同时生成版本化安装包、版本化 Portable，以及两个始终指向本轮 Portable 的便捷副本：`SAP-AI顾问工作台-双击启动.exe` 和 `SAP-AI顾问工作台-最新版-双击启动.exe`。这些便捷副本由构建脚本自动刷新，避免误开旧版本。

## 验证

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

也可以运行 `npm run verify`，一次完成类型检查、正式构建、Phase 11-56 回归探针、真实 Electron 启动/单实例检查、桌面图形 UAT、安全预检和 diff 检查。已有本机模型配置时，可额外运行 `npm run uat:real-model-stream` 验证真实渠道、完整模型选择和流式持久化；通用 `verify` 不会使用用户密钥访问外部系统。

各阶段真实工作流还配有 `scripts/phase*-probe.mjs` 探针，重点覆盖持久化、IPC 边界、SAP 只读、模型渠道、规范和知识生命周期。

## 安全原则

默认只读 SAP。所有密钥和客户资料必须留在本机安全存储或被 `.gitignore` 排除的本地目录中，不能进入 GitHub。
