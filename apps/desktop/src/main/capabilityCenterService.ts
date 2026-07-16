import type {
  CapabilityCenterSnapshot,
  CreateCapabilityMemoryInput,
  ImportCapabilityPluginInput,
  ImportCapabilitySkillInput,
  RemoveCapabilityMcpInput,
  ReviewCapabilityMemoryInput,
  RevokeCapabilityMemoryInput,
  SaveCapabilityMcpInput,
  SaveCapabilityPromptInput,
  SetCapabilityMcpEnabledInput,
  SetCapabilityMcpToolEnabledInput,
  SetCapabilityPluginEnabledInput,
  SetCapabilityPromptEnabledInput,
  SetCapabilitySkillEnabledInput,
  TestCapabilityMcpInput,
  UpdateCapabilityMemoryInput
} from "../shared/capabilityCenterTypes";
import { promptMemoryHealthView } from "../shared/capabilityCenterTypes";
import type { ContextTarget, PromptProfileScope } from "../shared/promptMemoryTypes";
import { parseSkillPackageScope } from "../shared/skillTypes";
import type { SkillPackagePreview, SkillPackageRecord } from "../shared/skillTypes";
import { parsePluginPackageScope } from "../shared/pluginTypes";
import type { PluginPackagePreview, PluginPackageRecord } from "../shared/pluginTypes";
import type { McpConnectionScope, McpConnectionSummary } from "../shared/mcpTypes";
import { McpConnectionManager } from "./mcpConnectionManager";
import { PromptMemoryService } from "./promptMemoryService";
import { PluginPackageService } from "./pluginPackageService";
import { SkillPackageService } from "./skillPackageService";
import { WorkspaceStore } from "./workspaceStore";

const SENSITIVE_MCP_INPUT_FIELD = /(?:api[_-]?key|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token)/i;

export class CapabilityCenterService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly promptMemory: PromptMemoryService,
    private readonly skills: SkillPackageService,
    private readonly mcp: McpConnectionManager,
    private readonly plugins: PluginPackageService
  ) {}

  async getSnapshot(): Promise<CapabilityCenterSnapshot> {
    const target = await this.currentTarget();
    const skillRecords = (await this.skills.listInstalled()).filter((item) => (
      item.scope.kind === "global" || item.scope.projectId === target.projectId
    ));
    const pluginRecords = (await this.plugins.listInstalled()).filter((item) => (
      item.scope.kind === "global" || item.scope.projectId === target.projectId
    ));
    const memories = this.scopesForTarget(target)
      .flatMap((scope) => this.promptMemory.listMemoryItems(scope))
      .filter((item) => item.status !== "rejected" && item.status !== "revoked");
    const mcpConnections = this.mcp.listConnections()
      .filter((item) => item.scope.type === "global" || item.scope.projectId === target.projectId)
      .map((item) => this.toMcpView(item));
    return {
      target,
      promptMemoryHealth: promptMemoryHealthView(this.promptMemory.getHealth()),
      skills: skillRecords,
      plugins: pluginRecords,
      promptProfiles: this.promptMemory.listPromptProfiles(target),
      compiledPrompt: this.promptMemory.compilePrompt({ target }),
      memories,
      mcpConnections
    };
  }

  async preflightPluginImport(sourcePath: string, input: ImportCapabilityPluginInput): Promise<PluginPackagePreview> {
    const scope = parsePluginPackageScope(input?.scope);
    const target = await this.currentTarget();
    if (scope.kind === "project" && scope.projectId !== target.projectId) {
      throw new Error("Plugin 只能安装到当前 Project 或全局范围。");
    }
    return this.plugins.preflightImport({ sourcePath, scope });
  }

  confirmPluginImport(importId: string): Promise<PluginPackageRecord> {
    return this.plugins.confirmImport(importId);
  }

  cancelPluginImport(importId: string): Promise<boolean> {
    return this.plugins.cancelImport(importId);
  }

  async setPluginEnabled(input: SetCapabilityPluginEnabledInput): Promise<PluginPackageRecord> {
    if (!input || typeof input.pluginId !== "string" || typeof input.enabled !== "boolean") {
      throw new Error("Plugin 启停请求无效。");
    }
    const target = await this.currentTarget();
    const record = (await this.plugins.listInstalled()).find((item) => item.id === input.pluginId);
    if (!record || (record.scope.kind === "project" && record.scope.projectId !== target.projectId)) {
      throw new Error("Plugin 不存在或不属于当前 Project。");
    }
    return this.plugins.setEnabled(input.pluginId, input.enabled);
  }

  async preflightSkillImport(sourcePath: string, input: ImportCapabilitySkillInput): Promise<SkillPackagePreview> {
    const scope = parseSkillPackageScope(input?.scope);
    const target = await this.currentTarget();
    if (scope.kind === "project" && scope.projectId !== target.projectId) {
      throw new Error("Skill 只能安装到当前 Project 或全局范围。");
    }
    return this.skills.preflightImport({ sourceKind: "folder", sourcePath, scope });
  }

  confirmSkillImport(importId: string): Promise<SkillPackageRecord> {
    return this.skills.confirmImport(importId);
  }

  cancelSkillImport(importId: string): Promise<boolean> {
    return this.skills.cancelImport(importId);
  }

  async setSkillEnabled(input: SetCapabilitySkillEnabledInput): Promise<SkillPackageRecord> {
    if (!input || typeof input.skillId !== "string" || typeof input.enabled !== "boolean") {
      throw new Error("Skill 启停请求无效。");
    }
    const target = await this.currentTarget();
    const record = (await this.skills.listInstalled()).find((item) => item.id === input.skillId);
    if (!record || (record.scope.kind === "project" && record.scope.projectId !== target.projectId)) {
      throw new Error("Skill 不存在或不属于当前 Project。");
    }
    return this.skills.setEnabled(input.skillId, input.enabled);
  }

  async savePrompt(input: SaveCapabilityPromptInput): Promise<void> {
    const scope = await this.assertCurrentPromptScope(input?.scope);
    await this.promptMemory.upsertPromptProfile({ scope, content: input.content, enabled: input.enabled });
  }

  async setPromptEnabled(input: SetCapabilityPromptEnabledInput): Promise<void> {
    if (typeof input?.enabled !== "boolean") throw new Error("提示词启停请求无效。");
    const scope = await this.assertCurrentPromptScope(input.scope);
    const target = await this.currentTarget();
    const record = this.promptMemory.listPromptProfiles(target).find((item) => sameScope(item.scope, scope));
    if (!record) throw new Error("请先保存该层提示词，再启用或停用。");
    await this.promptMemory.upsertPromptProfile({ scope, content: record.content, enabled: input.enabled });
  }

  async updateMemory(input: UpdateCapabilityMemoryInput): Promise<void> {
    const scope = await this.assertCurrentPromptScope(input?.expectedScope);
    await this.promptMemory.updateMemoryCandidate({ memoryId: input.memoryId, expectedScope: scope, content: input.content });
  }

  async createMemory(input: CreateCapabilityMemoryInput): Promise<void> {
    const scope = await this.assertCurrentPromptScope(input?.scope);
    const target = await this.currentTarget();
    await this.promptMemory.createMemoryCandidate({
      scope,
      kind: input.kind,
      content: input.content,
      topicKey: input.topicKey ?? null,
      provenance: {
        sourceType: "user",
        sourceRef: `manual:${target.threadId}`,
        capturedAt: new Date().toISOString()
      }
    });
  }

  async reviewMemory(input: ReviewCapabilityMemoryInput): Promise<void> {
    if (input?.decision !== "confirm" && input?.decision !== "reject") throw new Error("记忆审核请求无效。");
    const scope = await this.assertCurrentPromptScope(input.expectedScope);
    await this.promptMemory.reviewMemory({ memoryId: input.memoryId, expectedScope: scope, decision: input.decision, reviewedBy: "user" });
  }

  async revokeMemory(input: RevokeCapabilityMemoryInput): Promise<void> {
    const scope = await this.assertCurrentPromptScope(input?.expectedScope);
    await this.promptMemory.revokeMemory({ memoryId: input.memoryId, expectedScope: scope, reviewedBy: "user" });
  }

  async saveMcpConnection(input: SaveCapabilityMcpInput): Promise<void> {
    const target = await this.currentTarget();
    this.assertMcpScopeForTarget(input?.scope, target);
    if (input?.id) {
      const existing = this.requireMcpForTarget(input.id, target);
      if (!sameMcpConnectionScope(existing.scope, input.scope)) {
        throw new Error("MCP 连接的全局/Project 范围和所属 Project 创建后不可更改。");
      }
    }
    await this.mcp.upsertConnection(input, { currentProjectId: target.projectId });
  }

  async testMcpConnection(input: TestCapabilityMcpInput): Promise<void> {
    const target = await this.currentTarget();
    const connection = this.requireMcpForTarget(input?.connectionId, target);
    await this.mcp.testConnection(connection.id, { currentProjectId: target.projectId });
  }

  async setMcpEnabled(input: SetCapabilityMcpEnabledInput): Promise<void> {
    if (typeof input?.enabled !== "boolean") throw new Error("MCP 启停请求无效。");
    const target = await this.currentTarget();
    const connection = this.requireMcpForTarget(input.connectionId, target);
    await this.mcp.setConnectionEnabled(connection.id, input.enabled, { currentProjectId: target.projectId });
  }

  async setMcpToolEnabled(input: SetCapabilityMcpToolEnabledInput): Promise<void> {
    if (typeof input?.toolName !== "string" || !input.toolName.trim() || typeof input.enabled !== "boolean") {
      throw new Error("MCP 工具启停请求无效。");
    }
    const target = await this.currentTarget();
    const connection = this.requireMcpForTarget(input.connectionId, target);
    await this.mcp.setToolEnabled(
      connection.id,
      input.toolName,
      input.enabled,
      { currentProjectId: target.projectId },
      { confirmReadOnly: input.confirmReadOnly === true }
    );
  }

  async removeMcpConnection(input: RemoveCapabilityMcpInput): Promise<void> {
    const target = await this.currentTarget();
    const connection = this.requireMcpForTarget(input?.connectionId, target);
    await this.mcp.removeConnection(connection.id, { currentProjectId: target.projectId });
  }

  private async currentTarget(): Promise<ContextTarget> {
    const state = await this.store.getState();
    return {
      threadId: state.activeWorkThreadId || state.activeChatThreadId || "capability-center",
      projectId: state.activeProjectId || null,
      caseId: state.activeCaseId || null
    };
  }

  private scopesForTarget(target: ContextTarget): PromptProfileScope[] {
    const scopes: PromptProfileScope[] = [{ type: "personal" }];
    if (target.projectId) scopes.push({ type: "project", projectId: target.projectId });
    if (target.projectId && target.caseId) scopes.push({ type: "case", projectId: target.projectId, caseId: target.caseId });
    return scopes;
  }

  private async assertCurrentPromptScope(scope: PromptProfileScope): Promise<PromptProfileScope> {
    if (!scope || typeof scope !== "object") throw new Error("提示词或记忆范围无效。");
    const target = await this.currentTarget();
    if (scope.type === "personal") return { type: "personal" };
    if (scope.type === "project" && scope.projectId === target.projectId) return { type: "project", projectId: scope.projectId };
    if (scope.type === "case" && scope.projectId === target.projectId && scope.caseId === target.caseId) {
      return { type: "case", projectId: scope.projectId, caseId: scope.caseId };
    }
    throw new Error("该内容不属于当前 Project/Case，已阻止跨范围修改。");
  }

  private assertMcpScopeForTarget(scope: McpConnectionScope, target: ContextTarget): void {
    if (scope?.type === "global") return;
    if (scope?.type === "project" && scope.projectId === target.projectId) return;
    throw new Error("MCP 连接只能保存到当前 Project 或全局范围。");
  }

  private requireMcpForTarget(connectionId: unknown, target: ContextTarget): McpConnectionSummary {
    if (typeof connectionId !== "string" || !connectionId.trim()) throw new Error("MCP 连接 ID 无效。");
    const connection = this.mcp.listConnections().find((item) => item.id === connectionId);
    if (!connection || (connection.scope.type === "project" && connection.scope.projectId !== target.projectId)) {
      throw new Error("MCP 连接不存在或不属于当前 Project。");
    }
    return connection;
  }

  private toMcpView(item: McpConnectionSummary): CapabilityCenterSnapshot["mcpConnections"][number] {
    const visibleTools = (item.discovery?.tools ?? []).filter((tool) => !mcpInputSchemaHasSensitiveFields(tool.inputSchema));
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      scope: item.scope,
      transport: item.transport.type,
      enabled: item.enabled,
      state: item.state,
      statusMessage: item.statusMessage,
      capabilityCount: visibleTools.length + (item.discovery?.resources.length ?? 0) + (item.discovery?.prompts.length ?? 0),
      lastTestedAt: item.lastTestedAt,
      lastTestSucceeded: item.lastTestSucceeded,
      tools: visibleTools.map((tool) => ({
        name: tool.name,
        title: tool.title ?? tool.name,
        description: tool.description,
        inputSummary: summarizeMcpInput(tool.inputSchema),
        risk: tool.risk,
        reportedReadOnlyHint: tool.readOnlyHint,
        enabled: tool.enabled,
        userApprovedReadOnly: tool.userApprovedReadOnly,
        canApproveReadOnly: tool.canApproveReadOnly,
        policyLabel: tool.risk === "destructive"
          ? "涉及写入或破坏性操作，系统已阻止"
          : "稳定版仅支持连接、测试和能力发现，不允许自动执行外部 MCP 工具"
      }))
    };
  }
}

function summarizeMcpInput(schema: Record<string, unknown>): string {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return "无需参数或参数结构未声明";
  const names = Object.keys(properties).slice(0, 8);
  if (names.length === 0) return "无需参数";
  const suffix = Object.keys(properties).length > names.length ? " 等" : "";
  return `参数：${names.join("、")}${suffix}`;
}

function mcpInputSchemaHasSensitiveFields(schema: Record<string, unknown>): boolean {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, stringIsFieldName = false): boolean => {
    if (typeof value === "string") return stringIsFieldName && SENSITIVE_MCP_INPUT_FIELD.test(value);
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => visit(item, stringIsFieldName));
    return Object.entries(value).some(([key, item]) => (
      SENSITIVE_MCP_INPUT_FIELD.test(key)
      || visit(item, key === "required" || key === "dependentRequired")
    ));
  };
  return visit(schema);
}

function sameMcpConnectionScope(left: McpConnectionScope, right: McpConnectionScope): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "global" && right.type === "global") return true;
  return left.type === "project" && right.type === "project" && left.projectId === right.projectId;
}

function sameScope(left: PromptProfileScope, right: PromptProfileScope): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "personal" && right.type === "personal") return true;
  if (left.type === "project" && right.type === "project") return left.projectId === right.projectId;
  if (left.type === "case" && right.type === "case") return left.projectId === right.projectId && left.caseId === right.caseId;
  return false;
}
