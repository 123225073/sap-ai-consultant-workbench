import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.env.SAP_AI_RUN_REAL_ADT_UAT !== "1") {
  throw new Error("真实 ADT UAT 默认关闭；仅在用户明确授权后设置 SAP_AI_RUN_REAL_ADT_UAT=1。此测试只操作 AppData 的临时副本。");
}

const repoRoot = path.resolve(process.cwd());
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const sourceUserData = path.join(process.env.APPDATA ?? "", "SAP AI 顾问工作台");
const electronCandidates = [
  path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe"),
  path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe")
];
let electronPath = null;
for (const candidate of electronCandidates) {
  try {
    await stat(candidate);
    electronPath = candidate;
    break;
  } catch {}
}
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-real-adt-uat-"));
const isolatedUserData = path.join(tempRoot, "user-data");
let child = null;
let pageSession = null;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fileHash(filePath) {
  try {
    return sha256(await readFile(filePath));
  } catch {
    return "missing";
  }
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label}超时${lastError instanceof Error ? `：${lastError.message}` : ""}`);
}

async function openCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timeout);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result ?? {});
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} 超时`));
    }, 180_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    evaluate: async (expression) => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result?.value;
    },
    close: () => socket.close()
  };
}

function sanitizedEnvironment() {
  const sensitive = /(api|auth|credential|key|password|secret|token|openai|anthropic|deepseek|gemini|aws|azure)/i;
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !sensitive.test(name) && !name.startsWith("WORKBENCH_"))),
    WORKBENCH_REPO_ROOT: isolatedUserData,
    WORKBENCH_LIFECYCLE_PROBE: "1"
  };
}

const statePath = path.join(sourceUserData, "local-data", "workbench", "app-state.json");
const databasePath = path.join(sourceUserData, "local-data", "workbench", "app.db");
const formalBefore = { state: await fileHash(statePath), database: await fileHash(databasePath) };

try {
  if (!electronPath) throw new Error("未找到 Electron 可执行文件。");
  await cp(path.join(sourceUserData, "local-data"), path.join(isolatedUserData, "local-data"), { recursive: true });
  for (const name of ["Local State", "Preferences"]) {
    try {
      await cp(path.join(sourceUserData, name), path.join(isolatedUserData, name));
    } catch {
      // Preferences may not exist on a fresh profile; Local State is checked by safeStorage at runtime.
    }
  }

  child = spawn(electronPath, [
    `--user-data-dir=${isolatedUserData}`,
    "--remote-debugging-port=0",
    "--disable-gpu",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
    "."
  ], { cwd: desktopRoot, env: sanitizedEnvironment(), stdio: "ignore", windowsHide: true });

  const activePort = await waitFor(async () => {
    try {
      const [port] = (await readFile(path.join(isolatedUserData, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
      return /^\d+$/.test(port) ? Number(port) : null;
    } catch {
      return null;
    }
  }, 20_000, "Electron 调试端口");
  const page = await waitFor(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${activePort}/json`)).json();
      return targets.find((item) => item.type === "page" && !item.url.startsWith("devtools:")) ?? null;
    } catch {
      return null;
    }
  }, 20_000, "Electron 页面");
  pageSession = await openCdp(page.webSocketDebuggerUrl);
  await pageSession.send("Runtime.enable");
  await waitFor(() => pageSession.evaluate("Boolean(window.workbench?.getState)"), 20_000, "工作台 IPC");

  const result = JSON.parse(await pageSession.evaluate(`(async () => {
    const initial = await window.workbench.getState();
    if (!initial.ok) throw new Error('state-unavailable');
    const project = initial.data.projects.find((candidate) => {
      const connections = candidate.config.adtConnections?.length ? candidate.config.adtConnections : [candidate.config.adt];
      const hasSap = connections.some((item) => item?.connectionStatus === 'verified' && item?.minimalReadStatus === 'verified' && item?.lastVerificationMode === 'adt');
      const hasModel = candidate.config.apiProviders.some((item) => item.enabled && item.chatTestStatus === 'verified' && item.lastVerificationMode === 'http' && item.lastVerifiedModelId);
      return hasSap && hasModel && candidate.cases.length > 0;
    });
    if (!project) throw new Error('no-verified-project');
    const workProject = project.cases.find((item) => initial.data.workThreads.some((thread) => thread.caseId === item.id && thread.status !== 'removed'));
    const thread = initial.data.workThreads.find((item) => item.caseId === workProject?.id && item.status !== 'removed');
    const verifiedConnections = (project.config.adtConnections?.length ? project.config.adtConnections : [project.config.adt]).filter((item) => item?.connectionStatus === 'verified' && item?.minimalReadStatus === 'verified' && item?.lastVerificationMode === 'adt');
    const connection = verifiedConnections.find((item) => item.client === '800' && item.environment === 'production') ?? verifiedConnections[0];
    const readyProviders = project.config.apiProviders.filter((item) => item.enabled && item.chatTestStatus === 'verified' && item.lastVerificationMode === 'http' && item.lastVerifiedModelId);
    const provider = readyProviders.find((item) => item.verifiedModelIds?.includes('gpt-5.6-sol')) ?? readyProviders[0];
    const testModelId = provider?.verifiedModelIds?.includes('gpt-5.6-sol') ? 'gpt-5.6-sol' : provider?.lastVerifiedModelId;
    if (!workProject || !thread || !provider || !connection) throw new Error('no-verified-target');
    const config = structuredClone(project.config);
    config.agentTools.sapReadonlyEnabled = true;
    config.agentTools.sapDataPreviewEnabled = true;
    const saved = await window.workbench.saveProjectConfig(project.id, config);
    if (!saved.ok) throw new Error('tool-enable-failed');
    if (!(await window.workbench.switchProject({ projectId: project.id })).ok) throw new Error('project-switch-failed');
    if (!(await window.workbench.switchCase({ projectId: project.id, caseId: workProject.id })).ok) throw new Error('case-switch-failed');
    if (!(await window.workbench.switchWorkThread({ threadId: thread.id })).ok) throw new Error('thread-switch-failed');
    const response = await window.workbench.appendMessageStreaming({
      projectId: project.id,
      caseId: workProject.id,
      threadId: thread.id,
      content: '连接 ' + connection.systemId + ' Client ' + connection.client + '，只读查询 C050 工厂库存；请先搜索合适数据源、发现字段，再只读取最多 1 行验证链路，禁止写入 SAP，回复不要展示业务字段值。',
      taskMode: 'problem-analysis',
      modelId: testModelId,
      providerId: provider.id,
      actionId: null,
      permissionMode: 'request_approval',
      codexAssistEnabled: false
    }, () => undefined);
    const snapshotResponse = await window.workbench.readAgentThread({ scope: 'work', legacyThreadId: thread.id, limit: 200 });
    const snapshot = snapshotResponse.ok ? snapshotResponse.data : null;
    const lastTurnId = snapshot?.items.at(-1)?.turnId;
    const items = snapshot?.items.filter((item) => item.turnId === lastTurnId) ?? [];
    const toolResults = items.filter((item) => item.type === 'tool-result').map((item) => ({
      tool: String(item.payload.toolName ?? '').replace(/_[a-f0-9]{10}$/, ''),
      ok: item.payload.isError === false,
      failure: (() => {
        if (item.payload.isError === false) return null;
        const value = String(item.payload.content ?? '');
        return {
          httpStatus: value.match(/HTTP\\s+(\\d{3})/i)?.[1] ?? null,
          password: /密码|安全存储/.test(value),
          routing: /明确 SID|错误 SAP 系统|建议的 SAP 连接/.test(value),
          verification: /未完成真实 ADT|尚未完成 ADT/.test(value),
          authorization: /尚未获得|未启用/.test(value),
          certificate: /证书|certificate/i.test(value),
          timeout: /超时|timeout/i.test(value),
          notFound: /404|不存在|not found/i.test(value)
        };
      })()
    }));
    const responseThread = response.ok ? response.data.workThreads.find((item) => item.id === thread.id) : null;
    const assistant = [...(responseThread?.messages ?? [])].reverse().find((item) => item.role === 'assistant');
    const savedProject = saved.data.projects.find((item) => item.id === project.id);
    const savedProvider = savedProject?.config.apiProviders.find((item) => item.id === provider.id);
    return JSON.stringify({
      responseOk: response.ok,
      turnStatus: snapshot?.activeTurn?.status ?? (items.some((item) => item.type === 'assistant-message') ? 'completed' : 'unknown'),
      toolResults,
      assistantCompleted: items.some((item) => item.type === 'assistant-message'),
      itemTypeCounts: Object.fromEntries([...new Set(items.map((item) => item.type))].map((type) => [type, items.filter((item) => item.type === type).length])),
      toolsEnabledAfterSave: savedProject?.config.agentTools.sapReadonlyEnabled === true && savedProject?.config.agentTools.sapDataPreviewEnabled === true,
      providerReadyAfterSave: savedProvider?.chatTestStatus === 'verified' && savedProvider?.lastVerificationMode === 'http',
      assistantWasLocalWorkflow: assistant?.modelId === 'local-workflow',
      assistantFailureFlags: {
        authorization: /尚未启用|尚未获得.*授权/.test(assistant?.content ?? ''),
        connection: /连接失败|无法连接|连接不可用/.test(assistant?.content ?? ''),
        provider: /模型草稿未生成|模型调用失败/.test(assistant?.content ?? ''),
        tool: /工具(?:调用|执行)?失败/.test(assistant?.content ?? ''),
        failed: /失败原因/.test(assistant?.content ?? '')
      },
      tempOnly: true
    });
  })()`));

  process.stderr.write(`phase64-real-adt-uat-safe-status=${JSON.stringify(result)}\n`);
  if (!result.responseOk || result.turnStatus !== "completed" || !result.assistantCompleted || result.assistantWasLocalWorkflow || Object.values(result.assistantFailureFlags).some(Boolean) || result.toolResults.length < 3) {
    throw new Error("真实 ADT UAT 未完成三阶段工具执行与真实模型最终回复闭环。");
  }
  const firstDataIndex = result.toolResults.findIndex((item) => item.tool.startsWith("sap_read_data_preview"));
  const searchResults = firstDataIndex > 0 ? result.toolResults.slice(0, firstDataIndex) : [];
  const dataResults = firstDataIndex > 0 ? result.toolResults.slice(firstDataIndex) : [];
  if (searchResults.length < 1 || searchResults.length > 3 || !searchResults.every((item) => item.tool.startsWith("sap_search_objects"))) {
    throw new Error("真实 ADT UAT 工具序列或结果状态不符合预期。");
  }
  if (dataResults.length !== 2 || !dataResults.every((item) => item.tool.startsWith("sap_read_data_preview") && item.ok)) {
    throw new Error("真实 ADT UAT 未完成两阶段数据读取。");
  }
  const formalAfter = { state: await fileHash(statePath), database: await fileHash(databasePath) };
  if (formalBefore.state !== formalAfter.state || formalBefore.database !== formalAfter.database) {
    throw new Error("正式 AppData 在隔离 UAT 期间发生变化，已拒绝生成通过记录。");
  }
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    executedAt: new Date().toISOString(),
    sourceBaseline: "a0f40fa8b5d4c987979020e3e0f2ddd27deb24bf",
    scriptSha256: sha256(await readFile(new URL(import.meta.url))),
    distMainSha256: await fileHash(path.join(desktopRoot, "dist", "main", "main.cjs")),
    toolSequence: result.toolResults,
    repositorySearchMode: searchResults.every((item) => item.ok) ? "direct-success" : "controlled-fallback",
    assistantCompleted: true,
    isolatedCopy: true,
    formalStateUnchanged: true,
    sensitiveIdentifiersPersisted: false,
    tempCleanupPlanned: true
  }) + "\n");
} finally {
  try { await pageSession?.send("Browser.close"); } catch {}
  pageSession?.close();
  if (child && child.exitCode === null) child.kill();
  await rm(tempRoot, { recursive: true, force: true });
}
