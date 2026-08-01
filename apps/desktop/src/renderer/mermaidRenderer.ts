export interface SafeMermaidRender {
  svg: string;
  sourceSha256: string;
}

const MAX_SOURCE_CHARS = 64 * 1024;
const FORBIDDEN_SOURCE = [
  /%%\s*\{\s*(?:init|config)\s*:/i,
  /^---[\s\S]*?---/,
  /\b(?:click|href)\b/i,
  /(?:https?:|file:|javascript:|data:)/i,
  /@import|<\/?[a-z][^>]*>/i
];

export async function renderMermaidSafely(source: string): Promise<SafeMermaidRender> {
  const normalized = source.replace(/^\uFEFF/, "").trim();
  if (!normalized || normalized.length > MAX_SOURCE_CHARS) throw new Error("Mermaid 源码为空或超过 64 KB 安全限制。");
  if (!/^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i.test(normalized)) throw new Error("当前只支持 flowchart / graph 流程图。");
  if (FORBIDDEN_SOURCE.some((pattern) => pattern.test(normalized))) throw new Error("Mermaid 源码包含不允许的配置、链接或 HTML 内容。");

  const renderedSvg = renderRestrictedFlowchart(normalized);
  const sanitized = renderedSvg;
  if (/<(?:script|foreignObject|iframe|object|embed|image|a)\b|\son[a-z]+\s*=|(?:href|xlink:href|src)\s*=|@import|url\(\s*["']?(?!#)/i.test(sanitized)) {
    throw new Error("流程图渲染结果未通过安全检查。");
  }
  const parsed = new DOMParser().parseFromString(sanitized, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || parsed.querySelector("parsererror") || root.querySelector("script,foreignObject,iframe,object,embed,image,a")) {
    throw new Error("流程图渲染结果不是安全的单一 SVG。");
  }
  const svg = new XMLSerializer().serializeToString(root);
  const sourceSha256 = sha256Hex(source);
  return { svg, sourceSha256 };
}

type FlowNode = { id: string; label: string; decision: boolean };
type FlowEdge = { from: string; to: string; label: string };

function renderRestrictedFlowchart(source: string): string {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const header = lines.shift()?.match(/^(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/i);
  if (!header) throw new Error("流程图方向无效。");
  const direction = header[1].toUpperCase();
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  for (const line of lines) {
    const edge = line.match(/^(.+?)\s*(?:--\s+(.+?)\s+-->|-->)\s*(.+?)\s*;?$/);
    if (!edge) throw new Error("当前流程图包含预览器不支持的 Mermaid 语句。");
    const from = parseFlowNode(edge[1]);
    const to = parseFlowNode(edge[3]);
    rememberFlowNode(nodes, from);
    rememberFlowNode(nodes, to);
    edges.push({ from: from.id, to: to.id, label: cleanFlowLabel(edge[2] ?? "", 30) });
  }
  if (nodes.size === 0 || nodes.size > 80 || edges.length > 120) throw new Error("流程图节点为空或超过安全上限。");

  const horizontal = direction === "LR" || direction === "RL";
  const ordered = [...nodes.values()];
  if (direction === "BT" || direction === "RL") ordered.reverse();
  const nodeWidth = 280;
  const nodeHeight = 64;
  const step = horizontal ? 360 : 120;
  const width = horizontal ? Math.max(360, 80 + ordered.length * step) : 520;
  const height = horizontal ? 260 : Math.max(240, 60 + ordered.length * step);
  const positions = new Map<string, { x: number; y: number }>();
  ordered.forEach((node, index) => positions.set(node.id, horizontal
    ? { x: 40 + index * step, y: 96 }
    : { x: (width - nodeWidth) / 2, y: 30 + index * step }));

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mermaid 流程图静态预览">`,
    `<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#667085"/></marker></defs>`
  ];

  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = horizontal ? from.x + nodeWidth : from.x + nodeWidth / 2;
    const y1 = horizontal ? from.y + nodeHeight / 2 : from.y + nodeHeight;
    const x2 = horizontal ? to.x : to.x + nodeWidth / 2;
    const y2 = horizontal ? to.y + nodeHeight / 2 : to.y;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#667085" stroke-width="2" marker-end="url(#flow-arrow)"/>`);
    if (edge.label) {
      parts.push(`<text x="${(x1 + x2) / 2 + (horizontal ? 0 : 10)}" y="${(y1 + y2) / 2 - 6}" text-anchor="${horizontal ? "middle" : "start"}" font-size="13" fill="#475467">${escapeXml(edge.label)}</text>`);
    }
  }

  for (const node of ordered) {
    const position = positions.get(node.id)!;
    if (node.decision) {
      parts.push(`<polygon points="${position.x + nodeWidth / 2},${position.y} ${position.x + nodeWidth},${position.y + nodeHeight / 2} ${position.x + nodeWidth / 2},${position.y + nodeHeight} ${position.x},${position.y + nodeHeight / 2}" fill="#fffaeb" stroke="#dc6803" stroke-width="2"/>`);
    } else {
      parts.push(`<rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="10" fill="#f8fafc" stroke="#475467" stroke-width="2"/>`);
    }
    const nodeLines = wrapFlowLabel(node.label);
    const spans = nodeLines.map((part, index) => `<tspan x="${position.x + nodeWidth / 2}" dy="${index === 0 ? 0 : 20}">${escapeXml(part)}</tspan>`).join("");
    parts.push(`<text x="${position.x + nodeWidth / 2}" y="${position.y + nodeHeight / 2 - (node.label.length > 20 ? 8 : 0)}" text-anchor="middle" font-size="14" fill="#101828">${spans}</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

function parseFlowNode(token: string): FlowNode {
  const match = token.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\s*(\[|\{|\()\s*"?([^\]\}\)";]+)"?\s*(?:\]|\}|\)))?$/);
  if (!match) throw new Error("流程图节点语法不受支持。");
  return { id: match[1], label: cleanFlowLabel(match[3] ?? match[1], 80), decision: match[2] === "{" };
}

function rememberFlowNode(nodes: Map<string, FlowNode>, node: FlowNode): void {
  const existing = nodes.get(node.id);
  if (!existing || existing.label === existing.id) nodes.set(node.id, node);
}

function cleanFlowLabel(value: string, maxLength: number): string {
  const cleaned = value.replace(/[<>`]/g, " ").replace(/\\n|<br\s*\/?\s*>/gi, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, maxLength) || "未命名节点";
}

function wrapFlowLabel(value: string): string[] {
  if (value.length <= 20) return [value];
  return [value.slice(0, 20), value.slice(20, 40)];
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sha256Hex(value: string): string {
  const bytes = [...new TextEncoder().encode(value)];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotate = (word: number, bits: number) => (word >>> bits) | (word << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function mountSanitizedSvg(container: HTMLElement, svg: string): void {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.documentElement.localName !== "svg" || parsed.querySelector("parsererror")) throw new Error("流程图 SVG 无法挂载。");
  container.replaceChildren(document.importNode(parsed.documentElement, true));
}

export function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
