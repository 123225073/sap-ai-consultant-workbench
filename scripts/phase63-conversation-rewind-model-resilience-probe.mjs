import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase63-rewind-"));
const isolatedRoot = path.join(tempRoot, "repo");
const bundlePath = path.join(tempRoot, "entry.mjs");

const source = `
  import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
  import { buildSafeModelDraftContext } from "./apps/desktop/src/main/safeModelCaseDraftService.ts";

  function assertProbe(condition, message) {
    if (!condition) throw new Error(message);
  }

  const context = buildSafeModelDraftContext({
    taskMode: "problem-analysis",
    taskLabel: "问题分析",
    userInput: "请继续分析",
    caseTitle: "安全上下文回归",
    caseSummary: "已确认当前问题",
    sapVersion: "S4",
    standardsSummary: "仅使用已确认事实",
    knowledgeReferences: [],
    safeOutputSummaries: [
      { displayName: "旧输出", fileType: "md", snippet: "参考地址：https://unsafe.example/path" },
      { displayName: "安全输出", fileType: "md", snippet: "已完成本地分析" }
    ]
  });
  assertProbe(context.messages.some((item) => item.content.includes("安全输出")), "安全摘要没有进入模型上下文");
  assertProbe(!context.messages.some((item) => item.content.includes("unsafe.example")), "不安全摘要没有被逐项排除");

  const store = new WorkspaceStore(${JSON.stringify(isolatedRoot)});
  let state = await store.getState();
  const project = state.projects.find((item) => item.id === state.activeProjectId);
  const thread = state.workThreads.find((item) => item.id === state.activeWorkThreadId);
  const caseItem = project.cases.find((item) => item.id === thread.caseId);
  state = await store.appendMessage({
    projectId: project.id,
    caseId: caseItem.id,
    threadId: thread.id,
    content: "第一版问题",
    taskMode: "problem-analysis",
    modelId: "local-workflow",
    actionId: null,
    permissionMode: "request_approval"
  });
  const activeThread = state.workThreads.find((item) => item.id === thread.id);
  const target = activeThread.messages.find((item) => item.role === "user");
  const before = activeThread.messages.map((item) => item.content);
  const rewind = await store.rewindConversation({ scope: "work", threadId: thread.id, targetMessageId: target.id });
  const rewoundThread = rewind.state.workThreads.find((item) => item.id === thread.id);
  assertProbe(rewoundThread.messages.length === 0, "Work 回退没有从目标用户消息处截断");
  assertProbe(rewoundThread.revisions.length === 1 && rewind.removedMessageCount === 2, "Work 回退没有保存完整可恢复版本");
  state = await store.restoreConversationRevision({ scope: "work", threadId: thread.id, revisionId: rewind.revisionId });
  const restoredThread = state.workThreads.find((item) => item.id === thread.id);
  assertProbe(JSON.stringify(restoredThread.messages.map((item) => item.content)) === JSON.stringify(before), "Work 历史版本无法恢复");

  state = await store.createDailyChatThread({ title: "回退测试" });
  const chatId = state.activeChatThreadId;
  state = await store.appendDailyChatMessage({ threadId: chatId, content: "旧问题" });
  const chat = state.chatThreads.find((item) => item.id === chatId);
  const chatTarget = chat.messages.find((item) => item.role === "user");
  const chatRewind = await store.rewindConversation({ scope: "chat", threadId: chatId, targetMessageId: chatTarget.id });
  assertProbe(chatRewind.state.chatThreads.find((item) => item.id === chatId).messages.length === 0, "Chat 回退没有截断当前分支");
  console.log("safeOptionalContextFiltering=ok");
  console.log("workAndChatConversationRewind=ok");
`;

try {
  await build({
    stdin: { contents: source, resolveDir: repoRoot, sourcefile: "phase63-entry.ts", loader: "ts" },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
  const [app, main, preload, rendererTypes, runtimeTypes] = await Promise.all([
    readFile("apps/desktop/src/renderer/App.tsx", "utf8"),
    readFile("apps/desktop/src/main/main.ts", "utf8"),
    readFile("apps/desktop/src/preload/preload.ts", "utf8"),
    readFile("apps/desktop/src/renderer/vite-env.d.ts", "utf8"),
    readFile("apps/desktop/src/shared/agentRuntimeTypes.ts", "utf8")
  ]);
  assert.match(app, /aria-label="编辑并重发这条消息"/, "用户消息缺少编辑并重发入口");
  assert.match(app, /回退并重发/, "编辑态没有清楚说明回退语义");
  assert.match(app, /历史版本/, "对话缺少可恢复历史版本入口");
  assert.match(main, /revokeThreadCheckpoint/, "回退后没有撤销旧上下文 checkpoint");
  assert.match(runtimeTypes, /conversation-rewind/, "事件账本缺少对话回退事实类型");
  assert.match(preload, /rewindConversation/, "preload 缺少窄回退接口");
  assert.match(rendererTypes, /restoreConversationRevision/, "renderer 缺少历史版本恢复接口");
  console.log("rewindUiAndRuntimeTraceability=ok");
  console.log("phase63-conversation-rewind-model-resilience-probe=ok");
} finally {
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
