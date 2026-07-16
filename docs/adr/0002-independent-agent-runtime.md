# ADR-0002：核心 AI 运行时独立于 Codex

## 状态

Accepted

## 背景

决策提出时，Work 和 Chat 已经直接调用用户配置的模型渠道并流式显示回复，Codex CLI 只是可选的本机工程辅助；工具调用、上下文预算、自动压缩、记忆、Skill、MCP 和子 Agent 尚缺少统一契约。截至 2026-07-16，Phase 50-56 已完成除子 Agent 外的首个运行基线。

`openai/codex` 公开了 Codex CLI、Rust 核心、app-server、工具路由、压缩、MCP、Skills 和多 Agent 等高价值参考实现，但并不等于完整 Codex App 的全部桌面 UI 和托管后台源码。若把 Codex CLI、Codex SDK 或 app-server 作为产品核心中转，仍会把本产品的会话、能力、版本和发布节奏绑定到外部运行时。

## 决策

1. 产品核心 AI 能力由本项目自己的 `AgentRuntime` 提供，运行在 Electron main process，不经过 Codex CLI、Codex SDK 或 Codex app-server 中转。
2. `AgentRuntime` 以本地 `Thread -> Turn -> Item/Event` 事件账本为事实源，并通过窄 IPC 向 renderer 输出流式事件。
3. 模型通过 provider adapter 接入；OpenAI Responses、OpenAI Compatible、Anthropic Compatible 等协议只影响适配层，不改变产品内部会话和工具契约。
4. 工具调用统一经过 `ToolRegistry -> PolicyEngine -> ToolExecutor`。模型只能提出调用请求，不能直接获得文件、命令、SAP、网络或密钥权限。
5. 上下文管理、可移植压缩摘要和长期记忆由本项目维护。Provider 原生会话 ID 或压缩能力只能作为优化，不能成为唯一事实源。
6. Skill 采用兼容 Agent Skills 的目录和 `SKILL.md` 形式，使用渐进式加载；Skill 是工作说明，不是权限授权。
7. 第一阶段只实现 MCP Client；稳定版先开放 HTTPS Streamable HTTP 的连接、测试和能力发现，STDIO 与外部工具执行后置。任何未来 MCP 执行仍必须受本产品权限、目录、只读、结果净化和审批边界控制。
8. 子 Agent 使用显式、受限的任务图，默认最大深度 1、有限并发、只读优先，并只把结构化摘要和产物引用返回父任务。
9. Codex CLI 保留为迁移期可选兼容适配器和开发诊断工具，默认停用；后续可删除，但不得成为核心功能前置条件。
10. 迁移采用渐进替换：现有 Work/Chat 直接模型流继续工作，先在旁路建立事件账本和 provider adapter，再逐步接入工具、上下文、Skill、MCP 和子 Agent。

## 影响

- 用户不安装 Codex 也能获得完整核心能力，安装包可以独立分发。
- 项目需要自行承担工具循环、恢复、取消、幂等、审批、上下文和记忆的工程责任。
- 现有对话数据需要迁移到统一事件账本，但不能破坏已有 `WorkThread`、`DailyChatThread` 和 Case files。
- 产品可以借鉴 `openai/codex` 的公开设计和协议思想，但不复制其品牌、私有服务或完整产品假设。
- Phase 50-56 已形成事件账本、受控工具循环、上下文/记忆、Skill/Plugin 和 MCP 基线；受限子 Agent、任意脚本和 Codex App 级完整自治仍不在当前声明范围内。

## 依据

- [OpenAI Codex 开源仓库](https://github.com/openai/codex)
- [Codex app-server 官方说明](https://learn.chatgpt.com/docs/app-server)
- [Codex Skills 官方说明](https://developers.openai.com/codex/skills)
- [Codex MCP 官方说明](https://developers.openai.com/codex/mcp)
- [Codex Subagents 官方说明](https://developers.openai.com/codex/subagents)
- [OpenAI Function calling 官方说明](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI Compaction 官方说明](https://developers.openai.com/api/docs/guides/compaction)
