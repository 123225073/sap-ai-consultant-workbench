# Phase 3B Model Provider Validation Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 3B 模型渠道验证基础 |
| 所属阶段 | Phase 3B |
| 负责人 Agent | Controller Agent + Security/UX Explorer Agents |
| 涉及文件 | `workbenchTypes.ts`、`modelProviderConnector.ts`、`secureSecretStore.ts`、`workspaceStore.ts`、`main.ts`、`preload.ts`、`vite-env.d.ts`、`App.tsx`、`ConfigCenter.tsx`、`styles.css`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、`git diff --check`、temporary WorkspaceStore + SecureSecretStore runtime check |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否帮助 SAP 顾问推进案件？ | 是。用户现在能确认模型渠道至少可以获取模型列表并完成最小对话。 |
| 是否减少重复劳动？ | 是。验证结果会写回当前项目，模型数量、验证时间和失败原因可追踪。 |
| 是否让结果更可追溯？ | 是。报告包含模型列表步骤、最小对话步骤、脱敏主机、测试模型、失败建议。 |
| 是否只是装饰性功能？ | 否。主进程会解析安全存储中的 API Key，执行连接器验证，再写回安全摘要。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反 |
| 不把模型接入案件任务编排 | 未违反；本阶段只做渠道验证 |
| 不做卡片式 Dashboard | 未违反；报告仍在配置中心线性表单中展示 |

## 4. 安全审计

| 风险 | 检查结果 |
|---|---|
| API Key 是否进入 renderer/preload | 未发现；preload 只暴露 `verifyModelProvider(projectId, providerId)` |
| API Key 是否写入普通状态文件或报告 | 运行时验证未发现；报告和 `app-state.json` 均不包含测试密钥 |
| `secretRef` 是否返回 renderer 或写入普通状态文件 | 已修复；普通状态只保留密钥状态，安全引用由主进程按项目和目标在安全存储中查找 |
| 是否开放任意网络代理 IPC | 未发现；只新增 `workbench:model-provider-verify` |
| Base URL 是否可能把 API Key 发到本机或内网 | 已加保护；真实渠道必须 HTTPS，且阻止 localhost、内网、链路本地、云元数据和 `.local` 地址 |
| 原始响应 body/header 是否返回界面 | 未发现；只保存模型 ID 摘要、状态和固定错误分类 |
| 模型 connector 是否读取案件、对话、文件或 SAP 源码 | 未发现；最小对话只发送固定 `ping` |
| 模型 ID 是否可能保存异常内容 | 已收紧；只允许常见模型 ID 字符集和长度，拒绝疑似密钥内容 |

## 5. 体验审计

| 问题 | 检查结果 |
|---|---|
| 是否误导“模型已进入案件任务” | 已避免；成功提示和报告均说明只是渠道连通和最小对话通过 |
| 是否误导“工具调用/联网能力已验证” | 已避免；能力标签改为“名称含...”并说明只是名称推断 |
| 用户修改草稿后能否直接验证旧配置 | 已阻止；有未保存草稿时验证按钮禁用并提示先保存 |
| “启用草稿”是否含义不清 | 已改为“保留为候选渠道” |
| 模型列表显示是否清楚 | 已补充“仅显示前 8 个模型”说明 |

## 6. 子代理对抗评审处理

| 来源 | 问题 | 处理 |
|---|---|---|
| Security Explorer | 任意 HTTP/HTTPS Base URL 会带 API Key 请求 | 已要求真实渠道 HTTPS，并阻止本机、内网、链路本地、云元数据地址 |
| Security Explorer | `secretRef` 会返回 renderer 或写入普通状态 | 已改为主进程按目标查找安全存储；普通状态只保留 `state/updatedAt` |
| Security Explorer | 模型 ID 过滤偏弱 | 已改为模型 ID 白名单字符集 |
| UX Explorer | 能力标签像已验证能力 | 已改为名称推断标签，并加说明 |
| UX Explorer | 未保存草稿直接验证会误导 | 已禁用验证按钮，要求先保存 |
| UX Explorer | 成功文案边界不够清楚 | 已补充“尚未进入案件任务” |

## 7. 验收证据

```text
命令：
npm run check

结果：
TypeScript 检查通过。

命令：
npm run build

结果：
main、preload、renderer 生产构建通过。

命令：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1

结果：
安全预检通过。IPC 白名单、危险 IPC、密钥解析边界、renderer secretRef、SAP 写入、原始输出、通用网络代理、模型 URL 安全保护、模型 connector 边界、Authorization 边界和删除操作扫描均通过。

命令：
git diff --check

结果：
未发现空白或补丁格式问题。

命令：
temporary WorkspaceStore + SecureSecretStore runtime check

结果：
ok=true
mode=fake
modelSyncStatus=verified
chatTestStatus=verified
storedModels=3
endpointHost=https://api-demo.example.com
returnedSecretRef=null
keyPersistedInState=false
secretRefPersistedInState=false
keyInReport=false
```

## 8. 剩余风险

| 风险 | 处理建议 |
|---|---|
| 未使用真实外部模型账号做人工验证 | 需要用户提供测试渠道后，在不记录密钥和响应正文的前提下手动验证一次 |
| DNS 解析后仍可能指向内网地址 | 后续真实生产接入前，可增加 DNS 解析后的 IP 检查或显式服务商白名单 |
| 本阶段未接入案件任务编排 | 保持边界；下一阶段如果接入案件任务，必须另做上下文最小化和输出落盘审计 |

## 9. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 3B 满足“安全保存 API Key、主进程验证、模型列表摘要、最小对话测试、脱敏报告、状态落盘”的目标。 |
| 必须修复项 | 已完成 |
| 可后续优化项 | 真实服务商手动验证、DNS 解析后 IP 检查、模型能力真实探测、后续案件任务编排审计。 |
