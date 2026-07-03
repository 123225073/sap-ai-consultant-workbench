# Phase 16 Document Ingestion Firewall Adversarial Review

## Scope

Phase 16 adds a narrow local ingestion path:

- user pastes already-redacted local text into Knowledge Center;
- the main process validates the structured payload;
- the app creates a `needs-review` document job;
- the app creates a `pending` knowledge candidate;
- the app writes one generated Markdown artifact under the active case `knowledge_candidates/`.

This phase does not add file picker upload, arbitrary filesystem read, Word/PDF/Excel parsing, Feishu auth/sync/publish, SAP write, model execution, delete, or formal knowledge publish for imported local text.

## Multi-Agent Inputs

| Agent | Finding | Decision |
|---|---|---|
| Phase 16 ingestion reviewer | The new import path must reject path injection, secrets, SAP source snippets, Feishu tokens/URLs, and misleading UI wording. | Adopted. Parser and probe now cover these inputs. UI says local redacted text only and closes file/Feishu actions. |
| Security preflight reviewer | Preflight must whitelist one exact IPC, scan all import layers, prevent `sourceFilePath` from becoming a filesystem path, and expand auto-publish checks. | Adopted. `security-preflight.ps1` now checks the new IPC, markers, source path boundary, no unsafe capabilities, and no import auto-publish. |
| Product/safety review | Existing manual publish button could publish Phase 16 imported candidates. | Adopted. Phase 16 imported candidates are identifiable by `knowledge_candidates/imported-knowledge-*` and are blocked from direct publish. |
| Security code reviewer | Candidate file writes could escape through a symlink/junction, and input guards missed inline paths, semicolon tables, JSON rows, and bare Feishu-like tokens. | Adopted. Generated file writes now check `lstat`, `realpath`, `isSymbolicLink`, and case-root containment. Import guards and probe samples cover the bypasses. |

## Threat Model

| Risk | Attack Or Failure | Mitigation |
|---|---|---|
| Arbitrary file read | User supplies a file path or source name like `../escape.md`, `C:/temp/a.md`, `.env`, `.sap-adt-cli`, or `messages.json`. | Import input accepts no file path field. Source names and body text reject path-like and internal-file markers. Generated `sourceFilePath` is created by the main process only. |
| Secret ingestion | User pastes password, API key, bearer token, cookie, SAP session, secure-store reference, Feishu app secret, device code, verification URI, document ID, or Lark/Feishu URL. | `assertNoSensitiveKnowledgeContent` and import-specific guards reject these patterns before any state write. |
| SAP source or write snippet ingestion | User pastes ABAP source, `SELECT ... FROM`, `CALL FUNCTION`, or `INSERT/UPDATE/MODIFY/DELETE`. | Import body rejects ABAP/source/write-like patterns. Phase 16 stores only business conclusions, not source code. |
| Customer table dump | User pastes many structured rows that look like raw business data. | Import body rejects six or more rows with five or more cells. User must summarize to redacted conclusions. |
| Auto-publish | Import creates `published` knowledge or the existing publish button publishes imported text. | Import creates `pending` items and `needs-review` jobs only. Phase 16 imported items cannot be published through `publishKnowledgeItem`. |
| Cross-project write | Hostile renderer submits another project ID or stale active case. | Project ID must be strict local ID and must exist. The store writes under the selected project and active case using existing generated-file guards. |
| Symlink or junction escape | `knowledge_candidates` is replaced with a symlink/junction to an external directory before import. | Generated-file writes reject symlink/non-directory path segments and confirm the real parent path remains under the real case root before writing. |
| `sourceFilePath` misuse | Stored source metadata is later treated as a real filesystem path. | Security preflight blocks `readFile`/`path.join` usage with `sourceFilePath`. Candidate artifacts are written through `writeCaseGeneratedFiles`. |
| Feishu/SAP side effects | Import accidentally calls Feishu sync, SAP connector, network, shell, or opener APIs. | One narrow IPC is exposed. Preflight scans import paths for dialogs, file reads, `fetch`, child process calls, URL openers, Feishu sync, delete, and SAP write markers. |
| Misleading UI | Buttons imply upload, real parsing, or cloud sync is available. | UI uses "文件读取关闭", "QA 表读取关闭", "飞书同步关闭", and "当前只生成待确认候选". |

## Positive Capability List

Allowed:

- structured local text import through `workbench:knowledge-import-local-text`;
- `local-text`, `markdown-note`, and `qa-text` source classification;
- pending knowledge candidate creation;
- needs-review document job creation;
- generated Markdown artifact under active case `knowledge_candidates/imported-knowledge-*.md`;
- local search refresh.

Blocked:

- file picker and drag-drop file access;
- arbitrary path read or path preview;
- binary document parsing;
- Feishu auth, sync, create, update, or publish;
- SAP write, SQL, transport, activation, or generic browser;
- direct publish of Phase 16 imported candidates;
- delete/history removal.

## Verification Targets

- `scripts/phase16-document-ingestion-firewall-probe.mjs` proves safe import, exact one-item/one-job creation, pending/needs-review state, generated candidate file placement, search indexing, wrong-project rejection, extra-field rejection, path rejection, secret rejection, Feishu marker rejection, SAP source rejection, table-dump rejection, JSON-row rejection, symlink/junction escape rejection, manual publish blocking, and no unsafe import function markers.
- `scripts/security-preflight.ps1` proves one exact import IPC, required firewall markers, generated source path boundary, no unsafe import capabilities, no auto-publish, no raw file path use, and no delete.
- Existing Phase 11-15 probes prove no regression to safe model execution, SAP read-only evidence, real ADT fixed GET, Feishu local-only handoff, and project/case lifecycle.

## Residual Risk

The app cannot know whether every pasted business sentence is safe. Phase 16 therefore presents the feature as "paste redacted local text" only, rejects high-risk patterns, blocks direct formal publication, and keeps imported output as a local candidate for later human review.
