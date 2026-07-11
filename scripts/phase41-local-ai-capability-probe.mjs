import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = await readFile("apps/desktop/src/main/localAiCapabilityService.ts", "utf8");
const main = await readFile("apps/desktop/src/main/main.ts", "utf8");
const preload = await readFile("apps/desktop/src/preload/preload.ts", "utf8");
const rendererTypes = await readFile("apps/desktop/src/renderer/vite-env.d.ts", "utf8");
const sharedTypes = await readFile("apps/desktop/src/shared/workbenchTypes.ts", "utf8");

assert.match(sharedTypes, /LocalAiCapabilityId = "codex-cli"/);
assert.match(service, /capabilities: \[capability\]/);
assert.doesNotMatch(service, /ollama|lm studio|local network|局域网/i);
assert.match(service, /OFFICIAL_NPM_PACKAGE = "@openai\/codex"/);
assert.match(service, /\["install", "-g", OFFICIAL_NPM_PACKAGE\]/);
assert.match(service, /timeout,/);
assert.match(service, /windowsHide: true/);
assert.match(service, /shell: false/);
assert.doesNotMatch(service, /shell:\s*true/);
assert.match(service, /versionFromOutput/);
assert.match(service, /pathLabel: "npm 全局安装目录"/);
const localAiTypes = sharedTypes.slice(sharedTypes.indexOf("export interface LocalAiCapability"), sharedTypes.indexOf("export interface CodexCaseAssistContext"));
assert.doesNotMatch(localAiTypes, /environment|stdout|stderr|executablePath/i);

assert.equal((main.match(/ipcMain\.handle\("local-ai-(?:scan|install)"/g) ?? []).length, 2);
assert.match(main, /dialog\.showMessageBox/);
assert.match(main, /已取消安装 Codex CLI，工作台核心功能不受影响/);
assert.match(main, /parseLocalAiInstallInput\(input\)/);
assert.match(service, /Object\.keys\(input\)\.length !== 1/);
assert.match(preload, /ipcRenderer\.invoke\("local-ai-scan"\)/);
assert.match(preload, /ipcRenderer\.invoke\("local-ai-install", input\)/);
assert.match(rendererTypes, /installLocalAiCapability: \(input: LocalAiInstallInput\)/);

const preloadLocalAiBridge = preload.split(/\r?\n/).filter((line) => /LocalAi|local-ai/.test(line)).join("\n");
const rendererLocalAiBridge = rendererTypes.split(/\r?\n/).filter((line) => /LocalAi|local-ai/.test(line)).join("\n");
for (const source of [preloadLocalAiBridge, rendererLocalAiBridge]) {
  assert.doesNotMatch(source, /npm install|-g|@openai\/codex|command:|packageName|url:/i);
}

assert.match(main, /requestSingleInstanceLock\(\)/);
assert.match(main, /createAppLifecycleLogger/);
assert.match(main, /workbench:model-provider-verify/);
assert.match(main, /installFeishuCliWithConsent/);

process.stdout.write("phase41-local-ai-capability-probe=ok\n");
