# 架构决策记录（ADR）

这个目录用于保存后续长期有效的 ADR，也就是 Architecture Decision Records（架构决策记录）。

已有架构资料仍保留在 `docs/architecture/`：

- `docs/architecture/FIRST_PRINCIPLES_STRATEGY.md`
- `docs/architecture/ADVERSARIAL_AUDIT_MATRIX.md`
- `docs/architecture/MULTI_AGENT_EXECUTION_MODEL.md`
- `docs/architecture/FEATURE_ADVERSARIAL_REVIEW_TEMPLATE.md`
- `docs/architecture/reviews/`

当前长期决策：

- `0001-project-owns-sap-landscape.md`：Project 管理完整 SAP landscape。
- `0002-independent-agent-runtime.md`：核心 AI 运行时独立于 Codex。

不要把这些文件重复复制到这里。只有当某个决策需要长期约束后续开发，而不是只服务某一个 phase 或 feature branch 时，才新增 ADR。

建议命名：

```text
0001-short-decision-title.md
```

建议结构：

```markdown
# ADR-0001: Short Decision Title

## 状态

Accepted

## 背景

说明是什么问题或取舍迫使我们做这个决策。

## 决策

说明后续 Agent 和开发工作必须遵守的决策。

## 影响

说明这个决策带来什么好处、限制或成本。
```
