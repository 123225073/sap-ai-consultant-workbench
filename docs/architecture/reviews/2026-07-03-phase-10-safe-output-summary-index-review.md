# Phase 10 Safe Output Summary Index Adversarial Review

日期：2026-07-03

## 1. 功能范围

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 10 安全输出摘要索引 |
| 当前分支 | `codex/phase-10-safe-output-summary-index` |
| 计划文档 | `docs/superpowers/plans/2026-07-03-phase-10-safe-output-summary-index-plan.md` |
| 涉及文件 | `workspaceStore.ts`、`searchService.ts`、`databaseService.ts`、`App.tsx`、`preload.ts`、`caseWorkflowService.ts`、`security-preflight.ps1` |

Phase 10 只让搜索命中本地项目/案件 `outputs/` 下直接安全文本交付物的短摘要。它不做通用全文搜索，不索引技术证据、源码快照、内部 JSON，不新增 IPC，不调用 SAP、模型或飞书。当前案件命中可以打开右侧只读预览，历史案件命中只展示来源。

## 2. 第一性原理

| 问题 | 结论 |
|---|---|
| 用户为什么需要这个功能 | Phase 9 已能点击预览文件，但历史追溯仍需要逐个打开文件。安全摘要索引让用户能通过关键词找回交付物。 |
| 为什么不是直接接模型 | 模型执行需要安全上下文边界。先建立“只取安全短摘要”的机制，后续模型才不会直接拿到文件全文、内部状态或敏感材料。 |
| 为什么不是飞书发布 | 发布是外部动作，当前交付物还应先在本地可找回、可检查。 |

## 3. MVP 边界审计

| 边界 | 结果 |
|---|---|
| 个人本地版 | 未引入登录、团队或 SaaS。 |
| SAP 默认只读 | 未新增 SAP 调用。 |
| 不发布飞书 | 未新增 Feishu CLI 调用。 |
| 不自动知识入库 | 未新增知识发布。 |
| 不新增通用文件读取 IPC | 继续复用 `workbench:search`，无新增 IPC。 |
| 不索引技术材料 | 只允许 `outputs/` 安全文本摘要。 |

## 4. 安全审计

| 风险 | 处理 |
|---|---|
| 任意文件被索引 | `readAllSafeOutputSummaries()` 遍历本地项目/案件，但每个案件只处理文件树里的直接 `outputs/<file>` 文件。 |
| 路径逃逸 | 复用相对路径校验，并使用 `lstat` 与 `realpath` 验证真实路径在当前案件内。 |
| 内部状态泄露 | `.json` 不在白名单；`metadata.json`、`messages.json`、`project.json`、`app-state.json` 不会进入摘要索引。 |
| 密钥进入 SQLite | 命中 Bearer、Authorization、Cookie、SAP session、API key、client_secret、access_key、secret、secure-store、Token、private key 时整文件跳过。 |
| SAP 源码或 SQL 进入索引 | 命中 ABAP 形态、`SELECT ... FROM`、写入语句时整文件跳过。 |
| 全文过长泄露 | 单文件上限 128 KB，只读 32 KB，最终摘要最多 600 字符。 |
| UI 误导 | 搜索结果标记为“安全摘要”，标题说明“含本地案件安全输出摘要”；历史案件结果不提供直接预览按钮。 |
| 旧 SQLite 缓存残留 | `app.db` 只作为可重建搜索缓存；启动时不再导入旧缓存，刷新时重建 FTS 表并压缩清理。 |

## 5. 多 Agent 发现和处理

| 来源 | 级别 | 发现 | 处理 |
|---|---|---|---|
| Product/UX Agent | P1 | Phase 10 最有价值方向是安全模型案件执行。 | 采纳其目标，但先实现模型上下文所需的安全摘要边界，避免下一步直接暴露正文。 |
| Product/UX Agent | P2 | 前端只用 `caseId` 判断当前案件预览，跨项目同案件 ID 可能误开当前案件同路径文件。 | 已修复：预览入口必须同时匹配 `projectId` 与 `caseId`。 |
| Product/UX Agent | P3 | 安全摘要结果 ID 未包含项目 ID，多项目同案件 ID 和同路径时可能冲突。 | 已修复：`file-summary-*` ID 加入 `projectId`。 |
| Security/Architecture Agent | P0 | 真实模型、SAP、飞书发布都比摘要索引更容易越界。 | Phase 10 不接外部系统，只做安全输出摘要索引。 |
| Security/Architecture Agent | P0 | 禁止通用文件读取 IPC、SQL 代理、任意路径索引。 | 无新增 IPC；安全预检加入危险名字和固定标记扫描。 |
| Security/Architecture Agent | P1 | 用户手工改输出文件后可能加入密钥或源码。 | 每次索引前重新扫描内容，命中即跳过。 |
| Security/Architecture Agent | P1 | 安全预检误伤 `searchService.ts` 中的旧 SAP 路径拦截标记。 | 已修复：预检允许 `workspaceStore.ts` 和 `searchService.ts` 内的拦截代码。 |
| Security/Architecture Agent | P1 | 裸 `sk-proj-`、GitHub PAT、Slack token、AWS AKIA 等格式可能漏网。 | 已修复：摘要索引、预览脱敏、SQLite 兜底扫描均补充这些格式。 |
| Security/Architecture Agent | P2 | 本地 `app.db` 可能残留旧 FTS 索引字节。 | 已修复：SQLite 搜索缓存启动时不导入旧文件，刷新时重建表；真实本地刷新后残留扫描通过。 |
| Product/UX Agent | P2 | 用户可能误以为是完整全文搜索。 | UI 明确为“安全输出摘要”。 |

## 6. 运行探针

```text
summaryBodySearch=ok
historicalSummaryBodySearch=ok
duplicateProjectSummaryId=ok
summaryRecordShape=ok
technicalNotIndexed=ok
nestedTechnicalNotIndexed=ok
evidenceNotIndexed=ok
nestedEvidenceNotIndexed=ok
snapshotNotIndexed=ok
nestedSnapshotNotIndexed=ok
jsonNotIndexed=ok
secretOutputSkipped=ok
clientSecretOutputSkipped=ok
accessKeyOutputSkipped=ok
skProjOutputSkipped=ok
githubPatOutputSkipped=ok
ghpOutputSkipped=ok
slackTokenOutputSkipped=ok
awsAccessKeyOutputSkipped=ok
abapOutputSkipped=ok
sqlOutputSkipped=ok
oversizedOutputSkipped=ok
staleBeforeMutationSearch=ok
staleSensitiveRefreshCleared=ok
symlinkEscape=skipped
probeRoot=C:\Users\CM1165\AppData\Local\Temp\sap-ai-phase10-index-WQY135
```

真实本地 SQLite 刷新验证：

```text
realSearchRefresh=ok
realUnsafeSearchQueries=ok
localIndexResidualScan=ok
databasePath=D:\9005_IDEauthorized\Codex Project\sap-ai-consultant-workbench\local-data\workbench\app.db
```

说明：当前 Windows 环境未允许创建 symlink，因此 symlink 逃逸探针跳过；代码仍使用 `lstat` 和 `realpath` 拦截。

## 7. 验证命令

```text
命令：npm run check
结果：exit 0

命令：npm run build
结果：exit 0

命令：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
结果：exit 0
Security preflight passed.

命令：git diff --check
结果：exit 0
```

## 8. 剩余风险

| 风险 | 后续处理 |
|---|---|
| 中文 FTS 命中可能受分词影响 | 保留 fallback 搜索；Phase 10 验收不绑定中文分词。 |
| 摘要不是完整正文 | 这是安全取舍。后续若需要更强检索，必须继续做摘要级白名单，而不是全文入库。 |
| 二进制输出不可搜正文 | 本阶段只处理安全文本，Excel/图片后续单独设计。 |

## 9. 结论

| 结论 | 说明 |
|---|---|
| 条件通过 | Phase 10 在不扩大 IPC、SAP、模型、飞书和文件系统边界的前提下，让本地案件安全输出摘要可被搜索找回。 |
| 下一步建议 | 在该安全摘要边界稳定后，再设计“安全模型案件执行”，模型上下文只能使用经过同类规则筛选的短摘要。 |
