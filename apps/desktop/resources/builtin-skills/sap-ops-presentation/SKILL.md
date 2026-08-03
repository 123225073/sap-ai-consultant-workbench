---
name: sap-ops-presentation
description: 将 SAP 运维工单、需求、问题、测试、发布、监控和风险证据组织成面向管理层、业务用户、技术团队或复盘会议的 PPT 结构、逐页内容、讲稿和图表来源台账。用户要求“生成PPT/汇报材料/周月报/方案汇报/事故复盘”时使用；SAP 没有统一强制的日常运维 PPT 目录，默认结构属于产品通用实践。
metadata:
  title: "运维｜09 汇报与 PPT"
  workstream: "sap-operations"
  stage: "09 状态与决策沟通"
  canonical-id: "sap-ops-status-presentation"
  methodology: "SAP Cloud ALM traceable reporting + audience-first communication"
---

# SAP 运维汇报与 PPT 策划

## 方法边界

SAP Cloud ALM 提供进度、测试、缺陷和 traceability 数据，但 SAP 官方没有统一强制的日常运维 PPT 目录或视觉模板；依据与边界见 [official-basis.md](references/official-basis.md)。

## 工作流

1. 明确受众、会议目的、要做的决策、时间范围、页数、语言、母版、保密标识和交付格式。
2. 冻结一个核心结论，并区分已确认事实、推断、风险、决策请求和待补数据。
3. 从 Ticket/Requirement、测试、Defect、Transport/Release、监控和 Case 文件建立来源台账；不编造 KPI、节省金额、完成率或根因。
4. 按受众选择模式：管理层看业务影响/风险/决策；业务看流程/验收/变化；技术看证据/方案/测试/发布；复盘看时间线/根因/改进。
5. 用 [presentation-outline.md](references/presentation-outline.md) 组织“结论—影响—进展—风险—决策—下一步”，技术明细放附录。
6. 图表只表达一个问题，标注口径、期间、系统和来源；流程复杂时调用 `$sap-ops-process-design`。
7. 检查数字、状态、术语、颜色语义、owner/日期、敏感信息和跨页一致性；生成文件后复核版式。

## 质量与自定义

- SAP Cloud ALM 的进度与 traceability 可作为数据来源，但目录和视觉不是 SAP 强制标准。
- 客户母版、品牌色、字体、指标口径、术语、页数和中英双语规则从组织/Project 配置覆盖；注明版本。
- 首屏必须能回答“发生了什么、影响什么、当前如何、需要谁决定什么”。
- 对外发送、发布或覆盖正式汇报文件前必须得到用户确认。
