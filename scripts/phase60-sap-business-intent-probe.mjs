import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase60-business-intent-"));
const bundlePath = path.join(tempRoot, "probe.mjs");
const entrySource = String.raw`
import assert from "node:assert/strict";
import { buildApprovedDataPreviewSql, parseAdtDataPreviewXml } from "./apps/desktop/src/main/adtDataPreviewConnector.ts";
import { normalizeAndRenderSapDataPreview, parseSapDataPreviewRequest } from "./apps/desktop/src/main/sapDataPreviewService.ts";
import { PRODUCT_BASE_PROMPT } from "./apps/desktop/src/main/promptMemoryService.ts";

const inventoryScenario = parseSapDataPreviewRequest({
  intent: "sap-readonly-data",
  operation: "read",
  objectName: "mard",
  objectType: "table",
  columns: ["MATNR", "WERKS", "LGORT", "LABST"],
  filters: [{ field: "WERKS", operator: "eq", value: "C050" }],
  maxRows: 100,
  readOnly: true,
  queryContext: "PS4 Client 800"
});
assert.equal(buildApprovedDataPreviewSql(inventoryScenario), "SELECT MATNR, WERKS, LGORT, LABST FROM MARD WHERE WERKS = 'C050'");

const orderScenario = parseSapDataPreviewRequest({
  intent: "sap-readonly-data",
  operation: "read",
  objectName: "VBAK",
  objectType: "table",
  columns: ["VBELN", "VKORG", "ERDAT"],
  filters: [{ field: "VKORG", operator: "eq", value: "1000" }],
  maxRows: 50,
  readOnly: true
});
assert.equal(buildApprovedDataPreviewSql(orderScenario), "SELECT VBELN, VKORG, ERDAT FROM VBAK WHERE VKORG = '1000'");
assert.throws(() => parseSapDataPreviewRequest({ ...orderScenario, sql: "DELETE FROM VBAK" }), /任意 SQL|不支持的字段/);
assert.throws(() => parseSapDataPreviewRequest({ ...orderScenario, filters: [] }), /至少包含一个结构化筛选/);

const discover = parseSapDataPreviewRequest({
  intent: "sap-readonly-data",
  operation: "discover",
  objectName: "I_MATERIALDOCUMENTITEM_2",
  objectType: "cds",
  columns: [],
  filters: [],
  maxRows: 1,
  readOnly: true
});
assert.equal(buildApprovedDataPreviewSql(discover), "SELECT * FROM I_MATERIALDOCUMENTITEM_2");

const xml = [
  '<?xml version="1.0"?><dataPreview>',
  '<columns><metadata name="MATNR"/><dataSet><data>MAT-1</data></dataSet></columns>',
  '<columns><metadata name="WERKS"/><dataSet><data>C050</data></dataSet></columns>',
  '<columns><metadata name="LGORT"/><dataSet><data>0001</data></dataSet></columns>',
  '<columns><metadata name="LABST"/><dataSet><data>12.000</data></dataSet></columns>',
  '</dataPreview>'
].join('');
const parsed = parseAdtDataPreviewXml(xml, 100);
assert.deepEqual(parsed.columns, ["MATNR", "WERKS", "LGORT", "LABST"]);
assert.deepEqual(parsed.rows, [{ MATNR: "MAT-1", WERKS: "C050", LGORT: "0001", LABST: "12.000" }]);

const snapshot = normalizeAndRenderSapDataPreview({
  intent: "sap-readonly-data",
  operation: "read",
  profile: "sap-readonly-data-preview-v1",
  system: { alias: "PRD", systemId: "PS4", instanceNumber: "00", environment: "production", endpointHost: "https://sap.example.com", client: "800", usernameMasked: "CM***65", language: "ZH", sslMode: "strict", readOnly: true, transportWriteMode: "disabled" },
  sourceMode: "adt",
  request: inventoryScenario,
  columns: parsed.columns,
  rows: parsed.rows,
  readAt: "2026-08-03T10:00:00.000Z",
  truncated: false
});
assert.equal(snapshot.result.rowCount, 1);
assert.deepEqual(snapshot.result.analysisRows, parsed.rows);
assert.ok(snapshot.generatedFiles.some((file) => file.relativePath.endsWith(".csv") && file.content.includes("MAT-1")));
assert.ok(snapshot.generatedFiles.some((file) => file.relativePath.endsWith(".html") && file.content.includes("MARD")));
assert.match(PRODUCT_BASE_PROMPT.content, /SAP 业务问题或成果任务[\s\S]+目标系统与 Client[\s\S]+先发现字段[\s\S]+继续分析/);
assert.match(PRODUCT_BASE_PROMPT.content, /MB52[\s\S]+只是这一通用流程的场景/);

process.stdout.write("phase60-sap-business-intent-probe=ok\n");
`;

try {
  await build({
    stdin: { contents: entrySource, resolveDir: repoRoot, sourcefile: "phase60-entry.ts", loader: "ts" },
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
