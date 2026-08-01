import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const buildRoot = await mkdtemp(path.join(root, ".phase56-probe-"));
const workspace = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase56-context-"));

try {
  const entryPath = path.join(buildRoot, "entry.ts");
  const outputPath = path.join(buildRoot, "entry.mjs");
  await writeFile(entryPath, [
    'export { AgentContextService } from "../apps/desktop/src/main/agentContextService";',
    'export { ContextEngine } from "../apps/desktop/src/main/contextEngine";',
    'export { PromptMemoryService } from "../apps/desktop/src/main/promptMemoryService";'
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

  const { AgentContextService, ContextEngine, PromptMemoryService } = await import(
    `${pathToFileURL(outputPath).href}?v=${Date.now()}`
  );
  const promptMemory = new PromptMemoryService(workspace);
  await promptMemory.initialize();
  const skills = {
    async getCatalog() { return []; },
    async activateSkill() { throw new Error("probe should not activate skills"); }
  };
  const service = new AgentContextService(new ContextEngine(promptMemory), skills, null, promptMemory);
  const target = { threadId: "thread-phase56", projectId: "project-phase56", caseId: "case-phase56" };
  const messages = Array.from({ length: 36 }, (_, index) => ({
    ref: `message:phase56-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `第 ${index + 1} 条历史消息：${"bounded historical context ".repeat(120)}`,
    createdAt: new Date(Date.UTC(2026, 6, 16, 1, index)).toISOString()
  }));

  const first = await service.build({
    requestId: "request-phase56-first",
    target,
    userContent: "继续分析当前案件。",
    conversationMessages: [
      ...messages,
      {
        ref: "message:phase56-sensitive",
        role: "user",
        content: ["API", "KEY=", "sk", "phase56sensitivevalue123456789"].join("_"),
        createdAt: "2026-07-16T02:00:00.000Z"
      }
    ]
  });
  assert.equal(first.checkpointUpdated, true);
  assert.equal(first.history.length, 10);
  assert.equal(first.history.some((message) => message.ref.includes("sensitive")), false);
  const firstCheckpoint = promptMemory.getActiveThreadCheckpoint(target);
  assert.ok(firstCheckpoint);
  assert.equal(firstCheckpoint.version, 1);
  assert.equal(firstCheckpoint.sourceItemRefs.length, 26);
  assert.match(firstCheckpoint.content, /确定性保留首尾与关键约束摘录/);
  assert.doesNotMatch(firstCheckpoint.content, /phase56sensitivevalue/);
  assert.ok(first.items.some((item) => item.kind === "thread-checkpoint"));

  const fourNew = Array.from({ length: 4 }, (_, index) => ({
    ref: `message:phase56-new-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `新增消息 ${index + 1}。`,
    createdAt: new Date(Date.UTC(2026, 6, 16, 3, index)).toISOString()
  }));
  const second = await service.build({
    requestId: "request-phase56-second",
    target,
    userContent: "继续。",
    conversationMessages: [...messages, ...fourNew]
  });
  assert.equal(second.checkpointUpdated, false);
  assert.equal(second.history.length, 14);
  assert.equal(promptMemory.getActiveThreadCheckpoint(target)?.version, 1);

  const twelveNew = Array.from({ length: 12 }, (_, index) => ({
    ref: `message:phase56-batch-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `批次消息 ${index + 1}：${"new bounded context ".repeat(80)}`,
    createdAt: new Date(Date.UTC(2026, 6, 16, 4, index)).toISOString()
  }));
  const third = await service.build({
    requestId: "request-phase56-third",
    target,
    userContent: "继续。",
    conversationMessages: [...messages, ...twelveNew]
  });
  assert.equal(third.checkpointUpdated, true);
  assert.equal(third.history.length, 10);
  assert.equal(promptMemory.getActiveThreadCheckpoint(target)?.version, 2);

  const longTarget = { threadId: "thread-phase56-long", projectId: "project-phase56", caseId: "case-phase56" };
  const longMessages = Array.from({ length: 120 }, (_, index) => ({
    ref: `message:phase56-long-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: index === 61
      ? `${"普通背景说明 ".repeat(40)}。中段关键约束：生产系统只读，目标工厂为 8000。${"保留上下文 ".repeat(40)}`
      : `长会话第 ${index + 1} 条：${"用于检查无损会话检查点 ".repeat(40)}`,
    createdAt: new Date(Date.UTC(2026, 6, 16, 5, index)).toISOString()
  }));
  const longResult = await service.build({
    requestId: "request-phase56-long",
    target: longTarget,
    userContent: "继续处理长会话。",
    conversationMessages: longMessages
  });
  assert.equal(longResult.checkpointUpdated, true);
  const longCheckpoint = promptMemory.getActiveThreadCheckpoint(longTarget);
  assert.ok(longCheckpoint);
  assert.match(longCheckpoint.content, /格式版本：3/);
  assert.match(longCheckpoint.content, /中段关键约束：生产系统只读，目标工厂为 8000/);
  assert.equal(longCheckpoint.sourceItemRefs.includes("message:phase56-long-61"), true);
  assert.equal(longCheckpoint.sourceItemRefs.length, 110);

  const ordinary = await service.captureExplicitUserMemory({
    requestId: "request-phase56-ordinary",
    target,
    userContent: "帮我分析这个报错。"
  });
  assert.equal(ordinary, null);
  const projectMemory = await service.captureExplicitUserMemory({
    requestId: "request-phase56-project-memory",
    target,
    userContent: "本项目约定：以后都必须保持 SAP 只读。"
  });
  assert.ok(projectMemory);
  assert.equal(projectMemory.scope.type, "project");
  assert.equal(projectMemory.kind, "constraint");
  assert.equal(projectMemory.status, "candidate");
  const duplicate = await service.captureExplicitUserMemory({
    requestId: "request-phase56-project-memory-duplicate",
    target,
    userContent: "本项目约定：以后都必须保持 SAP 只读。"
  });
  assert.equal(duplicate, null);

  const chatTarget = { threadId: "chat-phase56", projectId: null, caseId: null };
  const personalMemory = await service.captureExplicitUserMemory({
    requestId: "request-phase56-personal-memory",
    target: chatTarget,
    userContent: "以后请默认用简洁中文回答。"
  });
  assert.ok(personalMemory);
  assert.equal(personalMemory.scope.type, "personal");
  assert.equal(personalMemory.kind, "preference");
  assert.equal(personalMemory.status, "candidate");
  assert.equal(promptMemory.resolveMemoriesForTarget(chatTarget).included.length, 0);

  await promptMemory.close();
  console.log("Phase 56 context lifecycle probe passed.");
} finally {
  await rm(buildRoot, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
