---
name: sap-ops-release-closure
description: 面向 SAP 运维 Requirement/Change 或 Incident/Problem 的测试就绪、发布准备、Go/No-Go、Transport 清单、生产验证、回退、hypercare、用户确认和知识候选闭环。用户要求“上线检查/发布评审/测试与回退”“事故闭环/问题关闭”“整理交接和知识”时使用；未授权生产动作、未完成验证或未审核知识不得被包装成已完成。
metadata:
  title: "运维｜08 测试、发布与关闭"
  workstream: "sap-operations"
  stage: "08 发布与闭环"
  methodology: "SAP Cloud ALM Traceability / SAP ChaRM / CTS"
---

# SAP 运维测试、发布与关闭

## 标准依据与关闭定义

按 SAP Cloud ALM/Focused Build 的 Requirement—spec—test—defect—feature/release 追溯，以及 ChaRM/CTS 的审批、对象、人员、顺序和日志准备发布。只有结果、验证、回退、责任和知识候选均有记录时才可关闭。需要核对依据时读取 [official-basis.md](references/official-basis.md)。

## 工作流

1. 读取 Requirement/Change/Incident/Problem、spec、流程、对象/Transport、测试、Defect、依赖、窗口、审批和回退条件。
2. 执行 traceability 检查：每个范围项对应设计、对象、测试和结果；未覆盖项明确列出。
3. 按 [closure-template.md](references/closure-template.md) 做 readiness gate：代码/配置状态、ATC/Unit、功能/集成/验收、缺陷、授权、依赖、顺序、备份/基线、通讯和监控。
4. 输出 GO、条件 GO、NO-GO 或证据不足，并给出阻断项、owner 和完成条件。
5. 发布/Transport/激活/导入由授权人员明确确认并执行；记录实际对象、时间、执行人和结果，不预写成功。
6. 做生产验证：业务结果、技术信号、重复副作用、关键回归和监控；满足触发条件时执行已批准回退。
7. 进入约定 hypercare，取得业务 owner 的接受/关闭确认，记录遗留风险与后续动作。
8. 把可复用经验写成 Knowledge 候选；只有用户审核后才能进入正式知识库。

## 质量与自定义

- “已部署”不等于“已验证”，“没有反馈”不等于“成功”。
- 系统路线、ChaRM/Cloud ALM/第三方 ITSM、发布窗口、审批人、测试类型和 hypercare 时长由组织规则覆盖并保留来源。
- 生产写入、传输释放/导入、激活、批量更新和知识发布始终需要明确确认。
