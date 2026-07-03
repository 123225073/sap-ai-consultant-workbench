# Phase 18 Composer Model Selector Adversarial Review

## Decision

Phase 18 implements the bottom composer model selector before the knowledge publish gate.

Multi-agent review was split:

- product review favored the knowledge confirmation gate because it closes a stronger MVP knowledge-loop gap;
- security review favored the model selector because it is a lower-risk UI/control-plane feature and does not require relaxing the Phase 16 imported-knowledge publish block;
- code exploration confirmed the current composer only auto-selects the first eligible model and has no real selector.

The final Phase 18 choice is the model selector. The knowledge confirmation gate remains a separate future phase because it must include second review, conflict handling, sensitive-content recheck, and audit records before Phase 16 local-text candidates can be formally published.

## Threat Model

Attacker or accidental user input attempts to:

- select an unverified, disabled, fake, or cross-project model;
- exploit same model id across two providers to call the wrong provider;
- inject a URL, token, secret marker, or long payload into `providerId` or `modelId`;
- force the renderer to fetch models or read API keys;
- add a generic model IPC such as `list-models`, `chat-completions`, or `get-api-key`;
- trigger SAP read/write or Feishu publish while only changing the selected model.

## Controls Added

- Renderer groups model choices from existing `ProjectConfig.apiProviders`; it does not fetch model lists.
- Composer sends a `providerId` plus `modelId` hint through existing `workbench:append-message`.
- `parseCaseWorkflowInput` sanitizes the optional `providerId` and existing `modelId`.
- Malformed structured provider/model hints set an internal rejection flag, so they cannot fall through to the default model.
- Provider verification records `lastVerifiedModelId`, the single model that completed the minimum chat test.
- `WorkspaceStore.prepareSafeModelDraftRequest` rebuilds the eligible provider list in the main process.
- If `providerId` is supplied, the selected provider and model must match exactly.
- The selected model must match the provider's `lastVerifiedModelId`; other listed models are not executable until separately verified in a later phase.
- Invalid, disabled, fake-without-probe-flag, unverified, or cross-provider choices return `null` and fall back to the local workflow without resolving API keys.
- Security preflight keeps the dangerous IPC scan and now checks Phase 18 markers.

## Explicit Non-Goals

- No new model-list IPC.
- No renderer-side API call.
- No API key, secretRef, Authorization, or bearer token exposure.
- No SAP write, SQL, Data Preview, activation, or transport.
- No Feishu auth, sync, create, update, publish, or device-code flow.
- No knowledge publish behavior changes.

## Verification Evidence

Fresh verification must include:

- `npm run check`
- `node scripts\phase11-safe-model-case-execution-probe.mjs`
- `node scripts\phase12-sap-readonly-evidence-probe.mjs`
- `node scripts\phase13-real-adt-readonly-evidence-probe.mjs`
- `node scripts\phase14-feishu-safe-handoff-probe.mjs`
- `node scripts\phase15-real-project-case-lifecycle-probe.mjs`
- `node scripts\phase16-document-ingestion-firewall-probe.mjs`
- `node scripts\phase17-renderer-trust-filetree-probe.mjs`
- `node scripts\phase18-composer-model-selector-probe.mjs`
- `npm run build`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`
- `git diff --check`

## Residual Risk

- The selector still depends on the existing configuration center to populate provider/model records.
- Phase 18 only allows the single minimum-chat-tested model per provider; per-model verification can broaden this later.
- Knowledge confirmation remains incomplete by design and should be handled in the next phase with its own adversarial review.
