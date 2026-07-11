import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase27-core-config-wizard-probe";

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readSource(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const sourceFiles = {
  configCenter: "apps/desktop/src/renderer/ConfigCenter.tsx",
  styles: "apps/desktop/src/renderer/styles.css",
  app: "apps/desktop/src/renderer/App.tsx",
  main: "apps/desktop/src/main/main.ts",
  preload: "apps/desktop/src/preload/preload.ts",
  viteEnv: "apps/desktop/src/renderer/vite-env.d.ts",
  preflight: "scripts/security-preflight.ps1"
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(sourceFiles).map(async ([key, file]) => [key, await readSource(file)]))
);

for (const [name, marker, source] of [
  ["wizard root", "phase27-core-config-wizard", sources.configCenter],
  ["compact summary", "phase27-compact-status-summary", sources.configCenter],
  ["advanced details", "phase27-advanced-details", sources.configCenter],
  ["folded verification", "phase27-folded-verification", sources.configCenter],
  ["secret eye toggle", "phase27-secret-eye-toggle", sources.configCenter],
  ["setup card style", "setup-card", sources.styles],
  ["secret eye style", "secret-toggle-button", sources.styles],
  ["summary strip style", "setup-summary-strip", sources.styles],
  ["preflight marker", PROBE_MARKER, sources.preflight],
  ["probe self marker", PROBE_MARKER, await readSource("scripts/phase27-core-config-wizard-probe.mjs")]
]) {
  assert(source.includes(marker), `missing ${name}: ${marker}`);
}
pass("phase27Markers");

for (const marker of [
  "hasUnsavedConfig",
  "onSaveSecret",
  "onVerifyAdt",
  "onVerifyFeishu",
  "onVerifyModelProvider",
  "SecretInput",
  "showAdtSecret",
  "showApiSecret",
  "saveAdtSettings",
  "saveModelSettings",
  "saveFeishuSettings",
  'lastVerificationMode === "http"',
  "lastVerifiedModelId",
  "modelSyncStatus",
  "chatTestStatus"
]) {
  assert(sources.configCenter.includes(marker) || sources.app.includes(marker), `missing retained gate marker: ${marker}`);
}
pass("phase27RetainsSaveAndVerificationGates");

const phase27ChangedSources = [
  sources.configCenter,
  sources.styles
].join("\n");

for (const forbidden of [
  "window.workbench",
  "ipcRenderer.invoke",
  "ipcMain.handle",
  "workbench:phase27",
  "workbench:config-wizard",
  "get-secret",
  "read-secret",
  "resolve-secret",
  "get-api-key",
  "read-api-key",
  "secretRef",
  "Authorization",
  "Bearer ",
  "run-sql",
  "execute-sql",
  "x-csrf-token",
  "activateObject",
  "createTransport",
  "releaseTransport",
  "transportRequest",
  "docs +create",
  "docs +update",
  "docs +publish",
  "auth login",
  "auth authorize",
  "device_code",
  "verification_uri",
  "tenant_access_token",
  "user_access_token",
  "chat-completions",
  "list-models",
  "fetch(",
  "showOpenDialog",
  "openExternal",
  "openPath",
  "execFile(",
  "spawn(",
  "readFile("
]) {
  assert(!phase27ChangedSources.includes(forbidden), `forbidden marker in Phase 27 renderer/style source: ${forbidden}`);
}
pass("phase27AddsNoUnsafeRendererCapability");

for (const forbiddenCopy of [
  "更换密码",
  "更换 API Key",
  "保存密码",
  "保存 API Key",
  "已安全保存；如需更换，请重新输入",
  "先保存再测试"
]) {
  assert(!sources.configCenter.includes(forbiddenCopy), `forbidden confusing config copy found: ${forbiddenCopy}`);
}
pass("phase27RemovesConfusingSecretActions");

const ipcSource = [sources.main, sources.preload, sources.viteEnv].join("\n");
for (const forbiddenIpc of [
  "workbench:phase27",
  "workbench:config-wizard",
  "workbench:get-secret",
  "workbench:read-secret",
  "workbench:chat-completions",
  "workbench:list-models"
]) {
  assert(!ipcSource.includes(forbiddenIpc), `forbidden IPC marker found: ${forbiddenIpc}`);
}
pass("phase27AddsNoIpc");

for (const requiredExistingBoundary of [
  "workbench:save-project-config",
  "workbench:save-project-secret",
  "workbench:adt-verify-readonly",
  "workbench:feishu-verify-cli",
  "workbench:model-provider-verify"
]) {
  assert(sources.main.includes(requiredExistingBoundary), `existing IPC boundary missing: ${requiredExistingBoundary}`);
}
pass("phase27ReusesExistingIpc");
