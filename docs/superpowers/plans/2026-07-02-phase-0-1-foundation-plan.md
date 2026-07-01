# Phase 0-1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely initialize the GitHub-backed repository and prepare Phase 1A/1B workbench planning without connecting real SAP, Feishu, or model APIs.

**Architecture:** Phase 0 locks safety, repository, and collaboration rules first. Phase 1 then creates a local Electron + React + TypeScript workbench with project, case, and file-folder foundations before any external connectors are introduced.

**Tech Stack:** Git, Markdown governance docs, Electron, React, TypeScript, SQLite or a temporary local persistence layer only if chosen in the Phase 1 detailed implementation.

---

## Task 0: Repository Safety Gate

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `docs/architecture/FIRST_PRINCIPLES_STRATEGY.md`
- Create: `docs/architecture/ADVERSARIAL_AUDIT_MATRIX.md`
- Create: `docs/architecture/MULTI_AGENT_EXECUTION_MODEL.md`
- Create: `docs/architecture/FEATURE_ADVERSARIAL_REVIEW_TEMPLATE.md`

- [x] Add ignore rules for environment files, keys, SAP ADT config, Feishu state, local data, runtime databases, logs, worktrees, build outputs, and editor files.
- [x] Add root README explaining product purpose, MVP boundaries, document entry points, and safety rules.
- [x] Add first-principles strategy.
- [x] Add adversarial audit matrix.
- [x] Add multi-agent execution model.
- [x] Add feature adversarial review template.
- [x] Run ignore-rule verification.
- [x] Run `scripts/security-preflight.ps1`.
- [x] Commit and push Phase 0 if scan is clean.

## Task 1: GitHub Connection

**Repository:**
- Remote: `https://github.com/123225073/sap-ai-consultant-workbench.git`
- Branch: `main`

- [x] Initialize Git repository.
- [x] Add GitHub remote.
- [x] Verify remote is reachable.
- [x] Create first safe commit.
- [x] Push `main` to GitHub.

## Task 2: Phase 1A Detailed Plan

**Files:**
- Create later: `docs/superpowers/plans/2026-07-02-phase-1a-desktop-workbench-plan.md`

The Phase 1A detailed plan must define:

- App skeleton files.
- Project/case/file data contracts.
- Case folder structure.
- Workbench UI component boundaries.
- IPC boundary.
- Test commands.
- Manual verification steps.
- Adversarial review checklist.

Do not start Phase 1A implementation until Phase 0 is committed and pushed.

## Task 3: Phase 1A Non-Negotiable Scope

Phase 1A may include:

- Desktop app launch.
- Left unified sidebar.
- Center Codex-style conversation shell.
- Right current-case file panel.
- Bottom input with static task mode and model selector.
- Create project.
- Create case.
- Create case folder.
- Read case file tree.
- Basic search entry.

Phase 1A must not include:

- Real SAP ADT connection.
- SAP writing.
- Feishu publishing.
- Real model API calls.
- Knowledge auto-publishing.
- Team/login/cloud features.

## Task 4: Phase 1B Minimum Local Case Loop

**Files:**
- Create later: `docs/superpowers/plans/2026-07-02-phase-1b-minimum-case-loop-plan.md`

Phase 1B may include:

- Persist project, case, case messages, and case files.
- Save `conversation.md`, `timeline.md`, and `context_pack.md`.
- Generate safe local sample output files for a case.
- Read files back in the right panel.
- Search local cases and file names.

Phase 1B must not include:

- Real SAP ADT reads.
- Real model API calls.
- Real Feishu publishing.
- Formal knowledge publishing.
