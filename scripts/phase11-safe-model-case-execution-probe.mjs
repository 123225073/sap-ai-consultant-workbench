import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase11-model-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  SAFE_MODEL_CONTEXT_ALLOWED_FIELDS,
  assertNoUnsafeModelContextText,
  buildSafeModelDraftContext,
  renderSafeModelDraftFiles,
  safeModelDraftBoundary
} from "./apps/desktop/src/main/safeModelCaseDraftService.ts";
import { buildAssistantContent, parseCaseWorkflowInput } from "./apps/desktop/src/main/caseWorkflowService.ts";
import { FakeModelProviderConnector } from "./apps/desktop/src/main/modelProviderConnector.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(name, fn) {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  assert(thrown, name + " did not throw");
  pass(name);
}

const safeInput = {
  taskMode: "problem-analysis",
  taskLabel: "问题分析",
  userInput: "请基于当前案件摘要生成一份安全的处理建议。",
  caseTitle: "DEMO001 演示BOM清单",
  caseSummary: "当前只有脱敏摘要，等待用户确认业务口径。",
  sapVersion: "S4",
  standardsSummary: "S4 默认规范模板 v1；当前项目仍沿用模板默认内容",
  knowledgeReferences: [],
  safeOutputSummaries: [
    {
      displayName: "处理结论.md",
      fileType: "md",
      snippet: "已生成脱敏结论摘要，等待业务确认。",
      relativePath: "outputs/should-not-enter-model.md",
      content: "FULL_BODY_SHOULD_NOT_ENTER_MODEL"
    }
  ]
};

const context = buildSafeModelDraftContext(safeInput);
const serializedContext = JSON.stringify(context);
assert(Array.isArray(SAFE_MODEL_CONTEXT_ALLOWED_FIELDS), "allowed fields marker missing");
assert(safeModelDraftBoundary.includes("本地草稿"), "boundary missing local draft wording");
assert(context.messages.length === 2, "safe model context should use exactly two messages");
assert(serializedContext.includes("任务模式：问题分析"), "task label missing from context");
assert(!serializedContext.includes("FULL_BODY_SHOULD_NOT_ENTER_MODEL"), "full output body leaked into model context");
assert(!serializedContext.includes("outputs/should-not-enter-model.md"), "relative output path leaked into model context");
for (const forbidden of ["ProjectConfig", "WorkbenchState", "secretRef", "messages.json", "metadata.json", "technical/", "evidence/", "snapshots/"]) {
  assert(!serializedContext.includes(forbidden), "forbidden marker leaked into context: " + forbidden);
}
pass("contextAllowlist");
pass("safeSummaryOnly");

const parsedSafeModelHint = parseCaseWorkflowInput({
  content: "case summary",
  taskMode: "problem-analysis",
  modelId: "google/gemini-2.0-flash:free"
});
assert(parsedSafeModelHint.modelId === "google/gemini-2.0-flash:free", "safe model hint was not preserved");
const parsedUnsafeModelHint = parseCaseWorkflowInput({
  content: "case summary",
  taskMode: "problem-analysis",
  modelId: "https://sap.example.com"
});
assert(parsedUnsafeModelHint.modelId === "local-workflow", "unsafe model hint was not rejected");
pass("safeModelHint");

assertThrows("unsafeSecretBlocked", () => buildSafeModelDraftContext({ ...safeInput, userInput: "api_key = abcdefghijklmnop" }));
assertThrows("unsafeAbapBlocked", () => buildSafeModelDraftContext({ ...safeInput, userInput: "REPORT z_demo.\\nDATA lv_x TYPE string." }));
assertThrows("unsafeSqlBlocked", () => buildSafeModelDraftContext({ ...safeInput, userInput: "SELECT * FROM mara INTO TABLE lt_mara." }));
const contextWithUnsafeOptionalSummary = buildSafeModelDraftContext({ ...safeInput, caseSummary: "SAP host https://sap.example.com should not enter model context." });
assert(!JSON.stringify(contextWithUnsafeOptionalSummary).includes("sap.example.com"), "unsafe optional summary was not discarded");
pass("unsafeOptionalSummaryDiscarded");
assertThrows("unsafeDirectTextGuard", () => assertNoUnsafeModelContextText("probe", "Bearer abcdefghijklmnop"));

const connector = new FakeModelProviderConnector();
const draft = await connector.generateSafeDraft({
  id: "demo-openai-compatible",
  name: "演示 OpenAI 兼容渠道",
  providerType: "openai-compatible",
  baseUrl: "https://fake-models.test/v1",
  apiKey: "probe-key",
  modelId: "google/gemini-2.0-flash:free",
  context
});
assert(draft.content.includes("本地草稿"), "fake connector did not return a local draft");
pass("fakeSafeDraft");

await connector.generateSafeDraft({
  id: "demo-openai-compatible",
  name: "演示 OpenAI 兼容渠道",
  providerType: "openai-compatible",
  baseUrl: "https://fake-models.test/v1",
  apiKey: "probe-key",
  modelId: "unsafe-output",
  context
}).then(() => {
  throw new Error("unsafe model output was not blocked");
}).catch((error) => {
  if (String(error?.message ?? "").includes("unsafe model output was not blocked")) throw error;
});
pass("unsafeModelOutputBlocked");

const files = renderSafeModelDraftFiles({
  status: "success",
  providerName: "演示 OpenAI 兼容渠道",
  modelId: "google/gemini-2.0-flash:free",
  generatedAt: "2026-07-03T00:00:00.000Z",
  content: draft.content,
  contextAudit: context.audit
});
const filePayload = JSON.stringify(files);
assert(files.every((file) => file.relativePath.startsWith("outputs/")), "safe model files must stay under outputs");
assert(!filePayload.includes("messages"), "raw prompt messages leaked into draft artifact");
assert(!filePayload.includes("FULL_BODY_SHOULD_NOT_ENTER_MODEL"), "raw context leaked into draft artifact");
pass("draftArtifactNoRawPrompt");

const visibleFailure = buildAssistantContent(parsedSafeModelHint, [], {
  status: "failed",
  providerName: "Probe OpenAI Compatible",
  modelId: "google/gemini-2.0-flash:free",
  generatedAt: "2026-07-03T00:00:00.000Z",
  errorMessage: "sap.search_objects 连续失败：连接超时",
  contextAudit: context.audit
});
assert(visibleFailure.includes("sap.search_objects 连续失败：连接超时"), "safe SAP tool failure reason was not returned to the user-visible assistant message");
pass("safeFailureReasonVisible");

const store = new WorkspaceStore(isolatedRepoRoot);
await mkdir(isolatedRepoRoot, { recursive: true });
const safeModelRun = {
  status: "success",
  providerName: "Probe OpenAI Compatible",
  modelId: "google/gemini-2.0-flash:free",
  generatedAt: "2026-07-03T00:00:00.000Z",
  content: draft.content,
  contextAudit: context.audit
};
const appendState = await store.appendMessage({
  content: "Create a safe local draft for this case.",
  taskMode: "problem-analysis",
  modelId: "google/gemini-2.0-flash:free"
}, safeModelRun);
const appendProject = appendState.projects.find((project) => project.id === appendState.activeProjectId);
const appendCase = appendProject?.cases.find((caseItem) => caseItem.id === appendState.activeCaseId);
assert(appendProject && appendCase, "appended project or case missing");
const metadataPath = path.join(
  isolatedRepoRoot,
  "local-data",
  "workbench",
  "projects",
  appendProject.id,
  "cases",
  appendCase.folderName,
  "metadata.json"
);
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
assert(metadata.lastModelId === "google/gemini-2.0-flash:free", "metadata did not retain safe model id");
pass("metadataLastModelId");

const reloadedState = await new WorkspaceStore(isolatedRepoRoot).getState();
const reloadedProject = reloadedState.projects.find((project) => project.id === reloadedState.activeProjectId);
const reloadedCase = reloadedProject?.cases.find((caseItem) => caseItem.id === reloadedState.activeCaseId);
const reloadedAssistantMessage = reloadedCase?.messages.filter((message) => message.role === "assistant").at(-1);
assert(reloadedAssistantMessage?.modelId === "google/gemini-2.0-flash:free", "reloaded message lost safe model id");
pass("reloadPreservesModelId");

const mainSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8");
const preloadSource = await readFile(path.join(repoRoot, "apps/desktop/src/preload/preload.ts"), "utf8");
const ipcSource = mainSource + "\\n" + preloadSource;
assert(!ipcSource.includes("workbench:safe-model-draft"), "new model IPC should not exist");
assert(!ipcSource.includes("chat-completions"), "generic chat-completions IPC-like name should not exist");
pass("noGenericIpc");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase11-probe-entry.ts",
      loader: "ts"
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
