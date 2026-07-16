export type ToolJsonPrimitive = string | number | boolean | null;
export type ToolJsonValue = ToolJsonPrimitive | ToolJsonObject | ToolJsonValue[];
export interface ToolJsonObject {
  [key: string]: ToolJsonValue;
}

interface ToolJsonSchemaBase {
  description?: string;
  enum?: readonly ToolJsonPrimitive[];
}

export interface ToolJsonStringSchema extends ToolJsonSchemaBase {
  type: "string";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface ToolJsonNumberSchema extends ToolJsonSchemaBase {
  type: "number" | "integer";
  minimum?: number;
  maximum?: number;
}

export interface ToolJsonBooleanSchema extends ToolJsonSchemaBase {
  type: "boolean";
}

export interface ToolJsonNullSchema extends ToolJsonSchemaBase {
  type: "null";
}

export interface ToolJsonArraySchema extends ToolJsonSchemaBase {
  type: "array";
  items: ToolJsonSchema;
  minItems?: number;
  maxItems?: number;
}

export interface ToolJsonObjectSchema extends ToolJsonSchemaBase {
  type: "object";
  properties: Readonly<Record<string, ToolJsonSchema>>;
  required?: readonly string[];
  additionalProperties: false;
  minProperties?: number;
  maxProperties?: number;
}

export type ToolJsonSchema =
  | ToolJsonStringSchema
  | ToolJsonNumberSchema
  | ToolJsonBooleanSchema
  | ToolJsonNullSchema
  | ToolJsonArraySchema
  | ToolJsonObjectSchema;

export type ToolRiskLevel = "read-only" | "low" | "medium" | "high";
export type ToolScopeKind = "project" | "case";

export interface ToolDescriptor {
  name: string;
  description: string;
  risk: ToolRiskLevel;
  scope: ToolScopeKind;
  inputSchema: ToolJsonObjectSchema;
  timeoutMs?: number;
  maxResultChars?: number;
}

export interface ToolCallRequest {
  callId: string;
  toolName: string;
  arguments: unknown;
}

export interface ToolExecutionScope {
  threadId: string;
  projectId: string | null;
  caseId: string | null;
}

export interface ToolExecutionContext extends ToolExecutionScope {
  signal?: AbortSignal;
}

export type ToolPolicyDecisionCode =
  | "allowed"
  | "unknown-tool"
  | "sap-mutation-forbidden"
  | "risk-forbidden"
  | "invalid-context"
  | "project-scope-required"
  | "case-scope-required"
  | "cross-project"
  | "cross-case"
  | "cross-thread"
  | "unsafe-arguments";

export type ToolPolicyDecision =
  | { outcome: "allow"; code: "allowed"; message: string }
  | {
      outcome: "deny" | "needs-approval";
      code: Exclude<ToolPolicyDecisionCode, "allowed">;
      message: string;
    };

export type ToolRuntimeErrorCode =
  | Exclude<ToolPolicyDecisionCode, "allowed">
  | "invalid-call"
  | "invalid-tool-definition"
  | "invalid-arguments"
  | "duplicate-tool"
  | "call-id-conflict"
  | "cancelled"
  | "timeout"
  | "tool-failed"
  | "invalid-result"
  | "loop-budget-exhausted";

export interface ToolExecutionResult {
  callId: string;
  toolName: string;
  output: ToolJsonValue;
  truncated: boolean;
  redactions: number;
  durationMs: number;
  trust: "untrusted-data";
}

export const MAX_TOOL_LOOP_ROUNDS = 8;

export interface ToolLoopBudget {
  maxRounds: number;
  roundsUsed: number;
  roundsRemaining: number;
  toolCallsUsed: number;
}

export function createToolLoopBudget(maxRounds = MAX_TOOL_LOOP_ROUNDS): ToolLoopBudget {
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_TOOL_LOOP_ROUNDS) {
    throw new Error(`工具循环轮数必须在 1 到 ${MAX_TOOL_LOOP_ROUNDS} 之间。`);
  }
  return { maxRounds, roundsUsed: 0, roundsRemaining: maxRounds, toolCallsUsed: 0 };
}

export function consumeToolLoopRound(budget: ToolLoopBudget, toolCalls = 0): ToolLoopBudget {
  assertToolLoopBudget(budget);
  if (!Number.isSafeInteger(toolCalls) || toolCalls < 0) throw new Error("本轮工具调用数量无效。");
  if (budget.roundsRemaining < 1) throw new Error(`工具循环已达到 ${budget.maxRounds} 轮上限。`);
  const roundsUsed = budget.roundsUsed + 1;
  return {
    maxRounds: budget.maxRounds,
    roundsUsed,
    roundsRemaining: budget.maxRounds - roundsUsed,
    toolCallsUsed: budget.toolCallsUsed + toolCalls
  };
}

function assertToolLoopBudget(budget: ToolLoopBudget): void {
  const valid = Number.isSafeInteger(budget.maxRounds)
    && budget.maxRounds >= 1
    && budget.maxRounds <= MAX_TOOL_LOOP_ROUNDS
    && Number.isSafeInteger(budget.roundsUsed)
    && budget.roundsUsed >= 0
    && budget.roundsUsed <= budget.maxRounds
    && budget.roundsRemaining === budget.maxRounds - budget.roundsUsed
    && Number.isSafeInteger(budget.toolCallsUsed)
    && budget.toolCallsUsed >= 0;
  if (!valid) throw new Error("工具循环预算结构无效。");
}
