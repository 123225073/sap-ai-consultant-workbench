import { build } from "esbuild";
import { mkdtemp, readFile, rm as removeTree } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase39-realignment-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};
const PROBE_MARKER = "phase39-product-realignment";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function activeProject(state) {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function providerDraft(id, name, baseUrl) {
  return {
    id,
    name,
    providerType: "openai-compatible",
    baseUrl,
    enabled: true,
    credential: { secretRef: null, kind: "api-key", store: null, state: "not-set", updatedAt: null },
    models: [],
    modelSyncStatus: "not-configured",
    chatTestStatus: "not-configured",
    lastVerificationMode: null,
    verifiedModelIds: [],
    lastVerifiedModelId: null,
    lastCheckedAt: null
  };
}

const store = new WorkspaceStore(isolatedRepoRoot);
let state = await store.createLocalProject({ name: "Phase39 Client", sapVersion: "S4", systemLabel: "LOCAL/039" });
let project = activeProject(state);
assert(project, "phase39 project missing");

const twoProviderConfig = JSON.parse(JSON.stringify(project.config));
twoProviderConfig.apiProviders = [
  providerDraft("provider-primary", "Primary", "https://api.primary.example/v1"),
  providerDraft("provider-primary", "Secondary", "https://api.secondary.example/v1")
];
state = await store.saveProjectConfig(project.id, twoProviderConfig);
project = activeProject(state);
assert(project.config.apiProviders.length === 2, "multi-provider config was not saved");
assert(new Set(project.config.apiProviders.map((item) => item.id)).size === 2, "duplicate provider ids were not normalized");
pass("multipleProvidersSavedWithUniqueIds");

let provider = project.config.apiProviders[0];
state = await store.attachProjectSecret(project.id, { kind: "api-key", providerId: provider.id }, {
  secretRef: null,
  kind: "api-key",
  store: "electron-safe-storage",
  state: "set-in-secure-store",
  updatedAt: "2026-07-10T00:00:00.000Z"
});
project = activeProject(state);
provider = project.config.apiProviders[0];
const models = [
  { id: "probe-chat", displayName: "Probe Chat", capabilities: ["chat"], lastSeenAt: "2026-07-10T00:00:00.000Z" },
  { id: "alternate-chat", displayName: "Alternate Chat", capabilities: ["chat", "reasoning"], lastSeenAt: "2026-07-10T00:00:00.000Z" }
];
const providerVerificationSequence = store.beginModelProviderVerification(project.id, provider.id);
state = await store.updateModelProviderVerification(project.id, provider.id, providerVerificationSequence, provider, {
  ok: true,
  checkedAt: "2026-07-10T00:00:00.000Z",
  mode: "http",
  provider: { id: provider.id, name: provider.name, providerType: provider.providerType, endpointHost: "api.primary.example" },
  steps: [
    { id: "models", title: "获取模型列表", status: "passed", detail: "2 models", checkedAt: "2026-07-10T00:00:00.000Z" },
    { id: "chat", title: "最小对话测试", status: "passed", detail: "probe ok", checkedAt: "2026-07-10T00:00:00.000Z" }
  ],
  modelSyncStatus: "verified",
  chatTestStatus: "verified",
  models,
  selectedModelId: "probe-chat",
  errors: []
});

const alternateRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: provider.id,
  modelId: "alternate-chat",
  permissionMode: "approve_for_me"
});
assert(alternateRequest?.modelId === "alternate-chat", "every model in a verified provider catalog must be selectable for Work");
pass("verifiedProviderCatalogSelectable");

project = activeProject(state);
const forgedConfig = JSON.parse(JSON.stringify(project.config));
forgedConfig.apiProviders[0].models = [{ id: "forged-model", displayName: "Forged", capabilities: ["chat"], lastSeenAt: "2026-07-10T00:00:00.000Z" }];
forgedConfig.apiProviders[0].lastVerifiedModelId = "forged-model";
forgedConfig.apiProviders[0].verifiedModelIds = ["forged-model"];
forgedConfig.apiProviders[0].modelSyncStatus = "verified";
forgedConfig.apiProviders[0].chatTestStatus = "verified";
forgedConfig.apiProviders[0].lastVerificationMode = "http";
state = await store.saveProjectConfig(project.id, forgedConfig);
project = activeProject(state);
assert(project.config.apiProviders[0].models.some((item) => item.id === "probe-chat"), "main-owned model catalog was overwritten by renderer config");
assert(!project.config.apiProviders[0].models.some((item) => item.id === "forged-model"), "forged renderer model entered main-owned catalog");
pass("rendererCannotForgeVerificationCatalog");

const staleVerifiedConfig = JSON.parse(JSON.stringify(project.config));
const changedEndpointConfig = JSON.parse(JSON.stringify(project.config));
changedEndpointConfig.apiProviders[0].baseUrl = "https://api.changed.example/v1";
state = await store.saveProjectConfig(project.id, changedEndpointConfig);
project = activeProject(state);
assert(project.config.apiProviders[0].lastVerificationMode === null && project.config.apiProviders[0].models.length === 0, "endpoint change did not invalidate provider verification");
state = await store.saveProjectConfig(project.id, staleVerifiedConfig);
project = activeProject(state);
assert(project.config.apiProviders[0].lastVerificationMode === null && project.config.apiProviders[0].models.length === 0, "stale renderer config restored invalid verification");
pass("staleVerificationCannotBeRestored");

state = await store.createDailyChatThread({ title: "Provider-isolated history" });
const chatThreadId = state.activeChatThreadId;
await store.appendDailyChatMessage({
  threadId: chatThreadId,
  projectId: project.id,
  providerId: "provider-a",
  modelId: "model-a",
  content: "A user message"
}, {
  content: "A assistant message",
  modelId: "model-a",
  responseMode: "model-success",
  projectId: project.id,
  providerId: "provider-a",
  providerName: "Provider A"
});
await store.appendDailyChatMessage({
  threadId: chatThreadId,
  projectId: project.id,
  providerId: "provider-b",
  modelId: "model-b",
  content: "B user message"
}, {
  content: "B assistant message",
  modelId: "model-b",
  responseMode: "model-success",
  projectId: project.id,
  providerId: "provider-b",
  providerName: "Provider B"
});
const providerAHistory = await store.getDailyChatModelHistory(chatThreadId, project.id, "provider-a", "model-a");
const providerBHistory = await store.getDailyChatModelHistory(chatThreadId, project.id, "provider-b", "model-b");
assert(providerAHistory.length === 2 && providerAHistory.every((item) => item.content.startsWith("A ")), "provider A history leaked another channel");
assert(providerBHistory.length === 2 && providerBHistory.every((item) => item.content.startsWith("B ")), "provider B history leaked another channel");
pass("dailyChatHistoryIsolatedByProviderAndModel");

const [appSource, configSource, storeSource, mainSource, preloadSource, rendererTypes, styles, modelConnector, preflight] = await Promise.all([
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/ConfigCenter.tsx"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/preload/preload.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/vite-env.d.ts"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/renderer/styles.css"), "utf8"),
  readFile(path.join(repoRoot, "apps/desktop/src/main/modelProviderConnector.ts"), "utf8"),
  readFile(path.join(repoRoot, "scripts/security-preflight.ps1"), "utf8")
]);

assert(configSource.includes("phase39-multi-provider-registry") && configSource.includes("addModelProvider"), "multi-provider registry UI missing");
assert(configSource.includes("removeModelProvider") && configSource.includes("移除当前模型渠道"), "multi-provider removal UI missing");
assert(mainSource.includes('kind: "api-key", providerId: removedProviders[0].id'), "removed provider API key cleanup missing");
assert(appSource.includes("await previewCaseFile(matchedFile)"), "file search result must open the matched local preview");
assert(appSource.includes("provider.models") && appSource.includes('model.capabilities.includes("chat")'), "composer must expose chat-capable models from the complete verified provider catalog");
assert(appSource.includes("permissionMode: actionPermissionMode"), "ordinary case messages must use the current permission mode");
assert(appSource.includes('useState<"chat" | "case" | "config" | "standards" | "knowledge">("case")'), "Work must be the default view");
assert(!appSource.includes("window-actions") && !appSource.includes("添加附件暂不可用"), "fake topbar or unfinished composer controls remain visible");
assert(storeSource.includes("preserveMainOwnedVerification(previousConfig, nextConfig)"), "main-owned verification preservation missing");
assert(mainSource.includes("const parsedInput = parseAppendDailyChatMessageInput(input);"), "daily chat must parse before network preparation");
assert(mainSource.includes("isChatCapableModel(selectedModel)"), "daily chat must accept only text-chat models in the verified provider catalog");
assert(appSource.includes("projectId: selectedSafeDraftModel ? project?.id : undefined") && appSource.includes("providerId: selectedSafeDraftModel?.provider.id"), "daily chat must send the selected channel and model through the narrow IPC input");
assert(!mainSource.includes('ipcMain.handle("workbench:reveal-project-secret"') && !preloadSource.includes("revealProjectSecret") && !rendererTypes.includes("revealProjectSecret"), "saved secret reveal surface still exists");
assert(mainSource.includes("autoHideMenuBar: true"), "native menu bar should be hidden in the workbench window");
assert(styles.includes("min-width: 0;") && styles.includes("grid-template-columns: 260px minmax(0, 1fr) 320px"), "responsive three-column shell markers missing");
assert(styles.includes("grid-template-rows: auto auto minmax(0, 1fr) auto"), "conversation panel must allocate explicit rows for heading, notice, messages and composer");
assert(styles.includes(".conversation-panel > .conversation-flow") && styles.includes(".conversation-panel > .composer"), "conditional notices must not move the composer into the flexible message row");
assert(modelConnector.includes("!extractChatContent(chatPayload).trim()"), "empty chat responses must not pass provider verification");
assert(preflight.includes(PROBE_MARKER), "security preflight must track phase39 marker");
pass("phase39SourceContracts");
pass(PROBE_MARKER);
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase39-probe-entry.ts",
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
  log("phase39-product-realignment-probe=ok");
} finally {
  await removeTree(tempRoot, { recursive: true, force: true });
}
