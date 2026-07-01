# SAP AI 顾问工作台

SAP AI 顾问工作台是一个面向 SAP 顾问的个人本地桌面工作台。

它的目标不是做一个普通聊天工具，也不是做一个通用知识库，而是围绕 SAP 顾问的真实工作方式，把项目、案件、对话、文件、规范、知识沉淀和只读 SAP 连接放到同一个本地工作台里。

## 当前状态

当前仓库处于产品开发早期阶段，已经包含：

- 产品原型图
- 产品开发说明书
- 技术实现文档
- 新项目交接说明
- 多 Agent 总开发计划
- 第一性原理推进策略
- 对抗式审计矩阵

还没有开始实现桌面应用代码。

## MVP 边界

MVP 只做个人本地版：

- 不做团队版
- 不做注册登录
- 不做云端 SaaS
- 不自动写 SAP
- 不释放传输请求
- 不自动正式入库知识
- 不提交 SAP 源码、SAP 密码、API Key、飞书 Token 或公司业务数据

## 文档入口

- [产品原型索引](docs/product-prototype/README.md)
- [产品开发说明书](docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md)
- [技术实现文档](docs/product-prototype/TECHNICAL_IMPLEMENTATION.md)
- [新项目交接说明](docs/product-prototype/NEW_PROJECT_HANDOFF.md)
- [总开发计划](docs/superpowers/plans/2026-07-02-sap-ai-workbench-master-plan.md)
- [第一性原理推进策略](docs/architecture/FIRST_PRINCIPLES_STRATEGY.md)
- [对抗式审计矩阵](docs/architecture/ADVERSARIAL_AUDIT_MATRIX.md)
- [多 Agent 执行模型](docs/architecture/MULTI_AGENT_EXECUTION_MODEL.md)
- [功能对抗式审计模板](docs/architecture/FEATURE_ADVERSARIAL_REVIEW_TEMPLATE.md)

## 推荐开发顺序

1. 仓库安全和基础治理。
2. 本地桌面应用骨架。
3. 项目、案件、文件夹和文件树。
4. 配置中心。
5. 只读 ADT、飞书 CLI、模型 API 连接器。
6. 案件任务模式。
7. 规范中心。
8. 知识库和搜索。
9. 端到端 MVP 验收。

## 安全原则

默认只读 SAP。所有密钥和客户资料必须留在本机安全存储或被 `.gitignore` 排除的本地目录中，不能进入 GitHub。
