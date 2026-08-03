import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");
const [types, store, tools, configCenter, main] = await Promise.all([
  read("apps/desktop/src/shared/workbenchTypes.ts"),
  read("apps/desktop/src/main/workspaceStore.ts"),
  read("apps/desktop/src/main/agentToolService.ts"),
  read("apps/desktop/src/renderer/ConfigCenter.tsx"),
  read("apps/desktop/src/main/main.ts")
]);

assert.match(types, /interface AgentToolPreferences[\s\S]+caseContextEnabled[\s\S]+importedEvidenceEnabled[\s\S]+publishedKnowledgeEnabled[\s\S]+sapReadonlyEnabled[\s\S]+sapDataPreviewEnabled/);
assert.match(types, /agentTools:\s*AgentToolPreferences/);
assert.match(store, /caseContextEnabled:\s*false[\s\S]+sapReadonlyEnabled:\s*false/, "新 Project 的 AI 功能必须默认关闭");
assert.match(tools, /sap\.read_object_evidence/, "ADT 只读对象证据必须进入模型工具目录");
assert.match(tools, /agentTools\.sapReadonlyEnabled/, "SAP 模型工具必须受用户授权开关控制");
assert.match(tools, /agentTools\.sapDataPreviewEnabled/, "SAP ADT 通用数据工具必须受独立用户授权开关控制");
assert.match(tools, /sap\.read_data_preview/, "通用 SAP ADT 数据读取必须进入模型工具目录");
assert.match(tools, /agentTools\.caseContextEnabled/, "本地安全上下文工具必须受用户授权开关控制");
assert.match(main, /readSapObjectEvidence[\s\S]+target/, "模型调用 SAP 时必须固定到发起任务的 Project、Case 和线程");
assert.match(configCenter, /AI 功能授权/);
assert.match(configCenter, /连接验证不等于允许 AI 调用/);
assert.match(configCenter, /客户项目配置[\s\S]+工作台全局[\s\S]+功能授权[\s\S]+可选集成/, "配置导航应区分客户项目配置、工作台全局功能、功能授权和可选集成");

console.log("phase59-explicit-capabilities-probe=ok");
