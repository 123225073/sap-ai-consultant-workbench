import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase13-real-adt-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ADT_READONLY_FIXED_GET_ENDPOINTS,
  RealAdtReadonlyConnector,
  adtReadonlyObjectEvidencePath,
  createAdtReadonlyConnector
} from "./apps/desktop/src/main/adtReadonlyConnector.ts";
import {
  assertSafeSapObjectEvidenceText,
  normalizeSapObjectEvidenceResult,
  parseSapObjectEvidenceRequest
} from "./apps/desktop/src/main/sapObjectEvidenceService.ts";

const repoRoot = ${JSON.stringify(repoRoot)};

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

const functionRequest = parseSapObjectEvidenceRequest({
  objectType: "function",
  objectName: "ZFM_TEST",
  functionGroup: "ZFG_TEST"
});
assert(ADT_READONLY_FIXED_GET_ENDPOINTS === "adt-readonly-fixed-get-endpoints", "fixed endpoint marker missing");
assert(adtReadonlyObjectEvidencePath({ objectType: "program", objectName: "ZREP_TEST" }) === "/sap/bc/adt/programs/programs/ZREP_TEST/source/main", "program endpoint mismatch");
assert(adtReadonlyObjectEvidencePath({ objectType: "class", objectName: "/UI2/CL_JSON" }) === "/sap/bc/adt/oo/classes/%2FUI2%2FCL_JSON/source/main", "class endpoint mismatch");
assert(adtReadonlyObjectEvidencePath({ objectType: "interface", objectName: "ZIF_TEST" }) === "/sap/bc/adt/oo/interfaces/ZIF_TEST/source/main", "interface endpoint mismatch");
assert(adtReadonlyObjectEvidencePath({ objectType: "cds", objectName: "ZI_TEST" }) === "/sap/bc/adt/ddic/ddl/sources/ZI_TEST/source/main", "CDS endpoint mismatch");
assert(adtReadonlyObjectEvidencePath(functionRequest) === "/sap/bc/adt/functions/groups/ZFG_TEST/fmodules/ZFM_TEST/source/main", "function endpoint mismatch");
pass("fixedEndpointMapping");

assertThrows("functionGroupRequired", () => adtReadonlyObjectEvidencePath({ objectType: "function", objectName: "ZFM_TEST" }));

const records = [];
const server = createServer((request, response) => {
  records.push({
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization ?? "",
    cookie: request.headers.cookie ?? "",
    csrf: request.headers["x-csrf-token"] ?? ""
  });

  if (request.url === "/sap/bc/adt/") {
    response.writeHead(200, { "content-type": "application/xml" });
    response.end("<adt>ok</adt>");
    return;
  }

  if (request.url === "/sap/bc/adt/ddic/tables/T000/source/main") {
    response.writeHead(200, { "content-type": "application/xml" });
    response.end("<ddic name=\\"T000\\"><field name=\\"MANDT\\" /></ddic>");
    return;
  }

  if (request.url === "/sap/bc/adt/programs/programs/ZREP_TEST/source/main") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end([
      "REPORT zrep_test.",
      "SELECT carrid FROM scarr INTO TABLE @DATA(lt_scarr).",
      "CALL FUNCTION 'DATE_CHECK_PLAUSIBILITY'.",
      "WRITE: / lines( lt_scarr )."
    ].join("\\n"));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = "http://127.0.0.1:" + address.port;
const input = {
  alias: "Mock ADT",
  url: baseUrl,
  client: "100",
  username: "DEMO_USER",
  password: "probe-password",
  language: "EN",
  sslMode: "strict",
  readOnly: true
};

try {
  const connector = new RealAdtReadonlyConnector();
  assert(createAdtReadonlyConnector() instanceof RealAdtReadonlyConnector, "default connector is not real ADT");
  const report = await connector.verify(input);
  assert(report.ok === true, "real ADT verify did not pass");
  assert(report.mode === "adt", "real ADT verify mode mismatch");
  assert(report.connectionStatus === "verified", "connection not verified");
  assert(report.minimalReadStatus === "verified", "minimal read not verified");
  assert(report.t000.source === "adt", "T000 source not real ADT");
  pass("realVerifyUsesFixedGetOnly");

  const evidence = await connector.readObjectEvidence(input, {
    objectType: "program",
    objectName: "ZREP_TEST"
  });
  assert(evidence.sourceMode === "adt", "evidence source mode not ADT");
  assert(evidence.evidenceKind === "fixed-adt-readonly-source", "fixed evidence kind missing");
  assert(evidence.content.includes("SELECT carrid"), "mock ABAP source missing");
  assert(!JSON.stringify(evidence).includes("probe-password"), "password leaked into evidence result");
  assert(!JSON.stringify(evidence).toLowerCase().includes("authorization"), "auth marker leaked into evidence result");
  pass("basicAuthNotReturned");

  const methods = records.map((record) => record.method);
  assert(methods.length === 3, "unexpected request count: " + methods.length);
  assert(methods.every((method) => method === "GET"), "non-GET request sent: " + methods.join(","));
  assert(records.every((record) => !record.cookie && !record.csrf), "cookie or csrf header was sent");
  assert(records.every((record) => record.authorization.startsWith("Basic ")), "basic auth header missing in request");
  assert(records.some((record) => record.url === "/sap/bc/adt/"), "status path not called");
  assert(records.some((record) => record.url === "/sap/bc/adt/ddic/tables/T000/source/main"), "T000 path not called");
  assert(records.some((record) => record.url === "/sap/bc/adt/programs/programs/ZREP_TEST/source/main"), "program path not called");
  pass("realConnectorUsesGetOnly");

  const record = normalizeSapObjectEvidenceResult(evidence);
  assert(record.content.includes("CALL FUNCTION"), "read-only source text was not preserved");
  assert(record.summary.sourceMode === "adt", "summary source mode not ADT");
  pass("readOnlySourceAccepted");

  assertThrows("genericUnsafeEvidenceStillBlocked", () => assertSafeSapObjectEvidenceText("SELECT * FROM T000"));
  assertThrows("sourceAuthStillBlocked", () => normalizeSapObjectEvidenceResult({
    ...evidence,
    content: "Authorization: Bearer abcdefghijklmnop"
  }));

  const source = await readFile(path.join(repoRoot, "apps/desktop/src/main/adtReadonlyConnector.ts"), "utf8");
  for (const forbidden of ["method: \\"POST\\"", "method: \\"PUT\\"", "method: \\"PATCH\\"", "method: \\"DELETE\\"", "x-csrf-token", "activateObject", "createTransport", "releaseTransport", "transportRequest"]) {
    assert(!source.includes(forbidden), "write marker found: " + forbidden);
  }
  pass("noWriteMarkers");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase13-probe-entry.ts",
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
