# SAP AI 顾问工作台产品原型索引

生成日期：2026-07-01

本目录用于统一管理当前 MVP 版本的产品原型图、开发说明书和技术实现文档。后续开发、评审、修改需求时，默认以这里的文档和图片为准。

## 原型图

| 页面 | 图片 | 说明 |
|---|---|---|
| 主工作台 | [01-main-workbench.png](images/01-main-workbench.png) | Codex 风格主界面：左侧项目/案件，中间案件对话，右侧当前案件文件，底部任务模式和模型选择。 |
| 配置中心 | [02-config-center.png](images/02-config-center.png) | 当前项目的 ADT、飞书 CLI、API 模型、Codex 能力、本地存储等配置与验证。 |
| 规范中心 | [03-standards-center.png](images/03-standards-center.png) | 项目级 ABAP 规范、文档模板、流程图规范、模板迁移、差异与版本管理。 |
| 知识库 | [04-knowledge-center.png](images/04-knowledge-center.png) | 文档上传、知识候选、人工确认、冲突检测、时间线与知识卡片管理。 |

## 配套文档

| 文档 | 说明 |
|---|---|
| [PRODUCT_DEVELOPMENT_SPEC.md](PRODUCT_DEVELOPMENT_SPEC.md) | 产品开发说明书，描述用户、场景、MVP 范围、页面、交互、业务规则和验收标准。 |
| [TECHNICAL_IMPLEMENTATION.md](TECHNICAL_IMPLEMENTATION.md) | 技术实现文档，描述本地桌面架构、数据模型、目录结构、连接器、知识库、Agent 工作流和测试方案。 |
| [NEW_PROJECT_HANDOFF.md](NEW_PROJECT_HANDOFF.md) | 新建独立项目 / GitHub 仓库时使用的交接说明和建仓建议。 |
| [NEW_THREAD_PROMPT.md](NEW_THREAD_PROMPT.md) | 在新项目目录下开启 Codex 开发线程时使用的第一条提示词，要求先理解资料、不立刻开发。 |

## 原型使用规则

1. 原型图用于表达布局、信息层级和交互方向，不作为最终像素级 UI 规范。
2. 如果原型图中文字、按钮和文档规则冲突，以本文档目录下的 Markdown 说明为准。
3. 不允许因为图片中出现了未解释的小按钮而直接开发对应功能。只有开发说明书中明确列出的按钮和行为才进入 MVP。
4. 主界面的第一原则是：对话负责推进工作，文件负责沉淀成果，搜索负责未来找回。
5. 配置中心、规范中心、知识库中心是 MVP 的关键支撑页面，不是后台管理装饰页。

## 当前设计基线

MVP 是个人本地版，不做团队协作，不做注册登录，不做云端 SaaS 权限系统。默认运行在用户本机，所有 SAP 凭据、案件文件、知识库索引和项目配置均优先本地保存。
