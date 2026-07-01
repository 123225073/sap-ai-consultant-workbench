# Phase 1B Minimum Case Loop Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 1B 最小本地案件闭环 |
| 所属阶段 | Phase 1B |
| 负责人 Agent | Controller Agent + 并行审计 Agents |
| 涉及文件 | `apps/desktop/src/main/workspaceStore.ts`、`main.ts`、`preload.ts`、`App.tsx`、`workbenchTypes.ts` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1` |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否帮助 SAP 顾问推进案件？ | 是。项目、案件、对话、文件夹和文件树形成了本地案件闭环。 |
| 是否减少重复劳动？ | 是。创建案件会生成标准目录和基础文档。 |
| 是否让结果更可追溯？ | 是。`conversation.md`、`timeline.md`、`context_pack.md`、`metadata.json` 均落盘。 |
| 是否只是装饰性功能？ | 否。右侧文件树来自真实本地目录，不是静态假数据。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反，知识只生成候选 Markdown |
| 不做卡片式 Dashboard | 未违反，仍是对话 + 文件结构 |

## 4. 安全审计

| 风险 | 检查结果 |
|---|---|
| SAP 密码是否进入代码、日志、数据库、Markdown | 未发现 |
| API Key 是否明文保存 | 未发现 |
| 飞书 Token 是否进入案件文件 | 未发现 |
| SAP 源码是否被误提交 | 未发现 |
| 公司业务数据是否被误提交 | 未发现，原型和演示数据已脱敏 |
| 文件写入是否限制在当前工作区 | 是，`WorkspaceStore.assertInsideWorkspace()` 校验目标路径 |
| UI 是否能触发 SAP 写入、激活、删除、传输释放 | 不能 |
| 删除能力是否存在 | 未发现，预检脚本会扫描删除类文件操作 |

## 5. 体验审计

| 问题 | 检查结果 |
|---|---|
| 按钮是否都有明确用途 | 是，未实现能力标注为 Phase 1B 暂不可用或演示 |
| 是否符合左侧栏、中间对话、右侧文件、底部输入结构 | 是 |
| 是否避免了卡片式后台感 | 是 |
| 普通用户是否能理解失败原因 | IPC 返回中文错误 |
| 小窗口下是否不重叠 | 继承 Phase 1A 的最小宽度约束 |

## 6. 验收证据

```text
命令：
npm run check
npm run build
powershell -ExecutionPolicy Bypass -File scripts/security-preflight.ps1

结果：
全部通过。

运行时证据：
启动 Electron 后生成：
local-data/workbench/app-state.json
local-data/workbench/projects/demo-s4hana/project.json
local-data/workbench/projects/demo-s4hana/cases/demo001/README.md
local-data/workbench/projects/demo-s4hana/cases/demo001/conversation.md
local-data/workbench/projects/demo-s4hana/cases/demo001/timeline.md
local-data/workbench/projects/demo-s4hana/cases/demo001/context_pack.md
local-data/workbench/projects/demo-s4hana/cases/demo001/metadata.json
local-data/workbench/projects/demo-s4hana/cases/demo001/messages.json
local-data/workbench/projects/demo-s4hana/cases/demo001/outputs/
local-data/workbench/projects/demo-s4hana/cases/demo001/knowledge_candidates/

剩余风险：
Phase 1B 搜索只覆盖本地项目、案件和文件名，不承诺全文检索或知识库检索。
```

## 7. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 1B 已满足最小本地案件闭环，不接真实 SAP、飞书或模型 API。 |
| 必须修复项 | 无 |
| 可后续优化项 | Phase 2 前可增加自动化 UI 测试和更细的路径逃逸单元测试 |
