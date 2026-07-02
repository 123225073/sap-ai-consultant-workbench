# Phase 8 Real Case Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current local case workflow from phase-labeled demo text into useful, traceable local case outputs for each task mode.

**Architecture:** Keep Phase 8 deterministic and local-first: no real SAP read, no model call, no Feishu publish, and no new IPC. `caseWorkflowService.ts` owns output templates and traceability content, `WorkspaceStore` keeps the current guarded file-write path, and the renderer only updates user-facing copy so the app is honest about local draft output.

**Tech Stack:** Electron main process, React + TypeScript renderer, local filesystem case folders, existing JSON/SQLite search mirror, existing PowerShell security preflight.

---

## 1. First-Principles Decision

The next highest-value step is not another connector. A SAP consultant needs local case deliverables they can inspect, edit, and reuse:

- analysis conclusion Markdown
- check table / CSV output
- development note Markdown
- request-description draft
- Mermaid source
- candidate knowledge in pending state
- evidence and boundary notes that explain what was and was not done

Phase 8 therefore keeps the execution local and deterministic, but raises the output quality. This moves the MVP closer to the acceptance requirement that case workflows generate files visible in the right-side case file panel.

## 2. File Structure

- Modify: `apps/desktop/src/main/caseWorkflowService.ts`
  - Replace generic Phase 6 demo outputs with mode-specific local deliverables.
  - Add small helpers for CSV, traceability rows, and output boundary wording.
  - Keep generated content derived from safe metadata, not copied raw user input.
- Modify: `apps/desktop/src/renderer/App.tsx`
  - Update Phase 6 copy to Phase 8 local case-output wording.
  - Keep disabled model/attachment/microphone states honest.
- Modify: `apps/desktop/src/preload/preload.ts`
  - Update displayed phase label to `Phase 8`.
- Create: `docs/architecture/reviews/2026-07-02-phase-8-real-case-output-review.md`
  - Record product, security, UX, and verification evidence.

No database schema, IPC channel, connector, or secret-storage contract changes are planned.

## 3. Task 1: Upgrade Case Output Templates

**Files:**
- Modify: `apps/desktop/src/main/caseWorkflowService.ts`

- [ ] **Step 1: Add output helpers**

Add constants and helpers near the existing `TASK_MODE_LABELS`:

```ts
const CASE_OUTPUT_PHASE = "Phase 8";
const LOCAL_WORKFLOW_BOUNDARY = "本地草稿工作流：不读取真实 SAP、不调用真实模型、不创建或发布飞书文档。";

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function csvRows(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
```

Expected behavior:

- generated CSV files open cleanly in spreadsheet tools
- no raw input body is copied into output files
- output files state their local-only boundary

- [ ] **Step 2: Replace mode-specific generated files**

Replace `modeFilePlan()` output file lists with:

```text
problem-analysis:
  outputs/问题分析_处理结论.md
  outputs/问题分析_核对清单.csv
  knowledge_candidates/问题处理经验候选.md
  evidence/本地处理证据.md

abap-development:
  outputs/ABAP只读开发草稿.md
  outputs/请求说明草稿.md
  snapshots/SAP只读快照说明.md
  technical/ABAP开发安全边界.md

document-generation:
  outputs/开发说明书.md
  outputs/上线确认清单.csv
  outputs/飞书发布准备说明.md

flow-diagram:
  outputs/逻辑说明图.mmd
  outputs/流程图说明.md
  outputs/流程节点清单.csv
```

Expected behavior:

- every task mode generates at least two useful files
- problem analysis still generates one pending knowledge candidate
- ABAP mode creates a snapshot explanation, not real SAP source
- document mode prepares local Markdown only
- flow mode creates valid Mermaid source and a CSV node list

- [ ] **Step 3: Update assistant and context wording**

Change assistant, README, timeline, and context pack wording from `Phase 6` / `本地演示` to:

```text
Phase 8 本地案件输出
本地草稿
待用户确认
未读取真实 SAP、未调用真实模型、未发布飞书
```

Expected behavior:

- the app does not claim real SAP/model/Feishu execution
- generated files are described as local drafts and traceable case files
- `metadata.json` still records `sapWrite: "disabled"`, `externalModelCall: "not-run"`, and `feishuPublish: "not-run"`

- [ ] **Step 4: Run type check**

Run:

```powershell
npm run check
```

Expected:

```text
tsc --noEmit
```

Exit code 0.

## 4. Task 2: Update Renderer Copy For Honest Phase 8 UX

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/preload/preload.ts`

- [ ] **Step 1: Update visible phase label**

In `preload.ts`, set:

```ts
phase: "Phase 8"
```

Expected: top bar shows `Phase 8 · 本地模式`.

- [ ] **Step 2: Update main notice and mode copy**

In `App.tsx`, update initial notice to:

```text
Phase 8：当前会生成可编辑的本地案件输出文件；仍不读取真实 SAP、不调用真实模型、不发布飞书。
```

Update placeholders and tooltips so the four task modes say they generate local drafts/files, not demo-only results.

Expected:

- users understand this phase creates real local files
- users are not misled that external integrations are running
- right-side file panel remains the main proof of generated output

- [ ] **Step 3: Run type check**

Run:

```powershell
npm run check
```

Expected: exit code 0.

## 5. Task 3: Add Phase 8 Adversarial Review

**Files:**
- Create: `docs/architecture/reviews/2026-07-02-phase-8-real-case-output-review.md`

- [ ] **Step 1: Collect multi-agent review results**

Use one product/UX reviewer and one safety/architecture reviewer. Required questions:

```text
Product/UX:
- Are the new outputs useful to a SAP consultant?
- Does any wording overclaim real SAP/model/Feishu execution?
- Does the right-side file panel remain the proof surface?

Safety/Architecture:
- Can generated files escape the current case directory?
- Do outputs copy raw secrets, SAP source, table rows, or auth artifacts?
- Does Phase 8 add SAP write, transport, generic IPC, child process, or network proxy risk?
```

- [ ] **Step 2: Fill review document**

The review document must include:

```text
功能范围
用户价值审计
MVP 边界审计
安全审计
体验审计
多 Agent 发现和处理
验证命令
剩余风险
结论
```

Expected: every P0/P1 finding is fixed before final verification.

## 6. Task 4: Runtime Probe And Final Verification

**Files:**
- No source file changes expected unless probes expose a bug.

- [ ] **Step 1: Run runtime case-output probe**

Run a local Node/Electron-main-compatible probe that:

```text
creates or loads WorkspaceStore
appends one message per task mode
checks active case files include the Phase 8 output filenames
checks files remain under local-data/workbench
checks metadata still says no SAP write, no external model call, no Feishu publish
checks search finds at least one generated output filename
```

Expected output:

```text
mode=problem-analysis files=...
mode=abap-development files=...
mode=document-generation files=...
mode=flow-diagram files=...
metadataSafety=ok
searchGeneratedOutput=ok
```

- [ ] **Step 2: Run required checks**

Run:

```powershell
npm run check
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1
git diff --check
```

Expected: all exit code 0.

## 7. Commit And Push

- [ ] **Step 1: Commit**

```powershell
git add .
git commit -m "feat: add real local case outputs"
```

- [ ] **Step 2: Clean-tree security preflight**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/security-preflight.ps1 -RequireClean
```

Expected: exit code 0.

- [ ] **Step 3: Push**

```powershell
git -c http.proxy= -c https.proxy= push -u origin phase-8-real-case-output
```

Expected: branch pushed to GitHub.

## 8. Exit Criteria

- `origin/phase-8-real-case-output` exists.
- Every task mode creates useful local output files.
- The right-side file panel can show the generated files.
- Generated outputs remain in the current case directory.
- No SAP write, transport release, model call, Feishu publish, generic IPC, or secret exposure is introduced.
- The Phase 8 adversarial review file exists and records multi-agent findings.
- `npm run check`, `npm run build`, `security-preflight.ps1`, and `git diff --check` all pass.
