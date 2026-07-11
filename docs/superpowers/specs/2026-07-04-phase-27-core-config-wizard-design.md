# Phase 27 Core Config Wizard Design

Date: 2026-07-04

## Goal

Make the configuration center usable as the first real setup block for SAP AI Workbench. The user should only see the fields they must fill, then save and test. Fixed defaults, safety explanations, and diagnostic details move behind advanced or details sections.

## Product Decision

The current config center behaves like an engineering diagnostics page. Phase 27 changes it into a setup surface:

```text
fill required fields -> save safely -> run verification -> see a plain result
```

This phase is a UI simplification and guardrail phase. It does not add new SAP, Feishu, model, file, or IPC capability.

## Required Visible Fields

### SAP / ADT

- System display name
- SAP URL
- Client
- Username
- SAP password entry
- Save settings
- Save password
- Test read-only connection

Language defaults to `ZH`, SSL defaults to strict validation, write mode remains locked read-only, and the T000/ADT diagnostic details are folded.

### AI Model

- Provider name
- Base URL
- API Key entry
- Provider enable toggle
- Save settings
- Save API Key
- Test model connection

Provider type, model count, selected verified model, model list details, and chat-test details are folded into advanced or verification details.

### Feishu CLI

- CLI path
- Profile
- Save settings
- Test CLI

Auth status, document permission status, CLI command details, and safe handoff boundaries are folded. This phase does not create, update, publish, or authorize Feishu documents.

## Hidden Or Folded Details

- Project overview fields move to a compact summary.
- ADT write mode remains visible only as a short read-only badge and detailed text.
- ADT connection status, T000 status, last checked time, credential saved time, and full report move to `验证详情`.
- Feishu auth status, document permission status, last checked time, and report move to `验证详情`.
- Model list status, chat status, model count, last checked time, credential saved time, and list preview move to `验证详情`.
- Codex and local storage sections move to `高级配置`.
- Existing safety text moves into folded `安全说明`.

## UX Copy

Primary actions use user-facing language:

- `保存配置`
- `保存密码`
- `保存 API Key`
- `测试只读连接`
- `测试模型连接`
- `测试飞书 CLI`

Avoid exposing internal wording as primary labels:

- `保存非密钥草稿`
- `执行只读验证`
- `T000 最小读取`
- `ADT status`
- `密钥保存时间`

Those terms may still appear inside detailed verification output.

## Safety Boundaries

- SAP remains read-only.
- No SAP write, activation, transport creation, transport release, or SQL execution.
- Secrets only go through `saveProjectSecret`; `saveProjectConfig` must not receive password or API key values.
- Renderer must not receive `secretRef`.
- No new IPC channels are introduced.
- Feishu stays local/CLI verification only; no auth flow and no document publish.
- Model providers still need real HTTP model-list and minimal chat verification before case use.
- The phase must not change main-process connector behavior.

## Files

Modify:

- `apps/desktop/src/renderer/ConfigCenter.tsx`
- `apps/desktop/src/renderer/styles.css`
- `scripts/security-preflight.ps1`

Create:

- `scripts/phase27-core-config-wizard-probe.mjs`
- `docs/superpowers/plans/2026-07-04-phase-27-core-config-wizard-plan.md`
- `docs/architecture/reviews/2026-07-04-phase-27-core-config-wizard-review.md`

## Acceptance Criteria

- Configuration center presents SAP, AI model, and Feishu as compact setup cards.
- Main view shows required inputs and a compact status summary.
- Technical status fields are hidden behind details/advanced sections.
- Existing save and verify functions are reused.
- No new IPC channel is added.
- No secret is saved through normal project config.
- Phase 27 probe passes.
- Existing Phase 11, 13, 14, 18, 26 probes still pass.
- `npm run check`, `npm run build`, `security-preflight.ps1`, and `git diff --check` pass.
