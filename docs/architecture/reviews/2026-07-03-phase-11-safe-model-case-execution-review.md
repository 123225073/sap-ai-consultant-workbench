# Phase 11 Safe Model Case Execution Adversarial Review

日期：2026-07-03

## 1. 功能范围

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 11 安全模型案件执行 |
| 当前分支 | `codex/phase-11-safe-model-case-execution` |
| 计划文档 | `docs/superpowers/plans/2026-07-03-phase-11-safe-model-case-execution-plan.md` |
| 新增能力 | 已验证模型可基于安全上下文生成当前案件本地草稿 |
| 不做内容 | 不新增通用模型 IPC、不读取 SAP、不写 SAP、不发布飞书、不自动知识入库 |

Phase 11 只把“模型生成本地草稿”接入现有案件发送链路。模型上下文由主进程白名单组装，输出只保存为当前案件 `outputs/` 下的安全草稿文件。

## 2. 第一性原理

| 问题 | 结论 |
|---|---|
| 为什么现在接模型 | Phase 10 已建立安全输出摘要边界，下一步可以让模型只基于这些摘要生成本地草稿。 |
| 为什么不做通用聊天 | 产品是 SAP 顾问案件工作台，不是泛 AI 聊天工具。 |
| 为什么不读完整文件 | 完整案件文件、技术证据和快照最容易带出客户资料、源码和内部状态。 |
| 为什么仍保存本地文件 | 文件是产品的成果载体，方便右侧预览和历史搜索。 |

## 3. 多 Agent 审计结论

| 来源 | 级别 | 发现 | 处理 |
|---|---|---|---|
| Product/UX Agent | P1 | Phase 11 最小路径只应做“已验证模型生成本地草稿”，不做 dashboard。 | 采纳。底部模型状态小幅更新，中间仍是 Codex 风格文本流。 |
| Product/UX Agent | P1 | 未验证模型不能执行模型任务，应提示去配置中心验证。 | 采纳。只有真实 HTTP 验证通过的启用渠道才被主进程选用；否则回到本地草稿。 |
| Product/UX Agent | P2 | 成功、失败、未验证三种状态需要用户可理解文案。 | 采纳。助手回复、notice、配置中心和输出文件均区分状态。 |
| Security/Architecture Agent | P0 | 不能把搜索结果、案件对象或 `WorkbenchState` 整包传给模型。 | 采纳。新增 `buildSafeModelDraftContext()`，只输出白名单字段。 |
| Security/Architecture Agent | P0 | 禁止通用模型 IPC、文件读取 IPC、SQL/命令/网络代理。 | 采纳。复用 `workbench:append-message`，IPC 白名单未新增。 |
| Security/Architecture Agent | P1 | 模型连接器不应读取案件、文件或搜索服务。 | 采纳。连接器只接收已构造的安全上下文；预检继续扫描该边界。 |
| Security/Architecture Agent | P1 | 模型请求不能启用 tools、function calling、web search。 | 采纳。请求体只包含 `model`、`messages`、`max_tokens`、`temperature`、`stream: false`。 |
| Security/Architecture Agent | P1 | 原始 prompt 和原始响应不能写入文件、SQLite 或 UI。 | 采纳。文件和 metadata 只保存草稿文本、模型名、上下文字数和安全摘要数量。 |

### Second review pass after implementation

| Source | Level | Finding | Handling |
|---|---|---|---|
| Independent Code Review Agent | P1 | Some verified model IDs with `:` such as `google/gemini-2.0-flash:free` were allowed by the connector but lost during message/metadata persistence. | Fixed. Safe model hint and persisted message model ID now share the connector-safe character set, and the Phase 11 probe covers colon model IDs for metadata and reload. |
| Independent Code Review Agent | P3 | Fake/demo host checks used `host` in one validation path and `hostname` elsewhere, making fake hosts with ports inconsistent. | Fixed. Validation now uses `hostname` consistently for demo/fake host checks. |

## 4. 安全上下文合同

允许进入模型的字段：

| 字段 | 说明 |
|---|---|
| `taskMode` / `taskLabel` | 固定枚举和中文标签。 |
| `userInputSummary` | 经过案件敏感内容检查和模型上下文二次检查后的输入摘要。 |
| `caseTitle` / `caseSummary` | 当前案件短标题和短摘要。 |
| `sapVersion` | 仅 S4/ECC/UNKNOWN。 |
| `standardsSummary` | 项目规范短摘要，不含规范正文。 |
| `safeOutputSummaries` | 当前案件 `outputs/` 的 Phase 10 安全摘要，最多 5 条。 |
| `boundary` | 固定本地草稿边界。 |

明确禁止：

- `ProjectConfig`、`WorkbenchState`、验证报告原始对象。
- 完整搜索结果、完整知识内容、完整文件正文、完整对话历史。
- `technical/`、`evidence/`、`snapshots/`。
- `metadata.json`、`messages.json`、`project.json`、`app-state.json`。
- SAP 源码、SQL、表格行数据、URL、密钥、Token、Cookie、Bearer、secure-store 引用。

## 5. 实现审计

| 风险 | 处理 |
|---|---|
| Renderer 伪造模型请求 | Renderer 只能走 `appendMessage`；主进程重新选择合格模型。 |
| 模拟验证误当真实模型 | `ApiProviderConfig.lastVerificationMode` 区分 `fake` 与 `http`；默认只允许 `http`。 |
| 本地探针需要假模型 | 只有 `WORKBENCH_ALLOW_FAKE_MODEL_EXECUTION=1` 时允许假模型执行路径。 |
| 模型输出带敏感内容 | `assertSafeModelDraftResponseText()` 在落盘前再次检查。 |
| 渠道名或模型名被误填敏感内容 | 写入文件和 metadata 前通过 `safeModelDraftDisplayValue()` 安全化。 |
| 失败时泄露原始错误 | 错误先经过主进程脱敏，再由草稿服务二次安全化。 |
| 模型草稿污染知识库 | 仍只生成候选知识，知识发布必须人工确认。 |

## 6. 运行探针

红灯验证：

```text
命令：node scripts\phase11-safe-model-case-execution-probe.mjs
结果：exit 1
原因：safeModelCaseDraftService.ts 尚不存在，探针按预期失败。
```

绿灯验证：

```text
contextAllowlist=ok
safeSummaryOnly=ok
safeModelHint=ok
unsafeSecretBlocked=ok
unsafeAbapBlocked=ok
unsafeSqlBlocked=ok
unsafeUrlBlocked=ok
unsafeDirectTextGuard=ok
fakeSafeDraft=ok
unsafeModelOutputBlocked=ok
draftArtifactNoRawPrompt=ok
metadataLastModelId=ok
reloadPreservesModelId=ok
noGenericIpc=ok
```

## 7. 验证命令

```text
命令：npm run check
结果：exit 0

命令：node scripts\phase11-safe-model-case-execution-probe.mjs
结果：exit 0

命令：npm run build
结果：exit 0

命令：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
结果：exit 0
Security preflight passed.
```

## 8. 剩余风险

| 风险 | 后续处理 |
|---|---|
| 真实模型质量不可控 | Phase 11 只保存草稿，用户必须确认。 |
| 真实模型服务错误格式多样 | 当前只保存脱敏失败说明；后续可补更细错误映射。 |
| 模型草稿可能不够懂 SAP | 后续阶段应接 ADT 只读证据，但仍需先通过安全上下文边界。 |
| 只选第一个合格模型 | MVP 先使用最小模型选择；后续可做模型下拉，但仍由主进程校验。 |

## 9. 结论

| 结论 | 说明 |
|---|---|
| 条件通过 | Phase 11 在不新增 IPC、不读取 SAP、不发布飞书、不传完整案件资料的前提下，让已验证模型生成当前案件本地草稿。 |
| 下一步建议 | 继续推进真实任务模式的只读 SAP 证据接入，但必须先做同级别安全上下文和对抗式审计。 |
