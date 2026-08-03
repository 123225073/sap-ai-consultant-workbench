import { createHash, randomUUID } from "node:crypto";
import type { ToolDescriptor, ToolExecutionResult, ToolJsonObject, ToolJsonObjectSchema } from "../shared/toolRuntimeTypes";
import { createBuiltinReadonlyTools } from "./builtinReadonlyTools";
import {
  PolicyEngine,
  ToolExecutor,
  ToolRegistry,
  ToolRuntimeError,
  validateToolArguments
} from "./toolRuntime";
import type { ActivatedSkill, SkillCatalogEntry } from "../shared/skillTypes";
import type { SapDataPreviewRequest, SapDataPreviewResult, SapObjectEvidenceRequest, SapObjectEvidenceResult } from "../shared/workbenchTypes";
import { WorkspaceStore } from "./workspaceStore";

export interface AgentToolTarget {
  threadId: string;
  projectId: string;
  caseId: string | null;
}

export interface AgentModelToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolJsonObjectSchema;
}

export interface AgentModelToolCall {
  callId: string;
  name: string;
  arguments: ToolJsonObject;
  argumentsError?: string;
}

export interface AgentModelToolResult {
  callId: string;
  name: string;
  content: string;
  isError: boolean;
  trust: "untrusted-data";
}

export interface AgentToolSession {
  tools: AgentModelToolDefinition[];
  authorize(call: AgentModelToolCall): { outcome: "allowed" | "denied"; message: string };
  execute(call: AgentModelToolCall, signal?: AbortSignal): Promise<AgentModelToolResult>;
}

interface RegisteredModelTool {
  providerName: string;
  runtimeName: string;
  description: string;
  inputSchema: ToolJsonObjectSchema;
  prepareArguments: (argumentsValue: ToolJsonObject) => ToolJsonObject;
}

interface AgentSkillService {
  getCatalog(projectId?: string | null): Promise<SkillCatalogEntry[]>;
  activateSkill(name: string, projectId?: string | null): Promise<ActivatedSkill>;
}

type AgentSapEvidenceReader = (
  target: { projectId: string; caseId: string; threadId: string },
  request: SapObjectEvidenceRequest,
  signal?: AbortSignal
) => Promise<SapObjectEvidenceResult>;

type AgentSapDataPreviewReader = (
  target: { projectId: string; caseId: string; threadId: string },
  request: SapDataPreviewRequest,
  signal?: AbortSignal
) => Promise<SapDataPreviewResult>;

export class AgentToolService {
  constructor(
    private readonly store: WorkspaceStore,
    _mcp: unknown,
    private readonly skills: AgentSkillService | null = null,
    private readonly readSapEvidence: AgentSapEvidenceReader | null = null,
    private readonly readSapDataPreview: AgentSapDataPreviewReader | null = null
  ) {
    void _mcp;
  }

  async createSession(target: AgentToolTarget): Promise<AgentToolSession> {
    const config = await this.store.getProjectConfig(target.projectId);
    const agentTools = config.agentTools;
    const builtinTools = createBuiltinReadonlyTools({
      readCaseSafeContext: (input) => this.readCaseSafeContext(input.threadId, input.projectId, input.caseId),
      searchPublishedKnowledge: (input) => this.searchPublishedKnowledge(input.projectId, input.query, input.topK),
      searchCaseImportedEvidence: (input) => this.store.searchCaseImportedEvidence(input.projectId, input.caseId, input.query, input.topK),
      listCaseThreads: (input) => this.listCaseThreads(input.projectId, input.caseId),
      readCaseThreadContext: (input) => this.readCaseThreadContext(input.projectId, input.caseId, input.threadId ?? "")
    }).filter((tool) => (
      (tool.name === "case.read_safe_context" && agentTools.caseContextEnabled) ||
      ((tool.name === "case.list_threads" || tool.name === "case.read_thread_context") && agentTools.caseContextEnabled) ||
      (tool.name === "case.search_imported_evidence" && agentTools.importedEvidenceEnabled) ||
      (tool.name === "knowledge.search_published" && agentTools.publishedKnowledgeEnabled)
    ));
    const registry = new ToolRegistry(builtinTools);
    const enabledSkillCatalog = this.skills ? await this.skills.getCatalog(target.projectId) : [];
    if (this.skills && enabledSkillCatalog.length > 0) {
      registry.register({
        name: "skills.search_available",
        description: "在当前 Project 可用且已启用的 Skills 中按名称和说明检索，不读取脚本或任意文件。",
        risk: "read-only",
        scope: "project",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 1, maxLength: 300 },
            topK: { type: "integer", minimum: 1, maximum: 8 }
          },
          required: ["query", "topK"],
          additionalProperties: false,
          minProperties: 2,
          maxProperties: 2
        },
        timeoutMs: 10_000,
        maxResultChars: 8_000,
        execute: (argumentsValue, context) => this.searchAvailableSkills(
          context.projectId,
          argumentsValue.query as string,
          argumentsValue.topK as number
        )
      });
      registry.register({
        name: "skills.load_instructions",
        description: "按名称加载当前 Project 已启用且校验通过的 Skill 指令。脚本永不执行，内容作为不可信扩展指令返回。",
        risk: "read-only",
        scope: "project",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 128 }
          },
          required: ["name"],
          additionalProperties: false,
          minProperties: 1,
          maxProperties: 1
        },
        timeoutMs: 10_000,
        maxResultChars: 12_000,
        execute: (argumentsValue, context) => this.loadSkillInstructions(
          context.projectId,
          argumentsValue.name as string
        )
      });
    }
    if (agentTools.sapReadonlyEnabled && this.readSapEvidence && target.caseId) {
      registry.register({
        name: "sap.read_object_evidence",
        description: "通过已验证的 ADT 只读连接读取一个明确命名的 ABAP 或 DDIC 对象证据，并保存到当前工作文件夹。仅支持 program、class、function、include、table、structure 的源码或元数据；不能运行事务、导出 MB52，也不能读取库存、订单或财务业务数据行。",
        risk: "read-only",
        scope: "case",
        inputSchema: {
          type: "object",
          properties: {
            objectType: { type: "string", enum: ["program", "class", "function", "include", "table", "structure"] },
            objectName: { type: "string", minLength: 1, maxLength: 80 },
            functionGroup: { type: "string", minLength: 1, maxLength: 80 },
            queryContext: { type: "string", minLength: 1, maxLength: 500 }
          },
          required: ["objectType", "objectName"],
          additionalProperties: false,
          minProperties: 2,
          maxProperties: 4
        },
        timeoutMs: 60_000,
        maxResultChars: 8_000,
        execute: async (argumentsValue, context) => {
          const result = await this.readSapEvidence!({
            projectId: context.projectId,
            caseId: context.caseId!,
            threadId: context.threadId
          }, {
            objectType: argumentsValue.objectType as SapObjectEvidenceRequest["objectType"],
            objectName: argumentsValue.objectName as string,
            ...(typeof argumentsValue.functionGroup === "string" ? { functionGroup: argumentsValue.functionGroup } : {}),
            connectionMode: "auto",
            queryContext: typeof argumentsValue.queryContext === "string" ? argumentsValue.queryContext : argumentsValue.objectName as string
          }, context.signal);
          return {
            object: result.summary,
            connectionCount: result.summaries.length,
            generatedFiles: result.generatedFiles,
            trust: "sap-adt-readonly-evidence"
          };
        }
      });
    }
    if (agentTools.sapDataPreviewEnabled && this.readSapDataPreview && target.caseId) {
      registry.register({
        name: "sap.read_data_preview",
        description: "面向任意 SAP 业务问题的通用 ADT Data Preview 只读工具。先理解用户目标并判断合适的 DDIC table、view 或 CDS；不确定字段时先用 operation=discover、空 columns/filters、maxRows=1 发现字段，再用 operation=read、明确字段和至少一个业务筛选完成有界读取。用户明确 SID 或 Client 时，将其规范为 systemHint（例如 Client 800）以连接对应系统。模型不能提交 SQL，工具不会运行事务或执行写入；读取后必须继续分析并完成用户要求的答复或本地成果，不能停在“已读取数据”。MB52、订单、凭证、配置核对等都只是这条通用链路的使用场景，不是独立功能。",
        risk: "read-only",
        scope: "case",
        inputSchema: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["discover", "read"] },
            objectName: { type: "string", minLength: 1, maxLength: 80 },
            objectType: { type: "string", enum: ["table", "view", "cds"] },
            columns: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, minItems: 0, maxItems: 30 },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string", minLength: 1, maxLength: 80 },
                  operator: { type: "string", enum: ["eq", "ne", "gt", "ge", "lt", "le", "like"] },
                  value: { type: "string", minLength: 1, maxLength: 200 }
                },
                required: ["field", "operator", "value"],
                additionalProperties: false,
                minProperties: 3,
                maxProperties: 3
              },
              minItems: 0,
              maxItems: 12
            },
            maxRows: { type: "integer", minimum: 1, maximum: 2000 },
            systemHint: { type: "string", minLength: 1, maxLength: 80 }
          },
          required: ["objectName", "objectType", "columns", "filters", "maxRows"],
          additionalProperties: false,
          minProperties: 5,
          maxProperties: 7
        },
        timeoutMs: 60_000,
        maxResultChars: 48_000,
        execute: async (argumentsValue, context) => {
          const result = await this.readSapDataPreview!({
            projectId: context.projectId,
            caseId: context.caseId!,
            threadId: context.threadId
          }, {
            intent: "sap-readonly-data",
            operation: argumentsValue.operation === "discover" ? "discover" : "read",
            objectName: argumentsValue.objectName as string,
            objectType: argumentsValue.objectType as SapDataPreviewRequest["objectType"],
            columns: argumentsValue.columns as string[],
            filters: argumentsValue.filters as unknown as SapDataPreviewRequest["filters"],
            maxRows: argumentsValue.maxRows as number,
            readOnly: true,
            ...(typeof argumentsValue.systemHint === "string" ? { queryContext: argumentsValue.systemHint } : {})
          }, context.signal);
          return {
            intent: result.intent,
            operation: result.operation,
            source: result.source,
            rowCount: result.rowCount,
            truncated: result.truncated,
            columns: result.columns,
            analysisRows: result.analysisRows,
            analysisRowsTruncated: result.analysisRowsTruncated,
            summary: result.safeSummary ?? { note: "详细业务数据仅保存在本地生成文件中。" },
            generatedFiles: result.generatedFiles,
            modelDataBoundary: "完整 SAP 明细保存在本地工作文件夹；当前模型收到有上限的分析行。若不足以完成任务，应缩小筛选或分次读取，不得把部分数据冒充完整结果。"
          };
        }
      });
    }
    const mappings: RegisteredModelTool[] = registry.list().map((tool) => modelMapping(tool, target));

    const descriptors = new Map(registry.list().map((item) => [item.name, item]));
    const executor = new ToolExecutor(registry);
    const policyEngine = new PolicyEngine();
    const authorize = (call: AgentModelToolCall): { outcome: "allowed" | "denied"; message: string } => {
      const mapping = mappings.find((item) => item.providerName === call.name);
      if (!mapping) return { outcome: "denied", message: "模型请求了未注册的工具，已拒绝执行。" };
      if (call.argumentsError) return { outcome: "denied", message: call.argumentsError };
      const definition = registry.get(mapping.runtimeName);
      if (!definition) return { outcome: "denied", message: "工具目录已发生变化，已拒绝执行。" };
      try {
        const argumentsValue = mapping.prepareArguments(call.arguments);
        validateToolArguments(definition.inputSchema, argumentsValue);
        const decision = policyEngine.evaluate(definition, {
          callId: safeCallId(call.callId),
          toolName: mapping.runtimeName,
          arguments: argumentsValue
        }, {
          threadId: target.threadId,
          projectId: target.projectId,
          caseId: target.caseId
        });
        return decision.outcome === "allow"
          ? { outcome: "allowed", message: decision.message }
          : { outcome: "denied", message: decision.message };
      } catch (error) {
        return { outcome: "denied", message: safeToolError(error) };
      }
    };
    return {
      tools: mappings.map((mapping) => {
        if (!descriptors.has(mapping.runtimeName)) throw new Error("Agent 工具目录构建失败。");
        return {
          name: mapping.providerName,
          description: mapping.description,
          inputSchema: mapping.inputSchema
        };
      }),
      authorize,
      execute: async (call, signal) => {
        const authorization = authorize(call);
        if (authorization.outcome !== "allowed") return failedToolResult(call, authorization.message);
        const mapping = mappings.find((item) => item.providerName === call.name);
        if (!mapping) return failedToolResult(call, "模型请求了未注册的工具，已拒绝执行。");
        try {
          const result = await executor.execute({
            callId: safeCallId(call.callId),
            toolName: mapping.runtimeName,
            arguments: mapping.prepareArguments(call.arguments)
          }, {
            threadId: target.threadId,
            projectId: target.projectId,
            caseId: target.caseId,
            signal
          });
          return successfulToolResult(call, result);
        } catch (error) {
          return failedToolResult(call, safeToolError(error));
        }
      }
    };
  }

  private async readCaseSafeContext(threadId: string, projectId: string, caseId: string): Promise<unknown> {
    const state = await this.store.getState();
    const project = state.projects.find((item) => item.id === projectId);
    const caseItem = project?.cases.find((item) => item.id === caseId);
    const thread = state.workThreads.find((item) => item.id === threadId && item.projectId === projectId && item.caseId === caseId);
    if (!project || !caseItem || !thread) throw new Error("当前 Project、Case 或任务会话已不存在。");
    return {
      project: { id: project.id, name: project.name, sapVersion: project.sapVersion },
      case: {
        id: caseItem.id,
        title: caseItem.title,
        status: caseItem.status,
        summary: caseItem.currentSummary || caseItem.summary,
        knowledgeReferences: caseItem.knowledgeReferences.map((item) => ({
          itemId: item.itemId,
          title: item.title,
          summary: item.summary,
          sapObjects: item.sapObjects
        }))
      },
      conversation: {
        threadId: thread.id,
        recentMessages: thread.messages.slice(-8).map((message) => ({ role: message.role, content: message.content.slice(0, 2_000) }))
      },
      trust: "local-case-safe-context"
    };
  }

  private async listCaseThreads(projectId: string, caseId: string): Promise<unknown> {
    const state = await this.store.getState();
    const project = state.projects.find((item) => item.id === projectId);
    const caseItem = project?.cases.find((item) => item.id === caseId);
    if (!project || !caseItem) throw new Error("当前客户项目或运维项目已不存在。");
    const items = state.workThreads
      .filter((thread) => thread.projectId === projectId && thread.caseId === caseId && thread.status !== "removed")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 100)
      .map((thread) => ({
        threadId: thread.id,
        title: thread.title,
        status: thread.status,
        messageCount: thread.messages.length,
        updatedAt: thread.updatedAt
      }));
    return { projectId, workProjectId: caseId, count: items.length, items, trust: "local-work-project-thread-index" };
  }

  private async readCaseThreadContext(projectId: string, caseId: string, threadId: string): Promise<unknown> {
    const state = await this.store.getState();
    const thread = state.workThreads.find((item) => item.id === threadId && item.projectId === projectId && item.caseId === caseId && item.status !== "removed");
    if (!thread) throw new Error("指定线程不属于当前运维项目、已移除或不存在。");
    const messages = thread.messages.slice(-16).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 2_000),
      createdAt: message.createdAt
    }));
    return {
      threadId: thread.id,
      title: thread.title,
      status: thread.status,
      messages,
      truncated: thread.messages.length > messages.length,
      trust: "local-work-project-sibling-thread-context"
    };
  }

  private async searchPublishedKnowledge(projectId: string, query: string, topK: number): Promise<unknown> {
    const view = await this.store.getProjectKnowledge(projectId);
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length > 1).slice(0, 20);
    const ranked = view.items
      .filter((item) => item.status === "published" && item.projectId === projectId)
      .map((item) => {
        const haystack = `${item.title}\n${item.summary}\n${item.content}\n${item.sapObjects.join(" ")}`.toLowerCase();
        return { item, score: terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) };
      })
      .filter((entry) => terms.length === 0 || entry.score > 0)
      .sort((left, right) => right.score - left.score || right.item.updatedAt.localeCompare(left.item.updatedAt))
      .slice(0, topK)
      .map(({ item, score }) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        sapObjects: item.sapObjects,
        sourceCaseId: item.sourceCaseId,
        publishedAt: item.publishedAt,
        score
      }));
    return { query, count: ranked.length, items: ranked, trust: "reviewed-published-knowledge" };
  }

  private async searchAvailableSkills(projectId: string, query: string, topK: number): Promise<unknown> {
    if (!this.skills) throw new Error("Skills 服务未初始化。");
    const terms = tokenize(query);
    const catalog = await this.skills.getCatalog(projectId);
    const items = catalog
      .map((item) => {
        const name = item.name.toLocaleLowerCase("zh-CN");
        const haystack = `${item.name}\n${item.description}`.toLocaleLowerCase("zh-CN");
        const score = (name === query.toLocaleLowerCase("zh-CN") ? 100 : 0)
          + terms.reduce((total, term) => total + (haystack.includes(term) ? Math.min(20, term.length * 3) : 0), 0);
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "zh-CN"))
      .slice(0, topK)
      .map(({ item, score }) => ({
        name: item.name,
        description: item.description,
        scope: item.scope.kind,
        validationStatus: item.validationStatus,
        score
      }));
    return {
      query,
      count: items.length,
      items,
      nextStep: items.length > 0 ? "需要使用时再调用 skills.load_instructions。" : "没有匹配的已启用 Skill。",
      trust: "validated-skill-catalog"
    };
  }

  private async loadSkillInstructions(projectId: string, name: string): Promise<unknown> {
    if (!this.skills) throw new Error("Skills 服务未初始化。");
    const activated = await this.skills.activateSkill(name, projectId);
    return {
      name: activated.name,
      description: activated.description,
      scope: activated.scope.kind,
      sha256: activated.sha256,
      instructions: activated.instructions.slice(0, 8_000),
      resources: activated.resources.map((resource) => ({
        relativePath: resource.relativePath,
        kind: resource.kind,
        sizeBytes: resource.sizeBytes
      })),
      scriptsExecution: "disabled",
      allowedToolsPolicy: "advisory-only",
      trust: "untrusted-extension-instructions"
    };
  }
}

function modelMapping(definition: ToolDescriptor, target: AgentToolTarget): RegisteredModelTool {
  if (definition.name === "case.read_safe_context") {
    return {
      providerName: providerToolName(definition.name),
      runtimeName: definition.name,
      description: "读取当前 Case 已净化的摘要、已审核知识引用和最近对话。作用范围由系统固定，不需要提供 ID。",
      inputSchema: emptyObjectSchema(),
      prepareArguments: () => ({ threadId: target.threadId })
    };
  }
  if (definition.name === "knowledge.search_published") {
    const query = definition.inputSchema.properties.query;
    const topK = definition.inputSchema.properties.topK;
    return {
      providerName: providerToolName(definition.name),
      runtimeName: definition.name,
      description: "只在当前 Project 中检索经过人工审核并已发布的知识摘要，不会访问候选知识或其他 Project。",
      inputSchema: {
        type: "object",
        properties: { ...(query ? { query } : {}), ...(topK ? { topK } : {}) },
        required: ["query", "topK"],
        additionalProperties: false,
        minProperties: 2,
        maxProperties: 2
      },
      prepareArguments: (argumentsValue) => ({ ...argumentsValue, projectId: target.projectId })
    };
  }
  if (definition.name === "case.search_imported_evidence") {
    return {
      providerName: providerToolName(definition.name),
      runtimeName: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      prepareArguments: (argumentsValue) => ({ query: argumentsValue.query, topK: argumentsValue.topK })
    };
  }
  return {
    providerName: providerToolName(definition.name),
    runtimeName: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    prepareArguments: (argumentsValue) => argumentsValue
  };
}

function emptyObjectSchema(): ToolJsonObjectSchema {
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
    minProperties: 0,
    maxProperties: 0
  };
}

function successfulToolResult(call: AgentModelToolCall, result: ToolExecutionResult): AgentModelToolResult {
  const { output: processedData, truncated, redactions } = result;
  return {
    callId: call.callId,
    name: call.name,
    content: JSON.stringify({ data: processedData, truncated, redactions }),
    isError: false,
    trust: "untrusted-data"
  };
}

function failedToolResult(call: AgentModelToolCall, message: string): AgentModelToolResult {
  return {
    callId: call.callId,
    name: call.name,
    content: JSON.stringify({ error: message }),
    isError: true,
    trust: "untrusted-data"
  };
}

function safeCallId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 120);
  return /^[A-Za-z0-9]/.test(normalized) ? normalized : `call-${randomUUID()}`;
}

function safeToolError(error: unknown): string {
  if (error instanceof ToolRuntimeError) return error.message.slice(0, 500);
  const message = error instanceof Error && error.message.trim() ? error.message : "工具执行失败。";
  return message.replace(/secure-store:[A-Za-z0-9._:-]+/g, "[安全存储引用]").slice(0, 500);
}

function providerToolName(runtimeName: string): string {
  const readable = runtimeName.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 46) || "tool";
  const hash = createHash("sha256").update(runtimeName).digest("hex").slice(0, 10);
  return `${readable}_${hash}`;
}

function tokenize(value: string): string[] {
  const terms = value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 24);
  const expanded = terms.flatMap((term) => {
    if (!/^[\p{Script=Han}]+$/u.test(term) || term.length <= 2) return [term];
    return [term, ...Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2))];
  });
  return [...new Set(expanded)].slice(0, 48);
}
