import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { redactSensitiveText } from "./contentSafety";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md"]);
const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 500_000;
const MAX_PDF_PAGES = 500;
const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 2_000;
const MAX_COLUMNS_PER_SHEET = 120;
const MAX_CELLS = 50_000;

export interface PreparedCaseAttachment {
  sourcePath: string;
  displayName: string;
  extension: string;
  sizeBytes: number;
  originalBytes: Buffer;
  extractedMarkdown: string;
  extractedCharacters: number;
  redactions: number;
  truncated: boolean;
  warnings: string[];
}

interface ExtractionResult {
  body: string;
  truncated: boolean;
  warnings: string[];
}

export async function prepareCaseAttachments(sourcePaths: string[]): Promise<PreparedCaseAttachment[]> {
  if (!Array.isArray(sourcePaths) || sourcePaths.length < 1 || sourcePaths.length > MAX_FILES) {
    throw new Error(`一次可导入 1-${MAX_FILES} 个附件。`);
  }
  const inspected = await Promise.all(sourcePaths.map(async (sourcePath) => {
    const stats = await fs.lstat(sourcePath);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("附件必须是普通文件，不能使用符号链接或目录。");
    const extension = path.extname(sourcePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`不支持 ${extension || "无扩展名"} 附件。`);
    if (stats.size > MAX_FILE_BYTES) throw new Error(`附件 ${safeDisplayName(sourcePath)} 超过 25 MB 限制。`);
    return { sourcePath, stats, extension, displayName: safeDisplayName(sourcePath) };
  }));
  const totalBytes = inspected.reduce((total, item) => total + item.stats.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("所选附件合计超过 100 MB 限制。");

  const prepared: PreparedCaseAttachment[] = [];
  for (const item of inspected) {
    const originalBytes = await fs.readFile(item.sourcePath);
    assertFileSignature(item.extension, originalBytes, item.displayName);
    let extraction: ExtractionResult;
    try {
      extraction = await extractAttachment(item.extension, originalBytes);
    } catch {
      throw new Error(`${item.displayName} 解析失败。文件可能已损坏、加密或包含不受支持的结构。`);
    }
    const bounded = boundText(extraction.body, MAX_EXTRACTED_CHARS);
    const redacted = redactSensitiveText(bounded.body);
    prepared.push({
      sourcePath: item.sourcePath,
      displayName: item.displayName,
      extension: item.extension,
      sizeBytes: originalBytes.length,
      originalBytes,
      extractedMarkdown: redacted.content,
      extractedCharacters: redacted.content.length,
      redactions: redacted.redactions,
      truncated: extraction.truncated || bounded.truncated,
      warnings: extraction.warnings
    });
  }
  return prepared;
}

function safeDisplayName(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  const stem = parsed.name
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96) || "附件";
  return `${stem}${parsed.ext.toLowerCase()}`;
}

function assertFileSignature(extension: string, buffer: Buffer, displayName: string): void {
  if (extension === ".pdf" && buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${displayName} 不是有效的 PDF 文件。`);
  }
  if ((extension === ".docx" || extension === ".xlsx") && buffer.subarray(0, 2).toString("binary") !== "PK") {
    throw new Error(`${displayName} 不是有效的 Office Open XML 文件。`);
  }
  if ((extension === ".txt" || extension === ".md" || extension === ".csv") && buffer.includes(0)) {
    throw new Error(`${displayName} 不是受支持的纯文本文件。`);
  }
}

async function extractAttachment(extension: string, buffer: Buffer): Promise<ExtractionResult> {
  if (extension === ".pdf") return extractPdf(buffer);
  if (extension === ".docx") return extractDocx(buffer);
  if (extension === ".xlsx") return extractWorkbook(buffer);
  return extractPlainText(buffer, extension === ".csv");
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const result = await extractText(pdf, { mergePages: false });
    const pages = result.text.slice(0, MAX_PDF_PAGES);
    return {
      body: pages.map((text, index) => `## 第 ${index + 1} 页\n\n${text.trim() || "[本页未提取到文本]"}`).join("\n\n"),
      truncated: result.totalPages > pages.length,
      warnings: result.totalPages > pages.length ? [`PDF 共 ${result.totalPages} 页，摘录仅保留前 ${pages.length} 页。`] : []
    };
  } finally {
    await pdf.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    body: result.value.trim(),
    truncated: false,
    warnings: result.messages.slice(0, 20).map((message) => message.message)
  };
}

async function extractWorkbook(buffer: Buffer): Promise<ExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sections: string[] = [];
  const warnings: string[] = [];
  let cells = 0;
  let truncated = false;
  for (const worksheet of workbook.worksheets.slice(0, MAX_SHEETS)) {
    const rows: string[] = [];
    const rowLimit = Math.min(worksheet.actualRowCount || worksheet.rowCount, MAX_ROWS_PER_SHEET);
    for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values: string[] = [];
      const columnLimit = Math.min(row.cellCount, MAX_COLUMNS_PER_SHEET);
      for (let column = 1; column <= columnLimit; column += 1) {
        if (cells >= MAX_CELLS) {
          truncated = true;
          break;
        }
        const cell = row.getCell(column);
        values.push(`${cell.address}=${cellText(cell.value)}`);
        cells += 1;
      }
      if (values.length > 0) rows.push(`- 行 ${rowNumber}: ${values.join(" | ")}`);
      if (cells >= MAX_CELLS) break;
    }
    sections.push(`## Sheet：${worksheet.name}\n\n${rows.join("\n") || "[该 Sheet 未提取到数据]"}`);
    if ((worksheet.actualRowCount || worksheet.rowCount) > rowLimit) truncated = true;
    if (cells >= MAX_CELLS) break;
  }
  if (workbook.worksheets.length > MAX_SHEETS) truncated = true;
  if (truncated) warnings.push("工作簿摘录已按 Sheet、行、列和单元格安全上限截断；原文件仍完整保留。");
  return { body: sections.join("\n\n"), truncated, warnings };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("formula" in value) return `[公式，仅记录不执行] ${String(value.formula)} => ${String(value.result ?? "")}`;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("hyperlink" in value) return String(value.hyperlink);
    return JSON.stringify(value);
  }
  return String(value);
}

function extractPlainText(buffer: Buffer, withLineNumbers: boolean): ExtractionResult {
  const body = buffer.toString("utf8").replace(/^\uFEFF/, "");
  return {
    body: withLineNumbers
      ? body.split(/\r?\n/).map((line, index) => `行 ${index + 1}: ${line}`).join("\n")
      : body,
    truncated: false,
    warnings: []
  };
}

function boundText(body: string, maxChars: number): { body: string; truncated: boolean } {
  if (body.length <= maxChars) return { body, truncated: false };
  return { body: `${body.slice(0, maxChars)}\n\n[摘录达到安全长度上限，原文件仍完整保留]`, truncated: true };
}
