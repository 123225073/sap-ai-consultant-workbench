# SAP AI 顾问工作台新项目交接说明

日期：2026-07-01
用途：用于新开独立项目 / GitHub 仓库时，快速恢复本轮产品设计上下文。

> 历史说明：本仓库和桌面应用现已建立，本文第 1、5、6、8 节保留为项目创建阶段记录，不再代表当前开发状态。当前事实先读根目录 `CONTEXT.md`、`README.md`、独立 Agent Runtime 架构和 Phase 50 规格。

## 1. 是否应该新开项目

结论：应该新开独立项目和独立 Git 仓库。

原因：

1. 当前目录 `SAP ABAP` 更像 SAP 工作资料区，里面有 ADT CLI、SAP 连接脚本、输出文档和公司相关分析材料。
2. `SAP AI 顾问工作台` 是一个独立产品，未来会涉及桌面应用、前端界面、本地数据库、连接器、知识库、打包发布和 GitHub 管理。
3. 如果继续放在当前 SAP 工作区里，产品代码、SAP 工作文件、原型文档、临时输出会混在一起，后续很难维护。
4. 新仓库可以单独设计开源边界，避免误提交 SAP 凭据、公司源码、业务文档和内部输出。

推荐方式：

```text
D:\9005_IDEauthorized\Codex Project\
  SAP ABAP\                 # 保留为现有 SAP 工作区
  sap-ai-consultant-workbench\  # 新建产品开发仓库
```

建议 GitHub 仓库名：

```text
sap-ai-consultant-workbench
```

备选名称：

```text
sap-ai-workbench
sap-consultant-ai-workbench
sap-codex-workbench
```

## 2. 新仓库当前已有资料

当前产品资料已经迁移到新仓库，不需要新线程再复制或迁移文档。

当前资料目录：

```text
docs/product-prototype/
```

包含：

| 文件 | 用途 |
|---|---|
| `README.md` | 原型索引和设计基线。 |
| `PRODUCT_DEVELOPMENT_SPEC.md` | 产品开发说明书 / PRD。 |
| `TECHNICAL_IMPLEMENTATION.md` | 技术实现文档。 |
| `NEW_PROJECT_HANDOFF.md` | 当前交接说明。 |
| `images/01-main-workbench-actions-permissions.png` | 当前主工作台原型图：自由对话、固定案件动作、项目 / 案件权限模式。 |
| `images/01-main-workbench.png` | 主工作台历史原型图，仅保留作对照。 |
| `images/02-config-center.png` | 配置中心原型图。 |
| `images/03-standards-center.png` | 规范中心原型图。 |
| `images/04-knowledge-center.png` | 知识库原型图。 |

后续新线程只需要读取这些文档并理解，不要再从 `SAP ABAP` 工作区复制资料。

不建议从旧工作区复制：

- SAP 真实输出文件。
- 真实 ABAP 源码快照。
- SAP 凭据文件。
- 飞书 Token。
- 本地 `.sap-adt-cli` 配置。
- 公司业务数据。

`SAP ABAP` 工作区可以作为历史参考来源，但不能作为新项目运行依赖。旧工作区删除后，新项目仍应能依靠本目录文档继续开发。

## 2.1 已沉淀到技术文档的旧工作区经验

以下经验已经沉淀进 `TECHNICAL_IMPLEMENTATION.md`，新线程不需要再读取旧工作区才能理解：

1. ADT 配置不能只保存表单，必须执行 `status` 和 `T000` 最小读取验证。
2. ADT 默认只读，源码写入、激活、传输操作不进入 MVP。
3. SAP 密码、API Key、飞书 Token 不得进入日志、文档、案件文件或模型上下文。
4. SAP 源码读取不等于必须落盘，只有修改、文档交付、版本对比等场景才保存快照。
5. 当前飞书 CLI 只验证 CLI/Profile、`doctor`、`auth status --verify` 和所需 scope，并生成本地交接草稿；不会在应用内创建/更新云端文档或白板。
6. 飞书缺少 scope 时必须走授权流程，不要反复生成新 device code。
7. 本地飞书交接草稿默认强调业务背景、关键逻辑、异常边界和上线确认，不堆砌低价值技术明细。

## 3. 本轮讨论沉淀出的核心产品判断

### 3.1 产品不是 Codex 套壳

产品可以参考 `openai/codex` 公开的 Agent 设计模式，但用户不应该跳转到 Codex App 里工作，核心功能也不能要求安装 Codex。

最终产品应该是：

> 用户在 `SAP AI 顾问工作台` 里完成 SAP 问题分析、ABAP 开发、文档生成、流程图生成和经验沉淀。

产品必须拥有自己的 Agent Runtime：负责消息事件、Provider 适配、工具门禁、上下文与记忆、Skills、MCP 和受控子 Agent。Codex CLI 只作为迁移期可选兼容适配器，不能充当核心中转。

技术决策见：

- `docs/architecture/INDEPENDENT_AGENT_RUNTIME.md`
- `docs/adr/0002-independent-agent-runtime.md`
- `docs/superpowers/specs/2026-07-15-phase-50-independent-agent-runtime-foundation-design.md`
- `docs/superpowers/plans/2026-07-15-phase-50-independent-agent-runtime-foundation-plan.md`

### 3.2 产品不是通用知识库平台

知识库不是简单上传文档、切片、向量化。

它应该是：

> 面向 SAP 项目和案件的知识资产库。

长期目标必须支持；当前 0.1.0 已实现 Markdown/TXT 文档导入、案件候选知识、人工确认、冲突门禁和时间线，表格/跨页结构化解析与 QA 批量导入仍在第二阶段：

- 文档上传。
- 表格和跨页内容结构化解析。
- QA 导入。
- 案件候选知识。
- 人工确认入库。
- 冲突检测。
- 生效时间和失效时间。
- 项目、SAP 版本、SAP 对象维度。

### 3.3 产品不是传统 SaaS Dashboard

界面应该尽量参考 Codex App：

- 左侧：统一侧栏，入口、项目、案件和个人信息。
- 中间：连续对话流。
- 右侧：可折叠当前案件文件。
- 底部：输入框、固定案件动作、项目 / 案件权限模式、模型选择。

不要做成一堆卡片和图表的后台系统。

### 3.4 案件是核心对象

每个业务问题、开发需求、运维问题都应该变成一个案件。

案件负责承载：

- 对话。
- 当前结论。
- 交付物。
- 技术过程文件。
- 知识候选。
- 时间线。
- 上下文恢复包。

### 3.5 文件是成果载体

不要把 SAP 读取对象、源码快照、技术证据固定展示在 UI 里。

这些内容应该作为文件保存在案件目录中：

```text
technical/
snapshots/
evidence/
outputs/
knowledge_candidates/
```

用户需要时再打开文件查看。

### 3.6 知识必须慢入库

日常对话不能自动正式入库。

正确流程：

```text
案件对话/文件
  -> 生成候选知识
  -> 用户人工审核
  -> 冲突检测
  -> 确认入库
  -> 正式知识库
```

### 3.7 规范必须按项目管理

ABAP 规范、注释规范、流程图规范、文档模板不能只有一套全局规则。

推荐：

```text
全局基础模板
  -> S4 模板
  -> ECC 模板
    -> 项目规范副本
      -> 案件临时规则
```

项目规范从模板或其他项目复制后，必须成为当前项目独立副本。

## 4. MVP 边界

### 4.1 MVP 必须做

1. 本地桌面应用壳。
2. Codex 风格主界面。
3. 多项目管理。
4. 案件管理。
5. 当前案件文件夹。
6. 配置中心。
7. 规范中心。
8. 知识库中心。
9. 固定案件动作，用于把当前对话沉淀成笔记、开发说明书、流程图、候选知识或交付物。
10. 项目 / 案件权限模式：请求批准、替我批准、完全访问。
11. 能力中心：导入并校验 Skill、启停与上下文注入；动作绑定属于第二阶段。
12. 模型 API 渠道配置和模型选择。
13. ADT 只读连接和验证。
14. 飞书 CLI 验证和本地交接草稿；云端文档发布属于第二阶段。
15. 文件保存和搜索。

### 4.2 MVP 不做

1. 团队版。
2. 注册登录。
3. 云端 SaaS。
4. 权限系统。
5. 自动写 SAP。
6. 自动释放传输。
7. 自动正式入库知识。
8. 完全本地大模型推理。

## 5. 推荐新仓库结构

```text
sap-ai-consultant-workbench/
  README.md
  docs/
    product-prototype/
    architecture/
    decisions/
  apps/
    desktop/
  packages/
    core/
    connectors/
    knowledge/
    standards/
    ui/
  scripts/
  .gitignore
  package.json
```

如果使用 Electron + React + TypeScript，可以进一步细化：

```text
apps/desktop/
  src/
    main/          # Electron 主进程
    renderer/      # React UI
    preload/       # IPC 安全桥
packages/core/
  src/
    projects/
    cases/
    files/
    search/
packages/connectors/
  src/
    sap-adt/
    feishu-cli/
    model-gateway/
    codex/
packages/knowledge/
  src/
    parser/
    candidates/
    conflicts/
packages/standards/
  src/
    templates/
    profiles/
```

## 6. 第一阶段建议开发目标（历史记录）

第一阶段不要直接做完整 AI 能力，先做可运行的本地工作台骨架：

1. Electron + React 应用启动。
2. 左侧统一侧栏。
3. 中间对话界面。
4. 右侧当前案件文件面板。
5. 项目和案件本地数据库。
6. 创建项目。
7. 创建案件。
8. 案件文件夹生成。
9. 文件树读取。
10. 本地搜索基础界面和接口。

第一阶段完成后，再接：

1. 配置中心。
2. ADT 连接验证。
3. API 模型获取。
4. 飞书 CLI 验证。

这样可以避免一开始就陷入 AI 编排、知识库和 SAP 连接细节。

## 7. GitHub 和开源注意事项

未来如果提交 GitHub，必须先做好 `.gitignore` 和敏感信息隔离。

必须忽略：

```text
.env
.env.*
*.key
*.pem
*.p12
secrets/
credentials/
private-credentials.json
.sap-adt-cli/
local-data/
workspace-data/
SAP真实输出/
```

必须避免提交：

- SAP 密码。
- API Key。
- 飞书 Token。
- 公司 ABAP 源码。
- 公司业务文档。
- 真实客户数据。
- 真实生产系统地址。

建议新仓库初始提交只包含：

- 产品原型。
- PRD。
- 技术文档。
- 空应用骨架。
- 示例配置文件，不含密钥。

## 8. 新开 Codex 对话线程规则

建议新开一个 Codex 对话线程用于开发。

原因：

1. 当前线程已经很长，主要价值是产品设计和需求澄清。
2. 开发阶段需要频繁读写代码、运行测试、调整架构，继续在当前线程会混杂产品讨论和开发执行。
3. 新线程可以从 `docs/product-prototype/NEW_PROJECT_HANDOFF.md` 开始，快速恢复上下文。
4. 当前线程可以保留为产品设计档案。

推荐方式：

- 当前线程：产品设计和需求档案。
- 新线程：创建仓库、搭应用壳、实现 MVP。

新线程第一条消息必须明确：先读取资料、复述理解、输出开发计划，等待用户确认后再开发。

推荐使用：

```text
请读取 docs/product-prototype/NEW_THREAD_PROMPT.md，并严格按其中要求执行。
```

## 9. 当前已有资产位置

当前资产已经位于新项目：

```text
D:\9005_IDEauthorized\Codex Project\sap-ai-consultant-workbench\docs\product-prototype
```

新线程应在新项目根目录启动：

```text
D:\9005_IDEauthorized\Codex Project\sap-ai-consultant-workbench
```

这样后续开发时，代码和文档引用路径稳定，并且不会误操作旧 `SAP ABAP` 工作区。
