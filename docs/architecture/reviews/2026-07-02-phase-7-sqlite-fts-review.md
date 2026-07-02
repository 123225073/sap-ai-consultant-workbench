# Phase 7 SQLite FTS Adversarial Review

日期：2026-07-02

## 1. 功能范围

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 7 SQLite + FTS5 搜索基础 |
| 所属阶段 | Phase 7 |
| 当前分支 | `phase-7-sqlite-fts` |
| 涉及文件 | `databaseService.ts`、`searchService.ts`、`workspaceStore.ts`、`package.json`、`package-lock.json`、`security-preflight.ps1` |
| 新增依赖 | `@sqlite.org/sqlite-wasm` |

## 2. 技术决策审计

| 决策 | 结论 |
|---|---|
| 是否直接把 SQLite 变成主数据源 | 否。Phase 7 仍以 `WorkspaceStore` JSON 和案件文件为事实源，SQLite 只是搜索镜像。 |
| 是否使用原生 SQLite 包 | 否。避免当前阶段引入 Electron ABI / Windows 原生编译风险。 |
| 是否使用 Node 内置 `node:sqlite` | 否。本机 Node 23 可加载该模块，但 FTS5 探针失败，错误为 `no such module: fts5`。 |
| 是否使用 SQLite WASM | 是。`@sqlite.org/sqlite-wasm` FTS5 探针通过。 |
| 如何持久化 | 使用 `sqlite3_js_db_export()` 手动导出数据库字节，写入 `local-data/workbench/app.db`。 |
| 搜索排序策略 | 旧 substring 搜索结果优先，SQLite FTS 结果作为补充，避免中文分词退化。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 个人本地版，不做云端 SaaS | 未违反 |
| 不新增注册登录/团队协作 | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反 |
| 不调用真实模型 | 未违反 |
| 不调用飞书 | 未违反 |
| 不新增通用 SQL IPC | 未违反 |
| 不让 renderer/preload 直接访问数据库 | 未违反 |

## 4. 数据库路径

```text
local-data/workbench/app.db
```

该目录已由 `.gitignore` 忽略。数据库只保存搜索镜像，不保存安全存储密文、不保存 `secure-store:sec_*` 引用、不保存 API Key、SAP 密码、Feishu Token 或 SAP session。

## 5. FTS5 探针结果

运行 `databaseService.ts` 独立探针：

```text
health={"ok":true,"fts5Available":true,"error":null}
resultCount=1
firstType=knowledge
dbExists=true
```

运行 `WorkspaceStore` 集成探针：

```text
dbExistsAfterGetState=true
configDbPath=local-data/workbench/app.db
projectResults=5
knowledgeTypes=case,knowledge
fileResults=3
fileTypes=knowledge,file,file
```

## 6. 搜索覆盖范围

| 类型 | 覆盖 |
|---|---|
| 项目 | 项目名、SAP 版本、系统标签、连接状态 |
| 案件 | 案件标题、当前摘要、案件摘要 |
| 文件 | 当前案件文件名、相对路径、用途 |
| 知识 | SQLite 镜像覆盖标题、摘要、中文状态、中文类型、中文来源、SAP 对象、来源文件；旧 substring 兜底仍覆盖已保存知识正文，避免中文搜索退化 |

## 7. 安全扫描结果

修复前已通过：

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

`security-preflight.ps1` 已增加 SQLite FTS 安全扫描：

- `CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5`
- `unsafeSearchPatterns`
- `replaceSearchDocuments`
- `local-data/workbench/app.db`
- `sqlite3_js_db_export`
- 禁止 `sql/sqlite/database/fts` 形式的通用数据库 IPC

修复审查问题后已重新运行同一组验证。

## 8. 修复后运行时探针

| 探针 | 结果 |
|---|---|
| `DatabaseService` 独立探针 | `ok=true`，`fts5Available=true`，可生成 `app.db`，SQLite 搜索返回 1 条 `knowledge` |
| 干净 `WorkspaceStore` 探针 | 可生成 `local-data/workbench/app.db`，配置显示 `local-data/workbench/app.db` |
| 案件搜索 | 查询 `DEMO001` 返回 `case`、`knowledge` |
| 知识搜索 | 查询 `演示BOM` 返回 `case`、`knowledge`，结果包含摘要 |
| 文件搜索 | 追加一次本地文档生成后，查询 `开发说明书` 返回 `file` |
| 旧搜索兜底 | `searchWorkbench(null, ...)` 能返回案件、知识正文命中和文件结果 |

## 9. 对抗式审查结果

| 来源 | 级别 | 问题 | 处理 |
|---|---|---|---|
| Product/UX Agent | P1 | 配置中心没有展示 `databasePath`，文案仍说 SQLite 是后续阶段 | 已在本地存储区展示 `local-data/workbench/app.db`，并说明 SQLite 只是搜索镜像 |
| Product/UX Agent | P1 | SQLite 索引刷新失败可能影响 `getState()` 和保存类主流程 | 已将 `refreshSearchIndex()` 改为失败不阻断主流程；`DatabaseService` 事务和持久化失败会降级健康状态 |
| Product/UX Agent | P2 | 搜索结果不显示摘要，用户不清楚为什么命中 | 已在搜索结果中显示 `snippet` |
| Product/UX Agent | P2 | 左侧“搜索”按钮看似可点但无动作，文案仍只说搜项目/案件/文件名 | 已让按钮聚焦搜索框，并更新为项目、案件、文件、知识摘要 |
| Security/Architecture Agent | P2 | SQLite 索引刷新失败会让关键界面请求失败 | 同上，索引刷新变成尽力而为的搜索镜像动作 |
| Security/Architecture Agent | P2 | FTS 仍可能保存最多 4000 字知识正文镜像 | 已移除知识正文进入 SQLite 镜像的路径，将 FTS 额外文本限制到 1200 字，并增加 ABAP/SQL 形态拦截 |

## 10. 已知风险

| 风险 | 处理 |
|---|---|
| SQLite WASM 在 Node 中不是自动持久化 | 已用 `sqlite3_js_db_export()` 手动持久化。后续打包阶段需再次验证 Electron 运行时路径。 |
| 默认 FTS5 分词对中文子串不稳定 | 已保留旧 substring 搜索优先，SQLite FTS 只补充结果。 |
| npm audit 报 Electron / esbuild 漏洞 | 漏洞来自既有依赖，不是 SQLite 新依赖；自动修复需要大版本升级，放入发布加固阶段处理。 |
| SQLite 失败时搜索可用性 | `DatabaseService.initialize()` 捕获失败，`refreshSearchIndex()` 不阻断主流程，`searchService` 会回退旧搜索。 |

## 11. 结论

| 结论 | 说明 |
|---|---|
| 阶段通过条件 | SQLite FTS5 搜索镜像基础已建立，且不替代 JSON 主存储。 |
| 必须修复项 | 对抗式审查无 P0；P1 已处理并通过最终验证。 |
| 后续优化项 | Electron 运行时实机启动验证、FTS 中文 tokenizer 优化、Electron/esbuild 安全升级、SQLite 主存储迁移。 |
