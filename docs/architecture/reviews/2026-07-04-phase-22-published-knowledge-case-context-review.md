# Phase 22 Published Knowledge Case Context Review

## Review Scope

Phase 22 adds a manual action that references one published knowledge item in the current active case context. The review focuses on whether non-published knowledge, cross-project knowledge, full knowledge content, or unsafe capabilities can enter the case context.

## Adversarial Findings

| Attack / failure mode | Result |
| --- | --- |
| Attach pending, draft, conflicted, or expired knowledge | Blocked by `createCaseKnowledgeReference` requiring `status === "published"` and by the Phase 22 probe. |
| Attach a knowledge item from another project | Blocked by active-project lookup and explicit `knowledgeItem.projectId === project.id` check. |
| Duplicate attach bloats the case context | Same item remains one case reference; duplicate attach updates the attach time only. |
| Full knowledge body leaks into model-facing context | `context_pack.md` and `metadata.json` use `CaseKnowledgeReference`, which carries title, summary, source, SAP object labels, publish time, and attach time only. Probe checks the body sentinel is absent. |
| Polluted local state injects fake references | Fixed after adversarial review: case references are rebuilt from the current project's published knowledge on load; missing, unreviewed, non-published, wrong-project, or unsafe references are pruned and the cleaned state is persisted. |
| Source file path leaks into case metadata | Fixed after adversarial review: case references now store `sourceFilePath: null`; user-facing context keeps only source type/source case and safe summary. |
| Published but unreviewed knowledge is reused | Fixed after product review: reuse now requires a human review record, not just `status === "published"`. |
| Attach path gains SAP, Feishu, network, shell, file-open, or delete capability | Security preflight and the Phase 22 probe scan attach blocks for those markers. |
| UI implies unreviewed knowledge can be reused | The renderer button is disabled unless the selected item is `published` and has a human review record; backend remains authoritative. |
| User-facing outputs expose internal phase/source strings | Fixed after product review: timeline uses plain text and source values render as friendly labels; the phase marker is kept only in metadata/tests. |

## Verification Commands

```powershell
npm run check
node scripts\phase22-published-knowledge-case-context-probe.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\security-preflight.ps1
git diff --check
```

## Decision

Phase 22 is acceptable for the local-first MVP because it completes the human-reviewed knowledge reuse loop while preserving published-only, same-project, summary-only, and no-external-action boundaries.
