import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const electronExecutable = process.platform === "win32" ? "electron.exe" : "electron";
const electronPath = [
  path.join(desktopRoot, "node_modules", "electron", "dist", electronExecutable),
  path.join(repoRoot, "node_modules", "electron", "dist", electronExecutable)
].find((candidate) => existsSync(candidate)) ?? path.join(desktopRoot, "node_modules", "electron", "dist", electronExecutable);
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-electron-smoke-"));
const userDataDir = path.join(tempRoot, "user-data");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const probeEnv = {
  ...process.env,
  WORKBENCH_REPO_ROOT: isolatedRepoRoot,
  WORKBENCH_LIFECYCLE_PROBE: "1"
};
let first = null;
let second = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`等待${description}超时。`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return Promise.race([
    new Promise((resolve) => child.once("exit", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
}

async function openCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++commandId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    evaluate: async (expression) => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.result.exceptionDetails) {
        const detail = response.result.exceptionDetails.exception?.description
          ?? response.result.exceptionDetails.text
          ?? "未知页面异常";
        throw new Error(`Electron UI 自动化执行失败：${detail}`);
      }
      return response.result.result.value;
    },
    fire: (method, params = {}) => ws.send(JSON.stringify({ id: ++commandId, method, params })),
    close: () => ws.close()
  };
}

try {
  assert(existsSync(electronPath), "未找到 Electron 可执行文件，请先安装依赖。");
  first = spawn(electronPath, [`--user-data-dir=${userDataDir}`, "--remote-debugging-port=0", "."], {
    cwd: desktopRoot,
    env: probeEnv,
    stdio: "ignore",
    windowsHide: false
  });

  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  const activePort = await waitFor(async () => {
    try {
      const [portLine, browserPath] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      return /^\d+$/.test(portLine) && browserPath ? { port: Number(portLine), browserPath } : null;
    } catch {
      return null;
    }
  }, 15_000, "Electron 首屏调试端口");

  const page = await waitFor(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${activePort.port}/json`)).json();
      const values = Array.isArray(targets) ? targets : [targets];
      return values.find((item) => item.type === "page" && item.title === "SAP AI 顾问工作台") ?? null;
    } catch {
      return null;
    }
  }, 15_000, "Electron 首屏加载");
  assert(first.exitCode === null, "Electron 在首屏加载后意外退出。");
  process.stdout.write("electronStaticBuildLoads=ok\n");

  const pageSession = await openCdp(page.webSocketDebuggerUrl);
  const uiResult = JSON.parse(await pageSession.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const root = document.querySelector('#root');
    if (!root || root.childElementCount === 0 || !document.body.innerText.includes('Work')) throw new Error('blank-root');
    document.querySelector('[aria-label="新建 Project"]')?.click();
    await wait(60);
    const nameInput = document.querySelector('[aria-label="项目名称"]');
    if (!nameInput) throw new Error('missing-project-form');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(nameInput, 'Electron Smoke');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(40);
    document.querySelector('form[aria-label="新建 Project"]')?.requestSubmit();
    await wait(700);
    document.querySelector('.primary-nav button:nth-child(2)')?.click();
    await wait(500);
    const tabs = [...document.querySelectorAll('.config-tabs [role=tab]')];
    const states = [];
    for (const tab of tabs) {
      tab.click();
      await wait(30);
      states.push([...document.querySelectorAll('[role=tabpanel]')].filter((panel) => !panel.hidden).map((panel) => panel.id));
    }
    tabs[0]?.click();
    await wait(30);
    tabs[0]?.focus();
    tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await wait(30);
    const selectedAfterKeyboard = document.querySelector('.config-tabs [aria-selected=true]')?.id ?? '';
    tabs[0]?.click();
    await wait(30);
    const addConnection = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('添加连接'));
    addConnection?.click();
    await wait(30);
    const connectionCountAfterAdd = document.querySelectorAll('.adt-connection-list .model-channel-list > button').length;
    document.querySelector('#config-panel-sap .config-actions button')?.click();
    await wait(700);
    const savedAfterAdd = await window.workbench.getState();
    const savedConnectionCountAfterAdd = savedAfterAdd.data.projects.find((item) => item.name === 'Electron Smoke')?.config?.adtConnections?.length ?? 0;
    window.confirm = () => false;
    document.querySelector('[aria-label="移除当前 SAP 连接"]')?.click();
    await wait(30);
    const connectionCountAfterCancel = document.querySelectorAll('.adt-connection-list .model-channel-list > button').length;
    window.confirm = () => true;
    document.querySelector('[aria-label="移除当前 SAP 连接"]')?.click();
    await wait(30);
    const connectionCountAfterRemove = document.querySelectorAll('.adt-connection-list .model-channel-list > button').length;
    document.querySelector('#config-panel-sap .config-actions button')?.click();
    await wait(700);
    const savedAfterRemove = await window.workbench.getState();
    const savedConnectionCountAfterRemove = savedAfterRemove.data.projects.find((item) => item.name === 'Electron Smoke')?.config?.adtConnections?.length ?? 0;
    return JSON.stringify({
      tabs: tabs.length,
      states,
      selectedAfterKeyboard,
      projectCreated: document.body.innerText.includes('Electron Smoke'),
      connectionCountAfterAdd,
      savedConnectionCountAfterAdd,
      connectionCountAfterCancel,
      connectionCountAfterRemove,
      savedConnectionCountAfterRemove
    });
  })()`));
  assert(uiResult.projectCreated && uiResult.tabs === 5, "真实首屏没有完成 Project 创建或五类配置页签渲染。");
  assert(uiResult.states.every((visible) => visible.length === 1), "配置页签切换时没有保持唯一可见面板。");
  assert(uiResult.selectedAfterKeyboard === "config-tab-models", "配置页签方向键切换未生效。");
  assert(uiResult.connectionCountAfterAdd === 2 && uiResult.connectionCountAfterCancel === 2 && uiResult.connectionCountAfterRemove === 1, "多 SAP 连接添加、取消或确认移除交互未生效。");
  assert(uiResult.savedConnectionCountAfterAdd === 2 && uiResult.savedConnectionCountAfterRemove === 1, "多 SAP 连接没有完成磁盘状态 1→2→1 的持久化闭环。");
  const isolatedStatePath = path.join(isolatedRepoRoot, "local-data", "workbench", "app-state.json");
  assert(existsSync(isolatedStatePath), "Electron smoke probe 没有使用隔离工作区。");
  const isolatedState = JSON.parse(await readFile(isolatedStatePath, "utf8"));
  const smokeProject = isolatedState.projects.find((item) => item.name === "Electron Smoke");
  assert(smokeProject?.config?.adtConnections?.length === 1, "确认移除 SAP 连接后没有持久保存。");
  process.stdout.write("electronConfigTabsInteractive=ok\n");

  second = spawn(electronPath, [`--user-data-dir=${userDataDir}`, "."], {
    cwd: desktopRoot,
    env: probeEnv,
    stdio: "ignore",
    windowsHide: true
  });
  const secondExit = await waitForExit(second, 8_000);
  assert(secondExit !== null, "第二实例没有按单实例规则退出。");
  assert(first.exitCode === null, "第二实例启动导致主实例退出。");

  const lifecyclePath = path.join(userDataDir, "logs", `lifecycle-${new Date().toISOString().slice(0, 10)}.log`);
  const lifecycleText = await waitFor(async () => {
    try {
      const text = await readFile(lifecyclePath, "utf8");
      return text.includes('"event":"second-instance-requested"') ? text : null;
    } catch {
      return null;
    }
  }, 5_000, "第二实例生命周期记录");
  assert(lifecycleText.includes('"event":"renderer-load-completed"'), "生命周期日志缺少首屏加载完成记录。");
  process.stdout.write("secondInstanceFocusBoundary=ok\n");

  pageSession.fire("Page.crash");
  const recoveredPage = await waitFor(async () => {
    try {
      const text = await readFile(lifecyclePath, "utf8");
      if (!text.includes('"event":"renderer-controlled-reload"')) return null;
      const targets = await (await fetch(`http://127.0.0.1:${activePort.port}/json`)).json();
      const values = Array.isArray(targets) ? targets : [targets];
      return values.find((item) => item.type === "page" && item.title === "SAP AI 顾问工作台") ?? null;
    } catch {
      return null;
    }
  }, 10_000, "renderer 一次受控恢复");
  const recoveredSession = await openCdp(recoveredPage.webSocketDebuggerUrl);
  recoveredSession.fire("Page.crash");
  await waitFor(async () => {
    try {
      const text = await readFile(lifecyclePath, "utf8");
      return text.includes('"event":"renderer-recovery-limit-reached"') ? true : null;
    } catch {
      return null;
    }
  }, 8_000, "renderer 二次崩溃恢复上限");
  assert(first.exitCode === null, "renderer 二次崩溃导致主进程自动重启或退出。");
  process.stdout.write("rendererRecoveryBoundedToOnce=ok\n");

  const browserSession = await openCdp(`ws://127.0.0.1:${activePort.port}${activePort.browserPath}`);
  browserSession.fire("Browser.close");
  const firstExit = await waitForExit(first, 8_000);
  assert(firstExit !== null, "Electron 没有在正常关闭后退出。");
  const finalLog = await readFile(lifecyclePath, "utf8");
  assert(finalLog.includes('"event":"app-before-quit"') && finalLog.includes('"event":"app-will-quit"') && finalLog.includes('"event":"session-ended"'), "正常关闭缺少生命周期记录。");
  process.stdout.write("normalCloseLifecycleLogged=ok\n");
  process.stdout.write("phase41-electron-smoke-probe=ok\n");
} finally {
  if (second && second.exitCode === null) {
    second.kill();
    await waitForExit(second, 3_000);
  }
  if (first && first.exitCode === null) {
    first.kill();
    await waitForExit(first, 5_000);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
