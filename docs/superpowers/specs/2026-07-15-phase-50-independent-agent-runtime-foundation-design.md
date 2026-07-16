# Phase 50 独立 Agent Runtime 基础设计

日期：2026-07-15
状态：Design frozen；Phase 50 基线已实施

> 2026-07-16 更新：第 2 节保留的是设计冻结时的历史事实。当前代码已继续完成到 Phase 56，真实状态请以 [独立 Agent Runtime 总体架构](../../architecture/INDEPENDENT_AGENT_RUNTIME.md)、源码和 `phase50`-`phase56` probes 为准。

## 1. 目标

在不破坏现有 Work/Chat、模型流式回复、Case files 和 SAP 只读能力的前提下，建立产品自己的 Agent Runtime 基础，使后续工具调用、上下文压缩、记忆、Skill、MCP 和子 Agent 不再依赖 Codex CLI。

长期架构以 [独立 Agent Runtime 总体架构](../../architecture/INDEPENDENT_AGENT_RUNTIME.md) 和 [ADR-0002](../../adr/0002-independent-agent-runtime.md) 为准。本设计只冻结第一批可实现契约。

## 2. 当前事实

- Chat 和 Work 已经能直接调用 OpenAI/Anthropic Compatible 渠道并流式输出。
- `main.ts` 直接编排模型调用，`modelProviderConnector.ts` 直接解析 provider SSE。
- Work/Chat 已有稳定线程 ID，但消息仍以最终 `CaseMessage` / `DailyChatMessage` 为主，没有 Turn/Item 事件账本。
- 现有 `safeModelCaseDraftService.ts` 有安全白名单和字符上限，但没有通用 token 预算与压缩。
- Codex CLI 路径仍存在于配置和案件辅助中，只是可选能力。
- Skill、MCP、长期记忆和子 Agent 目前没有真实产品运行时。

## 3. 本阶段范围

### 3.1 必须实现

1. 新增 provider-neutral（与模型供应商无关）的 `AgentThread`、`AgentTurn`、`AgentItem`、`RuntimeEvent` 类型。
2. 新增本地 `AgentEventStore`，支持 append、按 Thread/Turn 读取、按 sequence 增量补播和幂等写入。
3. 新增 `TurnCoordinator`，统一启动、取消、结束和失败恢复。
4. 把现有 OpenAI/Anthropic 流式结果适配成统一事件，不要求 renderer 理解 provider 私有 SSE。
5. Chat 和 Work 先双写：保留现有 state/文件投影，同时写入事件账本。
6. 新增只读工具循环的最小闭环；第一批只允许读取当前 Case 安全摘要和已发布知识摘要。
7. 新增 `PolicyEngine` 的最小契约，明确 allow、deny、needs-approval，并持久化判定。
8. 新增 `ContextBudget` 和安全上下文审计；本阶段先支持 recent history + Case 安全摘要，不做自动长期记忆。
9. 支持应用重启后识别未完成 Turn，并将其标记为 interrupted/recoverable。
10. 为后续 Skill/MCP/子 Agent 预留接口，但不在第一批 UI 中展示空入口。

### 3.2 明确不做

- 不删除现有 `WorkThread`、`DailyChatThread`、`CaseMessage`。
- 不开放任意 shell、任意文件读取或导入 Skill 脚本执行。
- 不做 SAP 写入工具。
- 不做远程 MCP、OAuth、插件市场。
- 不做递归自主子 Agent。
- 不做自动扫描全部历史并生成全局记忆。
- 不把 Codex app-server 嵌入安装包。

## 4. 数据合同

```text
AgentThread
  id
  scope: work | chat
  project_id?
  case_id?
  status
  created_at
  updated_at

AgentTurn
  id
  thread_id
  status: queued | running | waiting_approval | completed | failed | interrupted
  provider_id?
  model_id?
  started_at
  completed_at?
  last_sequence

AgentItem
  id
  thread_id
  turn_id
  sequence
  type
  payload_json
  created_at
```

允许的第一批 Item：

- `user_message`
- `assistant_delta`
- `assistant_message`
- `tool_call`
- `tool_decision`
- `tool_result`
- `artifact_reference`
- `usage`
- `error`
- `turn_status`

`payload_json` 进入数据库前必须通过类型 schema、长度限制和敏感信息净化。大文本、文件正文和工具原始输出只保存安全摘要或文件引用。

## 5. IPC 合同

Renderer 只需要：

- `startAgentTurn(input)`
- `cancelAgentTurn({ threadId, turnId })`
- `respondAgentApproval(input)`
- `readAgentThread({ threadId, afterSequence? })`
- `onAgentRuntimeEvent(handler)`

流式事件统一使用 `requestId + threadId + turnId + sequence`。旧 `appendMessageStreaming` 和 `appendDailyChatMessageStreaming` 保持兼容，内部转到 `TurnCoordinator`；UI 稳定后再删除兼容桥。

## 6. 最小工具闭环

第一批工具：

| 工具 | 输入 | 输出 | 权限 |
|---|---|---|---|
| `case.read_safe_context` | 当前 `threadId` | 安全摘要、来源引用、审计 | Work only，自动允许 |
| `knowledge.search_published` | Project、查询、Top-K | 已发布知识摘要和来源 | Project 范围，只读 |

模型提出 tool call 后：schema 校验 -> PolicyEngine -> 调用 -> 结果净化 -> 持久化 -> 反馈模型 -> 继续生成。默认最多 8 轮；同一 callId 只能成功一次。

## 7. 失败与恢复

- 应用关闭或崩溃时，未完成 Turn 下次启动标记为 `interrupted`，保留用户消息、已完成工具结果和已显示文本。
- Provider 错误、工具错误和审批拒绝分别记录，不合并成一条模糊“模型失败”。
- 用户取消后立即停止后续工具和 provider 流；已经完成的只读工具结果保留。
- renderer 断开后 main process 继续按策略完成或取消；重连通过 sequence 补播。
- 兼容 state 写入失败时不能把事件账本标记为 completed。

## 8. 安全门禁

- Renderer 不提供任意 tool name、可执行命令或绝对路径。
- Tool Registry 是编译时/受控注册，不接受模型临时定义执行器。
- API Key、SAP 密码和 token 不进入 Item、Event、日志或错误信息。
- 所有工具默认 deny；只有明确注册并通过 Project/Case 边界的工具可调用。
- Prompt injection 测试必须覆盖：模型要求读取密钥、跨 Project 读取、调用未注册工具、把工具输出当系统规则。
- SAP 只读安全预检必须保持通过。

## 9. 验收

1. 同一条 Chat 和 Work 消息在旧视图与事件账本中一致。
2. 流式 delta 顺序稳定，重连补播不重复、不丢失。
3. 两个只读工具可通过真实模型 tool call 循环完成一次任务。
4. 重复 callId 不会重复执行。
5. 取消、provider 断流、工具超时、renderer 刷新和应用重启均有可恢复状态。
6. 现有 Phase 44-49 回归、`npm run check`、`npm run build`、安全预检继续通过。
