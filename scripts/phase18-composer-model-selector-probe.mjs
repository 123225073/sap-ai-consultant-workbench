import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase18-model-selector-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const probeName = "phase18-composer-model-selector-probe";

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCaseWorkflowInput } from "./apps/desktop/src/main/caseWorkflowService.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function activeProject(state) {
  return state.projects.find((project) => project.id === state.activeProjectId);
}

function provider(id, name, models, overrides = {}) {
  return {
    id,
    name,
    providerType: "openai-compatible",
    baseUrl: "https://fake-models.test/v1",
    enabled: true,
    credential: {
      secretRef: null,
      kind: "api-key",
      store: "electron-safe-storage",
      state: "set-in-secure-store",
      updatedAt: "2026-07-04T00:00:00.000Z"
    },
    models,
    modelSyncStatus: "verified",
    chatTestStatus: "verified",
    lastVerificationMode: "fake",
    lastVerifiedModelId: models[0]?.id ?? null,
    lastCheckedAt: "2026-07-04T00:00:00.000Z",
    ...overrides
  };
}

const parsedProviderHint = parseCaseWorkflowInput({
  content: "生成本地安全草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-b",
  modelId: "shared-model"
});
assert(parsedProviderHint.providerId === "provider-b", "safe provider hint was not preserved");
assert(parsedProviderHint.modelId === "shared-model", "safe model hint was not preserved");
const parsedUnsafeProviderHint = parseCaseWorkflowInput({
  content: "生成本地安全草稿。",
  taskMode: "problem-analysis",
  providerId: "https://example.com/provider",
  modelId: "shared-model"
});
assert(parsedUnsafeProviderHint.providerId === undefined, "unsafe provider hint was not rejected");
assert(parsedUnsafeProviderHint.modelSelectionRejected === true, "unsafe provider hint should reject model selection");
const parsedUnsafeModelHint = parseCaseWorkflowInput({
  content: "生成本地安全草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-b",
  modelId: "https://example.com/model"
});
assert(parsedUnsafeModelHint.modelId === "local-workflow", "unsafe model hint should be downgraded");
assert(parsedUnsafeModelHint.modelSelectionRejected === true, "unsafe model hint should reject model selection");
pass("providerHintParser");

const store = new WorkspaceStore(isolatedRepoRoot);
await mkdir(isolatedRepoRoot, { recursive: true });
const initialState = await store.createLocalProject({ name: "Phase18 Model Client", sapVersion: "S4", systemLabel: "LOCAL/018" });
const project = activeProject(initialState);
assert(project, "project missing");
project.config.apiProviders = [
  provider("provider-a", "Provider A", [
    { id: "shared-model", displayName: "Shared Model A", capabilities: ["chat", "tools"], lastSeenAt: "2026-07-04T00:00:00.000Z" },
    { id: "unique-a", displayName: "Unique A", capabilities: ["chat"], lastSeenAt: "2026-07-04T00:00:00.000Z" }
  ]),
  provider("provider-b", "Provider B", [
    { id: "shared-model", displayName: "Shared Model B", capabilities: ["chat", "reasoning"], lastSeenAt: "2026-07-04T00:00:00.000Z" }
  ]),
  provider("provider-disabled", "Disabled Provider", [
    { id: "disabled-model", displayName: "Disabled Model", capabilities: ["chat"], lastSeenAt: "2026-07-04T00:00:00.000Z" }
  ], { enabled: false })
];
const statePath = path.join(isolatedRepoRoot, "local-data", "workbench", "app-state.json");
await writeFile(statePath, JSON.stringify(initialState, null, 2), "utf8");

const selectedProviderRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-b",
  modelId: "shared-model"
}, { allowFakeModelExecution: true });
assert(selectedProviderRequest?.providerId === "provider-b", "selected provider id was not honored");
assert(selectedProviderRequest?.providerName === "Provider B", "selected provider name mismatch");
assert(selectedProviderRequest?.modelId === "shared-model", "selected model id mismatch");
pass("exactProviderModelSelection");

const defaultProviderRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  modelId: "shared-model"
}, { allowFakeModelExecution: true });
assert(defaultProviderRequest?.providerId === "provider-a", "default provider should remain the first eligible provider");
pass("defaultProviderFallback");

const invalidProviderRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-missing",
  modelId: "shared-model"
}, { allowFakeModelExecution: true });
assert(invalidProviderRequest === null, "invalid provider should not prepare model draft");
pass("invalidProviderRejected");

const malformedProviderRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "https://example.com/provider",
  modelId: "shared-model"
}, { allowFakeModelExecution: true });
assert(malformedProviderRequest === null, "malformed provider should not fall back to default model");
pass("malformedProviderRejected");

const malformedModelRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-b",
  modelId: "https://example.com/model"
}, { allowFakeModelExecution: true });
assert(malformedModelRequest === null, "malformed model should not fall back to default model");
pass("malformedModelRejected");

const invalidModelRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-b",
  modelId: "unique-a"
}, { allowFakeModelExecution: true });
assert(invalidModelRequest === null, "cross-provider model should not prepare model draft");
pass("crossProviderModelRejected");

const fetchedModelRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-a",
  modelId: "unique-a"
}, { allowFakeModelExecution: true });
assert(fetchedModelRequest?.providerId === "provider-a" && fetchedModelRequest.modelId === "unique-a", "a listed model from a verified provider should be selectable even when it was not the health-check model");
pass("fullFetchedCatalogSelectable");

const disabledProviderRequest = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-disabled",
  modelId: "disabled-model"
}, { allowFakeModelExecution: true });
assert(disabledProviderRequest === null, "disabled provider should not prepare model draft");
pass("disabledProviderRejected");

const fakeWithoutProbeFlag = await store.prepareSafeModelDraftRequest({
  content: "请生成一份安全本地草稿。",
  taskMode: "problem-analysis",
  providerId: "provider-b",
  modelId: "shared-model"
});
assert(fakeWithoutProbeFlag === null, "fake provider should require explicit probe flag");
pass("fakeProviderStillBlockedByDefault");

const appSource = await Promise.all([
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/main/caseWorkflowService.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/App.tsx"
].map(async (file) => readFile(path.join(repoRoot, file), "utf8"))).then((parts) => parts.join("\\n"));
assert(appSource.includes("providerId"), "provider id selection marker missing");
assert(appSource.includes("model-picker-panel"), "composer model picker UI marker missing");
assert(appSource.includes('credential.state === "set-in-secure-store"'), "renderer/main provider credential gate marker missing");
assert(appSource.includes("lastVerifiedModelId"), "verified model id gate marker missing");
for (const forbidden of ["workbench:list-models", "workbench:safe-model-draft", "chat-completions", "get-api-key", "read-api-key", "fetch-url"]) {
  assert(!appSource.includes(forbidden), "dangerous model selector marker found: " + forbidden);
}
pass("noNewModelIpc");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase18-probe-entry.ts",
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
