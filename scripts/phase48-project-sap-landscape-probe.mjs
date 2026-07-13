import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase48-"));
const bundlePath = path.join(tempRoot, "probe.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const entrySource = `
import { matchesDiscoveredSapEndpoint, routeSapConnections } from "./apps/desktop/src/shared/sapConnectionRouting.ts";
import { parseSapObjectEvidenceRequest } from "./apps/desktop/src/main/sapObjectEvidenceService.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function connection(id, systemId, client, environment, extra = {}) {
  return {
    id,
    alias: systemId + " " + client,
    systemId,
    instanceNumber: "02",
    environment,
    usage: extra.usage ?? "",
    routingKeywords: extra.routingKeywords ?? [],
    url: "https://" + systemId.toLowerCase() + ".example.com:44302",
    client,
    username: "TEST",
    language: "ZH",
    sslMode: "skip-certificate",
    readOnly: true,
    credential: { kind: "adt-password", store: "electron-safe-storage", state: "set-in-secure-store", updatedAt: null },
    configStatus: "verified",
    connectionStatus: extra.connectionStatus ?? "verified",
    minimalReadStatus: extra.minimalReadStatus ?? "verified",
    lastVerificationMode: extra.lastVerificationMode ?? "adt",
    lastCheckedAt: null
  };
}

const connections = [
  connection("ds4-220", "DS4", "220", "development", { routingKeywords: ["开发", "MM"] }),
  connection("ds4-210", "DS4", "210", "development"),
  connection("qs4-610", "QS4", "610", "quality", { routingKeywords: ["集成测试"] }),
  connection("ps4-800", "PS4", "800", "production"),
  connection("bad", "OLD", "100", "other", { connectionStatus: "failed", minimalReadStatus: "failed", lastVerificationMode: null })
];

const discoveredDs4 = { id: "landscape|ds4.example.com|02|DS4", description: "DS4", systemId: "DS4", host: "ds4.example.com", instanceNumber: "02", source: "sap-gui-landscape" };
assert(matchesDiscoveredSapEndpoint(connections[0], discoveredDs4), "same SAP host/SID/instance was not matched for import enrichment");
assert(!matchesDiscoveredSapEndpoint(connections[0], { ...discoveredDs4, systemId: "QS4" }), "same host with another SID was incorrectly collapsed during import");
assert(!matchesDiscoveredSapEndpoint(connections[0], { ...discoveredDs4, instanceNumber: "03" }), "same host with another instance was incorrectly collapsed during import");

let route = routeSapConnections(connections, "请检查 DS4 Client 220 的 MM 配置", "ps4-800");
assert(route.connectionIds.length === 1 && route.connectionIds[0] === "ds4-220", "SID + Client did not route to exact verified connection");
assert(route.needsConfirmation === false, "exact SID + Client should not require confirmation");

route = routeSapConnections(connections, "请检查当前系统的配置", "ps4-800");
assert(route.connectionIds[0] === "ps4-800" && route.needsConfirmation === true, "ambiguous query must use default only as a confirmed suggestion");

route = routeSapConnections(connections, "请检查 DS4 的配置", "ds4-210");
assert(route.connectionIds[0] === "ds4-210" && route.needsConfirmation === true, "same-system client ambiguity must prefer the active Project connection as a confirmed suggestion");
assert(route.reason.includes("Client 210") && route.reason.includes("Client 220") && route.reason.includes("默认连接建议"), "same-system ambiguity reason must name every tied Client and the suggested default");

route = routeSapConnections(connections, "接口返回 HTTP 220，请检查程序 Z_DEMO", "ps4-800");
assert(route.connectionIds[0] === "ps4-800" && route.needsConfirmation === true, "ordinary numeric text must not be mistaken for a SAP Client");

route = routeSapConnections(connections, "对比测试和生产的配置", "ds4-220");
assert(route.crossSystem === true && route.needsConfirmation === true, "environment-name cross-system comparison must require confirmation");
assert(route.connectionIds.includes("qs4-610") && route.connectionIds.includes("ps4-800"), "environment-name comparison omitted quality or production system");

route = routeSapConnections(connections, "对比 DS4 220 和 QS4 610，做交叉验证", "ds4-220");
assert(route.crossSystem === true && route.needsConfirmation === true, "cross-system intent must require confirmation");
assert(route.connectionIds.includes("ds4-220") && route.connectionIds.includes("qs4-610"), "cross-system route omitted an explicitly named system/client");
assert(!route.connectionIds.includes("bad"), "failed connection must never be routed");

const parsed = parseSapObjectEvidenceRequest({
  objectType: "program",
  objectName: "z_demo",
  connectionMode: "manual",
  connectionIds: ["ds4-220", "qs4-610"],
  queryContext: "交叉验证"
});
assert(parsed.objectName === "Z_DEMO" && parsed.connectionIds.length === 2, "manual SAP evidence request was not parsed");

let invalidManualBlocked = false;
try {
  parseSapObjectEvidenceRequest({ objectType: "program", objectName: "Z_DEMO", connectionMode: "manual", connectionIds: [] });
} catch { invalidManualBlocked = true; }
assert(invalidManualBlocked, "empty manual connection selection was not blocked");

const atomicStore = new WorkspaceStore(${JSON.stringify(path.join(tempRoot, "atomic-repo"))});
const beforeAtomicState = await atomicStore.getState();
const beforeMessageCount = beforeAtomicState.workThreads.find((item) => item.id === beforeAtomicState.activeWorkThreadId)?.messages.length ?? 0;
const duplicateEvidence = {
  objectType: "program",
  objectName: "Z_ATOMIC_TEST",
  functionGroup: null,
  system: { alias: "DS4 220", systemId: "DS4", instanceNumber: "02", environment: "development", endpointHost: "ds4.example.com", client: "220", usernameMasked: "T***T", language: "ZH", sslMode: "strict", readOnly: true, transportWriteMode: "disabled" },
  sourceMode: "adt",
  evidenceKind: "fixed-adt-readonly-source",
  content: "REPORT z_atomic_test. WRITE 'read only'.",
  readAt: "2026-07-13T08:00:00.000Z"
};
let duplicateBatchBlocked = false;
try {
  await atomicStore.appendSapObjectEvidenceBatch([duplicateEvidence, duplicateEvidence]);
} catch (error) {
  duplicateBatchBlocked = error instanceof Error && error.message.includes("重复目标");
}
assert(duplicateBatchBlocked, "duplicate evidence batch did not fail before partial persistence");
const afterAtomicState = await atomicStore.getState();
const afterMessageCount = afterAtomicState.workThreads.find((item) => item.id === afterAtomicState.activeWorkThreadId)?.messages.length ?? 0;
assert(afterMessageCount === beforeMessageCount, "failed evidence batch partially persisted conversation state");
assert(!JSON.stringify(afterAtomicState.activeCaseFiles).includes("sap-object-evidence"), "failed evidence batch left an orphan evidence file");

process.stdout.write("phase48-project-sap-routing-runtime=ok\\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: repoRoot, sourcefile: "phase48-probe.ts", loader: "ts" },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);

  const [app, configCenter, resolver, main, store, styles] = await Promise.all([
    readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/renderer/ConfigCenter.tsx"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/adtEndpointResolver.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/renderer/styles.css"), "utf8")
  ]);

  assert(app.includes('onClick={() => void switchProject(item.id, "config")}'), "SAP Project settings shortcut missing");
  assert(app.includes('details[data-dismiss-on-outside="true"][open]'), "outside-click dismissal for thread menus missing");
  assert(app.includes("SapConnectionPicker") && app.includes("routeSapConnections"), "SAP route picker missing from Work");
  assert(configCenter.includes("从本机 SAP Logon 识别系统") && configCenter.includes("System ID（SID）"), "SAP Logon discovery or SID field missing");
  assert(!configCenter.includes("adtConnections.length} / 6"), "old six-connection UI cap still visible");
  assert(configCenter.includes('sslMode: "skip-certificate"'), "new SAP connection does not default to skip-certificate");
  assert(configCenter.includes("导入基础信息") && configCenter.includes("需补填再验证"), "legacy SAP Logon import does not explain missing SID completion");
  assert(resolver.includes("if (options.instanceNumber)") && resolver.includes("return [];"), "endpoint resolver does not require an explicit or discovered instance");
  assert(!resolver.includes('return uniqueCandidates(candidatesFromHostInput(trimmed, "host-default"))'), "resolver still silently guesses instance 00");
  for (const marker of ["MAX_SAP_GUI_CONFIG_FILE_BYTES", "MAX_SAP_GUI_DISCOVERY_ENTRIES", "SAP_GUI_DISCOVERY_TIMEOUT_MS", "localSapGuiReadInFlight", "controller.abort()"]) {
    assert(resolver.includes(marker), "SAP Logon discovery resource boundary is missing: " + marker);
  }
  assert(main.includes('ipcMain.handle("workbench:sap-gui-discover"') && main.includes("route.needsConfirmation"), "main-process discovery or route confirmation boundary missing");
  assert(main.includes("确认跳过 SAP 证书校验") && main.includes("ADT 地址端口对应实例"), "TLS skip consent or explicit-port identity conflict check missing");
  for (const marker of ["activeSapEvidenceRuns", "SAP_EVIDENCE_TOTAL_TIMEOUT_MS", "controller.abort()", "signal: controller.signal"]) {
    assert(main.includes(marker), "SAP evidence duplicate-run or total-time boundary is missing: " + marker);
  }
  assert(store.includes("appendSapObjectEvidenceBatch") && store.includes("single-object-cross-system-readonly"), "atomic cross-system evidence persistence missing");
  for (const marker of ["TextBatchTransactionJournal", "recoverInterruptedTextBatchTransactions", 'journal.status = "committed"', "rollbackPreparingTransaction"]) {
    assert(store.includes(marker), "crash-recoverable evidence transaction marker is missing: " + marker);
  }
  assert(styles.includes(".sap-connection-picker-panel") && styles.includes(".adt-system-group") && styles.includes(".project-hide-button"), "SAP connection or compact Project settings UI styles missing");
  process.stdout.write("phase48-project-sap-landscape-static=ok\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
