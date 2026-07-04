# Phase 26 Project Visible List Removal Review

Date: 2026-07-04

## Scope

Phase 26 implements the PRD requirement that the left sidebar shows the user's current visible project list and lets a visible project be removed from that list.

The phase is intentionally narrow:

```text
visible project -> hidden from sidebar -> project data remains saved
```

It does not delete projects and does not add restore, SAP, Feishu, model, or knowledge-publish behavior.

## Implemented Boundary

- Added `hideProjectFromSidebar` as a narrow lifecycle operation.
- Added `workbench:hide-project-from-sidebar` to the trusted IPC allowlist.
- Added strict input parsing that accepts only `{ projectId }`.
- The sidebar renders `visibleProjects`, filtered by `project.isVisible !== false` and sorted by `visibleOrder`.
- The project action uses a hide icon and says the project is hidden from the sidebar only.
- Hidden projects stay in `state.projects`; only `isVisible` changes to `false`.
- Project directory, case directory, project metadata, standards, and knowledge files remain in place.
- If the hidden project was active, the app switches to another visible project and its latest case.
- Hiding the last visible project is rejected until a restore UI exists.
- Switching directly to a hidden project is rejected.
- Project metadata now records `isVisible` and `visibleOrder`.
- No project delete IPC, file deletion call, SAP write, Feishu publish/sync, or model execution path was added.

## Adversarial Review

### Product / UX Review

The product reviewer found the correct minimum scope:

- Use "hide" or "remove from sidebar" language, never "delete project".
- Keep all project, case, file, config, standards, and knowledge data.
- Filter only the left project list.
- Automatically switch away if the active project is hidden.
- Reject hiding the last visible project because this phase has no restore UI.

Implementation decisions:

- The user notice says the project is hidden from the sidebar only and all saved project assets remain.
- The action uses an `EyeOff` icon rather than a trash icon.
- The button is disabled when only one visible project remains, with backend rejection as the authoritative guard.

### Security / Boundary Review

The security reviewer identified the critical risks:

- Do not remove a project from `state.projects`.
- Do not delete any project directory, case directory, config, standards, knowledge, SAP evidence, or Feishu records.
- Do not rely on frontend filtering only; persist `isVisible` in the main process.
- Reject path-like IDs and unsupported fields.
- Add a dedicated probe and security-preflight block.

Fixes and controls:

- `hideProjectFromSidebar` sets `project.isVisible = false` and never filters or splices `state.projects`.
- The Phase 26 probe proves the hidden project and its files still exist after hiding.
- `parseHideProjectFromSidebarInput` reuses strict local ID validation.
- `security-preflight.ps1` checks the narrow IPC, probe marker, visible project filtering, and forbidden delete/SAP/Feishu markers.
- Existing SAP/ADT, Feishu, model/API, knowledge, and standards services were not modified.

## Verification

Focused verification observed:

```powershell
npm run check
node scripts\phase26-project-visible-list-removal-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
```

Observed result:

```text
npm run check: passed
phase26-project-visible-list-removal-probe: passed
security-preflight.ps1: passed
```

Regression verification observed before commit:

```powershell
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
node scripts\phase24-case-knowledge-candidate-projection-probe.mjs
node scripts\phase25-case-file-knowledge-status-clarity-probe.mjs
node scripts\phase26-project-visible-list-removal-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Observed result:

```text
Phase 11 through Phase 26 probes: passed
npm run build: passed
security-preflight.ps1: passed
git diff --check: passed
```

## Residual Risk

- Hidden projects currently have no restore UI. This phase blocks hiding the last visible project to avoid trapping the user.
- Search and non-sidebar project data still retain hidden projects because this phase is sidebar visibility only, not project archival or deletion.
- Some existing UI text remains historical mojibake in unrelated areas; Phase 26 only changed the new visible-project flow.
