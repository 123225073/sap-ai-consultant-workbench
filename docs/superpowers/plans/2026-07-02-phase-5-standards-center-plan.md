# Phase 5 Standards Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local standards center so each project owns independent ABAP, document, and diagram standards, and ABAP task mode can reference the active project standards.

**Architecture:** Keep standards local to the project under `local-data/workbench/projects/<project>/standards/`. The renderer edits project-owned copies through narrow IPC methods. The main process validates content, prevents secret-like standards text, writes standards files, and exposes only safe project state back to the UI. No SAP write, model call, Feishu publish, or knowledge auto-publish is introduced.

**Tech Stack:** Electron main process, React + TypeScript renderer, local JSON/file persistence, existing PowerShell security preflight.

---

## File Structure

- `apps/desktop/src/shared/workbenchTypes.ts`
  - Add standards template, category, profile, diff, and save/copy input contracts.
- `apps/desktop/src/main/standardsService.ts`
  - Define S4/ECC templates, validation, normalization, diff generation, summary rendering, and safe file rendering.
- `apps/desktop/src/main/workspaceStore.ts`
  - Store project standards as independent project copies.
  - Add template copy and save methods.
  - Write standards JSON/Markdown under the active project folder.
  - Include active standards metadata in local ABAP task outputs.
- `apps/desktop/src/main/main.ts`
  - Add narrow standards IPC handlers only.
- `apps/desktop/src/preload/preload.ts`
  - Expose standards copy/save methods.
- `apps/desktop/src/renderer/vite-env.d.ts`
  - Match bridge typing.
- `apps/desktop/src/renderer/StandardsCenter.tsx`
  - Add project standards UI: template copy, category edit, diff, version, and save.
- `apps/desktop/src/renderer/App.tsx`
  - Add navigation into standards center.
  - Update Phase wording to Phase 5.
- `apps/desktop/src/renderer/styles.css`
  - Add standards center layout styles consistent with the existing workbench.
- `scripts/security-preflight.ps1`
  - Whitelist narrow standards IPC.
  - Add standards safety marker and unsafe pattern scans.
- `docs/architecture/reviews/2026-07-02-phase-5-standards-center-review.md`
  - Record product, UX, security, and verification review.

## Task 1: Shared Standards Contract And Service

- [x] Add standards shared types for templates, categories, profile, diff, save input, and copy input.
- [x] Create `standardsService.ts`.
- [x] Define S4 and ECC starter templates.
- [x] Normalize old project state to a safe project-owned standards copy.
- [x] Validate standards text for obvious secrets, auth artifacts, and unreasonable size.
- [x] Generate a diff summary between source template and project copy.
- [x] Render standards JSON and Markdown with safety markers.

Expected check:

```powershell
npm run check
```

## Task 2: Main Process Persistence And IPC

- [x] Add `standards` to each project state.
- [x] Add `copyProjectStandardsTemplate(projectId, input)`.
- [x] Add `copyProjectStandardsFromProject(projectId, input)`.
- [x] Add `saveProjectStandards(projectId, input)`.
- [x] Persist `standards/project-standards.json` and `standards/project-standards.md`.
- [x] Add narrow IPC handlers: `workbench:get-project-standards`, `workbench:standards-copy-template`, `workbench:standards-copy-project`, `workbench:standards-save`.
- [x] Keep standards writes inside the current local workspace and project folder.

Expected check:

```powershell
npm run check
```

## Task 3: Renderer Standards Center

- [x] Add `StandardsCenter.tsx`.
- [x] Add navigation from the left sidebar.
- [x] Show current project, source template, version, copied time, updated time, and category count.
- [x] Let the user copy S4/ECC templates into the project.
- [x] Let the user copy standards from another visible project into the current project.
- [x] Let the user edit category text and save a new project version.
- [x] Show diff status per category without turning the screen into a dashboard.
- [x] Explain locally that ABAP task mode uses the active project standards.

Expected checks:

```powershell
npm run check
npm run build
```

## Task 4: ABAP Mode Standards Link

- [x] Include active standards version and category summary in ABAP local output metadata.
- [x] Avoid copying full standards text into assistant chat responses.
- [x] Keep generated case files local and under the current case folder.

Expected runtime check:

```powershell
# Use a temp workspace to copy a template, edit standards, send an ABAP task,
# and confirm generated metadata references the active standards version.
```

## Task 5: Adversarial Review, Verification, Commit, And Push

- [x] Dispatch product/UX and security/architecture read-only review agents.
- [x] Fix must-fix findings.
- [x] Create `docs/architecture/reviews/2026-07-02-phase-5-standards-center-review.md`.
- [x] Run final verification.
- [ ] Commit as `feat: add project standards center`.
- [ ] Run clean-tree security preflight.
- [ ] Push `phase-5-standards-center`.

Expected commands:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
git add .
git commit -m "feat: add project standards center"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
git push -u origin phase-5-standards-center
```
