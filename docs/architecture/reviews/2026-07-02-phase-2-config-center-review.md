# Phase 2 Config Center Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 2 配置中心基础版 |
| 所属阶段 | Phase 2 |
| 负责人 Agent | Controller Agent + 并行审计 Agents |
| 涉及文件 | `workbenchTypes.ts`、`workspaceStore.ts`、`main.ts`、`preload.ts`、`App.tsx`、`ConfigCenter.tsx`、`styles.css`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、运行时保存验证、恶意输入验证 |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否帮助 SAP 顾问推进案件？ | 是。用户能按项目整理将来要接入的 ADT、飞书、模型和 Codex 配置。 |
| 是否减少重复劳动？ | 是。配置草稿可随项目保存，不需要每个案件重复填写。 |
| 是否让结果更可追溯？ | 是。项目级配置写入 `app-state.json` 和 `project.json`。 |
| 是否只是装饰性功能？ | 否。配置保存走真实 IPC 和 `WorkspaceStore`，不是纯静态页面。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反，ADT 仍强制只读 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反 |
| 不做卡片式 Dashboard | 未违反，配置中心是工作面 + 右侧边界说明 |

## 4. 安全审计

| 风险 | 检查结果 |
|---|---|
| SAP 密码是否进入代码、日志、数据库、Markdown | 未发现；Phase 2 不提供密码输入 |
| API Key 是否明文保存 | 未发现；API Key 保存按钮禁用 |
| 飞书 Token 是否进入案件文件 | 未发现；飞书只保存 CLI 路径和 Profile |
| SAP 源码是否被误提交 | 未发现 |
| 公司业务数据是否被误提交 | 业务敏感标签扫描未命中 |
| 文件写入是否限制在当前工作区 | 是，继续使用 `assertInsideWorkspace()` |
| UI 是否能触发 SAP 写入、激活、删除、传输释放 | 不能；无对应 IPC 和按钮 |
| 前端伪造状态是否能保存为真实验证 | 不能；保存时会重建白名单配置并强制 `pending-verification` |
| 前端伪造密钥引用是否能落盘 | 不能；Phase 2 强制 `secretRef: null` |

## 5. 体验审计

| 问题 | 检查结果 |
|---|---|
| 按钮是否都有明确用途 | 是；真实验证按钮禁用并标注后续接入 |
| 是否符合左侧栏、中间工作区、右侧信息栏结构 | 是 |
| 是否避免了卡片式后台感 | 是 |
| 普通用户是否能理解失败原因 | 是；保存失败返回中文错误 |
| 小窗口下是否不重叠 | 继承当前最小窗口宽度，配置表单使用稳定双列布局 |

## 6. 验收证据

```text
命令：
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
业务敏感标签扫描命令已执行，审查文档不复写具体标签，避免文档自身造成误命中。

结果：
类型检查通过。
生产构建通过。
安全预检通过。
业务敏感标签扫描无命中。

运行时保存验证：
ADT readOnly = true
ADT connectionStatus = pending-verification
ADT minimalReadStatus = pending-verification
API modelSyncStatus = pending-verification
local-data/workbench/app-state.json 未发现 password/apiKey/token/authorization/cookie 类字段
local-data/workbench/app-state.json 未发现 verified 或“已验证”声明

恶意输入验证：
伪造 ADT verified 状态会被重置为 pending-verification。
伪造 secretRef=../../../bad-secret 会被清空为 null。
额外 last_status 字段不会落盘。
明文 password 字段会被拒绝保存。

剩余风险：
Phase 2 仍未接入系统安全存储，因此不能保存真实 SAP 密码、API Key 或飞书授权值。
Phase 2 仍未做真实 ADT/飞书/API/Codex 验证，状态只能是草稿或待验证。
```

## 7. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 2 配置中心满足“项目级配置草稿、密钥不落盘、状态不伪装、IPC 白名单”的边界。 |
| 必须修复项 | 无 |
| 可后续优化项 | Phase 3 接入系统安全存储；Phase 4 再做 ADT 最小只读验证。 |
