# Phase 26 Project Visible List Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user remove a project from the left sidebar's current visible project list without deleting project data, case files, config, standards, knowledge, SAP evidence, or Feishu draft records.

**Architecture:** Reuse the existing `ProjectSummary.isVisible` and `visibleOrder` fields. Add one narrow main-process operation that marks a project hidden, keeps all state and files intact, and switches to another visible project when the hidden project was active. The renderer only filters the sidebar list and exposes a clearly labeled hide action.

**Tech Stack:** Electron IPC, React + TypeScript, CSS, Node/esbuild probe scripts, PowerShell security preflight.

---

## Scope

In scope:

- Add a safe `hideProjectFromSidebar` lifecycle operation.
- Add preload, renderer typing, and main-process IPC for the new operation.
- Render only `project.isVisible !== false` projects in the left sidebar.
- Add a visible per-project action labeled as hiding/removing from the sidebar, not deleting.
- If the active project is hidden, switch to the next visible project and latest case.
- Block hiding the last visible project so the sidebar cannot become unrecoverable in this phase.
- Preserve hidden project data in state, search index, project metadata files, standards, knowledge, and case folders.
- Add a Phase 26 probe and security-preflight markers.
- Record product and security adversarial review.

Out of scope:

- No project deletion.
- No hidden-project restore UI.
- No batch hide/delete.
- No SAP write, activation, transport release, or ADT mutation.
- No Feishu cloud publish, sync, or document creation.
- No model/API execution.
- No redesign of project settings, search routing, or renderer state contract.

## File Structure

- Modify `apps/desktop/src/shared/workbenchTypes.ts`
  - Add `HideProjectFromSidebarInput`.
- Modify `apps/desktop/src/main/workspaceStore.ts`
  - Add strict input parsing and `hideProjectFromSidebar`.
- Modify `apps/desktop/src/main/main.ts`
  - Register the narrow IPC handler.
- Modify `apps/desktop/src/preload/preload.ts`
  - Expose the bridge method.
- Modify `apps/desktop/src/renderer/vite-env.d.ts`
  - Type the renderer bridge method.
- Modify `apps/desktop/src/renderer/App.tsx`
  - Filter visible projects and add a clear hide-from-sidebar button.
- Modify `apps/desktop/src/renderer/styles.css`
  - Add compact project action styling.
- Create `scripts/phase26-project-visible-list-removal-probe.mjs`
  - Verify markers, runtime behavior, no deletion, no unsafe IPC or capabilities.
- Modify `scripts/security-preflight.ps1`
  - Add Phase 26 markers and forbidden delete/SAP/Feishu scans.
- Create `docs/architecture/reviews/2026-07-04-phase-26-project-visible-list-removal-review.md`
  - Record adversarial review, fixes, verification, and residual risks.

## Tasks

### Task 1: Add Safe Main-Process Hide Operation

**Files:**
- Modify: `apps/desktop/src/shared/workbenchTypes.ts`
- Modify: `apps/desktop/src/main/workspaceStore.ts`

- [x] **Step 1: Add the shared input type**

Add:

```ts
export interface HideProjectFromSidebarInput {
  projectId: string;
}
```

- [x] **Step 2: Add strict input parsing**

Add a parser equivalent to `parseSwitchProjectInput`:

```ts
function parseHideProjectFromSidebarInput(input: unknown): HideProjectFromSidebarInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Hide project request is invalid.");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "projectId") {
    throw new Error("Hide project request may only contain projectId.");
  }
  const projectId = assertStrictLifecycleId("Project ID", (input as Partial<HideProjectFromSidebarInput>).projectId);
  return { projectId };
}
```

- [x] **Step 3: Implement `hideProjectFromSidebar`**

Behavior:

```text
find target project
reject unknown project
reject already hidden project
reject if it is the only visible project
set target.isVisible = false
update target.updatedAt
if target was active, switch to the first remaining visible project by visibleOrder/name and its latest case
save app state
write hidden project's project metadata so isVisible persists
ensure files and search index still see all projects
return withFiles(state)
```

The method must not remove items from `state.projects`, must not call `fs.rm`, `fs.unlink`, or `delete`, and must not touch SAP, Feishu, API, secret-store, knowledge publish, or case-file generation code.

### Task 2: Wire The Narrow IPC Surface

**Files:**
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `apps/desktop/src/preload/preload.ts`
- Modify: `apps/desktop/src/renderer/vite-env.d.ts`

- [x] **Step 1: Register main handler**

Add:

```ts
ipcMain.handle("workbench:hide-project-from-sidebar", (event, input: unknown) => trustedResponse(event, appRoot, () => store.hideProjectFromSidebar(input)));
```

- [x] **Step 2: Expose preload bridge**

Add:

```ts
hideProjectFromSidebar: (input: HideProjectFromSidebarInput): Promise<WorkbenchResponse<WorkbenchState>> => ipcRenderer.invoke("workbench:hide-project-from-sidebar", input),
```

- [x] **Step 3: Type renderer bridge**

Add the same method to `WorkbenchBridge` and import `HideProjectFromSidebarInput`.

### Task 3: Update Sidebar UI

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [x] **Step 1: Compute visible projects**

Use:

```ts
const visibleProjects = (state?.projects ?? [])
  .filter((item) => item.isVisible !== false)
  .sort((a, b) => a.visibleOrder - b.visibleOrder || a.name.localeCompare(b.name, "zh-CN"));
```

- [x] **Step 2: Add a hide action**

Add a handler that calls the bridge and uses user-facing copy:

```text
Project hidden from the sidebar only. Its cases, files, config, standards, and knowledge are still saved.
```

Render an icon button with an `EyeOff` icon and title:

```text
Remove from sidebar only, without deleting project files
```

- [x] **Step 3: Filter sidebar list only**

Replace `(state?.projects ?? []).map(...)` in the sidebar with `visibleProjects.map(...)`.

Do not filter the project arrays passed to Standards Center or Knowledge Center in this phase.

- [x] **Step 4: Add compact styling**

Keep the action inside the existing project card title area, with stable button dimensions and no new dashboard panel.

### Task 4: Add Probe And Preflight Coverage

**Files:**
- Create: `scripts/phase26-project-visible-list-removal-probe.mjs`
- Modify: `scripts/security-preflight.ps1`

- [x] **Step 1: Create runtime/static probe**

The probe must:

- bundle `WorkspaceStore`;
- create two local projects;
- call `hideProjectFromSidebar` on the active project;
- assert the target remains in `state.projects`;
- assert the target has `isVisible === false`;
- assert its project directory and first case directory still exist;
- assert active project switches to a visible remaining project;
- assert hiding the last visible project rejects;
- assert unsafe IDs are rejected;
- assert renderer uses `visibleProjects`;
- assert IPC/preload markers exist;
- assert no Phase 26 code contains `fs.rm`, `fs.unlink`, SAP write, Feishu sync/publish, transport release, or `workbench:delete-project`.

- [x] **Step 2: Extend preflight**

Add a Phase 26 block that checks:

```text
hideProjectFromSidebar
parseHideProjectFromSidebarInput
workbench:hide-project-from-sidebar
visibleProjects
phase26-project-visible-list-removal-probe
```

Add forbidden scans for:

```text
workbench:delete-project
fs.rm
fs.unlink
deleteProject
release transport
activate object
feishu publish
```

### Task 5: Adversarial Review, Verification, Commit, And Push

**Files:**
- Create: `docs/architecture/reviews/2026-07-04-phase-26-project-visible-list-removal-review.md`

- [x] **Step 1: Record product review**

The review must check that users can understand the action as a sidebar hide, not data deletion, and that the app does not leave them with no visible projects.

- [x] **Step 2: Record security review**

The review must prove no project files, case files, configs, standards, knowledge, secrets, SAP evidence, or Feishu records are deleted or exposed.

- [x] **Step 3: Run focused verification**

```powershell
npm run check
node scripts\phase26-project-visible-list-removal-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [x] **Step 4: Run regression and build**

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
node scripts\phase26-project-visible-list-removal-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

- [ ] **Step 5: Commit and push**

```powershell
git add apps/desktop/src/shared/workbenchTypes.ts apps/desktop/src/main/workspaceStore.ts apps/desktop/src/main/main.ts apps/desktop/src/preload/preload.ts apps/desktop/src/renderer/vite-env.d.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/styles.css scripts/phase26-project-visible-list-removal-probe.mjs scripts/security-preflight.ps1 docs/superpowers/plans/2026-07-04-phase-26-project-visible-list-removal-plan.md docs/architecture/reviews/2026-07-04-phase-26-project-visible-list-removal-review.md
git commit -m "feat: hide projects from sidebar"
git push
```

## Self-Review

- Spec coverage: Implements the PRD requirement that a visible project can be removed from the current visible list.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: Uses existing `ProjectSummary.isVisible` and `visibleOrder` and adds one matching input type.
- Boundary consistency: This is a hide-only operation; deletion, SAP mutation, Feishu publish, and hidden-project restore are out of scope.
