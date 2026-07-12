import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase40-configuration-integrity-probe";
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase40-config-integrity-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

async function source(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const configCenterSource = await source("apps/desktop/src/renderer/ConfigCenter.tsx");
const adtConnectorSource = await source("apps/desktop/src/main/adtReadonlyConnector.ts");
const selfSource = await source("scripts/phase40-configuration-integrity-probe.mjs");

for (const marker of [
  "mergeProjectConfigSection",
  "reconcileProjectConfigDraft",
  "pendingSectionSave.submittedConfig",
  "!sectionChanged(pendingSectionSave.submittedConfig, current, pendingSectionSave.section)",
  'saveCurrentSection("adt")',
  'saveCurrentSection("models")',
  'saveCurrentSection("feishu")',
  'saveCurrentSection("codex")',
  "hasUnsavedAdtConfig",
  "hasUnsavedModelConfig",
  "hasUnsavedFeishuConfig",
  "hasUnsavedCodexConfig",
  "保存 SAP 配置",
  "保存模型配置",
  "保存 Feishu 配置",
  "本机 AI 增强能力",
  "保存设置",
  "config-tabs"
]) {
  assert(configCenterSource.includes(marker), `missing section-save marker: ${marker}`);
}
assert(!configCenterSource.includes("onSave(project.id, draft)"), "full-page draft is still submitted directly");
pass("sectionSaveStaticBoundary");

const saveAdtBlock = configCenterSource.slice(
  configCenterSource.indexOf("async function saveAdtSettings"),
  configCenterSource.indexOf("async function verifyAdt")
);
assert(saveAdtBlock.includes('const configSaved = await saveCurrentSection("adt")'), "SAP config must save before its password");
assert(saveAdtBlock.includes("if (!configSaved) return"), "SAP password save must stop when section config save fails");
assert(saveAdtBlock.includes("setAdtSecretDirty(false)"), "saved SAP password must be marked clean");
assert(saveAdtBlock.includes('setAdtEntry("")'), "saved SAP password input must be cleared");
assert(saveAdtBlock.includes("setShowAdtSecret(false)"), "saved SAP password input must be hidden");

const saveModelBlock = configCenterSource.slice(
  configCenterSource.indexOf("async function saveModelSettings"),
  configCenterSource.indexOf("async function saveFeishuSettings")
);
assert(saveModelBlock.includes('const configSaved = await saveCurrentSection("models")'), "model config must save before its API key");
assert(saveModelBlock.includes("if (!configSaved) return"), "API key save must stop when model section save fails");
assert(saveModelBlock.includes("setApiSecretDirtyByProvider"), "saved API key must be marked clean");
assert(saveModelBlock.includes('if (input) input.value = ""'), "saved API key input must be cleared");
assert(saveModelBlock.includes("setShowApiSecrets"), "saved API key input must be hidden");
pass("sectionSecretSaveOrdering");

for (const marker of [
  "检查 CLI 状态",
  "检查登录，必要时发起授权",
  "现有连接器会发起用户授权并可能打开浏览器",
  "入口发现不等于能力验证",
  "只验证这一条最小只读路径",
  "未验证视觉、工具、联网等扩展能力",
  "visibleAdtConfig",
  "visibleModelProvider",
  "visibleFeishuConfig",
  "visibleCodexConfig",
  "已修改，待保存"
]) {
  assert(configCenterSource.includes(marker), `missing truthful verification copy: ${marker}`);
}
assert(!configCenterSource.includes("不启动新的授权流程"), "Feishu status copy still claims authorization cannot start");
pass("truthfulVerificationCopy");

for (const marker of [
  "normalizedContentType",
  "looksLikeHtmlOrLoginPage",
  "validateAdtResponse",
  'contentType === "text/html"',
  "T000 路径没有返回可识别的 T000 ADT/DDIC 内容",
  "HTTP 401",
  "HTTP 403",
  "HTTP 404",
  "statusCode >= 500"
]) {
  assert(adtConnectorSource.includes(marker), `missing ADT integrity marker: ${marker}`);
}
for (const forbidden of [
  'method: "POST"',
  'method: "PUT"',
  'method: "PATCH"',
  'method: "DELETE"',
  "x-csrf-token",
  "createTransport",
  "releaseTransport"
]) {
  assert(!adtConnectorSource.includes(forbidden), `forbidden SAP write marker found: ${forbidden}`);
}
assert(selfSource.includes(PROBE_MARKER), "probe self marker missing");
pass("adtStaticIntegrityBoundary");

const entrySource = `
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mergeProjectConfigSection, reconcileProjectConfigDraft } from "./apps/desktop/src/renderer/ConfigCenter.tsx";
import { RealAdtReadonlyConnector } from "./apps/desktop/src/main/adtReadonlyConnector.ts";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function fixture(label) {
  return {
    schemaVersion: 2,
    projectId: "project-1",
    updatedAt: label + "-updated",
    adt: { marker: label + "-adt" },
    feishu: { marker: label + "-feishu" },
    apiProviders: [{ id: "provider-1", marker: label + "-models" }],
    codex: { marker: label + "-codex" },
    localStorage: { marker: label + "-storage" }
  };
}

const saved = fixture("saved");
const draft = fixture("draft");

const adtPayload = mergeProjectConfigSection(saved, draft, "adt");
assert.deepEqual(adtPayload.adt, draft.adt);
assert.deepEqual(adtPayload.apiProviders, saved.apiProviders);
assert.deepEqual(adtPayload.feishu, saved.feishu);
assert.deepEqual(adtPayload.codex, saved.codex);
assert.deepEqual(adtPayload.localStorage, saved.localStorage);
assert.equal(adtPayload.updatedAt, saved.updatedAt);

const modelPayload = mergeProjectConfigSection(saved, draft, "models");
assert.deepEqual(modelPayload.apiProviders, draft.apiProviders);
assert.deepEqual(modelPayload.adt, saved.adt);
assert.deepEqual(modelPayload.feishu, saved.feishu);
assert.deepEqual(modelPayload.codex, saved.codex);

const feishuPayload = mergeProjectConfigSection(saved, draft, "feishu");
assert.deepEqual(feishuPayload.feishu, draft.feishu);
assert.deepEqual(feishuPayload.adt, saved.adt);
assert.deepEqual(feishuPayload.apiProviders, saved.apiProviders);
assert.deepEqual(feishuPayload.codex, saved.codex);

const codexPayload = mergeProjectConfigSection(saved, draft, "codex");
assert.deepEqual(codexPayload.codex, draft.codex);
assert.deepEqual(codexPayload.adt, saved.adt);
assert.deepEqual(codexPayload.apiProviders, saved.apiProviders);
assert.deepEqual(codexPayload.feishu, saved.feishu);
pass("sectionSaveRuntimeIsolation");

const currentDraft = fixture("saved");
currentDraft.adt = { marker: "just-saved-adt" };
currentDraft.apiProviders = [{ id: "provider-1", marker: "unsaved-models" }];
currentDraft.feishu = { marker: "unsaved-feishu" };
const incoming = fixture("incoming");
const reconciled = reconcileProjectConfigDraft(saved, incoming, currentDraft, "adt");
assert.deepEqual(reconciled.adt, incoming.adt);
assert.deepEqual(reconciled.apiProviders, currentDraft.apiProviders);
assert.deepEqual(reconciled.feishu, currentDraft.feishu);
assert.deepEqual(reconciled.codex, incoming.codex);
assert.deepEqual(reconciled.localStorage, incoming.localStorage);
pass("unsavedOtherSectionsSurviveRefresh");

const editedDuringSave = reconcileProjectConfigDraft(saved, incoming, currentDraft, null);
assert.deepEqual(editedDuringSave.adt, currentDraft.adt);
assert.deepEqual(editedDuringSave.apiProviders, currentDraft.apiProviders);
assert.deepEqual(editedDuringSave.feishu, currentDraft.feishu);
pass("editsMadeDuringSaveSurviveRefresh");

const records = [];
const server = createServer((request, response) => {
  records.push({ method: request.method, url: request.url, client: request.headers["x-sap-client"] ?? "" });
  if (request.url === "/sap/bc/adt/") {
    response.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
    response.end("<adt>ok</adt>");
    return;
  }
  if (request.url !== "/sap/bc/adt/ddic/tables/T000/source/main") {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }

  const client = String(request.headers["x-sap-client"] ?? "");
  if (client === "100") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><form><input name='sap-user'>SAP login</form></body></html>");
    return;
  }
  if (client === "101") {
    response.writeHead(200, { "content-type": "application/xml" });
    response.end("<html><body><form><input name='sap-password'>Logon</form></body></html>");
    return;
  }
  if (client === "102") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"name":"T000"}');
    return;
  }
  if (client === "103") {
    response.writeHead(200, { "content-type": "application/vnd.sap.adt.ddic.table.v2+xml" });
    response.end("<ddic name='T000'><field name='MANDT'/></ddic>");
    return;
  }
  if (client === "104") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("@AbapCatalog.enhancementCategory: #NOT_EXTENSIBLE\\ndefine table t000 { key mandt : mandt not null; }");
    return;
  }
  const status = Number(client);
  response.writeHead(status, { "content-type": "text/plain" });
  response.end("sanitized probe failure body must never be returned");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = "http://127.0.0.1:" + address.port;
const connector = new RealAdtReadonlyConnector();

function input(client) {
  return {
    alias: "Phase 40 mock ADT",
    url: baseUrl,
    client,
    username: "PROBE_USER",
    password: "probe-password",
    language: "ZH",
    sslMode: "strict",
    readOnly: true
  };
}

try {
  for (const client of ["100", "101"]) {
    const report = await connector.verify(input(client));
    assert.equal(report.ok, false, "HTML 2xx must not pass T000 verification");
    assert.equal(report.minimalReadStatus, "failed");
    assert(report.steps.some((step) => step.id === "t000" && step.status === "failed" && /HTML|登录页面/.test(step.detail)));
    assert(!JSON.stringify(report).includes("sap-password"));
    assert(!JSON.stringify(report).includes("probe-password"));
  }
  pass("html2xxRejected");

  const wrongType = await connector.verify(input("102"));
  assert.equal(wrongType.ok, false);
  assert(wrongType.steps.some((step) => step.id === "t000" && step.detail.includes("不支持的内容类型")));
  pass("wrongContentTypeRejected");

  for (const client of ["103", "104"]) {
    const report = await connector.verify(input(client));
    assert.equal(report.ok, true, "reasonable ADT XML/plain T000 response should pass");
    assert.equal(report.minimalReadStatus, "verified");
  }
  pass("reasonableT000ContentAccepted");

  const categorized = [
    ["401", /认证未通过/, /HTTP 401/],
    ["403", /权限不足|无权读取/, /HTTP 403/],
    ["404", /服务路径不可用/, /HTTP 404/],
    ["503", /服务暂时不可用/, /HTTP 503/]
  ];
  for (const [client, messagePattern, suggestionPattern] of categorized) {
    const report = await connector.verify(input(client));
    assert.equal(report.ok, false);
    const minimalError = report.errors.find((item) => item.code === "minimal-read-failed");
    assert(minimalError, "missing categorized minimal-read error for " + client);
    assert(messagePattern.test(minimalError.message), "wrong error message category for " + client + ": " + minimalError.message);
    assert(suggestionPattern.test(minimalError.suggestion), "wrong error suggestion category for " + client + ": " + minimalError.suggestion);
    assert(!JSON.stringify(report).includes("sanitized probe failure body"));
  }
  pass("safeHttpErrorCategories");

  assert(records.every((record) => record.method === "GET"), "ADT integrity probe observed a non-GET request");
  pass("adtIntegrityUsesGetOnly");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase40-configuration-integrity-entry.ts",
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
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
