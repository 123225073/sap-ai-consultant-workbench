import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AdtEndpointResolutionSource =
  | "explicit-url"
  | "sap-gui-landscape"
  | "sap-logon-ini"
  | "sap-gui-port"
  | "host-default";

export interface AdtEndpointCandidate {
  url: string;
  source: AdtEndpointResolutionSource;
  host: string;
  instanceNumber: string;
  description?: string;
  systemId?: string;
}

interface SapGuiEntry {
  source: "sap-gui-landscape" | "sap-logon-ini";
  description?: string;
  systemId?: string;
  host: string;
  instanceNumber: string;
}

interface SapGuiConfigFixture {
  kind: "landscape" | "saplogon";
  content: string;
}

interface ResolveOptions {
  files?: SapGuiConfigFixture[];
}

const DEFAULT_INSTANCE_NUMBER = "00";
const SAP_GUI_LANDSCAPE_FILE = "SAPUILandscape.xml";
const SAP_GUI_GLOBAL_LANDSCAPE_FILE = "SAPUILandscapeGlobal.xml";
const SAP_LOGON_INI_FILE = "saplogon.ini";

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeInstanceNumber(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (/^\d{2}$/.test(trimmed)) return trimmed;
  if (/^32\d{2}$/.test(trimmed) || /^33\d{2}$/.test(trimmed) || /^36\d{2}$/.test(trimmed)) {
    return trimmed.slice(-2);
  }
  if (/^80\d{2}$/.test(trimmed)) return trimmed.slice(-2);
  if (/^443\d{2}$/.test(trimmed)) return trimmed.slice(-2);
  return null;
}

function isValidHost(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed || trimmed.length > 253) return false;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("@")) return false;
  return /^[A-Za-z0-9.-]+$/.test(trimmed) || /^\[[0-9A-Fa-f:.]+\]$/.test(trimmed);
}

function normalizeHost(host: string): string {
  return host.trim().replace(/\.$/, "");
}

function candidateKey(candidate: AdtEndpointCandidate): string {
  return `${candidate.url}|${candidate.source}`;
}

function uniqueCandidates(candidates: AdtEndpointCandidate[]): AdtEndpointCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function adtCandidatesForHost(
  host: string,
  instanceNumber: string,
  source: AdtEndpointResolutionSource,
  metadata: Pick<AdtEndpointCandidate, "description" | "systemId"> = {}
): AdtEndpointCandidate[] {
  const normalizedHost = normalizeHost(host);
  const normalizedInstance = normalizeInstanceNumber(instanceNumber) ?? DEFAULT_INSTANCE_NUMBER;
  return [
    {
      url: `https://${normalizedHost}:443${normalizedInstance}`,
      source,
      host: normalizedHost,
      instanceNumber: normalizedInstance,
      ...metadata
    }
  ];
}

function parseHostAndPort(value: string): { host: string; port: string | null } | null {
  const trimmed = value.trim().replace(/^\/\//, "");
  if (!trimmed || trimmed.startsWith("/H/")) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("@") || trimmed.includes("?") || trimmed.includes("#")) {
    return null;
  }
  const ipv6Match = trimmed.match(/^(\[[0-9A-Fa-f:.]+\])(?::(\d{2,5}))?$/);
  if (ipv6Match) return { host: ipv6Match[1], port: ipv6Match[2] ?? null };
  const hostPortMatch = trimmed.match(/^([A-Za-z0-9.-]+)(?::(\d{2,5}))?$/);
  if (!hostPortMatch) return null;
  return { host: hostPortMatch[1], port: hostPortMatch[2] ?? null };
}

function candidatesFromHostInput(value: string, source: AdtEndpointResolutionSource): AdtEndpointCandidate[] {
  const parsed = parseHostAndPort(value);
  if (!parsed || !isValidHost(parsed.host)) return [];
  if (parsed.port) {
    const instanceNumber = normalizeInstanceNumber(parsed.port);
    if (!instanceNumber) return [];
    if (parsed.port.startsWith("443")) {
      return [{
        url: `https://${normalizeHost(parsed.host)}:${parsed.port}`,
        source,
        host: normalizeHost(parsed.host),
        instanceNumber
      }];
    }
    if (parsed.port.startsWith("80")) {
      return [{
        url: `https://${normalizeHost(parsed.host)}:443${instanceNumber}`,
        source,
        host: normalizeHost(parsed.host),
        instanceNumber
      }];
    }
    return adtCandidatesForHost(parsed.host, instanceNumber, source);
  }
  return adtCandidatesForHost(parsed.host, DEFAULT_INSTANCE_NUMBER, source);
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g;
  for (const match of tag.matchAll(attributePattern)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function parseLandscapeEntries(content: string): SapGuiEntry[] {
  const entries: SapGuiEntry[] = [];
  const serviceTags = content.match(/<Service\b[^>]*>/gi) ?? [];
  for (const tag of serviceTags) {
    const attrs = parseAttributes(tag);
    if ((attrs.type ?? "").toUpperCase() !== "SAPGUI") continue;
    const server = attrs.server ?? "";
    const parsed = parseHostAndPort(server);
    if (!parsed || !isValidHost(parsed.host)) continue;
    const instanceNumber = normalizeInstanceNumber(parsed.port ?? "");
    if (!instanceNumber) continue;
    entries.push({
      source: "sap-gui-landscape",
      description: attrs.name,
      systemId: attrs.systemid,
      host: parsed.host,
      instanceNumber
    });
  }
  return entries;
}

function parseIniSections(content: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = new Map<string, string>();
      sections.set(sectionMatch[1], current);
      continue;
    }
    if (!current) continue;
    const itemMatch = line.match(/^(Item\d+)=(.*)$/);
    if (itemMatch) current.set(itemMatch[1], itemMatch[2].trim());
  }
  return sections;
}

function parseSapLogonIniEntries(content: string): SapGuiEntry[] {
  const sections = parseIniSections(content);
  const descriptions = sections.get("Description") ?? new Map<string, string>();
  const servers = sections.get("Server") ?? new Map<string, string>();
  const databases = sections.get("Database") ?? new Map<string, string>();
  const systemNumbers = sections.get("SystemNumber") ?? new Map<string, string>();
  const messageServers = sections.get("MSSrvName") ?? new Map<string, string>();
  const entries: SapGuiEntry[] = [];

  for (const [item, serverValue] of servers) {
    const fallbackMessageServer = messageServers.get(item) ?? "";
    const hostValue = serverValue.toUpperCase() === "PUBLIC" && fallbackMessageServer ? fallbackMessageServer : serverValue;
    const parsed = parseHostAndPort(hostValue);
    if (!parsed || !isValidHost(parsed.host)) continue;
    const instanceNumber = normalizeInstanceNumber(systemNumbers.get(item)) ?? normalizeInstanceNumber(databases.get(item));
    if (!instanceNumber) continue;
    entries.push({
      source: "sap-logon-ini",
      description: descriptions.get(item),
      host: parsed.host,
      instanceNumber
    });
  }
  return entries;
}

function entryMatchesInput(entry: SapGuiEntry, input: string): boolean {
  const normalizedInput = normalizeText(input);
  const parsedInput = parseHostAndPort(input);
  const inputHost = parsedInput ? normalizeText(parsedInput.host) : normalizedInput;
  const names = [
    entry.host,
    entry.description ?? "",
    entry.systemId ?? ""
  ].filter(Boolean).map(normalizeText);
  return names.includes(normalizedInput) || names.includes(inputHost);
}

function candidatesFromEntries(input: string, entries: SapGuiEntry[]): AdtEndpointCandidate[] {
  const matches = entries.filter((entry) => entryMatchesInput(entry, input));
  return uniqueCandidates(matches.flatMap((entry) => adtCandidatesForHost(
    entry.host,
    entry.instanceNumber,
    entry.source,
    {
      description: entry.description,
      systemId: entry.systemId
    }
  )));
}

function defaultSapGuiConfigPaths(): Array<{ kind: "landscape" | "saplogon"; filePath: string }> {
  const appData = process.env.APPDATA;
  const programData = process.env.ProgramData;
  const home = os.homedir();
  const commonDirs = uniqueStrings([
    appData ? path.join(appData, "SAP", "Common") : "",
    home ? path.join(home, "AppData", "Roaming", "SAP", "Common") : "",
    programData ? path.join(programData, "SAP", "Common") : "",
    programData ? path.join(programData, "SAP") : ""
  ].filter(Boolean));

  return commonDirs.flatMap((dir) => [
    { kind: "landscape" as const, filePath: path.join(dir, SAP_GUI_LANDSCAPE_FILE) },
    { kind: "landscape" as const, filePath: path.join(dir, SAP_GUI_GLOBAL_LANDSCAPE_FILE) },
    { kind: "saplogon" as const, filePath: path.join(dir, SAP_LOGON_INI_FILE) }
  ]);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

async function readLocalSapGuiEntries(): Promise<SapGuiEntry[]> {
  const entries: SapGuiEntry[] = [];
  for (const item of defaultSapGuiConfigPaths()) {
    try {
      const content = await readFile(item.filePath, "utf8");
      entries.push(...(item.kind === "landscape" ? parseLandscapeEntries(content) : parseSapLogonIniEntries(content)));
    } catch {
      // Missing SAP GUI config files are normal on non-Windows or clean machines.
    }
  }
  return entries;
}

function entriesFromFixtures(files: SapGuiConfigFixture[]): SapGuiEntry[] {
  return files.flatMap((file) => file.kind === "landscape" ? parseLandscapeEntries(file.content) : parseSapLogonIniEntries(file.content));
}

function explicitUrlCandidate(input: string): AdtEndpointCandidate | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    throw new Error("SAP ADT 地址必须使用 HTTPS，已拒绝可能暴露密码的 HTTP 连接。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("SAP 地址不能包含用户名或密码。");
  }
  if (!parsed.hostname || !parsed.port) {
    throw new Error("完整 ADT 地址需要包含主机和端口。");
  }
  return {
    url: `${parsed.protocol}//${parsed.host}`,
    source: "explicit-url",
    host: parsed.hostname,
    instanceNumber: normalizeInstanceNumber(parsed.port) ?? DEFAULT_INSTANCE_NUMBER
  };
}

export async function resolveAdtEndpointCandidates(input: string, options: ResolveOptions = {}): Promise<AdtEndpointCandidate[]> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    const explicit = explicitUrlCandidate(trimmed);
    return explicit ? [explicit] : [];
  }

  const localEntries = options.files ? entriesFromFixtures(options.files) : await readLocalSapGuiEntries();
  const fromLocalSapGui = candidatesFromEntries(trimmed, localEntries);
  if (fromLocalSapGui.length > 0) return fromLocalSapGui;

  if (parseHostAndPort(trimmed)?.port) {
    const fromGuiPort = candidatesFromHostInput(trimmed, "sap-gui-port");
    if (fromGuiPort.length > 0) return uniqueCandidates(fromGuiPort);
  }

  return uniqueCandidates(candidatesFromHostInput(trimmed, "host-default"));
}
