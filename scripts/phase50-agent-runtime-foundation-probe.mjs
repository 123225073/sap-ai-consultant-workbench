import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const buildDir = await mkdtemp(path.join(root, ".phase50-probe-"));
const workspace = await mkdtemp(path.join(os.tmpdir(), "sap-ai-agent-runtime-"));

try {
  const entryPath = path.join(buildDir, "entry.ts");
  const outputPath = path.join(buildDir, "entry.mjs");
  await writeFile(entryPath, [
    'export { AgentEventStore } from "../apps/desktop/src/main/agentEventStore";',
    'export { AgentRuntime } from "../apps/desktop/src/main/agentRuntime";',
    'export { ExclusiveWorkflowQueue } from "../apps/desktop/src/main/exclusiveWorkflowQueue";',
    'export { decideInterruptedTurnProjection } from "../apps/desktop/src/main/agentRecovery";'
  ].join("\n"), "utf8");
  await build({
    entryPoints: [entryPath],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@sqlite.org/sqlite-wasm"]
  });

  const { AgentEventStore, AgentRuntime, ExclusiveWorkflowQueue, decideInterruptedTurnProjection } = await import(`${pathToFileURL(outputPath).href}?v=${Date.now()}`);
  const queue = new ExclusiveWorkflowQueue();
  const queueEvents = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstQueued = queue.run("same-thread", async () => {
    queueEvents.push("A-start");
    await firstGate;
    queueEvents.push("A-end");
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const queuedAbort = new AbortController();
  const secondQueued = queue.run("same-thread", async () => queueEvents.push("B-start"), queuedAbort.signal);
  queuedAbort.abort(new Error("取消等待任务"));
  await assert.rejects(secondQueued, /取消等待任务/);
  const thirdQueued = queue.run("same-thread", async () => queueEvents.push("C-start"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(queueEvents, ["A-start"], "取消等待任务不能提前解除同会话串行锁");
  releaseFirst();
  await Promise.all([firstQueued, thirdQueued]);
  assert.deepEqual(queueEvents, ["A-start", "A-end", "C-start"]);

  const interruptedRecoveryTurnId = "turn-interrupted";
  assert.equal(decideInterruptedTurnProjection([], interruptedRecoveryTurnId).committed, false);
  const adjacentTurnDecision = decideInterruptedTurnProjection([{
    role: "assistant",
    modelId: "model-a",
    agentTurnId: "turn-previous"
  }], interruptedRecoveryTurnId);
  assert.equal(adjacentTurnDecision.committed, false, "相邻会话的回复不得冒充当前中断 Turn 已保存");
  const committedDecision = decideInterruptedTurnProjection([{
    role: "assistant",
    modelId: "model-a",
    agentTurnId: interruptedRecoveryTurnId
  }], interruptedRecoveryTurnId);
  assert.equal(committedDecision.committed, true);
  assert.match(committedDecision.notice, /已经保存/);
  const store = new AgentEventStore(workspace);
  const initialHealth = await store.initialize();
  assert.equal(initialHealth.ok, true);
  const thread = await store.ensureThread({ legacyThreadId: "legacy-work-1", scope: "work", projectId: "project-1", caseId: "case-1" });
  const fakeSecret = ["sk", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
  const interruptedTurn = await store.startTurn({ threadId: thread.id, requestId: "request-interrupted" });
  await store.appendItem({
    threadId: thread.id,
    turnId: interruptedTurn.id,
    type: "user-message",
    payload: {
      content: `检查 API Key=${fakeSecret} 是否泄露`,
      apiKey: "ordinary-secret-value",
      nested: { password: "not-pattern-shaped", safe: "保留" }
    },
    idempotencyKey: `${interruptedTurn.id}:user-message`
  });
  store.close();

  const reopened = new AgentEventStore(workspace);
  const reopenedHealth = await reopened.initialize();
  if (reopenedHealth.recoveredInterruptedTurns !== 1) console.error("Phase 50 reopen health:", reopenedHealth);
  assert.equal(reopenedHealth.recoveredInterruptedTurns, 1);
  const snapshot = reopened.readThreadSnapshot(thread.id);
  assert.equal(snapshot.activeTurn, null);
  assert.equal(snapshot.items.length, 1);
  assert.equal(JSON.stringify(snapshot.items[0].payload).includes(fakeSecret), false);
  assert.equal(JSON.stringify(snapshot.items[0].payload).includes("ordinary-secret-value"), false);
  assert.equal(JSON.stringify(snapshot.items[0].payload).includes("not-pattern-shaped"), false);
  assert.equal(snapshot.items[0].payload.nested.safe, "保留");
  const pendingRecoveries = reopened.readPendingInterruptedTurns();
  assert.equal(pendingRecoveries.length, 1);
  assert.equal(pendingRecoveries[0].legacyThreadId, "legacy-work-1");
  assert.equal(pendingRecoveries[0].projectId, "project-1");
  await reopened.acknowledgeInterruptedTurn(interruptedTurn.id, "projected");
  assert.equal(reopened.readPendingInterruptedTurns().length, 0, "已投影的中断记录不能在下次启动重复提示");
  assert.equal(reopened.readThreadSnapshot(thread.id).items.at(-1)?.payload.recovery, "projected");
  await assert.rejects(
    () => reopened.ensureThread({ legacyThreadId: "legacy-work-1", scope: "work", projectId: "project-2", caseId: "case-2" }),
    /已经绑定到其他 Project 或 Case/
  );
  reopened.close();

  await rm(path.join(workspace, "agent-events.db"));
  const restored = new AgentEventStore(workspace);
  const restoredHealth = await restored.initialize();
  assert.equal(restoredHealth.ok, true);
  assert.match(restoredHealth.warning ?? "", /上一份稳定运行记录恢复/);
  assert.equal(restored.readThreadSnapshot(thread.id).items.length, 1, "主记录缺失时没有从 previous 备份恢复事件");
  restored.close();

  const events = [];
  const runtime = new AgentRuntime(workspace, (event) => events.push(event));
  await runtime.initialize();
  let releaseExecution;
  const executionStarted = new Promise((resolve) => { releaseExecution = resolve; });
  const run = runtime.runTurn({
    requestId: "request-cancelled",
    scope: "chat",
    legacyThreadId: "legacy-chat-1",
    userContent: "停止测试"
  }, async ({ signal, turn }) => {
    releaseExecution(turn);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 30_000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("已取消"));
      }, { once: true });
    });
    return { value: true, assistantContent: "不应保存" };
  });
  const activeTurn = await executionStarted;
  const startedEvent = events.find((event) => event.turnId === activeTurn.id && event.type === "turn-status");
  assert.ok(startedEvent);
  const cancellation = await runtime.cancelRequest(startedEvent.requestId);
  assert.equal(cancellation.cancelled, true);
  await assert.rejects(run, /停止|取消/);
  const cancelledSnapshot = runtime.readThread(startedEvent.threadId);
  assert.equal(cancelledSnapshot.activeTurn, null);
  assert.equal(cancelledSnapshot.items.at(-1)?.payload.status, "cancelled");

  const originalAppendItem = runtime.eventStore.appendItem.bind(runtime.eventStore);
  let injectedWriteFailure = true;
  runtime.eventStore.appendItem = async (...args) => {
    if (injectedWriteFailure) {
      injectedWriteFailure = false;
      throw new Error("injected event write failure");
    }
    return originalAppendItem(...args);
  };
  await assert.rejects(runtime.runTurn({
    requestId: "request-write-failure",
    scope: "chat",
    legacyThreadId: "legacy-write-failure",
    userContent: "写入失败测试"
  }, async () => ({ value: false, assistantContent: "不应完成" })), /injected event write failure/);
  runtime.eventStore.appendItem = originalAppendItem;
  const recoveredValue = await runtime.runTurn({
    requestId: "request-after-write-failure",
    scope: "chat",
    legacyThreadId: "legacy-write-failure",
    userContent: "恢复测试"
  }, async () => ({ value: true, assistantContent: "已恢复" }));
  assert.equal(recoveredValue, true, "事件写入失败后 active run 没有清理");

  await runtime.runTurn({
    requestId: "request-model-failure",
    scope: "chat",
    legacyThreadId: "legacy-failed-turn",
    userContent: "失败终态测试"
  }, async () => ({
    value: true,
    assistantContent: "模型调用失败，已保留本地说明。",
    terminalStatus: "failed",
    errorCode: "model-call-failed",
    errorMessage: "HTTP 503"
  }));
  const failedThread = events.find((event) => event.requestId === "request-model-failure")?.threadId;
  const failedSnapshot = runtime.readThread(failedThread);
  assert.equal(failedSnapshot.items.at(-1)?.payload.status, "failed", "模型失败不得记录为 completed");

  const longReply = "长回复".repeat(12_000);
  await runtime.runTurn({
    requestId: "request-long-reply",
    scope: "chat",
    legacyThreadId: "legacy-long-reply",
    userContent: "长回复分片测试"
  }, async () => ({ value: true, assistantContent: longReply }));
  const longThread = events.find((event) => event.requestId === "request-long-reply")?.threadId;
  const longSnapshot = runtime.readThread(longThread, 0, 500);
  const longFinal = longSnapshot.items.find((item) => item.type === "assistant-message");
  assert.equal(longFinal?.payload.contentTruncated, true);
  assert.equal(longFinal?.payload.contentLength, longReply.length);
  assert.ok(longSnapshot.items.some((item) => item.type === "assistant-message-part"));
  runtime.close();

  const sourceChecks = [
    ["apps/desktop/src/main/main.ts", "workbench:agent-runtime-cancel-turn"],
    ["apps/desktop/src/main/main.ts", "runTrackedDailyChatMessage"],
    ["apps/desktop/src/main/modelEndpointSecurity.ts", "signal: options.signal"],
    ["apps/desktop/src/preload/preload.ts", "onAgentRuntimeEvent"],
    ["apps/desktop/src/main/agentEventStore.ts", "UNIQUE(thread_id, idempotency_key)"]
    , ["apps/desktop/src/main/workspaceStore.ts", "reconcileInterruptedAgentTurns"]
    , ["apps/desktop/src/main/main.ts", "message.agentTurnId === turn.id"]
  ];
  for (const [relativePath, marker] of sourceChecks) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.ok(source.includes(marker), `${relativePath} 缺少 ${marker}`);
  }

  await mkdir(path.join(workspace, "probe-ok"));
  console.log("Phase 50 Agent Runtime foundation probe passed.");
} finally {
  await rm(buildDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
