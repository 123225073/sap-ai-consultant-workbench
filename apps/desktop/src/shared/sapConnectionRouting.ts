import type { AdtConfig, SapGuiDiscoveryEntry, SapSystemEnvironment } from "./workbenchTypes";

export interface SapConnectionRouteDecision {
  connectionIds: string[];
  reason: string;
  needsConfirmation: boolean;
  crossSystem: boolean;
}

const environmentTerms: Record<SapSystemEnvironment, string[]> = {
  development: ["DEV", "DEVELOPMENT", "开发"],
  quality: ["QA", "QAS", "QUALITY", "集成测试", "质量", "测试"],
  production: ["PRD", "PROD", "PRODUCTION", "生产"],
  sandbox: ["SBX", "SANDBOX", "沙箱"],
  other: []
};

function normalizedText(value: string): string {
  return value.normalize("NFKC").toUpperCase();
}

function normalizedSapHost(value: string): string {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^\/\//, "").split(/[/:]/)[0].toLowerCase();
  }
}

export function matchesDiscoveredSapEndpoint(connection: AdtConfig, entry: SapGuiDiscoveryEntry): boolean {
  if (normalizedSapHost(connection.url) !== normalizedSapHost(entry.host)) return false;
  const connectionSystemId = connection.systemId.trim().toUpperCase();
  const discoveredSystemId = entry.systemId.trim().toUpperCase();
  if (connectionSystemId && discoveredSystemId && connectionSystemId !== discoveredSystemId) return false;
  if (connection.instanceNumber && entry.instanceNumber && connection.instanceNumber !== entry.instanceNumber) return false;
  return true;
}

function containsTerm(haystack: string, term: string): boolean {
  const normalized = normalizedText(term.trim());
  if (!normalized) return false;
  if (/^[A-Z0-9_-]+$/.test(normalized)) {
    return new RegExp(`(^|[^A-Z0-9_-])${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9_-]|$)`).test(haystack);
  }
  return haystack.includes(normalized);
}

function scoreConnection(connection: AdtConfig, query: string): { score: number; directClient: boolean; directSystem: boolean; directEnvironment: boolean } {
  let score = 0;
  const directSystem = containsTerm(query, connection.systemId);
  const clientTermMatched = containsTerm(query, connection.client);
  const explicitClientPattern = new RegExp(`(?:(?:CLIENT|MANDANT|客户端|客户号|租户|系统)\\s*[:#/-]?\\s*${connection.client}(?:\\D|$)|(?:^|\\D)${connection.client}\\s*(?:系统|客户端|CLIENT)(?:\\D|$))`, "i");
  const directClient = clientTermMatched && (directSystem || explicitClientPattern.test(query));
  const directEnvironment = environmentTerms[connection.environment].some((term) => containsTerm(query, term));
  if (directClient) score += 120;
  if (directSystem) score += 100;
  if (containsTerm(query, connection.alias)) score += 80;
  if (connection.usage && containsTerm(query, connection.usage)) score += 50;
  for (const keyword of connection.routingKeywords) {
    if (containsTerm(query, keyword)) score += 40;
  }
  if (directEnvironment) score += 25;
  return { score, directClient, directSystem, directEnvironment };
}

function isVerified(connection: AdtConfig): boolean {
  return connection.readOnly === true
    && connection.connectionStatus === "verified"
    && connection.minimalReadStatus === "verified"
    && connection.lastVerificationMode === "adt";
}

function onePerSystem(scored: Array<{ connection: AdtConfig; score: number; directClient: boolean }>): AdtConfig[] {
  const chosen = new Map<string, { connection: AdtConfig; score: number; directClient: boolean }>();
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    const key = item.connection.systemId.trim().toUpperCase() || item.connection.url.trim().toUpperCase();
    const current = chosen.get(key);
    if (!current || (item.directClient && !current.directClient) || item.score > current.score) chosen.set(key, item);
  }
  return [...chosen.values()].map((item) => item.connection);
}

export function routeSapConnections(
  connections: AdtConfig[],
  queryContext: string,
  activeConnectionId: string
): SapConnectionRouteDecision {
  const available = connections.filter(isVerified);
  if (available.length === 0) {
    return { connectionIds: [], reason: "当前 Project 没有已通过真实只读验证的 SAP 连接。", needsConfirmation: false, crossSystem: false };
  }

  const query = normalizedText(queryContext.slice(-6000));
  const scored = available
    .map((connection) => ({ connection, ...scoreConnection(connection, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const crossIntent = /(交叉验证|交叉检查|对比|比较|差异|CROSS[- ]?CHECK|COMPARE)/i.test(queryContext);

  if (crossIntent && scored.length > 1) {
    const selected = onePerSystem(scored.filter((item) => item.directClient || item.directSystem || item.directEnvironment || item.score >= 50));
    if (selected.length > 1) {
      return {
        connectionIds: selected.map((item) => item.id),
        reason: `识别到交叉验证意图，将从 ${selected.map((item) => `${item.systemId || item.alias}/${item.client}`).join("、")} 读取同一对象。`,
        needsConfirmation: true,
        crossSystem: true
      };
    }
  }

  if (scored.length > 0) {
    const highestScore = scored[0].score;
    const tied = scored.filter((item) => item.score === highestScore);
    const best = tied.find((item) => item.connection.id === activeConnectionId) ?? tied[0];
    return {
      connectionIds: [best.connection.id],
      reason: tied.length > 1
        ? `当前问题同时匹配 ${tied.map((item) => `${item.connection.systemId || item.connection.alias} / Client ${item.connection.client}`).join("、")}；暂按 Project 默认连接建议 ${best.connection.systemId || best.connection.alias} / Client ${best.connection.client}，读取前请确认。`
        : `已根据当前问题匹配 ${best.connection.systemId || best.connection.alias} / Client ${best.connection.client}。`,
      needsConfirmation: tied.length > 1,
      crossSystem: false
    };
  }

  const fallback = available.find((item) => item.id === activeConnectionId) ?? available[0];
  return {
    connectionIds: [fallback.id],
    reason: `当前问题未明确系统，使用 Project 默认连接 ${fallback.systemId || fallback.alias} / Client ${fallback.client}。`,
    needsConfirmation: available.length > 1,
    crossSystem: false
  };
}
