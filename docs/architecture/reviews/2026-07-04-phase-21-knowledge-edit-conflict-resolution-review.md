# Phase 21 Knowledge Candidate Edit And Conflict Resolution Review

## Scope

Phase 21 adds one narrow capability: unpublished knowledge candidates can be edited before final publish, including conflict recovery.

Allowed:

- Edit only `draft`, `pending`, and `conflicted` knowledge candidates.
- Save edited candidates back to `pending`.
- Clear prior review metadata after every edit.
- Clear conflict links after a conflict candidate is edited.
- Require a fresh human review before publish.
- Keep source history and timeline events.

Blocked:

- Editing `published` or `expired` knowledge.
- Moving `published` knowledge to conflict or expired status.
- Accepting state, review, publish, or source-path fields from edit input.
- Auto-publish, auto-merge, overwrite, or delete behavior.
- SAP write, activation, transport, SQL expansion, or live SAP mutation.
- Feishu auth, sync, publish, network, shell, external URL, or file-browser behavior.

## Adversarial Checks

| Attack | Required defense |
|---|---|
| Edit request includes `status`, `reviewer`, `reviewedAt`, `reviewedContentHash`, `reviewChecklist`, `publishedAt`, or `sourceFilePath` | Edit parser allowlist rejects unsupported fields. |
| Reviewed pending item is edited and then published without re-review | Edit transition clears review metadata and reviewed content hash, so publish rejects until re-review. |
| Conflict candidate is edited to bypass conflict handling | Edit clears `conflictWithIds`, returns to `pending`, and still requires review before publish. |
| Published item is marked conflicted, then edited as an unpublished candidate | Conflict transition rejects `published`; edit transition also rejects `published`. |
| Published item is expired through Phase 21 actions | Expire transition rejects `published` and repeated `expired` changes. |
| Renderer claims save succeeded after backend rejection | App callback returns `false` on failed backend response; Knowledge Center only switches to `pending` filter after success. |
| Edit path grows unsafe capabilities | Preflight scans edit parser, store, transition, and renderer blocks for file, network, shell, URL, Feishu, delete, publish, and published-state markers. |

## Review Findings And Fixes

Initial adversarial review found one Critical issue and two Important issues:

- Critical: `published` knowledge could be changed to `conflicted`, which then made it eligible for the new edit flow.
- Important: `published` knowledge could be expired even though Phase 21 treats published history as read-only.
- Important: the original probe/preflight did not prove the published-history bypass was closed.

Fixes applied:

- `markKnowledgeItemConflicted` now rejects `published` and `expired`.
- `expireKnowledgeItem` now rejects `published` and already `expired`.
- The renderer disables conflict and expire controls for `published` knowledge.
- The Phase 21 probe covers published conflict rejection, published expire rejection, forbidden edit fields, review invalidation, conflict recovery, and re-review before publish.
- Security preflight now scans backend transitions and requires both published guards in renderer action controls.

First re-review result:

- Critical: none.
- Important: none.
- Minor: one weak renderer preflight assertion was strengthened by requiring two explicit `selectedItem.status === "published"` guards.

Second adversarial review found one Critical issue:

- Critical: non-import candidates edited by Phase 21 could still publish without re-review, because the publish gate only required review for local text import candidates.
- Important: the Phase 21 probe and security preflight did not cover that non-import edit path.

Second-review fixes applied:

- Added a unified `requiresHumanReviewBeforePublish` backend gate covering both local text imports and Phase 21 edited candidates.
- `reviewKnowledgeItemForPublish` now accepts Phase 21 edited candidates, not only local text import candidates.
- `publishKnowledgeItem` now blocks any Phase 21 edited candidate until a human review record and matching reviewed content hash exist.
- Knowledge Center now shows the review gate and disables publish for Phase 21 edited non-import candidates.
- The Phase 21 probe now proves a normal case-candidate cannot publish directly after edit and can publish only after re-review.
- Security preflight now checks the publish transition for review, review-record, and content-hash guards.

Final re-review status:

- Critical: none.
- Important: none.
- Minor: none.
- Final reviewer confirmed the non-import edited-candidate bypass is closed: direct publish after edit is blocked, and publish succeeds only after re-review with a matching content hash.

## Verification Log

Final verification must be refreshed before commit:

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
- `node scripts\phase20-controlled-text-file-import-probe.mjs`
- `node scripts\phase21-knowledge-edit-conflict-resolution-probe.mjs`
- `npm run build`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`
- `git diff --check`

## Current Assessment

Phase 21 keeps the product loop narrow: edit unresolved knowledge candidates, force re-review, and preserve published history as read-only. No remaining Critical or Important findings are open from the final Phase 21 review cycle.
