# Phase 6 Knowledge Center Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 6 本地知识库中心 |
| 所属阶段 | Phase 6 |
| 负责人 Agent | Controller Agent + Product/UX Review Agent + Security/Architecture Review Agent |
| 涉及文件 | `workbenchTypes.ts`、`knowledgeService.ts`、`workspaceStore.ts`、`caseWorkflowService.ts`、`main.ts`、`preload.ts`、`vite-env.d.ts`、`KnowledgeCenter.tsx`、`App.tsx`、`styles.css`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、`git diff --check`、runtime knowledge center check、targeted `rg` scans |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否打通“案件 -> 候选知识 -> 人工确认”闭环？ | 是。案件问题分析会刷新或创建待确认知识候选，只有用户在知识库页确认后才发布。 |
| 是否支持知识状态管理？ | 是。支持草稿、待确认、已发布、有冲突、已失效。 |
| 是否保留知识来源和时间线？ | 是。知识项记录项目、来源案件、来源文件、更新时间、发布时间和时间线事件。 |
| 是否能在全局搜索找回知识？ | 是。搜索结果支持 `knowledge` 类型，并在 UI 显示为“知识”。 |
| 是否避免把知识库做成上传资料页？ | 是。本阶段以人工确认和状态流转为核心；上传、QA、飞书同步仅保留禁用入口。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 个人本地版，不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反；案件只生成 `pending`，发布必须人工点击 |
| 不调用真实模型 | 未违反 |
| 不发布或同步飞书文档 | 未违反 |
| 不解析真实上传文件 | 未违反；入口禁用 |
| UI 不做卡片式 Dashboard | 未违反；采用状态筛选、列表、详情三栏工作页 |

## 4. 产品/UX 审计

| 风险 | 处理结果 |
|---|---|
| 知识库入口仍是死按钮 | 已修复。左侧“知识库”进入真实页面，并有选中态。 |
| 搜索结果把知识误标为文件 | 已修复。全局搜索 UI 对 `knowledge` 类型显示“知识”。 |
| 冲突知识可一键确认入库 | 已修复。前端禁用冲突/失效知识确认按钮，主进程也拒绝发布冲突、失效、已发布或仍有关联冲突的知识。 |
| 文档上传、QA、飞书同步误导用户以为已可用 | 已处理。按钮禁用并说明 Phase 6 不解析真实文件、不导入真实 QA、不调用飞书。 |
| 候选知识重复堆积 | 已处理。同来源待确认候选会刷新时间线；如果旧知识已发布或失效，新处理会生成新的待确认候选。 |
| 页面样式缺失 | 已处理。新增 `knowledge-*` 布局样式，保持工具型页面。 |

## 5. 安全与架构审计

| 风险 | 处理结果 |
|---|---|
| 自动发布正式知识 | 已阻止。案件工作流只创建或刷新 `pending` 候选；安全预检扫描自动发布路径。 |
| 冲突知识覆盖旧知识 | 已阻止。冲突只改状态和时间线，不删除或覆盖旧知识。 |
| 失效知识被删除 | 已避免。失效只设置 `expired/effectiveTo`，历史保留。 |
| 知识内容包含密钥、Token、SAP session 或源码 | 已增强。保存、归一化和发布前做高置信敏感内容检查，并扩大 ABAP 源码特征。 |
| 知识来源路径被当文件路径读取 | 已避免。`sourceFilePath` 只作为来源字符串；预检禁止直接 `readFile/path.join/openPath`。 |
| 文档导入占位执行真实本地文件/网络/命令 | 已避免。预检禁止知识中心出现 `showOpenDialog/readFile/fetch/execFile/openExternal/loadURL` 等真实导入能力。 |
| IPC 面扩大 | 已避免。只新增读取、确认、标冲突、标失效四个窄 IPC。 |
| 知识文件路径被用户控制 | 已避免。只写固定 `knowledge/project-knowledge.json` 和 `knowledge/project-knowledge.md`。 |

## 6. 验收证据

```text
命令：
npm run check

结果：
TypeScript 检查通过。

命令：
npm run build

结果：
main、preload、renderer 生产构建通过。

命令：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1

结果：
安全预检通过。知识库 IPC 白名单、知识安全标记、路径守卫、自动发布扫描、发布守卫、导入占位扫描、sourceFilePath 扫描均通过。

命令：
git diff --check

结果：
未发现空白或补丁格式问题。

命令：
runtime knowledge center check

结果：
initialTotal>=3
pendingCandidate=knowledge-demo-pending-bom
candidateRefreshed=true
explicitPublishThenExpire=expired
conflictPublishRejected=true
knowledgeSearchResults=1
knowledgeFilesPersisted=true

命令：
targeted sensitive business keyword scan

结果：
未发现指定旧 SAP/客户业务关键词进入当前源码、计划或审查文档。

命令：
phase wording scan

结果：
当前 `apps/desktop/src` 与 Phase 6 计划中未发现 Phase 4 或 Phase 5 残留文案。
```

## 7. 剩余风险

## 7.1 对抗式复审闭环

2026-07-02 复审增加 Product/UX Agent 和 Security/Architecture Agent 只读检查，结论为无 P0。已闭环的问题：

| 发现 | 处理 |
|---|---|
| 状态筛选为空时，右侧详情可能显示不属于当前筛选的知识项 | 已修复。详情只从当前筛选结果中选择；筛选为空时不回退到其他知识项。 |
| 文档解析队列显示“已解析”，容易误导为真实文件已经解析 | 已修复。演示队列改为后续入口和暂不可处理，页面明确说明当前不读取或解析真实文档。 |
| 全局搜索知识结果显示英文内部状态，来源不清楚 | 已修复。搜索结果改为中文状态、中文来源，并显示案件或来源文件。 |
| 知识列表和详情暴露 `case_note`、`qa-import` 等内部枚举 | 已修复。页面改为中文类型和中文来源。 |
| 禁用入口只靠 tooltip 说明 | 已修复。按钮文案加“后续”，页面增加可见说明：当前不读取上传文件、不导入真实 QA、不连接飞书。 |
| 待确认和有冲突颜色过近 | 已修复。有冲突改为红色，已失效改为蓝色，降低误判。 |
| runtime 本地数据扫描范围偏窄 | 已修复。安全预检从 `local-data/workbench` 扩展到 `local-data` 下所有 Markdown/JSON 运行快照。 |
| 候选知识和输出文件重复复制用户输入摘要 | 已收紧。除 `conversation.md` 作为案件对话记录外，候选知识、输出文件和上下文摘要不再复制用户原文摘要。 |

保留的产品边界：案件对话必须本地保存，否则无法满足“案件可追溯”和“跨天继续处理”的核心目标。当前策略是拦截高置信密钥、授权信息、SAP session、SAP 源码、写入语句和表格行数据，同时确保 `local-data/` 被 Git 忽略，不提交到 GitHub。

| 风险 | 后续处理 |
|---|---|
| 本阶段没有真实文档解析 | 保持边界；后续 Phase 7 可实现本地文件导入、结构化解析和入库前编辑。 |
| 当前没有 SQLite/FTS5 | 仍使用 JSON 和文件树；后续应迁入 SQLite FTS5。 |
| 候选知识内容仍较摘要化 | 后续接真实模型/解析器时，需要增加入库前编辑器和质量检查。 |
| 自动冲突检测未实现 | 当前只支持人工标冲突；后续再做范围、SAP 版本、对象维度冲突检测。 |

## 8. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 6 满足“本地知识库中心、待确认候选、人工确认入库、冲突/失效状态、搜索整合、固定本地文件持久化、安全边界”的阶段目标。 |
| 必须修复项 | 已完成 |
| 可后续优化项 | 文档导入解析、QA 导入、入库前编辑、SQLite/FTS5、自动冲突检测、来源文件打开预览。 |
