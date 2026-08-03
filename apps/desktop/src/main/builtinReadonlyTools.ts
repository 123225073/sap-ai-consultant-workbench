import type { ToolJsonObjectSchema } from "../shared/toolRuntimeTypes";
import type { ToolDefinition, ToolHandlerContext } from "./toolRuntime";
import { ToolRegistry } from "./toolRuntime";

export interface ReadSafeCaseContextInput {
  threadId: string;
  projectId: string;
  caseId: string;
  signal: AbortSignal;
}

export interface SearchPublishedKnowledgeInput {
  projectId: string;
  query: string;
  topK: number;
  signal: AbortSignal;
}

export interface SearchCaseImportedEvidenceInput {
  projectId: string;
  caseId: string;
  query: string;
  topK: number;
  signal: AbortSignal;
}

export interface CaseThreadContextInput {
  projectId: string;
  caseId: string;
  threadId?: string;
  signal: AbortSignal;
}

export interface BuiltinReadonlyToolDependencies {
  readCaseSafeContext: (input: ReadSafeCaseContextInput) => Promise<unknown> | unknown;
  searchPublishedKnowledge: (input: SearchPublishedKnowledgeInput) => Promise<unknown> | unknown;
  searchCaseImportedEvidence: (input: SearchCaseImportedEvidenceInput) => Promise<unknown> | unknown;
  listCaseThreads: (input: CaseThreadContextInput) => Promise<unknown> | unknown;
  readCaseThreadContext: (input: CaseThreadContextInput) => Promise<unknown> | unknown;
}

const CASE_SAFE_CONTEXT_SCHEMA: ToolJsonObjectSchema = {
  type: "object",
  properties: {
    threadId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
    }
  },
  required: ["threadId"],
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1
};

const PUBLISHED_KNOWLEDGE_SEARCH_SCHEMA: ToolJsonObjectSchema = {
  type: "object",
  properties: {
    projectId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
    },
    query: {
      type: "string",
      minLength: 1,
      maxLength: 500
    },
    topK: {
      type: "integer",
      minimum: 1,
      maximum: 10
    }
  },
  required: ["projectId", "query", "topK"],
  additionalProperties: false,
  minProperties: 3,
  maxProperties: 3
};

const CASE_IMPORTED_EVIDENCE_SEARCH_SCHEMA: ToolJsonObjectSchema = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, maxLength: 500 },
    topK: { type: "integer", minimum: 1, maximum: 8 }
  },
  required: ["query", "topK"],
  additionalProperties: false,
  minProperties: 2,
  maxProperties: 2
};

const EMPTY_CASE_SCOPE_SCHEMA: ToolJsonObjectSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
  minProperties: 0,
  maxProperties: 0
};

const CASE_THREAD_CONTEXT_SCHEMA: ToolJsonObjectSchema = {
  type: "object",
  properties: {
    threadId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
    }
  },
  required: ["threadId"],
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1
};

export function createBuiltinReadonlyTools(dependencies: BuiltinReadonlyToolDependencies): ToolDefinition[] {
  assertDependencies(dependencies);
  return [
    {
      name: "case.read_safe_context",
      description: "读取当前 Case 已净化的摘要、来源引用和审计信息，不读取任意文件。",
      risk: "read-only",
      scope: "case",
      inputSchema: CASE_SAFE_CONTEXT_SCHEMA,
      timeoutMs: 10_000,
      maxResultChars: 12_000,
      execute: async (argumentsValue, context) => {
        const threadId = argumentsValue.threadId as string;
        return dependencies.readCaseSafeContext({
          threadId,
          projectId: context.projectId,
          caseId: requireCaseId(context),
          signal: context.signal
        });
      }
    },
    {
      name: "knowledge.search_published",
      description: "只在当前 Project 中检索已发布知识摘要及来源，不检索候选或其他 Project 内容。",
      risk: "read-only",
      scope: "project",
      inputSchema: PUBLISHED_KNOWLEDGE_SEARCH_SCHEMA,
      timeoutMs: 10_000,
      maxResultChars: 12_000,
      execute: async (argumentsValue, context) => dependencies.searchPublishedKnowledge({
        projectId: context.projectId,
        query: argumentsValue.query as string,
        topK: argumentsValue.topK as number,
        signal: context.signal
      })
    },
    {
      name: "case.search_imported_evidence",
      description: "只在当前 Case 的已脱敏附件摘录中检索，返回带相对来源路径的有限片段；不会把原始 PDF、Word、Excel 或其他 Project 文件直接送入模型。",
      risk: "read-only",
      scope: "case",
      inputSchema: CASE_IMPORTED_EVIDENCE_SEARCH_SCHEMA,
      timeoutMs: 10_000,
      maxResultChars: 16_000,
      execute: async (argumentsValue, context) => dependencies.searchCaseImportedEvidence({
        projectId: context.projectId,
        caseId: requireCaseId(context),
        query: argumentsValue.query as string,
        topK: argumentsValue.topK as number,
        signal: context.signal
      })
    },
    {
      name: "case.list_threads",
      description: "列出当前运维项目下的对话线程 ID、标题和状态，用于按需定位兄弟线程；不会跨运维项目读取。",
      risk: "read-only",
      scope: "case",
      inputSchema: EMPTY_CASE_SCOPE_SCHEMA,
      timeoutMs: 10_000,
      maxResultChars: 8_000,
      execute: async (_argumentsValue, context) => dependencies.listCaseThreads({
        projectId: context.projectId,
        caseId: requireCaseId(context),
        signal: context.signal
      })
    },
    {
      name: "case.read_thread_context",
      description: "读取当前运维项目内指定兄弟线程的有限对话上下文。只返回经过长度限制的消息，不允许跨客户项目或跨运维项目读取。",
      risk: "read-only",
      scope: "case",
      inputSchema: CASE_THREAD_CONTEXT_SCHEMA,
      timeoutMs: 10_000,
      maxResultChars: 24_000,
      execute: async (argumentsValue, context) => dependencies.readCaseThreadContext({
        projectId: context.projectId,
        caseId: requireCaseId(context),
        threadId: argumentsValue.threadId as string,
        signal: context.signal
      })
    }
  ];
}

export function registerBuiltinReadonlyTools(registry: ToolRegistry, dependencies: BuiltinReadonlyToolDependencies): void {
  for (const definition of createBuiltinReadonlyTools(dependencies)) registry.register(definition);
}

function requireCaseId(context: ToolHandlerContext): string {
  if (!context.caseId) throw new Error("当前 Case 范围缺失。");
  return context.caseId;
}

function assertDependencies(dependencies: BuiltinReadonlyToolDependencies): void {
  if (!dependencies || typeof dependencies.readCaseSafeContext !== "function" || typeof dependencies.searchPublishedKnowledge !== "function" || typeof dependencies.searchCaseImportedEvidence !== "function" || typeof dependencies.listCaseThreads !== "function" || typeof dependencies.readCaseThreadContext !== "function") {
    throw new Error("内置只读工具必须由 main process 注入 Case 安全上下文、附件摘录和已发布知识适配器。");
  }
}
