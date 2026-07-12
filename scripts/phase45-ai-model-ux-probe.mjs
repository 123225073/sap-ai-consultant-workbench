import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [app, config, store, localAi, main, styles] = await Promise.all([
  readFile("apps/desktop/src/renderer/App.tsx", "utf8"),
  readFile("apps/desktop/src/renderer/ConfigCenter.tsx", "utf8"),
  readFile("apps/desktop/src/main/workspaceStore.ts", "utf8"),
  readFile("apps/desktop/src/main/localAiCapabilityService.ts", "utf8"),
  readFile("apps/desktop/src/main/main.ts", "utf8"),
  readFile("apps/desktop/src/renderer/styles.css", "utf8")
]);

assert.doesNotMatch(config, /apiProviders\.length\s*>=\s*6|apiProviders\.length}\s*\/\s*6|最多配置 6 个渠道/, "模型渠道仍被限制为 6 个");
assert.doesNotMatch(store, /apiProviders:\s*providers\.slice\(0,\s*6\)/, "main process 仍会截断模型渠道");
assert.match(config, /className="model-core-fields"/, "模型必填项没有收拢到同一区域");
assert.match(config, /className="model-channel-enabled"/, "模型渠道缺少醒目的全局启用开关");
assert.doesNotMatch(config, /<span>模型目录方式<\/span>/, "模型目录方式仍暴露给用户选择");
assert.match(config, /function EditableModelSelect/, "测试模型缺少可选择也可手工输入的控件");
assert.doesNotMatch(config, /models\.slice\(0,\s*8\)/, "验证详情仍只显示部分模型");
assert.match(config, /共 \{models\.length} 个模型/, "验证详情没有说明完整模型数量");

assert.match(app, /function ComposerModelPicker/, "Chat 与 Work 尚未共用模型选择器");
assert.equal((app.match(/<ComposerModelPicker/g) ?? []).length, 2, "Chat 与 Work 必须各使用一次统一模型选择器");
assert.equal((app.match(/onKeyDown=\{handleComposerKeyDown\}/g) ?? []).length, 2, "Chat 与 Work 必须都支持回车发送");
assert.match(app, /event\.nativeEvent\.isComposing/, "回车发送没有保护中文输入法组合态");
assert.match(app, /model\.capabilities\.includes\("chat"\)/, "对话模型选择器没有排除非对话模型");
assert.doesNotMatch(app, /<strong>Codex 辅助<\/strong>/, "Codex 辅助仍占用普通发送栏");
assert.match(main, /mayRetryWithVerifiedModel/, "所选模型临时不可用时没有受控回退机制");
assert.match(main, /fallbackModelId !== modelId/, "模型回退没有避免重复请求同一模型");

assert.match(config, /修复或更新 Codex CLI/, "本机能力缺少一键修复/更新入口");
assert.match(localAi, /OFFICIAL_NPM_PACKAGE = "@openai\/codex"/, "一键修复没有继续使用官方 Codex npm 包");
assert.match(main, /确认修复或更新 Codex CLI/, "一键修复缺少用户确认");
assert.match(styles, /\.composer-model-actions/, "模型选择器没有与发送按钮形成稳定操作区");
assert.match(app, /codexAssistEnabled: false/, "普通 Work 消息仍可能携带隐藏的 Codex 工程辅助状态");
assert.match(app, /contextKey: streamContextKey/, "流式状态没有绑定当前对话或案件");
assert.match(app, /aria-controls=\{panelId\}/, "模型选择器没有建立触发按钮与弹层的可访问关系");
assert.match(main, /runCaseWorkflowExclusive\(workflowKey/, "Daily Chat 同一线程没有后端串行保护");
assert.doesNotMatch(main, /HTTP \(\?:404\|/, "模型回退仍会错误重试永久性的 404");
assert.doesNotMatch(config, /useState<Record<string, string>>\(\{\}\)/, "API Key 仍长期保存在 React state");
assert.match(store, /actualModelId = assistantReply\?\.responseMode === "model-success"/, "回退模型没有修复用户消息与助手回复的历史配对");
assert.match(store, /return "remote-with-manual-fallback"/, "旧模型渠道没有统一迁移到自动目录加手工兜底");
assert.match(styles, /max-height: 236px/, "大量模型渠道缺少稳定的独立滚动区域");
assert.match(await readFile("apps/desktop/src/main/modelProviderConnector.ts", "utf8"), /after_id/, "Anthropic 模型目录没有继续读取分页");
assert.match(store, /MAX_PROJECT_CONFIG_BYTES/, "无限渠道缺少总配置资源预算");

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase45-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { WorkspaceStore, isChatCapableModel } from "./apps/desktop/src/main/workspaceStore.ts";
import { AnthropicCompatibleModelProviderConnector, OpenAiCompatibleModelProviderConnector } from "./apps/desktop/src/main/modelProviderConnector.ts";

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
let state = await store.createDailyChatThread({ title: "回退历史配对" });
const threadId = state.activeChatThreadId;
state = await store.appendDailyChatMessage({
  threadId,
  projectId: "project-a",
  providerId: "provider-a",
  modelId: "model-a",
  content: "第一条问题"
}, {
  content: "回退模型回复",
  modelId: "model-b",
  responseMode: "model-success",
  projectId: "project-a",
  providerId: "provider-a",
  providerName: "测试渠道"
});
const history = await store.getDailyChatModelHistory(threadId, "project-a", "provider-a", "model-b");
if (history.length !== 2 || history[0].role !== "user" || history[1].role !== "assistant") {
  throw new Error("模型回退后的用户消息与助手回复没有按实际模型配对");
}
if (isChatCapableModel({ id: "gpt-image-1", displayName: "图像", capabilities: ["chat"], lastSeenAt: new Date().toISOString() })) {
  throw new Error("后端文本对话能力判断没有拒绝图像模型");
}
if (!isChatCapableModel({ id: "gpt-5.5", displayName: "文本", capabilities: ["chat"], lastSeenAt: new Date().toISOString() })) {
  throw new Error("后端文本对话能力判断错误拒绝普通对话模型");
}
const connector = new OpenAiCompatibleModelProviderConnector(async (url) => {
  if (url.endsWith("/models")) return { data: Array.from({ length: 250 }, (_, index) => ({ id: "model-" + (index + 1) })) };
  return { choices: [{ message: { content: "ok" } }] };
});
const fullCatalog = await connector.verify({
  id: "many-models",
  name: "完整目录",
  providerType: "openai-compatible",
  baseUrl: "https://models.example.com/v1",
  apiKey: "probe-key",
  testModelId: "model-1"
});
if (fullCatalog.models.length !== 250) throw new Error("模型目录仍被静默截断");

const anthropicUrls = [];
const anthropicConnector = new AnthropicCompatibleModelProviderConnector(async (url) => {
  anthropicUrls.push(url);
  if (url.includes("/models")) {
    return url.includes("after_id=claude-a")
      ? { data: [{ id: "claude-b" }], has_more: false, last_id: "claude-b" }
      : { data: [{ id: "claude-a" }], has_more: true, last_id: "claude-a" };
  }
  return { content: [{ type: "text", text: "ok" }] };
});
const anthropicCatalog = await anthropicConnector.verify({
  id: "anthropic-pages",
  name: "Anthropic 分页",
  providerType: "anthropic-compatible",
  baseUrl: "https://anthropic.example.com/v1",
  apiKey: "probe-key",
  testModelId: "claude-a"
});
if (anthropicCatalog.models.length !== 2 || !anthropicUrls.some((url) => url.includes("after_id=claude-a"))) {
  throw new Error("Anthropic 模型目录分页没有完整读取");
}

const baseState = await store.getState();
const activeProject = baseState.projects.find((item) => item.id === baseState.activeProjectId);
if (!activeProject) throw new Error("安全配置测试缺少活动项目");
const unsafeUrlConfig = JSON.parse(JSON.stringify(activeProject.config));
unsafeUrlConfig.apiProviders[0].baseUrl = "https://models.example.com/v1?api_key=sk-proj-abcdefghijklmnop";
let unsafeUrlBlocked = false;
try { await store.saveProjectConfig(activeProject.id, unsafeUrlConfig); } catch { unsafeUrlBlocked = true; }
if (!unsafeUrlBlocked) throw new Error("Base URL 中的查询密钥没有在保存前被阻止");

const caseState = await store.getState();
await store.appendMessage({
  projectId: caseState.activeProjectId,
  caseId: caseState.activeCaseId,
  content: "验证 Work 渠道归属",
  taskMode: "problem-analysis",
  modelId: "same-model",
  providerId: "provider-b",
  permissionMode: "request_approval"
}, {
  status: "success",
  providerName: "渠道 B",
  modelId: "same-model",
  generatedAt: new Date().toISOString(),
  content: "渠道归属已保存。",
  contextAudit: {
    allowedFields: ["taskMode", "taskLabel", "actionId", "userInputSummary", "caseTitle", "caseSummary", "sapVersion", "standardsSummary", "knowledgeReferences", "safeOutputSummaries", "boundary"],
    contextCharCount: 0,
    referencedKnowledgeCount: 0,
    safeOutputSummaryCount: 0,
    maxContextChars: 100,
    createdAt: new Date().toISOString()
  }
});
const reloaded = await new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)}).getState();
const reloadedProject = reloaded.projects.find((item) => item.id === reloaded.activeProjectId);
const reloadedCase = reloadedProject?.cases.find((item) => item.id === reloaded.activeCaseId);
const lastCaseReply = [...(reloadedCase?.messages ?? [])].reverse().find((item) => item.role === "assistant" && item.modelId === "same-model");
if (lastCaseReply?.providerId !== "provider-b") throw new Error("Work 消息没有持久化实际渠道归属");
process.stdout.write("fallbackHistoryPairing=ok\\n");
process.stdout.write("backendChatModelGate=ok\\n");
process.stdout.write("fullCatalogBeyond200=ok\\n");
process.stdout.write("anthropicCatalogPagination=ok\\n");
process.stdout.write("secretBearingBaseUrlBlocked=ok\\n");
process.stdout.write("workProviderProvenancePersisted=ok\\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: repoRoot, sourcefile: "phase45-entry.ts", loader: "ts" },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("unlimitedModelChannels=ok");
console.log("focusedModelConfiguration=ok");
console.log("completeModelCatalog=ok");
console.log("sharedComposerModelPicker=ok");
console.log("enterToSendWithImeGuard=ok");
console.log("codexOneClickRepair=ok");
console.log("phase45-ai-model-ux-probe=ok");
