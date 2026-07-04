# Phase 23 Referenced Knowledge Safe Model Context Review

Date: 2026-07-04

## Scope

Phase 23 connects the Phase 22 manual case knowledge reference flow to safe model draft context generation.

The intended chain is:

```text
case -> candidate knowledge -> human review -> publish -> manually attach to case -> safe model uses attached summary
```

## Implemented Boundary

- Safe model context now allows `knowledgeReferences` as an explicit allowlist field.
- `WorkspaceStore.prepareSafeModelDraftRequest` only passes the active case's existing `knowledgeReferences`.
- The model context includes only title, summary, source type, SAP object labels, published time, and attached time.
- The model context audit records `referencedKnowledgeCount`.
- No `KnowledgeItem.content`, `sourceFilePath`, case files, search results, SAP reads, Feishu publish actions, or new IPC channels were added.

## Adversarial Review

### Product / MVP Review

Result: no Critical or Important issues.

The reviewer confirmed the implementation matches the MVP chain and does not become automatic RAG, global search, cross-project reuse, or cloud publishing.

Remaining product risk:

- Future callers of `buildSafeModelDraftContext` must not bypass the current-case reference gate by injecting search results, global knowledge, or full knowledge bodies.

### Security / Boundary Review

Initial finding: Important.

Issue:

- A persisted knowledge item could be manually polluted to look `published` and reviewed by adding fake review fields. The previous reusable review check did not verify that `reviewedContentHash` still matched the current knowledge content.

Fix:

- `hasReusableReviewRecord` now requires both a complete human review record and `reviewedContentHash === knowledgeReviewContentHash(item)`.
- Phase 23 probe now includes a fake reviewed published item with a valid-length but incorrect review hash and asserts it cannot enter prepared safe model context.
- Security preflight now checks that reusable published knowledge depends on the review hash comparison.

Follow-up review:

- The security reviewer confirmed the forged-review-hash pollution path is closed.
- No new Critical or Important issues were found.

## Verification

Focused verification:

```powershell
npm run check
node scripts\phase23-referenced-knowledge-safe-model-context-probe.mjs
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase12-sap-readonly-evidence-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Regression verification:

```powershell
npm run check
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase12-sap-readonly-evidence-probe.mjs
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
node scripts\phase14-feishu-safe-handoff-probe.mjs
node scripts\phase15-real-project-case-lifecycle-probe.mjs
node scripts\phase16-document-ingestion-firewall-probe.mjs
node scripts\phase17-renderer-trust-filetree-probe.mjs
node scripts\phase18-composer-model-selector-probe.mjs
node scripts\phase19-knowledge-review-gate-probe.mjs
node scripts\phase20-controlled-text-file-import-probe.mjs
node scripts\phase21-knowledge-edit-conflict-resolution-probe.mjs
node scripts\phase22-published-knowledge-case-context-probe.mjs
node scripts\phase23-referenced-knowledge-safe-model-context-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Observed result: all commands above passed during Phase 23 implementation.
