import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase29-adt-gui-address-resolution-probe";
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase29-adt-gui-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { resolveAdtEndpointCandidates } from "./apps/desktop/src/main/adtEndpointResolver.ts";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sapLogonFixture = \`
[Description]
Item1=Demo DEV配置测试系统
Item2=Demo QAS集成测试系统
[Server]
Item1=sapd01.example.com
Item2=sapq01.example.com
[Database]
Item1=00
Item2=01
[MSSrvName]
Item1=
Item2=
\`;

const landscapeFixture = \`
<Landscape>
  <Services>
    <Service type="SAPGUI" uuid="dev" name="Demo DEV" systemid="S4D" mode="1" server="sapd01.example.com:3200" />
    <Service type="SAPGUI" uuid="qas" name="Demo QAS" systemid="S4Q" mode="1" server="sapq01.example.com:3201" />
  </Services>
</Landscape>
\`;

const fixtureFiles = [
  { kind: "saplogon", content: sapLogonFixture },
  { kind: "landscape", content: landscapeFixture }
];

let candidates = await resolveAdtEndpointCandidates("https://sap.example.com:44302", { files: fixtureFiles });
assert(candidates.length === 1, "explicit ADT URL should produce one candidate");
assert(candidates[0].url === "https://sap.example.com:44302", "explicit URL changed");
assert(candidates[0].source === "explicit-url", "explicit source mismatch");
pass("explicitUrlPreserved");

let insecureHttpRejected = false;
try {
  await resolveAdtEndpointCandidates("http://sap.example.com:8000", { files: fixtureFiles });
} catch (error) {
  insecureHttpRejected = error instanceof Error && error.message.includes("HTTPS");
}
assert(insecureHttpRejected, "explicit HTTP ADT URL must be rejected before credentials can be sent");
pass("explicitHttpRejected");

candidates = await resolveAdtEndpointCandidates("sapd01.example.com", { files: fixtureFiles });
assert(candidates[0].url === "https://sapd01.example.com:44300", "SAP GUI host did not derive HTTPS 44300");
assert(candidates.every((item) => item.url.startsWith("https://")), "SAP GUI host must not add an automatic HTTP credential fallback");
assert(candidates[0].source === "sap-logon-ini" || candidates[0].source === "sap-gui-landscape", "local SAP GUI source missing");
pass("sapGuiHostUsesLocalInstance");

candidates = await resolveAdtEndpointCandidates("Demo QAS", { files: fixtureFiles });
assert(candidates.some((item) => item.url === "https://sapq01.example.com:44301"), "SAP GUI description did not derive instance 01");
assert(candidates.every((item) => item.url.startsWith("https://")), "SAP GUI description must only derive HTTPS candidates");
pass("sapGuiDescriptionMatch");

candidates = await resolveAdtEndpointCandidates("sapdev.example.com:3203", { files: [] });
assert(candidates[0].url === "https://sapdev.example.com:44303", "dispatcher port did not derive HTTPS ADT port");
assert(candidates.length === 1, "dispatcher port must not derive an HTTP credential fallback");
pass("dispatcherPortDerivesAdtPorts");

candidates = await resolveAdtEndpointCandidates("sapdev.example.com", { files: [] });
assert(candidates.length === 0, "host without local match or instance must not silently assume instance 00");
pass("hostWithoutInstanceDoesNotGuess");

candidates = await resolveAdtEndpointCandidates("sapdev.example.com", { files: [], instanceNumber: "02" });
assert(candidates.length === 1, "manual instance should derive one ADT candidate");
assert(candidates[0].url === "https://sapdev.example.com:44302", "manual instance 02 did not derive HTTPS 44302");
assert(candidates[0].source === "host-default", "manual instance source mismatch");
pass("manualInstanceDerivesAdtPort");

let rejected = false;
try {
  await resolveAdtEndpointCandidates("ftp://sap.example.com:21", { files: [] });
} catch {
  rejected = true;
}
assert(rejected, "unsupported protocol was not rejected");
pass("unsupportedProtocolRejected");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase29-probe-entry.ts",
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
