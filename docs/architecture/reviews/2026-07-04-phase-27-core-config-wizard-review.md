# Phase 27 Core Config Wizard Review

Date: 2026-07-04

## Scope

Phase 27 simplifies the existing configuration center into a first-use setup surface. It changes visible layout and copy only, while keeping existing project config, secret storage, ADT verification, Feishu CLI verification, and model provider verification contracts.

It does not add new IPC, SAP write access, Feishu publish/auth flow, model execution shortcuts, arbitrary file reads, command execution, or cloud sync.

## Intended Boundary

```text
required fields visible -> advanced details folded -> existing save/test callbacks reused
```

## Initial Adversarial Risks

| Risk | Control |
|---|---|
| Simplified UI accidentally hides the need to save before testing | Keep explicit `保存配置` and disable test when unsaved config exists. |
| Password/API Key enter normal project config | Keep secret inputs in component state and route only to `onSaveSecret`. |
| Read-only ADT wording becomes a generic SAP connection promise | Label SAP action as read-only and keep detailed T000 report folded. |
| Feishu setup sounds like cloud publishing | Use CLI test language only and keep publish/auth markers absent. |
| Model save becomes usable before verification | Preserve existing model selector gates and verification statuses. |
| Advanced details are removed instead of folded | Keep existing report components rendered inside details. |
| Refactor adds new IPC or connector shortcuts | Phase 27 probe and security preflight forbid new IPC and risky names. |

## Verification Plan

```powershell
npm run check
node scripts\phase27-core-config-wizard-probe.mjs
node scripts\phase11-safe-model-case-execution-probe.mjs
node scripts\phase13-real-adt-readonly-evidence-probe.mjs
node scripts\phase14-feishu-safe-handoff-probe.mjs
node scripts\phase18-composer-model-selector-probe.mjs
node scripts\phase26-project-visible-list-removal-probe.mjs
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

## Observed Results

- `npm run check`: passed.
- `node scripts\phase27-core-config-wizard-probe.mjs`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1`: passed.
- `node scripts\phase11-safe-model-case-execution-probe.mjs`: passed.
- `node scripts\phase13-real-adt-readonly-evidence-probe.mjs`: passed.
- `node scripts\phase14-feishu-safe-handoff-probe.mjs`: passed.
- `node scripts\phase18-composer-model-selector-probe.mjs`: passed.
- `node scripts\phase26-project-visible-list-removal-probe.mjs`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Residual Risk

- This phase simplifies the setup surface but does not make real SAP or model credentials available in the repository. User testing with local credentials is still required.
- Feishu remains optional and folded. A later Feishu block should provide a clearer local draft workflow after the SAP and AI setup path is accepted.
- Some lower-level diagnostic terms remain inside folded verification details for troubleshooting. They are no longer part of the primary setup path.
