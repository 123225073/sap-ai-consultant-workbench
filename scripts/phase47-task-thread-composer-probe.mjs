import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.cwd());
const read = (file) => readFile(path.join(root, file), "utf8");
const [types, store, app, styles, preload, main] = await Promise.all([
  read("apps/desktop/src/shared/workbenchTypes.ts"),
  read("apps/desktop/src/main/workspaceStore.ts"),
  read("apps/desktop/src/renderer/App.tsx"),
  read("apps/desktop/src/renderer/styles.css"),
  read("apps/desktop/src/preload/preload.ts"),
  read("apps/desktop/src/main/main.ts")
]);

assert.match(types, /export interface WorkThread[\s\S]+status: ConversationThreadStatus[\s\S]+messages: CaseMessage\[\]/, "Work 任务会话缺少独立持久化结构");
assert.match(types, /activeWorkThreadId: string[\s\S]+workThreads: WorkThread\[\]/, "工作台状态没有记录当前任务会话");
assert.match(store, /sourceVersion <= 2[\s\S]+schemaVersion: 3[\s\S]+workThreads: \[\]/, "旧状态没有安全迁移到任务会话结构");
assert.match(store, /async createWorkThread[\s\S]+folderMode === "existing"[\s\S]+createLocalCaseRecord/, "新任务没有同时支持已有和新建工作文件夹");
assert.match(store, /async updateConversationThreadStatus[\s\S]+"archived"[\s\S]+"removed"/, "会话缺少归档、移除和恢复生命周期");
assert.match(store, /workThread\.messages = currentCase\.messages/, "案件工作流结果没有同步回原任务会话");
assert.match(preload, /createWorkThread[\s\S]+switchWorkThread[\s\S]+updateConversationThreadStatus/, "任务会话 IPC 暴露不完整");
assert.match(main, /workbench:create-work-thread[\s\S]+workbench:switch-work-thread[\s\S]+workbench:update-conversation-thread-status/, "任务会话主进程处理器不完整");
assert.match(app, />新建运维项目<|新建运维项目<\/strong>/, "左上角没有提供新建运维项目入口");
assert.match(app, /新建文件夹[\s\S]+已有文件夹/, "新任务弹窗没有提供两种文件夹绑定方式");
assert.match(app, /ConversationThreadRow[\s\S]+复制会话 ID[\s\S]+归档[\s\S]+移除[\s\S]+恢复/, "会话列表缺少完整管理入口");
assert.match(app, /composerTextareaRef[\s\S]+scrollHeight[\s\S]+rows=\{1\}/, "输入框没有按内容自适应高度");
assert.match(styles, /\.compact-composer[\s\S]+min-height:\s*88px/, "输入框仍未收敛为紧凑单体");
assert.match(styles, /\.compact-composer \.model-select[\s\S]+background:\s*#f3f4f6/, "模型选择器没有内嵌到输入框操作区");

const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase47-threads-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
let state = await store.createLocalProject({ name: "Phase47 Project", sapVersion: "S4", systemLabel: "LOCAL/047" });
const projectId = state.activeProjectId;
state = await store.createWorkThread({ projectId, title: "任务 A", folderMode: "new", folderName: "共享文件夹" });
const threadA = state.workThreads.find((item) => item.title === "任务 A");
const caseId = threadA.caseId;
await store.appendMessage({ projectId, caseId, threadId: threadA.id, content: "任务 A 的独立记录", taskMode: "problem-analysis", modelId: "local-workflow", actionId: null, permissionMode: "request_approval" });
state = await store.createWorkThread({ projectId, title: "任务 B", folderMode: "existing", caseId });
const threadB = state.workThreads.find((item) => item.title === "任务 B");
await store.appendMessage({ projectId, caseId, threadId: threadB.id, content: "任务 B 的独立记录", taskMode: "problem-analysis", modelId: "local-workflow", actionId: null, permissionMode: "request_approval" });
state = await store.switchWorkThread({ threadId: threadA.id });
const taskAAfterSwitch = state.workThreads.find((item) => item.id === threadA.id);
const taskBAfterSwitch = state.workThreads.find((item) => item.id === threadB.id);
check(taskAAfterSwitch.messages.some((item) => item.content.includes("任务 A 的独立记录")), "任务 A 历史丢失");
check(!taskAAfterSwitch.messages.some((item) => item.content.includes("任务 B 的独立记录")), "任务 B 历史串入任务 A");
check(taskBAfterSwitch.messages.some((item) => item.content.includes("任务 B 的独立记录")), "任务 B 历史丢失");

const project = state.projects.find((item) => item.id === projectId);
const caseItem = project.cases.find((item) => item.id === caseId);
const caseRoot = path.join(${JSON.stringify(isolatedRepoRoot)}, "local-data", "workbench", "projects", projectId, "cases", caseItem.folderName);
const threadAFile = await readFile(path.join(caseRoot, "technical", "conversations", threadA.id, "conversation.md"), "utf8");
const threadBFile = await readFile(path.join(caseRoot, "technical", "conversations", threadB.id, "conversation.md"), "utf8");
const activeConversation = await readFile(path.join(caseRoot, "conversation.md"), "utf8");
check(threadAFile.includes("任务 A 的独立记录") && !threadAFile.includes("任务 B 的独立记录"), "任务 A 文件快照被覆盖");
check(threadBFile.includes("任务 B 的独立记录") && !threadBFile.includes("任务 A 的独立记录"), "任务 B 文件快照被覆盖");
check(activeConversation.includes("任务 A 的独立记录") && !activeConversation.includes("任务 B 的独立记录"), "切换任务后文件夹预览没有同步当前会话");

const boundA = await store.bindCaseWorkflowTarget({ content: "后台写回任务 A", taskMode: "problem-analysis", modelId: "local-workflow", actionId: null, permissionMode: "request_approval" });
await store.switchWorkThread({ threadId: threadB.id });
state = await store.appendMessage(boundA);
check(state.activeWorkThreadId === threadB.id, "Work 后台结果抢回了原任务");
check(state.workThreads.find((item) => item.id === threadA.id).messages.some((item) => item.content.includes("后台写回任务 A")), "Work 后台结果没有写回原任务");

state = await store.createDailyChatThread({ title: "Chat A" });
const chatA = state.activeChatThreadId;
state = await store.createDailyChatThread({ title: "Chat B" });
const chatB = state.activeChatThreadId;
state = await store.appendDailyChatMessage({ threadId: chatA, content: "后台 Chat A", projectId, providerId: "provider-a", modelId: "model-a" });
check(state.activeChatThreadId === chatB, "Chat 后台结果抢回了原会话");
await store.updateConversationThreadStatus({ scope: "chat", threadId: chatA, status: "archived" });
let archivedRejected = false;
try {
  await store.appendDailyChatMessage({ threadId: chatA, content: "不得重定向", projectId, providerId: "provider-a", modelId: "model-a" });
} catch {
  archivedRejected = true;
}
check(archivedRejected, "归档 Chat 的后台结果被静默重定向");

let mismatchedTargetRejected = false;
state = await store.createWorkThread({ projectId, title: "任务 C", folderMode: "new", folderName: "另一个文件夹" });
const threadC = state.workThreads.find((item) => item.title === "任务 C");
try {
  await store.appendMessage({ projectId, caseId: threadC.caseId, threadId: threadB.id, content: "错误目标", taskMode: "problem-analysis", modelId: "local-workflow", actionId: null, permissionMode: "request_approval" });
} catch {
  mismatchedTargetRejected = true;
}
check(mismatchedTargetRejected, "不一致的任务与文件夹目标没有被拒绝");

for (const activeThread of state.workThreads.filter((item) => item.status === "active" && item.id !== threadC.id)) {
  state = await store.updateConversationThreadStatus({ scope: "work", threadId: activeThread.id, status: "archived" });
}
state = await store.updateConversationThreadStatus({ scope: "work", threadId: threadC.id, status: "archived" });
const fallbackTask = state.workThreads.find((item) => item.id === state.activeWorkThreadId);
check(fallbackTask?.status === "active" && fallbackTask.messages.length === 0, "归档最后一个任务后复制了旧会话历史");
process.stdout.write("phase47-task-thread-runtime=ok\\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: root, sourcefile: "phase47-probe-entry.ts", loader: "ts" },
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

console.log("phase47-task-thread-composer-probe=ok");
