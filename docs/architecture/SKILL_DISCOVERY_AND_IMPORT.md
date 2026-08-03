# 本机 Skills 发现与导入

## 结论

工作台使用与 Codex、Claude Code 兼容的 `SKILL.md` 目录格式，但不直接依赖 Codex CLI 或 Claude Code。Skill 是可复用的工作说明、参考资料和可选脚本；它本身不是 SAP 连接器，也不会自动获得 SAP、文件、网络或命令执行权限。

工作台维护三类位置：

- 应用内置库：随安装包提供的高频 SAP 顾问 Skills，启动时自动同步到已安装库；首次默认停用，只有用户明确启用后才生效；升级时保留用户明确选择，可停用但不可移除。
- 已安装库：由应用工作区维护，用户通过能力中心启停，renderer 不接触真实路径。
- 用户收件箱：`~/.sap-ai-workbench/skills`，用户可把待导入 Skill 文件夹放在这里，再从能力中心扫描。

## 兼容扫描目录

“发现本机 Skills”只扫描固定白名单：

| 来源 | 目录 |
| --- | --- |
| Codex 通用目录 | `~/.agents/skills` |
| Codex 兼容目录 | `~/.codex/skills` |
| Claude Code | `~/.claude/skills` |
| Skills Manager | `~/.skills-manager`（扫描其中的 Skills 子目录） |
| 工作台收件箱 | `~/.sap-ai-workbench/skills` |

扫描最多深入 4 层，用于兼容一个仓库内包含多个 Skills 的情况。发现结果只返回临时 ID、名称、说明、来源和相对路径，不把绝对路径暴露给 renderer。导入会重新校验临时会话和目录状态。

## 运行逻辑

```mermaid
flowchart LR
  Z["应用随附内置 Skills"] --> J["启动时安全同步"]
  J --> G["工作台已安装库"]
  A["固定白名单目录"] --> B["main process 受控扫描"]
  B --> C["解析 SKILL.md 元数据"]
  C --> D["来源、格式、重复项诊断"]
  D --> E["用户勾选并确认"]
  E --> F["完整包安全预检"]
  F --> G["复制到工作台已安装库"]
  G --> H["导入 Skill 与内置 Skill 均由用户手动启用"]
  H --> I["按需进入新回合上下文"]
```

当前采用渐进加载：列表和匹配阶段只需要名称、说明和路径；Skill 被启用并命中任务后，Context Engine 才加载正文和允许读取的文本资源。这样能控制上下文长度，也避免把所有 Skill 内容一次性塞给模型。

内置 Skill 可在 frontmatter `metadata` 中声明 `workstream`、`stage` 和中文 `title`。能力中心使用它们按“SAP 运维 / SAP 实施 / 通用与用户 Skills”分组并显示生命周期阶段；这些字段只改善信息架构，不改变 Skill ID、权限或触发规则。当前只内置 SAP 运维工作域，实施工作域预留但不填充。

## 安全边界

- 跳过符号链接，防止从白名单目录跳转到任意路径。
- 跳过 `.git`、`node_modules`、缓存、虚拟环境和构建目录。
- 限制目录数量、深度、Skill 数量和 `SKILL.md` 大小。
- YAML、名称、说明、资源路径和包体积仍经过现有 SkillPackage 安全预检。
- 同一安装范围内不允许重名；批量选择中也不允许同名来源同时导入。
- 导入脚本只登记为“存在但禁用”，不会执行。
- Skill 不会给模型新增 SAP 权限。SAP 数据读取仍必须由产品内置的 ADT 只读工具或后续经过审批的工具绑定完成。

## 与 Skills Manager 的取舍

参考 `xingkongliang/skills-manager` 的中央库与多工具目录发现思路，但稳定版只吸收“固定目录发现、来源显示、去重、批量导入”四项。暂不实现市场、Git 同步、双向文件同步、自动覆盖、预设和任意 Agent 配置写入，避免把个人 SAP 工作台变成复杂的通用 Skill 管理器。
