# Phase 17 Renderer Trust And File Tree Boundary Adversarial Review

## Scope

Phase 17 hardens two local security boundaries before adding more product capability:

- every `workbench:*` IPC call must come from the trusted local renderer;
- the current-case file tree must not follow symlinks or junctions outside the active case.

This phase does not add Codex task execution, SAP write, Feishu publish, arbitrary file upload, arbitrary path read, URL proxy, generic command execution, or delete.

## Multi-Agent Inputs

| Agent | Finding | Decision |
|---|---|---|
| Product/UX review | The largest UX gap is the bottom model selector: it is not yet searchable or grouped by provider. | Logged for Phase 18. Useful, but lower priority than a real IPC trust boundary before adding more controls. |
| Product roadmap review | Phase 17 could be the local knowledge candidate review gate after Phase 16 ingestion. | Logged for Phase 18/19. It should not be built until the IPC and file tree boundary are harder. |
| Security review | Important: IPC handlers expose `window.workbench` without checking caller origin; file tree uses `stat` while preview uses `lstat + realpath`. | Adopted. Phase 17 adds trusted renderer checks, navigation denial, and file tree symlink/junction skipping. |

## Threat Model

| Risk | Attack Or Failure | Mitigation |
|---|---|---|
| Untrusted page calls local APIs | A non-workbench page is loaded and uses the preload bridge to invoke project, case, SAP evidence, knowledge, or config IPC. | All handlers now route through `trustedResponse`, which calls `assertTrustedRendererEvent`. Only packaged `file://.../dist/renderer/` or the configured loopback dev origin is accepted. |
| Development URL abuse | `ELECTRON_RENDERER_URL` points at a remote host. | The app only treats HTTP loopback hosts as trusted development origins. External HTTP/HTTPS origins are rejected. |
| Navigation escape | A link or script navigates the main window to untrusted content. | `setWindowOpenHandler` denies new windows, and `will-navigate` prevents untrusted top-level navigation. |
| File tree follows symlink | A case directory contains a symlink/junction to external files; the tree reports external filenames, sizes, or times. | `readDirectory` uses `fs.lstat(absolutePath)`, skips `stats.isSymbolicLink()`, and verifies realpath containment before returning metadata or descending. |
| Case root is replaced | The whole active case folder is replaced by a junction to an outside directory before file tree, preview, or file writes run. | `safeCaseRootForAccess` checks project, cases, and case directories with `lstat`, rejects symlink/non-directory nodes, and confirms the real case path stays under the real project `cases` root. |
| Preview/tree mismatch | Preview blocks symlinks, but tree still lists them as case files. | File tree now matches preview's boundary model and skips non-ordinary or out-of-root entries. |
| Over-expansion | Fix becomes a generic file security refactor or new external integration. | Phase 17 edits stay limited to IPC trust, navigation trust, file tree boundary, probes, preflight, and review docs. |

## Positive Capability List

Allowed:

- trusted packaged renderer IPC;
- trusted loopback dev renderer IPC when `ELECTRON_RENDERER_URL` is loopback;
- safe current-case file tree reading for ordinary files/directories;
- existing safe preview behavior;
- existing Phase 11-16 product flows.

Blocked:

- IPC from external web origins;
- packaged `file://` pages outside `dist/renderer`;
- unexpected new windows and untrusted navigation;
- symlink/junction entries in the case file tree or at the case root;
- arbitrary file, command, SAP, Feishu, or network broadening.

## Verification Targets

- `scripts/phase17-renderer-trust-filetree-probe.mjs` proves trusted renderer URL decisions, every workbench IPC uses `trustedResponse`, navigation markers exist, file tree boundary markers exist, symlink/junction entries are skipped, preview rejects the symlink path, and `getCaseFiles()` rejects a symlinked active case root.
- `scripts/security-preflight.ps1` now checks trusted renderer markers, wrapper coverage for all `workbench:*` IPC handlers, file tree symlink/root markers, and the Phase 17 probe marker.
- Existing Phase 11-16 probes continue to prove no regression to safe model drafts, SAP read-only evidence, real ADT fixed GET, Feishu local-only handoff, project/case lifecycle, and document ingestion firewall.

## Residual Risk

This is still a local desktop app. A malicious local process with filesystem access can modify local files. Phase 17 does not try to solve host compromise; it ensures this app does not treat untrusted renderer pages or symlink/junction escapes as valid workbench inputs.

## Review Result

Approved for Phase 17 scope after verification passes. The next product-facing candidate is the bottom model selector or the local knowledge candidate review gate, but both should build on this hardened IPC/file-tree boundary.
