import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase44-stream-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

const entrySource = `
import {
  AnthropicCompatibleModelProviderConnector,
  OpenAiCompatibleModelProviderConnector
} from "./apps/desktop/src/main/modelProviderConnector.ts";

function jsonRequester() {
  throw new Error("流式调用不应回退到 JSON 请求器");
}

function splitSseRequester(events) {
  return async (_url, _label, options, onChunk) => {
    const body = JSON.parse(options.body);
    if (body.stream !== true) throw new Error("模型请求没有开启 stream=true");
    const text = events.join("");
    for (let index = 0; index < text.length; index += 7) onChunk(text.slice(index, index + 7));
    return { contentType: "text/event-stream; charset=utf-8" };
  };
}

const openAiDeltas = [];
const openAi = new OpenAiCompatibleModelProviderConnector(jsonRequester, splitSseRequester([
  'data: {"choices":[{"delta":{"content":"你"}}]}\\n\\n',
  'data: {"choices":[{"delta":{"content":"好"}}]}\\n\\n',
  'data: [DONE]\\n\\n'
]));
const openAiResult = await openAi.generateDailyChat({
  id: "openai-stream",
  name: "OpenAI 流式渠道",
  providerType: "openai-compatible",
  baseUrl: "https://models.example.com/v1",
  apiKey: "probe-key",
  modelId: "model-not-used-as-health-probe",
  content: "你好",
  onDelta: (delta) => openAiDeltas.push(delta)
});
if (openAiResult.content !== "你好" || openAiDeltas.join("") !== "你好") throw new Error("OpenAI SSE 分片没有按顺序输出");

const anthropicDeltas = [];
const anthropic = new AnthropicCompatibleModelProviderConnector(jsonRequester, splitSseRequester([
  'event: content_block_delta\\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"流式"}}\\n\\n',
  'event: content_block_delta\\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"回复"}}\\n\\n'
]));
const anthropicResult = await anthropic.generateSafeDraft({
  id: "anthropic-stream",
  name: "Anthropic 流式渠道",
  providerType: "anthropic-compatible",
  baseUrl: "https://anthropic.example.com/v1",
  apiKey: "probe-key",
  modelId: "claude-any-listed-model",
  context: {
    messages: [{ role: "user", content: "请回复" }],
    audit: {
      taskMode: "problem-analysis",
      caseSummaryChars: 0,
      standardsSummaryChars: 0,
      knowledgeReferenceCount: 0,
      safeOutputSummaryCount: 0,
      maxContextChars: 100,
      createdAt: "2026-07-12T00:00:00.000Z"
    }
  },
  onDelta: (delta) => anthropicDeltas.push(delta)
});
if (anthropicResult.content !== "流式回复" || anthropicDeltas.join("") !== "流式回复") throw new Error("Anthropic SSE 分片没有按顺序输出");

const unsafeDeltas = [];
const unsafe = new OpenAiCompatibleModelProviderConnector(jsonRequester, splitSseRequester([
  'data: {"choices":[{"delta":{"content":"api_key = abcdefghijklmnop"}}]}\\n\\n',
  'data: [DONE]\\n\\n'
]));
let unsafeBlocked = false;
try {
  await unsafe.generateSafeDraft({
    id: "unsafe-stream",
    name: "不安全流式渠道",
    providerType: "openai-compatible",
    baseUrl: "https://models.example.com/v1",
    apiKey: "probe-key",
    modelId: "unsafe-stream-model",
    context: {
      messages: [{ role: "user", content: "请回复" }],
      audit: {
        taskMode: "problem-analysis",
        caseSummaryChars: 0,
        standardsSummaryChars: 0,
        knowledgeReferenceCount: 0,
        safeOutputSummaryCount: 0,
        maxContextChars: 100,
        createdAt: "2026-07-12T00:00:00.000Z"
      }
    },
    onDelta: (delta) => unsafeDeltas.push(delta)
  });
} catch {
  unsafeBlocked = true;
}
if (!unsafeBlocked || unsafeDeltas.length !== 0) throw new Error("不安全的 Work 模型流式内容在完整校验前进入了 renderer");

process.stdout.write("realSseStreamingProtocols=ok\\n");
process.stdout.write("unsafeWorkStreamBlockedBeforeRenderer=ok\\n");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase44-ai-conversation-streaming-entry.ts",
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

  const [app, main, preload, rendererTypes, connector, security, codex, caseWorkflow] = await Promise.all([
    readFile("apps/desktop/src/renderer/App.tsx", "utf8"),
    readFile("apps/desktop/src/main/main.ts", "utf8"),
    readFile("apps/desktop/src/preload/preload.ts", "utf8"),
    readFile("apps/desktop/src/renderer/vite-env.d.ts", "utf8"),
    readFile("apps/desktop/src/main/modelProviderConnector.ts", "utf8"),
    readFile("apps/desktop/src/main/modelEndpointSecurity.ts", "utf8"),
    readFile("apps/desktop/src/main/codexCliConnector.ts", "utf8"),
    readFile("apps/desktop/src/main/caseWorkflowService.ts", "utf8")
  ]);

  assert.match(app, /function enabledCatalogModelOptions[\s\S]*provider\.models\.map/, "会话模型选择器没有展示渠道完整模型目录");
  assert.match(app, /disabled=\{!isChatModel\(option\.model\)\}/, "非文本模型没有在会话选择器中禁用");
  assert.doesNotMatch(app.slice(app.indexOf("function safeDraftModelOptions"), app.indexOf("function providerErrorStates")), /verifiedModelIds/, "模型选择器仍受单个测试模型白名单限制");
  assert.match(main, /isChatCapableModel\(selectedModel\)/, "main process 没有拒绝非文本对话模型");
  assert.doesNotMatch(main.slice(main.indexOf("function isProviderReadyForDailyChat"), main.indexOf("async function prepareDailyChatAssistantReply")), /verifiedModelIds/, "Daily Chat 仍把健康检查模型当作唯一白名单");
  assert.match(connector, /stream:\s*true/, "模型连接器没有开启真实流式协议");
  assert.match(security, /createSecureModelStreamRequester/, "流式请求没有复用受控 DNS 与 HTTPS 边界");
  assert.match(preload, /workbench:ai-conversation-stream/, "preload 缺少固定流式事件通道");
  assert.match(rendererTypes, /appendDailyChatMessageStreaming/, "renderer 类型桥缺少 Daily Chat 流式方法");
  assert.match(rendererTypes, /appendMessageStreaming/, "renderer 类型桥缺少 Work 流式方法");
  assert.match(app, /StreamingTurnBubble/, "会话区缺少渐进式回复状态");
  assert.match(app, /current\.contextKey === expectedContextKey/, "流式事件没有绑定到具体对话或案件");
  assert.match(caseWorkflow, /modelDraft\.content/, "Work 最终回复没有保留真实模型正文");
  assert.match(codex, /ok:\s*cliPassed\s*&&\s*loginPassed/, "Codex 本机可用状态仍错误依赖可选工程试跑");
  console.log("fullCatalogSelectionAndOptionalCodexProbe=ok");
  console.log("fixedStreamingIpcAndConversationUi=ok");
  console.log("phase44-ai-conversation-streaming-probe=ok");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
