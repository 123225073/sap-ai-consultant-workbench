import fs from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES } from "./knowledgeService";

const FILE_READ_ERROR = "无法读取所选文件，请确认文件仍存在且可访问。";

export interface ControlledKnowledgeTextFileRead {
  sourceName: string;
  sizeBytes: number;
  body: string;
}

export function decodeControlledKnowledgeTextFile(buffer: Uint8Array): string {
  if (buffer.includes(0)) {
    throw new Error("文件不像纯文本，请另存为 UTF-8 Markdown 或 TXT 后再导入。");
  }
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("文件无法按 UTF-8 文本读取，请另存为 UTF-8 Markdown 或 TXT 后再导入。");
  }
  const controlCharacters = text.match(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g) ?? [];
  if (controlCharacters.length > Math.max(8, Math.floor(text.length * 0.01))) {
    throw new Error("文件包含过多控制字符，不适合作为知识文本导入。");
  }
  return text;
}

export async function readControlledKnowledgeTextFile(selectedPath: string): Promise<ControlledKnowledgeTextFileRead> {
  const sourceName = path.basename(selectedPath);
  let stats;
  try {
    stats = await fs.stat(selectedPath);
  } catch {
    throw new Error(FILE_READ_ERROR);
  }
  if (!stats.isFile()) {
    throw new Error("请选择一个 Markdown 或 TXT 文件。");
  }
  if (stats.size > MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES) {
    throw new Error("文件太大，请拆成更小的已脱敏 Markdown 或 TXT 文本后再导入。");
  }

  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(selectedPath);
  } catch {
    throw new Error(FILE_READ_ERROR);
  }
  if (fileBuffer.length > MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES) {
    throw new Error("文件太大，请拆成更小的已脱敏 Markdown 或 TXT 文本后再导入。");
  }

  return {
    sourceName,
    sizeBytes: fileBuffer.length,
    body: decodeControlledKnowledgeTextFile(fileBuffer)
  };
}
