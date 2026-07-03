# Phase 14 Feishu CLI Safe Draft Handoff Review

## Scope

This review covers the Phase 14 local-only Feishu handoff feature.

The feature is intentionally not a Feishu publisher. It prepares current-case local artifacts for a human to review and later use with Feishu CLI or the Feishu client.

## Reuse Boundary

The implementation may reuse the process lessons from:

- old SAP ABAP daily ADT/FeiShu CLI workflows
- existing SAP Skills such as `sap-adt-cli` and `sap-feishu-dev-docs`
- `shrek-abaper/sap-engineering-skill` as a safety reference for read-only default behavior

It must not copy old workspace data, credentials, runtime outputs, screenshots, SAP source, tokens, cookies, or private customer content into this repository.

## Threat Model

| Risk | Required Control |
|---|---|
| Accidental Feishu publication | No publish/update/create/whiteboard CLI command execution in Phase 14 |
| Arbitrary command execution | No new `child_process`; only existing Feishu CLI verifier can use fixed command names |
| Arbitrary local file read | Handoff builder can use only existing current-case safe `outputs/` summary pipeline |
| Token/auth leakage | No Feishu token, device code, auth URL, cookie, authorization header, SAP password, or secure-store reference in generated files |
| Misleading UX | UI and files must say local draft and not published |
| Search/model contamination | Only safe `outputs/` summaries may be indexed; restricted `technical/`, `evidence/`, and `snapshots/` remain excluded |
| Hidden maintenance rewrites | The handoff action must not rewrite case maintenance files, app state, or the search database |

## Planned Controls

- One narrow IPC: `workbench:prepare-feishu-handoff`.
- One main service: `feishuHandoffService.ts`.
- Fixed generated paths under current case:
  - `outputs/feishu-handoff-<timestamp>.md`
  - `outputs/feishu-whiteboard-<timestamp>.mmd`
  - `technical/feishu-handoff-manifest-<timestamp>.json`
- Manifest status: `not-published`.
- Security preflight checks Feishu publish/auth command markers.
- Probe validates actual disk changes, output locations, and sensitive-pattern exclusion.
- The handoff action writes only the three generated handoff files, not `README.md`, `timeline.md`, `context_pack.md`, `metadata.json`, `messages.json`, `project.json`, `app-state.json`, or the search database.

## Verification Evidence

- `npm run check`: passed.
- `node scripts\phase11-safe-model-case-execution-probe.mjs`: passed; safe model case execution boundaries still hold.
- `node scripts\phase12-sap-readonly-evidence-probe.mjs`: passed; SAP evidence remains single-object/read-only and search-safe.
- `node scripts\phase13-real-adt-readonly-evidence-probe.mjs`: passed; real ADT connector still uses fixed GET-only endpoints.
- `node scripts\phase14-feishu-safe-handoff-probe.mjs`: passed; actual disk snapshot comparison proves the action changes only the three generated `outputs/` and `technical/` handoff files, preserves `not-published`, excludes sensitive/cloud markers, and does not introduce Feishu publish commands.
- `npm run build`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`: passed; new IPC is whitelisted, handoff markers are present, Feishu publish/auth command scan is clean, and child process usage remains restricted to `feishuCliConnector.ts`.
- `git diff --check`: passed.

## Findings

No blocking issues remain after implementation, adversarial review, and verification.

Residual risk: the feature prepares a draft that a human can later publish outside the app. The app cannot verify what happens after that external human step; the generated files and UI therefore keep the status as `not-published`.

## Independent Adversarial Review

Two read-only subagent reviews were used.

First reviewer checks:

- Reviewed the current diff for Feishu publish/auth paths, arbitrary CLI execution, arbitrary file read/write, SAP write access, and knowledge auto-publish.
- Ran `node scripts/phase14-feishu-safe-handoff-probe.mjs`: passed.
- Ran `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`: passed.
- Ran `git diff --check`: passed.

Second reviewer finding:

- Important: the initial implementation reused full case-maintenance writing, which could rewrite `project.json`, `messages.json`, `README.md`, `conversation.md`, `timeline.md`, `context_pack.md`, and `metadata.json` while the probe checked only returned generated paths.
- Minor: the button label should make the local-only boundary visible without relying on the tooltip.
- Minor: Feishu publish/auth command scanning could cover more aliases.

Resolution:

- Replaced full case-maintenance writing with a generated-file-only writer.
- Updated the probe to snapshot actual disk files before and after handoff preparation and fail on any changed path outside the three generated handoff files.
- Renamed the button to `Prepare local Feishu draft`.
- Broadened the security preflight Feishu publish/auth command scan.

## Review Status

Approved for Phase 14 scope: local-only Feishu draft handoff. No cloud publish path is included.
