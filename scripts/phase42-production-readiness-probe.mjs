import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase42-production-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");

const entrySource = `
import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";
import { createWorkspaceBackup, importWorkspace } from "./apps/desktop/src/main/workspaceTransferService.ts";

const tempRoot = ${JSON.stringify(tempRoot)};
const sourceHost = path.join(tempRoot, "source-host");
const targetHost = path.join(tempRoot, "target-host");
const sourceStore = new WorkspaceStore(sourceHost);
let sourceState = await sourceStore.createLocalProject({ name: "正式发布项目", sapVersion: "S4", systemLabel: "DEV/100" });
sourceState = await sourceStore.appendMessage({
  content: "为采购订单审批异常生成开发说明书，需覆盖权限检查、异常处理、测试与回退。",
  taskMode: "problem-analysis",
  modelId: "local-workflow",
  actionId: "development-spec",
  permissionMode: "request_approval"
});
const sourceProject = sourceState.projects.find((item) => item.id === sourceState.activeProjectId);
const sourceCase = sourceProject.cases.find((item) => item.id === sourceState.activeCaseId);
const caseRoot = path.join(sourceHost, "local-data", "workbench", "projects", sourceProject.id, "cases", sourceCase.folderName);
const specification = await readFile(path.join(caseRoot, "outputs", "开发说明书.md"), "utf8");
for (const heading of ["业务背景与目标", "方案设计", "SAP 对象与接口", "测试方案", "上线与回退", "待确认事项"]) {
  assert.ok(specification.includes(heading), "开发说明书缺少章节：" + heading);
}

await sourceStore.appendMessage({
  content: "重新生成开发说明书，并保留上一版。",
  taskMode: "document-generation",
  modelId: "local-workflow",
  actionId: "development-spec",
  permissionMode: "request_approval"
});
const versions = await readdir(path.join(caseRoot, "snapshots", "versions"));
assert.ok(versions.some((name) => name.includes("开发说明书")), "重复生成没有保留开发说明书历史版本");
process.stdout.write("versionedCaseArtifacts=ok\\n");

const backup = await createWorkspaceBackup(path.join(sourceHost, "local-data", "workbench"));
assert.ok(backup.fileCount > 0);
await access(path.join(backup.backupPath, "workspace-manifest.json"));
process.stdout.write("fullBackupManifest=ok\\n");

const targetStore = new WorkspaceStore(targetHost);
await targetStore.getState();
const imported = await importWorkspace(sourceHost, path.join(targetHost, "local-data", "workbench"));
assert.equal(imported.status, "imported");
await access(path.join(imported.backupPath, "app-state.json"));
const importedState = JSON.parse(await readFile(path.join(targetHost, "local-data", "workbench", "app-state.json"), "utf8"));
assert.ok(importedState.projects.some((project) => project.name === "正式发布项目"));
process.stdout.write("controlledWorkspaceImport=ok\\n");

const futureHost = path.join(tempRoot, "future-host");
const futureRoot = path.join(futureHost, "local-data", "workbench");
await mkdir(futureRoot, { recursive: true });
await writeFile(path.join(futureRoot, "app-state.json"), JSON.stringify({ schemaVersion: 999, projects: [] }), "utf8");
await assert.rejects(() => new WorkspaceStore(futureHost).getState(), /高于当前应用支持的版本/);
await assert.rejects(() => access(path.join(futureRoot, "app.db")));
process.stdout.write("futureVersionRejectedBeforeDatabaseWrite=ok\\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: repoRoot, sourcefile: "phase42-entry.ts", loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: bundlePath,
    logLevel: "silent"
  });
  await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);

  const [caseSource, safeModelSource, knowledgeSource, mainSource, queueSource, queueProbeSource, appSource, configSource, rootPackageSource, releaseGuardSource, releaseAliasesSource] = await Promise.all([
    readFile(path.join(repoRoot, "apps/desktop/src/main/caseWorkflowService.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/safeModelCaseDraftService.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/knowledgeService.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/exclusiveWorkflowQueue.ts"), "utf8"),
    readFile(path.join(repoRoot, "scripts/phase50-agent-runtime-foundation-probe.mjs"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/renderer/ConfigCenter.tsx"), "utf8"),
    readFile(path.join(repoRoot, "package.json"), "utf8"),
    readFile(path.join(repoRoot, "scripts/assert-clean-release-tree.mjs"), "utf8"),
    readFile(path.join(repoRoot, "scripts/create-release-aliases.mjs"), "utf8")
  ]);
  assert.ok(caseSource.includes("extractMermaidDraft") && caseSource.includes("DEVELOPMENT_SPEC_HEADINGS"));
  assert.ok(safeModelSource.includes("actionOutputRequirements") && safeModelSource.includes("已阻止静默截断"));
  assert.ok(knowledgeSource.includes("assertNoPublishedKnowledgeConflict") && knowledgeSource.includes('item.status !== "published"'));
  assert.ok(knowledgeSource.includes("!isPhase21EditedCandidate(existingPending)"));
  assert.ok(mainSource.includes("caseWorkflowQueue.run") && queueSource.includes("this.tails.set(key, tail)"));
  assert.ok(queueProbeSource.includes("取消等待任务不能提前解除同会话串行锁"));
  assert.ok(appSource.includes("messageDraftsRef") && appSource.includes("canLeaveCurrentCenter"));
  assert.ok(configSource.includes("创建完整备份") && configSource.includes("导入已有工作台"));
  assert.ok(rootPackageSource.includes("assert-clean-release-tree.mjs"), "Windows 正式打包缺少干净提交门禁");
  assert.ok(releaseGuardSource.includes("git") && releaseGuardSource.includes("status") && releaseGuardSource.includes("--porcelain"));
  assert.ok(releaseGuardSource.includes(".package-win-source.json") && releaseGuardSource.includes('"rev-parse", "HEAD"'), "发布开始时必须锁定 Git commit");
  assert.ok(releaseAliasesSource.includes('path.join(releaseRoot, "win-unpacked", "SAP AI 顾问工作台.exe")'));
  assert.ok(releaseAliasesSource.includes("if (gitDirty)"), "发布追溯清单不得接受 dirty Git 构建");
  assert.ok(releaseAliasesSource.includes("sourceLock.gitCommit !== gitCommit"), "发布结束时必须核对起始 Git commit");
  process.stdout.write("phase42ProductionGuards=ok\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
