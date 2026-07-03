# Phase 19 Knowledge Review Gate Adversarial Review

## Decision

Phase 19 adds a controlled human review gate for Phase 16 imported local-text knowledge candidates.

The decision from multi-agent review was consistent:

- product review: do not simply enable the existing publish button; add a visible review gate in the existing Knowledge Center detail panel;
- security review: keep direct publish blocked until the main process verifies review evidence and rechecks content at publish time;
- code exploration: add a narrow review action and keep `publishKnowledgeItem` as the final gate.

## Threat Model

Attacker or accidental user input attempts to:

- publish an imported local-text candidate without a review record;
- submit a vague review note or incomplete checklist;
- add secrets, Feishu tokens, SAP sessions, ABAP source, SAP write snippets, or business table dumps after import;
- review one version of a candidate, then mutate local state before publishing;
- use renderer changes or IPC calls to bypass disabled buttons;
- turn the review path into file upload, path read, Feishu publish, SAP write, generic network, or generic command execution.

## Controls Added

- Imported local-text candidates still start as `pending`, with no review record.
- `workbench:knowledge-review-for-publish` accepts only `itemId`, a non-empty review note, and a four-item checklist.
- The review checklist requires source/scope confirmation, no secrets, no SAP source/write snippets, and no customer detail data.
- Review is limited to Phase 16 imported local-text candidates in `pending` status.
- Conflicted, expired, published, or conflict-linked items cannot be reviewed for publish.
- Review time re-runs sensitive-content checks.
- Review stores `reviewedAt`, `reviewer`, `reviewNote`, `reviewChecklist`, and `reviewedContentHash`.
- Publish time re-runs sensitive-content checks and recomputes the reviewed content hash.
- If title, summary, content, SAP object tags, effective dates, or source path change after review, publish is rejected until a new review is recorded.
- Timeline records a `reviewed` event with the `phase19-knowledge-review-gate` marker.
- Project knowledge JSON/Markdown and search index are refreshed after review and publish.
- Security preflight whitelists only the single new review IPC and scans review blocks for forbidden file, network, command, Feishu, and delete capabilities.

## Explicit Non-Goals

- No file picker, drag/drop upload, arbitrary path read, Word/PDF/Excel parsing, or generic document ingestion.
- No Feishu auth, sync, create, update, publish, device code, or URL opening.
- No SAP write, SQL/Data Preview expansion, activation, transport, or generic SAP browser.
- No automatic knowledge publish.
- No delete or history removal.
- No copying from the old SAP ABAP workspace.

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
- `node scripts\phase19-knowledge-review-gate-probe.mjs`
- `npm run build`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`
- `git diff --check`

## Residual Risk

- Reviewer identity is still the local MVP placeholder `演示用户`; real user identity can be added when the personal profile system is expanded.
- This phase does not implement full edit-before-publish. It only protects imported local-text candidates with review and tamper checks.
- Conflict resolution remains conservative: conflicted items stay blocked rather than editable/mergeable in this phase.
