import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.cwd());
const read = (file) => readFile(path.join(root, file), "utf8");
const [types, storeSource, app, styles, tools, agentTools, context] = await Promise.all([
  read("apps/desktop/src/shared/workbenchTypes.ts"),
  read("apps/desktop/src/main/workspaceStore.ts"),
  read("apps/desktop/src/renderer/App.tsx"),
  read("apps/desktop/src/renderer/styles.css"),
  read("apps/desktop/src/main/builtinReadonlyTools.ts"),
  read("apps/desktop/src/main/agentToolService.ts"),
  read("CONTEXT.md")
]);

assert.match(types, /isPlaceholder\?: boolean/, "Case 缺少兼容用内部占位标记");
assert.match(storeSource, /hasThreadContent[\s\S]+hasCaseContent[\s\S]+未归类工作/, "旧收件箱迁移没有同时保护历史对话和案件内容");
assert.match(app, />客户项目</, "侧栏没有客户项目层");
assert.match(app, /新建运维项目/, "界面没有独立的运维项目入口");
assert.match(app, /work-project-add-thread[\s\S]+新建对话线程/, "运维项目下没有直接新建对话入口");
assert.match(styles, /\.work-project-tree[\s\S]+\.work-project-group[\s\S]+\.work-project-threads/, "三级侧栏缺少清晰的视觉层次");
assert.match(tools, /case\.list_threads[\s\S]+case\.read_thread_context/, "兄弟线程只读工具未注册");
assert.match(agentTools, /item\.projectId === projectId && item\.caseId === caseId/, "兄弟线程读取没有同时限制客户项目和运维项目");
assert.match(context, /客户项目 \/ Customer Project[\s\S]+运维项目 \/ Work Project[\s\S]+对话线程 \/ Conversation Thread/, "领域上下文没有固定三级词汇");

const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase62-hierarchy-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
let state = await store.createLocalProject({ name: "A 公司", sapVersion: "S4", systemLabel: "SAP Landscape" });
const projectAId = state.activeProjectId;
let projectA = state.projects.find((item) => item.id === projectAId);
check(projectA.cases.length === 1 && projectA.cases[0].isPlaceholder === true, "新客户项目不应创建可见收件箱业务对象");

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
