import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase40-standards-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createProjectStandards,
  standardsSummaryForTask,
  updateProjectStandards
} from "./apps/desktop/src/main/standardsService.ts";
import { buildSafeModelDraftContext } from "./apps/desktop/src/main/safeModelCaseDraftService.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const ABAP_RULE = "PHASE40_ABAP_ONLY_RULE";
const DOCUMENT_RULE = "PHASE40_DOCUMENT_ONLY_RULE";
const DIAGRAM_RULE = "PHASE40_DIAGRAM_ONLY_RULE";
const SECRET_VALUE = "PHASE40_SHOULD_NOT_LEAK_SECRET_VALUE";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

let profile = createProjectStandards("phase40-project", "S4", "s4-default");
profile = updateProjectStandards(profile, {
  categories: [
    { id: "abap", currentContent: ABAP_RULE + ": use guarded selects. Additional ABAP-only detail must remain bounded." },
    { id: "document", currentContent: DOCUMENT_RULE + ": keep the approved heading order. Additional document-only detail must remain bounded." },
    { id: "diagram", currentContent: DIAGRAM_RULE + ": label every exception branch. Additional diagram-only detail must remain bounded." }
  ]
});

const abapSummary = standardsSummaryForTask(profile, "abap-development");
const documentSummary = standardsSummaryForTask(profile, "document-generation");
const diagramSummary = standardsSummaryForTask(profile, "flow-diagram");
const compatibleSummary = standardsSummaryForTask(profile);

function buildTaskContext(taskMode, taskLabel, standardsSummary) {
  return buildSafeModelDraftContext({
    taskMode,
    taskLabel,
    userInput: "Generate a bounded local draft for the Phase 40 probe.",
    caseTitle: "Phase 40 standards context case",
    caseSummary: "Verify that only task-relevant project rules enter the safe model context.",
    sapVersion: "S4",
    standardsSummary,
    knowledgeReferences: [],
    safeOutputSummaries: []
  });
}

const abapContextText = JSON.stringify(buildTaskContext("abap-development", "ABAP 开发", abapSummary));
const documentContextText = JSON.stringify(buildTaskContext("document-generation", "文档生成", documentSummary));
const diagramContextText = JSON.stringify(buildTaskContext("flow-diagram", "流程图", diagramSummary));

assert(profile.version === 2, "standards version did not increment after real rule changes");
assert(abapSummary.includes(ABAP_RULE), "unique ABAP rule missing from ABAP task summary");
assert(!abapSummary.includes(DIAGRAM_RULE), "diagram-only rule leaked into ABAP task summary");
assert(documentSummary.includes(DOCUMENT_RULE), "unique document rule missing from document task summary");
assert(!documentSummary.includes(ABAP_RULE), "ABAP-only rule leaked into document task summary");
assert(diagramSummary.includes(DIAGRAM_RULE), "unique diagram rule missing from diagram task summary");
assert(!diagramSummary.includes(ABAP_RULE), "ABAP-only rule leaked into diagram task summary");
assert(compatibleSummary.includes("v2") && compatibleSummary.includes(ABAP_RULE), "compatible summary lost version or real changed content");
assert(abapContextText.includes(ABAP_RULE) && !abapContextText.includes(DIAGRAM_RULE), "safe ABAP task context did not preserve relevant-only standards content");
assert(documentContextText.includes(DOCUMENT_RULE) && !documentContextText.includes(ABAP_RULE), "safe document task context did not preserve relevant-only standards content");
assert(diagramContextText.includes(DIAGRAM_RULE) && !diagramContextText.includes(ABAP_RULE), "safe diagram task context did not preserve relevant-only standards content");
for (const summary of [abapSummary, documentSummary, diagramSummary, compatibleSummary]) {
  assert(summary.length <= 300, "task standards summary exceeded the 300 character boundary");
}
pass("taskRelevantRealRulesOnly");
pass("safeTaskContextUsesRelevantRules");
pass("summaryVersionAndLengthBoundary");

const unsafeProfile = structuredClone(profile);
unsafeProfile.categories.find((category) => category.id === "abap").currentContent = "api_key = " + SECRET_VALUE;
const unsafeSummary = standardsSummaryForTask(unsafeProfile, "abap-development");
assert(!unsafeSummary.includes(SECRET_VALUE), "secret-like standards content leaked into task summary");
assert(unsafeSummary.includes("安全限制"), "unsafe standards category was not explicitly omitted");
pass("unsafeRuleContentOmitted");

const uiSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/StandardsCenter.tsx"), "utf8");
assert(uiSource.includes("item.id !== project?.id && item.isVisible !== false"), "hidden projects remain available as standards copy sources");
assert(uiSource.includes("setView(null);") && uiSource.includes("setDraft(null);"), "project switch does not clear the old standards view and draft");
assert(uiSource.includes("requestId === requestSequence.current") && uiSource.includes("response.data.profile.projectId !== projectId"), "late or mismatched standards reads are not gated");
assert(uiSource.includes("规范读取失败") && uiSource.includes("重新读取项目规范"), "standards read failure is not explicit and retryable");
assert(uiSource.includes("window.confirm") && uiSource.includes("现有规范会被覆盖") && uiSource.includes("未保存的修改会丢失"), "destructive standards replacement confirmation is missing");
assert(!uiSource.includes("测试生成示例") && !uiSource.includes("底层提示词"), "standards demo sections are still visible");
pass("standardsUiUsabilityGates");
pass("phase40-standards-runtime-probe");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase40-standards-probe-entry.ts",
      loader: "ts"
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
  log("phase40-standards-runtime-probe=ok");
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
