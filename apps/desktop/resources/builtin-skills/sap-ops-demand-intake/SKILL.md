---
name: sap-ops-demand-intake
description: 将 SAP 运维中的新需求、功能增强、报表/接口/权限/配置变更和业务改进建议整理为可评估、可审批、可追溯、可验收的需求基线。用户要求“对接新需求”“梳理需求”“准备评估/排期”“整理范围和验收标准”“把会议结论转成需求单”时使用；先做业务澄清和 Fit-to-Standard 检查，不直接跳到技术实现。
metadata:
  title: "运维｜02 新需求澄清"
  workstream: "sap-operations"
  stage: "02 需求澄清"
  methodology: "SAP Activate Fit-to-Standard / SAP Cloud ALM Requirements"
---

# SAP 运维新需求澄清

## 标准依据

按 SAP Cloud ALM 的 Requirement 思路建立业务需要、process context、owner、priority、due date、approval 和后续 user story/test/feature/release 追溯；按 SAP Activate 的 Fit-to-Standard 原则先核对标准能力和既有方案，再提出扩展。需要核对依据时读取 [official-basis.md](references/official-basis.md)。

## 工作流

1. 确认需求身份、业务背景、当前痛点、As-Is、目标结果、受影响角色/组织/系统和期望日期。
2. 区分原始诉求、可验证的业务目标、已确认事实、解决方案偏好和待确认项。
3. 核对标准功能、已启用配置、既有报表/接口/增强和已发布知识；没有真实系统证据时标注为待核对。
4. 组织 Fit-to-Standard 讨论：标准采用、流程调整、配置、扩展、集成、数据或权限，记录选择理由而非只记录结论。
5. 明确范围、明确不做范围、依赖、假设、限制、风险、受影响对象和初步工作量条件。
6. 把目标写成可测试的验收标准，覆盖正常、边界、异常、权限、数据、性能和回归。
7. 用 [requirement-baseline-template.md](references/requirement-baseline-template.md) 形成需求基线、决策日志和待确认问题；未批准时状态只能是草稿/待确认。
8. 批准后先交给 `$sap-development-spec`。由规格 Skill 判断是否需要调用 `$sap-ops-process-design`，避免流程图和规格各自演进；全链路保留 Requirement ID。

## 质量与自定义

- 不把用户提出的实现方式直接当成业务需求；先问“为什么”和“如何验收”。
- 范围、不做范围、owner、approver、验收标准和未决问题必须可见。
- 公司编号、审批角色、估算方法、模板和术语可由组织/Project/Case 规范覆盖；输出注明规则来源。
- 需求澄清不授权 SAP 修改、创建传输、激活或生产操作。
