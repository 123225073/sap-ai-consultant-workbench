# 新开 Codex 开发线程提示词

用途：在 `D:\9005_IDEauthorized\Codex Project\sap-ai-consultant-workbench` 目录下新开 Codex 线程时，作为第一条消息使用。

```text
我要开始开发一个新产品：SAP AI 顾问工作台。

当前工作目录就是新项目目录：

D:\9005_IDEauthorized\Codex Project\sap-ai-consultant-workbench

重要说明：

1. 产品资料已经迁移到当前新项目目录下，不需要你从旧的 SAP ABAP 工作区复制或迁移任何文档。
2. 请不要立刻开发、不要创建项目骨架、不要安装依赖、不要写代码。
3. 你的第一步任务只是读取并充分理解项目资料，确认你已经掌握开发上下文。
4. 我不是程序员，沟通请用中文，少讲复杂技术细节，多讲结论、风险、下一步。

请先读取以下文档和原型图：

docs/product-prototype/README.md
docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md
docs/product-prototype/TECHNICAL_IMPLEMENTATION.md
docs/product-prototype/NEW_PROJECT_HANDOFF.md

原型图目录：

docs/product-prototype/images

读取后，请只输出以下内容，不要开始开发：

1. 你对产品定位的理解。
2. 你对 MVP 范围的理解，明确哪些做、哪些不做。
3. 你对核心界面结构的理解：左侧统一侧栏，中间 Codex 风格自由对话，底部固定案件动作、权限模式和模型选择，右侧当前工作文件夹文件。
4. 你对关键业务规则的理解：项目独立、案件为核心、文件沉淀成果、知识人工确认入库、SAP 默认只读。
5. 你对技术路线的理解：Electron + React + TypeScript、SQLite、本地文件系统、安全存储、后续接 ADT/飞书/API/Codex。
6. 第一阶段你建议怎么开发，但只写计划，不要执行。
7. 你认为当前文档还有哪些开发前必须澄清的问题。

必须遵守的边界：

1. MVP 是个人本地版，不做团队版。
2. 不做注册登录。
3. 不做云端 SaaS。
4. 不自动写 SAP。
5. 不释放传输请求。
6. 不自动正式入库知识。
7. 不把 SAP 源码、SAP 密码、API Key、飞书 Token、公司业务数据提交到 GitHub。
8. 不从旧的 SAP ABAP 工作区复制敏感数据。
9. 不把 AI 回复做成卡片式 Dashboard，UI 要尽量参考 Codex App。
10. 不出现无法解释的按钮。

关于旧 SAP ABAP 工作区：

旧目录里有 ADT 连接和飞书 CLI 的使用经验，这些经验已经沉淀到当前项目的 TECHNICAL_IMPLEMENTATION.md。你不需要依赖旧目录继续开发。

第一阶段开发目标只允许是：

1. 本地桌面应用骨架。
2. 左侧统一侧栏。
3. 项目和案件基础数据。
4. 中间对话区域静态和基础交互。
5. 右侧当前案件文件面板。
6. 案件文件夹创建和文件树读取。
7. 底部固定案件动作、权限模式和模型选择器静态 UI。
8. 案件动作轻量确认面板静态 UI。
9. 基础搜索入口。

请先完成“理解和计划”，等我确认后，再进入真正开发。
```
