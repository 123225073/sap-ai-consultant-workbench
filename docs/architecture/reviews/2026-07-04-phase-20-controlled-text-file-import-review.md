# Phase 20 Controlled Text File Import Review

## Scope

Phase 20 adds one narrow capability: import a user-selected Markdown/TXT file into the existing pending knowledge candidate flow.

Allowed:

- Single selected file only.
- Extensions: `.md`, `.markdown`, `.txt`.
- Main-process file dialog and one-time UTF-8 read.
- Store only safe basename/source label and generated candidate path.
- Reuse Phase 16 import firewall.
- Reuse Phase 19 human review gate before publish.

Blocked:

- Word, PDF, Excel, ABAP source import.
- Folder, batch, drag/drop, pasted path, or arbitrary path import.
- Renderer or preload file reads.
- Absolute path persistence.
- SAP write/activation/transport.
- Feishu auth/sync/publish.
- Network, shell commands, URL openers.
- Auto-publish or review bypass.

## Adversarial Checks

| Attack | Required defense |
|---|---|
| User imports `.env`, `.json`, `.abap`, `.xlsx`, or renamed unsupported file | Extension allowlist rejects before read/import. |
| User imports huge file | Size guard rejects before read. |
| User imports binary-like file | Text guard rejects after one read. |
| User tries to provide path through renderer | Renderer API only accepts `projectId`; no path field exists. |
| Selected absolute path leaks to state/search/UI | Store basename only as `sourceName`; generated `sourceFilePath` remains `knowledge_candidates/...`. |
| File contains password, token, SAP session, Feishu URL, SAP write code, ABAP source, or table dump | Existing import parser rejects. |
| Imported candidate publishes directly | Phase 19 gate rejects until review checklist and note are recorded. |
| Imported candidate is edited after review | Reviewed content hash blocks publish until re-review. |
| Feature accidentally opens Feishu/SAP/network/command path | Preflight scans exact import blocks and dangerous markers. |

## Verification Log

Passed on 2026-07-04:

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
- `npm run build`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`
- `git diff --check`

## Current Assessment

Code review found one Critical path-leak risk and two Important coverage/race concerns. The fixes were applied by moving controlled reads into `controlledTextFileImportService.ts`, replacing raw filesystem errors with fixed messages, checking actual `fileBuffer.length` after read, and adding probe/preflight coverage for those paths.

Second code-review pass found no remaining Critical or Important issues.
