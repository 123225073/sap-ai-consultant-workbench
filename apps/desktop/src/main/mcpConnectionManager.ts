import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  McpConnectionRecord,
  McpConnectionScope,
  McpConnectionState,
  McpConnectionSummary,
  McpDiscoverySnapshot,
  McpHttpTransportConfig,
  McpManagerHealth,
  McpOperationContext,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpToolCallInput,
  McpToolCallResult,
  McpToolDescriptor,
  McpToolRisk,
  McpTransportConfig,
  UpsertMcpConnectionInput
} from "../shared/mcpTypes";
import { assertPublicModelEndpoint } from "./modelEndpointSecurity";

const STORAGE_SCHEMA_VERSION = 1;
const CONNECTION_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_CONNECTIONS = 100;
const MAX_DISCOVERY_ITEMS = 2_000;
const MAX_DISCOVERY_PAGES = 20;
const MAX_HTTP_RESPONSE_BYTES = 1024 * 1024;
const MAX_DISCOVERY_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_DISCOVERY_TOTAL_MS = 60_000;
const MAX_DISCOVERY_CURSOR_CHARS = 2_048;
const MAX_DISCOVERY_STRUCTURE_DEPTH = 12;
const MAX_RESULT_CHARS = 64_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SAFE_HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const SECRET_REF = /^secure-store:[A-Za-z0-9._:-]{1,220}$/;
const FORBIDDEN_SAP_MUTATION = /(?:^|[._:/-])(?:create|change|update|write|delete|remove|activate|deactivate|release|transport|post|commit|rollback|upload|import)(?:$|[._:/-])/i;
const SENSITIVE_KEY = /(?:api[_-]?key|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token)/i;
const SENSITIVE_TEXT = [
  /bearer\s+[a-z0-9._~+/=-]{12,}/gi,
  /(?:authorization|cookie|api[_-]?key|password|passwd|secret|token)\s*[:=]\s*[^\n\r,;}]+/gi
];

interface StoredMcpFile {
  schemaVersion: number;
  connections: McpConnectionRecord[];
}

interface RuntimeConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  state: McpConnectionState;
  statusMessage: string;
  discovery: McpDiscoverySnapshot | null;
}

interface ConnectFlight {
  controller: AbortController;
  promise: Promise<McpConnectionSummary>;
}

export interface McpSecretResolutionContext {
  connectionId: string;
  scope: McpConnectionScope;
  headerName: string;
  purpose: "mcp-http-header";
}

export type McpSecretResolver = (secretRef: string, context: McpSecretResolutionContext) => Promise<string>;

export class McpConnectionError extends Error {
  constructor(
    readonly code:
      | "invalid-config"
      | "not-found"
      | "disabled"
      | "not-connected"
      | "tool-disabled"
      | "approval-required"
      | "sap-mutation-forbidden"
      | "connection-failed"
      | "request-failed",
    message: string
  ) {
    super(redactText(message).slice(0, 800));
    this.name = "McpConnectionError";
  }
}

export class McpConnectionManager {
  private readonly storagePath: string;
  private readonly backupPath: string;
  private records: McpConnectionRecord[] = [];
  private runtimes = new Map<string, RuntimeConnection>();
  private connectFlights = new Map<string, ConnectFlight>();
  private testFlights = new Map<string, AbortController>();
  private discoveryCache = new Map<string, McpDiscoverySnapshot>();
  private initialized = false;
  private mutationQueue: Promise<void> = Promise.resolve();
  private warning: string | null = null;

  constructor(
    storageRoot: string,
    private readonly resolveSecret: McpSecretResolver = async () => {
      throw new McpConnectionError("invalid-config", "MCP 连接引用了密钥，但安全存储解析器尚未配置。");
    }
  ) {
    if (typeof storageRoot !== "string" || !storageRoot.trim()) {
      throw new McpConnectionError("invalid-config", "MCP 存储目录无效。");
    }
    this.storagePath = path.join(path.resolve(storageRoot), "mcp-connections.json");
    this.backupPath = `${this.storagePath}.previous`;
  }

  async initialize(): Promise<McpManagerHealth> {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true, mode: 0o700 });
    this.records = await this.readStorageWithRecovery();
    this.initialized = true;
    return this.getHealth();
  }

  getHealth(): McpManagerHealth {
    return {
      ok: this.initialized,
      storagePath: this.storagePath,
      connectionCount: this.records.length,
      connectedCount: [...this.runtimes.values()].filter((item) => item.state === "connected").length,
      warning: this.warning
    };
  }

  listConnections(): McpConnectionSummary[] {
    this.assertInitialized();
    return this.records.map((record) => this.toSummary(record)).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async upsertConnection(input: UpsertMcpConnectionInput, context: McpOperationContext): Promise<McpConnectionSummary> {
    this.assertInitialized();
    const normalized = await normalizeConnectionInput(input);
    const operationContext = normalizeOperationContext(context);
    return this.enqueueMutation(async () => {
      const existing = normalized.id ? this.records.find((item) => item.id === normalized.id) : undefined;
      if (existing) {
        assertScopeOwnedByCurrentProject(existing.scope, operationContext);
        if (!sameScope(existing.scope, normalized.scope)) {
          throw new McpConnectionError("invalid-config", "MCP 连接的全局/Project 范围和所属 Project 创建后不可更改。");
        }
      } else {
        assertScopeOwnedByCurrentProject(normalized.scope, operationContext);
      }
      if (!existing && this.records.length >= MAX_CONNECTIONS) {
        throw new McpConnectionError("invalid-config", `MCP 连接数量已达到 ${MAX_CONNECTIONS} 个安全上限。`);
      }
      const now = new Date().toISOString();
      const record: McpConnectionRecord = existing
        ? {
            ...existing,
            name: normalized.name,
            description: normalized.description,
            scope: existing.scope,
            transport: normalized.transport,
            enabled: false,
            enabledTools: [],
            approvedReadOnlyTools: [],
            updatedAt: now,
            lastTestSucceeded: null,
            lastTestMessage: "连接配置已修改，需要重新测试。"
          }
        : {
            id: `mcp-${randomUUID()}`,
            name: normalized.name,
            description: normalized.description,
            scope: normalized.scope,
            transport: normalized.transport,
            enabled: false,
            enabledTools: [],
            approvedReadOnlyTools: [],
            createdAt: now,
            updatedAt: now,
            lastTestedAt: null,
            lastTestSucceeded: null,
            lastTestMessage: null
          };
      if (existing) {
        this.testFlights.get(existing.id)?.abort(createAbortError("MCP 连接配置已修改，旧测试已取消。"));
        await this.disconnect(existing.id);
        this.discoveryCache.delete(existing.id);
        this.records = this.records.map((item) => item.id === existing.id ? record : item);
      } else {
        this.records.push(record);
      }
      await this.persist();
      return this.toSummary(record);
    });
  }

  async removeConnection(connectionId: string, context: McpOperationContext): Promise<boolean> {
    this.assertInitialized();
    const id = safeId(connectionId, "MCP 连接 ID");
    const operationContext = normalizeOperationContext(context);
    return this.enqueueMutation(async () => {
      const record = this.records.find((item) => item.id === id);
      if (!record) return false;
      assertScopeOwnedByCurrentProject(record.scope, operationContext);
      this.testFlights.get(id)?.abort(createAbortError("MCP 连接已移除，测试已取消。"));
      await this.disconnect(id);
      this.discoveryCache.delete(id);
      this.records = this.records.filter((item) => item.id !== id);
      await this.persist();
      return true;
    });
  }

  async testConnection(connectionId: string, context: McpOperationContext, signal?: AbortSignal): Promise<McpDiscoverySnapshot> {
    this.assertInitialized();
    const record = this.requireRecord(connectionId, normalizeOperationContext(context));
    const testedRevision = record.updatedAt;
    this.testFlights.get(record.id)?.abort(createAbortError("已开始新的 MCP 连接测试。"));
    const controller = new AbortController();
    const detachAbortListener = forwardAbort(signal, controller);
    this.testFlights.set(record.id, controller);
    let session: RuntimeConnection | null = null;
    const isCurrentTest = () => this.testFlights.get(record.id) === controller && !controller.signal.aborted;
    try {
      session = await this.openSession(record, controller.signal);
      const discovery = await this.discover(record, session.client, controller.signal);
      if (!isCurrentTest()) throw createAbortError("MCP 连接测试已被新的测试取代。");
      await this.updateTestResult(record.id, testedRevision, true, `连接成功，发现 ${discovery.tools.length} 个工具。`, isCurrentTest);
      if (!isCurrentTest()) throw createAbortError("MCP 连接测试已被新的测试取代。");
      this.discoveryCache.set(record.id, discovery);
      return discovery;
    } catch (error) {
      const message = chineseConnectionError(error);
      if (this.testFlights.get(record.id) === controller) {
        this.discoveryCache.delete(record.id);
        await this.updateTestResult(record.id, testedRevision, false, message, isCurrentTest).catch(() => undefined);
      }
      throw new McpConnectionError("connection-failed", message);
    } finally {
      detachAbortListener();
      if (this.testFlights.get(record.id) === controller) this.testFlights.delete(record.id);
      if (session) await closeRuntime(session);
    }
  }

  async setConnectionEnabled(connectionId: string, enabled: boolean, context: McpOperationContext): Promise<McpConnectionSummary> {
    this.assertInitialized();
    const operationContext = normalizeOperationContext(context);
    const record = this.requireRecord(connectionId, operationContext);
    if (typeof enabled !== "boolean") throw new McpConnectionError("invalid-config", "MCP 启停状态无效。");
    if (enabled && record.lastTestSucceeded !== true) {
      throw new McpConnectionError("disabled", "请先测试 MCP 连接，确认可用后再启用。");
    }
    record.enabled = enabled;
    record.updatedAt = new Date().toISOString();
    if (!enabled) {
      record.enabledTools = [];
      record.approvedReadOnlyTools = [];
      await this.disconnect(record.id);
      await this.persist();
      return this.toSummary(record);
    }
    await this.persist();
    try {
      return await this.connect(record.id, operationContext);
    } catch (error) {
      record.enabled = false;
      record.enabledTools = [];
      record.approvedReadOnlyTools = [];
      record.updatedAt = new Date().toISOString();
      await this.persist();
      throw error;
    }
  }

  async connect(connectionId: string, context?: McpOperationContext, signal?: AbortSignal): Promise<McpConnectionSummary> {
    this.assertInitialized();
    const record = this.requireRecord(connectionId, context ? normalizeOperationContext(context) : undefined);
    if (!record.enabled) throw new McpConnectionError("disabled", "该 MCP 连接尚未启用。");
    const current = this.runtimes.get(record.id);
    if (current?.state === "connected") return this.toSummary(record);
    const activeFlight = this.connectFlights.get(record.id);
    if (activeFlight) return waitForConnectFlight(activeFlight, signal);

    const controller = new AbortController();
    const promise = this.connectOnce(record, controller.signal).finally(() => {
      if (this.connectFlights.get(record.id)?.promise === promise) this.connectFlights.delete(record.id);
    });
    const flight = { controller, promise };
    this.connectFlights.set(record.id, flight);
    return waitForConnectFlight(flight, signal);
  }

  async disconnect(connectionId: string): Promise<void> {
    const id = safeId(connectionId, "MCP 连接 ID");
    const flight = this.connectFlights.get(id);
    flight?.controller.abort(createAbortError("MCP 连接已取消。"));
    const runtime = this.runtimes.get(id);
    this.runtimes.delete(id);
    if (runtime) await closeRuntime(runtime);
    if (flight) await Promise.allSettled([flight.promise]);
    const lateRuntime = this.runtimes.get(id);
    this.runtimes.delete(id);
    if (lateRuntime && lateRuntime !== runtime) await closeRuntime(lateRuntime);
  }

  async disconnectAll(): Promise<void> {
    for (const controller of this.testFlights.values()) controller.abort(createAbortError("MCP 连接测试已取消。"));
    this.testFlights.clear();
    const flights = [...this.connectFlights.values()];
    for (const flight of flights) flight.controller.abort(createAbortError("MCP 连接已取消。"));
    await Promise.allSettled(flights.map((flight) => flight.promise));
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.allSettled(runtimes.map(closeRuntime));
  }

  async setToolEnabled(
    connectionId: string,
    toolName: string,
    enabled: boolean,
    context: McpOperationContext,
    options?: { confirmReadOnly?: boolean }
  ): Promise<McpConnectionSummary> {
    const record = this.requireRecord(connectionId, normalizeOperationContext(context));
    if (!record.enabled) throw new McpConnectionError("disabled", "请先启用 MCP 连接，再选择可用工具。");
    const name = safeToolName(toolName);
    const runtime = this.runtimes.get(record.id);
    const discovery = runtime?.discovery ?? this.discoveryCache.get(record.id);
    const tool = discovery?.tools.find((item) => item.name === name);
    if (!tool) throw new McpConnectionError("not-connected", "请先测试连接并读取 MCP 工具清单。");
    if (tool.risk === "destructive" || isForbiddenSapMutation(name)) {
      throw new McpConnectionError("sap-mutation-forbidden", "涉及破坏性操作或 SAP 写入的 MCP 工具不能启用。");
    }
    const enabledTools = new Set(record.enabledTools);
    const approvedReadOnlyTools = new Set(record.approvedReadOnlyTools);
    if (enabled) {
      void options;
      throw new McpConnectionError(
        "approval-required",
        "稳定版只开放 MCP 连接、测试和能力发现；外部工具尚未进入自动执行链，不能在这里启用。"
      );
    } else {
      enabledTools.delete(name);
      approvedReadOnlyTools.delete(name);
    }
    record.enabledTools = [...enabledTools].sort();
    record.approvedReadOnlyTools = [...approvedReadOnlyTools].sort();
    record.updatedAt = new Date().toISOString();
    await this.persist();
    return this.toSummary(record);
  }

  async callTool(input: McpToolCallInput): Promise<McpToolCallResult> {
    const record = this.requireRecord(input.connectionId);
    const name = safeToolName(input.toolName);
    if (!record.enabled) throw new McpConnectionError("disabled", "该 MCP 连接尚未启用。");
    if (isForbiddenSapMutation(name)) {
      throw new McpConnectionError("sap-mutation-forbidden", "涉及破坏性操作或 SAP 写入的 MCP 工具已被硬性阻止。");
    }
    void input.arguments;
    void input.userConfirmedRisk;
    void input.signal;
    throw new McpConnectionError("approval-required", "稳定版不允许模型或页面直接执行外部 MCP 工具。");
  }

  async close(): Promise<void> {
    await this.disconnectAll();
  }

  private async connectOnce(record: McpConnectionRecord, signal: AbortSignal): Promise<McpConnectionSummary> {
    let runtime: RuntimeConnection | null = null;
    try {
      runtime = await this.openSession(record, signal);
      runtime.discovery = await this.discover(record, runtime.client, signal);
      if (signal.aborted) throw createAbortError("MCP 连接已取消。");
      this.discoveryCache.set(record.id, runtime.discovery);
      runtime.state = "connected";
      runtime.statusMessage = `已连接，发现 ${runtime.discovery.tools.length} 个工具。`;
      this.runtimes.set(record.id, runtime);
      return this.toSummary(record);
    } catch (error) {
      if (runtime) await closeRuntime(runtime);
      this.runtimes.delete(record.id);
      throw new McpConnectionError("connection-failed", chineseConnectionError(error));
    }
  }

  private async openSession(record: McpConnectionRecord, signal?: AbortSignal): Promise<RuntimeConnection> {
    if (record.transport.type !== "streamable-http") {
      throw new McpConnectionError(
        "invalid-config",
        "首个稳定版已禁用 STDIO MCP，不能运行任意本机命令；仅允许 HTTPS Streamable HTTP。"
      );
    }
    const client = new Client({ name: "sap-ai-consultant-workbench", version: "0.1.0" }, { capabilities: {} });
    const transport = await this.createHttpTransport(record);
    try {
      await client.connect(transport, {
        timeout: CONNECTION_TIMEOUT_MS,
        maxTotalTimeout: CONNECTION_TIMEOUT_MS,
        signal
      });
      return { client, transport, state: "connected", statusMessage: "已连接", discovery: null };
    } catch (error) {
      await Promise.allSettled([client.close(), transport.close()]);
      throw error;
    }
  }

  private async createHttpTransport(record: McpConnectionRecord): Promise<StreamableHTTPClientTransport> {
    const config = record.transport;
    if (config.type !== "streamable-http") {
      throw new McpConnectionError("invalid-config", "当前 MCP 连接不是 HTTPS Streamable HTTP。");
    }
    const headers = new Headers();
    for (const [name, ref] of Object.entries(config.headerRefs)) {
      headers.set(name, await this.resolveSecret(ref, {
        connectionId: record.id,
        scope: record.scope,
        headerName: name,
        purpose: "mcp-http-header"
      }));
    }
    const secureFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
      await assertSafeHttpEndpoint(url);
      const response = await fetch(input, { ...init, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) throw new Error("MCP 服务返回重定向，已阻止跳转。");
      return boundedResponse(response, MAX_HTTP_RESPONSE_BYTES);
    };
    return new StreamableHTTPClientTransport(new URL(config.endpoint), {
      requestInit: { headers },
      fetch: secureFetch,
      reconnectionOptions: {
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 5_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0
      }
    });
  }

  private async discover(record: McpConnectionRecord, client: Client, signal?: AbortSignal): Promise<McpDiscoverySnapshot> {
    const budget = new DiscoveryBudget();
    const capabilities = client.getServerCapabilities();
    const tools = capabilities?.tools ? await listAllTools(client, record, budget, signal) : [];
    const resources = capabilities?.resources ? await listAllResources(client, budget, signal) : [];
    const prompts = capabilities?.prompts ? await listAllPrompts(client, budget, signal) : [];
    const version = client.getServerVersion();
    return {
      connectionId: record.id,
      serverName: safeDisplayText(version?.name, "未命名 MCP 服务", 200),
      serverVersion: safeDisplayText(version?.version, "未知版本", 100),
      serverInstructionsIgnored: Boolean(client.getInstructions()?.trim()),
      tools,
      resources,
      prompts,
      discoveredAt: new Date().toISOString()
    };
  }

  private requireRecord(connectionId: string, context?: McpOperationContext): McpConnectionRecord {
    this.assertInitialized();
    const id = safeId(connectionId, "MCP 连接 ID");
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new McpConnectionError("not-found", "MCP 连接不存在。");
    if (context) assertScopeOwnedByCurrentProject(record.scope, context);
    return record;
  }

  private toSummary(record: McpConnectionRecord): McpConnectionSummary {
    const runtime = this.runtimes.get(record.id);
    const connecting = this.connectFlights.has(record.id);
    const knownDiscovery = runtime?.discovery ?? this.discoveryCache.get(record.id) ?? null;
    const discovery = knownDiscovery
      ? clone(discoveryWithEnabledTools(knownDiscovery, record.enabledTools, record.approvedReadOnlyTools))
      : null;
    return {
      ...clone(record),
      state: runtime?.state ?? (connecting ? "connecting" : "disconnected"),
      statusMessage: runtime?.statusMessage ?? (connecting ? "正在连接" : record.enabled ? "已启用，尚未连接" : "已停用"),
      discovery
    };
  }

  private async updateTestResult(
    connectionId: string,
    testedRevision: string,
    succeeded: boolean,
    message: string,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      if (!isCurrent()) throw createAbortError("MCP 连接测试已被新的测试取代。");
      const record = this.requireRecord(connectionId);
      if (record.updatedAt !== testedRevision) {
        throw new McpConnectionError("invalid-config", "MCP 连接配置已在测试期间修改，旧测试结果已丢弃。请重新测试。");
      }
      record.lastTestedAt = new Date().toISOString();
      record.lastTestSucceeded = succeeded;
      record.lastTestMessage = redactText(message).slice(0, 800);
      record.updatedAt = record.lastTestedAt;
      if (!succeeded) {
        record.enabled = false;
        record.enabledTools = [];
        record.approvedReadOnlyTools = [];
      }
      await this.persist();
    });
  }

  private async readStorageWithRecovery(): Promise<McpConnectionRecord[]> {
    const primary = await readStoredFile(this.storagePath).catch((error) => ({ error }));
    if (Array.isArray(primary)) return primary;
    const backup = await readStoredFile(this.backupPath).catch((error) => ({ error }));
    if (Array.isArray(backup)) {
      this.warning = "MCP 主配置无法读取，已从上一份稳定备份恢复。";
      return backup;
    }
    if ("error" in primary && !isMissingFile(primary.error)) {
      await archiveCorrupt(this.storagePath);
      this.warning = "MCP 配置损坏，已隔离并建立新的空配置。";
    }
    return [];
  }

  private async persist(): Promise<void> {
    const payload: StoredMcpFile = { schemaVersion: STORAGE_SCHEMA_VERSION, connections: this.records.map(clone) };
    const temporary = `${this.storagePath}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    await fs.writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    if (await exists(this.storagePath)) await fs.copyFile(this.storagePath, this.backupPath);
    await fs.rename(temporary, this.storagePath);
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new McpConnectionError("invalid-config", "MCP 连接管理器尚未初始化。");
  }
}

async function listAllTools(client: Client, record: McpConnectionRecord, budget: DiscoveryBudget, signal?: AbortSignal): Promise<McpToolDescriptor[]> {
  const result: McpToolDescriptor[] = [];
  let inspectedCount = 0;
  let pageCount = 0;
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    pageCount += 1;
    if (pageCount > MAX_DISCOVERY_PAGES) throw new McpConnectionError("connection-failed", "MCP 工具分页数量超过安全上限。");
    const page = await client.listTools(cursor ? { cursor } : undefined, budget.requestOptions(signal));
    budget.consume(page, "工具目录");
    for (const tool of page.tools) {
      inspectedCount += 1;
      if (inspectedCount > MAX_DISCOVERY_ITEMS) throw new Error("MCP 工具数量超过安全上限。");
      const name = safeToolName(tool.name);
      const annotations = tool.annotations;
      const inputSchema = isPlainObject(tool.inputSchema) ? boundedClone(tool.inputSchema, "工具参数 Schema") : { type: "object" };
      if (schemaContainsSensitiveInput(inputSchema)) continue;
      result.push({
        name,
        namespacedName: `mcp.${record.id}.${name}`,
        title: tool.annotations?.title ? safeDisplayText(tool.annotations.title, null, 200) : null,
        description: safeDisplayText(tool.description, "未提供说明", 2_000),
        inputSchema,
        risk: classifyRisk(name, annotations),
        readOnlyHint: booleanHint(annotations?.readOnlyHint),
        destructiveHint: booleanHint(annotations?.destructiveHint),
        openWorldHint: booleanHint(annotations?.openWorldHint),
        enabled: record.enabledTools.includes(name),
        userApprovedReadOnly: record.approvedReadOnlyTools.includes(name),
        canApproveReadOnly: false
      });
    }
    cursor = nextDiscoveryCursor(page.nextCursor, cursor, seenCursors, "工具");
  } while (cursor);
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function listAllResources(client: Client, budget: DiscoveryBudget, signal?: AbortSignal): Promise<McpResourceDescriptor[]> {
  const result: McpResourceDescriptor[] = [];
  let pageCount = 0;
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    pageCount += 1;
    if (pageCount > MAX_DISCOVERY_PAGES) throw new McpConnectionError("connection-failed", "MCP 资源分页数量超过安全上限。");
    const page = await client.listResources(cursor ? { cursor } : undefined, budget.requestOptions(signal));
    budget.consume(page, "资源目录");
    for (const item of page.resources) {
      if (result.length >= MAX_DISCOVERY_ITEMS) throw new Error("MCP 资源数量超过安全上限。");
      result.push({
        uri: safeDisplayText(item.uri, "", 2_000),
        name: safeDisplayText(item.name, "未命名资源", 300),
        title: item.title ? safeDisplayText(item.title, null, 300) : null,
        description: safeDisplayText(item.description, "", 2_000),
        mimeType: item.mimeType ? safeDisplayText(item.mimeType, null, 200) : null
      });
    }
    cursor = nextDiscoveryCursor(page.nextCursor, cursor, seenCursors, "资源");
  } while (cursor);
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function listAllPrompts(client: Client, budget: DiscoveryBudget, signal?: AbortSignal): Promise<McpPromptDescriptor[]> {
  const result: McpPromptDescriptor[] = [];
  let pageCount = 0;
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    pageCount += 1;
    if (pageCount > MAX_DISCOVERY_PAGES) throw new McpConnectionError("connection-failed", "MCP Prompt 分页数量超过安全上限。");
    const page = await client.listPrompts(cursor ? { cursor } : undefined, budget.requestOptions(signal));
    budget.consume(page, "Prompt 目录");
    for (const item of page.prompts) {
      if (result.length >= MAX_DISCOVERY_ITEMS) throw new Error("MCP Prompt 数量超过安全上限。");
      result.push({
        name: safeToolName(item.name),
        title: item.title ? safeDisplayText(item.title, null, 300) : null,
        description: safeDisplayText(item.description, "", 2_000),
        argumentNames: (item.arguments ?? []).slice(0, 200).map((argument) => safeDisplayText(argument.name, "", 200)).filter(Boolean)
      });
    }
    cursor = nextDiscoveryCursor(page.nextCursor, cursor, seenCursors, "Prompt");
  } while (cursor);
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function normalizeConnectionInput(input: UpsertMcpConnectionInput): Promise<Required<Omit<UpsertMcpConnectionInput, "id">> & { id?: string }> {
  if (!input || typeof input !== "object") throw new McpConnectionError("invalid-config", "MCP 连接配置无效。");
  const id = input.id === undefined ? undefined : safeId(input.id, "MCP 连接 ID");
  const name = safeDisplayText(input.name, "", 100).trim();
  if (!name) throw new McpConnectionError("invalid-config", "MCP 连接名称不能为空。");
  const description = safeDisplayText(input.description, "", 500).trim();
  const scope = normalizeScope(input.scope);
  const transport = await normalizeTransport(input.transport);
  return { id, name, description, scope, transport };
}

function normalizeScope(scope: McpConnectionScope): McpConnectionScope {
  if (!scope || typeof scope !== "object") throw new McpConnectionError("invalid-config", "MCP 连接范围无效。");
  if (scope.type === "global") return { type: "global" };
  if (scope.type === "project") return { type: "project", projectId: safeId(scope.projectId, "Project ID") };
  throw new McpConnectionError("invalid-config", "MCP 连接范围无效。");
}

function normalizeOperationContext(context: McpOperationContext): McpOperationContext {
  if (!context || typeof context !== "object") {
    throw new McpConnectionError("invalid-config", "缺少当前 Project 上下文，已阻止 MCP 操作。");
  }
  if (context.currentProjectId === null) return { currentProjectId: null };
  return { currentProjectId: safeId(context.currentProjectId, "当前 Project ID") };
}

function assertScopeOwnedByCurrentProject(scope: McpConnectionScope, context: McpOperationContext): void {
  if (scope.type === "global") return;
  if (scope.projectId === context.currentProjectId) return;
  throw new McpConnectionError("invalid-config", "当前 Project 无权修改该 MCP 连接，已阻止跨 Project 覆盖。");
}

function sameScope(left: McpConnectionScope, right: McpConnectionScope): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "global" && right.type === "global") return true;
  return left.type === "project" && right.type === "project" && left.projectId === right.projectId;
}

async function normalizeTransport(transport: McpTransportConfig): Promise<McpTransportConfig> {
  if (!transport || typeof transport !== "object") throw new McpConnectionError("invalid-config", "MCP 传输配置无效。");
  if (transport.type === "stdio") {
    throw new McpConnectionError(
      "invalid-config",
      "首个稳定版已禁用 STDIO MCP，不能保存或运行任意本机命令；请改用 HTTPS Streamable HTTP。"
    );
  }
  if (transport.type === "streamable-http") {
    const endpoint = safeDisplayText(transport.endpoint, "", 2_000);
    await assertSafeHttpEndpoint(new URL(endpoint));
    const headerRefs = normalizeSecretRefMap(transport.headerRefs, SAFE_HEADER_NAME, "HTTP Header");
    return { type: "streamable-http", endpoint: new URL(endpoint).toString(), headerRefs };
  }
  throw new McpConnectionError("invalid-config", "首个稳定版仅支持 HTTPS Streamable HTTP MCP 连接。");
}

async function assertSafeHttpEndpoint(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new McpConnectionError("invalid-config", "远程 MCP 地址必须使用 HTTPS。");
  if (url.username || url.password || url.hash) throw new McpConnectionError("invalid-config", "MCP 地址不能包含账号、密码或片段。");
  await assertPublicModelEndpoint(url.origin);
}

function normalizeSecretRefMap(
  value: Record<string, string> | undefined,
  namePattern: RegExp,
  label: string
): Record<string, string> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new McpConnectionError("invalid-config", `${label}配置无效。`);
  const entries = Object.entries(value);
  if (entries.length > 50) throw new McpConnectionError("invalid-config", `${label}数量超过安全上限。`);
  const result: Record<string, string> = {};
  for (const [name, ref] of entries) {
    if (!namePattern.test(name)) throw new McpConnectionError("invalid-config", `${label}名称无效。`);
    if (typeof ref !== "string" || !SECRET_REF.test(ref)) {
      throw new McpConnectionError("invalid-config", `${label}只能保存安全存储引用，不能保存原始密钥。`);
    }
    result[name] = ref;
  }
  return result;
}

function classifyRisk(
  name: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }
): McpToolRisk {
  if (annotations?.destructiveHint === true || isForbiddenSapMutation(name)) return "destructive";
  return "unknown";
}

function isForbiddenSapMutation(name: string): boolean {
  return /(?:^|[._:/-])sap(?:$|[._:/-])/i.test(name) && FORBIDDEN_SAP_MUTATION.test(name);
}

function schemaContainsSensitiveInput(schema: Record<string, unknown>): boolean {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, stringIsFieldName = false): boolean => {
    if (typeof value === "string") return stringIsFieldName && SENSITIVE_KEY.test(value);
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => visit(item, stringIsFieldName));
    return Object.entries(value).some(([key, item]) => (
      SENSITIVE_KEY.test(key)
      || visit(item, key === "required" || key === "dependentRequired")
    ));
  };
  return visit(schema);
}

function booleanHint(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

class DiscoveryBudget {
  private readonly startedAt = Date.now();
  private consumedBytes = 0;

  consume(value: unknown, label: string): void {
    this.assertActive();
    assertBoundedStructure(value, label);
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new McpConnectionError("connection-failed", `MCP ${label}结构无法安全读取。`);
    }
    this.consumedBytes += Buffer.byteLength(serialized, "utf8");
    if (this.consumedBytes > MAX_DISCOVERY_TOTAL_BYTES) {
      throw new McpConnectionError("connection-failed", "MCP 能力发现累计内容超过 8 MB 安全上限。");
    }
  }

  requestOptions(signal?: AbortSignal): { timeout: number; maxTotalTimeout: number; signal?: AbortSignal } {
    this.assertActive();
    const remaining = Math.max(1, MAX_DISCOVERY_TOTAL_MS - (Date.now() - this.startedAt));
    const timeout = Math.min(REQUEST_TIMEOUT_MS, remaining);
    return { timeout, maxTotalTimeout: timeout, ...(signal ? { signal } : {}) };
  }

  private assertActive(): void {
    if (Date.now() - this.startedAt >= MAX_DISCOVERY_TOTAL_MS) {
      throw new McpConnectionError("connection-failed", "MCP 能力发现超过 60 秒总时限，已停止读取。");
    }
  }
}

function assertBoundedStructure(value: unknown, label: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!current.value || typeof current.value !== "object") continue;
    if (current.depth > MAX_DISCOVERY_STRUCTURE_DEPTH) {
      throw new McpConnectionError("connection-failed", `MCP ${label}嵌套超过安全上限。`);
    }
    if (seen.has(current.value as object)) continue;
    seen.add(current.value as object);
    visited += 1;
    if (visited > 100_000) throw new McpConnectionError("connection-failed", `MCP ${label}结构过大。`);
    const values = Array.isArray(current.value) ? current.value : Object.values(current.value as Record<string, unknown>);
    for (const child of values) pending.push({ value: child, depth: current.depth + 1 });
  }
}

function boundedClone<T>(value: T, label: string): T {
  assertBoundedStructure(value, label);
  return clone(value);
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => undefined;
  }
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function waitForConnectFlight(flight: ConnectFlight, signal?: AbortSignal): Promise<McpConnectionSummary> {
  if (!signal) return flight.promise;
  if (signal.aborted) {
    flight.controller.abort(signal.reason);
    return Promise.reject(createAbortError("MCP 连接已取消。"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      flight.controller.abort(signal.reason);
      reject(createAbortError("MCP 连接已取消。"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    flight.promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function safeResultPreview(value: unknown): { preview: string; truncated: boolean } {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (key, item) => {
    if (SENSITIVE_KEY.test(key)) return "[已脱敏]";
    if (typeof item === "string") return redactText(item);
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[循环引用]";
      seen.add(item);
    }
    return item;
  }) ?? "null";
  if (serialized.length <= MAX_RESULT_CHARS) return { preview: serialized, truncated: false };
  return { preview: `${serialized.slice(0, MAX_RESULT_CHARS - 32)}...[结果已截断]`, truncated: true };
}

async function closeRuntime(runtime: RuntimeConnection): Promise<void> {
  await Promise.allSettled([runtime.client.close(), runtime.transport.close()]);
}

async function readStoredFile(filePath: string): Promise<McpConnectionRecord[]> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as StoredMcpFile;
  if (!parsed || parsed.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(parsed.connections)) {
    throw new Error("MCP 连接配置文件格式无效。");
  }
  if (parsed.connections.length > MAX_CONNECTIONS) throw new Error("MCP 连接数量超过安全上限。");
  const records: McpConnectionRecord[] = [];
  for (const item of parsed.connections) records.push(await normalizeStoredRecord(item));
  return records;
}

async function normalizeStoredRecord(value: McpConnectionRecord): Promise<McpConnectionRecord> {
  const normalized = await normalizeConnectionInput(value);
  return {
    id: safeId(value.id, "MCP 连接 ID"),
    name: normalized.name,
    description: normalized.description,
    scope: normalized.scope,
    transport: normalized.transport,
    enabled: value.enabled === true,
    enabledTools: Array.isArray(value.enabledTools) ? [...new Set(value.enabledTools.map(safeToolName))] : [],
    approvedReadOnlyTools: Array.isArray(value.approvedReadOnlyTools)
      ? [...new Set(value.approvedReadOnlyTools.map(safeToolName))]
      : [],
    createdAt: safeIso(value.createdAt),
    updatedAt: safeIso(value.updatedAt),
    lastTestedAt: value.lastTestedAt ? safeIso(value.lastTestedAt) : null,
    lastTestSucceeded: typeof value.lastTestSucceeded === "boolean" ? value.lastTestSucceeded : null,
    lastTestMessage: value.lastTestMessage ? safeDisplayText(value.lastTestMessage, null, 800) : null
  };
}

function discoveryWithEnabledTools(
  snapshot: McpDiscoverySnapshot,
  enabledTools: string[],
  approvedReadOnlyTools: string[]
): McpDiscoverySnapshot {
  const enabled = new Set(enabledTools);
  void approvedReadOnlyTools;
  return {
    ...snapshot,
    tools: snapshot.tools.map((tool) => ({
      ...tool,
      enabled: enabled.has(tool.name),
      userApprovedReadOnly: false,
      canApproveReadOnly: false
    }))
  };
}

function nextDiscoveryCursor(
  nextCursor: string | undefined,
  currentCursor: string | undefined,
  seenCursors: Set<string>,
  label: string
): string | undefined {
  if (!nextCursor) return undefined;
  if (nextCursor.length > MAX_DISCOVERY_CURSOR_CHARS) {
    throw new McpConnectionError("connection-failed", `MCP ${label}分页游标超过安全上限。`);
  }
  if (nextCursor === currentCursor || seenCursors.has(nextCursor)) {
    throw new McpConnectionError("connection-failed", `MCP ${label}分页返回了重复游标，已停止读取。`);
  }
  seenCursors.add(nextCursor);
  return nextCursor;
}

function boundedResponse(response: Response, maxBytes: number): Response {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel();
    throw new McpConnectionError("connection-failed", "MCP 单次响应体超过 1 MB 安全上限。");
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  let received = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }
        received += chunk.value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          controller.error(new McpConnectionError("connection-failed", "MCP 单次响应体超过 1 MB 安全上限。"));
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new McpConnectionError("invalid-config", `${label}格式无效。`);
  return value;
}

function safeToolName(value: unknown): string {
  if (typeof value !== "string" || !SAFE_TOOL_NAME.test(value)) throw new McpConnectionError("invalid-config", "MCP 工具名称无效。");
  return value;
}

function safeDisplayText<T extends string | null>(value: unknown, fallback: T, maxLength: number): string | T {
  if (typeof value !== "string") return fallback;
  const normalized = redactText(value.replace(/\u0000/g, "").trim());
  return (normalized ? normalized.slice(0, maxLength) : fallback) as string | T;
}

function safeIso(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("MCP 连接时间格式无效。");
  return new Date(value).toISOString();
}

function redactText(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_TEXT) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[已脱敏]");
  }
  return result;
}

function chineseConnectionError(error: unknown): string {
  if (error instanceof McpConnectionError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "MCP 连接已取消。";
  if (isRequestTimeout(error)) return "MCP 连接或能力发现超时，请检查服务状态和网络后重试。";
  return "MCP 连接失败，请检查服务是否运行、地址和权限配置是否正确。";
}

function chineseRequestError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "MCP 工具调用已取消。";
  if (error instanceof McpConnectionError) return error.message;
  if (isRequestTimeout(error)) return "MCP 工具调用超时，外部服务未在限定时间内返回。";
  return "MCP 工具调用失败，外部服务未返回可用结果。";
}

function isRequestTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === -32001
    || (typeof candidate.message === "string" && /timed?\s*out|timeout|maximum total/i.test(candidate.message));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function exists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function archiveCorrupt(filePath: string): Promise<void> {
  if (!await exists(filePath)) return;
  await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined);
}
