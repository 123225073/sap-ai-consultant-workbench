import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configSource = await readFile("apps/desktop/src/renderer/ConfigCenter.tsx", "utf8");
const appSource = await readFile("apps/desktop/src/renderer/App.tsx", "utf8");
const mainSource = await readFile("apps/desktop/src/main/main.ts", "utf8");
const styleSource = await readFile("apps/desktop/src/renderer/styles.css", "utf8");

for (const marker of [
  'type ConfigTabId = "sap" | "models" | "feishu" | "capabilities" | "storage"',
  'className="config-tabs phase27-compact-status-summary"',
  'hidden={activeConfigTab !== "sap"}',
  'hidden={activeConfigTab !== "models"}',
  'hidden={activeConfigTab !== "feishu"}',
  'hidden={activeConfigTab !== "capabilities"}',
  'hidden={activeConfigTab !== "storage"}',
  'className="core-setup-grid single config-tab-stack"'
]) {
  assert.ok(configSource.includes(marker), `配置中心缺少单页签纵向布局标记: ${marker}`);
}
assert.ok(styleSource.includes(".config-tabs"), "配置中心缺少页签样式");
assert.ok(styleSource.includes(".config-tab-stack"), "配置中心缺少纵向面板样式");
assert.ok(configSource.includes('role="tabpanel"') && configSource.includes('aria-controls="config-panel-models"'), "配置页签缺少 tabpanel 关联");
assert.ok(configSource.includes("handleConfigTabKeyDown") && configSource.includes('event.key === "ArrowRight"'), "配置页签缺少键盘方向键切换");
console.log("singleTabVerticalConfiguration=ok");

for (const marker of [
  "adtConnections",
  "activeAdtConnectionId",
  "addAdtConnection",
  "removeAdtConnection",
  "确认移除",
  'connectionId: adtConnection.id',
  "adt-connection-list"
]) {
  assert.ok(configSource.includes(marker), `多 SAP 纵向配置缺少标记: ${marker}`);
}
console.log("multipleSapConnectionsVerticalAndIsolated=ok");
assert.ok(configSource.includes("已保存的加密密码会一并清理") && mainSource.includes("removeProjectTarget"), "移除 SAP 连接后缺少受控的加密密码清理");
assert.ok(!configSource.includes('className="model-channel-list" role="tablist"'), "内部连接选择器不应伪装成缺少键盘行为的页签");
assert.ok(configSource.includes('role="group" aria-label="SAP 连接"') && configSource.includes('aria-pressed={connection.id === adtConnection.id}'), "SAP 连接选择器缺少清晰的选择语义");
console.log("connectionSelectorsAccessible=ok");

for (const marker of [
  'value="anthropic-compatible"',
  'provider.catalogMode ?? "remote-with-manual-fallback"',
  'provider.manualModelIds ?? []',
  'provider.testModelId ?? ""',
  "测试渠道"
]) {
  assert.ok(configSource.includes(marker), `模型渠道缺少用户反馈标记: ${marker}`);
}
console.log("selectableModelProtocolAndProbe=ok");

for (const marker of [
  "本机 AI 增强能力",
  "核心 AI",
  "不依赖 Codex",
  "验证 Codex 工程增强",
  "onScanLocalAi",
  "onInstallLocalAi"
]) {
  assert.ok(configSource.includes(marker), `Codex 可选增强缺少标记: ${marker}`);
}
console.log("optionalCodexCapability=ok");

assert.ok(appSource.includes("function sapSidebarStatus"), "左侧项目缺少 SAP 验证状态");
assert.ok(appSource.includes('label: "SAP 未验证"'), "左侧项目缺少 SAP 未验证文案");
assert.ok(!appSource.includes('className="case-context-strip"'), "输入区不应重复显示 SAP 配置状态");
assert.ok(appSource.includes('placeholder="搜索项目或文件"'), "左侧搜索文案没有保持精简");
console.log("workStatusAndComposerDeclutter=ok");

console.log("phase41-product-feedback-ui-probe=ok");
