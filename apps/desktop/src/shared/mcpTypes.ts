export type McpConnectionScope =
  | { type: "global" }
  | { type: "project"; projectId: string };

export interface McpOperationContext {
  currentProjectId: string | null;
}

export interface McpStdioTransportConfig {
  type: "stdio";
  command: string;
  args: string[];
  cwd: string | null;
  environmentRefs: Record<string, string>;
}

export interface McpHttpTransportConfig {
  type: "streamable-http";
  endpoint: string;
  headerRefs: Record<string, string>;
}

export type McpTransportConfig = McpStdioTransportConfig | McpHttpTransportConfig;

export interface McpConnectionRecord {
  id: string;
  name: string;
  description: string;
  scope: McpConnectionScope;
  transport: McpTransportConfig;
  enabled: boolean;
  enabledTools: string[];
  approvedReadOnlyTools: string[];
  createdAt: string;
  updatedAt: string;
  lastTestedAt: string | null;
  lastTestSucceeded: boolean | null;
  lastTestMessage: string | null;
}

export interface UpsertMcpConnectionInput {
  id?: string;
  name: string;
  description?: string;
  scope: McpConnectionScope;
  transport: McpTransportConfig;
}

export type McpConnectionState = "disconnected" | "connecting" | "connected" | "failed";
export type McpToolRisk = "read-only" | "unknown" | "destructive";

export interface McpToolDescriptor {
  name: string;
  namespacedName: string;
  title: string | null;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: McpToolRisk;
  readOnlyHint: boolean | null;
  destructiveHint: boolean | null;
  openWorldHint: boolean | null;
  enabled: boolean;
  userApprovedReadOnly: boolean;
  canApproveReadOnly: boolean;
}

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  title: string | null;
  description: string;
  mimeType: string | null;
}

export interface McpPromptDescriptor {
  name: string;
  title: string | null;
  description: string;
  argumentNames: string[];
}

export interface McpDiscoverySnapshot {
  connectionId: string;
  serverName: string;
  serverVersion: string;
  serverInstructionsIgnored: boolean;
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  prompts: McpPromptDescriptor[];
  discoveredAt: string;
}

export interface McpConnectionSummary extends McpConnectionRecord {
  state: McpConnectionState;
  statusMessage: string;
  discovery: McpDiscoverySnapshot | null;
}

export interface McpToolCallInput {
  connectionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  userConfirmedRisk?: boolean;
  signal?: AbortSignal;
}

export interface McpToolCallResult {
  connectionId: string;
  toolName: string;
  isError: boolean;
  resultPreview: string;
  truncated: boolean;
  trust: "untrusted-mcp-data";
}

export interface McpManagerHealth {
  ok: boolean;
  storagePath: string;
  connectionCount: number;
  connectedCount: number;
  warning: string | null;
}
