# Phase 27 Core Config Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing configuration center into a simpler first-use setup wizard for ADT, model provider, and Feishu CLI without changing backend capability.

**Architecture:** Keep all storage, IPC, connector, and secret behavior unchanged. Refactor only the renderer layout and styling, then add a static probe and preflight markers to lock the safety boundary.

**Tech Stack:** Electron, React, TypeScript, local project config, Electron secure secret storage, narrow preload IPC, PowerShell security preflight.

---

## Task 1: Document And Freeze Scope

**Files:**
- Create: `docs/superpowers/specs/2026-07-04-phase-27-core-config-wizard-design.md`
- Create: `docs/superpowers/plans/2026-07-04-phase-27-core-config-wizard-plan.md`
- Create: `docs/architecture/reviews/2026-07-04-phase-27-core-config-wizard-review.md`

- [ ] Write the design spec with visible fields, folded fields, safety boundaries, and acceptance criteria.
- [ ] Write this implementation plan.
- [ ] Add the review file with initial adversarial risks and verification checklist.
- [ ] Confirm there are no placeholders such as TBD, TODO, or future-only scope.

## Task 2: Refactor ConfigCenter Layout

**Files:**
- Modify: `apps/desktop/src/renderer/ConfigCenter.tsx`

- [ ] Add compact summary helpers for ADT, Feishu, and model status.
- [ ] Replace the large flat sections with setup cards for SAP / ADT, AI model, and Feishu CLI.
- [ ] Move ADT language and SSL into `details` advanced settings.
- [ ] Move verification reports into folded `details` blocks.
- [ ] Move Codex and local storage to an advanced config block.
- [ ] Keep save and verify functions wired to the existing callbacks only.
- [ ] Keep passwords and API keys in local component state only until `onSaveSecret`.

## Task 3: Add Wizard Styles

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] Add styles for setup cards, compact summaries, advanced details, and folded verification blocks.
- [ ] Preserve existing application layout and responsive behavior.
- [ ] Keep card radius at or below the existing product style.
- [ ] Avoid adding decorative gradients, marketing-style hero blocks, or nested card clutter.

## Task 4: Add Phase 27 Probe

**Files:**
- Create: `scripts/phase27-core-config-wizard-probe.mjs`

- [ ] Assert the renderer uses Phase 27 wizard markers.
- [ ] Assert no new IPC channel is added.
- [ ] Assert dangerous secret IPC names are absent.
- [ ] Assert SAP write, transport, activation, and SQL markers are absent from the changed renderer path.
- [ ] Assert Feishu publish/auth markers are absent.
- [ ] Assert model verification gates remain referenced by existing code.

## Task 5: Update Security Preflight

**Files:**
- Modify: `scripts/security-preflight.ps1`

- [ ] Add a Phase 27 marker section.
- [ ] Require the new probe script marker.
- [ ] Require setup card, advanced details, compact verification, and no-new-IPC markers.
- [ ] Add forbidden scans for SAP write, Feishu publish/auth, generic secret IPC, and command execution in the Phase 27 source set.

## Task 6: Verify And Review

**Commands:**

```powershell
npm run check
node scripts\phase27-core-config-wizard-probe.mjs
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
node scripts\phase14-feishu-safe-handoff-probe.mjs
node scripts\phase18-composer-model-selector-probe.mjs
node scripts\phase26-project-visible-list-removal-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [ ] Record observed results in the Phase 27 review doc.
- [ ] Run UX and security adversarial review.
- [ ] Start or verify the Electron app so the user can test the current screen.
