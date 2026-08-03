import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.cwd());
const read = (file) => readFile(path.join(root, file), "utf8");
const [types, storeSource, app, configCenter, styles, tools, agentTools, context] = await Promise.all([
  read("apps/desktop/src/shared/workbenchTypes.ts"),
  read("apps/desktop/src/main/workspaceStore.ts"),
  read("apps/desktop/src/renderer/App.tsx"),
  read("apps/desktop/src/renderer/ConfigCenter.tsx"),
  read("apps/desktop/src/renderer/styles.css"),
  read("apps/desktop/src/main/builtinReadonlyTools.ts"),
  read("apps/desktop/src/main/agentToolService.ts"),
  read("CONTEXT.md")
]);

assert.match(types, /isPlaceholder\?: boolean/, "Case 缺少兼容用内部占位标记");
assert.match(storeSource, /hasThreadContent[\s\S]+hasCaseContent[\s\S]+未归类工作/, "旧收件箱迁移没有同时保护历史对话和案件内容");
assert.match(storeSource, /legacyInboxLabel[\s\S]+收件箱[\s\S]+isLegacyInbox/, "旧收件箱迁移仍只识别固定 ID");
assert.match(app, />客户项目</, "侧栏没有客户项目层");
assert.match(app, /新建运维项目/, "界面没有独立的运维项目入口");
assert.match(app, /work-project-add-thread[\s\S]+新建对话线程/, "运维项目下没有直接新建对话入口");
assert.match(styles, /\.work-project-tree[\s\S]+\.work-project-group[\s\S]+\.work-project-threads/, "三级侧栏缺少清晰的视觉层次");
assert.match(configCenter, /当前客户项目：\{project\.name\}/, "配置中心没有明确标注动态客户项目名称");
assert.doesNotMatch(configCenter, /纯米|chunmi/i, "配置中心源码包含特定公司名称");
assert.match(tools, /case\.list_threads[\s\S]+case\.read_thread_context/, "兄弟线程只读工具未注册");
assert.match(agentTools, /item\.projectId === projectId && item\.caseId === caseId/, "兄弟线程读取没有同时限制客户项目和运维项目");
assert.match(context, /客户项目 \/ Customer Project[\s\S]+运维项目 \/ Work Project[\s\S]+对话线程 \/ Conversation Thread/, "领域上下文没有固定三级词汇");

const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase62-hierarchy-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
import { readFile as readProbeFile, writeFile as writeProbeFile } from "node:fs/promises";
import path from "node:path";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
let state = await store.createLocalProject({ name: "A 公司", sapVersion: "S4", systemLabel: "SAP Landscape" });
const projectAId = state.activeProjectId;
let projectA = state.projects.find((item) => item.id === projectAId);
check(projectA.cases.length === 1 && projectA.cases[0].isPlaceholder === true, "新客户项目不应创建可见收件箱业务对象");
check(!state.workThreads.some((item) => item.projectId === projectAId && /^(收件箱|inbox)$/i.test(item.title)), "新客户项目不应创建名为收件箱的对话");
state = await store.getState();
check(state.workThreads.some((item) => item.projectId === projectAId && item.caseId === projectA.cases[0].id), "内部兼容线程在重新加载后丢失");

const configA = structuredClone(projectA.config);
configA.adt.alias = "DS4 开发系统";
configA.adt.systemId = "DS4";
configA.adt.url = "https://sap.example.com";
configA.adt.client = "220";
configA.adt.username = "DEMO_USER";
configA.adtConnections = [{ ...configA.adt }];
configA.apiProviders[0].name = "公司模型";
configA.apiProviders[0].baseUrl = "https://api.example.com/v1";
configA.feishu.appId = "cli_demo_app";
state = await store.saveProjectConfig(projectAId, configA);

state = await store.createWorkThread({ projectId: projectAId, title: "新对话", folderMode: "new", folderName: "库龄分析报表开发" });
const firstThread = state.workThreads.find((item) => item.projectId === projectAId && item.title === "新对话" && item.caseId !== "inbox");
const workProjectId = firstThread.caseId;
projectA = state.projects.find((item) => item.id === projectAId);
check(projectA.cases.find((item) => item.id === workProjectId)?.title === "库龄分析报表开发", "运维项目没有独立文件夹对象");
const caseCount = projectA.cases.length;

state = await store.createWorkThread({ projectId: projectAId, caseId: workProjectId, title: "新对话", folderMode: "existing" });
projectA = state.projects.find((item) => item.id === projectAId);
check(projectA.cases.length === caseCount, "在运维项目下新建线程时重复创建了文件夹");
const secondThread = state.workThreads.find((item) => item.id === state.activeWorkThreadId);
await store.appendMessage({ projectId: projectAId, caseId: workProjectId, threadId: secondThread.id, content: "编写库龄分析报表的测试验证报告", taskMode: "problem-analysis", modelId: "local-workflow", actionId: null, permissionMode: "request_approval" });
state = await store.getState();
check(state.workThreads.find((item) => item.id === secondThread.id)?.title === "编写库龄分析报表的测试验证报告", "首条消息没有自动生成线程标题");

state = await store.createLocalProject({ name: "B 公司", sapVersion: "S4", systemLabel: "SAP Landscape" });
const projectB = state.projects.find((item) => item.id === state.activeProjectId);
check(projectB.config.apiProviders[0].name === "公司模型", "AI 模型配置没有在客户项目间共用");
check(projectB.config.feishu.appId === "cli_demo_app", "Feishu 配置没有在客户项目间共用");
check(projectB.config.adt.systemId === "", "SAP ADT 配置错误地跨客户项目继承");

const statePath = path.join(${JSON.stringify(isolatedRepoRoot)}, "local-data", "workbench", "app-state.json");
const persisted = JSON.parse(await readProbeFile(statePath, "utf8"));
const persistedProjectB = persisted.projects.find((item) => item.id === projectB.id);
const legacyCase = persistedProjectB.cases[0];
legacyCase.id = "case-legacy-inbox";
legacyCase.caseDir = "case-legacy-inbox";
legacyCase.folderName = "case-legacy-inbox";
legacyCase.title = "收件箱";
legacyCase.isPlaceholder = false;
persisted.workThreads.unshift({
  id: "work-legacy-inbox",
  projectId: projectB.id,
  caseId: legacyCase.id,
  title: "收件箱",
  status: "active",
  createdAt: legacyCase.createdAt,
  updatedAt: legacyCase.updatedAt,
  lastOpenedAt: legacyCase.lastOpenedAt,
  archivedAt: null,
  removedAt: null,
  messages: []
});
persisted.activeProjectId = projectB.id;
persisted.activeCaseId = legacyCase.id;
persisted.activeWorkThreadId = "work-legacy-inbox";
await writeProbeFile(statePath, JSON.stringify(persisted, null, 2), "utf8");
const migratedState = await new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)}).getState();
const migratedProject = migratedState.projects.find((item) => item.id === projectB.id);
check(migratedProject.cases[0].isPlaceholder === true, "空的旧收件箱没有迁移为不可见占位对象");
check(migratedProject.cases[0].title === "项目工作区", "空的旧收件箱名称仍暴露给用户");
check(!migratedState.workThreads.some((item) => item.projectId === projectB.id && item.caseId === legacyCase.id), "空的旧收件箱对话仍被保留");

process.stdout.write("phase62-customer-work-project-thread-runtime=ok\\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: root, sourcefile: "phase62-probe-entry.ts", loader: "ts" },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("phase62-customer-work-project-thread-hierarchy-probe=ok");
