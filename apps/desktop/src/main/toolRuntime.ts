import type {
  ToolCallRequest,
  ToolDescriptor,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolJsonObject,
  ToolJsonObjectSchema,
  ToolJsonPrimitive,
  ToolJsonSchema,
  ToolJsonValue,
  ToolPolicyDecision,
  ToolRuntimeErrorCode
} from "../shared/toolRuntimeTypes";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESULT_CHARS = 12_000;
const MAX_RESULT_CHARS = 64_000;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_VALUE_DEPTH = 8;
const MAX_RESULT_ARRAY_ITEMS = 100;
const MAX_RESULT_OBJECT_KEYS = 100;

const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|access[_-]?key|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token)(?:$|[_-])/i;
const SENSITIVE_TEXT_PATTERNS = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gi,
  /secure-store:sec_[a-f0-9]{32}/gi,
  /bearer\s+[a-z0-9._~+/=-]{12,}/gi,
  /sk-(?:proj-)?[a-z0-9_-]{16,}/gi,
  /github_pat_[a-z0-9_]{20,}/gi,
  /ghp_[a-z0-9]{20,}/gi,
  /xox[baprs]-[a-z0-9-]{20,}/gi,
  /(?:authorization|cookie|api[_-]?key|access[_-]?key|client[_-]?secret|password|passwd|secret|token)\s*[:=]\s*[^\n\r,;}]+/gi
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?|prompts?)/i,
  /(?:reveal|show|print|return|extract|steal|read)\b[\s\S]{0,80}\b(?:api\s*key|password|token|secret|credential|system\s*prompt|private\s*key|secure\s*store|\.env)\b/i,
  /bypass\b[\s\S]{0,60}\b(?:policy|permission|approval|safety|security)\b/i,
  /忽略[\s\S]{0,40}(?:之前|以上|系统|开发者)[\s\S]{0,40}(?:指令|提示|消息)/i,
  /(?:读取|显示|泄露|返回|提取)[\s\S]{0,60}(?:密钥|密码|令牌|凭据|系统提示|安全存储)/i,
  /绕过[\s\S]{0,40}(?:权限|审批|策略|安全)/i
];

const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ToolHandlerContext {
  callId: string;
  toolName: string;
  threadId: string;
  projectId: string;
  caseId: string | null;
  signal: AbortSignal;
}

export interface ToolDefinition extends ToolDescriptor {
  execute: (argumentsValue: ToolJsonObject, context: ToolHandlerContext) => Promise<unknown> | unknown;
}

export interface ToolExecutorOptions {
  defaultTimeoutMs?: number;
  defaultMaxResultChars?: number;
}

export class ToolRuntimeError extends Error {
  readonly code: ToolRuntimeErrorCode;

  constructor(code: ToolRuntimeErrorCode, message: string) {
    super(redactText(message).value.slice(0, 500));
    this.name = "ToolRuntimeError";
    this.code = code;
  }
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  constructor(definitions: readonly ToolDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ToolDefinition): void {
    assertToolDefinition(definition);
    if (isForbiddenSapMutationToolName(definition.name)) {
      throw new ToolRuntimeError("sap-mutation-forbidden", `工具 ${definition.name} 涉及 SAP 写入、激活、传输或过账，禁止注册。`);
    }
    if (definition.risk !== "read-only" && definition.risk !== "low") {
      throw new ToolRuntimeError("risk-forbidden", `工具 ${definition.name} 的风险级别不在当前只读运行时允许范围内。`);
    }
    if (this.definitions.has(definition.name)) {
      throw new ToolRuntimeError("duplicate-tool", `工具 ${definition.name} 已注册。`);
    }
    this.definitions.set(definition.name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.definitions.values()].map(({ execute: _execute, ...descriptor }) => descriptor);
  }
}

export class PolicyEngine {
  evaluate(definition: ToolDefinition, request: ToolCallRequest, context: ToolExecutionContext): ToolPolicyDecision {
    if (isForbiddenSapMutationToolName(request.toolName)) {
      return deny("sap-mutation-forbidden", "SAP 写入、激活、传输和过账工具在任何权限模式下都不可用。");
    }
    if (definition.risk !== "read-only" && definition.risk !== "low") {
      return deny("risk-forbidden", "当前 Tool Runtime 只允许 read-only 或 low 风险工具。");
    }
    if (!isSafeRuntimeId(context.threadId)) return deny("invalid-context", "当前会话范围无效。");
    if (context.projectId !== null && !isSafeRuntimeId(context.projectId)) return deny("invalid-context", "当前 Project 范围无效。");
    if (context.caseId !== null && !isSafeRuntimeId(context.caseId)) return deny("invalid-context", "当前 Case 范围无效。");
    if (!context.projectId) return deny("project-scope-required", "该工具只能在明确的 Project 范围内执行。");
    if (definition.scope === "case" && !context.caseId) return deny("case-scope-required", "该工具只能在明确的 Case 范围内执行。");

    const scopeDecision = checkArgumentScope(request.arguments, context);
    if (scopeDecision) return scopeDecision;
    if (containsPromptInjection(request.arguments)) {
      return deny("unsafe-arguments", "工具参数包含覆盖安全规则、读取密钥或绕过权限的指令，已拒绝执行。");
    }
    return { outcome: "allow", code: "allowed", message: "只读工具调用已通过当前 Project/Case 范围检查。" };
  }
}

interface IdempotentCall {
  fingerprint: string;
  promise: Promise<ToolExecutionResult>;
}

export class ToolExecutor {
  private readonly completedOrRunningCalls = new Map<string, IdempotentCall>();
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxResultChars: number;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly policyEngine = new PolicyEngine(),
    options: ToolExecutorOptions = {}
  ) {
    this.defaultTimeoutMs = boundedInteger(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, "默认工具超时");
    this.defaultMaxResultChars = boundedInteger(options.defaultMaxResultChars ?? DEFAULT_MAX_RESULT_CHARS, 128, MAX_RESULT_CHARS, "默认工具结果上限");
  }

  execute(request: ToolCallRequest, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    assertCallEnvelope(request);
    const fingerprint = callFingerprint(request, context);
    const existing = this.completedOrRunningCalls.get(request.callId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new ToolRuntimeError("call-id-conflict", "同一 callId 不能用于不同工具、参数或 Project/Case 范围。"));
      }
      return existing.promise;
    }

    const promise = this.executeOnce(request, context);
    this.completedOrRunningCalls.set(request.callId, { fingerprint, promise });
    return promise;
  }

  private async executeOnce(request: ToolCallRequest, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (isForbiddenSapMutationToolName(request.toolName)) {
      throw new ToolRuntimeError("sap-mutation-forbidden", "SAP 写入、激活、传输和过账工具在任何权限模式下都不可用。");
    }
    const definition = this.registry.get(request.toolName);
    if (!definition) throw new ToolRuntimeError("unknown-tool", `工具 ${request.toolName} 未注册，已拒绝执行。`);

    validateToolArguments(definition.inputSchema, request.arguments);
    const decision = this.policyEngine.evaluate(definition, request, context);
    if (decision.outcome !== "allow") throw new ToolRuntimeError(decision.code, decision.message);
    if (context.signal?.aborted) throw cancelledError(context.signal.reason);

    const timeoutMs = definition.timeoutMs ?? this.defaultTimeoutMs;
    const maxResultChars = definition.maxResultChars ?? this.defaultMaxResultChars;
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const cancelFromCaller = () => controller.abort(cancelledError(context.signal?.reason));
    context.signal?.addEventListener("abort", cancelFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new ToolRuntimeError("timeout", `工具 ${definition.name} 执行超时。`));
    }, timeoutMs);

    try {
      const rawResult = await raceWithAbort(
        Promise.resolve(definition.execute(request.arguments as ToolJsonObject, {
          callId: request.callId,
          toolName: request.toolName,
          threadId: context.threadId,
          projectId: context.projectId as string,
          caseId: context.caseId,
          signal: controller.signal
        })),
        controller.signal
      );
      if (controller.signal.aborted) {
        if (timedOut) throw new ToolRuntimeError("timeout", `工具 ${definition.name} 执行超时。`);
        throw cancelledError(controller.signal.reason);
      }
      const sanitized = sanitizeToolResult(rawResult, maxResultChars);
      return {
        callId: request.callId,
        toolName: request.toolName,
        output: sanitized.value,
        truncated: sanitized.truncated,
        redactions: sanitized.redactions,
        durationMs: Date.now() - startedAt,
        trust: "untrusted-data"
      };
    } catch (error) {
      if (timedOut) throw new ToolRuntimeError("timeout", `工具 ${definition.name} 执行超时。`);
      if (context.signal?.aborted || isAbortError(error)) throw cancelledError(error);
      if (error instanceof ToolRuntimeError) throw error;
      throw new ToolRuntimeError("tool-failed", error instanceof Error ? error.message : `工具 ${definition.name} 执行失败。`);
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", cancelFromCaller);
    }
  }
}

export function validateToolArguments(schema: ToolJsonObjectSchema, value: unknown): asserts value is ToolJsonObject {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ToolRuntimeError("invalid-arguments", "工具参数必须是可序列化的 JSON 对象。");
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_ARGUMENT_BYTES) {
    throw new ToolRuntimeError("invalid-arguments", `工具参数不能超过 ${MAX_ARGUMENT_BYTES} bytes。`);
  }
  const errors: string[] = [];
  validateValue(schema, value, "$", errors, 0);
  if (errors.length > 0) throw new ToolRuntimeError("invalid-arguments", `工具参数不符合 schema：${errors.slice(0, 4).join("；")}`);
}

export function isForbiddenSapMutationToolName(name: string): boolean {
  const normalized = typeof name === "string" ? name.trim().toLowerCase() : "";
  const tokens = normalized.split(/[._:-]+/).filter(Boolean);
  const mutationTokens = new Set(["write", "activate", "activation", "transport", "release", "post", "posting", "commit", "update", "modify", "delete", "create"]);
  const sapDomain = tokens.some((token) => token === "sap" || token === "adt" || token === "abap");
  return sapDomain && tokens.some((token) => mutationTokens.has(token));
}

function assertToolDefinition(definition: ToolDefinition): void {
  if (!definition || typeof definition !== "object") throw new ToolRuntimeError("invalid-tool-definition", "工具定义无效。");
  if (!TOOL_NAME_PATTERN.test(definition.name)) throw new ToolRuntimeError("invalid-tool-definition", `工具名 ${definition.name} 格式无效。`);
  if (typeof definition.description !== "string" || !definition.description.trim() || definition.description.length > 500) {
    throw new ToolRuntimeError("invalid-tool-definition", `工具 ${definition.name} 缺少有效说明。`);
  }
  if (definition.scope !== "project" && definition.scope !== "case") {
    throw new ToolRuntimeError("invalid-tool-definition", `工具 ${definition.name} 的 scope 无效。`);
  }
  if (typeof definition.execute !== "function") throw new ToolRuntimeError("invalid-tool-definition", `工具 ${definition.name} 缺少执行器。`);
  assertStrictSchema(definition.inputSchema, "$", 0);
  if (definition.inputSchema.type !== "object") throw new ToolRuntimeError("invalid-tool-definition", `工具 ${definition.name} 的根 schema 必须是 object。`);
  if (definition.timeoutMs !== undefined) boundedInteger(definition.timeoutMs, 1, MAX_TIMEOUT_MS, `工具 ${definition.name} 超时`);
  if (definition.maxResultChars !== undefined) boundedInteger(definition.maxResultChars, 128, MAX_RESULT_CHARS, `工具 ${definition.name} 结果上限`);
}

function assertStrictSchema(schema: ToolJsonSchema, path: string, depth: number): void {
  if (!isPlainObject(schema) || depth > MAX_VALUE_DEPTH) throw new ToolRuntimeError("invalid-tool-definition", `${path} schema 无效或嵌套过深。`);
  const type = schema.type;
  const common = ["type", "description", "enum"];
  const allowedByType: Record<string, string[]> = {
    string: [...common, "minLength", "maxLength", "pattern"],
    number: [...common, "minimum", "maximum"],
    integer: [...common, "minimum", "maximum"],
    boolean: common,
    null: common,
    array: [...common, "items", "minItems", "maxItems"],
    object: [...common, "properties", "required", "additionalProperties", "minProperties", "maxProperties"]
  };
  const allowed = allowedByType[type];
  if (!allowed) throw new ToolRuntimeError("invalid-tool-definition", `${path}.type 不受支持。`);
  for (const key of Object.keys(schema)) {
    if (!allowed.includes(key)) throw new ToolRuntimeError("invalid-tool-definition", `${path}.${key} 不是受支持的 schema 关键字。`);
  }
  if (schema.description !== undefined && (typeof schema.description !== "string" || schema.description.length > 500)) {
    throw new ToolRuntimeError("invalid-tool-definition", `${path}.description 无效。`);
  }
  assertSchemaEnum(schema, path);

  if (type === "object") {
    const objectSchema = schema as ToolJsonObjectSchema;
    if (objectSchema.additionalProperties !== false || !isPlainObject(objectSchema.properties)) {
      throw new ToolRuntimeError("invalid-tool-definition", `${path} 必须显式设置 additionalProperties: false。`);
    }
    const propertyNames = Object.keys(objectSchema.properties);
    if (propertyNames.some((name) => FORBIDDEN_OBJECT_KEYS.has(name))) throw new ToolRuntimeError("invalid-tool-definition", `${path} 包含危险属性名。`);
    const required = objectSchema.required ?? [];
    if (!Array.isArray(required) || new Set(required).size !== required.length || required.some((name) => !propertyNames.includes(name))) {
      throw new ToolRuntimeError("invalid-tool-definition", `${path}.required 无效。`);
    }
    assertOptionalBounds(objectSchema.minProperties, objectSchema.maxProperties, path, "Properties");
    for (const [name, child] of Object.entries(objectSchema.properties)) assertStrictSchema(child, `${path}.${name}`, depth + 1);
    return;
  }
  if (type === "array") {
    const arraySchema = schema as Extract<ToolJsonSchema, { type: "array" }>;
    assertOptionalBounds(arraySchema.minItems, arraySchema.maxItems, path, "Items");
    assertStrictSchema(arraySchema.items, `${path}[]`, depth + 1);
    return;
  }
  if (type === "string") {
    const stringSchema = schema as Extract<ToolJsonSchema, { type: "string" }>;
    assertOptionalBounds(stringSchema.minLength, stringSchema.maxLength, path, "Length");
    if (stringSchema.pattern !== undefined) {
      if (typeof stringSchema.pattern !== "string" || stringSchema.pattern.length > 200) throw new ToolRuntimeError("invalid-tool-definition", `${path}.pattern 无效。`);
      try { new RegExp(stringSchema.pattern); } catch { throw new ToolRuntimeError("invalid-tool-definition", `${path}.pattern 不是有效正则表达式。`); }
    }
    return;
  }
  if (type === "number" || type === "integer") {
    const numberSchema = schema as Extract<ToolJsonSchema, { type: "number" | "integer" }>;
    if (numberSchema.minimum !== undefined && !Number.isFinite(numberSchema.minimum)) throw new ToolRuntimeError("invalid-tool-definition", `${path}.minimum 无效。`);
    if (numberSchema.maximum !== undefined && !Number.isFinite(numberSchema.maximum)) throw new ToolRuntimeError("invalid-tool-definition", `${path}.maximum 无效。`);
    if (numberSchema.minimum !== undefined && numberSchema.maximum !== undefined && numberSchema.minimum > numberSchema.maximum) {
      throw new ToolRuntimeError("invalid-tool-definition", `${path} 的数值范围无效。`);
    }
  }
}

function assertSchemaEnum(schema: ToolJsonSchema, path: string): void {
  if (schema.enum === undefined) return;
  if (!Array.isArray(schema.enum) || schema.enum.length < 1 || schema.enum.length > 100) throw new ToolRuntimeError("invalid-tool-definition", `${path}.enum 无效。`);
  const serialized = schema.enum.map((item) => JSON.stringify(item));
  if (new Set(serialized).size !== serialized.length) throw new ToolRuntimeError("invalid-tool-definition", `${path}.enum 包含重复值。`);
  for (const item of schema.enum) {
    const matches = item === null ? schema.type === "null" : typeof item === schema.type || (schema.type === "integer" && typeof item === "number" && Number.isSafeInteger(item));
    if (!matches) throw new ToolRuntimeError("invalid-tool-definition", `${path}.enum 包含与 type 不一致的值。`);
  }
}

function validateValue(schema: ToolJsonSchema, value: unknown, path: string, errors: string[], depth: number): void {
  if (errors.length >= 8) return;
  if (depth > MAX_VALUE_DEPTH) { errors.push(`${path} 嵌套过深`); return; }
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) { errors.push(`${path} 不在允许值中`); return; }

  if (schema.type === "object") {
    if (!isPlainObject(value)) { errors.push(`${path} 必须是对象`); return; }
    const entries = Object.entries(value);
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) errors.push(`${path}.${key} 是危险属性`);
      else if (!allowed.has(key)) errors.push(`${path}.${key} 不允许出现`);
    }
    for (const required of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${path}.${required} 为必填项`);
    if (schema.minProperties !== undefined && entries.length < schema.minProperties) errors.push(`${path} 属性数量不足`);
    if (schema.maxProperties !== undefined && entries.length > schema.maxProperties) errors.push(`${path} 属性数量过多`);
    for (const [key, child] of entries) {
      const childSchema = schema.properties[key];
      if (childSchema) validateValue(childSchema, child, `${path}.${key}`, errors, depth + 1);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) { errors.push(`${path} 必须是数组`); return; }
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} 项目数量不足`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} 项目数量过多`);
    value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`, errors, depth + 1));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") { errors.push(`${path} 必须是字符串`); return; }
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} 太短`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} 太长`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path} 格式无效`);
    return;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value))) {
      errors.push(`${path} 必须是${schema.type === "integer" ? "安全整数" : "有限数字"}`);
      return;
    }
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} 小于最小值`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} 大于最大值`);
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") errors.push(`${path} 必须是布尔值`);
  if (schema.type === "null" && value !== null) errors.push(`${path} 必须是 null`);
}

function checkArgumentScope(value: unknown, context: ToolExecutionContext): ToolPolicyDecision | null {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!isPlainObject(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
      if (normalizedKey === "projectid" && child !== context.projectId) return deny("cross-project", "工具参数中的 Project 与当前 Project 不一致。");
      if (normalizedKey === "caseid" && child !== context.caseId) return deny("cross-case", "工具参数中的 Case 与当前 Case 不一致。");
      if (normalizedKey === "threadid" && child !== context.threadId) return deny("cross-thread", "工具参数中的 Thread 与当前 Thread 不一致。");
      stack.push(child);
    }
  }
  return null;
}

function containsPromptInjection(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string" && PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(current))) return true;
    if (Array.isArray(current)) stack.push(...current);
    else if (isPlainObject(current)) stack.push(...Object.values(current));
  }
  return false;
}

function sanitizeToolResult(raw: unknown, maxChars: number): { value: ToolJsonValue; truncated: boolean; redactions: number } {
  const state = { redactions: 0, truncated: false };
  const value = sanitizeResultValue(raw, 0, state);
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return { value, truncated: state.truncated, redactions: state.redactions };

  const wrapper = { truncated: true, originalChars: serialized.length, preview: "" };
  const fixedLength = JSON.stringify(wrapper).length;
  wrapper.preview = serialized.slice(0, Math.max(0, maxChars - fixedLength));
  while (JSON.stringify(wrapper).length > maxChars && wrapper.preview.length > 0) wrapper.preview = wrapper.preview.slice(0, -1);
  return { value: wrapper, truncated: true, redactions: state.redactions };
}

function sanitizeResultValue(raw: unknown, depth: number, state: { redactions: number; truncated: boolean }): ToolJsonValue {
  if (depth > MAX_VALUE_DEPTH) { state.truncated = true; return "[结果嵌套过深，已截断]"; }
  if (raw === null || typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new ToolRuntimeError("invalid-result", "工具结果包含非有限数字。");
    return raw;
  }
  if (typeof raw === "string") {
    const redacted = redactText(raw.replace(/\u0000/g, ""));
    state.redactions += redacted.redactions;
    return redacted.value;
  }
  if (Array.isArray(raw)) {
    if (raw.length > MAX_RESULT_ARRAY_ITEMS) state.truncated = true;
    return raw.slice(0, MAX_RESULT_ARRAY_ITEMS).map((item) => sanitizeResultValue(item, depth + 1, state));
  }
  if (isPlainObject(raw)) {
    const entries = Object.entries(raw);
    if (entries.length > MAX_RESULT_OBJECT_KEYS) state.truncated = true;
    const result: ToolJsonObject = {};
    for (const [key, child] of entries.slice(0, MAX_RESULT_OBJECT_KEYS)) {
      const redactedKey = redactText(key.replace(/\u0000/g, ""));
      state.redactions += redactedKey.redactions;
      const safeKey = FORBIDDEN_OBJECT_KEYS.has(redactedKey.value) ? `_${redactedKey.value}` : redactedKey.value.slice(0, 100);
      if (isSensitiveResultKey(key)) {
        result[safeKey] = "[已脱敏]";
        state.redactions += 1;
      } else {
        result[safeKey] = sanitizeResultValue(child, depth + 1, state);
      }
    }
    return result;
  }
  throw new ToolRuntimeError("invalid-result", "工具结果必须是可序列化的 JSON 值。");
}

function redactText(value: string): { value: string; redactions: number } {
  let output = value;
  let redactions = 0;
  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    output = output.replace(pattern, () => { redactions += 1; return "[已脱敏]"; });
  }
  return { value: output, redactions };
}

function isSensitiveResultKey(value: string): boolean {
  if (SENSITIVE_KEY_PATTERN.test(value)) return true;
  const normalized = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return /^(?:apikey|accesskey|authorization|cookie|credentials?|password|passwd|privatekey|secret|clientsecret|token)$/.test(normalized)
    || /(?:password|passwd|secret|token)$/.test(normalized);
}

function raceWithAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function callFingerprint(request: ToolCallRequest, context: ToolExecutionContext): string {
  try {
    return stableJson({ toolName: request.toolName, arguments: request.arguments, scope: {
      threadId: context.threadId, projectId: context.projectId, caseId: context.caseId
    } });
  } catch {
    throw new ToolRuntimeError("invalid-call", "工具调用必须使用可序列化的 JSON 参数和有效范围。");
  }
}

function stableJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("工具参数包含非有限数字。");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("工具参数包含循环引用。");
    seen.add(value);
    const serialized = `[${value.map((item) => stableJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return serialized;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) throw new Error("工具参数包含循环引用。");
    seen.add(value);
    const serialized = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(",")}}`;
    seen.delete(value);
    return serialized;
  }
  throw new Error("工具参数不是有效 JSON 数据。");
}

function assertCallEnvelope(request: ToolCallRequest): void {
  if (!request || typeof request !== "object") throw new ToolRuntimeError("invalid-call", "工具调用无效。");
  if (!isSafeRuntimeId(request.callId)) throw new ToolRuntimeError("invalid-call", "callId 格式无效。");
  if (typeof request.toolName !== "string" || !TOOL_NAME_PATTERN.test(request.toolName)) throw new ToolRuntimeError("invalid-call", "工具名称格式无效。");
}

function assertOptionalBounds(minimum: number | undefined, maximum: number | undefined, path: string, suffix: string): void {
  if (minimum !== undefined && (!Number.isSafeInteger(minimum) || minimum < 0)) throw new ToolRuntimeError("invalid-tool-definition", `${path}.min${suffix} 无效。`);
  if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new ToolRuntimeError("invalid-tool-definition", `${path}.max${suffix} 无效。`);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) throw new ToolRuntimeError("invalid-tool-definition", `${path} 的数量范围无效。`);
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ToolRuntimeError("invalid-tool-definition", `${label}必须在 ${minimum} 到 ${maximum} 之间。`);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeRuntimeId(value: unknown): value is string {
  return typeof value === "string" && RUNTIME_ID_PATTERN.test(value);
}

function deny(code: Exclude<ToolPolicyDecision["code"], "allowed">, message: string): ToolPolicyDecision {
  return { outcome: "deny", code, message };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error instanceof ToolRuntimeError && error.code === "cancelled");
}

function cancelledError(reason?: unknown): ToolRuntimeError {
  const message = reason instanceof Error && reason.message ? reason.message : "用户已取消工具调用。";
  const error = new ToolRuntimeError("cancelled", message);
  error.name = "AbortError";
  return error;
}
