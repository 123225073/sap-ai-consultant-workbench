# Phase 39 产品重整实施计划

日期：2026-07-10

## 目标

把现有开发样机重整为可信、清爽、可连续使用的 Work 主路径，并完成 Project 内多模型渠道从配置、测试、获取模型到对话选择的完整闭环。

## 实施顺序

1. 固定产品契约
   - 记录现状冲突、目标信息架构、安全边界和阶段路线。
   - 明确本轮不新增 SAP 写入、外部发布、删除渠道和不可逆迁移。

2. 修正模型资格规则
   - renderer 展示真实验证渠道获取到的全部模型。
   - main process 接受该渠道模型列表中的任意明确模型。
   - 保留 `lastVerifiedModelId` 作为最小 chat 探针记录。

3. 完成多渠道配置
   - 增加渠道列表、选择和添加。
   - 按渠道管理密钥输入、显示状态和验证报告。
   - 保存、测试动作始终作用于当前选中渠道。

4. 重整主工作台
   - Work 改为默认入口。
   - 删除无行为的顶栏、附件和语音控件。
   - 新建 Project / 工作文件夹改为按需面板。
   - SAP 只读取证改为按需展开。
   - 移除每条 AI 消息重复的安全模板。
   - 普通案件对话使用当前权限模式。

5. 修复桌面布局
   - 取消 `body` 固定最小宽度。
   - 三栏调整为紧凑、可收缩的轨道。
   - 窄窗口自动收起右侧上下文栏。
   - 隐藏 Electron 原生菜单栏，保留系统快捷键能力。

6. 建立 Phase 39 探针
   - 检查多渠道 UI、全部模型可选、main process 资格规则和响应式标记。
   - 检查普通对话权限模式不再硬编码。
   - 把 Phase 39 纳入安全预检。

7. 真实验证与对抗审查
   - 运行 TypeScript 检查、构建、Phase probes、安全预检和 diff 检查。
   - 启动桌面应用，在宽屏和窄屏截图检查裁切、遮挡、按钮和模型选择。
   - 由独立 Agent 从产品、UI、架构和安全角度交叉审查，修复确认问题后复测。

## 文件范围

- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/ConfigCenter.tsx`
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/main/workspaceStore.ts`
- `apps/desktop/src/main/main.ts`
- `scripts/phase39-product-realignment-probe.mjs`
- `scripts/security-preflight.ps1`
- Phase 39 spec、plan、review 文档

## 风险控制

- 不修改既有 IPC 形状，优先复用 `ProjectConfig.apiProviders`。
- 不删除渠道，避免密钥引用遗留和不可逆数据变化。
- 不改变模型安全上下文构造和敏感内容检查。
- 不更改 SAP 连接器允许的 HTTP 方法或端点。
- 不覆盖工作区已有 Phase 27-38 改动。
