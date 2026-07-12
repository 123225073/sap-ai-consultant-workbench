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
  await writeFile(path.join(isolatedRepoRoot, "local-data", "workbench", "app-state.json"), JSON.stringify({
    ...state,
    chatThreads: [],
    activeChatThreadId: null
  }, null, 2));
  const project = state.projects.find((item) => item.isVisible !== false && item.config.apiProviders.some((provider) => (
    provider.enabled
    && provider.lastVerificationMode === "http"
    && provider.modelSyncStatus === "verified"
    && provider.chatTestStatus === "verified"
    && provider.lastVerifiedModelId
  )));
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
    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Work'))?.click();
    await until(() => document.querySelector('.project-switch'));
    const projectButton = [...document.querySelectorAll('.project-switch')].find((item) => item.textContent.includes(${JSON.stringify(project.name)}));
    if (!projectButton) throw new Error('model-project-not-visible:' + [...document.querySelectorAll('.project-switch')].map((item) => item.textContent.trim()).join('|'));
    projectButton.click();
    await until(() => projectButton.closest('.project-card')?.classList.contains('active'));
    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Chat'))?.click();
    await until(() => document.querySelector('.daily-chat-composer .model-select'));
    document.querySelector('.primary-nav button')?.click();
    await until(() => document.body.innerText.includes('新对话已创建'));
    document.querySelector('.daily-chat-composer .model-select').click();
    await until(() => document.querySelector('.daily-chat-composer .model-picker-panel'));
    const modelButtons = [...document.querySelectorAll('.daily-chat-composer .model-picker-list button')];
    const target = modelButtons.find((button) => button.querySelector('small')?.textContent === ${JSON.stringify(modelId)});
    if (!target) throw new Error('verified-model-not-in-selector:' + modelButtons.map((button) => button.querySelector('small')?.textContent ?? '').join(','));
    const selectedLabel = target.textContent;
    target.click();
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
    await until(() => textarea.value === '');
    const clearedAfterSubmit = textarea.value === '';
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
    const flow = document.querySelector('.conversation-flow');
    const distanceFromBottom = flow ? flow.scrollHeight - flow.scrollTop - flow.clientHeight : Number.POSITIVE_INFINITY;
    const chatResult = {
      clearedAfterSubmit,
      distanceFromBottom,
      sawStreaming: window.__streamUat.seen,
      streamedChars: window.__streamUat.maxChars,
      finalLabel: latest?.querySelector('.run-time')?.textContent ?? '',
      finalChars: latest?.querySelector('p')?.textContent?.length ?? 0,
      finalText: latest?.querySelector('p')?.textContent ?? ''
    };

    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Work'))?.click();
    await until(() => document.querySelector('[aria-label="继续追问"]') && document.querySelector('.composer .model-select'));
    document.querySelector('.composer .model-select').click();
    await until(() => document.querySelector('.composer .model-picker-panel'));
    const workTarget = [...document.querySelectorAll('.composer .model-picker-list button')]
      .find((button) => button.querySelector('small')?.textContent === ${JSON.stringify(modelId)});
    if (!workTarget) throw new Error('verified-model-not-in-work-selector');
    workTarget.click();
    const workTextarea = document.querySelector('[aria-label="继续追问"]');
    setValue(workTextarea, '请只回复：Work 真实流式回测成功');
    window.__workStreamUat = { seen: false, maxChars: 0 };
    const baselineWorkReplyCount = document.querySelectorAll('.assistant-message:not(.streaming-assistant-message)').length;
    const workObserver = new MutationObserver(() => {
      const streaming = document.querySelector('.streaming-assistant-message');
      const streamedChars = Number(streaming?.getAttribute('data-streaming-chars') ?? 0);
      if (streamedChars > 0) {
        window.__workStreamUat.seen = true;
        window.__workStreamUat.maxChars = Math.max(window.__workStreamUat.maxChars, streamedChars);
      }
    });
    workObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.querySelector('.composer').requestSubmit();
    await until(() => workTextarea.value === '');
    await until(() => window.__workStreamUat.seen, 120000);
    await until(() => (
      document.querySelectorAll('.assistant-message:not(.streaming-assistant-message)').length > baselineWorkReplyCount
      && !document.querySelector('.streaming-assistant-message')
      && !document.querySelector('.composer .send-button').disabled
    ), 120000);
    workObserver.disconnect();
    const workFlow = document.querySelector('.conversation-flow');
    const workState = (await window.workbench.getState()).data;
    const workProject = workState.projects.find((item) => item.id === workState.activeProjectId);
    const workCase = workProject?.cases.find((item) => item.id === workState.activeCaseId);
    const workLastMessage = workCase?.messages.at(-1);
    const workResult = {
      clearedAfterSubmit: workTextarea.value === '',
      distanceFromBottom: workFlow ? workFlow.scrollHeight - workFlow.scrollTop - workFlow.clientHeight : Number.POSITIVE_INFINITY,
      sawStreaming: window.__workStreamUat.seen,
      streamedChars: window.__workStreamUat.maxChars,
      finalModelId: workLastMessage?.modelId ?? '',
      finalChars: workLastMessage?.content?.length ?? 0
    };

    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Chat'))?.click();
    await until(() => document.querySelector('.daily-chat-composer'));
    return JSON.stringify({
      optionCount: modelButtons.length,
      selectedLabel,
      chat: chatResult,
      work: workResult
    });
  })()`));

  console.log(`realStreamObservation=${JSON.stringify(result)}`);
  assert(result.optionCount >= provider.models.length, "模型选择器没有展示已获取的完整模型目录。");
  assert(result.chat.clearedAfterSubmit, "Chat 发送后输入框没有立即清空。");
  assert(result.chat.distanceFromBottom < 4, "Chat 对话完成后没有自动跟随到最新消息。");
  assert(result.chat.sawStreaming && result.chat.streamedChars > 0, "Chat 真实模型回复没有出现渐进式流式内容。");
  assert(result.chat.finalChars > 0 && result.chat.finalLabel.includes(modelId), "Chat 真实模型回复没有以所选模型持久化。");
  assert(result.work.clearedAfterSubmit, "Work 发送后输入框没有立即清空。");
  assert(result.work.distanceFromBottom < 4, "Work 对话完成后没有自动跟随到最新消息。");
  assert(result.work.sawStreaming && result.work.streamedChars > 0, "Work 短回复没有真实流式输出。");
  assert(result.work.finalChars > 0 && result.work.finalModelId === modelId, "Work 真实模型回复没有以所选模型持久化。");
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
  console.log(`realChatStreamedChars=${result.chat.streamedChars}`);
  console.log(`realWorkStreamedChars=${result.work.streamedChars}`);
  console.log("phase44-real-model-streaming-uat=ok");
} finally {
  session?.close();
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill();
    await waitForExit(appProcess, 5000);
  }
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
