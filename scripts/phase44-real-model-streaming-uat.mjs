import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const sourceWorkspace = path.join(repoRoot, "local-data", "workbench");
const electronName = process.platform === "win32" ? "electron.exe" : "electron";
const electronPath = [
  path.join(desktopRoot, "node_modules", "electron", "dist", electronName),
  path.join(repoRoot, "node_modules", "electron", "dist", electronName)
].find((candidate) => existsSync(candidate));
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-real-stream-uat-"));
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const userDataDir = path.join(tempRoot, "user-data");
const sourceUserDataDir = [
  path.join(process.env.APPDATA ?? "", "@sap-ai-workbench", "desktop"),
  path.join(process.env.APPDATA ?? "", "SAP AI 顾问工作台")
].find((candidate) => existsSync(path.join(candidate, "Local State"))) ?? "";
const outputRoot = path.join(repoRoot, "output", "phase44-real-model-streaming");
let appProcess = null;
let session = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // Keep waiting for the Electron renderer or model response.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待${description}超时。`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
}

async function openCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const target = pending.get(message.id);
    if (!target) return;
    pending.delete(message.id);
    if (message.error) target.reject(new Error(message.error.message));
    else target.resolve(message.result ?? {});
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "页面执行失败");
      }
      return result.result?.value;
    },
    close: () => ws.close()
  };
}

try {
  assert(electronPath, "未找到 Electron 可执行文件。");
  assert(existsSync(path.join(sourceWorkspace, "app-state.json")), "没有可用于真实回测的本地工作台配置。");
  await mkdir(path.join(isolatedRepoRoot, "local-data"), { recursive: true });
  await cp(sourceWorkspace, path.join(isolatedRepoRoot, "local-data", "workbench"), { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  if (existsSync(path.join(sourceUserDataDir, "Local State"))) {
    await copyFile(path.join(sourceUserDataDir, "Local State"), path.join(userDataDir, "Local State"));
  }
  await mkdir(outputRoot, { recursive: true });

  const state = JSON.parse(await readFile(path.join(sourceWorkspace, "app-state.json"), "utf8"));
  const project = state.projects.find((item) => item.id === state.activeProjectId);
  const provider = project?.config.apiProviders.find((item) => (
    item.enabled
    && item.lastVerificationMode === "http"
    && item.modelSyncStatus === "verified"
    && item.chatTestStatus === "verified"
    && item.lastVerifiedModelId
  ));
  assert(provider, "当前 Project 没有已通过真实 HTTP 验证的模型渠道。");
  const modelId = provider.lastVerifiedModelId;

  appProcess = spawn(electronPath, [`--user-data-dir=${userDataDir}`, "--remote-debugging-port=0", "."], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      WORKBENCH_REPO_ROOT: isolatedRepoRoot,
      WORKBENCH_LIFECYCLE_PROBE: "1"
    },
    stdio: "ignore",
    windowsHide: true
  });

  const portInfo = await waitFor(async () => {
    const lines = (await readFile(path.join(userDataDir, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
    return /^\d+$/.test(lines[0]) ? { port: Number(lines[0]) } : null;
  }, 15000, "Electron 调试端口");
  const page = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${portInfo.port}/json`)).json();
    return targets.find((item) => item.type === "page" && item.title === "SAP AI 顾问工作台") ?? null;
  }, 15000, "工作台首屏");
  session = await openCdp(page.webSocketDebuggerUrl);

  const result = JSON.parse(await session.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (check, timeout = 120000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = check();
        if (value) return value;
        await wait(50);
      }
      throw new Error('ui-timeout');
    };
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Chat'))?.click();
    await until(() => document.querySelector('[aria-label="日常对话渠道和模型"]'));
    const select = document.querySelector('[aria-label="日常对话渠道和模型"]');
    const target = [...select.options].find((option) => option.value.endsWith(${JSON.stringify(`::${modelId}`)}));
    if (!target) throw new Error('verified-model-not-in-selector');
    setValue(select, target.value);
    const textarea = document.querySelector('[aria-label="日常对话输入"]');
    setValue(textarea, '请只回复：真实流式回测成功');
    window.__streamUat = { seen: false, maxChars: 0 };
    const baselineReplyCount = document.querySelectorAll('.daily-chat-message').length;
    const observer = new MutationObserver(() => {
      const streaming = document.querySelector('.streaming-assistant-message');
      const streamedChars = Number(streaming?.getAttribute('data-streaming-chars') ?? 0);
      if (streamedChars > 0) {
        window.__streamUat.seen = true;
        window.__streamUat.maxChars = Math.max(window.__streamUat.maxChars, streamedChars);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.querySelector('.daily-chat-composer').requestSubmit();
    await until(() => window.__streamUat.seen || (
      document.querySelectorAll('.daily-chat-message').length > baselineReplyCount
      && !document.querySelector('.daily-chat-composer .send-button').disabled
    ), 120000);
    await until(() => (
      document.querySelectorAll('.daily-chat-message').length > baselineReplyCount
      && !document.querySelector('.streaming-assistant-message')
      && !document.querySelector('.daily-chat-composer .send-button').disabled
    ), 120000);
    observer.disconnect();
    const replies = [...document.querySelectorAll('.daily-chat-message')];
    const latest = replies.at(-1);
    return JSON.stringify({
      optionCount: select.options.length,
      selectedLabel: target.textContent,
      sawStreaming: window.__streamUat.seen,
      streamedChars: window.__streamUat.maxChars,
      finalLabel: latest?.querySelector('.run-time')?.textContent ?? '',
      finalChars: latest?.querySelector('p')?.textContent?.length ?? 0,
      finalText: latest?.querySelector('p')?.textContent ?? ''
    });
  })()`));

  console.log(`realStreamObservation=${JSON.stringify(result)}`);
  assert(result.optionCount >= provider.models.length, "模型选择器没有展示已获取的完整模型目录。");
  assert(result.sawStreaming && result.streamedChars > 0, "真实模型回复没有出现渐进式流式内容。");
  assert(result.finalChars > 0 && result.finalLabel.includes(modelId), "真实模型回复没有以所选模型持久化。");
  const screenshot = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputRoot, "latest.png"), Buffer.from(screenshot.data, "base64"));
  await writeFile(path.join(outputRoot, "latest.json"), JSON.stringify({
    checkedAt: new Date().toISOString(),
    provider: provider.name,
    modelId,
    ...result
  }, null, 2));
  console.log(`realModelProvider=${provider.name}`);
  console.log(`realModelId=${modelId}`);
  console.log(`realStreamedChars=${result.streamedChars}`);
  console.log("phase44-real-model-streaming-uat=ok");
} finally {
  session?.close();
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill();
    await waitForExit(appProcess, 5000);
  }
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
