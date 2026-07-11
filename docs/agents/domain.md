# 领域上下文文档（Domain Docs）

这是 single-context repo。工程技能应该先读取一个根上下文文件，再结合已有产品和架构文档理解项目。

## 开始探索前先读

1. `CONTEXT.md`
2. `README.md`
3. `docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md`
4. `docs/product-prototype/TECHNICAL_IMPLEMENTATION.md`
5. `docs/architecture/` 下相关架构文件
6. 和当前任务相关的 phase spec、plan、review：
   - `docs/superpowers/specs/`
   - `docs/superpowers/plans/`
   - `docs/architecture/reviews/`

不要假设旧 plan 描述的是当前状态。必须用源码、Git history 和现有 probe 验证。

## 文件结构

```text
/
├── CONTEXT.md
├── docs/
│   ├── product-prototype/
│   ├── architecture/
│   ├── architecture/reviews/
│   ├── superpowers/plans/
│   ├── superpowers/specs/
│   ├── agents/
│   └── adr/
└── apps/desktop/
```

## 使用项目自己的词汇

使用 `CONTEXT.md` 中定义的词汇：Project、Case、Case folder、Daily chat、Task mode、Current case files、Evidence、Snapshot、Candidate knowledge、Published knowledge、Standards、Safe model context、Feishu handoff。

除非用户正在明确重设计领域模型，否则不要发明替代名称。

## ADR 和架构决策

未来长期 Architecture Decision Records 放在 `docs/adr/`。已有长期架构规则在 `docs/architecture/`，历史功能级决策在 `docs/architecture/reviews/`。

如果新工作会违背已有产品规则、架构原则或 adversarial review，必须先把冲突说清楚，再改行为。
