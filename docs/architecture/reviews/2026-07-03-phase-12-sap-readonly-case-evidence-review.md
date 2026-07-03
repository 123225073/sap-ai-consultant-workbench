# Phase 12 SAP Read-Only Case Evidence Adversarial Review

## Scope

| Item | Result |
|---|---|
| Feature | Attach one explicit SAP object as current-case read-only evidence |
| Branch | `codex/phase-12-sap-readonly-case-evidence` |
| Plan | `docs/superpowers/plans/2026-07-03-phase-12-sap-readonly-case-evidence-plan.md` |
| Status | Conditional pass for guarded demo evidence; real ADT object evidence remains deferred |

Phase 12 adds the narrowest evidence path after safe model drafts: the renderer sends an object type and object name, main validates and gates the request, and the store writes sanitized evidence files to the case.

## Adversarial Findings

| Reviewer | Severity | Finding | Decision |
|---|---:|---|---|
| Security/Architecture Agent | P1 | Real ADT evidence appeared allowed by `lastVerificationMode === "adt"` but the current connector factory still returns only the fake connector. | Fixed by making the real ADT path explicitly blocked in this phase with a clear error. |
| Security/Architecture Agent | P1 | Slow evidence reads could write to whatever case is active at completion time. | Fixed by capturing project and case at request start and passing that target to `appendSapObjectEvidence()`. |
| Security/Architecture Agent | P2 | Repeating evidence for the same object could overwrite earlier files. | Fixed by adding read timestamp and digest to generated evidence filenames. Probe covers this. |
| Security/Architecture Agent | P2 | Evidence text filters may reject normal ABAP code containing `SELECT`, `CALL FUNCTION`, or write-like statements. | Accepted residual risk. This phase prefers false positives over storing executable-looking SAP source until the real ADT evidence shape is designed. |
| Product/UX Review | P2 | Entry should stay inside the active case workflow, not become a dashboard. | Accepted. Added a compact evidence bar above the composer. |
| Product/UX Review | P2 | User must see system, client, read-only status, and not confuse demo/fake with real SAP. | Accepted. The bar shows alias, client, read-only state, and verification mode; fake evidence is gated outside normal use. |

## Accepted Boundaries

| Boundary | Evidence |
|---|---|
| One narrow SAP IPC | `workbench:read-sap-object-evidence` only. |
| Renderer cannot send passwords, SQL, URLs, file paths, or command text | Bridge accepts `SapObjectEvidenceRequest`; parser rejects extra request fields. |
| Fake evidence cannot be mistaken for normal production behavior | Requires `WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE=1`, fake verification mode, and demo SAP host. |
| Real SAP writes remain impossible | Connector has no write, activate, transport, delete, or SQL method. Security preflight scans for write-like markers. |
| Evidence is stored locally in case files | Generated files are restricted to `evidence/`, `snapshots/`, `outputs/`, and `technical/`. |
| Model/search boundary remains narrow | Full evidence/snapshot/technical files are excluded; only `outputs/` safe summaries are searchable and passed into safe model context. |

## Verification Evidence

Latest local commands:

```text
npm run check
PASS: TypeScript noEmit completed.

node scripts\phase11-safe-model-case-execution-probe.mjs
PASS: contextAllowlist, safeSummaryOnly, fakeSafeDraft, metadataLastModelId, noGenericIpc.

node scripts\phase12-sap-readonly-evidence-probe.mjs
PASS: validObjectRequest, invalidObjectTypeBlocked, wildcardBlocked, sqlObjectNameBlocked,
pathTraversalBlocked, extraRequestFieldBlocked, unsafeEvidenceTextBlocked,
fakeEvidenceRequiresFlag, fakeEvidenceRunsWithFlag, evidenceFilesInAllowedDirs,
repeatEvidenceDoesNotOverwrite, metadataNoRawSecret, safeSummaryIndexedOnly,
modelContextExcludesEvidence, noGenericSapIpc, noWriteMarkers.

npm run build
PASS: main, preload, and renderer production build completed.

powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
PASS: Security preflight passed.

git diff --check
PASS: no whitespace errors.
```

## Residual Risks

| Risk | Reason |
|---|---|
| Real ADT object content is not implemented | This phase intentionally keeps real SAP object reads blocked until the connector contract and ADT endpoint mapping are designed. |
| ABAP source false positives | The sanitizer may reject code-like content that is harmless as evidence, because Phase 12 does not yet distinguish read-only source snapshots from executable operations. |
| No visual screenshot audit | The UI change is compact and TypeScript/build verified, but no browser screenshot comparison was captured in this phase. |

## Decision

Phase 12 is acceptable to commit as a guarded local/demo evidence foundation. It improves the case evidence flow without adding generic SAP access, write operations, SQL execution, credential exposure, or full evidence ingestion into model context.
