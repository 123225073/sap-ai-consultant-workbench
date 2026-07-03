# Phase 12 SAP Read-Only Case Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow current-case SAP read-only evidence path so a user can attach one explicitly selected SAP object as traceable case evidence without exposing write operations, arbitrary SQL, secrets, raw connector output, or full evidence content to model context.

**Architecture:** The renderer sends only a structured object type and object name through one narrow IPC. The Electron main process revalidates the active project, resolves the ADT secret only in main, enforces verified read-only eligibility, calls a fixed allowlisted connector method, and asks `WorkspaceStore` to write sanitized evidence files into the active case. Phase 12 supports only guarded fake/demo evidence for probes until a real ADT connector mode exists; real SAP evidence is blocked unless a future connector returns a real read-only verification mode.

**Tech Stack:** Electron main process, React + TypeScript renderer, existing workspace store and case filesystem, ADT read-only connector abstraction, PowerShell security preflight, Node runtime probe.

---

## 1. First-Principles Decision

The product is only meaningfully better than a generic AI chat tool when case conclusions can point to SAP evidence. Phase 11 made model drafting safe, but case outputs still say real SAP was not read. Phase 12 should therefore add the smallest possible evidence path before Feishu publishing, broad knowledge import, packaging, or final acceptance.

The phase must not become an SAP browser. It must handle only one explicit object at a time, in the active project and active case, with fixed object-type methods and no arbitrary command, URL, file, SQL, package, namespace, wildcard, batch, activation, transport, or delete path.

## 2. Scope Contract

Allowed:

- Object types: `program`, `class`, `function`, `include`, `table`, `structure`.
- Object name: one uppercase SAP-style identifier, slash namespace allowed, length capped.
- Current active project and current active case only.
- Evidence output under `evidence/`.
- Snapshot output under `snapshots/` only for object-like source evidence.
- Safe short summary output under `outputs/`.
- Metadata: project id, case id, system alias, endpoint host, client, object type, object name, read time, source mode, content length, digest, generated file paths.

Forbidden:

- Any SQL or OpenSQL runner.
- Table row data extraction.
- Package, namespace, wildcard, batch, or search-all reads.
- SAP write, activate, transport, release, delete, update, insert, modify, submit, or transaction calls.
- Raw connector stdout, stderr, headers, cookies, CSRF tokens, SAP session values, passwords, secure-store refs, or raw errors in files/UI/model context.
- Indexing or model-ingesting `evidence/`, `snapshots/`, `technical/`, internal JSON, or full object content.
- Treating fake ADT verification as real SAP evidence.

## 3. File Structure

- Create: `apps/desktop/src/main/sapObjectEvidenceService.ts`
  - Parse and validate structured evidence requests.
  - Sanitize connector evidence.
  - Render current-case evidence, snapshot, and safe summary files.
  - Provide hard markers for probes and security preflight.
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
  - Add SAP evidence request/result types and ADT verification mode tracking.
- Modify: `apps/desktop/src/main/adtReadonlyConnector.ts`
  - Extend the read-only connector interface with a fixed `readObjectEvidence()` method.
  - Keep fake/demo object reads behind an explicit local probe flag.
  - Do not add write-like or generic command methods.
- Modify: `apps/desktop/src/main/workspaceStore.ts`
  - Track ADT verification mode.
  - Gate evidence writes to the active project/case.
  - Write rendered evidence files through existing generated file path guards.
  - Refresh case files and search index.
- Modify: `apps/desktop/src/main/main.ts`
  - Add one narrow IPC handler.
  - Resolve ADT password only in main.
  - Block non-demo fake evidence unless `WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE=1`.
- Modify: `apps/desktop/src/preload/preload.ts`
  - Expose only `readSapObjectEvidence(input)`.
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
  - Type the narrow bridge method.
- Modify: `apps/desktop/src/renderer/App.tsx`
  - Add minimal object type/name controls near the composer.
  - Show active system/client/read-only context and user-readable errors.
- Modify: `apps/desktop/src/renderer/styles.css`
  - Add compact evidence controls without dashboard/card-heavy UI.
- Modify: `scripts/security-preflight.ps1`
  - Add Phase 12 markers and dangerous-pattern scans.
- Create: `scripts/phase12-sap-readonly-evidence-probe.mjs`
  - Probe parser, gating, fake/demo evidence, output file boundaries, model isolation, and IPC whitelist.
- Create: `docs/architecture/reviews/2026-07-03-phase-12-sap-readonly-case-evidence-review.md`
  - Record product/security agent findings, implementation decisions, verification evidence, and residual risk.

## 4. Task 1: Runtime Probe First

**Files:**
- Create: `scripts/phase12-sap-readonly-evidence-probe.mjs`

- [x] **Step 1: Bundle a temporary TypeScript probe entry with esbuild**

Run:

```powershell
node scripts\phase12-sap-readonly-evidence-probe.mjs
```

Expected before implementation: fails because `sapObjectEvidenceService.ts` does not exist.

- [x] **Step 2: Assert request validation**

Expected final markers:

```text
validObjectRequest=ok
invalidObjectTypeBlocked=ok
wildcardBlocked=ok
sqlObjectNameBlocked=ok
pathTraversalBlocked=ok
```

- [x] **Step 3: Assert execution gates and file boundaries**

Expected final markers:

```text
fakeEvidenceRequiresFlag=ok
fakeEvidenceRunsWithFlag=ok
evidenceFilesInAllowedDirs=ok
metadataNoRawSecret=ok
safeSummaryIndexedOnly=ok
```

- [x] **Step 4: Assert model and IPC boundaries**

Expected final markers:

```text
modelContextExcludesEvidence=ok
noGenericSapIpc=ok
noWriteMarkers=ok
```

## 5. Task 2: Add SAP Object Evidence Service

**Files:**
- Create: `apps/desktop/src/main/sapObjectEvidenceService.ts`

- [x] **Step 1: Define object type allowlist**

Marker:

```ts
export const SAP_OBJECT_EVIDENCE_ALLOWED_TYPES = [
  "program",
  "class",
  "function",
  "include",
  "table",
  "structure"
] as const;
```

- [x] **Step 2: Parse structured request**

The parser accepts exactly `objectType` and `objectName`, optionally `functionGroup` only when `objectType === "function"`.

- [x] **Step 3: Reject unsafe names**

Block empty values, wildcards, whitespace, path separators outside slash namespaces, `..`, URI schemes, SQL keywords, ABAP write-like words, package/batch markers, and control characters.

- [x] **Step 4: Sanitize evidence content**

Reject secrets, auth headers, SAP session markers, private keys, table-like row dumps, SQL statements, and write-like SAP verbs. Cap evidence body size.

- [x] **Step 5: Render files**

Generate:

```text
evidence/sap-object-evidence-<type>-<name>.md
snapshots/sap-object-snapshot-<type>-<name>.txt
outputs/sap-object-evidence-summary-<type>-<name>.md
```

The output summary is the only path eligible for search/model safe summaries.

## 6. Task 3: Extend ADT Read-Only Connector

**Files:**
- Modify: `apps/desktop/src/main/adtReadonlyConnector.ts`
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`

- [x] **Step 1: Add ADT verification mode type**

Extend ADT report/config mode to support `fake | adt`, while current implementation still returns `fake`.

- [x] **Step 2: Add fixed read method**

Add `readObjectEvidence(input, request)` to the connector interface. It must not accept arbitrary command strings, URLs, SQL, or paths.

- [x] **Step 3: Add fake/demo implementation**

Fake reads are deterministic and only run when main passes `allowFakeEvidence: true`. They return a small object body and metadata with `sourceMode: "fake"`.

- [x] **Step 4: Leave real SAP blocked**

Until a real ADT connector is implemented, non-fake evidence attempts fail with a clear user-facing message.

## 7. Task 4: Wire Main Process And Store

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`

- [x] **Step 1: Add narrow IPC**

Add `workbench:read-sap-object-evidence` only. Do not add generic SAP, command, SQL, file, or network IPC.

- [x] **Step 2: Main-process gate**

Require:

- active project exists
- ADT read-only config saved
- credential in secure store
- connection/minimal read verified
- `lastVerificationMode === "adt"` for real evidence, or explicit local fake flag plus demo host for fake evidence

- [x] **Step 3: Resolve secret only in main**

Use `SecureSecretStore.resolveProjectSecret()` only in `main.ts`; never expose secret refs or passwords to renderer/preload.

- [x] **Step 4: Write active-case evidence**

Use `WorkspaceStore.appendSapObjectEvidence()` to write generated files, update case summary, update metadata, refresh case tree/search, and return updated state plus generated file paths.

## 8. Task 5: Add Minimal UI

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`

- [x] **Step 1: Add compact controls**

Controls:

- object type select
- object name input
- one explicit action button: "补充 SAP 只读证据"

- [x] **Step 2: Show boundary copy**

Show current project/system/client/read-only status and a short note that this does not write SAP.

- [x] **Step 3: Show results**

After success, refresh the case file tree and show the generated evidence paths in the existing text flow/notice area. The right file panel remains the place to preview files.

## 9. Task 6: Security Preflight And Adversarial Review

**Files:**
- Modify: `scripts/security-preflight.ps1`
- Create: `docs/architecture/reviews/2026-07-03-phase-12-sap-readonly-case-evidence-review.md`

- [x] **Step 1: Add required markers**

Require:

- `SAP_OBJECT_EVIDENCE_ALLOWED_TYPES`
- `parseSapObjectEvidenceRequest`
- `assertSafeSapObjectEvidenceText`
- `renderSapObjectEvidenceFiles`
- `readObjectEvidence`
- `workbench:read-sap-object-evidence`
- `WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE`

- [x] **Step 2: Add dangerous scan**

Fail on generic SAP IPC names, SQL runners, object search-all names, `POST|PUT|PATCH|DELETE` in ADT connector, raw connector output fields, and write-like SAP operation markers.

- [x] **Step 3: Record adversarial review**

Document product and security agent findings, what was accepted, what was deferred, command evidence, and residual risks.

## 10. Verification

Run:

```powershell
npm run check
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase12-sap-readonly-evidence-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Before push, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1 -RequireClean
```

## 11. Exit Criteria

- One narrow SAP evidence IPC exists; no generic SAP/browser/SQL/command IPC exists.
- Renderer sends only object type/name, not command text, passwords, URLs, SQL, or file paths.
- Main process owns ADT secret resolution and evidence execution.
- Fake/demo evidence requires `WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE=1`.
- Real evidence remains blocked until a real ADT verification mode exists.
- Evidence files are written only to the active case under `evidence/`, `snapshots/`, and `outputs/`.
- Search/model safe summaries only see the safe `outputs/` summary, never full evidence/snapshot text.
- No SAP write, activate, transport, delete, arbitrary SQL, package/batch, or wildcard read path exists.
- Adversarial review exists and verification commands pass.
