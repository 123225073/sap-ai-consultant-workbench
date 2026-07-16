# SAP AI Workbench Master Development Plan

> **历史计划说明（2026-07-15）：** 本文件记录项目从空仓库启动时的原始计划，其中“只有文档、没有应用骨架”等状态已经过期。当前真实状态以 `CONTEXT.md`、最新 Phase review、源码和 package scripts 为准；后续 Agent Runtime 开发以 `docs/architecture/INDEPENDENT_AGENT_RUNTIME.md`、ADR-0002 和 Phase 50 spec/plan 为准。不要按本文件重新初始化项目。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement detailed phase plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SAP AI 顾问工作台 MVP as a local-first desktop product for one SAP consultant, centered on projects, cases, Codex-style conversation, case files, project standards, confirmed knowledge, and read-only SAP access.

**Architecture:** Use a controlled multi-agent workflow. A controller agent owns product scope, shared contracts, integration, and review; specialist agents work on independent modules only after common data models, folder rules, security rules, and UI layout contracts are frozen. Development should start with a thin local desktop shell and verified data/file foundations before connecting ADT, Feishu, API models, standards, and knowledge workflows.

**Tech Stack:** Electron + React + TypeScript, SQLite with FTS5, local file system, OS secure credential storage, Lucide icons, later connectors for SAP ADT, Feishu CLI, model APIs, and Codex capability.

---

## 0. Current Project State

- The project currently contains product documents and prototype images only.
- There is no Git repository yet.
- There is no app skeleton, package manager setup, database, or source code yet.
- Existing product source of truth:
  - `docs/product-prototype/README.md`
  - `docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md`
  - `docs/product-prototype/TECHNICAL_IMPLEMENTATION.md`
  - `docs/product-prototype/NEW_PROJECT_HANDOFF.md`
  - `docs/product-prototype/images/01-main-workbench.png`
  - `docs/product-prototype/images/02-config-center.png`
  - `docs/product-prototype/images/03-standards-center.png`
  - `docs/product-prototype/images/04-knowledge-center.png`

## 1. Non-Negotiable Product Boundaries

- MVP is a personal local desktop version.
- No team edition.
- No registration or login.
- No cloud SaaS backend.
- SAP is read-only by default.
- No automatic SAP writing, activation, deletion, or transport release.
- No automatic formal knowledge publishing.
- No SAP source code, SAP password, API Key, Feishu Token, company business data, or real customer output committed to GitHub.
- Do not copy sensitive files from the old SAP ABAP workspace.
- Main UI should follow Codex-style conversation, not a card-heavy dashboard.
- Every visible button must have a clear user-facing purpose.

## 2. Recommended Multi-Agent Model

### 2.1 Controller Agent

Responsibilities:

- Owns product scope and final decisions.
- Freezes shared contracts before parallel work begins.
- Assigns module agents.
- Reviews every module against product documents.
- Runs integration checks.
- Blocks scope creep.
- Ensures no sensitive data is committed.

### 2.2 Specialist Agents

Recommended agents:

| Agent | Scope | Can Run In Parallel After |
|---|---|---|
| Product/UX Agent | Screen behavior, copy, interaction states, design QA | Shared UI layout contract is frozen |
| Desktop Shell Agent | Electron app shell, window, preload, IPC boundary | Repository and tech stack are confirmed |
| Data/Foundation Agent | SQLite schema, project/case/file models, migrations | Data contract is frozen |
| Case Files Agent | Case folder creation, file tree reading, file indexing | Case folder contract is frozen |
| Workbench UI Agent | Left sidebar, center conversation, right file panel, bottom input | App shell and UI contract are ready |
| Config Agent | ADT, Feishu, API/model, Codex capability config screens | Project model and secret policy are ready |
| Connector Agent | Read-only ADT connector, Feishu CLI wrapper, model API wrapper | Config contracts are ready |
| Standards Agent | Project standards copy, edit, diff, version metadata | Project model is ready |
| Knowledge/Search Agent | Document upload, candidate knowledge, manual confirmation, FTS search | Case/file models are ready |
| QA/Security Agent | Tests, sensitive data scan, UI regression, safety checks | Each phase has runnable output |

### 2.3 Parallelism Rule

Parallel development is allowed only when agents do not edit the same files or shared contracts.

Use parallel agents for:

- Independent UI screens after shared components are stable.
- Independent services after data contracts are stable.
- Independent connector wrappers after config contracts are stable.
- Independent QA passes after implementation is complete.

Do not use parallel agents for:

- Initial architecture decisions.
- Database schema changes without a frozen migration plan.
- Shared IPC contracts without controller approval.
- Multiple agents editing the same layout, schema, or config files.
- SAP write features, because they are out of MVP scope.

## 3. Target Repository Structure

Recommended structure after development starts:

```text
sap-ai-consultant-workbench/
  README.md
  docs/
    product-prototype/
    architecture/
    decisions/
    superpowers/plans/
  apps/
    desktop/
      src/
        main/
        preload/
        renderer/
  packages/
    core/
    connectors/
    knowledge/
    standards/
    ui/
  scripts/
  .gitignore
  package.json
```

The first implementation phase may keep this simpler if it reduces setup risk, but should not mix app code with product prototype documents.

## 4. Phase 0: Safety And Project Foundation

Purpose: prevent sensitive-data mistakes before code appears.

- [ ] Confirm whether to initialize Git in the current folder.
- [ ] Create `.gitignore` before any code or local data is generated.
- [ ] Ignore `.env`, `.env.*`, keys, certificates, credentials, `.sap-adt-cli/`, local data folders, workspace data, logs with secrets, and real SAP output.
- [ ] Add a short root `README.md` explaining this is a local-first SAP AI workbench MVP.
- [ ] Create an architecture decision note stating that SAP write operations are out of MVP scope.
- [ ] Verify `git status` shows only intended safe files before first commit.

Recommended owner: Controller Agent + QA/Security Agent.

Exit criteria:

- Repository safety boundaries exist.
- No sensitive local files are tracked.
- The team can safely begin building the desktop app.

## 5. Phase 1: Local Desktop Workbench Skeleton

Purpose: create the usable shell before connecting real SAP, AI, Feishu, or knowledge logic.

This phase matches the allowed first-stage scope from `NEW_THREAD_PROMPT.md`.

### 5.1 Desktop Shell

- [ ] Create Electron + React + TypeScript app skeleton.
- [ ] Ensure the desktop app launches locally on Windows.
- [ ] Create main process, preload bridge, and renderer app boundary.
- [ ] Add basic app window with top app bar.
- [ ] Keep business logic out of the renderer where possible.

Owner: Desktop Shell Agent.

### 5.2 Main Workbench UI

- [ ] Implement one unified left sidebar.
- [ ] Implement center Codex-style conversation area.
- [ ] Implement right current-case file panel.
- [ ] Implement bottom input area with task mode and model selector placeholders.
- [ ] Implement sidebar collapse and right panel collapse.
- [ ] Avoid card-heavy dashboard layout.
- [ ] Avoid unexplained icon buttons.

Owner: Workbench UI Agent + Product/UX Agent.

### 5.3 Project And Case Basics

- [ ] Define project, case, message, and file metadata model.
- [ ] Create local database or equivalent persistence for project and case basics.
- [ ] Create project flow.
- [ ] Create case flow.
- [ ] Link each case to a real local case folder.

Owner: Data/Foundation Agent.

### 5.4 Case Folder And File Tree

- [ ] Generate standard case folder structure:
  - `README.md`
  - `conversation.md`
  - `timeline.md`
  - `context_pack.md`
  - `outputs/`
  - `knowledge_candidates/`
  - `snapshots/`
  - `evidence/`
  - `technical/`
  - `metadata.json`
- [ ] Read the current case folder.
- [ ] Display the file tree in the right panel.
- [ ] Show file count.
- [ ] Do not display technical evidence as a permanent dashboard.

Owner: Case Files Agent.

### 5.5 Static Task Mode And Model Selector

- [ ] Show task modes: 问题分析, ABAP 开发, 文档生成, 画流程图.
- [ ] Show model selector grouped by provider.
- [ ] Keep it static in Phase 1.
- [ ] Do not connect real model APIs yet.

Owner: Workbench UI Agent.

### 5.6 Basic Search Entry

- [ ] Add global search entry in the left sidebar.
- [ ] Add search screen placeholder or minimal local search shell.
- [ ] Search does not need full indexing in Phase 1.

Owner: Workbench UI Agent + Data/Foundation Agent.

Exit criteria:

- App starts locally.
- User can create a project.
- User can create a case.
- A real case folder is created.
- Right panel reads files from the current case folder.
- Main UI follows the prototype structure.
- No real SAP, Feishu, or model API connection is required yet.

## 6. Phase 2: Configuration Center

Purpose: make project-level connection settings visible, testable, and safe.

### 6.1 Config UI

- [ ] Implement configuration center navigation.
- [ ] Add project overview.
- [ ] Add ADT connection screen.
- [ ] Add Feishu CLI screen.
- [ ] Add API and model screen.
- [ ] Add Codex capability screen.
- [ ] Add local storage screen.

Owner: Config Agent + Product/UX Agent.

### 6.2 Secure Config Storage

- [ ] Save non-secret config to local database.
- [ ] Save passwords, API keys, and tokens through OS secure storage.
- [ ] Never return raw secrets to UI.
- [ ] Mask secret fields.
- [ ] Prevent secrets from entering logs and case files.

Owner: Data/Foundation Agent + QA/Security Agent.

### 6.3 Validation Status

- [ ] Show statuses: 未配置, 已保存, 已验证, 失败.
- [ ] Show last validation time.
- [ ] Map failures into user-friendly messages.

Owner: Config Agent.

Exit criteria:

- User can configure project-level settings.
- Secrets are not stored in plain text tables or visible logs.
- Configuration failures show understandable reasons.

## 7. Phase 3: Read-Only Connectors

Purpose: connect real tools safely after the local workbench is stable.

### 7.1 SAP ADT Connector

- [ ] Implement connector abstraction instead of direct UI command execution.
- [ ] Support `status`.
- [ ] Support minimal read verification with `T000`.
- [ ] Support read-only object methods needed by later workflows.
- [ ] Show read-only mode clearly.
- [ ] Block SAP write, activation, delete, and transport release in MVP.

Owner: Connector Agent + QA/Security Agent.

### 7.2 Feishu CLI Connector

- [ ] Detect whether `lark-cli` exists.
- [ ] Run `doctor`.
- [ ] Verify auth status.
- [ ] Handle missing scope without repeated device-code spam.
- [ ] Capture document URLs and IDs when publishing is later enabled.

Owner: Connector Agent.

### 7.3 Model API Connector

- [ ] Support OpenAI-compatible provider config.
- [ ] Support Fengsha API relay.
- [ ] Support DeepSeek provider.
- [ ] Fetch model list.
- [ ] Run minimal chat test.
- [ ] Store model capability metadata.

Owner: Connector Agent + Config Agent.

Exit criteria:

- ADT can prove read-only access through minimal read.
- Feishu login and permission status are visible.
- Model providers can fetch model lists and run minimum tests.
- All connector errors are understandable to non-programmers.

## 8. Phase 4: Case Workflows And Agent Modes

Purpose: turn the workbench from a shell into a real SAP task workspace.

### 8.1 Conversation Persistence

- [ ] Save user and assistant messages to the current case.
- [ ] Save a cleaned `conversation.md`.
- [ ] Update `timeline.md` when major actions occur.
- [ ] Update `context_pack.md` with the most important facts.

Owner: Case Files Agent + Data/Foundation Agent.

### 8.2 Task Mode Workflows

- [ ] Implement 问题分析 mode.
- [ ] Implement ABAP 开发 mode with read-only SAP snapshot behavior.
- [ ] Implement 文档生成 mode.
- [ ] Implement 画流程图 mode.
- [ ] Each mode loads the correct standards, files, and connector permissions.

Owner: Connector Agent + Standards Agent + Workbench UI Agent.

### 8.3 File Output Policy

- [ ] Save final outputs under `outputs/`.
- [ ] Save candidate knowledge under `knowledge_candidates/`.
- [ ] Save snapshots under `snapshots/`.
- [ ] Save evidence under `evidence/`.
- [ ] Save technical logs under `technical/`.
- [ ] Reflect new files in the right panel.

Owner: Case Files Agent.

Exit criteria:

- User can start a case, ask a question, receive a response, and see generated files.
- Files are saved to the correct case folder.
- Technical materials stay as files, not permanent UI panels.

## 9. Phase 5: Standards Center

Purpose: stop the user from repeatedly restating ABAP, document, and diagram rules.

- [ ] Implement standards center screen.
- [ ] Support S4 and ECC templates.
- [ ] Support copying standards from another project.
- [ ] Store copied standards as project-owned independent copies.
- [ ] Support manual edit.
- [ ] Support save version only when content changes.
- [ ] Support diff against source template.
- [ ] Support test generation example.
- [ ] Keep advanced prompt details collapsed by default.

Owner: Standards Agent + Product/UX Agent.

Exit criteria:

- Project standards are independent.
- Changes in one project do not pollute another project.
- ABAP development mode can use the active project standards.

## 10. Phase 6: Knowledge Center And Search

Purpose: make historical cases, files, and confirmed knowledge findable without polluting the knowledge base.

### 10.1 Search

- [ ] Enable SQLite FTS5 search.
- [ ] Search projects.
- [ ] Search cases.
- [ ] Search file names.
- [ ] Search file contents.
- [ ] Search knowledge items.
- [ ] Show result source and type.

Owner: Knowledge/Search Agent + Data/Foundation Agent.

### 10.2 Knowledge Candidate Flow

- [ ] Generate candidate knowledge from case files and conversation.
- [ ] Store candidate status as 待确认.
- [ ] Allow user edit before publishing.
- [ ] Run conflict check before publishing.
- [ ] Support statuses: 草稿, 待确认, 已发布, 有冲突, 已失效.
- [ ] Never treat unconfirmed candidates as official knowledge.

Owner: Knowledge/Search Agent.

### 10.3 Document Upload And Parsing

- [ ] Upload Word, Excel, PDF, Markdown, TXT, ABAP source, Feishu links, and QA tables.
- [ ] Preserve tables structurally where possible.
- [ ] Track source, time, project, and status.
- [ ] Put parsed output into document library or pending confirmation.

Owner: Knowledge/Search Agent.

Exit criteria:

- User can search old cases and files.
- User can review candidate knowledge before publishing.
- Official knowledge has source, project, time, and status.

## 11. Phase 7: End-To-End MVP Verification

Purpose: prove the product works as a daily SAP consultant workflow.

Target scenario:

- [ ] Create project `演示 S4HANA`.
- [ ] Configure ADT.
- [ ] Verify T000 read succeeds.
- [ ] Configure model provider and fetch models.
- [ ] Create case `DEMO001 演示BOM清单`.
- [ ] Ask a business/SAP question.
- [ ] Generate conclusion.
- [ ] Generate Excel, Markdown, and Mermaid or image output.
- [ ] Show those files in the right file panel.
- [ ] Generate candidate knowledge.
- [ ] Confirm candidate knowledge into the knowledge base.
- [ ] Search and find the case, files, and knowledge item.

Owner: Controller Agent + QA/Security Agent.

Exit criteria:

- The full MVP path works on the local machine.
- No secrets are shown in UI, logs, Markdown files, screenshots, or commits.
- SAP remains read-only.
- Errors are understandable to the user.

## 12. Suggested Execution Order

Do not start by building all centers at once.

Recommended order:

1. Phase 0: safety and repository foundation.
2. Phase 1A: desktop workbench skeleton.
3. Phase 1B: minimum local case loop.
4. Phase 2: configuration center.
5. Phase 3: read-only connectors.
6. Phase 4: SAP case workflows and agent modes.
7. Phase 5: lightweight standards center.
8. Phase 6: knowledge center and search.
9. Phase 7: end-to-end MVP verification.

## 13. Suggested Detailed Plan Files To Create Later

Before actual implementation, create smaller detailed plans:

- `phase-0-safety-and-repo-plan.md`
- `phase-1a-desktop-workbench-plan.md`
- `phase-1b-minimum-case-loop-plan.md`
- `phase-2-config-center-plan.md`
- `phase-3-readonly-connectors-plan.md`
- `phase-4-case-workflows-plan.md`
- `phase-5-standards-center-plan.md`
- `phase-6-knowledge-search-plan.md`
- `phase-7-mvp-verification-plan.md`

Each detailed plan should include exact files, tests, commands, expected results, and commit checkpoints.

## 14. Risk Controls

| Risk | Control |
|---|---|
| Agents overwrite each other | One owner per module, no shared-file parallel edits |
| Scope becomes too large | Phase gates and MVP boundary checks |
| UI becomes dashboard-like | Product/UX review against Codex-style prototype |
| SAP safety issue | Read-only connector and write-operation block |
| Secret leak | `.gitignore`, secure storage, log scan, commit review |
| Knowledge pollution | Candidate-only flow until manual confirmation |
| Wrong project context | Current project/system shown before SAP reads |
| Unclear failures | User-friendly error mapping required |

## 15. First Recommended Next Step

Proceed with Phase 0 first, then Phase 1A.

After approval:

- Create the Phase 0 detailed plan.
- Execute Phase 0.
- Create the Phase 1A detailed plan.
- Execute Phase 1A using controlled subagent-driven development.
- Create the Phase 1B detailed plan for the minimum local case loop.
- Stop before connecting real SAP, Feishu, or model APIs unless Phase 1B is already verified.
