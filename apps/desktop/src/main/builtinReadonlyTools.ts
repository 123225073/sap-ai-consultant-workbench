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

export interface BuiltinReadonlyToolDependencies {
  readCaseSafeContext: (input: ReadSafeCaseContextInput) => Promise<unknown> | unknown;
  searchPublishedKnowledge: (input: SearchPublishedKnowledgeInput) => Promise<unknown> | unknown;
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
  if (!dependencies || typeof dependencies.readCaseSafeContext !== "function" || typeof dependencies.searchPublishedKnowledge !== "function") {
    throw new Error("内置只读工具必须由 main process 注入 Case 安全上下文和已发布知识适配器。");
  }
}
