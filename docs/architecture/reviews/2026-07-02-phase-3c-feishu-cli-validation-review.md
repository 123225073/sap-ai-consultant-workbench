# Phase 3C Feishu CLI Validation Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 3C 飞书 CLI 验证基础 |
| 所属阶段 | Phase 3C |
| 负责人 Agent | Controller Agent + Security/UX Review Agents |
| 涉及文件 | `workbenchTypes.ts`、`feishuCliConnector.ts`、`workspaceStore.ts`、`main.ts`、`preload.ts`、`vite-env.d.ts`、`App.tsx`、`ConfigCenter.tsx`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、`git diff --check`、fake connector runtime check、targeted `rg` scans |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否帮助 SAP 顾问推进案件？ | 是。用户可以先确认飞书 CLI、Profile 登录状态和文档权限线索，再进入后续文档工作流。 |
| 是否减少重复劳动？ | 是。验证结果写回当前项目，避免每次都凭记忆判断飞书配置能不能用。 |
| 是否让结果更可追溯？ | 是。报告包含三步检查、验证时间、失败分类和下一步建议。 |
| 是否只是装饰性功能？ | 否。主进程实际执行固定 CLI 检查，并把安全摘要写回本地项目状态。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 不做团队版 | 未违反 |
| 不做注册登录 | 未违反；不启动飞书授权流程 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反 |
| 不创建或更新飞书文档 | 未违反；真实路径只做 CLI 自检和登录/权限状态检查 |
| 不把飞书授权值提交到 GitHub | 未违反；报告、状态和 UI 不返回授权值、设备码或授权 URL |
| 不做卡片式 Dashboard | 未违反；仍在配置中心线性表单中展示 |

## 4. 安全审计

| 风险 | 检查结果 |
|---|---|
| renderer 是否能传任意命令 | 未发现。preload 只暴露 `verifyFeishuCli(projectId)`，renderer 只传项目 ID。 |
| IPC 是否过宽 | 未发现。新增 IPC 只有 `workbench:feishu-verify-cli`。 |
| 是否执行用户填写的任意本地路径 | 已修复。真实验证只允许固定命令名 `lark-cli` / `feishu-cli`，不执行完整路径或同名任意文件。 |
| 是否执行 shell 字符串 | 未发现。只使用 `execFile`，不使用 shell 命令拼接。 |
| 是否返回 raw stdout/stderr | 未发现。连接器只在主进程内部读取输出用于分类，不返回原文。 |
| 是否返回 Token、device code、授权 URL | 未发现。报告和 UI 不包含这些字段；预检增加飞书授权痕迹扫描。 |
| 是否创建/更新飞书文档 | 未发现。真实路径只运行 `doctor` 和 `auth status --verify --profile <profile>`。 |
| fake 验证是否会误用于正式配置 | 已收紧。`fake-lark-cli` 只有设置 `WORKBENCH_ALLOW_FAKE_FEISHU_CLI=1` 时才可通过主进程配置验证；连接器 fake 分支仅用于开发/演示自测。 |

## 5. 体验审计

| 问题 | 检查结果 |
|---|---|
| 是否误导“已经创建或发布飞书文档” | 已避免。成功提示和报告都说明尚未创建或发布文档。 |
| 修改 CLI/Profile 后是否仍显示旧验证状态 | 已修复。飞书 CLI 或 Profile 有未保存改动时，状态显示待验证，时间显示需保存后重新验证。 |
| 状态标签是否足够白话 | 已优化。登录显示“登录已验证”，文档权限显示“权限未发现缺失”。 |
| 失败文案是否偏技术 | 已优化。`doctor` 改为“CLI 自检”，`scope` 改为“缺少飞书文档权限项”。 |
| 文档权限是否过度承诺 | 已弱化。成功文案改为“未发现缺失文档权限；权限仍以后续真实流程为准”。 |

## 6. 子代理对抗评审处理

| 来源 | 问题 | 处理 |
|---|---|---|
| Security Review | 只校验 basename 会执行任意同名本地程序 | 已改为固定命令白名单；连接器内部也二次防御，拒绝完整路径。 |
| Security Review | fake 验证可能写成真实项目通过 | 已把 `fake-lark-cli` 主进程验证收紧到显式开发环境变量。 |
| Security Review | 文档权限状态可能过度乐观 | 已把 UI 和报告文案改为“未发现缺失”，并说明不代表真实文档流程已完成。 |
| Security Review | 预检抓不住固定参数问题 | 已新增 Feishu fixed CLI command scan，阻止 `execFile` 或 `runFixedCli` 回退到配置路径。 |
| UX Review | 编辑 CLI/Profile 后旧状态仍显示 | 已修复，未保存飞书配置显示待验证和重新验证提示。 |
| UX Review | 状态标签太泛 | 已拆成登录状态和文档权限两类标签。 |
| UX Review | 失败文案偏技术 | 已改为普通用户可理解的自检和权限项表达。 |

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
安全预检通过。IPC 白名单、危险 IPC、密钥解析边界、renderer secretRef、SAP 写入、原始输出、飞书授权痕迹、子进程边界、固定 CLI 命令、通用网络代理、模型连接器边界、Authorization 边界和删除操作扫描均通过。

命令：
git diff --check

结果：
未发现空白或补丁格式问题。

命令：
fake connector runtime check

结果：
success: ok=true; auth=verified; docs=verified; errors=none
missing-cli: ok=false; auth=pending-verification; docs=pending-verification; errors=cli-missing
not-logged-in: ok=false; auth=failed; docs=pending-verification; errors=auth-failed
missing-scope: ok=false; auth=verified; docs=failed; errors=missing-scope
unsafe-path: ok=false; auth=pending-verification; docs=pending-verification; errors=invalid-cli-path
敏感标记扫描：未发现 token、device_code、verification_uri、authorization、rawStdout、rawStderr。
```

## 8. 剩余风险

| 风险 | 处理建议 |
|---|---|
| 未在本机真实 `lark-cli` 登录环境下做人工验证 | 需要用户本机安装并配置好真实飞书 CLI 后，再执行一次真实验证。 |
| `auth status --verify` 不能证明真实文档创建一定成功 | 保持边界。后续真正创建草稿前，必须另做“只创建用户确认的草稿/不发布”的专项审查。 |
| fake connector 仍存在于代码中 | 仅用于开发/演示自测；主进程默认不允许正式配置使用 fake CLI。 |

## 9. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 3C 满足“安全验证飞书 CLI/Profile 状态、窄 IPC、固定命令、脱敏报告、状态落盘、无文档写入”的目标。 |
| 必须修复项 | 已完成 |
| 可后续优化项 | 真实飞书 CLI 人工验证、后续文档草稿创建前专项安全审查、权限证明更细粒度化。 |
