---
name: sap-ops-process-design
description: 为 SAP 运维新需求、问题分析、接口链路、审批和发布设计 As-Is/To-Be 业务流程图、跨系统交互图或技术调用链。用户要求“画流程图/BPMN/泳道图”“梳理角色和系统交互”“展示异常分支、审批点或 As-Is/To-Be 差异”时使用；默认采用 BPMN 语义和 SAP Signavio 建模约定，Mermaid 仅作为受限渲染格式。
metadata:
  title: "运维｜04 流程与系统链路"
  workstream: "sap-operations"
  stage: "04 流程建模"
  canonical-id: "sap-ops-process-modeling"
  methodology: "SAP Signavio BPMN / Modeling Conventions"
---

# SAP 运维流程与系统链路设计

## 标准依据

使用 SAP Signavio 支持的 BPMN 核心语义：pool、lane、task、event、gateway、sequence flow 和 message flow，并应用可配置的 modeling convention。Mermaid 可以表达受限流程，但不是可交换的完整 BPMN 2.0 模型。需要核对依据时读取 [official-basis.md](references/official-basis.md)。

## 工作流

1. 明确图的受众、目的、范围、层级、触发条件、结束条件，以及要画 As-Is、To-Be 还是差异。
2. 识别独立参与方/组织边界、角色、SAP/外围系统、人工任务、系统任务、消息和数据对象。
3. 先画主成功路径，再补充 gateway 条件、异常、重试、超时、回退、人工审批和跨系统消息。
4. 节点使用“动词 + 对象”；每个分支写条件；不要用颜色代替语义。
5. 选择表达：业务流程优先泳道/BPMN 语义；系统链路用 sequence；数据依赖多时用 data flow；简单线性过程用文字即可。
6. 按 [process-model-template.md](references/process-model-template.md) 同时输出图、节点词典、角色/系统映射、假设和未决问题。
7. 检查开始/结束、断路、死循环、未合并分支、角色责任、异常流以及与 Requirement/spec 编号的一致性。由规格流程调用时，把版本化的图、节点词典和未决问题返回 `$sap-development-spec`，不独立启动开发。

## 质量与自定义

- 复杂图按 L0/L1/L2 分层，不把业务、系统和代码调用塞进同一张图。
- 组织可配置节点命名、颜色、方向、必填属性和导出格式；必须标注是组织约定还是 SAP/BPMN 语义。
- 不确定的流程步骤使用“待确认”标识，不绘制成既成事实。
- 外部发布、覆盖原图或写入正式流程库前必须得到用户确认。
