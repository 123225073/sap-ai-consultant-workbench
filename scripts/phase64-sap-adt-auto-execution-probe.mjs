import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase64-adt-auto-"));
const bundlePath = path.join(tempRoot, "probe.mjs");
const entrySource = String.raw`
import assert from "node:assert/strict";
import http from "node:http";
import { AgentToolService } from "./apps/desktop/src/main/agentToolService.ts";
import { createAdtDataPreviewConnector } from "./apps/desktop/src/main/adtDataPreviewConnector.ts";
import { adtReadonlyObjectEvidencePath, parseAdtObjectSearchXml } from "./apps/desktop/src/main/adtReadonlyConnector.ts";
import { OpenAiCompatibleModelProviderConnector } from "./apps/desktop/src/main/modelProviderConnector.ts";
import { detectSapReadonlyIntent } from "./apps/desktop/src/main/sapIntentRouter.ts";

assert.equal(detectSapReadonlyIntent("连接 SAP Client 800，读取 C050 工厂库存并分析"), "sap-data-read");
assert.equal(detectSapReadonlyIntent("通过 ADT 读取 ZMM_REPORT 程序源码"), "sap-object-read");
assert.equal(detectSapReadonlyIntent("查看 SAP 物料表 MARA 字段定义"), "sap-object-read");
assert.equal(detectSapReadonlyIntent("读取 SAP 800 库存并创建 HTML 报告"), "sap-data-read");
assert.equal(detectSapReadonlyIntent("在 SAP 创建采购订单"), null);
assert.equal(detectSapReadonlyIntent("查询 SAP 订单后更新状态"), null);
assert.equal(detectSapReadonlyIntent("帮我写一份库存分析方案"), null);
assert.equal(detectSapReadonlyIntent("查询 PS4 800 的库存", ["PS4"]), "sap-data-read");
assert.equal(detectSapReadonlyIntent("读取 SAP 表 MARD 的数据"), "sap-data-read");
assert.equal(detectSapReadonlyIntent("查看 SAP CDS ZI_SALES"), "sap-object-read");
assert.equal(detectSapReadonlyIntent("读取 SAP CDS ZI_SALES 的数据"), "sap-data-read");
assert.equal(detectSapReadonlyIntent("读取 SAPMV45A 源码"), "sap-object-read");
assert.equal(detectSapReadonlyIntent("analyze development inventory report", ["DEV"]), null);
assert.equal(detectSapReadonlyIntent("分析生产库存报表", ["生产"]), null);
assert.equal(detectSapReadonlyIntent("查询 SAP 订单后把状态改成已完成"), null);
assert.equal(detectSapReadonlyIntent("query SAP order then change status"), null);
assert.equal(detectSapReadonlyIntent("读取 SAP 库存，禁止写入 SAP"), "sap-data-read");

assert.equal(adtReadonlyObjectEvidencePath({ objectType: "interface", objectName: "ZIF_DEMO" }), "/sap/bc/adt/oo/interfaces/ZIF_DEMO/source/main");
assert.equal(adtReadonlyObjectEvidencePath({ objectType: "cds", objectName: "ZI_DEMO" }), "/sap/bc/adt/ddic/ddl/sources/ZI_DEMO/source/main");

const parsedSearch = parseAdtObjectSearchXml(
  '<adtcore:objectReferences><adtcore:objectReference adtcore:name="MARD" adtcore:type="TABL/DT" adtcore:description="Storage Location Data"/></adtcore:objectReferences>',
  10
);
assert.deepEqual(parsedSearch, [{ name: "MARD", type: "TABL/DT", description: "Storage Location Data" }]);
const parsedFunctionSearch = parseAdtObjectSearchXml(
  '<adtcore:objectReference adtcore:name="ZFM_DEMO" adtcore:type="FUGR/FF" adtcore:uri="/sap/bc/adt/functions/groups/ZFG_DEMO/fmodules/ZFM_DEMO"/>',
  10
);
assert.equal(parsedFunctionSearch[0].functionGroup, "ZFG_DEMO");

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
const dataCalls = [];
const searchCalls = [];
const userContent = "读取 SAP Client 800 的 C050 工厂库存数据并创建 HTML 报告";
const service = new AgentToolService(
  store,
  {},
  null,
  async () => ({ summary: {}, summaries: [], generatedFiles: [] }),
  async (_target, request) => {
    dataCalls.push(request);
    return {
      intent: "sap-readonly-data",
      operation: request.operation,
      source: { objectName: request.objectName, objectType: request.objectType, systemId: "PS4", client: "800" },
      rowCount: request.operation === "discover" ? 0 : 1,
      truncated: false,
      columns: request.operation === "discover" ? ["MATNR", "WERKS", "LABST"] : request.columns,
      analysisRows: request.operation === "discover" ? [] : [{ MATNR: "MAT-1", WERKS: "C050", LABST: "12" }],
      analysisRowsTruncated: false,
      generatedFiles: ["evidence/sap/probe.csv"],
      safeSummary: { filterCount: request.filters.length, selectedColumnCount: request.columns.length, dataRowsStoredLocally: request.operation === "read", scopeNote: "probe" }
    };
  },
  async (_target, query, maxResults, queryContext) => {
    searchCalls.push({ query, maxResults, queryContext });
    return { query, matches: [{ name: "MARD", type: "TABL/DT", description: "Storage Location Data" }] };
  }
);

const unrelatedSession = await service.createSession(target, { userContent: "整理今天的会议纪要" });
assert.equal(unrelatedSession.tools.some((item) => item.name.startsWith("sap_")), false);
const mutationSession = await service.createSession(target, { userContent: "查询 SAP 订单后更新状态" });
assert.equal(mutationSession.tools.some((item) => item.name.startsWith("sap_")), false);

enabled = false;
await assert.rejects(
  () => service.createSession(target, { userContent: "读取 SAP Client 800 的库存数据" }),
  /尚未启用.*ADT Data Preview/
);
enabled = true;
const exactSession = await service.createSession(target, { userContent: "读取 SAP 数据表 MARD 的业务数据" });
assert.match(exactSession.getToolChoice().name, /^sap_read_data_preview_/);
const terseExactSession = await service.createSession(target, { userContent: "读取 SAP MARD 中 C050 库存" });
assert.match(terseExactSession.getToolChoice().name, /^sap_read_data_preview_/);
const bypassReaderCallCount = dataCalls.length;
let bypassResult = await terseExactSession.execute({
  callId: "bypass-read-before-discover",
  name: terseExactSession.getToolChoice().name,
  arguments: { operation: "read", objectName: "MARD", objectType: "table", columns: ["MATNR"], filters: [{ field: "WERKS", operator: "eq", value: "C050" }], maxRows: 1 }
});
assert.equal(bypassResult.isError, true);
assert.match(bypassResult.content, /必须先执行 operation=discover/);
assert.equal(dataCalls.length, bypassReaderCallCount, "read-before-discover must not invoke the SAP reader");
bypassResult = await terseExactSession.execute({
  callId: "bypass-missing-operation",
  name: terseExactSession.getToolChoice().name,
  arguments: { objectName: "MARD", objectType: "table", columns: [], filters: [], maxRows: 1 }
});
assert.equal(bypassResult.isError, true);
assert.equal(dataCalls.length, bypassReaderCallCount, "missing operation must not invoke the SAP reader");
const standardProgramSession = await service.createSession(target, { userContent: "读取 SAPMV45A 源码" });
assert.match(standardProgramSession.getToolChoice().name, /^sap_read_object_evidence_/);
const unknownCustomObjectSession = await service.createSession(target, { userContent: "通过 ADT 读取 ZCUSTOM 源码" });
assert.match(unknownCustomObjectSession.getToolChoice().name, /^sap_search_objects_/);
const functionReadCalls = [];
const functionService = new AgentToolService(
  store,
  {},
  null,
  async (_target, request) => {
    functionReadCalls.push(request);
    return { summary: { objectType: request.objectType, objectName: request.objectName }, summaries: [], generatedFiles: [] };
  },
  async () => ({}),
  async (_target, query) => ({ query, matches: [{ name: "ZFM_DEMO", type: "FUGR/FF", functionGroup: "ZFG_DEMO" }] })
);
const functionSession = await functionService.createSession(target, { userContent: "通过 ADT 读取 ZFM_DEMO function module 源码" });
const functionSearchTool = functionSession.getToolChoice().name;
assert.match(functionSearchTool, /^sap_search_objects_/);
const functionSearchResult = await functionSession.execute({ callId: "function-search", name: functionSearchTool, arguments: { query: "ZFM_DEMO", maxResults: 10 } });
assert.equal(functionSearchResult.isError, false, functionSearchResult.content);
assert.match(functionSearchResult.content, /ZFG_DEMO/);
const functionReadTool = functionSession.getToolChoice().name;
assert.match(functionReadTool, /^sap_read_object_evidence_/);
const functionReadResult = await functionSession.execute({
  callId: "function-read",
  name: functionReadTool,
  arguments: { objectType: "function", objectName: "ZFM_DEMO", functionGroup: "ZFG_DEMO" }
});
assert.equal(functionReadResult.isError, false, functionReadResult.content);
assert.equal(functionReadCalls[0].functionGroup, "ZFG_DEMO");
const session = await service.createSession(target, { userContent });
const searchToolName = session.getToolChoice().name;
assert.equal(session.getToolChoice().mode, "required");
let result = await session.execute({ callId: "search", name: searchToolName, arguments: { query: "MARD", maxResults: 10 } });
assert.equal(result.isError, false, result.content);
assert.equal(searchCalls[0].queryContext, userContent);
const dataToolName = session.getToolChoice().name;
assert.notEqual(dataToolName, searchToolName);
result = await session.execute({
  callId: "discover",
  name: dataToolName,
  arguments: { operation: "discover", objectName: "MARD", objectType: "table", columns: ["WRONG"], filters: [], maxRows: 500 }
});
assert.equal(result.isError, false, result.content);
assert.deepEqual(dataCalls[0].columns, []);
assert.equal(dataCalls[0].maxRows, 1);
assert.equal(dataCalls[0].queryContext, userContent);
assert.equal(session.getToolChoice().mode, "required");
result = await session.execute({
  callId: "read",
  name: dataToolName,
  arguments: { operation: "read", objectName: "MARD", objectType: "table", columns: ["MATNR", "WERKS", "LABST"], filters: [{ field: "WERKS", operator: "eq", value: "C050" }], maxRows: 200 }
});
assert.equal(result.isError, false, result.content);
assert.equal(session.getToolChoice().mode, "auto");
assert.equal(session.getRequirementState().status, "satisfied");

let refinedSearchCount = 0;
const refineService = new AgentToolService(store, {}, null, async () => ({ summary: {}, summaries: [], generatedFiles: [] }), async () => ({}), async (_target, query) => {
  refinedSearchCount += 1;
  return { query, matches: refinedSearchCount === 1 ? [] : [{ name: "MARD", type: "TABL/DT", description: "Storage Location Data" }] };
});
const refineSession = await refineService.createSession(target, { userContent });
const refineSearchTool = refineSession.getToolChoice().name;
let refineResult = await refineSession.execute({ callId: "empty-search", name: refineSearchTool, arguments: { query: "INVENTORY", maxResults: 10 } });
assert.equal(refineResult.isError, false);
assert.equal(refineSession.getToolChoice().name, refineSearchTool, "empty search must remain in search stage");
refineResult = await refineSession.execute({ callId: "refined-search", name: refineSearchTool, arguments: { query: "MARD", maxResults: 10 } });
assert.equal(refineResult.isError, false);
assert.notEqual(refineSession.getToolChoice().name, refineSearchTool, "non-empty refined search must advance");

const modelBodies = [];
let modelRound = 0;
const modelSession = await service.createSession(target, { userContent });
const streamRequester = async (_url, _label, options, onChunk) => {
  const body = JSON.parse(options.body);
  modelBodies.push(body);
  modelRound += 1;
  const forcedName = body.tool_choice?.function?.name;
  if (modelRound === 1) {
    onChunk('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"search-1","function":{"name":"' + forcedName + '","arguments":"{\\"query\\":\\"MARD\\",\\"maxResults\\":10}"}}]}}]}\n\n');
  } else if (modelRound === 2) {
    onChunk('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"discover-1","function":{"name":"' + forcedName + '","arguments":"{\\"operation\\":\\"discover\\",\\"objectName\\":\\"MARD\\",\\"objectType\\":\\"table\\",\\"columns\\":[],\\"filters\\":[],\\"maxRows\\":1}"}}]}}]}\n\n');
  } else if (modelRound === 3) {
    onChunk('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read-1","function":{"name":"' + forcedName + '","arguments":"{\\"operation\\":\\"read\\",\\"objectName\\":\\"MARD\\",\\"objectType\\":\\"table\\",\\"columns\\":[\\"MATNR\\",\\"WERKS\\",\\"LABST\\"],\\"filters\\":[{\\"field\\":\\"WERKS\\",\\"operator\\":\\"eq\\",\\"value\\":\\"C050\\"}],\\"maxRows\\":200}"}}]}}]}\n\n');
  } else {
    onChunk('data: {"choices":[{"delta":{"content":"已基于真实只读结果完成分析。"}}]}\n\n');
  }
  onChunk('data: [DONE]\n\n');
  return { contentType: "text/event-stream; charset=utf-8" };
};
const connector = new OpenAiCompatibleModelProviderConnector(() => { throw new Error("不应非流式调用"); }, streamRequester);
const modelResult = await connector.generateSafeDraft({
  id: "provider-1", name: "Probe", providerType: "openai-compatible", baseUrl: "https://models.example.com/v1", apiKey: "probe", modelId: "probe-model",
  context: { messages: [{ role: "system", content: "只读" }, { role: "user", content: "读取库存" }], audit: { allowedFields: [], contextCharCount: 4, referencedKnowledgeCount: 0, safeOutputSummaryCount: 0, maxContextChars: 100, createdAt: "2026-08-04T00:00:00.000Z" } },
  toolSession: modelSession,
  onDelta: () => undefined
});
assert.equal(modelResult.content, "已基于真实只读结果完成分析。");
assert.notEqual(modelBodies[0].tool_choice.function.name, modelBodies[1].tool_choice.function.name);
assert.deepEqual(modelBodies[1].tool_choice, modelBodies[2].tool_choice);
assert.equal(modelBodies[3].tool_choice, "auto");

const ignoredSession = await service.createSession(target, { userContent });
const ignoredConnector = new OpenAiCompatibleModelProviderConnector(
  () => { throw new Error("不应非流式调用"); },
  async (_url, _label, _options, onChunk) => {
    onChunk('data: {"choices":[{"delta":{"content":"我没有调用工具但声称成功。"}}]}\n\n');
    onChunk('data: [DONE]\n\n');
    return { contentType: "text/event-stream" };
  }
);
await assert.rejects(() => ignoredConnector.generateSafeDraft({
  id: "provider-2", name: "Ignored", providerType: "openai-compatible", baseUrl: "https://models.example.com/v1", apiKey: "probe", modelId: "probe-model",
  context: { messages: [{ role: "user", content: "读取库存" }], audit: { allowedFields: [], contextCharCount: 4, referencedKnowledgeCount: 0, safeOutputSummaryCount: 0, maxContextChars: 100, createdAt: "2026-08-04T00:00:00.000Z" } },
  toolSession: ignoredSession,
  onDelta: () => undefined
}), /忽略了 tool_choice/);

const failingService = new AgentToolService(store, {}, null, async () => ({}), async () => { throw new Error("preview failed"); }, async () => { throw new Error("search failed"); });
const failingSession = await failingService.createSession(target, { userContent });
let failed = await failingSession.execute({ callId: "search-failure", name: failingSession.getToolChoice().name, arguments: { query: "MARD", maxResults: 10 } });
assert.equal(failed.isError, true);
assert.match(failed.content, /search failed/);
assert.match(failingSession.getToolChoice().name, /^sap_read_data_preview_/);
for (let index = 0; index < 3; index += 1) {
  failed = await failingSession.execute({ callId: "preview-failure-" + index, name: failingSession.getToolChoice().name, arguments: { operation: "discover", objectName: "MARD", objectType: "table", columns: [], filters: [], maxRows: 1 } });
  assert.equal(failed.isError, true);
}
assert.equal(failingSession.getRequirementState().status, "failed");
assert.match(failingSession.getRequirementState().message, /preview failed/);

async function verifyCsrfFallback(tokenFetchStatus) {
  let previewRequests = 0;
  let metadataRequests = 0;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/sap/bc/adt/ddic/tables/T000/source/main") {
      metadataRequests += 1;
      response.writeHead(200, { "Content-Type": "application/vnd.sap.adt.ddic.table.v2+xml", "X-CSRF-Token": "probe-token", "Set-Cookie": "SAP_SESSION=probe; HttpOnly" });
      response.end('<table name="T000"/>');
      return;
    }
    if (url.pathname === "/sap/bc/adt/datapreview/freestyle") {
      previewRequests += 1;
      if (request.headers["x-csrf-token"] === "Fetch") {
        if (tokenFetchStatus === 200) {
          response.writeHead(200, { "Content-Type": "application/vnd.sap.adt.datapreview.table.v1+xml" });
          response.end("<dataPreview/>");
        } else {
          response.writeHead(tokenFetchStatus, { "Content-Type": "text/plain" });
          response.end("token fetch unsupported");
        }
        return;
      }
      if (request.headers["x-csrf-token"] !== "probe-token" || !String(request.headers.cookie ?? "").includes("SAP_SESSION=probe")) {
        response.writeHead(403, { "Content-Type": "text/plain" });
        response.end("CSRF token validation failed");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/vnd.sap.adt.datapreview.table.v1+xml" });
      response.end('<?xml version="1.0"?><dataPreview><columns><metadata name="MATNR"/><dataSet><data>MAT-1</data></dataSet></columns><columns><metadata name="WERKS"/><dataSet><data>C050</data></dataSet></columns></dataPreview>');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const adt = createAdtDataPreviewConnector();
    const response = await adt.readDataPreview({
      url: "http://127.0.0.1:" + address.port,
      alias: "Probe", systemId: "PS4", instanceNumber: "00", environment: "test", client: "800", username: "USER", password: "PASS", language: "ZH", sslMode: "strict", readOnly: true, transportWriteMode: "disabled"
    }, {
      intent: "sap-readonly-data", operation: "read", objectName: "MARD", objectType: "table", columns: ["MATNR", "WERKS"], filters: [{ field: "WERKS", operator: "eq", value: "C050" }], maxRows: 10, readOnly: true
    });
    assert.equal(response.rows[0].WERKS, "C050");
    assert.equal(metadataRequests, 1);
    assert.equal(previewRequests, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
for (const status of [200, 403, 404, 406]) await verifyCsrfFallback(status);

process.stdout.write("phase64-sap-adt-auto-execution-probe=ok\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: repoRoot, sourcefile: "phase64-entry.ts", loader: "ts" },
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
