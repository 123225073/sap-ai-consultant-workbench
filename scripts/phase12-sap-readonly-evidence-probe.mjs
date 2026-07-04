import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase12-evidence-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { FakeAdtReadonlyConnector } from "./apps/desktop/src/main/adtReadonlyConnector.ts";
import {
  SAP_OBJECT_EVIDENCE_ALLOWED_TYPES,
  assertSafeSapObjectEvidenceText,
  normalizeSapObjectEvidenceResult,
  parseSapObjectEvidenceRequest,
  renderSapObjectEvidenceFiles
} from "./apps/desktop/src/main/sapObjectEvidenceService.ts";
import { buildSafeModelDraftContext } from "./apps/desktop/src/main/safeModelCaseDraftService.ts";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

const repoRoot = ${JSON.stringify(repoRoot)};
const isolatedRepoRoot = ${JSON.stringify(isolatedRepoRoot)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(name, fn) {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  assert(thrown, name + " did not throw");
  pass(name);
}

const validRequest = parseSapObjectEvidenceRequest({
  objectType: "class",
  objectName: "/UI2/CL_JSON"
});
assert(SAP_OBJECT_EVIDENCE_ALLOWED_TYPES.includes("class"), "allowed type marker missing");
assert(validRequest.objectType === "class", "valid type not preserved");
assert(validRequest.objectName === "/UI2/CL_JSON", "valid object name not normalized");
pass("validObjectRequest");

assertThrows("invalidObjectTypeBlocked", () => parseSapObjectEvidenceRequest({ objectType: "package", objectName: "ZPKG" }));
assertThrows("wildcardBlocked", () => parseSapObjectEvidenceRequest({ objectType: "program", objectName: "Z*" }));
assertThrows("sqlObjectNameBlocked", () => parseSapObjectEvidenceRequest({ objectType: "table", objectName: "SELECT * FROM T000" }));
assertThrows("pathTraversalBlocked", () => parseSapObjectEvidenceRequest({ objectType: "include", objectName: "../ZINC" }));
assertThrows("extraRequestFieldBlocked", () => parseSapObjectEvidenceRequest({ objectType: "class", objectName: "ZCL_SAFE", sapUrl: "https://sap.example.com" }));
assertThrows("unsafeEvidenceTextBlocked", () => assertSafeSapObjectEvidenceText("Authorization: Bearer abcdefghijklmnop"));

const connector = new FakeAdtReadonlyConnector();
const adtInput = {
  alias: "Demo SAP",
  url: "https://sap-demo.example.com",
  client: "100",
  username: "DEMO_USER",
  password: "probe-password",
  language: "ZH",
  sslMode: "strict",
  readOnly: true
};
await connector.readObjectEvidence(adtInput, validRequest).then(() => {
  throw new Error("fake evidence ran without flag");
}).catch((error) => {
  if (String(error?.message ?? "").includes("fake evidence ran without flag")) throw error;
});
pass("fakeEvidenceRequiresFlag");

const evidence = await connector.readObjectEvidence(adtInput, validRequest, { allowFakeEvidence: true });
const record = normalizeSapObjectEvidenceResult(evidence);
assert(record.summary.sourceMode === "fake", "fake evidence source mode missing");
assert(record.summary.objectName === "/UI2/CL_JSON", "evidence object name mismatch");
pass("fakeEvidenceRunsWithFlag");

const files = renderSapObjectEvidenceFiles(record);
const allowedPrefixes = ["evidence/", "snapshots/", "outputs/", "technical/"];
assert(files.length >= 3, "evidence render did not create expected files");
assert(files.every((file) => allowedPrefixes.some((prefix) => file.relativePath.startsWith(prefix))), "evidence file outside allowed dirs");
assert(files.some((file) => file.relativePath.startsWith("outputs/")), "safe output summary missing");
assert(files.some((file) => file.relativePath.startsWith("evidence/")), "evidence file missing");
assert(files.some((file) => file.relativePath.startsWith("snapshots/")), "snapshot file missing");
pass("evidenceFilesInAllowedDirs");

const repeatedRecord = normalizeSapObjectEvidenceResult({
  ...evidence,
  readAt: "2099-01-01T00:00:01.000Z",
  content: evidence.content + "\\nRepeat read marker: 2099-01-01T00:00:01.000Z"
});
const repeatedFiles = renderSapObjectEvidenceFiles(repeatedRecord);
assert(files.every((file) => !repeatedFiles.some((repeated) => repeated.relativePath === file.relativePath)), "repeated evidence would overwrite prior files");
pass("repeatEvidenceDoesNotOverwrite");

await mkdir(isolatedRepoRoot, { recursive: true });
const store = new WorkspaceStore(isolatedRepoRoot);
const result = await store.appendSapObjectEvidence(evidence);
assert(result.generatedFiles.every((file) => allowedPrefixes.some((prefix) => file.startsWith(prefix))), "stored evidence file outside allowed dirs");

const metadataPath = path.join(
  isolatedRepoRoot,
  "local-data",
  "workbench",
  "projects",
  result.state.activeProjectId,
  "cases",
  result.state.projects.find((project) => project.id === result.state.activeProjectId).cases.find((caseItem) => caseItem.id === result.state.activeCaseId).folderName,
  "metadata.json"
);
const metadataText = await readFile(metadataPath, "utf8");
assert(!/probe-password|secure-store|Authorization|Cookie|SAP_SESSIONID|MYSAPSSO2|Bearer/i.test(metadataText), "metadata contains raw secret or auth marker");
pass("metadataNoRawSecret");

const searchResults = await store.search("UI2");
assert(searchResults.some((item) => item.sourcePath?.startsWith("outputs/")), "safe output evidence summary was not searchable");
assert(searchResults.some((item) => item.sourcePath?.startsWith("outputs/") && item.title.includes("sap-object-evidence-summary")), "safe output evidence summary was not searchable as a file summary");
const fullEvidenceResults = await store.search("read-only demo evidence");
assert(fullEvidenceResults.every((item) => !item.sourcePath || item.sourcePath.startsWith("outputs/")), "full evidence text entered search results");
assert(!fullEvidenceResults.some((item) => item.sourcePath?.startsWith("evidence/") || item.sourcePath?.startsWith("snapshots/") || item.sourcePath?.startsWith("technical/")), "non-output evidence file entered search results");
pass("safeSummaryIndexedOnly");

const context = buildSafeModelDraftContext({
  taskMode: "problem-analysis",
  taskLabel: "problem analysis",
  userInput: "Use the safe summary only.",
  caseTitle: "Evidence case",
  caseSummary: "One safe evidence summary exists.",
  sapVersion: "S4",
  standardsSummary: "Project standards summary only.",
  knowledgeReferences: [],
  safeOutputSummaries: searchResults.filter((item) => item.sourcePath?.startsWith("outputs/")).map((item) => ({
    displayName: item.title,
    fileType: "md",
    snippet: item.snippet
  }))
});
const serializedContext = JSON.stringify(context);
assert(!serializedContext.includes("evidence/"), "evidence path leaked into model context");
assert(!serializedContext.includes("snapshots/"), "snapshot path leaked into model context");
assert(!serializedContext.includes("BEGIN SAP READ-ONLY EVIDENCE"), "full evidence leaked into model context");
pass("modelContextExcludesEvidence");

const mainSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8");
const preloadSource = await readFile(path.join(repoRoot, "apps/desktop/src/preload/preload.ts"), "utf8");
const ipcSource = mainSource + "\\n" + preloadSource;
assert(ipcSource.includes("workbench:read-sap-object-evidence"), "narrow SAP evidence IPC missing");
for (const forbidden of ["sap-sql", "sap-command", "sap-browser", "runSelect", "execute-sql", "query-sap", "read-any-sap"]) {
  assert(!ipcSource.includes(forbidden), "generic SAP IPC marker found: " + forbidden);
}
pass("noGenericSapIpc");

const adtSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/adtReadonlyConnector.ts"), "utf8");
for (const forbidden of ["activateObject", "createTransport", "releaseTransport", "transportRequest", "method: \\"POST\\"", "method: \\"PUT\\"", "method: \\"PATCH\\"", "method: \\"DELETE\\""]) {
  assert(!adtSource.includes(forbidden), "write marker found: " + forbidden);
}
pass("noWriteMarkers");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase12-probe-entry.ts",
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
