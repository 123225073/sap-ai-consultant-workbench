import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { CaseDiagramExportFormat } from "../shared/workbenchTypes";

const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 4_096;

export async function convertSanitizedSvg(svgBytes: Buffer, format: CaseDiagramExportFormat): Promise<Buffer> {
  const svg = svgBytes.toString("utf8").trim();
  assertSanitizedSvg(svg);
  if (format === "svg") return Buffer.from(svg, "utf8");

  const size = svgCanvasSize(svg);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>@page{size:${size.width}px ${size.height}px;margin:0}html,body{margin:0;width:${size.width}px;height:${size.height}px;background:#fff;overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
  const window = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
      partition: `diagram-export-${randomUUID()}`
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  try {
    await window.loadURL(`data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`);
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    if (format === "png") {
      const image = await window.webContents.capturePage({ x: 0, y: 0, width: size.width, height: size.height });
      const png = image.toPNG();
      if (png.length < 8 || png.length > 15 * 1024 * 1024) throw new Error("流程图 PNG 生成失败或超过安全大小限制。");
      return png;
    }
    const pdf = await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    if (pdf.length < 8 || pdf.length > 15 * 1024 * 1024) throw new Error("流程图 PDF 生成失败或超过安全大小限制。");
    return pdf;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

function assertSanitizedSvg(svg: string): void {
  if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES || !svg.startsWith("<svg") || !svg.endsWith("</svg>")) {
    throw new Error("流程图 SVG 内容无效或过大。");
  }
  if (/<(?:script|foreignObject|iframe|object|embed|image|a)\b|\son[a-z]+\s*=|(?:href|xlink:href|src)\s*=|@import|url\(\s*["']?(?!#)/i.test(svg)) {
    throw new Error("流程图 SVG 包含不允许的主动内容或外部资源。");
  }
}

function svgCanvasSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  const widthValue = Number(viewBox?.[1] ?? svg.match(/\bwidth=["']([\d.]+)/i)?.[1] ?? 1_200);
  const heightValue = Number(viewBox?.[2] ?? svg.match(/\bheight=["']([\d.]+)/i)?.[1] ?? 800);
  if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue) || widthValue <= 0 || heightValue <= 0) throw new Error("流程图画布尺寸无效。");
  const scale = Math.min(1, MAX_DIMENSION / Math.max(widthValue, heightValue));
  return {
    width: Math.max(320, Math.ceil(widthValue * scale)),
    height: Math.max(240, Math.ceil(heightValue * scale))
  };
}
