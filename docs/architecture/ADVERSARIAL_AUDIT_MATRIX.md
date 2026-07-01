# SAP AI 顾问工作台对抗式审计矩阵

日期：2026-07-02

## 1. 审计原则

每个功能合并前都必须回答三个问题：

1. 这个功能是否让 SAP 顾问处理案件更快、更稳、更可追溯？
2. 这个功能是否可能泄露 SAP、客户、API、飞书或公司数据？
3. 这个功能是否破坏“本地个人版、SAP 只读、知识人工确认”的边界？

只要有一个答案不清楚，就不能进入下一阶段。

## 2. 功能审计矩阵

| 功能 | 必须对抗的问题 | 不允许出现 |
|---|---|---|
| GitHub 仓库 | 是否误提交密钥、真实 SAP 输出、公司资料 | `.env`、Token、SAP 源码、真实客户数据进入 Git |
| 桌面应用壳 | 是否只是空壳而不能承载案件工作 | 花哨首页、营销页、无用按钮 |
| 左侧栏 | 是否同时承担入口、项目、案件但不混乱 | 两套侧栏、技术对象清单堆满侧栏 |
| 中间对话 | 是否像 Codex 一样推进工作 | 卡片式 Dashboard、头像堆叠、技术过程常驻 |
| 右侧文件 | 是否只围绕当前案件文件 | 固定展示源码快照、工具日志大面板 |
| 项目管理 | 是否隔离客户、SAP 版本和规范 | 项目规范互相污染 |
| 案件管理 | 是否一个问题对应一个真实文件夹 | 对话有了但文件没沉淀 |
| 文件保存 | 是否按 outputs、technical、evidence、snapshots 分区 | 文件散落在随机目录 |
| 搜索 | 是否能说明结果来源 | 搜索结果只给文本不说来自哪里 |
| 配置中心 | 是否按当前项目配置 | 全局配置覆盖所有项目 |
| 密钥存储 | 是否走系统安全存储 | 密钥写入 Markdown、日志、SQLite 明文字段 |
| ADT 连接 | 是否默认只读并做最小读取验证 | status 成功就宣称已验证、暴露写入按钮 |
| SAP 读取 | 是否确认当前项目和系统 | 跨客户、跨 Client、生产测试混用 |
| ABAP 开发 | 是否只生成建议和文件，不自动写 SAP | 自动激活、自动传输、自动释放 |
| 飞书 CLI | 是否能解释权限失败 | 缺少 scope 时反复生成授权码 |
| 模型 API | 是否明确渠道和模型能力 | 模型选择散落多处、失败原因不清楚 |
| 规范中心 | 是否项目独立副本 | 修改模板导致所有项目变化 |
| 知识候选 | 是否必须人工确认 | AI 对话直接进入正式知识库 |
| 知识冲突 | 是否保留旧知识和适用范围 | 新知识直接覆盖旧知识 |
| 文档上传 | 是否保留结构和来源 | 表格被粗暴切碎后无法追溯 |
| 日志 | 是否便于排查但不泄密 | 日志记录密码、Token、大段源码 |

## 3. 阶段门禁

| 阶段 | 合并前必须检查 |
|---|---|
| Phase 0 | `git status`、`.gitignore`、敏感关键词扫描、远端地址 |
| Phase 1 | 主界面是否符合原型，按钮是否可解释，小窗口是否不重叠 |
| Phase 2 | 项目/案件/文件是否真实落盘，删除动作是否受控 |
| Phase 3 | 密钥是否不明文返回 UI，失败原因是否可读 |
| Phase 4 | SAP 是否只读，T000 最小读取是否真实验证 |
| Phase 5 | 每个任务模式是否把产物放入当前案件 |
| Phase 6 | 规范修改是否只影响当前项目 |
| Phase 7 | 知识是否先待确认，冲突是否阻止直接覆盖 |
| Phase 8 | 端到端流程是否能从案件找回文件和知识 |

## 4. GitHub 首次提交前检查命令

```powershell
git status --short
git remote -v
rg -n "password|passwd|token|api[_-]?key|secret|sap.*user|sap.*pass|client-data|customer-data|真实输出" .
git check-ignore .env
git check-ignore .sap-adt-cli
git check-ignore .sap-abap-cli
git check-ignore .sap-adt-cli-sebang
git check-ignore local-data
git check-ignore workspace-data
git check-ignore SAPAIWorkbench
git check-ignore SAP真实输出
git check-ignore customer-data
```

## 5. 对抗式验收口径

功能完成不等于界面看起来存在。

必须满足：

1. 有明确用户价值。
2. 有本地可验证结果。
3. 有失败状态。
4. 有安全边界。
5. 有文件或数据证据。
6. 不引入 MVP 外的高风险行为。
