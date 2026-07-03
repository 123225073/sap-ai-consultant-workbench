# Phase 13 Real ADT Read-Only Evidence Adversarial Review

## Scope

| Item | Result |
|---|---|
| Feature | Real ADT read-only evidence foundation |
| Branch | `codex/phase-13-real-adt-readonly-evidence` |
| Plan | `docs/superpowers/plans/2026-07-03-phase-13-real-adt-readonly-evidence-plan.md` |
| Status | Pass for mocked real ADT read-only foundation; live SAP use still depends on user configuration and SAP authorization |

Phase 13 replaces the Phase 12 demo-only evidence path with a real connector that reads one explicit SAP object through fixed ADT `GET` endpoints. It keeps the existing narrow IPC and case evidence storage model.

## Grounding

| Source | How It Was Used |
|---|---|
| Local `SAP ABAP` workflow | Reused the proven pattern of status-first checks, read-only default, config isolation, and no secret output. |
| Existing SAP Skills | Reused the command taxonomy and safety split: read commands are fixed, write/transport commands require gates and are excluded here. |
| `shrek-abaper/sap-engineering-skill` | Reused fixed ADT endpoint families and the read/write boundary; did not import its CLI as a command runner. |
| Phase 12 review | Addressed the residual blocker that real ADT object evidence was intentionally unavailable. |

## Adversarial Findings

| Reviewer | Severity | Finding | Decision |
|---|---:|---|---|
| SAP reuse explorer | P1 | Do not wire the old `sap_adt_cli.py` as a UI command runner; it would become an SAP browser. | Accepted. Phase 13 uses a small in-app fixed GET connector only. |
| SAP reuse explorer | P1 | Do not copy old SAP output, private connection references, `.sap-adt-cli`, or credentials. | Accepted. No old workspace data or config was copied. |
| Current repo explorer | P1 | Phase 13 must remove `allowRealEvidence = false`, but only after real ADT verification mode and T000 minimum read are verified. | Accepted. Real evidence requires `lastVerificationMode === "adt"` plus existing connection/minimal read checks. |
| Current repo explorer | P1 | Real ABAP source will contain `SELECT` or `CALL FUNCTION`; the Phase 12 sanitizer would reject it. | Accepted with a narrow exception: only `evidenceKind === "fixed-adt-readonly-source"` from real ADT may contain source-like text. |
| Current repo explorer | P1 | Do not add SQL, Data Preview, search-all, package browsing, transport, activation, or CSRF write flows. | Accepted. Preflight now scans the connector for forbidden endpoint families and write-like methods. |
| Product/UX review | P2 | Function module evidence needs a function group, but the UI only had object name. | Accepted. A function group field appears only for function evidence. |

## Accepted Boundaries

| Boundary | Evidence |
|---|---|
| One narrow IPC remains | `workbench:read-sap-object-evidence`; no new SAP IPC was added. |
| Fixed GET endpoints only | `adtReadonlyObjectEvidencePath()` maps object type/name to fixed ADT paths. |
| Password only in main process | `resolveProjectSecret()` remains limited to main/secure store. |
| Real connector does not return auth material | Phase 13 probe checks password and auth markers are not present in evidence results. |
| Fake evidence remains isolated | Main process chooses `FakeAdtReadonlyConnector` only when the existing demo flag and demo host conditions are true. |
| Full evidence remains restricted | Search/model paths still rely on safe `outputs/` summaries, not `evidence/`, `snapshots/`, or `technical/`. |

## Rejected Scope

| Rejected Item | Reason |
|---|---|
| `run-sql` / Data Preview | Even read-only SQL can expose real table rows. |
| `search-object`, `get-package`, where-used, transport listing | They expand scope from one explicit object into enumeration/batch workflows. |
| `POST`, `PUT`, `PATCH`, `DELETE`, CSRF token flow | They are not needed for read-only evidence and introduce SAP write risk. |
| Old workspace exports or private config files | They may contain customer data, SAP source, hostnames, accounts, or secrets. |

## Verification Evidence

Latest local commands:

```text
npm run check
PASS: TypeScript noEmit completed.

node scripts\phase13-real-adt-readonly-evidence-probe.mjs
PASS: fixedEndpointMapping, functionGroupRequired, realVerifyUsesFixedGetOnly,
basicAuthNotReturned, realConnectorUsesGetOnly, readOnlySourceAccepted,
genericUnsafeEvidenceStillBlocked, sourceAuthStillBlocked, noWriteMarkers.

node scripts\phase11-safe-model-case-execution-probe.mjs
PASS: safe model context and output guards.

node scripts\phase12-sap-readonly-evidence-probe.mjs
PASS: Phase 12 fake/demo evidence path and model/search isolation remain intact.

git diff --check
PASS: no whitespace errors.

npm run build
PASS: main, preload, and renderer production build completed.

powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
PASS: Security preflight passed.
```

## Residual Risks

| Risk | Reason |
|---|---|
| Live SAP connectivity is not exercised in automated tests | The probe uses a local mock ADT server to avoid touching real SAP during CI/local validation. |
| Real ABAP source can still be sensitive | It is stored only as restricted local case evidence and snapshot, not sent to model context by default. |
| Some older SAP HTTPS profiles may need certificate skip mode | The connector supports project-level `sslMode: "skip-certificate"` through a per-request agent, not a global TLS override. |
| Very large objects may hit the evidence size limit | This is intentional for the first real read-only foundation; broad source management is out of scope. |

## Decision

Phase 13 is acceptable as the real ADT read-only evidence foundation. It advances the product from demo evidence to fixed real ADT object reads while preserving the key safety boundaries: no SAP writes, no SQL, no generic SAP browser, no credential exposure, and no full evidence ingestion into model/search context.
