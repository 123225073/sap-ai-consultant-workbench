# Phase 43 桌面正式 UAT

## 目的

这套验收用于证明正式 Electron 构建的核心本地旅程真实可用，并为发布评审提供可重复的图形证据。它不是 SAP、Feishu/Lark 或模型服务的生产连通性测试，也不会读取真实密钥。

## 执行命令

```powershell
npm run probe:release-uat
```

命令会先构建静态 Electron 应用，再运行 Phase 41 生命周期静态检查和 Phase 43 桌面 UAT。成功后会输出证据目录，默认位置为：

```text
output/phase43-release-uat/<UTC 时间>/
```

需要交付到指定目录时，可以设置：

```powershell
$env:PHASE43_UAT_OUTPUT = "D:\release-evidence\phase43"
npm run probe:release-uat
```

## 覆盖范围

| 范围 | 验收内容 |
|---|---|
| Work | UI 创建隔离 Project 和工作文件夹，保存本地案件对话 |
| Chat | 发送独立日常对话，确认不展示案件文件面板、不写入案件 |
| 开发说明书 | 从成果动作生成 `outputs/开发说明书.md`，校验 11 个交付章节 |
| Mermaid 流程图 | 生成 `outputs/逻辑说明图.mmd`，校验 flowchart 语法并禁止脚本、链接 |
| 配置中心 | 遍历 SAP、AI 模型、Feishu/Lark、本机 AI、存储五个页签，确认每次只显示一个面板 |
| 规范中心 | 修改并保存隔离项目规范，确认版本和差异视图更新 |
| 知识库 | 粘贴脱敏文本生成候选，完成四项人工审核，再确认入库 |
| 响应式布局 | 在 `900×700` 视口确认无页面横向溢出，导航、工作区和发送按钮可用 |
| 主进程生命周期 | `probe:release-uat` 先执行 Phase 41 真实 Electron 单实例、renderer 受控恢复与正常关闭，再由 Phase 43 保存本次 UAT 的安全生命周期日志 |

## 隔离和安全

1. Electron `userData` 与工作区均创建在系统临时目录。
2. 子进程环境会移除名称包含 `key`、`token`、`secret`、`password`、`credential` 等字样的变量。
3. 不读取仓库现有 `local-data`，不读取系统安全存储，不输入测试密钥。
4. 不执行 SAP、Feishu/Lark、模型服务或 Codex 的真实连接测试。
5. UAT 结束后删除临时工作区，只保留不含密钥的截图、摘要、哈希和生命周期日志。

## Computer Use 捕获失败时的替代证据链

Computer Use 是否能捕获 Electron 窗口，取决于桌面捕获接口和当前显卡/窗口实现，捕获失败本身不等于产品失败。Phase 43 使用以下五层证据代替单一屏幕录制：

1. CDP `Page.captureScreenshot` 生成真实 renderer PNG 截图。
2. DOM 与可访问性断言证明控件存在、页签切换和关键按钮可操作。
3. preload IPC 返回值和隔离状态证明 renderer 与 main process 已共同执行。
4. 开发说明书、Mermaid 文件内容及 SHA256 证明成果真实落盘。
5. 生命周期日志证明单实例、崩溃恢复和正常退出链路。

`uat-report.json` 保存全部断言、截图 SHA256、成果 SHA256、响应式测量和生命周期事件。评审人员可用哈希确认截图和成果没有在报告生成后被替换。

## 发布判定边界

Phase 43 通过表示“桌面核心本地旅程和主进程生命周期 UAT 通过”。正式发布仍需单独提供：

- 组织代码签名证书和可信时间戳；
- 经品牌与法务批准的图标、产品名称和 SAP 商标口径；
- 在受控测试账号上执行的 SAP 严格证书只读连通性验收；
- 需要启用时，Feishu/Lark 和模型渠道的受控账号连通性验收。

这些外部验收不得使用 Phase 43 的隔离本地通过结果替代。
