# Phase 50 独立 Agent Runtime 基础实施计划

> 本计划只覆盖基础层。详细规则见 [Phase 50 设计](../specs/2026-07-15-phase-50-independent-agent-runtime-foundation-design.md)。

> 实施状态（2026-07-16）：本文件保留为最初拆解记录，不再用未勾选项判断当前代码。Phase 50-56 已完成事件账本、Turn 编排、Work 工具循环、ContextEngine、checkpoint、分层记忆、Skills、声明式 Plugin、HTTPS MCP Client 和能力中心基线；OpenAI Responses 专用适配器、STDIO MCP、任意脚本和受限子 Agent 仍未开放。当前事实以源码、`phase50`-`phase56` probes、独立 Runtime 架构和最新 review 为准。

## 0. 开始条件

- [ ] 先保留并单独处理当前未提交的 Phase 49 修复，避免与 Runtime 改动混在一个提交。
- [ ] 记录当前 `npm run verify` 基线结果。
- [ ] 冻结 `AgentThread/Turn/Item/Event` 和迁移版本。
- [ ] 明确现有 state 是兼容投影，事件账本是新运行时事实源。

## 1. 事件模型与存储

- [ ] 在 shared 层新增运行时类型和严格输入解析。
- [ ] 在 main process 新增 `agentEventStore.ts`，使用 SQLite append-only 表。
- [ ] 实现 sequence、幂等键、分页读取和按 Turn 查询。
- [ ] 实现敏感内容净化、payload 大小上限和数据库迁移。
- [ ] 增加损坏数据库、重复事件、乱序事件和迁移回滚测试。

验收：可独立创建 Thread/Turn，追加 Item，并从任意 sequence 增量重放。

## 2. TurnCoordinator 与兼容桥

- [ ] 新增 `turnCoordinator.ts`，管理同 Thread 单 active Turn、取消和超时。
- [ ] 将 `appendCaseMessage` 和 `appendDailyChatMessage` 的运行编排移入 Coordinator。
- [ ] 保持现有 `WorkspaceStore` 消息和 Case files 投影。
- [ ] 启动时恢复未完成 Turn 为 `interrupted`。
- [ ] 增加快速重复 Enter、取消后再发送、应用重启测试。

验收：现有 UI 无需改版即可使用新 Coordinator，旧数据仍可打开。

## 3. Provider 事件规范化

- [ ] 定义 `ModelProviderAdapter` 和 `NormalizedModelEvent`。
- [ ] 将 OpenAI Compatible SSE 解析迁入适配器。
- [ ] 将 Anthropic Compatible SSE 解析迁入适配器。
- [ ] 增加 OpenAI Responses adapter；不支持时自动使用原有兼容协议。
- [ ] 保存 provider/model/usage/finish reason，不保存密钥或原始响应头。
- [ ] 增加断流、空响应、格式错误、取消和首包超时测试。

验收：Renderer 只处理统一 RuntimeEvent，切换 provider 不改 UI 事件代码。

## 4. 最小 Tool Runtime

- [ ] 新增 `toolRegistry.ts`、`toolRouter.ts`、`policyEngine.ts`、`toolExecutor.ts`。
- [ ] 注册 `case.read_safe_context` 和 `knowledge.search_published`。
- [ ] 实现 JSON schema 校验、callId 幂等、超时、取消和结果限长。
- [ ] 将 tool result 返回 provider 并继续同一 Turn。
- [ ] 增加最多 8 轮和循环调用熔断。
- [ ] 增加 prompt injection、未知工具、跨 Project、重复调用测试。

验收：真实模型可通过至少一次只读工具调用完成回复，事件和来源可追溯。

## 5. ContextEngine 基础

- [ ] 新增模型能力与上下文窗口配置。
- [ ] 基于 token 估算建立输入、输出、工具和安全余量预算。
- [ ] 按优先级选择 recent messages、Case 安全摘要、已发布知识和工具 schema。
- [ ] 输出 `ContextAudit`，记录使用量、被裁剪项和来源，不记录敏感正文。
- [ ] 保留现有 `safeModelCaseDraftService` 作为安全过滤器，逐步抽取公共规则。

验收：长对话不会无限拼接，ContextAudit 能解释为什么选中或裁剪某段材料。

## 6. UI 与 IPC 收口

- [ ] 新增窄 IPC：start、cancel、approval、read-after-sequence、runtime event。
- [ ] Composer 在 running 时显示停止按钮；发送后立即清空并滚动到最新 Item。
- [ ] 工具过程默认折叠，只显示清楚中文状态和最终结果。
- [ ] 重连/刷新时从最后 sequence 补播。
- [ ] 不新增常驻 Agent、MCP、记忆 Dashboard。

验收：用户体感仍是简洁对话，但可取消、可恢复、不会重复显示消息。

## 7. 回归和对抗式审查

- [ ] `npm run check`
- [ ] `npm run build`
- [ ] 新增 `scripts/phase50-agent-runtime-foundation-probe.mjs`
- [ ] `npm run probe:phase44` 到 `npm run probe:phase49`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1`
- [ ] `git diff --check`
- [ ] 对抗：重复副作用、越权工具、密钥回显、跨 Project、SAP 写入、断流重试、并发 Turn、恢复乱序。

## 8. 后续 Phase（不在本计划实现）

完整范围、页面和门禁见 [能力中心、Skills、MCP、提示词与分层记忆设计](../specs/2026-07-15-capability-center-skills-mcp-prompt-memory-design.md)。

- Phase 51：PromptCompiler、可移植压缩、Thread checkpoint 和分层 Memory 基础。
- Phase 52：能力中心外壳、Agent Skills 兼容发现、导入和声明式内置 Skill。
- Phase 53：MCP Client（HTTPS Streamable HTTP、受控认证与能力发现）；STDIO 和外部工具执行后置。
- Phase 54：声明式 Plugin 包、版本回滚、完整 Memory 管理和能力中心体验收敛。
- 后续阶段：受限子 Agent；只有运行时、权限和恢复边界长期稳定后才评估启用。
