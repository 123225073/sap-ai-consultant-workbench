import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const electronExecutable = process.platform === "win32" ? "electron.exe" : "electron";
const electronPath = [
  path.join(desktopRoot, "node_modules", "electron", "dist", electronExecutable),
  path.join(repoRoot, "node_modules", "electron", "dist", electronExecutable)
].find((candidate) => existsSync(candidate));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = path.resolve(process.env.PHASE43_UAT_OUTPUT ?? path.join(repoRoot, "output", "phase43-release-uat", runId));
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase43-uat-"));
const userDataDir = path.join(tempRoot, "user-data");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const screenshotRecords = [];
const checks = [];
let first = null;
let pageSession = null;
let electronStdout = "";
let electronStderr = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return Promise.race([
    new Promise((resolve) => child.once("exit", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
}

async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`等待${description}超时${lastError ? `：${lastError.message}` : ""}`);
}

function sanitizedEnvironment() {
  const sensitiveName = /(api|auth|credential|key|password|secret|token|csc_link|openai|anthropic|deepseek|gemini|aws|azure)/i;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !sensitiveName.test(name) && !name.startsWith("WORKBENCH_"))
  );
  return {
    ...environment,
    WORKBENCH_REPO_ROOT: isolatedRepoRoot,
    WORKBENCH_LIFECYCLE_PROBE: "1"
  };
}

async function openCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timeout } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result ?? {});
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Electron UAT CDP 命令超时：${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onclose = () => {
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(new Error("Electron UAT CDP 连接提前关闭。"));
    }
    pending.clear();
  };
  return {
    send,
    evaluate: async (expression) => {
      const response = await send("Runtime.evaluate", {
        expression: `globalThis.__phase43AwaitedEvaluation = (${expression})`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      });
      if (response.exceptionDetails) {
        const description = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
        throw new Error(`Electron UAT 页面执行失败：${description}`);
      }
      return response.result?.value;
    },
    fire: (method, params = {}) => ws.send(JSON.stringify({ id: ++commandId, method, params })),
    close: () => ws.close()
  };
}

async function evaluateJson(expression) {
  return JSON.parse(await pageSession.evaluate(`(async () => JSON.stringify(await (${expression})))()`));
}

async function capture(name) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const result = await pageSession.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const buffer = Buffer.from(result.data, "base64");
  assert(buffer.length > 10_000, `截图 ${name} 包含有效图形像素`);
  const fileName = `${String(screenshotRecords.length + 1).padStart(2, "0")}-${name}.png`;
  const filePath = path.join(outputRoot, "screenshots", fileName);
  await writeFile(filePath, buffer);
  screenshotRecords.push({ file: path.relative(outputRoot, filePath).replaceAll("\\", "/"), bytes: buffer.length, sha256: sha256(buffer) });
  process.stdout.write(`phase43-stage=captured-${name}\n`);
}

async function setViewport(width, height) {
  await pageSession.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  });
  await pageSession.evaluate("window.dispatchEvent(new Event('resize'))");
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function findFiles(root, wantedNames) {
  const found = new Map();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (wantedNames.has(entry.name)) found.set(entry.name, target);
    }
  }
  await visit(root);
  return found;
}

const helperSource = `(() => {
  const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
  const setValue = (element, value) => {
    if (!element) throw new Error('missing-input');
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickText = (text, selector = 'button') => {
    const element = [...document.querySelectorAll(selector)].find((item) => normalize(item.textContent).includes(text));
    if (!element) throw new Error('missing-control:' + text);
    element.click();
    return element;
  };
  const until = async (check, timeoutMs = 12000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('ui-wait-timeout');
  };
  window.__phase43 = { normalize, setValue, clickText, until };
  return true;
})()`;

try {
  assert(Boolean(electronPath), "已找到 Electron 可执行文件");
  await mkdir(path.join(outputRoot, "screenshots"), { recursive: true });

  first = spawn(electronPath, [
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "--disable-gpu",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
    "."
  ], {
    cwd: desktopRoot,
    env: sanitizedEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  first.stdout?.on("data", (chunk) => {
    electronStdout = `${electronStdout}${chunk}`.slice(-1_000_000);
  });
  first.stderr?.on("data", (chunk) => {
    electronStderr = `${electronStderr}${chunk}`.slice(-1_000_000);
  });

  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  const activePort = await waitFor(async () => {
    try {
      const [portLine, browserPath] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      return /^\d+$/.test(portLine) && browserPath ? { port: Number(portLine), browserPath } : null;
    } catch {
      return null;
    }
  }, 15_000, "Electron CDP 端口");

  const page = await waitFor(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${activePort.port}/json`)).json();
      return targets.find((item) => item.type === "page" && !item.url.startsWith("devtools:")) ?? null;
    } catch {
      return null;
    }
  }, 15_000, "Electron renderer");
  pageSession = await openCdp(page.webSocketDebuggerUrl);
  await pageSession.send("Page.enable");
  await pageSession.send("Runtime.enable");
  await setViewport(1440, 900);
  await waitFor(() => pageSession.evaluate("Boolean(document.querySelector('#root')?.childElementCount && document.body.innerText.includes('Work'))"), 15_000, "工作台首屏");
  await pageSession.evaluate(helperSource);
  process.stdout.write("phase43-stage=renderer-ready\n");

  const initialSafety = await evaluateJson(`({
    title: document.title,
    hasBridge: Boolean(window.workbench?.getState),
    hasSecretText: /(sk-[a-z0-9_-]{8,}|api[_ -]?key\\s*[:=]\\s*[^*\\s]|password\\s*[:=]\\s*[^*\\s])/i.test(document.body.innerText),
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0
  })`);
  assert(initialSafety.title === "SAP AI 顾问工作台", "真实 Electron renderer 标题正确");
  assert(initialSafety.hasBridge && initialSafety.rootChildren > 0, "preload bridge 与 React 首屏均已加载");
  assert(!initialSafety.hasSecretText, "首屏没有明文密钥特征");

  await pageSession.evaluate(`(async () => {
    document.querySelector('[aria-label="新建客户项目"]').click();
    await __phase43.until(() => Boolean(document.querySelector('form[aria-label="新建客户项目"]')));
    document.querySelector('.create-dialog-backdrop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await __phase43.until(() => !document.querySelector('form[aria-label="新建客户项目"]'));
    document.querySelector('[aria-label="新建客户项目"]').click();
    await __phase43.until(() => Boolean(document.querySelector('form[aria-label="新建客户项目"]')));
    __phase43.setValue(document.querySelector('[aria-label="客户项目名称"]'), 'Phase43 正式 UAT');
    __phase43.setValue(document.querySelector('[aria-label="项目类型"]'), 'S4');
    __phase43.setValue(document.querySelector('[aria-label="系统或本地标签"]'), 'UAT/100');
    document.querySelector('form[aria-label="新建客户项目"]').requestSubmit();
    await __phase43.until(async () => (await window.workbench.getState()).data.projects.some((item) => item.name === 'Phase43 正式 UAT'));
    __phase43.clickText('新建运维项目');
    await new Promise((resolve) => setTimeout(resolve, 50));
    return true;
  })()`);
  const taskDialog = await evaluateJson(`(() => {
    const tabs = [...document.querySelectorAll('.task-folder-mode button')];
    return {
      title: document.querySelector('[aria-label="新建运维项目"] .create-dialog-heading strong')?.textContent,
      labels: tabs.map((item) => item.textContent.trim()),
      backgrounds: tabs.map((item) => getComputedStyle(item).backgroundColor),
      activeCount: tabs.filter((item) => item.classList.contains('active')).length
    };
  })()`);
  assert(taskDialog.title === "新建运维项目" && taskDialog.labels.join("|") === "新建文件夹|已有文件夹", "新建运维项目明确区分新建和已有工作文件夹");
  assert(taskDialog.activeCount === 1 && taskDialog.backgrounds.every((color) => color !== "rgb(37, 99, 235)"), "文件夹页签未被主按钮蓝色样式污染");
  await capture("task-dialog-folder-binding");

  const existingFolderMode = await pageSession.evaluate(`(async () => {
    [...document.querySelectorAll('.task-folder-mode button')].find((item) => item.textContent.trim() === '已有文件夹').click();
    await __phase43.until(() => Boolean([...document.querySelectorAll('.local-folder-picker button')].find((item) => item.textContent.includes('选择电脑文件夹'))));
    const picker = [...document.querySelectorAll('.local-folder-picker button')].find((item) => item.textContent.includes('选择电脑文件夹'));
    const internalCaseSelect = document.querySelector('[aria-label="已有工作文件夹"]');
    return JSON.stringify({ pickerLabel: picker?.textContent.trim(), hasInternalCaseSelect: Boolean(internalCaseSelect) });
  })()`);
  const existingFolderResult = JSON.parse(existingFolderMode);
  assert(existingFolderResult.pickerLabel === "选择电脑文件夹" && !existingFolderResult.hasInternalCaseSelect, "已有文件夹必须调用电脑目录选择器，不能复用内部案件下拉框");
  await capture("task-dialog-existing-local-picker");
  await pageSession.evaluate(`(() => {
    [...document.querySelectorAll('.task-folder-mode button')].find((item) => item.textContent.trim() === '新建文件夹').click();
    return true;
  })()`);

  await pageSession.evaluate(`(async () => {
    document.querySelector('.create-dialog-backdrop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await __phase43.until(() => !document.querySelector('.create-dialog[aria-label="新建运维项目"]'));
    __phase43.clickText('新建运维项目');
    await __phase43.until(() => Boolean(document.querySelector('.create-dialog[aria-label="新建运维项目"]')));
    __phase43.setValue(document.querySelector('[aria-label="运维项目名称"]'), 'UAT 核心旅程');
    document.querySelector('.case-create').requestSubmit();
    await __phase43.until(async () => {
      const response = await window.workbench.getState();
      const project = response.data.projects.find((item) => item.name === 'Phase43 正式 UAT');
      const workProject = project?.cases.find((item) => item.title === 'UAT 核心旅程');
      return Boolean(workProject && response.data.workThreads.some((item) => item.caseId === workProject.id && item.title === '新对话'));
    });
    return true;
  })()`);
  const compactComposer = await evaluateJson(`(() => {
    const composer = document.querySelector('.compact-composer')?.getBoundingClientRect();
    const textarea = document.querySelector('.compact-composer textarea')?.getBoundingClientRect();
    return { composerHeight: composer?.height ?? 0, textareaHeight: textarea?.height ?? 0 };
  })()`);
  assert(compactComposer.composerHeight > 0 && compactComposer.composerHeight <= 100 && compactComposer.textareaHeight <= 42, "空输入框保持紧凑，内容增加时再自适应长高");
  await capture("work-case-created");

  await pageSession.evaluate(`(async () => {
    const textarea = document.querySelector('[aria-label="继续追问"]');
    __phase43.setValue(textarea, '请记录本次 UAT：验证本地案件对话不依赖 SAP 连接。');
    document.querySelector('.composer').requestSubmit();
    await __phase43.until(() => textarea.value === '');
    await __phase43.until(async () => {
      const state = (await window.workbench.getState()).data;
      const project = state.projects.find((item) => item.name === 'Phase43 正式 UAT');
      const workProject = project?.cases.find((item) => item.title === 'UAT 核心旅程');
      const workThread = state.workThreads.find((item) => item.caseId === workProject?.id && item.title.includes('请记录本次 UAT'));
      return (workThread?.messages.length ?? 0) >= 2;
    });
    await __phase43.until(() => {
      const flow = document.querySelector('.conversation-flow');
      return flow && flow.scrollHeight - flow.scrollTop - flow.clientHeight < 96;
    });
    return true;
  })()`);

  const outsideDismissal = await evaluateJson(`await (async () => {
    const threadMenu = document.querySelector('.conversation-row-shell .thread-menu');
    if (!threadMenu) throw new Error('missing-thread-menu');
    const threadMenuTrigger = threadMenu.querySelector('.floating-menu-trigger');
    if (!threadMenuTrigger) throw new Error('missing-thread-menu-trigger');
    threadMenuTrigger.click();
    await __phase43.until(() => threadMenuTrigger.getAttribute('aria-expanded') === 'true');
    await __phase43.until(() => Boolean(document.querySelector('.thread-menu-panel')));
    const menuPanel = document.querySelector('.thread-menu-panel');
    const menuButtons = [...(menuPanel?.querySelectorAll('button') ?? [])];
    const menuRect = menuPanel?.getBoundingClientRect();
    const visibleMenuItems = menuButtons.filter((button) => {
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hitStack = document.elementsFromPoint(centerX, centerY);
      return rect.width > 0
        && rect.height > 0
        && centerX >= 0
        && centerX <= window.innerWidth
        && centerY >= 0
        && centerY <= window.innerHeight
        && hitStack.some((element) => element === button || button.contains(element));
    });
    const menuGeometry = {
      itemCount: menuButtons.length,
      visibleItemCount: visibleMenuItems.length,
      panelInsideViewport: Boolean(menuRect)
        && menuRect.left >= 0
        && menuRect.right <= window.innerWidth
        && menuRect.top >= 0
        && menuRect.bottom <= window.innerHeight
    };
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await __phase43.until(() => threadMenuTrigger.getAttribute('aria-expanded') === 'false');

    const modelTrigger = document.querySelector('.model-select');
    if (!modelTrigger) throw new Error('missing-model-picker');
    modelTrigger?.click();
    await __phase43.until(() => modelTrigger?.getAttribute('aria-expanded') === 'true');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await __phase43.until(() => modelTrigger?.getAttribute('aria-expanded') === 'false');

    threadMenuTrigger.click();
    await __phase43.until(() => threadMenuTrigger.getAttribute('aria-expanded') === 'true');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await __phase43.until(() => threadMenuTrigger.getAttribute('aria-expanded') === 'false');

    modelTrigger?.click();
    await __phase43.until(() => modelTrigger?.getAttribute('aria-expanded') === 'true');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await __phase43.until(() => modelTrigger?.getAttribute('aria-expanded') === 'false');

    return {
      threadMenuClosed: threadMenuTrigger.getAttribute('aria-expanded') === 'false',
      modelPickerClosed: modelTrigger?.getAttribute('aria-expanded') === 'false',
      menuGeometry
    };
  })()`);
  assert(
    outsideDismissal.menuGeometry.itemCount >= 2
      && outsideDismissal.menuGeometry.visibleItemCount === outsideDismissal.menuGeometry.itemCount
      && outsideDismissal.menuGeometry.panelInsideViewport,
    "会话更多菜单的全部选项完整可见且可以点击"
  );
  assert(outsideDismissal.threadMenuClosed && outsideDismissal.modelPickerClosed, "会话菜单和模型选择器支持点击空白处或 Esc 收起");

  const hierarchyDisclosure = await evaluateJson(`await (async () => {
    const customerHeading = document.querySelector('.customer-project-card.active .project-switch');
    if (!customerHeading) throw new Error('missing-customer-heading');
    const customerTreeId = customerHeading.getAttribute('aria-controls');
    customerHeading.click();
    await __phase43.until(() => customerHeading.getAttribute('aria-expanded') === 'false' && !document.getElementById(customerTreeId));
    customerHeading.click();
    await __phase43.until(() => customerHeading.getAttribute('aria-expanded') === 'true' && Boolean(document.getElementById(customerTreeId)));

    const workProjectHeading = document.querySelector('.customer-project-card.active .work-project-open');
    if (!workProjectHeading) throw new Error('missing-work-project-heading');
    const threadListId = workProjectHeading.getAttribute('aria-controls');
    workProjectHeading.click();
    await __phase43.until(() => workProjectHeading.getAttribute('aria-expanded') === 'false' && !document.getElementById(threadListId));
    workProjectHeading.click();
    await __phase43.until(() => workProjectHeading.getAttribute('aria-expanded') === 'true' && Boolean(document.getElementById(threadListId)));

    return {
      customerExpanded: customerHeading.getAttribute('aria-expanded') === 'true',
      workProjectExpanded: workProjectHeading.getAttribute('aria-expanded') === 'true',
      hideButtons: document.querySelectorAll('.project-hide-button').length,
      customerActionCount: document.querySelectorAll('.customer-project-card.active .project-actions > *').length
    };
  })()`);
  assert(hierarchyDisclosure.customerExpanded && hierarchyDisclosure.workProjectExpanded, "客户项目和运维项目标题支持点击收起及再次展开");
  assert(hierarchyDisclosure.hideButtons === 0 && hierarchyDisclosure.customerActionCount <= 2, "客户项目移除隐藏按钮并将低频配置收进更多菜单");

  const uatStatePath = path.join(isolatedRepoRoot, "local-data", "workbench", "app-state.json");
  const uatState = JSON.parse(await readFile(uatStatePath, "utf8"));
  const uatProject = uatState.projects.find((item) => item.name === "Phase43 正式 UAT");
  const uatConnection = {
    ...uatProject.config.adt,
    alias: "DS4 开发 220",
    systemId: "DS4",
    instanceNumber: "02",
    environment: "development",
    usage: "UAT 只读连接选择器",
    routingKeywords: ["UAT"],
    url: "https://ds4.uat.invalid:44302",
    client: "220",
    username: "UAT_USER",
    sslMode: "strict",
    readOnly: true,
    configStatus: "verified",
    connectionStatus: "verified",
    minimalReadStatus: "verified",
    lastVerificationMode: "adt",
    lastCheckedAt: "2026-07-13T08:00:00.000Z"
  };
  uatProject.config.adt = uatConnection;
  uatProject.config.adtConnections = [uatConnection];
  uatProject.config.activeAdtConnectionId = uatConnection.id;
  uatProject.config.agentTools.sapReadonlyEnabled = true;
  await writeFile(uatStatePath, `${JSON.stringify(uatState, null, 2)}\n`, "utf8");
  await pageSession.evaluate("location.reload()");
  await waitFor(() => pageSession.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('.conversation-panel'))"), 12_000, "UAT SAP 连接状态重载");
  await pageSession.evaluate(helperSource);
  const sapReadiness = await evaluateJson(`await (async () => {
    const state = (await window.workbench.getState()).data;
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    return {
      activeView: document.querySelector('.workspace-switch button.active')?.textContent?.trim() ?? '',
      hasSapEvidenceButton: [...document.querySelectorAll('button')].some((item) => item.textContent.includes('SAP 取证')),
      projectName: project?.name ?? '',
      connections: (project?.config.adtConnections ?? []).map((item) => ({ id: item.id, systemId: item.systemId, instanceNumber: item.instanceNumber, connectionStatus: item.connectionStatus, minimalReadStatus: item.minimalReadStatus, lastVerificationMode: item.lastVerificationMode }))
    };
  })()`);
  assert(sapReadiness.hasSapEvidenceButton, `注入的 SAP UAT 连接没有进入可取证状态：${JSON.stringify(sapReadiness)}`);
  const sapOutsideDismissal = await evaluateJson(`await (async () => {
    __phase43.clickText('SAP 取证');
    await __phase43.until(() => Boolean(document.querySelector('.sap-connection-picker > button')));
    const sapTrigger = document.querySelector('.sap-connection-picker > button');
    sapTrigger.click();
    await __phase43.until(() => sapTrigger.getAttribute('aria-expanded') === 'true');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await __phase43.until(() => sapTrigger.getAttribute('aria-expanded') === 'false');
    sapTrigger.click();
    await __phase43.until(() => sapTrigger.getAttribute('aria-expanded') === 'true');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await __phase43.until(() => sapTrigger.getAttribute('aria-expanded') === 'false');
    __phase43.clickText('收起取证');
    return { sapPickerClosed: sapTrigger.getAttribute('aria-expanded') === 'false' };
  })()`);
  assert(sapOutsideDismissal.sapPickerClosed, "SAP 连接选择器支持点击空白处或 Esc 收起");

  await pageSession.evaluate(`(async () => {
    const chatButton = [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Chat'));
    if (!chatButton) throw new Error('missing-chat-switch');
    chatButton.click();
    try {
      await __phase43.until(() => Boolean(document.querySelector('[aria-label="日常对话输入"]')));
    } catch (error) {
      const activeTab = document.querySelector('.workspace-switch button.active')?.textContent?.trim() ?? 'unknown';
      const dialog = document.querySelector('[role="dialog"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? 'none';
      throw new Error('chat-switch-timeout:active=' + activeTab + ';dialog=' + dialog + ';body=' + document.body.innerText.slice(0, 800));
    }
    const textarea = document.querySelector('[aria-label="日常对话输入"]');
    __phase43.setValue(textarea, 'Phase43 日常对话隔离验证');
    document.querySelector('.daily-chat-composer').requestSubmit();
    await __phase43.until(() => textarea.value === '');
    await __phase43.until(() => document.body.innerText.includes('Phase43 日常对话隔离验证'));
    await __phase43.until(() => {
      const flow = document.querySelector('.conversation-flow');
      return flow && flow.scrollHeight - flow.scrollTop - flow.clientHeight < 4;
    });
    return true;
  })()`);
  const chatBoundary = await evaluateJson(`({
    filesPanelAbsent: !document.querySelector('.files-panel'),
    heading: document.querySelector('.daily-chat-panel h1')?.textContent,
    boundaryVisible: document.querySelector('.daily-chat-panel .case-heading')?.textContent.includes('内容不进入案件')
  })`);
  assert(chatBoundary.filesPanelAbsent && chatBoundary.boundaryVisible, "Chat 不展示案件文件面板且明确保持独立");
  await capture("chat-independent-conversation");

  await pageSession.evaluate(`(async () => {
    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Work')).click();
    await __phase43.until(() => Boolean(document.querySelector('[aria-label="继续追问"]')));
    return true;
  })()`);

  async function runArtifactAction(actionId, expectedPath) {
    await pageSession.evaluate(`(async () => {
      __phase43.clickText('成果动作');
      await __phase43.until(() => Boolean(document.querySelector('[aria-label="案件动作确认"]')));
      __phase43.setValue(document.querySelector('[aria-label="选择成果动作"]'), ${JSON.stringify(actionId)});
      await __phase43.until(() => document.querySelector('.action-target-line code')?.textContent?.trim() === ${JSON.stringify(expectedPath)});
      const startButton = [...document.querySelectorAll('button')].find((item) => __phase43.normalize(item.textContent) === '开始生成');
      if (!startButton || startButton.disabled) throw new Error('artifact-action-not-ready:${actionId}');
      startButton.click();
      try {
        await __phase43.until(async () => {
          const response = await window.workbench.previewCurrentCaseFile({ relativePath: ${JSON.stringify(expectedPath)} });
          return response.ok && response.data.content.length > 100;
        }, 30000);
      } catch (error) {
        const preview = await window.workbench.previewCurrentCaseFile({ relativePath: ${JSON.stringify(expectedPath)} });
        const actionTarget = document.querySelector('.action-target-line code')?.textContent?.trim() ?? 'missing';
        const actionButton = [...document.querySelectorAll('button')].find((item) => ['开始生成', '生成中'].includes(__phase43.normalize(item.textContent)));
        throw new Error('artifact-action-timeout:${actionId};target=' + actionTarget + ';button=' + (actionButton?.textContent?.trim() ?? 'missing') + ';preview=' + JSON.stringify(preview));
      }
      await __phase43.until(() => !document.querySelector('[aria-label="案件动作确认"]'), 20000);
      return true;
    })()`);
  }

  await runArtifactAction("development-spec", "outputs/开发说明书.md");
  const developmentSpec = await evaluateJson(`await (async () => {
    const response = await window.workbench.previewCurrentCaseFile({ relativePath: 'outputs/开发说明书.md' });
    return { ok: response.ok, content: response.ok ? response.data.content : response.error };
  })()`);
  const requiredSections = ["业务背景与目标", "需求范围", "现状与问题", "方案设计", "SAP 对象与接口", "处理逻辑", "权限与安全", "异常处理", "测试方案", "上线与回退", "待确认事项"];
  assert(developmentSpec.ok && requiredSections.every((section) => developmentSpec.content.includes(section)), "开发说明书包含完整交付章节");
  await capture("work-development-spec");

  await runArtifactAction("draw-flow", "outputs/逻辑说明图.mmd");
  process.stdout.write("phase43-stage=flow-action-completed\n");
  const flowResult = await evaluateJson(`await (async () => {
    const response = await window.workbench.previewCurrentCaseFile({ relativePath: 'outputs/逻辑说明图.mmd' });
    return { ok: response.ok, content: response.ok ? response.data.content : response.error };
  })()`);
  process.stdout.write(`phase43-stage=flow-source-checked;chars=${flowResult.content?.length ?? 0}\n`);
  assert(flowResult.ok && /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)/i.test(flowResult.content.trim()), "流程图生成有效 Mermaid flowchart 源码");
  assert(!/(click|href|https?:|javascript:|<script)/i.test(flowResult.content), "Mermaid 流程图不包含脚本或外部链接");
  const visibleFileRows = await evaluateJson(`[...document.querySelectorAll('.file-row-button')].map((item) => __phase43.normalize(item.textContent))`);
  process.stdout.write("phase43-stage=flow-file-rows-read\n");
  assert(visibleFileRows.some((text) => text.includes("逻辑说明图.mmd")), `流程图成果出现在右侧可预览文件树：${visibleFileRows.join("|")}`);
  await pageSession.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.file-row-button')].find((item) => __phase43.normalize(item.textContent).includes('逻辑说明图.mmd'));
    row.click();
    return true;
  })()`);
  process.stdout.write("phase43-stage=flow-file-clicked\n");
  await waitFor(
    () => pageSession.evaluate(`[...document.querySelectorAll('.mermaid-preview-actions button')].some((item) => __phase43.normalize(item.textContent) === '图形')`),
    5000,
    "Mermaid 图形按钮"
  );
  process.stdout.write("phase43-stage=flow-render-button-ready\n");
  await pageSession.evaluate(`(() => {
    const renderButton = [...document.querySelectorAll('.mermaid-preview-actions button')].find((item) => __phase43.normalize(item.textContent) === '图形');
    if (!renderButton || renderButton.disabled) throw new Error('mermaid-render-not-ready');
    renderButton.click();
    return true;
  })()`);
  process.stdout.write("phase43-stage=flow-render-clicked\n");
  await waitFor(
    () => pageSession.evaluate(`Boolean(document.querySelector('.mermaid-preview-canvas svg'))`),
    12000,
    "Mermaid 静态 SVG 渲染"
  );
  process.stdout.write("phase43-stage=flow-svg-ready\n");
  const mermaidUiSafety = await evaluateJson(`(() => {
    const svg = document.querySelector('.mermaid-preview-canvas svg');
    const elements = svg ? [svg, ...svg.querySelectorAll('*')] : [];
    return {
      rendered: Boolean(svg),
      unsafeTag: Boolean(svg?.querySelector('script,foreignObject,iframe,object,embed,image,a')),
      unsafeAttribute: elements.some((element) => [...element.attributes].some((attribute) => /^on/i.test(attribute.name) || /^(?:href|xlink:href|src)$/i.test(attribute.name)))
    };
  })()`);
  process.stdout.write("phase43-stage=flow-svg-safety-checked\n");
  assert(mermaidUiSafety.rendered && !mermaidUiSafety.unsafeTag && !mermaidUiSafety.unsafeAttribute, "Mermaid 实际界面仅挂载清洗后的静态 SVG");
  for (const format of ["SVG", "PNG", "PDF"]) {
    process.stdout.write(`phase43-stage=flow-export-${format.toLowerCase()}-start\n`);
    await pageSession.evaluate(`(() => {
      const button = [...document.querySelectorAll('.mermaid-preview-actions button')].find((item) => __phase43.normalize(item.textContent) === ${JSON.stringify(format)});
      if (!button || button.disabled) throw new Error('mermaid-export-not-ready:${format}');
      button.click();
      return true;
    })()`);
    try {
      await waitFor(
        () => pageSession.evaluate(`(() => {
          const finished = ![...document.querySelectorAll('.mermaid-preview-actions button')].some((item) => __phase43.normalize(item.textContent) === '导出中');
          const hasOutput = [...document.querySelectorAll('.file-row span')].some((item) => __phase43.normalize(item.textContent).toLowerCase().endsWith('.${format.toLowerCase()}'));
          return finished && hasOutput;
        })()`),
        30000,
        `Mermaid ${format} 导出`
      );
    } catch (error) {
      const diagnostic = await evaluateJson(`({
        notice: document.querySelector('.phase-notice')?.textContent ?? '',
        buttons: [...document.querySelectorAll('.mermaid-preview-actions button')].map((item) => __phase43.normalize(item.textContent)),
        files: [...document.querySelectorAll('.file-row span')].map((item) => __phase43.normalize(item.textContent))
      })`);
      throw new Error(`Mermaid ${format} 导出失败：${error.message}；${JSON.stringify(diagnostic)}`);
    }
    process.stdout.write(`phase43-stage=flow-export-${format.toLowerCase()}-done\n`);
  }
  await capture("work-mermaid-flow");

  await pageSession.evaluate(`(async () => {
    __phase43.clickText('配置中心');
    await __phase43.until(() => document.querySelectorAll('.config-tabs [role="tab"]').length === 6);
    return true;
  })()`);
  const configTabs = await evaluateJson(`[...document.querySelectorAll('.config-tabs [role="tab"]')].map((tab) => ({ id: tab.id, text: __phase43.normalize(tab.textContent) }))`);
  assert(configTabs.length === 6, "配置中心显示六个分层配置页签");
  for (const tab of configTabs) {
    await pageSession.evaluate(`(async () => {
      document.getElementById(${JSON.stringify(tab.id)}).click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      return true;
    })()`);
    const visiblePanelCount = await pageSession.evaluate("[...document.querySelectorAll('[role=tabpanel]')].filter((panel) => !panel.hidden).length");
    assert(visiblePanelCount === 1, `配置页签 ${tab.text} 仅显示一个对应面板`);
    await capture(`config-${tab.id.replace("config-tab-", "")}`);
  }

  await pageSession.evaluate(`(async () => {
    __phase43.clickText('能力中心');
    await __phase43.until(() => document.querySelectorAll('.capability-tabs [role="tab"]').length === 5);
    return true;
  })()`);
  const capabilityTabs = await evaluateJson(`[...document.querySelectorAll('.capability-tabs [role="tab"]')].map((tab) => __phase43.normalize(tab.textContent))`);
  assert(
    ["插件", "Skills", "MCP", "提示词", "记忆"].every((label) => capabilityTabs.includes(label)),
    "能力中心显示插件、Skills、MCP、提示词和记忆五个页签"
  );
  for (const label of capabilityTabs) {
    await pageSession.evaluate(`(async () => {
      __phase43.clickText(${JSON.stringify(label)}, '.capability-tabs [role="tab"]');
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    })()`);
    const selectedCount = await pageSession.evaluate("[...document.querySelectorAll('.capability-tabs [role=tab]')].filter((tab) => tab.getAttribute('aria-selected') === 'true').length");
    assert(selectedCount === 1, `能力中心页签 ${label} 只有一个选中状态`);
  }
  await pageSession.evaluate(`(async () => {
    __phase43.clickText('MCP', '.capability-tabs [role="tab"]');
    await __phase43.until(() => [...document.querySelectorAll('button')].some((button) => __phase43.normalize(button.textContent).includes('添加连接')));
    __phase43.clickText('添加连接');
    await __phase43.until(() => Boolean(document.querySelector('.capability-modal-backdrop')));
    document.querySelector('.capability-modal-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await __phase43.until(() => !document.querySelector('.capability-modal-backdrop'));
    return true;
  })()`);
  assert(await pageSession.evaluate("!document.querySelector('.capability-modal-backdrop')"), "能力中心弹窗可点击空白区域关闭");
  await capture("capability-center-mcp");

  await pageSession.evaluate(`(async () => {
    __phase43.clickText('规范中心');
    await __phase43.until(() => Boolean(document.querySelector('.standards-editor textarea')));
    const textarea = document.querySelector('.standards-editor textarea');
    __phase43.setValue(textarea, textarea.value + '\\nPhase43 UAT：交付前必须核对只读边界。');
    __phase43.clickText('保存当前项目版本');
    await __phase43.until(() => document.body.innerText.includes('当前项目规范已保存'));
    await __phase43.until(() => document.querySelectorAll('.standards-category-list button').length >= 8);
    await __phase43.until(() => Boolean(document.querySelector('.standards-toolbar')?.textContent.includes('差异')));
    return true;
  })()`);
  const standardsState = await evaluateJson(`({
    heading: document.querySelector('.standards-main h1')?.textContent,
    categoryCount: document.querySelectorAll('.standards-category-list button').length,
    hasDiff: Boolean(document.querySelector('.standards-toolbar')?.textContent.includes('差异'))
  })`);
  assert(
    standardsState.heading === "规范中心" && standardsState.categoryCount >= 8 && standardsState.hasDiff,
    `规范中心可编辑、保存并展示差异：${JSON.stringify(standardsState)}`
  );
  await capture("standards-saved-diff");

  await pageSession.evaluate(`(async () => {
    __phase43.clickText('知识库');
    await __phase43.until(() => Boolean(document.querySelector('.knowledge-import-details')));
    document.querySelector('.knowledge-import-details').open = true;
    __phase43.setValue(document.querySelector('[placeholder="例如：采购订单审批口径"]'), 'Phase43 只读交付知识');
    __phase43.setValue(document.querySelector('[placeholder="例如：会议纪要摘录"]'), 'Phase43 隔离 UAT');
    __phase43.setValue(document.querySelector('[placeholder="可选，用空格分隔"]'), 'T000');
    __phase43.setValue(document.querySelector('[placeholder^="粘贴已脱敏"]'), '所有 SAP 访问默认只读；开发说明书和流程图必须经过人工确认后交付。');
    document.querySelector('.knowledge-import-form').requestSubmit();
    await __phase43.until(() => document.body.innerText.includes('Phase43 只读交付知识'));
    const itemButton = [...document.querySelectorAll('.knowledge-list button')].find((item) => item.textContent.includes('Phase43 只读交付知识'));
    itemButton.click();
    await __phase43.until(() => Boolean(document.querySelector('.knowledge-review-gate')));
    document.querySelectorAll('.knowledge-review-checks input').forEach((input) => input.click());
    __phase43.setValue(document.querySelector('.knowledge-review-note textarea'), '已核对来源、敏感信息、适用范围和业务正确性。');
    __phase43.clickText('记录审核');
    await __phase43.until(() => document.body.innerText.includes('已审核'));
    __phase43.clickText('确认入库');
    await __phase43.until(() => document.body.innerText.includes('已发布'));
    return true;
  })()`);
  const knowledgeState = await evaluateJson(`({
    titleVisible: document.body.innerText.includes('Phase43 只读交付知识'),
    publishedVisible: document.body.innerText.includes('已发布'),
    reviewVisible: document.body.innerText.includes('已审核')
  })`);
  assert(knowledgeState.titleVisible && knowledgeState.publishedVisible && knowledgeState.reviewVisible, "知识候选经过人工审核门后才可发布");
  await capture("knowledge-reviewed-published");

  await pageSession.evaluate(`(async () => {
    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Work')).click();
    await __phase43.until(() => Boolean(document.querySelector('.conversation-panel')));
    document.querySelector('[aria-label="隐藏右侧面板"]')?.click();
    return true;
  })()`);
  const scrollControl = await evaluateJson(`await (async () => {
    const flow = document.querySelector('.conversation-flow');
    const content = document.querySelector('.conversation-content');
    const spacer = document.createElement('div');
    spacer.style.height = '1200px';
    spacer.style.minHeight = '1200px';
    spacer.style.flex = '0 0 1200px';
    content.appendChild(spacer);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    flow.scrollTop = flow.scrollHeight;
    flow.scrollTop = 0;
    flow.dispatchEvent(new Event('scroll', { bubbles: true }));
    await __phase43.until(() => Boolean(document.querySelector('.scroll-latest-button')));
    const buttonVisible = Boolean(document.querySelector('.scroll-latest-button'));
    document.querySelector('.scroll-latest-button').click();
    await new Promise((resolve) => setTimeout(resolve, 160));
    const returnedToLatest = flow.scrollHeight - flow.scrollTop - flow.clientHeight < 96;
    spacer.remove();
    return { buttonVisible, returnedToLatest };
  })()`);
  assert(scrollControl.buttonVisible && scrollControl.returnedToLatest, "用户向上阅读时显示回到底部按钮，点击后回到最新消息");
  await setViewport(900, 700);
  const responsive = await evaluateJson(`(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const composer = document.querySelector('.composer')?.getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
    const conversation = document.querySelector('.conversation-panel')?.getBoundingClientRect();
    const send = document.querySelector('.send-button')?.getBoundingClientRect();
    const inside = (rect) => rect && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1;
    return {
      viewport,
      noHorizontalPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      composerInside: inside(composer),
      sendInside: inside(send),
      sidebarWidth: Math.round(sidebar?.width ?? 0),
      conversationWidth: Math.round(conversation?.width ?? 0),
      filesHidden: !document.querySelector('.files-panel')
    };
  })()`);
  assert(responsive.noHorizontalPageOverflow && responsive.composerInside && responsive.sendInside, "900×700 响应式布局无页面横向溢出且输入区可操作");
  assert(responsive.sidebarWidth >= 160 && responsive.conversationWidth >= 500 && responsive.filesHidden, "紧凑窗口保留导航与核心工作区，文件面板可收起");
  await capture("responsive-900x700");

  await setViewport(680, 520);
  const minimumViewport = await evaluateJson(`(() => {
    const composer = document.querySelector('.composer')?.getBoundingClientRect();
    const send = document.querySelector('.send-button')?.getBoundingClientRect();
    const conversation = document.querySelector('.conversation-panel')?.getBoundingClientRect();
    const inside = (rect) => rect && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1;
    return {
      noHorizontalPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      composerInside: inside(composer),
      sendInside: inside(send),
      conversationWidth: Math.round(conversation?.width ?? 0),
      projectSettingsVisible: inside(document.querySelector('.project-menu .floating-menu-trigger')?.getBoundingClientRect())
    };
  })()`);
  assert(minimumViewport.noHorizontalPageOverflow && minimumViewport.composerInside && minimumViewport.sendInside, "680×520 最小窗口输入区仍完整可操作");
  assert(minimumViewport.conversationWidth >= 500, "680×520 最小窗口保留足够的核心对话宽度");
  assert(minimumViewport.projectSettingsVisible, "680×520 最小窗口仍保留 Project 设置入口");
  await capture("responsive-680x520");

  const compactSapPicker = await evaluateJson(`await (async () => {
    __phase43.clickText('SAP 取证');
    await __phase43.until(() => Boolean(document.querySelector('.sap-connection-picker > button')));
    const trigger = document.querySelector('.sap-connection-picker > button');
    trigger.click();
    await __phase43.until(() => trigger.getAttribute('aria-expanded') === 'true');
    const panel = document.querySelector('.sap-connection-picker-panel')?.getBoundingClientRect();
    const inside = panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1;
    return { inside, left: panel?.left ?? -1, right: panel?.right ?? -1, width: panel?.width ?? 0 };
  })()`);
  assert(compactSapPicker.inside, "680×520 最小窗口 SAP 连接选择面板不越界");
  await capture("responsive-680x520-sap-picker");
  await pageSession.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);

  process.stdout.write("phase43-stage=thread-lifecycle-start\n");
  const threadLifecycle = await evaluateJson(`await (async () => {
    const call = (label, promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('thread-lifecycle-timeout:' + label)), 8000))
    ]);
    let state = (await call('get-state', window.workbench.getState())).data;
    const project = state.projects.find((item) => item.name === 'Phase43 正式 UAT');
    const caseItem = project?.cases.find((item) => item.title === 'UAT 核心旅程');
    const original = state.workThreads.find((item) => item.id === state.activeWorkThreadId && item.projectId === project?.id && item.caseId === caseItem?.id)
      ?? state.workThreads.find((item) => item.projectId === project?.id && item.caseId === caseItem?.id);
    state = (await call('create-work', window.workbench.createWorkThread({ projectId: project.id, title: 'UAT 生命周期任务', folderMode: 'existing', caseId: caseItem.id }))).data;
    const work = state.workThreads.find((item) => item.title === 'UAT 生命周期任务');
    const archivedWork = (await call('archive-work', window.workbench.updateConversationThreadStatus({ scope: 'work', threadId: work.id, status: 'archived' }))).data.workThreads.find((item) => item.id === work.id)?.status;
    const restoredWork = (await call('restore-work', window.workbench.updateConversationThreadStatus({ scope: 'work', threadId: work.id, status: 'active' }))).data.workThreads.find((item) => item.id === work.id)?.status;
    const removedWork = (await call('remove-work', window.workbench.updateConversationThreadStatus({ scope: 'work', threadId: work.id, status: 'removed' }))).data.workThreads.find((item) => item.id === work.id)?.status;
    await call('restore-work-again', window.workbench.updateConversationThreadStatus({ scope: 'work', threadId: work.id, status: 'active' }));
    const search = (await call('search-work', window.workbench.search(work.id))).data;
    await call('switch-original-work', window.workbench.switchWorkThread({ threadId: original.id }));

    state = (await call('create-chat', window.workbench.createDailyChatThread({ title: 'UAT 生命周期对话' }))).data;
    const chat = state.chatThreads.find((item) => item.title === 'UAT 生命周期对话');
    const archivedChat = (await call('archive-chat', window.workbench.updateConversationThreadStatus({ scope: 'chat', threadId: chat.id, status: 'archived' }))).data.chatThreads.find((item) => item.id === chat.id)?.status;
    const removedChat = (await call('remove-chat', window.workbench.updateConversationThreadStatus({ scope: 'chat', threadId: chat.id, status: 'removed' }))).data.chatThreads.find((item) => item.id === chat.id)?.status;
    const restoredChat = (await call('restore-chat', window.workbench.updateConversationThreadStatus({ scope: 'chat', threadId: chat.id, status: 'active' }))).data.chatThreads.find((item) => item.id === chat.id)?.status;
    return {
      workId: work.id,
      chatId: chat.id,
      sameFolder: work.caseId === original.caseId,
      independentIds: work.id !== original.id && work.id !== chat.id,
      archivedWork,
      restoredWork,
      removedWork,
      archivedChat,
      removedChat,
      restoredChat,
      searchable: search.some((item) => item.type === 'work-thread' && item.threadId === work.id)
    };
  })()`);
  assert(threadLifecycle.sameFolder && threadLifecycle.independentIds, "同一工作文件夹可以绑定多个独立任务会话 ID");
  assert(threadLifecycle.archivedWork === "archived" && threadLifecycle.removedWork === "removed" && threadLifecycle.restoredWork === "active", "Work 任务支持归档、移除和恢复");
  assert(threadLifecycle.archivedChat === "archived" && threadLifecycle.removedChat === "removed" && threadLifecycle.restoredChat === "active", "Chat 对话支持归档、移除和恢复");
  assert(threadLifecycle.searchable, "任务可以通过持久化会话 ID 搜索定位");
  process.stdout.write("phase43-stage=thread-lifecycle-complete\n");

  const persisted = await evaluateJson(`await (async () => {
    const response = await window.workbench.getState();
    const project = response.data.projects.find((item) => item.name === 'Phase43 正式 UAT');
    const caseItem = project?.cases.find((item) => item.title === 'UAT 核心旅程');
    const workThread = response.data.workThreads.find((item) => item.id === response.data.activeWorkThreadId && item.projectId === project?.id && item.caseId === caseItem?.id)
      ?? response.data.workThreads.find((item) => item.projectId === project?.id && item.caseId === caseItem?.id && item.messages.length > 0);
    const flattenPaths = (nodes) => nodes.flatMap((item) => [item.relativePath, ...flattenPaths(item.children ?? [])]);
    return {
      ok: response.ok,
      projectId: project?.id,
      caseId: caseItem?.id,
      threadId: workThread?.id,
      messageCount: workThread?.messages.length ?? 0,
      knowledgePublished: project?.knowledge.items.some((item) => item.title === 'Phase43 只读交付知识' && item.status === 'published'),
      standardsVersion: project?.standards.version ?? 0,
      files: flattenPaths(response.data.activeCaseFiles)
    };
  })()`);
  assert(persisted.ok && persisted.messageCount >= 6, "Work 对话和成果动作已持久化到隔离案件");
  assert(persisted.knowledgePublished && persisted.standardsVersion >= 2, "规范与知识状态已持久化到隔离 Project");
  assert(persisted.files.includes("outputs/开发说明书.md") && persisted.files.includes("outputs/逻辑说明图.mmd"), "右侧文件树包含开发说明书和 Mermaid 流程图");
  process.stdout.write("phase43-stage=persistence-complete\n");

  const lifecyclePath = path.join(userDataDir, "logs", `lifecycle-${new Date().toISOString().slice(0, 10)}.log`);

  const browserSession = await openCdp(`ws://127.0.0.1:${activePort.port}${activePort.browserPath}`);
  browserSession.fire("Browser.close");
  process.stdout.write("phase43-stage=browser-close-sent\n");
  const firstExit = await waitForExit(first, 8_000);
  assert(firstExit !== null, "主进程正常关闭并退出");

  const lifecycleText = await readFile(lifecyclePath, "utf8");
  const lifecycleEvents = lifecycleText.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).event);
  for (const event of ["renderer-load-completed", "app-before-quit", "app-will-quit", "session-ended"]) {
    assert(lifecycleEvents.includes(event), `生命周期日志包含 ${event}`);
  }
  assert(!/(sk-[a-z0-9_-]{8,}|api[_ -]?key|password|token)/i.test(lifecycleText), "生命周期日志不包含密钥字段或密钥特征");

  const wantedFiles = new Set(["开发说明书.md", "逻辑说明图.mmd"]);
  const generatedFiles = await findFiles(isolatedRepoRoot, wantedFiles);
  assert(generatedFiles.size === wantedFiles.size, "隔离工作区磁盘上存在两类核心成果文件");
  const artifactRecords = [];
  for (const [name, filePath] of generatedFiles) {
    const content = await readFile(filePath);
    artifactRecords.push({ name, bytes: content.length, sha256: sha256(content) });
  }

  await writeFile(path.join(outputRoot, "lifecycle.log"), lifecycleText, "utf8");
  const report = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    status: "passed",
    isolation: {
      realSecretsRead: false,
      realConnectorsInvoked: false,
      dataRoot: "system-temporary-directory",
      environmentSecretsInherited: false
    },
    evidenceChain: ["CDP PNG screenshots", "DOM and accessibility assertions", "IPC and persisted state assertions", "generated file content and SHA256", "main process lifecycle log"],
    checks,
    screenshots: screenshotRecords,
    artifacts: artifactRecords,
    lifecycleEvents,
    responsive,
    persisted: { ...persisted, projectId: "[isolated]", caseId: "[isolated]" }
  };
  await writeFile(path.join(outputRoot, "uat-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputRoot, "README.txt"), [
    "Phase 43 桌面正式 UAT 证据",
    "",
    "本目录由 npm run probe:release-uat 生成。",
    "截图来自真实 Electron renderer 的 Chrome DevTools Protocol。",
    "测试使用隔离数据，不读取真实凭据，也不调用 SAP、Feishu 或模型服务。",
    "详细断言、截图 SHA256、成果文件 SHA256 和生命周期事件见 uat-report.json。",
    ""
  ].join("\n"), "utf8");

  process.stdout.write(`phase43-desktop-release-uat=ok\n`);
  process.stdout.write(`phase43-uat-evidence=${outputRoot}\n`);
} finally {
  if (electronStdout) {
    try { await writeFile(path.join(outputRoot, "electron-stdout.log"), electronStdout, "utf8"); } catch { /* best-effort diagnostics */ }
  }
  if (electronStderr) {
    try { await writeFile(path.join(outputRoot, "electron-stderr.log"), electronStderr, "utf8"); } catch { /* best-effort diagnostics */ }
  }
  if (pageSession) {
    try { pageSession.close(); } catch { /* already closed */ }
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
