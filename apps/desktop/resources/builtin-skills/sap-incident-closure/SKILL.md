---
name: sap-incident-closure
description: 旧版 SAP 事故闭环 Skill ID 的兼容入口。只有用户、Project 或历史 Case 明确引用 sap-incident-closure 时使用；新任务的测试、发布、生产验证、回退和关闭应使用 sap-ops-release-closure。此 Skill 不维护第二套流程，立即转交正式 Skill，避免已有引用在升级后失效。
metadata:
  title: "兼容入口｜旧事故闭环"
  workstream: "sap-operations-compat"
  stage: "旧 ID 兼容"
  canonical-id: "sap-ops-release-closure"
---

# 旧事故闭环兼容入口

1. 告知用户当前引用的是旧 ID `sap-incident-closure`，正式工作流为 `$sap-ops-release-closure`。
2. 保留原 Ticket/Case、上下文和用户要求，立即按 `$sap-ops-release-closure` 执行，不复制或分叉发布/关闭流程。
3. 如果运行环境尚未安装正式 Skill，才使用 [closure-template.md](references/closure-template.md) 作为降级模板，并明确兼容限制。
4. 此兼容入口不能授予 SAP 写入、激活、传输、生产操作或知识发布权限。
