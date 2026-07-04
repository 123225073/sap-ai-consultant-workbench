# Phase 24 Case Knowledge Candidate Projection Review

Date: 2026-07-04

## Scope

Phase 24 improves the MVP case-to-knowledge loop:

```text
case output -> knowledge_candidates file -> pending knowledge item -> human review -> publish -> reusable case context
```

## Implemented Boundary

- Problem-analysis mode now writes a more reviewable `knowledge_candidates/问题处理经验候选.md`.
- The project knowledge item now receives a safe in-memory projection from the generated candidate file.
- Case-generated candidates remain `pending`, unreviewed, unpublished, and use `confidence: null`.
- Re-generating the same case candidate refreshes the existing pending item instead of duplicating it.
- Case-generated candidates must now pass the human review gate before publish.
- Reviewed and published case-generated knowledge can be attached back to the current case context.
- No new IPC, SAP read/write, Feishu publish/auth/sync, model-context expansion, arbitrary file read, or network capability was added.

## Adversarial Review

### Security / Boundary Review

Result: no Critical or Important issues.

The reviewer confirmed:

- No raw user body, SAP source, table detail, secret, token, Feishu auth artifact, or raw model response is written into the projected knowledge item.
- No arbitrary disk read, SAP write, Feishu publish, network request, IPC, review bypass, or auto-publish path was introduced.
- Candidate refresh clears review metadata and keeps the item pending.

### Product / MVP Review

Initial result: Critical issue found.

Finding:

- Case-generated candidates became pending knowledge, but they were not included in the human-review-required publish gate. A manually published case candidate could not satisfy the existing reusable-knowledge requirement because `createCaseKnowledgeReference` requires a complete review record and intact review hash.

Fix:

- Added `isCaseGeneratedKnowledgeCandidate`.
- Included case-generated candidates in `requiresHumanReviewBeforePublish`.
- Synced the Knowledge Center UI review-gate predicate with the main-process rule.
- Extended the Phase 24 probe to prove direct publish is blocked before review, then human review + publish + attach closes the loop.
- Changed projected case-candidate `confidence` to `null`; the UI now labels pending null-confidence candidates as requiring human judgment.

Follow-up product review:

- The reviewer confirmed the Critical issue is resolved.
- No new Critical or Important issues were found.
- Residual risk is low: candidate identity depends on source metadata, but the current edit/publish interfaces do not expose source metadata mutation.

## Verification

Focused verification after the initial implementation:

```powershell
npm run check
node scripts\phase24-case-knowledge-candidate-projection-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Additional knowledge regression after the product Critical fix:

```powershell
npm run check
node scripts\phase24-case-knowledge-candidate-projection-probe.mjs
node scripts\phase19-knowledge-review-gate-probe.mjs
node scripts\phase22-published-knowledge-case-context-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
```

Observed result: all commands listed above passed after the Critical fix.
