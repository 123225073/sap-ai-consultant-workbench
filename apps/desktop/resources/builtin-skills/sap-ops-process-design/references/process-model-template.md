# SAP 运维流程模型模板

## 模型身份

- 名称 / 版本 / 状态 / owner / reviewer。
- 目的、受众、层级：L0 端到端 / L1 业务 / L2 操作或系统。
- As-Is / To-Be / 差异视图。
- 触发、开始、结束、范围和明确不画范围。

## 元素约定

- Pool：独立参与方或组织边界。
- Lane：角色/责任。
- Task：动词 + 对象。
- Event：开始、结束、消息、时间或异常。
- Gateway：每条出口写条件，并说明合并语义。
- Message flow：跨 pool 交互；sequence flow 不跨 pool。

## 配套输出

| 节点 ID | 名称 | 类型 | 角色 | 系统 | 输入 | 输出 | 规则/异常 | Requirement |
|---|---|---|---|---|---|---|---|---|

同时提供系统/角色词典、As-Is/To-Be 差异、假设、待确认和 modeling convention 来源。

## Mermaid 边界

Mermaid 输出应保留节点 ID、角色/系统分区、分支条件和异常路径；注明“受限流程表达，不是 BPMN 2.0 可交换模型”。需要正式 BPMN 时转入 SAP Signavio 等 BPMN 工具复核。
