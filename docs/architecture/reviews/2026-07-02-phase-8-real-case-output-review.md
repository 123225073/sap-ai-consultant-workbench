# Phase 8 Real Case Output Adversarial Review

日期：2026-07-02

## 1. 功能范围

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 8 真实本地案件输出 |
| 所属阶段 | Phase 8 |
| 当前分支 | `phase-8-real-case-output` |
| 涉及文件 | `caseWorkflowService.ts`、`App.tsx`、`ConfigCenter.tsx`、`preload.ts`、`workspaceStore.ts`、`knowledgeService.ts` |
| 计划文件 | `docs/superpowers/plans/2026-07-02-phase-8-real-case-output-plan.md` |

Phase 8 只提高本地案件输出质量，不新增真实 SAP 读取、真实模型案件调用、飞书发布、IPC、数据库 schema 或密钥链路。

## 2. 输出文件矩阵

| 任务模式 | 新增或刷新文件 | 目录边界 |
|---|---|---|
| 问题分析 | `outputs/问题分析_处理结论.md`、`outputs/问题分析_核对清单.csv`、`knowledge_candidates/问题处理经验候选.md`、`evidence/本地处理证据.md` | output / candidate_knowledge / evidence |
| ABAP 开发 | `outputs/ABAP只读开发草稿.md`、`outputs/请求说明草稿.md`、`snapshots/SAP只读快照说明.md`、`technical/ABAP开发安全边界.md` | output / snapshot / technical |
| 文档生成 | `outputs/开发说明书.md`、`outputs/上线确认清单.csv`、`outputs/飞书发布准备说明.md` | output |
| 画流程图 | `outputs/逻辑说明图.mmd`、`outputs/流程图说明.md`、`outputs/流程节点清单.csv` | output |

CSV 使用引号转义，并对公式开头字符加安全前缀，能作为 Excel-like 表格文件打开。Mermaid 文件仅保存源文本，不生成图片、不发布飞书白板。

## 3. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否帮助 SAP 顾问推进案件？ | 是。每个任务模式都产生可编辑、可追溯的本地输出，而不是只返回演示说明。 |
| 是否减少重复劳动？ | 是。结论、核对清单、开发草稿、上线清单、流程节点清单会自动落到当前案件目录。 |
| 是否让结果更可追溯？ | 是。README、timeline、context_pack、metadata 和输出文件同步刷新。 |
| 是否只是装饰性功能？ | 否。输出文件是 MVP 验收中“文件沉淀”和“右侧文件面板可见”的关键承载。 |

## 4. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反，metadata 仍为 `sapWrite: "disabled"` |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反，问题分析只生成待确认候选知识 |
| 不调用真实模型 | 未违反，案件流程仍使用 `local-workflow` |
| 不创建或发布飞书文档 | 未违反 |
| 不做卡片式 Dashboard | 未违反，仍保持左侧栏、中间对话、右侧文件面板结构 |

## 5. 安全审计

| 风险 | 检查结果 |
|---|---|
| 文件路径逃逸 | 已加固。输出仍通过 `generatedFileTarget()`，会拒绝绝对路径、盘符、`..`、空路径段和用途目录不匹配；旧状态里的案件目录名会经 `normalizeCaseSummary()` 净化，`caseRoot` 还会经 `assertInsideCasesRoot()` 限制在当前项目 `cases/` 子树内。 |
| SAP 密码进入代码、日志、数据库、Markdown | 未发现。输出只写边界说明，不写密钥值或安全存储引用。 |
| API Key / 飞书 Token 明文保存 | 未发现。文案明确不记录 Token、App Secret、授权 URL 或设备码。 |
| SAP 源码误保存 | 未发现。ABAP 模式只生成只读开发草稿和快照说明，不生成真实源码。 |
| 真实业务表格行误保存 | 未发现。输入拦截仍阻止多行结构化表格；输出 CSV 是固定核对清单，不复制原始业务行。 |
| 文件写入是否限制在当前案件目录 | 通过 `generatedFileTarget()`、`normalizeCaseSummary()` 和 `assertInsideCasesRoot()` 限制；恶意目录名探针通过。 |
| UI 是否能触发 SAP 写入、激活、删除、传输释放 | 未发现相关入口。 |
| 是否新增通用 IPC / SQL / 文件 / 命令 / 网络代理能力 | 未新增 IPC。安全预检白名单通过。 |
| SQLite 是否变成秘密或源码存储 | 未改变；SQLite 仍是搜索镜像。 |

## 6. 体验审计

| 问题 | 检查结果 |
|---|---|
| 按钮是否都有明确用途 | 未新增按钮；现有按钮说明更新为当前阶段文案。 |
| 是否符合核心界面结构 | 是。主界面仍是左侧栏、中间对话、右侧当前案件文件、底部输入。 |
| 是否避免误导真实外部执行 | 已加强。UI 明确 Phase 8 不读取真实 SAP、不调用真实模型、不发布飞书。 |
| 模拟验证是否会被误认为真实验证 | 已加强。配置中心和顶部通知显示“模拟验证 / 真实 CLI / 真实 HTTP”模式。 |
| CSV 输出是否可识别 | 已优化。右侧文件树把 CSV 和清单文件显示为表格图标。 |
| 回复里的文件 chip 是否能定位文件 | 已修复。文件树行有稳定锚点，chip 可以跳到对应文件行。 |

## 7. 多 Agent 发现和处理

| 来源 | 级别 | 问题 | 处理 |
|---|---|---|---|
| Product/UX Agent | P1 | 案件输出仍是 Phase 6 演示文本，不够像用户可用成果 | 已升级为 Markdown、CSV、Mermaid、候选知识、证据和安全边界文件。 |
| Product/UX Agent | P1 | UI 文案可能让用户误以为已接真实 SAP / 模型 / 飞书 | 已把 Phase 6 / 本地演示文案改为 Phase 8 本地输出，并标明外部动作未执行。 |
| Product/UX Agent | P2 | `conversation.md` 把确定性回复称为 AI | 已改成“本地工作流”。 |
| Product/UX Agent | P2 | 配置验证报告没有明显区分 fake 和真实验证 | 已新增验证模式显示，并在成功提示中区分模拟验证和真实验证。 |
| Security/Architecture Agent | P1 | 审计文档必须覆盖路径逃逸、敏感内容、外部动作、IPC、知识边界、SQLite 镜像和 Git 忽略 | 已在本审计文档和最终验证中覆盖。 |
| Security/Architecture Agent | P1 | 发布前必须处理 dirty tree，否则 `-RequireClean` 会失败 | 本阶段会在提交后运行 clean-tree 安全预检。 |
| Security/Architecture Review Agent | P1 | `caseRoot` 依赖旧状态里的 `folderName`，手工篡改可能写出当前案件目录结构 | 已新增 `normalizeCaseSummary()` 净化案件目录名，并新增 `assertInsideCasesRoot()` 强制案件目录必须位于当前项目 `cases/` 子树内。 |
| Security/Architecture Review Agent | P2 | CSV 可能存在公式注入风险 | 已让 `csvCell()` 对 `= + - @` 开头内容加安全前缀。 |
| Product/UX Review Agent | P1 | 审计证据需要记录 Phase 8 复审、运行探针、build/security 检查 | 已补本审计文档，并记录运行时探针、build、安全预检和 diff 检查。 |
| Product/UX Review Agent | P2 | 文件 chip 的 `#路径` 不能跳到右侧文件行 | 已给文件树行增加稳定锚点，chip 链接现在指向对应文件行。 |
| Product/UX Review Agent | P2 | 搜索只证明文件名存在，未检索生成文件正文 | 暂不扩大。索引文件正文会触及敏感内容边界，后续用专项方案实现“只索引安全输出摘要”。 |

## 8. 验收证据

### TypeScript

```text
命令：
npm run check

结果：
exit 0
tsc --noEmit 通过
```

### 运行时案件输出探针

第一次探针因 PowerShell 管道把中文文件名转成问号失败；改用 UTF-8 管道后通过。

```text
命令：
UTF-8 Node probe with WorkspaceStore temp root

结果：
mode=problem-analysis files=4 ok
mode=abap-development files=4 ok
mode=document-generation files=3 ok
mode=flow-diagram files=3 ok
metadataSafety=ok
searchGeneratedOutput=ok
probeRoot=C:\Users\CM1165\AppData\Local\Temp\sap-ai-phase8-probe-ZJZAzr
```

修复 P1 后重新运行：

```text
mode=problem-analysis files=4 ok
mode=abap-development files=4 ok
mode=document-generation files=3 ok
mode=flow-diagram files=3 ok
metadataSafety=ok
searchGeneratedOutput=ok
caseRootTamperSanitized=ok
loadedMessageModelBoundary=ok
outputProbeRoot=C:\Users\CM1165\AppData\Local\Temp\sap-ai-phase8-probe-usis64
escapeProbeRoot=C:\Users\CM1165\AppData\Local\Temp\sap-ai-phase8-escape-probe-roFJsg
```

### Build

```text
命令：
npm run build

结果：
exit 0
main / preload / renderer build 均通过
```

### Security Preflight

```text
命令：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1

结果：
exit 0
Security preflight passed.
IPC 白名单、密钥边界、SAP 写入扫描、原始输出扫描、案件工作流安全标记、知识边界、飞书授权痕迹、子进程边界、SQLite FTS、通用代理、模型上下文和删除操作扫描均通过。
```

### Diff Whitespace

```text
命令：
git diff --check

结果：
exit 0
```

## 9. 剩余风险

| 风险 | 处理 |
|---|---|
| 本阶段仍是确定性本地草稿，不是真实 AI 分析 | 已在 UI、输出文件和 metadata 中标明；真实模型案件编排必须单独审计上下文最小化。 |
| ADT 连接器仍有 fake 模式 | UI 已显示验证模式；真实 ADT 最小读取需要后续在真实环境再次验证。 |
| 输出内容仍偏模板化 | 比 Phase 6 更可用，但仍需要真实 SAP 证据或模型分析后才能形成最终结论。 |
| 文件打开能力仍未实现 | 本阶段只确保右侧文件面板可见、chip 可跳到文件行、搜索可找回；打开文件需要新增窄 IPC 和路径审计。 |
| 文件正文搜索仍未实现 | 当前搜索证明文件名和路径存在；正文索引需先定义安全输出摘要范围，避免把对话或敏感材料入库。 |

## 10. 结论

| 结论 | 说明 |
|---|---|
| 通过条件 | Phase 8 本地案件输出已实现，且未扩大外部系统、安全和 IPC 边界。 |
| 必须修复项 | 当前无已知 P0/P1 未修复项。 |
| 可后续优化项 | 文件打开窄 IPC、真实 SAP 证据接入、真实模型上下文最小化、飞书草稿发布前专项审计。 |
