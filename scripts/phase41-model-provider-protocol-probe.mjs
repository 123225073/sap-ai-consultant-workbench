import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase41-model-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

const entrySource = `
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import {
  AnthropicCompatibleModelProviderConnector,
  OpenAiCompatibleModelProviderConnector
} from "./apps/desktop/src/main/modelProviderConnector.ts";
import { assertPublicModelEndpoint, createSecureModelJsonRequester } from "./apps/desktop/src/main/modelEndpointSecurity.ts";
import { secretTargetIdFor } from "./apps/desktop/src/main/secretTargetIdentity.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function mockRequester(url, apiLabel, options) {
  const response = await globalThis.fetch(url, options);
  if (!response.ok) throw new Error("HTTP " + response.status + "：" + apiLabel + " 请求失败。");
  return response.json();
}

await assertPublicModelEndpoint("https://public.example.com/v1", async () => [{ address: "93.184.216.34" }]);
let privateResolutionBlocked = false;
try {
  await assertPublicModelEndpoint("https://public.example.com/v1", async () => [{ address: "169.254.169.254" }]);
} catch (error) {
  privateResolutionBlocked = error instanceof Error && error.message.includes("内网");
}
assert(privateResolutionBlocked, "a public hostname resolving to a private or metadata address must be blocked");
pass("dnsResolvedPrivateAddressBlocked");
for (const address of ["fe90::1", "feb0::1", "ff02::1", "::7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:0::1"]) {
  let unsafeIpv6Blocked = false;
  try {
    await assertPublicModelEndpoint("https://public.example.com/v1", async () => [{ address }]);
  } catch (error) {
    unsafeIpv6Blocked = error instanceof Error && error.message.includes("内网");
  }
  assert(unsafeIpv6Blocked, "unsafe IPv6 address was not blocked: " + address);
}
pass("unsafeIpv6RangesBlocked");

let insecureProtocolBlocked = false;
try {
  await assertPublicModelEndpoint("http://public.example.com/v1", async () => [{ address: "93.184.216.34" }]);
} catch (error) {
  insecureProtocolBlocked = error instanceof Error && error.message.includes("HTTPS");
}
assert(insecureProtocolBlocked, "model endpoints must require HTTPS");
pass("modelHttpEndpointBlocked");

const defaultHttpConnector = new OpenAiCompatibleModelProviderConnector();
const defaultHttpReport = await defaultHttpConnector.verify({
  id: "http-default-requester",
  name: "HTTP 默认请求器",
  providerType: "openai-compatible",
  baseUrl: "http://public.example.com/v1",
  apiKey: "not-sent",
  catalogMode: "manual",
  testModelId: "manual-chat",
  manualModelIds: ["manual-chat"]
});
assert(!defaultHttpReport.ok && defaultHttpReport.steps.some((item) => item.detail.includes("HTTPS")), "default production connector must block HTTP before a network request");
pass("defaultConnectorHttpBlocked");

let pinnedAddress = "";
let pinnedServername = "";
let fakeHttpsStatus = 200;
function fakeHttpsFactory(url, options, onResponse) {
  const request = new EventEmitter();
  request.setTimeout = () => request;
  request.write = () => true;
  request.destroy = (error) => {
    if (error) queueMicrotask(() => request.emit("error", error));
    return request;
  };
  request.end = () => {
    pinnedServername = options.servername;
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      if (error) return request.emit("error", error);
      pinnedAddress = Array.isArray(addresses) ? addresses[0]?.address ?? "" : addresses;
      const response = new EventEmitter();
      response.statusCode = fakeHttpsStatus;
      response.resume = () => {};
      onResponse(response);
      queueMicrotask(() => {
        response.emit("data", Buffer.from('{"ok":true}'));
        response.emit("end");
      });
    });
    return request;
  };
  return request;
}
const pinnedRequester = createSecureModelJsonRequester(async () => [{ address: "93.184.216.34", family: 4 }], fakeHttpsFactory);
const pinnedPayload = await pinnedRequester("https://models.example.com/v1/models", "固定 DNS 测试", { method: "GET" });
assert(pinnedPayload.ok === true && pinnedAddress === "93.184.216.34", "secure requester did not use the validated pinned address");
assert(pinnedServername === "models.example.com", "secure requester did not preserve the original TLS servername");
fakeHttpsStatus = 302;
let redirectBlocked = false;
try {
  await pinnedRequester("https://models.example.com/v1/models", "重定向测试", { method: "GET" });
} catch (error) {
  redirectBlocked = error instanceof Error && error.message.includes("重定向");
}
assert(redirectBlocked, "secure requester must reject redirects");
pass("secureRequesterPinsDnsAndSni");

const originalFetch = globalThis.fetch;
try {
  const openAiRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    openAiRequests.push({ url: String(url), init });
    if (String(url).endsWith("/models")) return jsonResponse({ error: "unavailable" }, 503);
    return jsonResponse({ choices: [{ message: { content: "pong" } }] });
  };

  const openAi = new OpenAiCompatibleModelProviderConnector(mockRequester);
  const openAiReport = await openAi.verify({
    id: "openai-manual",
    name: "OpenAI 手工回退",
    providerType: "openai-compatible",
    baseUrl: "https://models.example.com/v1",
    apiKey: "probe-openai-key",
    catalogMode: "remote-with-manual-fallback",
    testModelId: "manual-priority",
    manualModelIds: ["manual-other", "manual-priority"]
  });
  assert(openAiReport.ok, "OpenAI manual fallback should verify");
  assert(openAiReport.selectedModelId === "manual-priority", "saved testModelId must have priority");
  assert(openAiReport.models.some((model) => model.id === "manual-other"), "manual model catalog was not retained");
  assert(openAiRequests[0].url.endsWith("/models"), "OpenAI must request /models");
  assert(openAiRequests[0].init.headers.Authorization === "Bearer probe-openai-key", "OpenAI must use Bearer auth");
  assert(openAiRequests[1].url.endsWith("/chat/completions"), "OpenAI must request /chat/completions");
  assert(JSON.parse(openAiRequests[1].init.body).model === "manual-priority", "OpenAI probe used the wrong model");
  assert(openAiReport.steps[0].detail.includes("HTTP 503") && openAiReport.steps[0].detail.includes("OpenAI API /models"), "fallback detail must preserve HTTP and API names");
  pass("openAiProtocolAndManualFallback");

  const anthropicRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    anthropicRequests.push({ url: String(url), init });
    if (String(url).endsWith("/models")) return jsonResponse({ data: [{ id: "claude-remote" }] });
    return jsonResponse({ content: [{ type: "text", text: "Anthropic reply" }] });
  };

  const anthropic = new AnthropicCompatibleModelProviderConnector(mockRequester);
  const anthropicInput = {
    id: "anthropic-provider",
    name: "Anthropic 兼容渠道",
    providerType: "anthropic-compatible",
    baseUrl: "https://anthropic.example.com/v1",
    apiKey: "probe-anthropic-key",
    catalogMode: "remote-with-manual-fallback",
    testModelId: "claude-manual",
    manualModelIds: ["claude-manual"]
  };
  const anthropicReport = await anthropic.verify(anthropicInput);
  assert(anthropicReport.ok && anthropicReport.selectedModelId === "claude-manual", "Anthropic saved test model should verify first");
  assert(anthropicReport.models.some((model) => model.id === "claude-remote"), "Anthropic remote catalog missing");
  assert(anthropicRequests[0].init.headers["x-api-key"] === "probe-anthropic-key", "Anthropic must use x-api-key");
  assert(anthropicRequests[0].init.headers["anthropic-version"] === "2023-06-01", "Anthropic version header missing");
  assert(anthropicRequests[1].url.endsWith("/messages"), "Anthropic must request /messages");
  const verifiedBody = JSON.parse(anthropicRequests[1].init.body);
  assert(verifiedBody.model === "claude-manual" && !Object.hasOwn(verifiedBody, "temperature"), "Anthropic minimum request was not converted");

  const daily = await anthropic.generateDailyChat({
    ...anthropicInput,
    modelId: "claude-manual",
    content: "继续",
    history: [
      { role: "user", content: "第一轮问题" },
      { role: "assistant", content: "第一轮回答" }
    ]
  });
  const dailyBody = JSON.parse(anthropicRequests.at(-1).init.body);
  assert(daily.content === "Anthropic reply", "Anthropic response text was not extracted");
  assert(typeof dailyBody.system === "string", "Anthropic system prompt is missing");
  assert(JSON.stringify(dailyBody.messages.map((message) => message.role)) === JSON.stringify(["user", "assistant", "user"]), "Anthropic multi-turn history conversion is invalid");
  assert(dailyBody.messages[2].content === "继续", "Anthropic current message must follow the bounded history");
  pass("anthropicProtocolAndConversion");

  const store = new WorkspaceStore(isolatedRepoRoot);
  let state = await store.createLocalProject({ name: "Phase41", sapVersion: "S4", systemLabel: "LOCAL/041" });
  let project = state.projects.find((item) => item.id === state.activeProjectId);
  const config = JSON.parse(JSON.stringify(project.config));
  config.apiProviders[0] = {
    ...config.apiProviders[0],
    id: "saved-manual",
    name: "Saved Manual",
    providerType: "anthropic-compatible",
    baseUrl: "https://anthropic.example.com/v1",
    enabled: true,
    catalogMode: "manual",
    testModelId: "claude-manual",
    manualModelIds: ["claude-manual", "claude-manual", "bad model id", "claude-second"]
  };
  state = await store.saveProjectConfig(project.id, config);
  project = state.projects.find((item) => item.id === state.activeProjectId);
  let savedProvider = project.config.apiProviders[0];
  assert(savedProvider.catalogMode === "manual", "catalogMode was not saved");
  assert(JSON.stringify(savedProvider.manualModelIds) === JSON.stringify(["claude-manual", "claude-second"]), "manual model IDs were not normalized");
  assert(savedProvider.testModelId === "claude-manual", "testModelId was not saved");

  const longPrefix = "provider-" + "x".repeat(100);
  const colliding = JSON.parse(JSON.stringify(project.config));
  colliding.apiProviders = [
    { ...colliding.apiProviders[0], id: longPrefix + "-one" },
    { ...colliding.apiProviders[0], id: longPrefix + "-two", name: "Second" }
  ];
  state = await store.saveProjectConfig(project.id, colliding);
  project = state.projects.find((item) => item.id === state.activeProjectId);
  const normalizedProviderIds = project.config.apiProviders.map((item) => item.id);
  assert(new Set(normalizedProviderIds).size === 2, "long provider IDs must stay unique after secure-target normalization");
  assert(normalizedProviderIds.every((id) => id.length <= 80), "provider IDs must fit secure secret target segments");
  assert(new Set(normalizedProviderIds.map((providerId) => secretTargetIdFor({ kind: "api-key", providerId }))).size === 2, "long provider IDs must remain distinct in the final secure-store target");

  const providerBeforeVerification = project.config.apiProviders.find((item) => item.id === normalizedProviderIds[0]);
  const modelVerificationSequence = store.beginModelProviderVerification(project.id, normalizedProviderIds[0]);
  state = await store.updateModelProviderVerification(project.id, normalizedProviderIds[0], modelVerificationSequence, providerBeforeVerification, anthropicReport);
  project = state.projects.find((item) => item.id === state.activeProjectId);
  savedProvider = project.config.apiProviders[0];
  assert(savedProvider.models.some((model) => model.id === "claude-manual"), "merged verified models were not persisted");
  assert(savedProvider.lastVerifiedModelId === "claude-manual", "lastVerifiedModelId was not persisted");

  const sameProviderSnapshot = JSON.parse(JSON.stringify(savedProvider));
  const olderModelSequence = store.beginModelProviderVerification(project.id, savedProvider.id);
  const newerModelSequence = store.beginModelProviderVerification(project.id, savedProvider.id);
  const newerModelReport = { ...anthropicReport, checkedAt: "2026-07-11T13:00:00.000Z" };
  state = await store.updateModelProviderVerification(project.id, savedProvider.id, newerModelSequence, sameProviderSnapshot, newerModelReport);
  let olderModelResultBlocked = false;
  try {
    await store.updateModelProviderVerification(project.id, savedProvider.id, olderModelSequence, sameProviderSnapshot, {
      ...anthropicReport,
      ok: false,
      checkedAt: "2026-07-11T12:59:00.000Z",
      modelSyncStatus: "failed",
      chatTestStatus: "failed",
      selectedModelId: null
    });
  } catch (error) {
    olderModelResultBlocked = error instanceof Error && error.message.includes("较早结果未保存");
  }
  assert(olderModelResultBlocked, "an older same-config model verification must not overwrite the newer result");
  project = state.projects.find((item) => item.id === state.activeProjectId);
  assert(project.config.apiProviders[0].lastCheckedAt === newerModelReport.checkedAt, "newer same-config model verification did not remain authoritative");

  const forged = JSON.parse(JSON.stringify(project.config));
  forged.apiProviders[0].models = [{ id: "renderer-forged", displayName: "forged", capabilities: ["chat"], lastSeenAt: "2026-07-11T00:00:00.000Z" }];
  forged.apiProviders[0].lastVerifiedModelId = "renderer-forged";
  state = await store.saveProjectConfig(project.id, forged);
  project = state.projects.find((item) => item.id === state.activeProjectId);
  assert(project.config.apiProviders[0].lastVerifiedModelId === "claude-manual", "renderer forged lastVerifiedModelId");
  assert(!project.config.apiProviders[0].models.some((model) => model.id === "renderer-forged"), "renderer forged verified model catalog");

  const providerBeforeEdit = JSON.parse(JSON.stringify(project.config.apiProviders[0]));
  const staleModelSequence = store.beginModelProviderVerification(project.id, providerBeforeEdit.id);
  const editedProviderConfig = JSON.parse(JSON.stringify(project.config));
  editedProviderConfig.apiProviders[0].baseUrl = "https://changed.example.com/v1";
  state = await store.saveProjectConfig(project.id, editedProviderConfig);
  let staleModelResultBlocked = false;
  try {
    await store.updateModelProviderVerification(project.id, providerBeforeEdit.id, staleModelSequence, providerBeforeEdit, anthropicReport);
  } catch (error) {
    staleModelResultBlocked = error instanceof Error && error.message.includes("验证期间已发生变化");
  }
  assert(staleModelResultBlocked, "a late result for an edited model provider must be rejected");
  pass("savedManualCatalogAndVerificationPersistence");

  const [mainSource, connectorSource, endpointSecuritySource] = await Promise.all([
    readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/modelProviderConnector.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/modelEndpointSecurity.ts"), "utf8")
  ]);
  assert(mainSource.includes("await store.getApiProviderConfig(projectId, providerId)"), "verification must load the saved Project provider");
  assert(mainSource.includes("isUnsafeModelHost") && mainSource.includes("真实模型渠道必须使用 HTTPS"), "localhost/private-network model boundary changed");
  assert(!mainSource.includes("workbench:model-request") && !mainSource.includes("workbench:list-models"), "broad model IPC was added");
  assert(connectorSource.includes('providerType === "anthropic-compatible"'), "providerType protocol selection missing");
  assert(endpointSecuritySource.includes("lookup:") && endpointSecuritySource.includes("selected.address"), "model requests must pin the validated DNS address");
  assert(endpointSecuritySource.includes("返回了重定向，已阻止跳转"), "model requests must reject redirects before credentials can reach another target");
  assert(!connectorSource.includes("await fetch("), "production model connector must not use a second unpinned DNS lookup through fetch");
  assert(mainSource.includes("await assertPublicModelEndpoint(provider.baseUrl)"), "saved providers must be DNS checked before use");
  pass("savedConfigAndSecurityBoundaries");
} finally {
  globalThis.fetch = originalFetch;
}
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase41-model-provider-probe-entry.ts",
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
  process.stdout.write("phase41-model-provider-protocol-probe=ok\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
