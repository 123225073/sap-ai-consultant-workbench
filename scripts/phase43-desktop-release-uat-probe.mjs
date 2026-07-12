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
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result ?? {});
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
  await pageSession.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
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

  first = spawn(electronPath, [`--user-data-dir=${userDataDir}`, "--remote-debugging-port=0", "."], {
    cwd: desktopRoot,
    env: sanitizedEnvironment(),
    stdio: "ignore",
    windowsHide: true
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
    document.querySelector('[aria-label="新建 Project"]').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    __phase43.setValue(document.querySelector('[aria-label="项目名称"]'), 'Phase43 正式 UAT');
    __phase43.setValue(document.querySelector('[aria-label="项目类型"]'), 'S4');
    __phase43.setValue(document.querySelector('[aria-label="系统或本地标签"]'), 'UAT/100');
    document.querySelector('form[aria-label="新建 Project"]').requestSubmit();
    await __phase43.until(async () => (await window.workbench.getState()).data.projects.some((item) => item.name === 'Phase43 正式 UAT'));
    __phase43.clickText('新文件夹');
    await new Promise((resolve) => setTimeout(resolve, 50));
    __phase43.setValue(document.querySelector('[aria-label="工作文件夹名称"]'), 'UAT 核心旅程');
    document.querySelector('.case-create').requestSubmit();
    await __phase43.until(async () => {
      const response = await window.workbench.getState();
      const project = response.data.projects.find((item) => item.name === 'Phase43 正式 UAT');
      return project?.cases.some((item) => item.title === 'UAT 核心旅程');
    });
    return true;
  })()`);
  await capture("work-case-created");

  await pageSession.evaluate(`(async () => {
    __phase43.setValue(document.querySelector('[aria-label="继续追问"]'), '请记录本次 UAT：验证本地案件对话不依赖 SAP 连接。');
    document.querySelector('.composer').requestSubmit();
    await __phase43.until(async () => {
      const state = (await window.workbench.getState()).data;
      const project = state.projects.find((item) => item.name === 'Phase43 正式 UAT');
      const currentCase = project?.cases.find((item) => item.title === 'UAT 核心旅程');
      return (currentCase?.messages.length ?? 0) >= 2;
    });
    return true;
  })()`);

  await pageSession.evaluate(`(async () => {
    [...document.querySelectorAll('.workspace-switch button')].find((item) => item.textContent.includes('Chat')).click();
    await __phase43.until(() => Boolean(document.querySelector('[aria-label="日常对话输入"]')));
    __phase43.setValue(document.querySelector('[aria-label="日常对话输入"]'), 'Phase43 日常对话隔离验证');
    document.querySelector('.daily-chat-composer').requestSubmit();
    await __phase43.until(() => document.body.innerText.includes('Phase43 日常对话隔离验证'));
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
      __phase43.clickText('开始生成');
      await __phase43.until(async () => {
        const response = await window.workbench.previewCurrentCaseFile({ relativePath: ${JSON.stringify(expectedPath)} });
        return response.ok && response.data.content.length > 100;
      });
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
  const flowResult = await evaluateJson(`await (async () => {
    const response = await window.workbench.previewCurrentCaseFile({ relativePath: 'outputs/逻辑说明图.mmd' });
    return { ok: response.ok, content: response.ok ? response.data.content : response.error };
  })()`);
  assert(flowResult.ok && /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)/i.test(flowResult.content.trim()), "流程图生成有效 Mermaid flowchart 源码");
  assert(!/(click|href|https?:|javascript:|<script)/i.test(flowResult.content), "Mermaid 流程图不包含脚本或外部链接");
  await capture("work-mermaid-flow");

  await pageSession.evaluate(`(async () => {
    __phase43.clickText('配置中心');
    await __phase43.until(() => document.querySelectorAll('.config-tabs [role="tab"]').length === 5);
    return true;
  })()`);
  const configTabs = await evaluateJson(`[...document.querySelectorAll('.config-tabs [role="tab"]')].map((tab) => ({ id: tab.id, text: __phase43.normalize(tab.textContent) }))`);
  assert(configTabs.length === 5, "配置中心显示五个专业页签");
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
    __phase43.clickText('规范中心');
    await __phase43.until(() => Boolean(document.querySelector('.standards-editor textarea')));
    const textarea = document.querySelector('.standards-editor textarea');
    __phase43.setValue(textarea, textarea.value + '\\nPhase43 UAT：交付前必须核对只读边界。');
    __phase43.clickText('保存当前项目版本');
    await __phase43.until(() => document.body.innerText.includes('当前项目规范已保存'));
    return true;
  })()`);
  const standardsState = await evaluateJson(`({
    heading: document.querySelector('.standards-main h1')?.textContent,
    categoryCount: document.querySelectorAll('.standards-category-list button').length,
    hasDiff: Boolean(document.querySelector('.standards-toolbar')?.textContent.includes('差异'))
  })`);
  assert(standardsState.heading === "规范中心" && standardsState.categoryCount >= 8 && standardsState.hasDiff, "规范中心可编辑、保存并展示差异");
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

  const persisted = await evaluateJson(`await (async () => {
    const response = await window.workbench.getState();
    const project = response.data.projects.find((item) => item.name === 'Phase43 正式 UAT');
    const caseItem = project?.cases.find((item) => item.title === 'UAT 核心旅程');
    const flattenPaths = (nodes) => nodes.flatMap((item) => [item.relativePath, ...flattenPaths(item.children ?? [])]);
    return {
      ok: response.ok,
      projectId: project?.id,
      caseId: caseItem?.id,
      messageCount: caseItem?.messages.length ?? 0,
      knowledgePublished: project?.knowledge.items.some((item) => item.title === 'Phase43 只读交付知识' && item.status === 'published'),
      standardsVersion: project?.standards.version ?? 0,
      files: flattenPaths(response.data.activeCaseFiles)
    };
  })()`);
  assert(persisted.ok && persisted.messageCount >= 6, "Work 对话和成果动作已持久化到隔离案件");
  assert(persisted.knowledgePublished && persisted.standardsVersion >= 2, "规范与知识状态已持久化到隔离 Project");
  assert(persisted.files.includes("outputs/开发说明书.md") && persisted.files.includes("outputs/逻辑说明图.mmd"), "右侧文件树包含开发说明书和 Mermaid 流程图");

  const lifecyclePath = path.join(userDataDir, "logs", `lifecycle-${new Date().toISOString().slice(0, 10)}.log`);

  const browserSession = await openCdp(`ws://127.0.0.1:${activePort.port}${activePort.browserPath}`);
  browserSession.fire("Browser.close");
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
