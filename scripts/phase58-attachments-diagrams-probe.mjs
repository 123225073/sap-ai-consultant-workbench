import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const root = path.resolve(import.meta.dirname, "..");
const buildRoot = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase58-build-"));
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase58-fixtures-"));

try {
  const outputPath = path.join(buildRoot, "case-attachment-service.cjs");
  await build({
    entryPoints: [path.join(root, "apps/desktop/src/main/caseAttachmentService.ts")],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22"
  });
  const { prepareCaseAttachments } = require(outputPath);

  const txtPath = path.join(fixtureRoot, "说明.txt");
  const csvPath = path.join(fixtureRoot, "库存.csv");
  const docxPath = path.join(fixtureRoot, "需求.docx");
  const xlsxPath = path.join(fixtureRoot, "清单.xlsx");
  const pdfPath = path.join(fixtureRoot, "证据.pdf");
  await writeFile(txtPath, "项目说明\nAPI_KEY=phase58-sensitive-value-1234567890\n保持 SAP 只读。", "utf8");
  await writeFile(csvPath, "物料,工厂,数量\nMAT-1,8000,12\n", "utf8");
  await writeFile(docxPath, await minimalDocxBuffer(), { flag: "wx" });
  await writeFile(pdfPath, minimalPdfBuffer("Phase58 PDF evidence"), { flag: "wx" });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("库存");
  sheet.getCell("A1").value = "物料";
  sheet.getCell("B1").value = "数量";
  sheet.getCell("A2").value = "MAT-1";
  sheet.getCell("B2").value = { formula: "1+1", result: 2 };
  await workbook.xlsx.writeFile(xlsxPath);

  const prepared = await prepareCaseAttachments([txtPath, csvPath, docxPath, xlsxPath, pdfPath]);
  assert.equal(prepared.length, 5);
  assert.doesNotMatch(prepared.find((item) => item.extension === ".txt").extractedMarkdown, /phase58-sensitive-value/);
  assert.match(prepared.find((item) => item.extension === ".txt").extractedMarkdown, /\[已脱敏\]/);
  assert.match(prepared.find((item) => item.extension === ".csv").extractedMarkdown, /行 2: MAT-1,8000,12/);
  assert.match(prepared.find((item) => item.extension === ".docx").extractedMarkdown, /Phase58 Word requirement/);
  assert.match(prepared.find((item) => item.extension === ".xlsx").extractedMarkdown, /Sheet：库存/);
  assert.match(prepared.find((item) => item.extension === ".xlsx").extractedMarkdown, /公式，仅记录不执行/);
  assert.match(prepared.find((item) => item.extension === ".pdf").extractedMarkdown, /第 1 页/);
  assert.ok(prepared.every((item) => item.sizeBytes > 0 && item.extractedCharacters > 0));

  const disguisedPdf = path.join(fixtureRoot, "伪装.pdf");
  await writeFile(disguisedPdf, "not-a-pdf", "utf8");
  await assert.rejects(() => prepareCaseAttachments([disguisedPdf]), /不是有效的 PDF/);
  let symlinkCreated = false;
  const linked = path.join(fixtureRoot, "链接.txt");
  try {
    await symlink(txtPath, linked, "file");
    symlinkCreated = true;
  } catch {
    // Windows without Developer Mode may deny symlink creation.
  }
  if (symlinkCreated) await assert.rejects(() => prepareCaseAttachments([linked]), /符号链接/);

  const storeBundlePath = path.join(buildRoot, "workspace-store.cjs");
  await build({
    entryPoints: [path.join(root, "apps/desktop/src/main/workspaceStore.ts")],
    outfile: storeBundlePath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22"
  });
  const { WorkspaceStore } = require(storeBundlePath);
  const isolatedRepoRoot = path.join(fixtureRoot, "isolated-repo");
  const store = new WorkspaceStore(isolatedRepoRoot);
  const initialState = await store.createLocalProject({ name: "Phase58 Client", sapVersion: "S4", systemLabel: "DEV/100" });
  const project = initialState.projects.find((item) => item.id === initialState.activeProjectId);
  const caseItem = project?.cases.find((item) => item.id === initialState.activeCaseId);
  const thread = initialState.workThreads.find((item) => item.id === initialState.activeWorkThreadId);
  assert.ok(project && caseItem && thread);
  const imported = await store.importCaseAttachments(
    { projectId: project.id, caseId: caseItem.id, threadId: thread.id },
    prepared
  );
  assert.equal(imported.items.length, 5);
  const caseRoot = path.join(isolatedRepoRoot, "local-data", "workbench", "projects", project.id, "cases", caseItem.folderName);
  for (const item of imported.items) {
    assert.ok((await stat(path.join(caseRoot, item.originalRelativePath))).isFile());
    assert.ok((await stat(path.join(caseRoot, item.extractedRelativePath))).isFile());
  }
  const txtImport = imported.items.find((item) => item.fileType === "txt");
  assert.deepEqual(await readFile(path.join(caseRoot, txtImport.originalRelativePath)), await readFile(txtPath));
  const txtExtract = await readFile(path.join(caseRoot, txtImport.extractedRelativePath), "utf8");
  assert.doesNotMatch(txtExtract, /phase58-sensitive-value/);
  assert.match(txtExtract, /原始附件不会直接进入模型上下文/);
  const evidenceSearch = await store.searchCaseImportedEvidence(project.id, caseItem.id, "MAT-1", 8);
  assert.ok(evidenceSearch.count >= 1 && evidenceSearch.items.every((item) => !path.isAbsolute(item.relativePath)));
  await assert.rejects(
    () => store.importCaseAttachments({ projectId: "project-wrong", caseId: caseItem.id, threadId: thread.id }, prepared.slice(0, 1)),
    /目标任务已经切换/
  );

  const mermaidSource = await readFile(path.join(root, "apps/desktop/src/renderer/mermaidRenderer.ts"), "utf8");
  const componentSource = await readFile(path.join(root, "apps/desktop/src/renderer/MermaidPreview.tsx"), "utf8");
  const mainSource = await readFile(path.join(root, "apps/desktop/src/main/main.ts"), "utf8");
  const storeSource = await readFile(path.join(root, "apps/desktop/src/main/workspaceStore.ts"), "utf8");
  const builtHtml = await readFile(path.join(root, "apps/desktop/dist/renderer/index.html"), "utf8");
  assert.match(mermaidSource, /renderRestrictedFlowchart/);
  assert.match(mermaidSource, /escapeXml/);
  assert.doesNotMatch(mermaidSource, /import\(["']mermaid["']\)/);
  assert.match(mermaidSource, /DOMParser/);
  assert.match(mermaidSource, /replaceChildren/);
  assert.match(componentSource, /mountSanitizedSvg/);
  assert.doesNotMatch(componentSource, /dangerouslySetInnerHTML|innerHTML\s*=/);
  assert.match(mainSource, /workbench:import-case-attachments/);
  assert.match(mainSource, /workbench:export-case-diagram/);
  assert.match(storeSource, /sourceSha256 !== input\.sourceSha256/);
  assert.doesNotMatch(builtHtml, /__WORKBENCH_CSP__/);
  const csp = builtHtml.match(/Content-Security-Policy"\s+content="([^"]+)/)?.[1] ?? "";
  assert.match(csp, /connect-src 'self';/);
  assert.doesNotMatch(csp, /connect-src[^;]*(?:ws:|http:)/);
  console.log("Phase 58 attachments and Mermaid safety probe passed.");
} finally {
  await rm(buildRoot, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
}

async function minimalDocxBuffer() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Phase58 Word requirement</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function minimalPdfBuffer(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 34} >>\nstream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
