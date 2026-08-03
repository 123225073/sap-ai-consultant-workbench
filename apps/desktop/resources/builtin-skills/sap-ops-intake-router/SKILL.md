---
name: sap-ops-intake-router
description: 对 SAP 运维工单、邮件、聊天、告警和临时请求做统一受理，区分 Service Request、Incident、Problem、Request for Change / New Requirement，评估业务影响、紧急度、信息缺口并路由到后续 Skill。用户说“帮我看看这是什么问题/需求”“先整理工单”“该走故障还是变更”“需要哪些资料”时使用；不直接跳到代码或根因结论。
metadata:
  title: "运维｜01 受理分类与路由"
  workstream: "sap-operations"
  stage: "01 受理与路由"
  methodology: "SAP Activate Run / SAP Solution Manager ITSM"
---

# SAP 运维受理、分类与路由

## 标准依据

以 SAP Activate Run 为生命周期语境，以 SAP Solution Manager ITSM 对 Service Request、Incident、Problem 和 Request for Change 的对象定义为分类基线。分类结果是工作建议，不替代客户 ITSM 的正式状态或审批。需要核对依据时读取 [official-basis.md](references/official-basis.md)。

## 工作流

1. 对输入做敏感信息检查，不回显密码、Token、无必要的个人信息或客户数据。
2. 建立最小身份：Project、Case/Ticket、SID、Client、环境、模块、时间、请求者、owner、影响和来源。
3. 只从已知事实提取“发生了什么/想改变什么”，不要在受理阶段猜根因或设计代码。
4. 选择**当前主处理对象**，并允许建立关联对象；这不是互斥三选一：
   - **Service Request**：预定义、重复性的标准服务，通常不需要软件变更。
   - **Incident**：原有服务中断或质量下降，先恢复与诊断。
   - **Problem**：一个或多个 Incident 的根因调查与防复发；重复 Incident 仍保留当次恢复工单，同时关联 Problem。
   - **Change / New Requirement**：新增或修改功能、配置、接口或代码，需要需求、审批、测试和发布；它可以是 Problem 永久修复的后续对象，不能替代 Incident/Problem 记录。
5. 依据业务影响、受影响用户/流程、workaround、关键窗口和时间敏感性给优先级建议；没有影响证据时不虚报高优先级。
6. 用 [intake-template.md](references/intake-template.md) 输出受理摘要、缺失资料、分类依据、owner 和下一步。
7. 未分类、混合描述或用户只给原始材料时先使用本 Skill；已有明确 Incident/Problem 编号或用户直接要求诊断/RCA 时进入 `$sap-evidence-first-analysis`。新需求/已批准永久变更进入 `$sap-ops-demand-intake`；标准服务进入客户服务清单。

## 质量与自定义

- 事实、判断、假设、未确认和决策分别标注。
- 客户工单类型、SLA、工作日历、升级路径和字段映射从 Project/Case 正式规范覆盖默认值；标明来源和版本。
- 优先级建议必须给出业务影响依据，不能仅按“很急”等措辞判断。
- SAP 写入、生产操作、对外发送和审批动作始终需要明确确认，客户模板不能覆盖此边界。
