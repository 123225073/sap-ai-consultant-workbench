import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [
  sharedTypes,
  workspaceStore,
  mainSource,
  modelConnector,
  preloadSource,
  rendererTypes,
  appSource,
  configCenter,
  styles
] = await Promise.all([
  readFile(path.join(repoRoot, "apps/desktop/src/shared/workbenchTypes.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/modelProviderConnector.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/preload/preload.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/vite-env.d.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/ConfigCenter.tsx"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/styles.css"), "utf8")
]);

assert(!sharedTypes.includes("ProjectSecretRevealInput"), "saved secret reveal input must not exist");
assert(!sharedTypes.includes("ProjectSecretRevealResult"), "saved secret reveal result must not exist");
assert(sharedTypes.includes("export interface CreateLocalCaseInput") && sharedTypes.includes("projectId: string;"), "new case projectId must be required");
assert(sharedTypes.includes("export interface DailyChatThread"), "daily chat thread type missing");
assert(sharedTypes.includes("export interface AppendDailyChatMessageInput"), "daily chat append input type missing");
assert(sharedTypes.includes("activeChatThreadId: string;") && sharedTypes.includes("chatThreads: DailyChatThread[];"), "workbench state must expose standalone daily chats");
pass("sharedContracts");

assert(workspaceStore.includes("this.sanitizeProjectConfig(project, config, { preserveVerification: true })"), "config save must preserve existing verification before selective reset");
assert(workspaceStore.includes("preserveMainOwnedVerification(previousConfig, nextConfig);"), "renderer must not own verification state or model catalogs");
assert(workspaceStore.includes("resetChangedVerification(previousConfig, nextConfig);"), "config save must selectively reset changed verification only");
assert(workspaceStore.includes("resetSecretTargetVerification(project.config, target);"), "secret save must reset only the affected target verification");
assert(workspaceStore.includes('const projectId = assertStrictLifecycleId("项目 ID", candidate.projectId);'), "create case parser must require projectId");
assert(!workspaceStore.includes("caseInput.projectId ?? state.activeProjectId"), "create case must not silently fall back to active project");
assert(workspaceStore.includes("async createDailyChatThread"), "store daily chat creation missing");
assert(workspaceStore.includes("async switchDailyChatThread"), "store daily chat switch missing");
assert(workspaceStore.includes("async appendDailyChatMessage"), "store daily chat append missing");
assert(workspaceStore.includes("activeChatThreadId: chatThread.id") && workspaceStore.includes("chatThreads: [chatThread]"), "empty state must include standalone daily chat");
pass("storeStatePersistence");

assert(!mainSource.includes('ipcMain.handle("workbench:reveal-project-secret"'), "main must not expose saved secret reveal IPC");
assert(!preloadSource.includes("revealProjectSecret"), "preload must not expose saved secret reveal bridge");
assert(!rendererTypes.includes("revealProjectSecret"), "renderer types must not expose saved secret reveal bridge");
pass("secretNonRevealBoundary");

assert(mainSource.includes('ipcMain.handle("workbench:create-daily-chat-thread"'), "main daily chat create IPC missing");
assert(mainSource.includes('ipcMain.handle("workbench:switch-daily-chat-thread"'), "main daily chat switch IPC missing");
assert(mainSource.includes('ipcMain.handle("workbench:append-daily-chat-message"'), "main daily chat append IPC missing");
assert(mainSource.includes("prepareDailyChatAssistantReply"), "main daily chat model reply preparation missing");
assert(mainSource.includes("isProviderReadyForDailyChat"), "daily chat must use verified model readiness gate");
assert(mainSource.includes("runTrackedDailyChatMessage(runtime, store, secretStore, agentContextService"), "daily chat IPC must enter the tracked Agent runtime");
assert(mainSource.includes("appendDailyChatMessage(store, secretStore, agentContextService, requestId"), "daily chat must use the context-aware orchestration helper");
assert(mainSource.includes("const parsedInput = parseAppendDailyChatMessageInput(input);"), "daily chat input must be parsed before any model network call");
assert(modelConnector.includes("generateDailyChat"), "model connector daily chat generation missing");
assert(modelConnector.includes("input.history ?? []") && mainSource.includes("getDailyChatAgentContextHistory") && mainSource.includes("assembledContext.history"), "daily chat must send bounded, assembled thread history to the selected model");
assert(workspaceStore.includes("slice(-12)") && workspaceStore.includes("totalLength + content.length > 12000"), "daily chat history bounds are missing");
assert(workspaceStore.includes('message.role === "user"') && workspaceStore.includes('message.responseMode === "model-success"'), "daily chat history must preserve valid user and model messages");
assert(mainSource.includes("getDailyChatAgentContextHistory(request.threadId, projectId, provider.id)") && mainSource.includes("threadId: request.threadId"), "daily chat history must be scoped by thread, project and provider before entering context");
assert(modelConnector.includes("日常对话不得读取或声称读取 Project、Case、本机文件、SAP 或飞书资料") && modelConnector.includes("只可使用当前对话和已确认的个人记忆"), "daily chat system boundary prompt missing");
assert(preloadSource.includes("createDailyChatThread") && preloadSource.includes("appendDailyChatMessage"), "preload daily chat bridge missing");
assert(rendererTypes.includes("switchDailyChatThread") && rendererTypes.includes("AppendDailyChatMessageInput"), "renderer daily chat bridge type missing");
pass("dailyChatBridge");

assert(!configCenter.includes("toggleSavedSecret"), "config center must not fetch saved secret values");
assert(!configCenter.includes("onRevealSecret"), "config center must not receive a secret reveal callback");
assert(configCenter.includes("已保存密钥不可回显"), "saved secret field should explain the non-reveal boundary");
assert(!appSource.includes("async function revealProjectSecret"), "app must not contain a secret reveal callback");
pass("secretNonRevealUi");

assert(!appSource.includes("groupConversationThreads"), "daily conversation must not be derived from project cases");
assert(!appSource.includes("flatMap((item) => item.cases.map((caseItem) => ({ project: item, caseItem })))"), "daily conversation must not flatten project cases");
assert(appSource.includes("groupDailyChatThreads"), "standalone daily chat grouping missing");
assert(appSource.includes('activeView === "chat"'), "daily chat view missing");
assert(appSource.includes("appendDailyChatMessage"), "daily chat send flow missing");
const dailyChatSendRegion = appSource.match(/if \(activeView === "chat"\)[\s\S]*?return;/)?.[0] ?? "";
assert(dailyChatSendRegion.includes("appendDailyChatMessage"), "daily chat send region missing");
assert(dailyChatSendRegion.includes("projectId: selectedSafeDraftModel ? project?.id : undefined"), "daily chat may borrow only the selected verified project model channel");
assert(dailyChatSendRegion.includes("providerId: selectedSafeDraftModel?.provider.id"), "daily chat should pass explicit model channel provenance");
assert(!dailyChatSendRegion.includes("caseId:"), "daily chat must not pass a case binding");
assert(appSource.includes("conversation-sidebar-section"), "conversation sidebar section missing");
assert(appSource.includes('aria-label="新建运维项目"'), "new work project dialog missing");
assert(appSource.includes("newCaseProjectId") && appSource.includes("bridge.createWorkThread"), "new task must use the selected project");
assert(appSource.includes("task-folder-mode") && appSource.includes('setNewTaskFolderMode("existing")'), "new task must support new and existing folder binding");
assert(styles.includes(".conversation-sidebar-section") && styles.includes(".task-folder-mode") && styles.includes(".daily-chat-boundary"), "new sidebar/chat styles missing");
pass("codexLikeCaseUx");

const dailyChatRegion = workspaceStore.match(/async createDailyChatThread[\s\S]*?async switchProject/)?.[0] ?? "";
assert(dailyChatRegion.includes("async appendDailyChatMessage"), "daily chat methods region missing");
assert(!/readSapObjectEvidence|prepareFeishuHandoff|writeCaseMarkdown|writeCaseGeneratedFiles|ensureCaseFiles|refreshSearchIndex/.test(dailyChatRegion), "daily chat must not call SAP, Feishu, case file writes, or case indexing");
pass("dailyChatSafety");

pass("phase35-config-reveal-conversation-probe");
