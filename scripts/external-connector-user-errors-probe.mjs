import { build } from "esbuild";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-connector-errors-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(fullPath) : /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  }));
  return nested.flat();
}

for (const file of await sourceFiles(path.join(repoRoot, "apps", "desktop", "src", "main"))) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/throw new Error\("([^"\\]*(?:\\.[^"\\]*)*)"\)/g)) {
    if (!/[\u3400-\u9fff]/u.test(match[1])) {
      throw new Error(`面向用户的 Error 字面量缺少中文说明：${path.relative(repoRoot, file)} -> ${match[1]}`);
    }
  }
}
log("allLiteralMainErrorsContainChinese=ok");

function log(message) {
  process.stdout.write(`${message}\n`);
}

const entrySource = `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { RealAdtReadonlyConnector } from "./apps/desktop/src/main/adtReadonlyConnector.ts";
import { RealCodexCliConnector } from "./apps/desktop/src/main/codexCliConnector.ts";
import { FakeFeishuCliConnector } from "./apps/desktop/src/main/feishuCliConnector.ts";
import { externalConnectorThrownError, externalConnectorUserError } from "./apps/desktop/src/main/externalConnectorUserError.ts";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function failureText(report) {
  return JSON.stringify({
    errors: report.errors,
    failedSteps: report.steps.filter((item) => item.status === "failed")
  });
}

function assertSafeChineseError(value, forbidden) {
  assert(/[\\u3400-\\u9fff]/u.test(value), "用户错误应包含中文原因或建议");
  for (const secret of forbidden) {
    assert(!value.includes(secret), "用户错误泄露了敏感输入：" + secret);
  }
}

for (const connector of ["ADT Service", "Codex CLI", "Feishu/Lark CLI"]) {
  for (const kind of ["missing", "timeout", "network", "authentication", "permission", "invalid-response", "execution", "configuration"]) {
    const copy = externalConnectorUserError(connector, kind);
    assertSafeChineseError(copy.reason + copy.suggestion, ["secret-host.internal", "SECRET_USER", "sk-secret-value"]);
    assert(copy.reason.includes(connector), connector + " 错误原因缺少连接器名称");
    const thrown = externalConnectorThrownError(copy);
    assert(thrown.message.startsWith("原因：") && thrown.message.includes("建议："), "抛出错误缺少原因/建议结构");
  }
}
pass("sharedChineseReasonAndSuggestion");

const server = createServer((_request, response) => {
  response.writeHead(401, { "content-type": "text/plain" });
  response.end("secret-host.internal SECRET_USER sk-secret-value");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = "http://127.0.0.1:" + address.port;

try {
  const adtReport = await new RealAdtReadonlyConnector().verify({
    alias: "secret-host.internal",
    url: baseUrl,
    client: "100",
    username: "SECRET_USER",
    password: "sk-secret-value",
    language: "ZH",
    sslMode: "strict",
    readOnly: true
  });
  const adtText = failureText(adtReport);
  assertSafeChineseError(adtText, [baseUrl, "secret-host.internal", "SECRET_USER", "sk-secret-value"]);
  assert(adtText.includes("ADT Service") && adtText.includes("HTTP 401"), "ADT 错误应保留 ADT Service 和 HTTP 状态");
  pass("adtErrorRedactsConnectionInputs");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const codexReport = await new RealCodexCliConnector().verify({
  integrationType: "sdk",
  executablePath: "C:\\\\Users\\\\SECRET_USER\\\\codex.exe",
  workspaceRoot: "C:\\\\secret-host.internal\\\\sk-secret-value"
});
const codexText = failureText(codexReport);
assertSafeChineseError(codexText, ["secret-host.internal", "SECRET_USER", "sk-secret-value"]);
assert(codexText.includes("Codex CLI"), "Codex 错误应保留 Codex CLI 技术词");
pass("codexErrorRedactsLocalInputs");

const feishuReport = await new FakeFeishuCliConnector().verify({
  cliPath: "missing-cli-secret-host.internal",
  profile: "SECRET_USER-sk-secret-value",
  appId: "cli_secret"
});
const feishuText = failureText(feishuReport);
assertSafeChineseError(feishuText, ["secret-host.internal", "SECRET_USER", "sk-secret-value"]);
assert(/Feishu\\/Lark CLI|飞书 CLI/.test(feishuText), "Feishu/Lark 错误应保留必要技术词");
pass("feishuErrorRedactsProfileInputs");

const feishuSource = await readFile("./apps/desktop/src/main/feishuCliConnector.ts", "utf8");
assert(!feishuSource.includes("profile \${configuredProfile}"), "Feishu 失败步骤不能回显配置的 profile 名称");
assert(!feishuSource.includes('missing.join("、")'), "Feishu 权限错误不能回显未经筛选的 CLI 输出");
pass("feishuFailureDetailsDoNotEchoCliValues");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "external-connector-user-errors-probe-entry.ts",
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
