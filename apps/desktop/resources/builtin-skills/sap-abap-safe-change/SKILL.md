---
name: sap-abap-safe-change
description: 面向已批准 SAP 运维变更的 ABAP 程序、Include、类、函数、CDS/DDIC、增强和接口对象，执行影响分析、最小安全实现、代码审查、ATC/ABAP Unit、测试交接、Transport manifest 和回退准备。用户要求修改/优化 ABAP、审查代码、生成候选补丁或上线前复核时使用；任何 SAP 写入、激活、传输或生产操作仍须明确确认。
metadata:
  title: "运维｜05 ABAP 变更交付"
  workstream: "sap-operations"
  stage: "05 开发与自测"
  canonical-id: "sap-ops-abap-change"
  methodology: "SAP ATC / ABAP Unit / CTS / SAP styleguides"
---

# SAP 运维 ABAP 安全变更交付

## 标准依据与边界

ATC 是主要质量检查，ABAP Unit 用于尽早、反复验证；SAP/styleguides 的 Clean ABAP 和 code review 是可选建议，不冒充客户强制标准；CTS/Transport 必须关联需求、对象、人员、原因和发布链。未经明确确认，不写 SAP 源码、不激活、不创建或释放传输、不导入生产。需要核对依据时读取 [official-basis.md](references/official-basis.md)。

## 工作流

1. 确认已批准 Requirement/Technical Design、目标 SID/Client/ABAP 版本、对象范围、验收标准和不做范围。
2. 读取最新基线，记录来源、时间、版本/checksum 和可回退点；历史快照不能冒充当前系统事实。
3. 扩展影响范围：调用者、Include、增强、DDIC/CDS、授权、锁/LUW、更新任务、作业、接口、单位/币种和外部消费者。
4. 设计最小自洽变更，说明修改点、保持行为、兼容性和明确不改范围。
5. 生成候选代码/补丁或人工修改步骤；产品无写入能力时明确标记“未实施”。
6. 按 [change-review-checklist.md](references/change-review-checklist.md) 做自审和 peer review 建议。
7. 记录语法、ATC variant/豁免、ABAP Unit、功能、集成和回归结果；每项只能写通过/失败/未执行。
8. 生成对象与 Transport manifest、依赖顺序、上线前检查、生产验证和回退触发条件，明确交给 `$sap-ops-release-closure`。

## 质量与自定义

- 检查 SQL、性能、授权、消息、锁、COMMIT/ROLLBACK、幂等、接口副作用和敏感日志。
- 客户编码规范、ATC variant、豁免、reviewer、测试覆盖和 Transport 策略优先于产品默认，但需有来源和批准状态。
- 证据不足时输出条件性结论或 NO-GO，不因代码“看起来正确”宣称可上线。
