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

export class AgentToolService {
  constructor(
    private readonly store: WorkspaceStore,
    _mcp: unknown
  ) {
    void _mcp;
  }

  async createSession(target: AgentToolTarget): Promise<AgentToolSession> {
    const registry = new ToolRegistry(createBuiltinReadonlyTools({
      readCaseSafeContext: (input) => this.readCaseSafeContext(input.threadId, input.projectId, input.caseId),
      searchPublishedKnowledge: (input) => this.searchPublishedKnowledge(input.projectId, input.query, input.topK)
    }));
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
