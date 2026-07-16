import type {
  CompiledPrompt,
  ContextTarget,
  MemoryKind,
  MemoryItemRecord,
  PromptMemoryHealth,
  PromptProfileRecord,
  PromptProfileScope
} from "./promptMemoryTypes";
import type { McpConnectionScope, McpConnectionState, McpToolRisk, UpsertMcpConnectionInput } from "./mcpTypes";
import type { SkillPackageRecord, SkillPackageScope } from "./skillTypes";
import type { PluginPackageRecord, PluginPackageScope } from "./pluginTypes";

export interface CapabilityMcpConnectionView {
  id: string;
  name: string;
  description: string;
  scope: McpConnectionScope;
  transport: "stdio" | "streamable-http";
  enabled: boolean;
  state: McpConnectionState;
  statusMessage: string;
  capabilityCount: number;
  lastTestedAt: string | null;
  lastTestSucceeded: boolean | null;
  tools: CapabilityMcpToolView[];
}

export interface CapabilityMcpToolView {
  name: string;
  title: string;
  description: string;
  inputSummary: string;
  risk: McpToolRisk;
  reportedReadOnlyHint: boolean | null;
  enabled: boolean;
  userApprovedReadOnly: boolean;
  canApproveReadOnly: boolean;
  policyLabel: string;
}

export interface CapabilityPromptMemoryHealth {
  ok: boolean;
  schemaVersion: number;
  recoveredFromBackup: boolean;
  warning: string | null;
}

export interface CapabilityCenterSnapshot {
  target: ContextTarget;
  promptMemoryHealth: CapabilityPromptMemoryHealth;
  skills: SkillPackageRecord[];
  plugins: PluginPackageRecord[];
  promptProfiles: PromptProfileRecord[];
  compiledPrompt: CompiledPrompt;
  memories: MemoryItemRecord[];
  mcpConnections: CapabilityMcpConnectionView[];
}

export interface ImportCapabilitySkillInput {
  scope: SkillPackageScope;
}

export interface ImportCapabilityPluginInput {
  scope: PluginPackageScope;
}

export interface SetCapabilityPluginEnabledInput {
  pluginId: string;
  enabled: boolean;
}

export interface SetCapabilitySkillEnabledInput {
  skillId: string;
  enabled: boolean;
}

export interface SaveCapabilityPromptInput {
  scope: PromptProfileScope;
  content: string;
  enabled?: boolean;
}

export interface SetCapabilityPromptEnabledInput {
  scope: PromptProfileScope;
  enabled: boolean;
}

export interface UpdateCapabilityMemoryInput {
  memoryId: string;
  expectedScope: PromptProfileScope;
  content: string;
}

export interface CreateCapabilityMemoryInput {
  scope: PromptProfileScope;
  kind: MemoryKind;
  content: string;
  topicKey?: string | null;
}

export interface ReviewCapabilityMemoryInput {
  memoryId: string;
  expectedScope: PromptProfileScope;
  decision: "confirm" | "reject";
}

export interface RevokeCapabilityMemoryInput {
  memoryId: string;
  expectedScope: PromptProfileScope;
}

export interface SetCapabilityMcpEnabledInput {
  connectionId: string;
  enabled: boolean;
}

export interface SetCapabilityMcpToolEnabledInput {
  connectionId: string;
  toolName: string;
  enabled: boolean;
  confirmReadOnly?: boolean;
}

export interface TestCapabilityMcpInput {
  connectionId: string;
}

export interface RemoveCapabilityMcpInput {
  connectionId: string;
}

export type SaveCapabilityMcpInput = UpsertMcpConnectionInput;

export function promptMemoryHealthView(health: PromptMemoryHealth): CapabilityPromptMemoryHealth {
  return {
    ok: health.ok,
    schemaVersion: health.schemaVersion,
    recoveredFromBackup: health.recoveredFromBackup,
    warning: health.warning
  };
}
