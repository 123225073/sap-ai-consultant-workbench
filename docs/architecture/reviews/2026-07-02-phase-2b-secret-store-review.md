# Phase 2B Secret Store Foundation Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 2B 安全存储基础 |
| 所属阶段 | Phase 2B |
| 负责人 Agent | Controller Agent + 并行审计 Agents |
| 涉及文件 | `secureSecretStore.ts`、`secretHandle.ts`、`workbenchTypes.ts`、`workspaceStore.ts`、`main.ts`、`preload.ts`、`ConfigCenter.tsx`、`App.tsx`、`styles.css`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、Electron `safeStorage` 检查、运行时保存验证、恶意输入验证 |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否帮助 SAP 顾问推进案件？ | 是。后续 ADT/API/飞书验证可以安全使用真实凭据，不需要把密钥写进项目文件。 |
| 是否减少重复劳动？ | 是。密钥保存后，项目配置可以保留安全引用，后续验证和任务可以复用。 |
| 是否让结果更可追溯？ | 是。项目配置记录安全引用状态和更新时间，但不记录明文。 |
| 是否只是装饰性功能？ | 否。主进程会加密写入本地安全存储目录，配置 JSON 只保存引用。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反 |
| 不做卡片式 Dashboard | 未违反 |

## 4. 安全审计

| 风险 | 检查结果 |
|---|---|
| SAP 密码是否进入代码、日志、数据库、Markdown | 未发现；运行时验证确认明文未出现在 `app-state.json`、`project.json`、安全存储元数据 |
| API Key 是否明文保存 | 未发现；只保存加密值和 `secure-store:sec_...` 引用 |
| 飞书 Token 是否进入案件文件 | 未接 UI 输入；数据契约已预留安全句柄 |
| SAP 源码是否被误提交 | 未涉及 |
| 公司业务数据是否被误提交 | 未发现 |
| 文件写入是否限制在当前工作区 | 是，安全存储写入限制在 `local-data/workbench/secure-store` |
| UI 是否能触发 SAP 写入、激活、删除、传输释放 | 不能 |
| UI 是否能读取密钥明文 | 不能，无读取密钥 IPC |
| 伪造安全引用是否能覆盖真实引用 | 不能，普通配置保存会保留已有安全句柄并忽略前端伪造 |

## 5. 体验审计

| 问题 | 检查结果 |
|---|---|
| 按钮是否都有明确用途 | 是，“保存到系统安全存储”和真实验证按钮分开 |
| 是否符合左侧栏、中间工作区、右侧说明结构 | 是 |
| 是否避免了卡片式后台感 | 是 |
| 普通用户是否能理解失败原因 | 是，安全存储不可用、密钥为空等错误返回中文 |
| 是否误导用户认为已连接 | 否，保存后显示“已安全保存，未验证” |

## 6. 验收证据

```text
命令：
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
Electron safeStorage round-trip check
Main-process runtime save check with fake encrypted provider

结果：
类型检查通过。
生产构建通过。
安全预检通过，包含 IPC 白名单和危险 IPC 名称扫描。
Electron safeStorage 可用，roundTrip = true。

运行时保存验证：
ADT 密钥状态 = set-in-secure-store
API 密钥状态 = set-in-secure-store
ADT connectionStatus = pending-verification
API modelSyncStatus = pending-verification
secure-store 目录生成加密 JSON blob
app-state.json、project.json、安全存储元数据未发现测试明文密钥

恶意输入验证：
伪造 secretRef 不能替换已有安全引用。
空密钥被拒绝。
超长密钥被拒绝。
内部 resolveValue 可解密，证明连接器后续可在主进程内读取，但没有 IPC 暴露该能力。

剩余风险：
Phase 2B 只完成安全存储基础；还没有接 ADT 最小读取、模型列表获取、飞书授权验证。
安全存储删除/轮换策略未做 UI；当前替换密钥会复用已有安全引用。
```

## 7. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 2B 满足“密钥只进系统安全存储、JSON 只存引用、状态不伪装、无读取密钥 IPC”的目标。 |
| 必须修复项 | 无 |
| 可后续优化项 | Phase 3 接 ADT 只读验证；再补密钥轮换、失效检测和安全引用清理策略。 |
