# Phase 15 Real Project And Case Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace demo-only creation with safe local project and case creation, plus explicit project/case switching.

**Architecture:** The renderer sends narrow structured inputs without paths or config objects. `WorkspaceStore` serializes state writes, generates safe IDs and folders inside `local-data/workbench`, initializes independent standards and knowledge stores, writes the active case files, and refreshes search. Demo seed data may remain for first-run state, but demo creation IPC is not exposed to the renderer.

**Tech Stack:** Electron, React, TypeScript, local JSON state, SQLite FTS search, PowerShell security preflight.

---

## File Structure

- Modify `apps/desktop/src/shared/workbenchTypes.ts`: add narrow input contracts.
- Modify `apps/desktop/src/main/workspaceStore.ts`: create real local project/case records, switch active project/case, validate IDs, update storage config.
- Modify `apps/desktop/src/main/main.ts`: register four narrow IPC channels and remove demo creation IPC exposure.
- Modify `apps/desktop/src/preload/preload.ts`: expose four bridge methods.
- Modify `apps/desktop/src/renderer/vite-env.d.ts`: type four bridge methods.
- Modify `apps/desktop/src/renderer/App.tsx`: replace demo button behavior with small local forms and clickable project/case rows.
- Modify `apps/desktop/src/renderer/styles.css`: add compact form and active project styling.
- Modify `scripts/security-preflight.ps1`: whitelist new IPC and assert lifecycle safety markers.
- Create `scripts/phase15-real-project-case-lifecycle-probe.mjs`: verify lifecycle behavior and safety boundaries.
- Create `docs/architecture/reviews/2026-07-03-phase-15-real-project-case-lifecycle-review.md`: adversarial review and evidence.

## Task 1: Shared Contracts And Store Methods

**Files:**
- Modify `apps/desktop/src/shared/workbenchTypes.ts`
- Modify `apps/desktop/src/main/workspaceStore.ts`

- [ ] **Step 1: Add narrow input types**

Add:

```ts
export interface CreateLocalProjectInput {
  name: string;
  sapVersion: Extract<ProjectSummary["sapVersion"], "S4" | "ECC">;
  systemLabel: string;
}

export interface CreateLocalCaseInput {
  projectId?: string;
  title: string;
}

export interface SwitchProjectInput {
  projectId: string;
}

export interface SwitchCaseInput {
  projectId: string;
  caseId: string;
}
```

- [ ] **Step 2: Implement validation helpers**

Add store-local helpers that:

- trim text and reject empty project or case names;
- remove control characters;
- reject strings matching `password`, `api_key`, `token`, `authorization`, `cookie`, `SAP_SESSIONID`, `MYSAPSSO2`, or `secure-store:`;
- generate IDs from names with a timestamp suffix;
- never accept caller-provided filesystem paths.

- [ ] **Step 3: Implement lifecycle methods**

Add:

```ts
async createLocalProject(input: unknown): Promise<WorkbenchState>
async createLocalCase(input: unknown): Promise<WorkbenchState>
async switchProject(input: unknown): Promise<WorkbenchState>
async switchCase(input: unknown): Promise<WorkbenchState>
```

Behavior:

- new projects start with `connectionState: "not-configured"`;
- new projects use `createProjectStandards(projectId, sapVersion, templateId)` and `createProjectKnowledge(projectId, false)`;
- new projects get one initial real case so the workbench remains usable;
- new cases are inserted into the target project and become active;
- project switching selects the project and its most recently opened case;
- case switching validates that the case belongs to the project;
- all methods call `saveState`, `ensureCaseFiles`, `refreshSearchIndex`, and return `withFiles`.

- [ ] **Step 4: Keep demo data internal only**

Keep demo seed data available for first-run compatibility, but do not expose `createDemoProject()` or `createDemoCase()` through `ipcMain`, preload, or renderer types.

## Task 2: IPC, Preload, And UI

**Files:**
- Modify `apps/desktop/src/main/main.ts`
- Modify `apps/desktop/src/preload/preload.ts`
- Modify `apps/desktop/src/renderer/vite-env.d.ts`
- Modify `apps/desktop/src/renderer/App.tsx`
- Modify `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add IPC handlers**

Register:

```ts
ipcMain.handle("workbench:create-local-project", (_event, input: unknown) => response(store.createLocalProject(input)));
ipcMain.handle("workbench:create-local-case", (_event, input: unknown) => response(store.createLocalCase(input)));
ipcMain.handle("workbench:switch-project", (_event, input: unknown) => response(store.switchProject(input)));
ipcMain.handle("workbench:switch-case", (_event, input: unknown) => response(store.switchCase(input)));
```

- [ ] **Step 2: Expose bridge methods**

Add the same four methods to preload and renderer types. Do not expose any path, command, shell, dialog, URL, SQL, SAP, or Feishu publish method.

- [ ] **Step 3: Update project creation UI**

Add compact fields in the sidebar:

- project name;
- SAP version select: `S4`, `ECC` only;
- system label.

The create button sends only `{ name, sapVersion, systemLabel }`.

- [ ] **Step 4: Update case creation and switching UI**

Add a compact case title field. The new case button sends `{ projectId, title }`. Project and case rows call switch APIs and update the active state.

- [ ] **Step 5: Keep UI modest**

No new dashboard, no destructive delete, no cloud actions, no document upload, no SAP write action, no Feishu publish wording.

## Task 3: Probes, Security Preflight, And Review

**Files:**
- Create `scripts/phase15-real-project-case-lifecycle-probe.mjs`
- Modify `scripts/security-preflight.ps1`
- Create `docs/architecture/reviews/2026-07-03-phase-15-real-project-case-lifecycle-review.md`

- [ ] **Step 1: Add probe**

The probe imports the built main store and verifies:

- creating two local projects gives unique IDs and directories under `local-data/workbench/projects`;
- new projects have empty non-demo knowledge and independent standards;
- creating cases writes the expected case folder files;
- switching project/case updates `activeProjectId`, `activeCaseId`, and `activeCaseFiles`;
- search finds the created project and case;
- path attack fields such as `../escape`, absolute paths, `.sap-adt-cli`, `.env`, `password=`, and `token=` are rejected.
- concurrent project/case creation preserves every record and leaves no atomic-write temp files;
- `projectId` / `caseId` containing slashes, colons, traversal, or suffix tricks are rejected directly instead of being sanitized into another ID;
- `UNKNOWN` SAP version is rejected for new projects;
- demo creation IPC is absent from main, preload, and renderer type exposure;
- `localStorage.casesDir` follows the active case after creation and switching.
- legacy `app-state.json` with stale `localStorage.casesDir` is normalized and written back so `app-state.json` and `project.json` agree.

- [ ] **Step 2: Update security preflight**

Add new IPC channels to the whitelist and add markers for:

- `createLocalProject`;
- `createLocalCase`;
- `switchProject`;
- `switchCase`;
- `parseCreateLocalProjectInput`;
- `parseCreateLocalCaseInput`;
- `assertSafeLifecycleText`;
- `assertStrictLifecycleId`;
- `runExclusive`;
- no demo creation IPC exposure;
- no `showOpenDialog`, no delete, no shell openers, no SAP write, no Feishu publish.

- [ ] **Step 3: Write adversarial review**

Document risks and mitigations:

- path traversal through IDs;
- cross-project case switching;
- demo data leaking into real projects;
- knowledge auto-publish;
- accidental SAP/Feishu/model side effects;
- search pointing to the wrong active case.

## Verification

Run these commands before commit:

```powershell
npm run check
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase12-sap-readonly-evidence-probe.mjs
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
node scripts\phase14-feishu-safe-handoff-probe.mjs
node scripts\phase15-real-project-case-lifecycle-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

## Commit

```powershell
git add apps/desktop/src scripts docs/superpowers/plans docs/architecture/reviews
git commit -m "feat: add real local project and case lifecycle"
```
