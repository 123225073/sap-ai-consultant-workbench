# Phase 25 Case File And Knowledge Status Clarity Review

Date: 2026-07-04

## Scope

Phase 25 clarifies the local MVP loop after Phase 24:

```text
case output -> pending knowledge candidate -> human review -> published reusable knowledge
```

The phase is intentionally narrow. It improves visible status labels and removes internal path/state exposure from the case file panel, Knowledge Center, and search results. It does not add connectors or external actions.

## Implemented Boundary

- Current case files show plain purpose labels for deliverables, pending knowledge, technical evidence/process material, and case records.
- The file panel has a compact legend instead of a dashboard-style redesign.
- File row titles and preview subtitles no longer display raw relative paths.
- The Feishu handoff action is labeled as a local draft generator only.
- Knowledge list/detail source labels no longer show `sourceFilePath`.
- Published knowledge is shown as reusable only when the renderer can see a complete review record and complete checklist.
- Case-generated pending candidates show a warning that human review is required before formal publishing.
- Internal case-state files are filtered out of the current case tree before the renderer receives the tree.
- Search result visible locations/snippets use safe purpose labels instead of raw file paths or knowledge source paths.
- Search result IDs are hashed and `sourcePath` is null, so search no longer returns preview paths to the renderer.
- No Phase 25 IPC, SAP write, Feishu publish/sync, arbitrary file read/open, or automatic review/publish/attach path was added.

## Adversarial Review

### Product / UX Review

Initial product review found Important issues:

- File purpose labels existed before their CSS and legend were complete, so the distinction could be unclear.
- Technical/evidence files were labeled too weakly as process material.
- The renderer reusable-knowledge predicate was looser than the backend review rule.
- The Feishu handoff action used English wording and could be misunderstood by non-technical users.
- Phase 25 lacked a dedicated probe and preflight coverage.

Fixes made:

- Added compact badge styles and a file-purpose legend.
- Used the stronger label "technical evidence / process material" for technical, evidence, and snapshot files.
- Tightened `hasReusableReviewRecord` to require complete review metadata, sufficient note length, and complete checklist.
- Changed the Feishu action to local-draft-only wording.
- Added the Phase 25 probe and security-preflight block.

### Security / Boundary Review

Initial security review found Critical and Important issues:

- Internal case-state files such as `metadata.json` and `messages.json` could appear in the file tree even if preview was blocked.
- File rows and preview headers exposed raw relative paths.
- Knowledge Center and search exposed `sourceFilePath` in visible text and search metadata.
- Phase 25 lacked dedicated probe and preflight enforcement.

Fixes made:

- Added `isInternalCaseTreeEntry` in `workspaceStore.ts` to hide state, credential, and secret files from the case tree.
- Removed raw relative path display from file rows and preview subtitles.
- Removed visible knowledge source paths from search records and Knowledge Center details.
- Added runtime probe coverage proving internal files are hidden from a temporary case tree.
- Added preflight forbidden-string checks for path exposure and unsafe renderer capabilities.

### Current Review Status

Fresh product and security re-reviews found no Critical issues, but did find Important issues before the final fix pass:

- Knowledge Center still labeled published document/QA imports as candidates and prioritized confidence over reuse state.
- Knowledge Center search still matched hidden `sourceFilePath`.
- File panel and main search still matched hidden `relativePath`.
- SAP evidence and Feishu handoff notices still displayed generated relative paths.
- Search results still returned `sourcePath` values for file preview routing.
- Internal file-tree filtering hid sensitive files but not sensitive directories.

Final fixes made:

- `knowledgeSourceLabel` now changes candidate/import labels according to item status, so published imports read as knowledge.
- Knowledge list rows always show reuse state; confidence is only appended as secondary text.
- Knowledge Center search no longer includes `sourceFilePath`.
- File panel and search service no longer match hidden relative paths.
- SAP evidence and Feishu handoff notices point users to the file panel instead of printing generated paths.
- Search result file and safe-summary IDs are hashed and `sourcePath` is null.
- Search-result preview from global search was removed; safe file preview remains available from the right-side case file tree.
- `isInternalCaseTreeEntry` now blocks credential/secret/SAP/Feishu config directories as well as files.
- Phase 12 and Phase 25 probes and security preflight now cover these tighter boundaries.

## Verification

Focused verification to run after review:

```powershell
npm run check
node scripts\phase25-case-file-knowledge-status-clarity-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Regression verification to run before commit:

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
node scripts\phase24-case-knowledge-candidate-projection-probe.mjs
node scripts\phase25-case-file-knowledge-status-clarity-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

Observed focused result after final fixes: `npm run check`, `node scripts\phase25-case-file-knowledge-status-clarity-probe.mjs`, `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`, `node scripts\phase12-sap-readonly-evidence-probe.mjs`, and `git diff --check` passed.

Observed regression result before commit: Phase 11 through Phase 25 probes passed, `npm run build` passed, `security-preflight.ps1` passed, and `git diff --check` passed.

## Residual Risk

- The full renderer `WorkbenchState` still includes broader project/config data. That is an existing architecture concern outside Phase 25's narrow file/status clarity scope. Phase 25 reduces visible internal path/state exposure but does not redesign the full renderer state contract.
- Search result click-to-preview is intentionally disabled in this phase because returning preview paths would reintroduce a path side channel. Users can still preview current-case files from the right-side file panel.
