# Phase 4 Case Workflow Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 4 本地案件工作流基础 |
| 所属阶段 | Phase 4 |
| 负责人 Agent | Controller Agent + Product/UX Review Agent + Security Review Agent |
| 涉及文件 | `workbenchTypes.ts`、`caseWorkflowService.ts`、`workspaceStore.ts`、`main.ts`、`preload.ts`、`vite-env.d.ts`、`App.tsx`、`styles.css`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、`git diff --check`、runtime WorkspaceStore task-mode check、targeted `rg` scans |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否让工作台从配置走向案件工作？ | 是。发送消息会沉淀对话、时间线、上下文包、元数据和模式文件。 |
| 是否减少重复劳动？ | 是。用户不再只得到一条临时对话，当前案件目录会保留可恢复上下文。 |
| 是否让结果可追溯？ | 是。AI 本地回复带 `linkedFileIds`，界面用文件 chip 展示本次生成文件。 |
| 是否误导已经接入真实 AI/SAP/飞书？ | 已避免。UI、回复、context pack、metadata 都说明 Phase 4 仅做本地工作流。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反；候选知识仍是待确认 |
| 不调用真实模型 | 未违反；本阶段只用 `local-workflow` 本地占位 |
| 不发布飞书文档 | 未违反 |
| 不做卡片式 Dashboard | 未违反；仍是 Codex 风格对话 + 文件树 |

## 4. 产品/UX 审计

| 风险 | 处理结果 |
|---|---|
| 任务模式只是标签，不能影响工作流 | 已修复。任务模式可选，发送时传给主进程，不同模式生成不同文件。 |
| 文件 chip 不绑定本次回复产物 | 已修复。assistant message 的 `linkedFileIds` 会映射到当前文件树并展示。 |
| 右侧文件搜索没有过滤文件树 | 已修复。右侧文件搜索独立于全局搜索，并过滤当前案件文件树。 |
| 文件面板隐藏按钮无动作 | 已修复。文件面板可隐藏，主区域扩展，并提供显示按钮。 |
| Phase 2 文案残留 | 已修复为 Phase 4 本地工作流文案。 |
| `context_pack.md` 栏目不完整 | 已补齐目标、已确认事实、关键结论、项目上下文、SAP 对象、最近对话、相关文件、边界和下一步。 |

## 5. 安全审计

| 风险 | 处理结果 |
|---|---|
| `local-data` 被 `.gitignore` 忽略，预检扫不到运行时敏感内容 | 已修复。预检新增 runtime local data secret scan，扫描普通运行时 md/json，并排除安全存储目录。 |
| 运行时普通 JSON 里有旧 `secretRef` 值 | 已正常化本地运行时 JSON，普通状态文件不再保存 `secure-store` 引用值。 |
| 生成文件路径只限制在 workspace，不限制在当前案件 | 已修复。新增 `generatedFileTarget`，阻止绝对路径、`..`、空路径段，并要求目录和 purpose 匹配。 |
| `CaseGeneratedFile.purpose` 过宽 | 已收窄为 `output/candidate_knowledge/technical/evidence/snapshot`。 |
| 用户原文被复制到 context pack 和候选知识 | 已修复。派生文件使用安全摘要，不再直接拼接原始输入。 |
| 用户可能粘贴密钥、ABAP 源码或表格数据 | 已增强拦截。写入前阻止高置信密钥、授权头、ABAP 源码/写入语句和多行表格数据。 |
| `workbench:append-message` 可能变宽 | 已收紧。主进程接收 `unknown`，统一解析，只允许本地 `local-workflow` 占位模型。 |

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
安全预检通过。新增 runtime local data secret scan 和 case workflow safety scan 均通过。

命令：
git diff --check

结果：
未发现空白或补丁格式问题。

命令：
runtime WorkspaceStore task-mode check

结果：
problem-analysis: assistantFiles=3
abap-development: assistantFiles=2
document-generation: assistantFiles=2
flow-diagram: assistantFiles=2
linkedFilesVerified=9
fileCount=15
secretBlock=true

命令：
targeted runtime secret scan

结果：
local-data/phase4-runtime 与 local-data/phase4-runtime-2 普通 md/json 未发现 secure-store ref、API key、token、Authorization、Cookie、SAP session 等敏感痕迹。
```

## 7. 剩余风险

| 风险 | 后续处理 |
|---|---|
| 本阶段仍是确定性本地回复，不是真实模型分析 | 保持边界；后续真实任务编排必须单独做上下文最小化和模型调用审计。 |
| conversation.md 仍保存通过安全检查后的用户对话 | 这是案件追溯的核心需求；当前通过高置信敏感内容拦截降低风险。 |
| 文件打开预览尚未实现 | Phase 4 只实现文件树、搜索和本次产物 chip；打开文件可放入后续阶段。 |
| SQLite/FTS 尚未接入 | 仍使用本地 JSON 和文件树；搜索增强在 Phase 6。 |

## 8. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 4 满足“本地案件工作流可用、四种任务模式生成不同本地文件、文件可追溯、无真实外部调用、候选知识不自动入库”的阶段目标。 |
| 必须修复项 | 已完成 |
| 可后续优化项 | 文件打开预览、真实模型任务编排、SQLite/FTS、规范中心接入任务模式。 |
