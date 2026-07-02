# Phase 5 Standards Center Adversarial Review

日期：2026-07-02

## 1. 功能信息

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 5 项目规范中心 |
| 所属阶段 | Phase 5 |
| 负责人 Agent | Controller Agent + Product/UX Review Agent + Security/Architecture Review Agent |
| 涉及文件 | `workbenchTypes.ts`、`standardsService.ts`、`workspaceStore.ts`、`caseWorkflowService.ts`、`main.ts`、`preload.ts`、`vite-env.d.ts`、`StandardsCenter.tsx`、`App.tsx`、`styles.css`、`security-preflight.ps1` |
| 验证命令 | `npm run check`、`npm run build`、`scripts/security-preflight.ps1`、`git diff --check`、runtime standards center check、targeted `rg` scans |

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否让每个项目有独立规范？ | 是。每个项目保存自己的 `standards/project-standards.json` 和 `standards/project-standards.md`。 |
| 是否支持 S4/ECC 起步模板？ | 是。规范中心可复制 S4 或 ECC 默认模板到当前项目。 |
| 是否支持从其他项目复制？ | 是。复制后变成当前项目的新独立副本，不共享引用。 |
| 是否覆盖用户要求的 8 类规范？ | 是。包含 ABAP、注释、请求号、ALV、接口、文档、流程图、Excel。 |
| 是否让 ABAP 本地任务知道项目规范？ | 是。ABAP 模式输出和 metadata 只引用规范版本与摘要，不复制完整规范正文。 |

## 3. MVP 边界审计

| 边界 | 是否违反 |
|---|---|
| 个人本地版，不做团队版 | 未违反 |
| 不做注册登录 | 未违反 |
| 不做云端 SaaS | 未违反 |
| 不自动写 SAP | 未违反 |
| 不释放传输请求 | 未违反 |
| 不自动正式入库知识 | 未违反；规范不是正式知识库内容 |
| 不调用真实模型 | 未违反；仍为本地确定性工作流 |
| 不发布飞书文档 | 未违反 |
| 不提交旧 SAP 工作区敏感数据 | 未违反；未从旧目录复制资料 |
| UI 不做卡片式 Dashboard | 未违反；规范中心是独立工作页，仍保持工具型布局 |

## 4. 产品/UX 审计

| 风险 | 处理结果 |
|---|---|
| 规范中心只是配置中心里的附属项 | 已避免。左侧侧栏有独立“规范中心”入口，打开真实页面。 |
| 用户不知道当前编辑的是哪个项目 | 已处理。页面展示当前项目、SAP 版本、来源、版本、复制时间、更新时间。 |
| 模板和项目副本边界不清 | 已处理。复制模板或其他项目后，保存为当前项目独立副本。 |
| 8 类规范不完整 | 已处理。8 类规范均可见、可编辑、可保存。 |
| 用户看不出与模板差异 | 已处理。右侧 diff 显示 `same`、`modified`、`project-only`、`template-only`、`not-applicable`。 |
| 保存相同内容造成版本虚增 | 已处理。内容无变化时不递增版本。 |
| ABAP 模式没有体现规范 | 已处理。ABAP 本地输出会显示当前项目规范摘要。 |

## 5. 安全与架构审计

| 风险 | 处理结果 |
|---|---|
| 规范内容可能包含密码、Token、授权头或源码 | 已阻止。保存和旧数据归一化都会做高置信敏感内容检查。 |
| 规范文件路径被用户输入控制 | 已避免。只写固定文件名 `project-standards.json` 和 `project-standards.md`。 |
| IPC 面扩大成通用文件能力 | 已避免。只新增规范读取、模板复制、项目复制、保存四类窄 IPC。 |
| 渲染层接触密钥 | 未引入。规范不解析任何密钥，既有密钥仍只在主进程解析。 |
| ABAP 输出泄露完整规范正文 | 已避免。只写版本和摘要，不写 `currentContent` 或 `sourceContent`。 |
| 规范被误认为正式知识库 | 已避免。审查和预检都保留规范与知识库边界。 |

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
安全预检通过。IPC 白名单、SAP 写操作扫描、标准中心安全标记扫描、完整规范正文泄露扫描均通过。

命令：
git diff --check

结果：
未发现空白或补丁格式问题。

命令：
runtime standards center check

结果：
templates=2
categories=8
diffStatuses=modified,not-applicable,same
metadataStandardsVersion=2
fullContentLeak=false

命令：
targeted sensitive business keyword scan

结果：
未发现指定旧 SAP/客户业务关键词进入当前源码、计划或审查文档。
```

## 7. 剩余风险

| 风险 | 后续处理 |
|---|---|
| 规范中心仍是本地编辑，不是真实 AI 规范执行器 | 后续接真实模型时必须单独做提示词上下文最小化审计。 |
| 当前没有文件导入解析规范 | 保持 Phase 5 范围；后续可做文本导入和冲突预览。 |
| 规范内容由用户输入，无法识别所有敏感信息 | 已做高置信阻断；仍需提醒用户不要粘贴真实密码、Token、客户明细或大段生产源码。 |
| 知识库和全文搜索仍未完成 | 放到后续 Phase 6，不在本阶段扩大范围。 |

## 8. 结论

| 结论 | 说明 |
|---|---|
| 通过 | Phase 5 满足“项目级独立规范中心、S4/ECC 模板复制、项目复制、8 类规范编辑、差异状态、ABAP 本地任务引用规范摘要”的阶段目标。 |
| 必须修复项 | 已完成 |
| 可后续优化项 | 规范导入、规范冲突预览、真实模型上下文最小化、知识中心和全文搜索。 |
