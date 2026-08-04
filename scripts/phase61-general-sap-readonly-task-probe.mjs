import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase61-general-sap-read-"));
const bundlePath = path.join(tempRoot, "probe.mjs");
const entrySource = String.raw`
import assert from "node:assert/strict";
import { AgentToolService } from "./apps/desktop/src/main/agentToolService.ts";

const target = { threadId: "thread-1", projectId: "project-1", caseId: "case-1" };
let enabled = true;
const store = {
  async getProjectConfig() {
    return {
      agentTools: {
        caseContextEnabled: false,
        importedEvidenceEnabled: false,
        publishedKnowledgeEnabled: false,
        sapReadonlyEnabled: true,
        sapDataPreviewEnabled: enabled
      }
    };
  }
};
let captured = null;
const readSapData = async (actualTarget, request) => {
  captured = { actualTarget, request };
  return {
    intent: "sap-readonly-data",
    operation: request.operation,
    source: { objectName: request.objectName, objectType: request.objectType, systemId: "PS4", client: "800" },
    rowCount: 1,
    truncated: false,
    columns: request.columns,
    analysisRows: [{ MATNR: "MAT-1", WERKS: "C050", LGORT: "0001", LABST: "12" }],
    analysisRowsTruncated: false,
    generatedFiles: ["evidence/sap/data-preview-MARD.csv"],
    safeSummary: { filterCount: 1, selectedColumnCount: request.columns.length, dataRowsStoredLocally: true, scopeNote: "已完成受控只读读取。" }
  };
};
const service = new AgentToolService(store, { listConnections: () => [] }, null, null, readSapData);
const session = await service.createSession(target, { userContent: "读取 SAP 数据表 MARD 的业务数据" });
const tool = session.tools.find((item) => /通用|任意业务问题|数据源/.test(item.description) && /ADT Data Preview|数据预览/.test(item.description));
assert.ok(tool, "没有面向通用 SAP 问题的数据读取工具");
assert.doesNotMatch(tool.description, /系统使用批准的 MARD|库存专用|只能.*库存/);
for (const field of ["operation", "objectName", "objectType", "columns", "filters", "maxRows"]) {
  assert.ok(Object.hasOwn(tool.inputSchema.properties, field), "通用工具缺少 " + field);
}
assert.equal(Object.hasOwn(tool.inputSchema.properties, "systemHint"), false, "模型不应覆盖原始用户消息中的 SAP 连接路由");
assert.equal(Object.hasOwn(tool.inputSchema.properties, "plant"), false, "通用接口不应把工厂固化为顶层参数");
assert.equal(Object.hasOwn(tool.inputSchema.properties, "sql"), false, "模型不应提交任意 SQL");
let result = await session.execute({
  callId: "general-discover",
  name: tool.name,
  arguments: {
    operation: "discover",
    objectName: "MARD",
    objectType: "table",
    columns: [],
    filters: [],
    maxRows: 1
  }
});
assert.equal(result.isError, false, result.content);
result = await session.execute({
  callId: "general-read",
  name: tool.name,
  arguments: {
    operation: "read",
    objectName: "MARD",
    objectType: "table",
    columns: ["MATNR", "WERKS", "LGORT", "LABST"],
    filters: [{ field: "WERKS", operator: "eq", value: "C050" }],
    maxRows: 200
  }
});
assert.equal(result.isError, false, result.content);
assert.equal(captured.actualTarget.threadId, "thread-1");
assert.equal(captured.request.intent, "sap-readonly-data");
assert.equal(captured.request.objectName, "MARD");
assert.deepEqual(captured.request.columns, ["MATNR", "WERKS", "LGORT", "LABST"]);
assert.deepEqual(captured.request.filters, [{ field: "WERKS", operator: "eq", value: "C050" }]);
assert.equal(captured.request.readOnly, true);
assert.match(result.content, /data-preview-MARD\.csv/);
assert.match(result.content, /MAT-1/, "读取后的有界分析行必须返回模型，才能继续完成业务任务");

enabled = false;
await assert.rejects(
  () => service.createSession(target, { userContent: "读取 SAP 数据表 MARD 的业务数据" }),
  /尚未启用.*ADT Data Preview/
);
const disabled = await service.createSession(target);
assert.equal(disabled.tools.some((item) => /ADT Data Preview|数据预览/.test(item.description)), false, "未授权时不应暴露通用 SAP 数据工具");

process.stdout.write("phase61-general-sap-readonly-task-probe=ok\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: repoRoot, sourcefile: "phase61-entry.ts", loader: "ts" },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    logLevel: "silent"
  });
  await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
