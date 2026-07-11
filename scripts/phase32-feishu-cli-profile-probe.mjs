import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase32-feishu-cli-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverFeishuCli, RealFeishuCliConnector } from "./apps/desktop/src/main/feishuCliConnector.ts";

const repoRoot = ${JSON.stringify(repoRoot)};

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const connectorSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/feishuCliConnector.ts"), "utf8");
const mainSource = await readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8");
assert(connectorSource.includes("profile\\", \\"add"), "profile add command marker is missing");
assert(connectorSource.includes("--app-secret-stdin"), "App Secret must be passed via stdin marker");
assert(connectorSource.includes("--profile"), "verification must pass selected profile explicitly");
assert(!connectorSource.includes("profile\\", \\"use"), "connector must not switch global default profile");
assert(connectorSource.includes("startUserAuthOnFailure"), "auth login must be gated behind explicit verify option");
assert(connectorSource.includes("--device-code"), "auth flow must be able to complete device authorization after browser confirmation");
assert(mainSource.includes("safeFeishuConsentUrl"), "Feishu consent URL must be validated before opening browser");
assert(mainSource.includes("FEISHU_AUTHORIZATION_HOST_SUFFIXES"), "Feishu consent URL host allowlist is missing");
assert(mainSource.includes("openConsentUrl: openFeishuConsentUrl"), "Feishu consent opener must use controlled main-process function");
assert(connectorSource.includes('profile?.name ?? (input.profile.trim() || "未选择")'), "verification report must not display a recommended profile as selected");
assert(connectorSource.includes("cliCommandFamily"), "configured lark-cli/feishu-cli command family guard is missing");
assert(connectorSource.includes("同名飞书 profile 已存在，但无法确认 App ID"), "same-name profile unknown App ID overwrite guard is missing");
pass("safeProfileCommandMarkers");

const sharedTypes = await readFile(path.join(repoRoot, "apps/desktop/src/shared/workbenchTypes.ts"), "utf8");
assert(sharedTypes.includes("FeishuCliProfileSummary"), "profile summary type is missing");
assert(sharedTypes.includes("FeishuCliDiscoveryReport"), "CLI discovery report type is missing");
assert(sharedTypes.includes("FeishuAuthAction"), "auth action type is missing");
pass("multiProfileTypesPresent");

const rendererSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/ConfigCenter.tsx"), "utf8");
assert(rendererSource.includes("选择已有 Profile"), "profile selector UI marker is missing");
assert(rendererSource.includes("请选择公司/个人 Profile"), "profile selector must not imply unsafe auto selection for multiple accounts");
assert(rendererSource.includes("不会执行全局 profile use"), "global-profile boundary copy is missing");
assert(rendererSource.includes("App Secret"), "App Secret secure input marker is missing");
assert(rendererSource.includes("已打开授权页"), "auth action UI marker is missing");
assert(rendererSource.includes("保存配置会保存 App Secret，并在信息完整时自动写入/更新本机 lark-cli Profile"), "save action should explain automatic CLI profile write");
assert(rendererSource.includes("feishuProfileResult"), "CLI profile write result UI marker is missing");
assert(rendererSource.includes("if (report.ok) setFeishuProfileResult(null);"), "successful Feishu verification must clear stale CLI profile write failures");
assert(rendererSource.includes("visibleFeishuProfileResult"), "CLI profile write result must be rendered through a stale-state guard");
assert(rendererSource.includes("!feishuReady && !feishuVerificationOk"), "verified Feishu status must hide stale failed CLI profile write results");
assert(rendererSource.includes("setFeishuSecretDirty(false);\\n          setFeishuSecretEntry(\\\"\\\")"), "saving Feishu App Secret must clear the current input value");
assert(rendererSource.includes("setShowFeishuSecret(false);"), "saving Feishu App Secret must hide the cleared field");
assert(!rendererSource.includes(">写入 CLI Profile<"), "manual write CLI profile button should not remain visible");
pass("multiProfileUiMarkers");

const discovery = await discoverFeishuCli();
if (!discovery.installed) {
  pass("liveDiscoverySkippedNoLocalCli");
} else {
  assert(discovery.cliPath && /lark-cli|feishu-cli/i.test(discovery.cliPath), "discovery should return a lark/feishu CLI path");
  assert(discovery.installDir, "discovery should return install directory");
  assert(Array.isArray(discovery.profiles), "discovery profiles should be an array");
  pass("liveDiscoveryReturnsCliAndProfiles");

  if (discovery.profiles.length > 0) {
    assert(discovery.recommendedProfile, "recommended profile should be reported when profiles exist");
    const report = await new RealFeishuCliConnector().verify({
      cliPath: discovery.cliPath,
      profile: "definitely-missing-profile-for-probe",
      appId: ""
    });
    assert(report.ok === false, "missing configured profile must fail instead of falling back to another account");
    assert(report.errors.some((item) => item.code === "profile-missing"), "missing configured profile should produce profile-missing");
    assert(report.steps.some((item) => item.id === "profile" && item.status === "failed"), "profile step should fail for missing configured profile");
    pass("missingProfileDoesNotFallback");

    if (discovery.profiles.length > 1) {
      const explicitChoiceReport = await new RealFeishuCliConnector().verify({
        cliPath: discovery.cliPath,
        profile: "",
        appId: ""
      });
      assert(explicitChoiceReport.ok === false, "multiple profiles must require explicit user choice");
      assert(explicitChoiceReport.cli.profile === "未选择", "report must show no selected profile when multiple profiles exist and none was configured");
      assert(explicitChoiceReport.errors.some((item) => item.code === "profile-missing"), "empty profile with multiple profiles should produce profile-missing");
      pass("multiProfileRequiresExplicitChoice");
    } else {
      pass("multiProfileExplicitChoiceSkippedSingleProfile");
    }
  } else {
    pass("liveProfileFallbackSkippedNoProfiles");
  }
}
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase32-probe-entry.ts",
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
