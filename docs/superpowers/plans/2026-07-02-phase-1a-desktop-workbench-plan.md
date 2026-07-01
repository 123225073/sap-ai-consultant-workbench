# Phase 1A Desktop Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable local desktop shell for SAP AI 顾问工作台 with the Codex-style three-panel workbench and static interaction placeholders.

**Architecture:** Keep Phase 1A intentionally thin: Electron owns the local desktop window, preload exposes a minimal safe app metadata bridge, and React renders a static workbench using sanitized demo data. No SAP, Feishu, model API, database, or file-system mutation is introduced in this phase.

**Tech Stack:** Electron, Vite, React, TypeScript, CSS, Lucide React.

---

## File Structure

Create:

```text
package.json
package-lock.json
tsconfig.json
apps/desktop/package.json
apps/desktop/index.html
apps/desktop/vite.config.ts
apps/desktop/tsconfig.json
apps/desktop/src/main/main.ts
apps/desktop/src/preload/preload.ts
apps/desktop/src/renderer/main.tsx
apps/desktop/src/renderer/App.tsx
apps/desktop/src/renderer/styles.css
apps/desktop/src/renderer/vite-env.d.ts
```

Responsibilities:

| File | Responsibility |
|---|---|
| `package.json` | Root scripts for install, dev, build, and checking |
| `apps/desktop/src/main/main.ts` | Electron app window only |
| `apps/desktop/src/preload/preload.ts` | Safe bridge with app metadata only |
| `apps/desktop/src/renderer/App.tsx` | Static Phase 1A workbench UI |
| `apps/desktop/src/renderer/styles.css` | Layout, responsive constraints, Codex-style visual system |

## Task 1: Package And Build Foundation

- [x] Create root package scripts.
- [x] Create desktop package config.
- [x] Configure Vite for React renderer and Electron main/preload builds.
- [x] Install dependencies.
- [x] Verify `npm run build` succeeds.

Expected scripts:

```json
{
  "dev": "npm --workspace apps/desktop run dev",
  "build": "npm --workspace apps/desktop run build",
  "check": "npm --workspace apps/desktop run check"
}
```

## Task 2: Electron Desktop Shell

- [x] Create main Electron process.
- [x] Create preload bridge.
- [x] Use secure defaults: context isolation on, node integration off.
- [x] Load Vite dev server in dev mode.
- [x] Load built HTML in production mode.

Acceptance:

- Desktop app can launch locally.
- Renderer cannot access Node directly.
- Window title is `SAP AI 顾问工作台`.

## Task 3: Static Workbench UI

- [x] Render top desktop app bar.
- [x] Render left unified sidebar.
- [x] Render center Codex-style conversation area.
- [x] Render right current-case file panel.
- [x] Render bottom input with static task mode and model selector.
- [x] Use sanitized demo project and case names only.
- [x] Keep all buttons explainable.

Acceptance:

- UI matches the product prototype structure.
- No card-heavy dashboard.
- No real customer/project/SAP identifiers.
- No real connection status claims beyond demo read-only labels.

## Task 4: Responsive And UX Guardrails

- [x] Keep left sidebar and right panel stable.
- [x] Center conversation keeps usable width.
- [x] Text does not overlap in desktop-sized windows.
- [x] Right panel is visually tied to the current case.
- [x] Technical evidence is not permanently displayed.

Acceptance:

- Workbench is readable at common desktop widths.
- Main work area is conversation-first.

## Task 5: Verification And Adversarial Review

Run:

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
Run a business-label scan for old real-looking customer, system, client, user, and custom object names before committing.
```

Expected:

- Build passes.
- Security preflight passes.
- Business-label scan returns no matches.

Review:

- [x] No SAP write, activation, deletion, or transport release UI exists.
- [x] No login, SaaS, team, or permission system exists.
- [x] No API key, SAP password, or Feishu token field exists in Phase 1A.
- [x] UI remains Codex-style, not a dashboard.
- [x] Phase 1A does not pretend ADT, model, or Feishu is truly connected.
