---
name: sap-development-spec
description: 将已澄清的 SAP 运维 Requirement、流程、现状证据、字段、接口和非功能要求整理为可评审、可开发、可测试、可发布的 Functional Specification 与 Technical Design。用户要求“写开发说明书/功能规格/技术方案”“整理字段映射、取数逻辑、接口契约、测试矩阵或上线回退”时使用；信息不足时输出有状态的草稿和确认清单，不编造系统事实。
metadata:
  title: "运维｜03 解决方案与开发说明书"
  workstream: "sap-operations"
  stage: "03 方案与规格"
  canonical-id: "sap-ops-solution-spec"
  methodology: "SAP Cloud ALM Documents / SAP Focused Build"
---

# SAP 运维解决方案与开发说明书

## 标准依据

遵循 SAP Cloud ALM 的文档状态、owner、版本和审批思路，以及 SAP Focused Build 中 Functional Specification、Technical Design、业务流程步骤、executable、test 和 release 的分层追溯。章节可替换，语义边界不能丢失。需要核对依据时读取 [official-basis.md](references/official-basis.md)。

## 工作流

1. 确认 Requirement ID、文档读者、状态、owner/reviewer/approver、目标系统、范围和验收标准。
2. 建立证据索引，区分当前系统事实、业务决定、设计建议、假设和未确认项。
3. 先写 Functional Specification：As-Is/To-Be、业务规则、角色/授权、输入输出、数据、异常、验收。
4. 再写 Technical Design：对象清单、配置/增强点、数据来源与关联、字段映射、接口契约、日志、授权、性能、批处理、幂等和错误处理。
5. 关联流程节点、开发任务、ABAP/配置对象、测试用例、Defect、Transport/Release 和回退条件。
6. 对数量/单位、金额/币种、状态、时区、冲销/退货、主键和聚合粒度做专项口径检查。
7. 按 [spec-template.md](references/spec-template.md) 输出，只保留适用章节；流程复杂时调用 `$sap-ops-process-design`，将同一版本的图和节点词典回填规格。
8. 完成一致性复核：需求、流程、字段、技术设计、测试、发布和回退不得互相矛盾。方案包含 ABAP 对象时交给 `$sap-abap-safe-change`；不含 ABAP 的实现完成后也必须交给 `$sap-ops-release-closure` 做测试、发布与关闭门禁。

## 质量与自定义

- “Released/已确认”必须有真实审批证据；否则标记草稿或待评审。
- 每个关键设计能追溯到 Requirement 或明确的非功能要求。
- 公司 Word 模板、章节编号、RICEFW 分类、命名规范和签字页可覆盖表现形式；不可覆盖事实真实性与安全边界。
- 默认落到当前 Case `outputs/`；不得写入密钥、真实凭据或无必要的大段客户源码。
