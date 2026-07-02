# Phase 9 Case File Preview Adversarial Review

日期：2026-07-02

## 1. 功能范围

| 项目 | 内容 |
|---|---|
| 功能名称 | Phase 9 安全的当前案件文件预览 |
| 当前分支 | `phase-9-case-file-preview` |
| 计划文档 | `docs/superpowers/plans/2026-07-02-phase-9-case-file-preview-plan.md` |
| 涉及文件 | `workspaceStore.ts`、`main.ts`、`preload.ts`、`workbenchTypes.ts`、`App.tsx`、`styles.css`、`security-preflight.ps1` |

Phase 9 只新增当前案件文件的本地只读文本预览，不新增通用文件打开器、系统 shell open、文件删除、文件写入、真实 SAP 读写、模型调用、飞书发布或知识自动入库。

## 2. 用户价值审计

| 问题 | 结论 |
|---|---|
| 是否补齐 Phase 8 缺口 | 是。Phase 8 已生成可用本地文件，但用户不能在应用内查看正文；Phase 9 让文件从“可见”变成“可检查”。 |
| 是否符合产品规格 | 是。右侧仍是当前案件文件面板，预览只在用户点击文件后出现。 |
| 是否保持 Codex 风格 | 是。没有新增 Dashboard 或大卡片页面，仍是左侧项目、中间对话、右侧文件。 |
| 是否降低误导 | 是。预览区标明“本地只读预览”，不暗示真实 SAP、模型或飞书已经执行。 |

## 3. MVP 边界审计

| 边界 | 结果 |
|---|---|
| 个人本地版，不做 SaaS/登录 | 未改变。 |
| SAP 默认只读 | 未新增 SAP 写入或读取能力。 |
| 不释放传输请求 | 未新增相关入口。 |
| 不自动发布飞书 | 未新增飞书发布调用。 |
| 不自动正式入库知识 | 预览不会调用知识发布。 |
| 不提交敏感旧 SAP 工作区数据 | 预览只允许当前案件相对路径，并阻止 `.sap-adt-cli`、`.sap-abap-cli`、`secure-store` 路径标记。 |
| 不做通用文件读取 IPC | 只新增 `workbench:preview-current-case-file`。 |

## 4. 安全审计

| 风险 | 处理 |
|---|---|
| 路径穿越 | `assertPreviewRelativePath()` 拒绝 `..`、空路径段、绝对路径、URL、反斜杠和控制字符。 |
| 读取当前案件外文件 | `previewCurrentCaseFile()` 从 `caseRoot()` 解析路径，并使用 `realpath` 校验真实路径仍在当前案件目录内。 |
| 软链接 / junction 逃逸 | `lstat()` 拒绝 symlink，`realpath` 再次验证真实路径边界。 |
| 通用文件打开 | 未使用 `shell.openPath`、`shell.openExternal`、`dialog.showOpenDialog`。 |
| 内部状态 JSON 泄露 | Phase 9 默认拒绝 JSON，且阻止 `messages.json`、`metadata.json`、`project.json`、`app-state.json`。 |
| 凭据或授权物料进入 renderer | `redactPreviewContent()` 在返回前脱敏 Authorization、Cookie、API Key、secure-store ref、Feishu device code 等高置信字段。 |
| 大文件卡死 | 单文件超过 256 KB 拒绝；返回内容上限 64 KB。 |
| 扩展名风险 | 仅允许 `.md`、`.txt`、`.csv`、`.mmd`。 |
| 前端绕过 | 后端要求路径存在于当前 `activeCaseFiles` 文件树，前端不能手写隐形路径读取。 |

## 5. 体验审计

| 体验点 | 结果 |
|---|---|
| 文件树点击 | 文件行可点击预览，目录行不可点击。 |
| 文件 chip 点击 | chip 改为打开同一只读预览，并定位到文件行。 |
| 预览展示 | 显示文件名、相对路径、类型、大小、截断和脱敏状态。 |
| 错误提示 | 不支持类型、路径被阻止、内部文件被阻止时显示明确原因。 |
| 技术材料 | `technical/`、`evidence/`、`snapshots/` 不自动展开，只在用户主动点击时预览。 |

## 6. 多 Agent 发现和处理

| 来源 | 级别 | 发现 | 处理 |
|---|---|---|---|
| Product/UX Agent | P1 | Phase 8 后最优下一步是文件预览，不是继续做 Dashboard 或正文搜索。 | 已按当前案件右侧文件面板实现只读预览。 |
| Product/UX Agent | P1 | chip 当前只跳转文件行，容易误导为已打开文件。 | chip 改为调用预览，并同步定位文件行。 |
| Product/UX Agent | P2 | 技术材料不能默认曝光。 | 仅用户点击后预览。 |
| Product/UX Agent | P2 | 界面仍残留 Phase 8 文案，和 Phase 9 文件预览不一致。 | 已将阶段提示、顶部标识、模式提示、模型提示和本地输出阶段常量更新为 Phase 9。 |
| Product/UX Agent | P2 | 文件行和文件 chip 的预览含义主要藏在 hover title 里。 | 已在文件行和 chip 的可见小字中补充“预览”。 |
| Security/Architecture Agent | P0 | 禁止通用 `read-file/open-any-path/open-url/shell open`。 | 仅新增窄 IPC，安全预检加入白名单和危险名称扫描。 |
| Security/Architecture Agent | P0 | symlink/junction 可能绕出当前案件目录。 | 使用 `lstat` 和 `realpath` 双重检查。 |
| Security/Architecture Agent | P0 | secrets 不能进入 renderer。 | 预览返回前统一脱敏，内部 JSON 默认拒绝。 |
| Security/Architecture Agent | P1 | JSON 预览容易泄露内部状态。 | Phase 9 不允许 JSON 预览。 |
| Security/Architecture Agent | P1 | 需要大小限制。 | 文件上限 256 KB，返回上限 64 KB。 |
| Security/Architecture Agent | P1 | `Authorization: Basic xxx` 这类带空格的授权值只脱敏到第一个空格，可能残留凭据片段。 | 已将 Authorization 脱敏扩展到整行，并补充运行探针覆盖 Basic/Token/Bearer 变体。 |
| Spec Compliance Review Agent | P2 | 首尾控制字符会被 `trim()` 吞掉后通过。 | 已改为先检查原始 `relativePath` 控制字符，再执行 trim。 |
| Spec Compliance Review Agent | P2 | 输入对象允许额外字段，不完全符合 `{ relativePath: string }`。 | 已改为拒绝数组和额外字段，只允许一个 `relativePath` 字段。 |

## 7. 规格复核

| 来源 | 结论 |
|---|---|
| Spec Compliance Review Agent | 早期规格复核发现 2 个 P2，均已修复，并用运行时探针覆盖。 |
| Security/Architecture Agent | 后续安全复核发现 1 个 P1：Authorization 脱敏不完整；已扩展为整行脱敏，并补充 Basic/Token/Bearer 运行探针。 |
| Product/UX Agent | 后续体验复核发现 2 个 P2：阶段文案残留和“预览”可见性不足；均已修复。 |

## 8. 验证命令

### TypeScript

```text
命令：npm run check
结果：exit 0
```

### Security Preflight

```text
命令：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
结果：exit 0
Security preflight passed.
```

### Build

```text
命令：npm run build
结果：exit 0
```

### Diff Whitespace

```text
命令：git diff --check
结果：exit 0
```

## 9. 运行时攻击探针

```text
previewAllowedMd=ok
previewAllowedTxt=ok
previewAllowedCsv=ok
previewAllowedMmd=ok
rejectExtraField=ok
rejectArrayInput=ok
rejectControlCharacter=ok
rejectPathTraversal=ok
rejectNestedTraversal=ok
rejectAbsolutePath=ok
rejectUrlPath=ok
rejectBackslashPath=ok
rejectInternalJson=ok
rejectProjectJson=ok
rejectDisallowedExtension=ok
rejectOversized=ok
rejectMissingFromTree=ok
redaction=ok
redactionContent=ok
rejectSymlinkEscape=skipped
probeRoot=C:\Users\CM1165\AppData\Local\Temp\sap-ai-phase9-preview-LhsL1q
```

说明：Windows 当前运行环境未允许创建 symlink，因此 symlink 逃逸探针跳过；代码和安全预检仍要求 `lstat` 与 `realpath` 标记。脱敏探针覆盖 `Authorization: Basic`、`Authorization=Token`、`Authorization: Bearer`、Cookie、SAP session 和 API key 变体。

## 10. 剩余风险

| 风险 | 处理 |
|---|---|
| Markdown 未渲染 | 本阶段刻意使用纯文本预览，避免 HTML/脚本/链接执行风险。 |
| JSON 不能预览 | 为避免内部状态泄露，Phase 9 默认拒绝；未来如需 JSON，必须做固定安全 JSON 白名单。 |
| Excel / 图片不能预览 | 本阶段只处理安全文本类文件；二进制文件后续专项设计。 |
| 正文搜索仍未实现 | 不在 Phase 9 扩展，避免把敏感正文写入索引。 |
| 右侧面板仍不可拖拽宽度 | 属于体验增强，不影响安全预览闭环。 |

## 11. 结论

| 结论 | 说明 |
|---|---|
| 条件通过 | Phase 9 已实现当前案件安全文本预览，未扩大 SAP、飞书、模型、文件系统或知识入库边界。 |
| 必须修复项 | 当前无已知 P0/P1 未修复项。 |
| 后续建议 | 下一阶段可在不扩大敏感索引范围的前提下，设计“安全输出摘要索引”或二进制文件预览专项。 |
