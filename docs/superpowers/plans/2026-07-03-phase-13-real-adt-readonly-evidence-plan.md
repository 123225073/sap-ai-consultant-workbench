# Phase 13 Real ADT Read-Only Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 12 demo-only SAP object evidence path with a real ADT read-only foundation that reads one explicit object through fixed GET endpoints, stores sanitized local evidence, and keeps SAP write, SQL, transport, and generic browsing paths impossible.

**Architecture:** The renderer still sends only object type, object name, and optional function group. Main process verifies ADT read-only status, resolves the SAP password only in main, and calls a connector that maps allowed object types to fixed `/sap/bc/adt/...` GET paths derived from the local `sap-adt-cli` / `sap-engineering-skill` pattern. Real evidence can include ABAP-like source as restricted case evidence, but only the safe summary is searchable or available to model context.

**Tech Stack:** Electron main process, TypeScript, Node `http`/`https` GET client, existing secure secret store, existing case evidence renderer, PowerShell security preflight, Node runtime probe.

---

## 1. Grounding Sources

- User constraint: reuse the proven `D:\9005_IDEauthorized\Codex Project\SAP ABAP` workflow and SAP Skills instead of starting over.
- Local skill: `sap-adt-cli` uses `status` first, environment/config separation, read-only defaults, fixed object commands, and explicit write/transport gates.
- Current public reference: `shrek-abaper/sap-engineering-skill` at commit `edc76d54b6aae25bd282457fe6dfd8d3c7806ecd`.
- Phase 12 residual risk: real ADT object evidence is blocked, and the evidence sanitizer currently rejects normal ABAP source keywords such as `SELECT` or `CALL FUNCTION`.

## 2. Scope Contract

Allowed:

- One explicit active-case object evidence read.
- Fixed HTTP `GET` only.
- Fixed ADT endpoint families:
  - `program`: `/sap/bc/adt/programs/programs/{name}/source/main`
  - `class`: `/sap/bc/adt/oo/classes/{name}/source/main`
  - `include`: `/sap/bc/adt/programs/includes/{name}/source/main`
  - `function`: `/sap/bc/adt/functions/groups/{functionGroup}/fmodules/{name}/source/main`
  - `table`: `/sap/bc/adt/ddic/tables/{name}/source/main`
  - `structure`: `/sap/bc/adt/ddic/structures/{name}/source/main`
- Real connector verification through fixed `GET /sap/bc/adt/` and fixed `GET /sap/bc/adt/ddic/tables/T000/source/main`.
- Per-project SAP password only in main process memory.
- `sslMode: "skip-certificate"` implemented through a per-request HTTPS agent, not global TLS changes.
- ABAP-like source text accepted only when it came from the fixed real ADT GET connector.

Forbidden:

- Renderer-supplied SAP URL, path, query, SQL, file path, command, package, wildcard, namespace batch, or search-all request.
- `POST`, `PUT`, `PATCH`, `DELETE`, CSRF token fetch, lock/unlock, activation, transport, write-source, table row extraction, Data Preview, or Open SQL runner.
- Raw response headers, cookies, SAP sessions, CSRF values, password, secure-store refs, or raw connector output in UI/files/logs.
- Feeding `evidence/`, `snapshots/`, or full object source to model context or search indexes.

## 3. File Structure

- Modify: `apps/desktop/src/main/adtReadonlyConnector.ts`
  - Add `RealAdtReadonlyConnector`.
  - Add fixed endpoint mapping and bounded GET helper.
  - Keep fake connector available only for explicit local probes.
- Modify: `apps/desktop/src/main/main.ts`
  - Enable real evidence when `lastVerificationMode === "adt"`.
  - Select fake connector only for explicit demo evidence.
- Modify: `apps/desktop/src/main/sapObjectEvidenceService.ts`
  - Add a read-only source evidence policy so real ABAP source can be stored as restricted evidence without weakening secret/session/table-row filters.
- Modify: `apps/desktop/src/renderer/App.tsx`
  - Add an optional function group input for function module evidence.
  - Update Phase 13 copy without changing the overall Codex-style layout.
- Modify: `apps/desktop/src/preload/preload.ts`
  - Update app phase label.
- Modify: `scripts/security-preflight.ps1`
  - Add Phase 13 markers and allow ADT Basic Auth only inside the connector.
  - Continue blocking write-like ADT methods and generic SAP/SQL IPC names.
- Create: `scripts/phase13-real-adt-readonly-evidence-probe.mjs`
  - Use a local mock HTTP server to verify real connector behavior without calling SAP.
- Create: `docs/architecture/reviews/2026-07-03-phase-13-real-adt-readonly-evidence-review.md`
  - Record product/security review, decisions, verification evidence, and residual risks.

## 4. Task 1: Connector Mapping And Real GET Client

- [x] **Step 1: Add fixed endpoint mapping**

Required code shape in `adtReadonlyConnector.ts`:

```ts
export const ADT_READONLY_FIXED_GET_ENDPOINTS = "adt-readonly-fixed-get-endpoints";

export function adtReadonlyObjectEvidencePath(request: SapObjectEvidenceRequest): string {
  switch (request.objectType) {
    case "program":
      return `/sap/bc/adt/programs/programs/${encodeSapName(request.objectName)}/source/main`;
    case "class":
      return `/sap/bc/adt/oo/classes/${encodeSapName(request.objectName)}/source/main`;
    case "include":
      return `/sap/bc/adt/programs/includes/${encodeSapName(request.objectName)}/source/main`;
    case "function":
      if (!request.functionGroup) throw new Error("Function module evidence requires a function group.");
      return `/sap/bc/adt/functions/groups/${encodeSapName(request.functionGroup)}/fmodules/${encodeSapName(request.objectName)}/source/main`;
    case "table":
      return `/sap/bc/adt/ddic/tables/${encodeSapName(request.objectName)}/source/main`;
    case "structure":
      return `/sap/bc/adt/ddic/structures/${encodeSapName(request.objectName)}/source/main`;
  }
}
```

- [x] **Step 2: Add bounded GET helper**

Use Node `http`/`https` with:

```ts
const method = "GET";
headers["X-SAP-Client"] = input.client;
headers.Authorization = `Basic ${Buffer.from(`${input.username}:${input.password}`, "utf8").toString("base64")}`;
```

Do not store or return headers. Error messages must include only status code and endpoint path.

- [x] **Step 3: Add real verification**

`verify()` must call only:

```text
GET /sap/bc/adt/
GET /sap/bc/adt/ddic/tables/T000/source/main
```

Expected result when both pass:

```ts
mode: "adt",
connectionStatus: "verified",
minimalReadStatus: "verified",
t000.source: "adt"
```

## 5. Task 2: Evidence Safety Policy

- [x] **Step 1: Preserve strict generic evidence checks**

`assertSafeSapObjectEvidenceText("SELECT * FROM T000")` must still throw by default.

- [x] **Step 2: Allow fixed-endpoint read-only source evidence**

`normalizeSapObjectEvidenceResult()` should accept ABAP-like source only when the connector result marks it as fixed ADT read-only source evidence.

- [x] **Step 3: Keep hard blockers**

These must still throw for all evidence:

```text
Authorization
Cookie
SAP_SESSIONID
MYSAPSSO2
x-csrf-token
secure-store:sec_
private keys
high-confidence API keys
table-like row dumps
```

## 6. Task 3: Main Process And UI Gate

- [x] **Step 1: Enable real path only after real ADT verification**

In `readSapObjectEvidence()`:

```ts
const allowRealEvidence = config.adt.lastVerificationMode === "adt";
```

Fake evidence remains limited to:

```ts
WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE=1
lastVerificationMode === "fake"
demo SAP host
```

- [x] **Step 2: Add function group input**

Renderer should include `functionGroup` only when object type is `function`.

- [x] **Step 3: Keep one narrow IPC**

Do not add any new IPC channel. Reuse `workbench:read-sap-object-evidence`.

## 7. Task 4: Runtime Probe And Preflight

- [x] **Step 1: Add Phase 13 probe**

Run:

```powershell
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
```

Expected markers:

```text
fixedEndpointMapping=ok
functionGroupRequired=ok
realConnectorUsesGetOnly=ok
basicAuthNotReturned=ok
readOnlySourceAccepted=ok
genericUnsafeEvidenceStillBlocked=ok
realVerifyUsesFixedGetOnly=ok
noWriteMarkers=ok
```

- [x] **Step 2: Update preflight**

Preflight must still fail on:

```text
method: "POST"
method: "PUT"
method: "PATCH"
method: "DELETE"
sap-sql
execute-sql
query-sap
sap-proxy
rawHeaders
set-cookie
SAP_SESSIONID
MYSAPSSO2
```

## 8. Task 5: Adversarial Review And Verification

- [x] **Step 1: Write adversarial review**

Review must include:

- Product decision: why real ADT evidence comes before Feishu publishing.
- Security decision: why only fixed GET endpoints are allowed.
- Residual risk: real ABAP source can be sensitive, so it stays restricted from search/model context.
- Residual risk: no live SAP call in automated probe; live use still depends on user configuration and SAP authorization.

- [x] **Step 2: Run verification**

Required commands:

```powershell
npm run check
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase12-sap-readonly-evidence-probe.mjs
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Before push:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1 -RequireClean
```

## 9. Exit Criteria

- Real ADT verification mode exists and uses only fixed GET reads.
- Real object evidence works against a mocked ADT server and does not require a live SAP system during tests.
- The renderer cannot pass arbitrary SAP paths, URLs, SQL, commands, or file paths.
- Function module evidence requires a function group for real reads.
- ABAP-like source from fixed real ADT GET is accepted as restricted local evidence.
- Generic unsafe evidence text remains blocked.
- No write-like method or generic SAP/SQL IPC exists.
- Phase 13 adversarial review exists and verification commands pass.
