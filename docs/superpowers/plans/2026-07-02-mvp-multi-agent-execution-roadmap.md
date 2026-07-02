# SAP AI Workbench MVP Multi-Agent Execution Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each detailed phase plan task-by-task. This roadmap is the controller-level plan; each feature phase must keep its own detailed checkbox plan under `docs/superpowers/plans/`.

**Goal:** Finish the SAP AI 顾问工作台 MVP as a personal local desktop app for one SAP consultant, centered on projects, cases, Codex-style conversation, case files, configuration validation, standards, confirmed knowledge, and read-only SAP access.

**Architecture:** Use a controller-led multi-agent workflow. The controller owns scope, shared data contracts, IPC names, safety rules, integration order, and final verification. Specialist agents may work in parallel only after shared contracts are frozen and only when they do not edit the same files.

**Tech Stack:** Electron + React + TypeScript, local JSON storage now, later SQLite with FTS5, local file system, Electron main-process services, Electron `safeStorage`, narrow preload IPC, Lucide icons, future read-only SAP ADT, Feishu CLI, model API, and Codex connector abstractions.

---

## 1. Current Verified State

The repository is no longer an empty product-prototype folder. Development has already completed and pushed these branches:

| Phase | Branch | Commit | Status |
|---|---|---:|---|
| Phase 0 repository foundation | main history | `178c4f8` | Complete |
| Phase 1A desktop workbench shell | `phase-1a-desktop-workbench` | `5df24fd` | Complete |
| Phase 1B minimum local case loop | `phase-1b-minimum-case-loop` | `6611425` | Complete |
| Phase 2 config center foundation | `phase-2-config-center` | `1c6dcec` | Complete |
| Phase 2B secret store foundation | `phase-2b-secret-store-foundation` | `bd14041` | Complete |
| Phase 3A ADT read-only validation | `phase-3a-adt-readonly-validation` | `8557cb4` | Complete |
| Phase 3B model provider validation | `phase-3b-model-provider-validation` | `247b616` | Complete |
| Phase 3C Feishu CLI validation | `phase-3c-feishu-cli-validation` | `5121920` | Complete |
| Phase 4 local case workflows | `phase-4-case-workflows` | `3e0dbdf` | Complete |
| Phase 5 project standards center | `phase-5-standards-center` | `5519a15` | Complete and pushed |

Current working branch:

```text
phase-6-knowledge-center
```

Current branch state:

- Phase 6 implementation files exist in the working tree.
- Phase 6 verification has passed in the previous run.
- Phase 6 is not committed or pushed yet.
- Immediate next action should be to re-run final checks, commit, run clean-tree preflight, and push.

## 2. Non-Negotiable Product Boundaries

- MVP is a personal local desktop app.
- No team edition, registration, login, cloud SaaS, organization, or subscription workflow.
- SAP stays read-only by default.
- No SAP source write, activation, delete, transport creation, or transport release.
- No automatic formal knowledge publishing.
- No secrets in Git, UI, logs, Markdown, runtime JSON, screenshots, or model context.
- No old SAP workspace sensitive data may be copied into this repo.
- UI must remain a Codex-style workbench, not a card-heavy dashboard.
- Every visible button must have a clear user-facing purpose.
- Every feature branch must include an adversarial review note under `docs/architecture/reviews/`.

## 3. Multi-Agent Operating Model

### Controller Agent

Owns:

- phase scope and acceptance criteria
- shared type contracts
- IPC names and preload bridge shape
- local storage and file boundary rules
- security preflight changes
- final integration, verification, commit, and push

Must not delegate final safety decisions.

### Specialist Agents

| Agent | Ownership | Parallel Use |
|---|---|---|
| Product/UX Agent | UX flow, Chinese copy, Codex-style layout, prototype consistency | Parallel read-only review or isolated UI work |
| Main Process Agent | Electron services, local storage, connector orchestration | Parallel only after IPC contracts are frozen |
| Renderer Agent | React pages, interaction states, responsive layout | Parallel only when not touching shared app shell files |
| Connector Agent | ADT, Feishu CLI, model provider, Codex abstractions | Parallel per connector after config contract is frozen |
| Knowledge/Search Agent | candidate knowledge, conflict states, search indexing | Parallel after project/case/file contracts are frozen |
| Standards Agent | templates, project copies, diffs, versions | Parallel after standards data contract is frozen |
| QA/Security Agent | secret scan, IPC review, SAP write-block review, runtime checks | Parallel read-only review after implementation |

### Parallelism Rules

- Parallel agents are allowed for independent files and read-only reviews.
- Shared contracts, IPC names, security preflight, and storage schema changes are serial.
- Do not dispatch two implementation agents against `App.tsx`, `workbenchTypes.ts`, `workspaceStore.ts`, or `security-preflight.ps1` at the same time.
- Do not let implementation agents commit without controller review.
- Do not merge or push a phase until `npm run check`, `npm run build`, `scripts/security-preflight.ps1`, and `git diff --check` pass.

## 4. Immediate Phase 6 Finish Plan

Purpose: finish the local knowledge center foundation already in progress.

Files already involved:

- `apps/desktop/src/main/knowledgeService.ts`
- `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- `apps/desktop/src/shared/workbenchTypes.ts`
- `apps/desktop/src/main/workspaceStore.ts`
- `apps/desktop/src/main/caseWorkflowService.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/preload/preload.ts`
- `apps/desktop/src/renderer/vite-env.d.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/styles.css`
- `scripts/security-preflight.ps1`
- `docs/superpowers/plans/2026-07-02-phase-6-knowledge-center-plan.md`
- `docs/architecture/reviews/2026-07-02-phase-6-knowledge-center-review.md`

Required final commands:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
git add .
git commit -m "feat: add local knowledge center"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin phase-6-knowledge-center
```

Exit criteria:

- Knowledge center is reachable from the sidebar.
- Case workflow creates pending candidates only.
- User can explicitly publish, mark conflict, or expire knowledge.
- Conflicted and expired items cannot be published.
- Search returns knowledge results with source type `知识`.
- Knowledge persists only under the current project local folder.
- No document upload parsing, QA import, Feishu sync, SAP calls, or model calls are introduced in Phase 6.

## 5. Phase 7: SQLite And FTS5 Persistence Upgrade

Purpose: replace the current local JSON foundation with a proper local database and full-text search base.

Agent split:

- Data/Foundation Agent: SQLite schema, migrations, repository layer.
- Search Agent: FTS5 tables and search result ranking.
- QA/Security Agent: migration safety, no secret columns, no sensitive fixture data.
- Product/UX Agent: search result wording and source labels.

Primary files to plan:

- `apps/desktop/src/main/databaseService.ts`
- `apps/desktop/src/main/searchService.ts`
- `apps/desktop/src/main/workspaceStore.ts`
- `apps/desktop/src/shared/workbenchTypes.ts`
- `apps/desktop/src/renderer/App.tsx`
- `scripts/security-preflight.ps1`
- `docs/architecture/reviews/2026-07-02-phase-7-sqlite-fts-review.md`

Exit criteria:

- Projects, cases, files, messages, standards metadata, knowledge metadata, and search index have SQLite-backed persistence.
- Existing local JSON demo data can migrate or seed safely.
- FTS search covers case title, message summary, file metadata, knowledge title, and knowledge content.
- Search results still show clear type, project, case, source, and update time.

## 6. Phase 8: Real Case Output Generation

Purpose: move from demo responses to useful local output generation while staying local-first and safe.

Agent split:

- Case Workflow Agent: task-mode orchestration.
- File Output Agent: Markdown, Mermaid, CSV or XLSX-like tabular output files.
- Model Agent: minimal model call integration only through configured provider.
- QA/Security Agent: no secrets, no raw SAP source unless explicitly saved as case snapshot.

Primary files to plan:

- `apps/desktop/src/main/caseWorkflowService.ts`
- `apps/desktop/src/main/modelProviderConnector.ts`
- `apps/desktop/src/main/outputFileService.ts`
- `apps/desktop/src/main/contextPackService.ts`
- `apps/desktop/src/renderer/App.tsx`
- `docs/architecture/reviews/2026-07-02-phase-8-real-case-output-review.md`

Exit criteria:

- 问题分析 mode can create a clear conclusion and safe output files.
- 文档生成 mode can create a Markdown development note from the current case.
- 画流程图 mode can create Mermaid source in `outputs/`.
- ABAP 开发 mode can create draft code or explanation files but does not write SAP.
- Right file panel refreshes after files are generated.

## 7. Phase 9: Read-Only SAP Object Retrieval In Workflows

Purpose: use the already validated ADT foundation inside case workflows.

Agent split:

- SAP Connector Agent: read-only object retrieval wrappers.
- Case Workflow Agent: object mention detection and user-visible source tracking.
- Security Agent: anti-write scan and SAP source handling review.
- UX Agent: clear “read from SAP” status and failure messages.

Primary files to plan:

- `apps/desktop/src/main/adtReadonlyConnector.ts`
- `apps/desktop/src/main/caseWorkflowService.ts`
- `apps/desktop/src/main/sapSourcePolicy.ts`
- `apps/desktop/src/shared/workbenchTypes.ts`
- `apps/desktop/src/renderer/App.tsx`
- `scripts/security-preflight.ps1`
- `docs/architecture/reviews/2026-07-02-phase-9-sap-readonly-workflows-review.md`

Exit criteria:

- Workflows can read low-risk SAP metadata or objects through the connector.
- Current project and system are shown before SAP reads.
- SAP source snapshots are saved only when the task policy requires it.
- Read failures map to plain Chinese reasons.
- Write, activate, delete, create transport, and release transport remain blocked.

## 8. Phase 10: Feishu Document Publishing Workflow

Purpose: let the user publish selected local outputs to Feishu through explicit action.

Agent split:

- Feishu Agent: CLI command wrapper and redaction.
- Document Agent: publishable Markdown structure and result metadata.
- Renderer Agent: explicit publish button and result URL display.
- QA/Security Agent: token and URL scan, no auto-publish.

Primary files to plan:

- `apps/desktop/src/main/feishuCliConnector.ts`
- `apps/desktop/src/main/documentPublishService.ts`
- `apps/desktop/src/main/caseWorkflowService.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/ConfigCenter.tsx`
- `scripts/security-preflight.ps1`
- `docs/architecture/reviews/2026-07-02-phase-10-feishu-publish-review.md`

Exit criteria:

- Publishing requires an explicit user action.
- Feishu CLI status is checked before publishing.
- Missing scope shows a clear re-authorization path.
- Publish result stores document URL, document id, local source file, and timestamp.
- No Feishu token or secret appears in UI, logs, Markdown, or Git.

## 9. Phase 11: Document Upload, QA Import, And Knowledge Parsing

Purpose: turn the Phase 6 placeholder buttons into real local ingestion flows.

Agent split:

- Parser Agent: Word, Excel, PDF, Markdown, TXT, ABAP source, QA table intake.
- Knowledge Agent: candidate generation, conflict detection, manual confirmation.
- Search Agent: indexing parsed content.
- UX Agent: upload queue and review states.
- Security Agent: sensitive content detection and local-only storage review.

Primary files to plan:

- `apps/desktop/src/main/documentParserService.ts`
- `apps/desktop/src/main/knowledgeService.ts`
- `apps/desktop/src/main/searchService.ts`
- `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- `apps/desktop/src/shared/workbenchTypes.ts`
- `scripts/security-preflight.ps1`
- `docs/architecture/reviews/2026-07-02-phase-11-knowledge-ingestion-review.md`

Exit criteria:

- Upload/import creates document jobs.
- Parsed output keeps source, project, time, file type, and status.
- Tables are preserved structurally where practical.
- Generated knowledge remains pending until the user confirms it.
- Conflicts do not overwrite existing published knowledge.

## 10. Phase 12: Packaging, Backup, And Local Release Hardening

Purpose: make the app usable as a local desktop tool outside development mode.

Agent split:

- Desktop Release Agent: build and package flow.
- Data Agent: backup and restore local workspace.
- QA Agent: clean install smoke test.
- Security Agent: release artifact scan.

Primary files to plan:

- `apps/desktop/package.json`
- `apps/desktop/electron-builder` or equivalent package config
- `apps/desktop/src/main/backupService.ts`
- `apps/desktop/src/renderer/ConfigCenter.tsx`
- `scripts/security-preflight.ps1`
- `docs/architecture/reviews/2026-07-02-phase-12-local-release-review.md`

Exit criteria:

- App can be packaged locally.
- User can see local data path and backup path.
- Backup excludes secrets unless explicitly using secure export flow.
- Fresh install can open, create project, create case, and search demo data.

## 11. Phase 13: End-To-End MVP Acceptance

Purpose: prove the full product works as a daily SAP consultant workflow.

Scenario:

1. Create project `演示 S4HANA`.
2. Configure ADT non-secret settings and secure password reference.
3. Verify read-only ADT access with fixed `T000` minimal read.
4. Configure model provider and fetch models.
5. Create case `DEMO001 演示BOM清单`.
6. Ask a problem-analysis question.
7. Generate Markdown, Mermaid, and a tabular output file.
8. See generated files in the right file panel.
9. Generate pending knowledge.
10. Confirm knowledge manually.
11. Search and find the case, files, and knowledge.
12. Optionally publish selected local Markdown to Feishu by explicit action only.

Required final verification:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git diff --check
```

Exit criteria:

- Full local flow works.
- SAP stays read-only.
- No secrets are exposed.
- No knowledge auto-publishes.
- Errors are understandable to a non-programmer.
- The UI remains close to the product prototype and Codex-style layout.

## 12. Recommended Next Action

Do not start several new implementation branches before finishing Phase 6.

Recommended order:

1. Finish, commit, and push `phase-6-knowledge-center`.
2. Create the detailed Phase 7 SQLite/FTS5 plan.
3. Execute Phase 7 with Data/Search agents plus QA/Security review.
4. Continue Phase 8 and Phase 9 in separate branches, because real output generation and SAP retrieval both touch case workflows.
5. Run Phase 10 Feishu publishing after output generation is stable.
6. Run Phase 11 knowledge ingestion after SQLite/FTS5 and Phase 6 knowledge states are stable.
7. Finish with packaging and end-to-end MVP acceptance.
