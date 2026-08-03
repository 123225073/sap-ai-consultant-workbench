# SAP 运维受理模板

## 受理身份

| 字段 | 内容 |
|---|---|
| Project / Case / Ticket |  |
| SID / Client / 环境 / SAP 版本 |  |
| 模块 / 流程 / 组织范围 |  |
| 请求者 / owner / 支持组 |  |
| 首次发生或提出时间 |  |
| 业务影响 / 用户数 / workaround |  |
| 数据敏感等级 |  |

## 分类与优先级

- 主处理对象：Service Request / Incident / Problem / Change-New Requirement / 待确认。
- 关联对象：相关 Incident、Problem 候选、后续 Change/Requirement 及其关系；不存在则写“无”。
- 分类依据：描述是预定义服务、服务退化、根因调查还是新增修改；说明为何以当前对象作为主处理对象。
- 优先级建议：影响、紧急度、关键窗口和 workaround。
- 已确认 / 推断 / 未确认：

## 路由

| 下一步 | owner | 所需输入 | 完成条件 |
|---|---|---|---|

## 规则来源

记录使用的 SAP 官方定义、组织工单/SLA 规范、Project 规则、Case 例外及其版本；冲突时平台安全边界最高。
