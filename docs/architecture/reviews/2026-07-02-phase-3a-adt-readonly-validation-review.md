# Phase 3A ADT Readonly Validation Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 3A ADT 只读验证基础 |
| 所属阶段 | Phase 3A |
| 负责人 Agent | Controller Agent + Security/UX Explorer Agents |
| 涉及文件 | `workbenchTypes.ts`、`adtReadonlyConnector.ts`、`workspaceStore.ts`、`main.ts`、`preload.ts`、`vite-env.d.ts`、`App.tsx`、`ConfigCenter.tsx`、`styles.css`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、`git diff --check`、fake connector runtime check、targeted `rg` scans |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否帮助 SAP 顾问推进案件？ | 是。配置中心现在能执行 ADT 只读验证链路，而不是只保存表单。 |
| 是否减少重复劳动？ | 是。验证结果会写回当前项目状态，用户不用反复判断“保存配置”和“连接可用”的区别。 |
| 是否让结果更可追溯？ | 是。验证报告包含三层步骤、时间、失败原因和修复建议。 |
| 是否只是装饰性功能？ | 否。主进程会解析安全密钥引用、调用只读连接器、写回项目状态。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反 |
| 不做卡片式 Dashboard | 未违反；报告是配置表单中的紧凑状态区 |

## 4. 安全审计

| 风险 | 检查结果 |
|---|---|
| SAP 密码是否进入代码、日志、数据库、Markdown | 未发现；密码只在 main 进程内临时传给 fake connector |
| API Key 是否明文保存 | 未涉及新增路径 |
| 飞书 Token 是否进入案件文件 | 未涉及 |
| SAP 源码是否被误提交 | 未涉及 |
| 公司业务数据是否被误提交 | targeted scan 未命中旧 SAP 客户关键词 |
| 文件写入是否限制在当前案件目录 | 仍由既有 WorkspaceStore 边界控制 |
| UI 是否能触发 SAP 写入、激活、删除、传输释放 | 不能；只新增 `workbench:adt-verify-readonly` |
| UI 是否能读取密钥明文或 secretRef | 不能；preload 只暴露 `verifyAdtReadonly(projectId)` |
| 是否开放任意 SQL 或任意表名 | 否；最小读取对象固定为 `T000` |

## 5. 体验审计

| 问题 | 检查结果 |
|---|---|
| 按钮是否都有明确用途 | 是：保存草稿、保存密钥、执行只读验证 |
| 是否符合配置中心结构 | 是：仍是连续表单页，不是卡片堆叠 Dashboard |
| 是否避免误导“保存密码=连接成功” | 是：密钥状态仍显示“已安全保存，未验证” |
| 普通用户是否能理解失败原因 | 是：报告包含中文失败原因和修复建议 |
| T000 成功前是否避免“已验证” | 是：只有 `minimalReadStatus=verified` 才显示只读验证通过 |

## 6. 验收证据

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
安全预检通过。IPC 白名单包含新增 `workbench:adt-verify-readonly`，危险 IPC、密钥读取边界、SAP 写入模式、原始连接器输出、删除操作扫描均通过。

命令：
fake connector runtime check

结果：
successOk=true
successConnection=verified
successMinimal=verified
statusFailOk=false
statusFailMinimal=pending-verification
t000FailOk=false
t000FailConnection=verified
t000FailMinimal=failed
leakedSecret=false

命令：
temporary WorkspaceStore + SecureSecretStore runtime check

结果：
reportOk=true
connectionStatus=verified
minimalReadStatus=verified
hasLastCheckedAt=true
reportLeakedSecret=false

命令：
rg 旧 SAP 客户关键词

结果：
未命中。

剩余风险：
本阶段使用 fake connector 验证产品链路；真实 ADT CLI 接入留到后续阶段，仍必须保持同一只读抽象和脱敏报告规则。
```

## 7. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 3A 满足“配置检查 + status + 固定 T000 最小读取 + 脱敏报告 + 状态落盘”的目标。 |
| 必须修复项 | 无 |
| 可后续优化项 | Phase 3 后续接真实 ADT CLI、超时控制、错误分类和真实 T000 读取，但不能扩大到任意 SQL 或 SAP 写入。 |
