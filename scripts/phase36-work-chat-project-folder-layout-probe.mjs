import { build } from "esbuild";
import { mkdtemp, readFile, rm as removeTree } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase36-work-chat-project-folder-layout-probe";

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readSource(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const [appSource, styles, sharedTypes, workspaceStore, productSpec, technicalSpec, preflight] = await Promise.all([
  readSource("apps/desktop/src/renderer/App.tsx"),
  readSource("apps/desktop/src/renderer/styles.css"),
  readSource("apps/desktop/src/shared/workbenchTypes.ts"),
  readSource("apps/desktop/src/main/workspaceStore.ts"),
  readSource("docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md"),
  readSource("docs/product-prototype/TECHNICAL_IMPLEMENTATION.md"),
  readSource("scripts/security-preflight.ps1")
]);

for (const [name, marker, source] of [
  ["work chat switch", "workspace-switch", appSource],
  ["files only right panel", "phase40-files-only-context", appSource],
  ["customer project label", "客户项目", appSource],
  ["operations project label", "运维项目", appSource],
  ["other work label", "其他工作", appSource],
  ["single folder creation action", "focusNewCaseInput", appSource],
  ["direct config center", 'navigateView("config")', appSource],
  ["phase marker", "phase36-work-chat-project-folder-layout", appSource],
  ["workspace switch style", ".workspace-switch", styles],
  ["right panel style", ".files-panel", styles],
  ["other work boundary style", ".other-work-boundary", styles],
  ["unknown project type", "sapVersion: ProjectSummary[\"sapVersion\"]", sharedTypes],
  ["unknown lifecycle", 'value === "S4" || value === "ECC" || value === "UNKNOWN"', workspaceStore],
  ["product spec work chat", "Work / Chat 分区", productSpec],
  ["technical spec mapping", "产品概念到当前实现的映射", technicalSpec],
  ["preflight marker", PROBE_MARKER, preflight],
  ["probe self marker", PROBE_MARKER, await readSource("scripts/phase36-work-chat-project-folder-layout-probe.mjs")]
]) {
  assert(source.includes(marker), `missing ${name}: ${marker}`);
}
pass("phase36Markers");

const chatSendRegion = appSource.match(/if \(activeView === "chat"\)[\s\S]*?return;/)?.[0] ?? "";
assert(chatSendRegion.includes("appendDailyChatMessage"), "daily chat send region missing");
assert(chatSendRegion.includes("projectId:") && chatSendRegion.includes("providerId:"), "chat should explicitly pass the selected Project-owned model channel provenance");
assert(!chatSendRegion.includes("caseId:"), "chat must not bind or read a case");
assert(!/activeView === "chat"[\s\S]{0,900}new-case-project-picker/.test(appSource), "chat view must not render folder picker in its branch");
assert(!appSource.includes('className="project-config-preview"'), "Work right panel must not mix in low-frequency project configuration");
pass("chatHasNoFolderBinding");

const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase36-work-chat-"));
const bundlePath = path.join(tempRoot, "probe-entry.mjs");
const isolatedRepoRoot = path.join(tempRoot, "isolated-repo");
const entrySource = `
import { WorkspaceStore } from "./apps/desktop/src/main/workspaceStore.ts";

function pass(name) {
  process.stdout.write(name + "=ok\\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new WorkspaceStore(${JSON.stringify(isolatedRepoRoot)});
const otherState = await store.createLocalProject({ name: "Phase36 其他工作", sapVersion: "UNKNOWN", systemLabel: "LOCAL" });
const otherProject = otherState.projects.find((item) => item.name === "Phase36 其他工作");
assert(otherProject, "other work project missing");
assert(otherProject.sapVersion === "UNKNOWN", "other work project must keep UNKNOWN sapVersion");
const caseState = await store.createLocalCase({ projectId: otherProject.id, title: "Phase36 本地工作文件夹" });
const updatedProject = caseState.projects.find((item) => item.id === otherProject.id);
assert(updatedProject?.cases.some((item) => item.title === "Phase36 本地工作文件夹"), "other work folder was not created under UNKNOWN project");
assert(caseState.activeProjectId === otherProject.id, "created other work folder should activate its parent project");
pass("runtimeOtherWorkFolderUsable");
`;

try {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: repoRoot,
      sourcefile: "phase36-probe-entry.ts",
      loader: "ts"
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    logLevel: "silent"
  });
  await import(pathToFileURL(bundlePath).href);
} finally {
  await removeTree(tempRoot, { recursive: true, force: true });
}

pass(PROBE_MARKER);
