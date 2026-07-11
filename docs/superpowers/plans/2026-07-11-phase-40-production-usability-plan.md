# Phase 40 生产可用性实施计划

日期：2026-07-11

## 实施顺序

1. 建立 Phase 40 探针，固定无演示种子、真实审核身份和 Work 目标结构。
2. 调整默认状态与兼容逻辑，保留历史数据但停止注入 Demo。
3. 重构 Work 左栏、创建面板、右侧文件栏和 Composer 高级动作。
4. 收敛规范中心，补未保存保护并移除演示说明。
5. 收敛知识库，修正审核身份、历史队列表达和生命周期操作。
6. 修正配置中心分区保存与模型渠道生命周期。
7. 更新产品文档和 README 的当前状态。
8. 构建、截图、阶段回归、安全预检和多 Agent 对抗审查。

## 风险控制

- 不删除现有本地数据。
- 不修改 SAP 只读接口集合。
- 不新增任意文件读取、通用 shell 或通用网络 IPC。
- 密钥删除只允许通过精确 Project + provider 目标，并必须由用户在界面确认。
- 页面拆分不改变已有持久化格式，必要新增字段保持向后兼容。

## 主要文件

- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/renderer/ConfigCenter.tsx`
- `apps/desktop/src/renderer/StandardsCenter.tsx`
- `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- `apps/desktop/src/main/workspaceStore.ts`
- `apps/desktop/src/main/knowledgeService.ts`
- `apps/desktop/src/main/secureSecretStore.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/shared/workbenchTypes.ts`
- Phase 40 probe、review 和产品文档
