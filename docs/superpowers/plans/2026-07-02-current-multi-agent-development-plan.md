# SAP AI Workbench Current Multi-Agent Development Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the SAP AI 顾问工作台 MVP as a local-first personal desktop product, continuing from the completed repository foundation, workbench shell, local case loop, config center, and secure secret store.

**Architecture:** The controller agent freezes each phase boundary, shared types, IPC contracts, and safety rules before implementation starts. Specialist agents may work in parallel only on independent areas; every feature must pass spec, UX, security, and verification review before merge.

**Tech Stack:** Electron + React + TypeScript, local JSON storage currently, later SQLite FTS5, local file system, Electron `safeStorage`, narrow Electron IPC, Lucide icons, future read-only SAP ADT, Feishu CLI, model API, and Codex connector abstractions.

---

## 1. Current Verified Baseline

- Completed and pushed:
  - Phase 0 repository foundation: `178c4f8`
  - Phase 1A desktop workbench shell: `5df24fd`
  - Phase 1B minimum local case loop: `6611425`
  - Phase 2 config center foundation: `1c6dcec`
  - Phase 2B secret store foundation: `bd14041`
- Current working branch:
  - `phase-3a-adt-readonly-validation`
- Current next target:
  - Phase 3A ADT read-only validation foundation.

## 2. Non-Negotiable Boundaries

- MVP is personal and local-first.
- No team edition, account system, cloud SaaS, or subscription workflow.
- SAP stays read-only by default.
- No SAP source write, activation, deletion, transport creation, or transport release.
- No automatic formal knowledge publishing.
- No raw SAP password, API key, Feishu token, SAP source, or customer business data in Git, logs, Markdown, runtime JSON, UI, or model context.
- Do not copy old SAP CLI configs or sensitive files from the old SAP ABAP workspace.
- UI follows Codex-style workbench flow, not card-heavy SaaS dashboard flow.

## 3. Controller Rules For Multi-Agent Work

- [ ] Freeze the phase goal before dispatching agents.
- [ ] Assign each agent a single ownership boundary.
- [ ] Do not dispatch two implementation agents against the same file set.
- [ ] Use parallel agents for read-only review, UX review, security review, and independent connector/UI/service work after contracts are frozen.
- [ ] Use serial execution for shared types, IPC names, storage schema, and security preflight changes.
- [ ] Require an adversarial review note under `docs/architecture/reviews/` for every feature branch.
- [ ] Run `npm run check`, `npm run build`, `scripts/security-preflight.ps1`, `git diff --check`, and targeted scans before commit.

## 4. Phase 3A: ADT Read-Only Validation Foundation

**Purpose:** Make ADT validation executable without touching real SAP write capabilities.

**Primary files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Create: `apps/desktop/src/main/adtReadonlyConnector.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`
- Modify: `apps/desktop/src/renderer/ConfigCenter.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `scripts/security-preflight.ps1`
- Create: `docs/superpowers/plans/2026-07-02-phase-3a-adt-readonly-validation-plan.md`
- Create: `docs/architecture/reviews/2026-07-02-phase-3a-adt-readonly-validation-review.md`

**Implementation agents:**
- Contract Agent: shared types, result shape, status mapping.
- Main Process Agent: connector abstraction, secret resolution, report redaction, state update.
- UI Agent: three-step verification report and plain-language status.
- QA/Security Agent: IPC whitelist, sensitive scans, anti-write scans, adversarial review.

**Required behavior:**
- [ ] Add a success state such as `verified` to config status handling.
- [ ] Add a narrow `workbench:adt-verify-readonly` IPC only.
- [ ] Keep password resolution inside the main process only.
- [ ] Use a fake connector first; do not require real SAP credentials for this phase.
- [ ] Run three gates: config completeness, status check, fixed `T000` minimal read.
- [ ] Mark ADT fully verified only when fixed `T000` minimal read succeeds.
- [ ] Return only a redacted report to UI.
- [ ] Show plain Chinese failure reasons and next actions.
- [ ] Keep write mode and transport write mode visibly locked.
- [ ] Update `security-preflight.ps1` IPC whitelist and dangerous-name scans.

**Verification:**
- [ ] Missing config reports missing fields and makes no connector call.
- [ ] Missing secret reports missing secure credential and does not expose `secretRef`.
- [ ] Fake success marks connection and minimal read as `verified`.
- [ ] Fake status success plus T000 failure does not mark full verification.
- [ ] Report contains no password, token, Authorization, Cookie, or secret reference.
- [ ] Dangerous IPC names and SAP write words are absent.

## 5. Phase 3B: Model Provider Validation

**Purpose:** Make API/model configuration prove it can list models and run a minimal safe chat call.

**Primary files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Create: `apps/desktop/src/main/modelProviderConnector.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/ConfigCenter.tsx`
- Modify: `scripts/security-preflight.ps1`
- Create: `docs/architecture/reviews/2026-07-02-phase-3b-model-provider-validation-review.md`

**Agent split:**
- Connector Agent: OpenAI-compatible list-models and minimal chat abstraction.
- UI Agent: model list, model capability labels, failure states.
- Security Agent: API key never leaves main process; logs are clean.

**Verification:**
- [ ] Bad base URL gives understandable network/base URL error.
- [ ] Bad API key gives understandable credential error without exposing key.
- [ ] Model list is grouped by provider.
- [ ] Minimal chat test stores only safe status metadata.

## 6. Phase 3C: Feishu CLI Validation

**Purpose:** Prove Feishu CLI exists, profile is logged in, and document permissions are understandable.

**Primary files:**
- Create: `apps/desktop/src/main/feishuCliConnector.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/ConfigCenter.tsx`
- Modify: `scripts/security-preflight.ps1`
- Create: `docs/architecture/reviews/2026-07-02-phase-3c-feishu-cli-validation-review.md`

**Agent split:**
- Connector Agent: doctor/auth/profile checks.
- UI Agent: login and missing-scope guidance.
- Security Agent: token and profile output redaction.

**Verification:**
- [ ] Missing CLI gives install/path guidance.
- [ ] Not logged in gives authorization guidance.
- [ ] Missing scope does not repeatedly create new device codes.
- [ ] No Feishu token is stored or displayed.

## 7. Phase 4: Case Workflow And Task Modes

**Purpose:** Turn the shell into a working SAP consultant case flow.

**Primary files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`
- Create: `apps/desktop/src/main/caseWorkflowService.ts`
- Create: `apps/desktop/src/main/contextPackService.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Create: `docs/architecture/reviews/2026-07-02-phase-4-case-workflow-review.md`

**Agent split:**
- Case Agent: message persistence, timeline, context pack.
- File Agent: output file policy and right-panel refresh.
- UX Agent: task mode language and interaction states.
- QA Agent: file creation and search regression.

**Verification:**
- [ ] A case can continue across app restarts.
- [ ] `conversation.md`, `timeline.md`, and `context_pack.md` are updated.
- [ ] Output files land under the correct current case folder.
- [ ] Technical files stay in `technical/`, `evidence/`, or `snapshots/`.

## 8. Phase 5: Standards Center

**Purpose:** Let each project keep independent ABAP, document, and diagram standards.

**Primary files:**
- Create: `apps/desktop/src/main/standardsService.ts`
- Create: `apps/desktop/src/renderer/StandardsCenter.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Create: `docs/architecture/reviews/2026-07-02-phase-5-standards-center-review.md`

**Agent split:**
- Standards Agent: templates, project copy, version metadata.
- UI Agent: edit, diff, save version.
- QA Agent: prove project standards do not cross-pollute.

**Verification:**
- [ ] S4/ECC templates can be copied into a project.
- [ ] Project copy becomes independent after copying.
- [ ] Diff shows source vs current project version.
- [ ] ABAP task mode can read active project standards.

## 9. Phase 6: Knowledge Center And Search

**Purpose:** Make historical cases, files, and confirmed knowledge findable without polluting the knowledge base.

**Primary files:**
- Create: `apps/desktop/src/main/searchService.ts`
- Create: `apps/desktop/src/main/knowledgeService.ts`
- Create: `apps/desktop/src/renderer/KnowledgeCenter.tsx`
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Create: `docs/architecture/reviews/2026-07-02-phase-6-knowledge-search-review.md`

**Agent split:**
- Search Agent: local file/content search, later SQLite FTS5.
- Knowledge Agent: candidate, confirm, conflict, expire states.
- UX Agent: candidate review flow.
- QA Agent: no automatic formal publishing.

**Verification:**
- [ ] Search result says source project, case, file, and type.
- [ ] Candidate knowledge starts as `待确认`.
- [ ] Manual confirmation is required before `已发布`.
- [ ] Conflicting knowledge cannot silently overwrite old knowledge.

## 10. Phase 7: End-To-End MVP Verification

**Purpose:** Prove one complete SAP consultant workflow.

**Agent split:**
- Scenario Agent: run the full demo path.
- Security Agent: secret and customer-data scan.
- UX Agent: screenshot and layout review.
- Release Agent: package evidence and final checklist.

**Required scenario:**
- [ ] Create project `演示 S4HANA`.
- [ ] Save ADT non-secret config and secure password reference.
- [ ] Pass ADT read-only validation with fixed `T000` minimal read.
- [ ] Configure a model provider and fetch models.
- [ ] Create case `DEMO001 演示BOM清单`.
- [ ] Ask a case question.
- [ ] Generate Markdown, Mermaid, and one tabular output file.
- [ ] See those files in the right file panel.
- [ ] Generate candidate knowledge.
- [ ] Manually confirm knowledge.
- [ ] Search and find case, files, and knowledge.

## 11. Standard Verification Commands

Run before every feature commit:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
rg -n 'get-secret|read-secret|export-secret|runCommand|exec\(|spawn\(|shell\.|open-any-path' apps/desktop/src
rg -n 'activate|transport|release|create.*sap|update.*sap|delete.*sap' apps/desktop/src
```

Run before pushing:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin <feature-branch>
```

## 12. Immediate Recommendation

- [ ] First finish Phase 3A.
- [ ] Use one implementation stream for shared contracts and IPC.
- [ ] Use parallel review agents for security, UX wording, and connector contract.
- [ ] After Phase 3A passes, split Phase 3B model validation and Phase 3C Feishu validation into separate branches so they do not interfere.
