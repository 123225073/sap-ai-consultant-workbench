import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase41-multi-sap-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

const entrySource = `
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
import { secretTargetIdFor } from "./apps/desktop/src/main/secretTargetIdentity.ts";
import { SecureSecretStore } from "./apps/desktop/src/main/secureSecretStore.ts";

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
function assert(condition, message) { if (!condition) throw new Error(message); }
function pass(name) { process.stdout.write(name + "=ok\\n"); }

let state = await store.createLocalProject({ name: "多 SAP 项目", sapVersion: "S4", systemLabel: "DEV/QAS" });
let project = state.projects.find((item) => item.id === state.activeProjectId);
assert(project.config.adtConnections.length === 1, "new projects must start with one SAP connection");
assert(project.config.activeAdtConnectionId === project.config.adt.id, "active SAP connection must match legacy active view");

const first = { ...project.config.adt, alias: "DEV", url: "https://dev.example.com:44300", client: "100" };
const second = {
  ...project.config.adt,
  id: "adt-qas",
  alias: "QAS",
  url: "https://qas.example.com:44301",
  client: "200",
  username: "QAS_USER",
  credential: { ...project.config.adt.credential, secretRef: null, state: "not-set", updatedAt: null }
};
const draft = {
  ...project.config,
  adt: second,
  adtConnections: [first, second],
  activeAdtConnectionId: second.id
};
state = await store.saveProjectConfig(project.id, draft);
project = state.projects.find((item) => item.id === state.activeProjectId);
assert(project.config.adtConnections.length === 2, "multiple SAP connections were not persisted");
assert(project.config.adt.id === "adt-qas" && project.config.adt.alias === "QAS", "selected SAP connection was not activated");

const devTarget = await store.prepareProjectSecret(project.id, { kind: "adt-password", connectionId: first.id });
const qasTarget = await store.prepareProjectSecret(project.id, { kind: "adt-password", connectionId: second.id });
assert(devTarget.target.connectionId === first.id && qasTarget.target.connectionId === second.id, "SAP password targets are not isolated by connection");

const longPrefix = "adt-" + "x".repeat(100);
const collisionDraft = JSON.parse(JSON.stringify(project.config));
collisionDraft.adtConnections = [
  { ...collisionDraft.adtConnections[0], id: longPrefix + "-one", alias: "LONG-A" },
  { ...collisionDraft.adtConnections[1], id: longPrefix + "-two", alias: "LONG-B" }
];
collisionDraft.adt = collisionDraft.adtConnections[1];
collisionDraft.activeAdtConnectionId = collisionDraft.adt.id;
state = await store.saveProjectConfig(project.id, collisionDraft);
project = state.projects.find((item) => item.id === state.activeProjectId);
const normalizedIds = project.config.adtConnections.map((item) => item.id);
assert(new Set(normalizedIds).size === 2, "long SAP connection IDs must stay unique after secure-target normalization");
assert(normalizedIds.every((id) => id.length <= 80), "SAP connection IDs must fit secure secret target segments");
const secureTargetIds = normalizedIds.map((connectionId) => secretTargetIdFor({ kind: "adt-password", connectionId }));
assert(new Set(secureTargetIds).size === 2, "long SAP connection IDs must remain distinct in the final secure-store target");
const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, "utf8"),
  decryptString: (value) => value.toString("utf8")
};
const secureStore = new SecureSecretStore(${JSON.stringify(isolatedRepoRoot)}, fakeStorage);
await secureStore.save(project.id, { kind: "adt-password", connectionId: "adt" }, "legacy-value", null);
assert(await secureStore.resolveProjectSecret(project.id, { kind: "adt-password", connectionId: "adt-default" }) === "legacy-value", "legacy single-SAP password target was not migrated for adt-default");
await secureStore.save(project.id, { kind: "adt-password", connectionId: normalizedIds[0] }, "value-a", null);
await secureStore.save(project.id, { kind: "adt-password", connectionId: normalizedIds[1] }, "value-b", null);
assert(await secureStore.resolveProjectSecret(project.id, { kind: "adt-password", connectionId: normalizedIds[0] }) === "value-a", "first long SAP target resolved the wrong encrypted value");
assert(await secureStore.resolveProjectSecret(project.id, { kind: "adt-password", connectionId: normalizedIds[1] }) === "value-b", "second long SAP target resolved the wrong encrypted value");
await secureStore.removeProjectTarget(project.id, { kind: "adt-password", connectionId: normalizedIds[0] });
let removedTargetMissing = false;
try {
  await secureStore.resolveProjectSecret(project.id, { kind: "adt-password", connectionId: normalizedIds[0] });
} catch {
  removedTargetMissing = true;
}
assert(removedTargetMissing, "removed SAP target still retained its encrypted value");
assert(await secureStore.resolveProjectSecret(project.id, { kind: "adt-password", connectionId: normalizedIds[1] }) === "value-b", "removing one SAP target deleted another target");

const firstNormalizedId = normalizedIds[0];
const secondNormalizedId = normalizedIds[1];
const checkedAt = "2026-07-11T12:00:00.000Z";
const firstBeforeVerification = project.config.adtConnections.find((item) => item.id === firstNormalizedId);
const adtVerificationSequence = store.beginAdtVerification(project.id, firstNormalizedId);
state = await store.updateAdtVerification(project.id, firstNormalizedId, adtVerificationSequence, firstBeforeVerification, {
  ok: true,
  checkedAt,
  mode: "adt",
  system: {
    alias: "LONG-A",
    endpointHost: "https://dev.example.com:44300",
    client: "100",
    usernameMasked: "D***R",
    language: "ZH",
    sslMode: "strict",
    readOnly: true,
    transportWriteMode: "disabled"
  },
  steps: [{ id: "config", title: "配置检查", status: "passed", detail: "通过", checkedAt }],
  connectionStatus: "verified",
  minimalReadStatus: "verified",
  t000: { objectName: "T000", attempted: true, ok: true, rowCount: 1, sampleClient: "100", source: "adt" },
  errors: []
});
project = state.projects.find((item) => item.id === state.activeProjectId);
const verifiedFirst = project.config.adtConnections.find((item) => item.id === firstNormalizedId);
const stillActiveSecond = project.config.adtConnections.find((item) => item.id === secondNormalizedId);
assert(verifiedFirst.connectionStatus === "verified" && verifiedFirst.lastCheckedAt === checkedAt, "verification result must update the connection that started the check");
assert(project.config.adt.id === secondNormalizedId && project.config.adt.connectionStatus === stillActiveSecond.connectionStatus, "late verification must not overwrite the newly active SAP connection");

const sameConnectionSnapshot = JSON.parse(JSON.stringify(verifiedFirst));
const olderAdtSequence = store.beginAdtVerification(project.id, firstNormalizedId);
const newerAdtSequence = store.beginAdtVerification(project.id, firstNormalizedId);
const newerCheckedAt = "2026-07-11T12:00:30.000Z";
const newerAdtReport = {
  ok: true,
  checkedAt: newerCheckedAt,
  mode: "adt",
  system: { alias: "LONG-A", endpointHost: "https://dev.example.com:44300", client: "100", usernameMasked: "D***R", language: "ZH", sslMode: "strict", readOnly: true, transportWriteMode: "disabled" },
  steps: [{ id: "config", title: "配置检查", status: "passed", detail: "通过", checkedAt: newerCheckedAt }],
  connectionStatus: "verified",
  minimalReadStatus: "verified",
  t000: { objectName: "T000", attempted: true, ok: true, rowCount: 1, sampleClient: "100", source: "adt" },
  errors: []
};
state = await store.updateAdtVerification(project.id, firstNormalizedId, newerAdtSequence, sameConnectionSnapshot, newerAdtReport);
let olderAdtResultBlocked = false;
try {
  await store.updateAdtVerification(project.id, firstNormalizedId, olderAdtSequence, sameConnectionSnapshot, { ...newerAdtReport, ok: false, checkedAt: "2026-07-11T12:00:20.000Z", connectionStatus: "failed", minimalReadStatus: "failed" });
} catch (error) {
  olderAdtResultBlocked = error instanceof Error && error.message.includes("较早结果未保存");
}
assert(olderAdtResultBlocked, "an older same-config SAP verification must not overwrite the newer result");
project = state.projects.find((item) => item.id === state.activeProjectId);
assert(project.config.adtConnections.find((item) => item.id === firstNormalizedId).lastCheckedAt === newerCheckedAt, "newer same-config SAP verification did not remain authoritative");

const staleConnection = { ...project.config.adtConnections.find((item) => item.id === firstNormalizedId) };
const staleAdtSequence = store.beginAdtVerification(project.id, firstNormalizedId);
const editedDraft = JSON.parse(JSON.stringify(project.config));
editedDraft.adtConnections = editedDraft.adtConnections.map((item) => item.id === firstNormalizedId ? { ...item, url: "https://changed.example.com:44300" } : item);
state = await store.saveProjectConfig(project.id, editedDraft);
let staleResultBlocked = false;
try {
  await store.updateAdtVerification(project.id, firstNormalizedId, staleAdtSequence, staleConnection, {
    ok: true,
    checkedAt: "2026-07-11T12:01:00.000Z",
    mode: "adt",
    system: { alias: "LONG-A", endpointHost: "https://dev.example.com:44300", client: "100", usernameMasked: "D***R", language: "ZH", sslMode: "strict", readOnly: true, transportWriteMode: "disabled" },
    steps: [{ id: "config", title: "配置检查", status: "passed", detail: "通过", checkedAt: "2026-07-11T12:01:00.000Z" }],
    connectionStatus: "verified",
    minimalReadStatus: "verified",
    t000: { objectName: "T000", attempted: true, ok: true, rowCount: 1, sampleClient: "100", source: "adt" },
    errors: []
  });
} catch (error) {
  staleResultBlocked = error instanceof Error && error.message.includes("验证期间已发生变化");
}
assert(staleResultBlocked, "a late result for an edited SAP connection must be rejected");

project = state.projects.find((item) => item.id === state.activeProjectId);
const existingWithSecret = project.config.adtConnections[0];
state = await store.attachProjectSecret(project.id, { kind: "adt-password", connectionId: existingWithSecret.id }, {
  secretRef: ["secure-store:", "sec_", "1".repeat(32)].join(""),
  kind: "adt-password",
  store: "electron-safe-storage",
  state: "set-in-secure-store",
  updatedAt: "2026-07-11T12:02:00.000Z"
});
project = state.projects.find((item) => item.id === state.activeProjectId);
const inserted = { ...project.config.adtConnections[0], id: "adt-inserted-first", alias: "INSERTED", credential: { secretRef: null, kind: "adt-password", store: "electron-safe-storage", state: "not-set", updatedAt: null } };
const insertDraft = JSON.parse(JSON.stringify(project.config));
insertDraft.adtConnections = [inserted, ...insertDraft.adtConnections];
insertDraft.adt = inserted;
insertDraft.activeAdtConnectionId = inserted.id;
state = await store.saveProjectConfig(project.id, insertDraft);
project = state.projects.find((item) => item.id === state.activeProjectId);
assert(project.config.adtConnections[0].credential.secretRef === null, "a newly inserted first SAP connection must not inherit another connection's credential");
const retainedExisting = project.config.adtConnections.find((item) => item.id === existingWithSecret.id);
assert(retainedExisting?.credential.state === "set-in-secure-store", "existing SAP connection credential status must remain attached to its own ID: " + JSON.stringify(project.config.adtConnections.map((item) => ({ id: item.id, state: item.credential.state }))));
pass("multipleSapConnectionsPersistedAndIsolated");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: repoRoot, sourcefile: "phase41-multi-sap-entry.ts", loader: "ts" },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "electron-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "electron-stub" }));
        buildApi.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({
          contents: "export const safeStorage = {};",
          loader: "js"
        }));
      }
    }],
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
  process.stdout.write("phase41-multi-sap-connections-probe=ok\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
