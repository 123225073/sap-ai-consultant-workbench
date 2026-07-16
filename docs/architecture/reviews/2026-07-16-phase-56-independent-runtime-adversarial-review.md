# Phase 56 独立运行时对抗式审查

日期：2026-07-16
状态：工程验收通过；真实外部连接仍按目标环境分别复测

## 1. 审查范围

本轮围绕独立 Agent Runtime、EventStore、模型工具循环、MCP Client、Work/Chat 会话生命周期、Project/Case 隔离、renderer 与 main process 的 IPC 边界以及产品文档真实性进行对抗式检查。

审查目标不是证明“功能很多”，而是确认以下硬边界：

- 日常 Chat 不串用其他 Project、Provider 或 Case 的历史。
- Work Thread 创建后不能被重新绑定到其他 Project/Case。
- renderer 不能读取任意 Agent Thread，也不能用可猜测的 Thread ID 取消其他运行。
- 外部 MCP Server 的自报 `readOnlyHint` 不能变成执行授权。
- 取消、窗口关闭、崩溃和存储损坏不会静默丢失用户输入或破坏全部事件账本。
- 文档不把“已配置、已发现”描述成“已执行、已发布”。

## 2. 已发现并修复的问题

| 严重度 | 问题 | 修复结果 |
| --- | --- | --- |
| P1 | 外部 MCP Server 可通过自报只读属性进入工具候选，存在错误提权风险 | 稳定版彻底阻断外部 MCP 工具启用和执行；只保留 HTTPS 连接、测试与 tools/resources/prompts 发现 |
| P1 | renderer 曾可按 Thread ID 读取运行时数据，取消也只依赖 Thread ID | 移除 Thread 读取 IPC；取消改为不可预测的单次 `requestId`，main process 按请求所有权定位运行 |
| P1 | MCP 分页和响应体缺少硬上限，恶意或异常 Server 可耗尽内存 | 增加 20 页上限、重复 cursor 检测、1 MB 单响应、8 MB 累计发现、60 秒总时限、嵌套深度和取消边界 |
| P1 | Daily Chat 历史键未完整包含 Project 与 Provider，存在跨配置串话风险 | 历史改为按 `projectId + providerId` 隔离，并由专项探针覆盖 |
| P1 | 已存在 Thread 可被新的请求重新绑定 Project/Case | EventStore 强制 Thread 绑定不可变；不一致请求直接拒绝 |
| P1 | 用户在发送后立即点击停止时，运行尚未登记，可能无法取消；失败后输入框内容可能丢失 | 增加早停排队、按 requestId 取消、失败/取消恢复草稿和明确中文状态 |
| P1 | Work 输入先写 Agent 账本再做敏感内容校验，拒绝内容仍可能进入运行记录 | 把敏感内容校验前移到 Runtime 之前；拒绝内容不落账本、不广播 |
| P1 | Runtime 事件曾广播给全部窗口，取消也未校验窗口所有权 | main process 按 requestId 记录所属窗口，只向所有者发送事件并只接受所有者取消 |
| P1 | 模型失败被兼容投影保存后，Agent Turn 仍可能被标记完成 | 执行结果显式区分 completed/failed；失败说明保留给用户，同时 EventStore 记录 failed 终态 |
| P1 | 应用重启只把未完成 Turn 改为 interrupted，用户界面没有恢复结果 | 启动时把中断提示投影到仍存在的原 Work/Chat 会话；不重放原请求和工具，无法匹配的记录单独标记 |
| P1 | MCP 旧测试可能覆盖已修改的连接配置 | 每次测试绑定配置 revision；修改/删除连接会取消旧测试，旧结果无法写回新配置 |
| P1 | 同会话中取消排队任务时可能提前释放串行锁，导致后续任务越过仍在运行的任务 | 引入独立 `ExclusiveWorkflowQueue`，只有真实队尾结束后才释放；A 运行、B 排队取消、C 等待的对抗用例通过 |
| P2 | 每个流式 delta 都立即持久化，长回复会造成高频磁盘写入 | 按 2 KB 或 50 ms 批量落盘，同时保留最终 flush |
| P2 | sql.js 每次事件导出完整数据库镜像，工具事件多时退化明显 | delta 与工具事件采用内存追加和 1 秒批量 durable flush，终态强制持久化；后续再评估文件型 SQLite 驱动迁移 |
| P2 | 助手长回复超过单事件上限时会被静默截断 | 拆成有序 message-part，最终消息保存长度、SHA-256、分片数和预览，避免不可检测截断 |
| P2 | EventStore 并发保存和单文件损坏恢复能力不足 | 增加串行持久化队列和 `.previous` 备份恢复 |
| P2 | 案件动作异常可能形成未处理 Promise | 页面入口统一捕获并显示中文失败原因 |
| P2 | 部分旧文档把 MCP 执行、飞书云端发布、子 Agent 写成当前可用 | 根文档、架构、实现、限制和能力中心规格统一改为当前真实边界 |
| P2 | 重启恢复曾按回复时间判断是否已保存，相邻 Turn 的晚到回复可能造成误判 | Work/Chat 持久消息增加内部 `agentTurnId`，恢复只接受与中断 Turn 精确一致的 assistant 消息；旧记录保守按未确认处理 |
| P2 | 旧 MCP 测试若无视取消并晚成功，仍可能覆盖新测试 | 成功与失败写回都校验当前 single-flight 所有权；新增“旧请求不响应 abort、晚于新请求返回”的对抗用例 |
| P2 | Windows 安装包与 Git 提交缺少强制一一对应，构建期间切换干净提交仍可能误记来源 | `package:win` 只允许干净 Git 工作树，锁定起始 commit，构建后复核工作树和 `HEAD`，并为 Setup、Portable、两个双击副本和解压版主程序生成提交号、大小与 SHA-256 清单 |

## 3. 当前安全边界

- Agent Runtime 只允许产品自有的本地内置只读工具进入自动工具循环。
- SAP 仍默认只读；写入、激活、传输、过账、删除和批量修改不在本轮能力范围。
- MCP 目前是“连接和发现中心”，不是外部工具执行器。
- 能力中心当前只开放匿名 HTTPS MCP；安全 Header/OAuth 配置界面尚未开放。
- Skill 和声明式 Plugin 只提供受控上下文与结构化声明，不执行导入包中的任意脚本或第三方 UI。
- 长期记忆只接收用户明确确认的候选内容；密钥、原始 SAP evidence、源码和终端日志不会自动进入长期记忆。
- ContextEngine 当前使用固定 32,768 token 保守窗口；checkpoint 是本地确定性摘录，尚无独立查看/重建界面。

## 4. 验证证据

修复后已单独通过以下专项检查：

- `phase50-agent-runtime-foundation-probe.mjs`
- `phase53-mcp-client-probe.mjs`
- `phase35-config-reveal-conversation-probe.mjs`
- `phase39-product-realignment-probe.mjs`
- `phase46-conversation-experience-probe.mjs`
- `phase55-agent-tool-loop-probe.mjs`
- `phase56-context-lifecycle-probe.mjs`
- TypeScript 与前端静态检查 `npm run check`

本轮最终代码已通过完整 `npm run verify`。桌面 UAT 曾捕捉到规范保存后的短暂加载闪烁，修复为保留已加载内容并后台静默刷新后，后续完整回归一次通过；最新证据目录为：

- `output/phase43-release-uat/2026-07-16T16-49-11-751Z`

Windows Setup、Portable 和解压版已于 2026-07-16 成功构建；打包后的真实主程序已启动并出现“SAP AI 顾问工作台”窗口。`package:win` 还会自动刷新两个双击启动副本，避免用户误开旧 Portable。最终对外分发包必须在本轮提交后从 clean worktree 重新生成，且 `BUILD-METADATA.json` 必须记录 `gitDirty=false`。

外部能力已补充以下真实回测：

- 已配置模型渠道 `CPAMC` 的 `gemini-3.1-flash-lite` 完成 Chat/Work 真实流式回测，覆盖输入清空、自动跟随、模型选择持久化和结果落盘。
- Feishu/Lark CLI Profile `chunmi` 的登录态与文档只读、创建、写入 scope 检查通过，测试过程未显示 Token 或账号敏感信息。
- 当前 SAP Client 220 连接保留真实 T000 只读验证记录；本轮没有把该历史状态写成新的实时连通结果。SAP 连接仍需在目标网络内按需复测。

专项探针和隔离 UAT 不能替代每个目标网络中的外部服务联通验证；因此模型与飞书记录标明本轮实测，SAP 记录明确区分最近验证和本轮重测。

## 5. 尚未开放与不能过度承诺的能力

- 外部 MCP 工具执行、STDIO MCP 和 MCP Server 模式。
- 产品运行时子 Agent。
- 任意 Skill/Plugin 脚本和第三方 UI 执行。
- 飞书云端文档/白板自动创建或发布。
- 未经当前环境真实联通复测的外部 SAP、模型渠道和 MCP Server。
- MCP Bearer/OAuth 配置、checkpoint 查看/重建界面、按模型自适应上下文窗口和交互式工具审批。
- Windows 公开分发所需的组织代码签名；本地安装和便携版构建不等于受信任签名发行。

## 6. 发布判断规则

只有在完整回归、构建、安全预检、桌面 UAT 都通过，且外部连接能力按目标环境分别完成真实复测后，才能称为“可供目标用户试用”。任何外部系统尚未实测时，应明确写为“代码路径和模拟探针已通过，真实连接待验证”，不能笼统宣称全部功能可正式上线。
