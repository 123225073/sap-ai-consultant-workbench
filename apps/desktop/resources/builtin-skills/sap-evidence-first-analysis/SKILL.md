---
name: sap-evidence-first-analysis
description: 面向已分类的 SAP Incident、重复故障和 Problem 做影响评估、服务恢复、复现、证据采集、假设验证、根因分析与永久修复建议。用户提出“帮我查原因”“生产为什么异常”“接口/报表/作业失败”“做 RCA”或提供明确 Incident/Problem 时使用；结构化 Excel/CSV 差异应先用 sap-data-reconciliation，未分类的混合请求先用 sap-ops-intake-router。
metadata:
  title: "运维｜06 Incident 与 Problem 分析"
  workstream: "sap-operations"
  stage: "06 故障恢复与根因"
  canonical-id: "sap-ops-incident-problem"
  methodology: "SAP ITSM Problem Management / SAP Support Case"
---

# SAP Incident 与 Problem 分析

## 标准依据与边界

按 SAP Support Case 的摘要、症状、环境、组件、优先级、业务影响、附件和可复现信息组织 Incident；按 SAP Problem Management 区分恢复、根因、防复发、Knowledge 和后续 Change。SAP 默认只读，旧导出只代表生成时间。需要核对依据时读取 [official-basis.md](references/official-basis.md)。

## 工作流

1. 明确 Ticket、Project、SID、Client、环境、模块、时间、业务影响、受影响用户/流程、workaround 和最近变更。
2. 必要时先给无写入的止损/隔离建议；把“服务已恢复”和“根因已确认”分开记录。
3. 建立时间线和复现路径：业务场景、使用入口、输入与步骤、期望结果、实际结果、错误文本和正常对照。
4. 用 [evidence-matrix.md](references/evidence-matrix.md) 盘点日志、截图、SAP 对象、配置、数据样本、变更和监控；单张无上下文截图不是充分证据。
5. 若主要输入是两份或多份结构化 Excel/CSV/查询结果，先调用 `$sap-data-reconciliation` 建立对账合同和差异清单，再把仍需解释的高影响差异带回 RCA。
6. 将结论分成已确认、推断、假设、未确认；沿业务链和技术链提出可证伪的候选根因。
7. 使用最小必要的 SAP 只读证据验证；跨环境核对必须保证对象、时间和口径一致。
8. 区分直接根因、触发条件、放大因素、伴随现象和已排除原因，给出 workaround、永久修复和复发监控。
9. 判断是否升级 Problem、创建 Change/Requirement 或形成 Knowledge 候选；需要永久变更时进入 `$sap-ops-demand-intake`，处置完成后进入 `$sap-ops-release-closure`；未经验证不得标记已闭环。

## 质量与自定义

- 高优先级必须有业务影响；没有 workaround、用户数、关键窗口等证据时标记待确认。
- 每个关键结论指向证据；相关性不能直接写成因果。
- SLA、优先级、日志源、RCA 方法、升级组和 Knowledge 模板从组织/Project 规则覆盖，并保留来源。
- SAP 写入、数据修复、重处理、生产操作和对外提交 Case 都需要明确确认。
