import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase31-adt-compatible-verification-probe";
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase31-adt-compatible-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RealAdtReadonlyConnector } from "./apps/desktop/src/main/adtReadonlyConnector.ts";

const repoRoot = ${JSON.stringify(repoRoot)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const records = [];
const server = createServer((request, response) => {
  records.push({
    method: request.method,
    url: request.url,
    client: request.headers["x-sap-client"] ?? "",
    authorization: request.headers.authorization ?? ""
  });

  if (request.url === "/sap/bc/adt/") {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("service document is not exposed here");
    return;
  }

  if (request.url === "/sap/bc/adt/ddic/tables/T000/source/main") {
    if (request.headers["x-sap-client"] === "401") {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("unauthorized");
      return;
    }
    response.writeHead(200, { "content-type": "application/xml" });
    response.end("<ddic name=\\"T000\\"><field name=\\"MANDT\\" /></ddic>");
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = "http://127.0.0.1:" + address.port;
const connector = new RealAdtReadonlyConnector();

try {
  const okReport = await connector.verify({
    alias: "Mock ADT",
    url: baseUrl,
    client: "100",
    username: "DEMO_USER",
    password: "probe-password",
    language: "EN",
    sslMode: "strict",
    readOnly: true
  });
  assert(okReport.ok === true, "T000-compatible ADT verification should pass even when /sap/bc/adt/ fails");
  assert(okReport.connectionStatus === "verified", "connection should be verified from decisive T000 read");
  assert(okReport.minimalReadStatus === "verified", "minimal read should be verified");
  assert(okReport.errors.length === 0, "root service document failure should not be surfaced as an error when T000 passes");
  assert(okReport.steps.some((item) => item.id === "status" && item.status === "passed" && item.detail.includes("T000 元数据读取已通过")), "status step should explain T000 compatibility fallback in Chinese");
  pass("rootFailureT000SuccessAccepted");

  const failReport = await connector.verify({
    alias: "Mock ADT",
    url: baseUrl,
    client: "401",
    username: "DEMO_USER",
    password: "probe-password",
    language: "EN",
    sslMode: "strict",
    readOnly: true
  });
  assert(failReport.ok === false, "verification should fail when both service document and T000 fail");
  assert(failReport.connectionStatus === "failed", "connection should fail when no decisive ADT read passes");
  assert(failReport.minimalReadStatus === "failed", "minimal read should fail on HTTP 401");
  assert(failReport.errors.some((item) => item.code === "minimal-read-failed" && item.suggestion.includes("HTTP 401")), "minimal read error should retain sanitized HTTP detail");
  pass("failedT000KeepsHttpDetail");

  assert(records.every((record) => record.method === "GET"), "verification sent a non-GET request");
  assert(records.every((record) => record.authorization.startsWith("Basic ")), "basic auth header missing from probe requests");
  pass("compatibleVerificationUsesGetOnly");

  const mainSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8");
  assert(mainSource.includes("verifyAdtCandidate"), "main ADT verification should use candidate-level retry helper");
  assert(!mainSource.includes('adtInputWithoutPassword(config, candidate.url, "skip-certificate")'), "main ADT verification must not silently retry with skip-certificate");
  assert(mainSource.includes("return connector.verify({ ...adtInputWithoutPassword(config, candidate.url), password });"), "main ADT verification should honor only the user-saved SSL mode");
  pass("strictCertificateAutoRetryMarker");

  const storeSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/workspaceStore.ts"), "utf8");
  assert(storeSource.includes('report.ok && report.system.sslMode === "skip-certificate"'), "successful skip-certificate verification should persist SSL mode");
  pass("skipCertificateModePersistsAfterSuccess");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase31-probe-entry.ts",
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
