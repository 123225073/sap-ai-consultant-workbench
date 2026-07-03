# Phase 18 Composer Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bottom composer model status button into a real, safe model selector that chooses a verified provider/model pair for the next case message.

**Architecture:** Reuse the project config already present in renderer state; do not add model-list IPC, key-reading IPC, or network calls. The renderer sends a provider id plus model id as a hint, and the main process re-validates the selected provider/model against enabled, credential-backed, HTTP-verified model providers before any safe draft call.

**Tech Stack:** Electron, React, TypeScript, Node/esbuild probe scripts, PowerShell security preflight.

---

## Scope

Allowed in Phase 18:

- show the model selector only in the composer bottom area;
- group selectable models by API provider;
- search by provider name, model id, display name, and capability label;
- filter by capabilities: vision, reasoning, tools, web, free;
- display the current selected provider/model;
- show explicit disabled/error states for unverified, failed, fake, disabled, or empty providers;
- send only `providerId` and `modelId` as a selection hint through the existing `workbench:append-message` IPC;
- make the main process reject invalid provider/model hints and fall back to local workflow without resolving API keys.

Blocked in Phase 18:

- no new IPC for listing models, reading keys, chat completions, generic fetch, or safe model draft;
- no renderer-side API calls;
- no SAP write, SQL, transport, activation, Data Preview, or generic SAP browser;
- no Feishu auth, sync, create, update, publish, or device-code flow;
- no changes to knowledge publish semantics.

## File Structure

- Modify `apps/desktop/src/shared/workbenchTypes.ts`: add optional `providerId` to `CaseWorkflowInput`.
- Modify `apps/desktop/src/main/caseWorkflowService.ts`: parse and sanitize the optional provider hint.
- Modify `apps/desktop/src/main/workspaceStore.ts`: re-validate provider/model as an exact pair before model execution.
- Modify `apps/desktop/src/renderer/App.tsx`: add grouped model selector state, search, capability filters, current selection, and explicit fallback/error messaging.
- Modify `apps/desktop/src/renderer/styles.css`: style the compact composer popover without changing the three-column workbench structure.
- Create `scripts/phase18-composer-model-selector-probe.mjs`: prove provider/model exact matching, unsafe hint rejection, and no new dangerous IPC.
- Modify `scripts/security-preflight.ps1`: add Phase 18 markers and keep dangerous IPC checks intact.
- Create `docs/architecture/reviews/2026-07-04-phase-18-composer-model-selector-review.md`: adversarial review and verification evidence.

## Tasks

- [x] Add `providerId` to case workflow input and sanitize it in the shared workflow parser.
- [x] Make `prepareSafeModelDraftRequest` require an exact selected provider/model pair when `providerId` is supplied, and reject invalid model hints instead of silently calling a different model.
- [x] Build the composer model selector UI from existing project config only: provider groups, search, capability filters, current selection, fallback state, and failed-provider messages.
- [x] Add Phase 18 probe coverage for same-model-id cross-provider selection, invalid provider/model rejection, unsafe provider hints, and IPC boundary preservation.
- [x] Update security preflight and write the adversarial review.
- [x] Run full verification, then commit and push the Phase 18 branch.
