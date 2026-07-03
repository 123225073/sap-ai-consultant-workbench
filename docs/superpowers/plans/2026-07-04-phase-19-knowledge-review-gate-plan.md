# Phase 19 Knowledge Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Phase 16 local-text knowledge candidates to become published knowledge only after an explicit human review record and a fresh publish-time safety check.

**Architecture:** Keep the Phase 16 import firewall intact. Add a narrow review action that records reviewer, review note, and review time on the knowledge item; then make publish require that review record for imported local-text candidates while preserving conflict, expired, published, and sensitive-content blocks.

**Tech Stack:** Electron, React, TypeScript, Node/esbuild probe scripts, PowerShell security preflight.

---

## Scope

Allowed in Phase 19:

- show review state, review note, SAP object tags, source, status, project, and content preview in the knowledge detail panel;
- add one explicit human review action for pending imported local-text candidates;
- require a non-empty review note before imported local-text candidates can be published;
- re-run sensitive-content checks at review and publish time;
- keep conflicted, expired, already-published, and conflict-linked knowledge blocked;
- update timeline, project knowledge JSON/Markdown, and search index after review and publish;
- add a Phase 19 probe and security preflight markers.

Blocked in Phase 19:

- no file picker, arbitrary path read, Word/PDF/Excel parsing, or generic document upload;
- no SAP write, SQL/Data Preview expansion, activation, transport, or generic SAP browser;
- no Feishu auth, sync, create, update, publish, or device-code flow;
- no automatic knowledge publish;
- no deletion or replacement of knowledge history;
- no copying from the old SAP ABAP workspace.

## File Structure

- Modify `apps/desktop/src/shared/workbenchTypes.ts`: add review metadata to knowledge items and add `KnowledgeReviewInput`.
- Modify `apps/desktop/src/main/knowledgeService.ts`: parse review input, record review events, and enforce reviewed-before-publish for Phase 16 imported candidates.
- Modify `apps/desktop/src/main/workspaceStore.ts`: add a narrow `reviewKnowledgeForPublish` store method and persist/search-refresh the result.
- Modify `apps/desktop/src/main/main.ts`: add one trusted IPC handler for the review action.
- Modify `apps/desktop/src/preload/preload.ts` and `apps/desktop/src/renderer/vite-env.d.ts`: expose the review action without exposing secrets or generic file access.
- Modify `apps/desktop/src/renderer/App.tsx`: bridge the review action and user notice.
- Modify `apps/desktop/src/renderer/KnowledgeCenter.tsx`: add review-note UI and gate the publish button.
- Modify `apps/desktop/src/renderer/styles.css`: style the review gate within the existing knowledge detail panel.
- Create `scripts/phase19-knowledge-review-gate-probe.mjs`: prove review-before-publish, conflict/expired/published blocks, sensitive rechecks, persistence, search, and no unsafe capabilities.
- Modify `scripts/security-preflight.ps1`: whitelist the review IPC and add Phase 19 safety markers.
- Create `docs/architecture/reviews/2026-07-04-phase-19-knowledge-review-gate-review.md`: adversarial review and verification evidence.

## Tasks

- [x] Add knowledge review types and backend state transition.
- [x] Wire the review action through store, main IPC, preload, and renderer types.
- [x] Update the Knowledge Center detail panel so imported candidates require an explicit review note before publish.
- [x] Add Phase 19 probe coverage and security preflight markers.
- [x] Write the adversarial review.
- [x] Run full verification, then commit and push the Phase 19 branch.
