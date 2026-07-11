import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase37-case-actions-permission-ui";

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readSource(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const [appSource, styles, productSpec, technicalSpec, preflight] = await Promise.all([
  readSource("apps/desktop/src/renderer/App.tsx"),
  readSource("apps/desktop/src/renderer/styles.css"),
  readSource("docs/product-prototype/PRODUCT_DEVELOPMENT_SPEC.md"),
  readSource("docs/product-prototype/TECHNICAL_IMPLEMENTATION.md"),
  readSource("scripts/security-preflight.ps1")
]);

for (const [name, marker, source] of [
  ["case action label", "成果动作", appSource],
  ["case action selector", "case-action-control", appSource],
  ["case action run button", "case-action-run-button", appSource],
  ["permission mode selector", "permission-mode-control", appSource],
  ["execution preference label", "执行偏好", appSource],
  ["approval preference", "每步确认", appSource],
  ["automatic low-risk preference", "低风险自动", appSource],
  ["automatic preference", "尽量自动", appSource],
  ["read source action", "梳理资料", appSource],
  ["note action", "沉淀笔记", appSource],
  ["development spec action", "生成开发说明书", appSource],
  ["diagram action", "画流程图", appSource],
  ["candidate knowledge action", "整理候选知识", appSource],
  ["handoff action", "整理交付物", appSource],
  ["confirmation panel", "action-confirmation-preview", appSource],
  ["case action selector style", ".case-action-control", styles],
  ["case action run style", ".case-action-run-button", styles],
  ["permission selector style", ".permission-mode-control", styles],
  ["confirmation panel style", ".action-confirmation-preview", styles],
  ["product spec case action", "案件动作选项包括", productSpec],
  ["technical spec permission boundary", "执行偏好", technicalSpec],
  ["preflight marker", PROBE_MARKER, preflight],
  ["probe self marker", PROBE_MARKER, await readSource("scripts/phase37-case-actions-permission-ui-probe.mjs")]
]) {
  assert(source.includes(marker), `missing ${name}: ${marker}`);
}
pass("phase37Markers");

const workComposerRegion = appSource.match(/<form className="composer"[\s\S]*?<\/form>/)?.[0] ?? "";
assert(workComposerRegion.includes("case-action-control"), "work composer must render the on-demand case action selector");
assert(workComposerRegion.includes("case-action-run-button"), "work composer must render the case action command");
assert(workComposerRegion.includes("permission-mode-control"), "work composer must render the execution preference inside the action panel");
assert(workComposerRegion.includes("workComposerPlaceholder"), "work composer must keep free conversation as the default");
assert(!workComposerRegion.includes('aria-label="任务模式"'), "work composer must not render the old task mode tablist");
assert(!workComposerRegion.includes("setSelectedTaskMode"), "work composer must not ask the user to select taskMode before chatting");
assert(!/问题分析[\s\S]{0,120}ABAP开发[\s\S]{0,120}文档生成/.test(workComposerRegion), "old task mode labels must not remain as composer tabs");
pass("workComposerUsesCaseActions");

const chatBranch = appSource.match(/daily-chat-panel[\s\S]*?<\/section>/)?.[0] ?? "";
assert(chatBranch.includes("daily-chat-composer"), "daily chat composer region missing");
assert(!chatBranch.includes("case-action-control"), "daily chat must not show case actions");
assert(!chatBranch.includes("permission-mode-control"), "daily chat must not show project/case permission modes");
pass("dailyChatHasNoCaseActions");

pass(PROBE_MARKER);
