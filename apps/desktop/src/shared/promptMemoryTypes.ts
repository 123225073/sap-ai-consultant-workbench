export type PromptProfileScopeType = "personal" | "project" | "case";
export type PromptLayerName =
  | "product-safety"
  | "product-base"
  | "personal"
  | "project"
  | "case"
  | "current-task"
  | "skill";

export type PromptProfileScope =
  | { type: "personal" }
  | { type: "project"; projectId: string }
  | { type: "case"; projectId: string; caseId: string };

export interface ContextTarget {
  threadId: string;
  projectId: string | null;
  caseId: string | null;
}

export interface PromptSourceAttribution {
  title: string;
  url: string;
  usage: string;
}

export interface PromptProfileRecord {
  id: string;
  scope: PromptProfileScope;
  content: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPromptProfileInput {
  scope: PromptProfileScope;
  content: string;
  enabled?: boolean;
}

export interface EphemeralPromptInstruction {
  ref: string;
  content: string;
}

export interface CompilePromptInput {
  target: ContextTarget;
  currentTaskInstruction?: EphemeralPromptInstruction | null;
  skillInstructions?: EphemeralPromptInstruction[];
}

export interface CompiledPromptLayer {
  ref: string;
  layer: PromptLayerName;
  content: string;
  immutable: boolean;
  included: boolean;
  tokenEstimate: number;
  attributions: PromptSourceAttribution[];
}

export interface PromptConflict {
  ref: string;
  layer: PromptLayerName;
  blockedByRuleId: string;
  reason: string;
}

export interface CompiledPrompt {
  systemPrompt: string;
  layers: CompiledPromptLayer[];
  conflicts: PromptConflict[];
  tokenEstimate: number;
  attributions: PromptSourceAttribution[];
}

export type MemoryKind = "preference" | "fact" | "constraint" | "decision";
export type MemoryStatus = "candidate" | "confirmed" | "rejected" | "revoked";
export type MemorySourceType = "user" | "thread" | "case-file" | "published-knowledge" | "sap-evidence" | "runtime";

export interface MemoryProvenance {
  sourceType: MemorySourceType;
  sourceRef: string;
  capturedAt: string;
}

export interface MemoryItemRecord {
  id: string;
  scope: PromptProfileScope;
  kind: MemoryKind;
  topicKey: string | null;
  content: string;
  status: MemoryStatus;
  provenance: MemoryProvenance;
  validUntil: string | null;
  hasConflict: boolean;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  revokedAt: string | null;
}

export interface CreateMemoryCandidateInput {
  scope: PromptProfileScope;
  kind: MemoryKind;
  topicKey?: string | null;
  content: string;
  provenance: MemoryProvenance;
  validUntil?: string | null;
}

export interface ReviewMemoryInput {
  memoryId: string;
  expectedScope: PromptProfileScope;
  decision: "confirm" | "reject";
  reviewedBy: "user";
}

export interface RevokeMemoryInput {
  memoryId: string;
  expectedScope: PromptProfileScope;
  reviewedBy: "user";
}

export interface UpdateMemoryCandidateInput {
  memoryId: string;
  expectedScope: PromptProfileScope;
  content: string;
}

export type MemoryResolutionExclusionReason =
  | "candidate-not-confirmed"
  | "memory-rejected"
  | "memory-revoked"
  | "memory-expired"
  | "conflict-older";

export interface ResolvedMemoryExclusion {
  memoryId: string;
  reason: MemoryResolutionExclusionReason;
}

export interface ResolvedMemorySet {
  included: MemoryItemRecord[];
  excluded: ResolvedMemoryExclusion[];
}

export type ThreadCheckpointStatus = "active" | "superseded" | "revoked";

export interface ThreadCheckpointRecord {
  id: string;
  target: ContextTarget;
  content: string;
  sourceItemRefs: string[];
  version: number;
  status: ThreadCheckpointStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SaveThreadCheckpointInput {
  target: ContextTarget;
  content: string;
  sourceItemRefs: string[];
}

export type ContextItemKind =
  | "recent-message"
  | "thread-checkpoint"
  | "personal-memory"
  | "project-memory"
  | "case-memory"
  | "published-knowledge"
  | "sap-evidence"
  | "tool-result";

export type ContextItemScope =
  | { type: "global" }
  | { type: "project"; projectId: string }
  | { type: "case"; projectId: string; caseId: string }
  | { type: "thread"; threadId: string; projectId: string | null; caseId: string | null };

export interface ContextCandidateItem {
  ref: string;
  kind: Exclude<ContextItemKind, "thread-checkpoint" | "personal-memory" | "project-memory" | "case-memory">;
  content: string;
  scope: ContextItemScope;
  createdAt?: string | null;
  priority?: number;
}

export interface BuildContextInput extends CompilePromptInput {
  turnId: string;
  contextWindowTokens: number;
  reservedOutputTokens?: number;
  recentMessages?: ContextCandidateItem[];
  evidence?: ContextCandidateItem[];
  now?: string;
}

export type ContextBudgetStatus = "within-budget" | "checkpoint-recommended" | "compacted";

export interface ContextBudgetReport {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  initialInputTokens: number;
  selectedInputTokens: number;
  initialUsageRatio: number;
  selectedUsageRatio: number;
  warningThreshold: 0.75;
  hardThreshold: 0.88;
  checkpointRecommended: boolean;
  compactionApplied: boolean;
  status: ContextBudgetStatus;
}

export type ContextExclusionReason =
  | "cross-project"
  | "cross-case"
  | "cross-thread"
  | "sensitive-content"
  | "duplicate-content"
  | "budget-trimmed"
  | "memory-not-relevant"
  | "memory-top-k"
  | MemoryResolutionExclusionReason;

export interface ContextAuditSelection {
  ref: string;
  kind: ContextItemKind | PromptLayerName;
  estimatedTokens: number;
}

export interface ContextAuditExclusion {
  ref: string;
  kind: ContextItemKind | PromptLayerName;
  reason: ContextExclusionReason;
  estimatedTokens: number;
}

export interface ContextAuditRecord {
  id: string;
  turnId: string;
  target: ContextTarget;
  selected: ContextAuditSelection[];
  excluded: ContextAuditExclusion[];
  promptConflictRefs: string[];
  budget: ContextBudgetReport;
  createdAt: string;
}

export interface SelectedContextItem {
  ref: string;
  kind: ContextItemKind;
  content: string;
  estimatedTokens: number;
}

export interface AssembledModelContext {
  instructions: string;
  prompt: CompiledPrompt;
  items: SelectedContextItem[];
  budget: ContextBudgetReport;
  audit: ContextAuditRecord;
}

export interface PromptMemoryHealth {
  ok: boolean;
  databasePath: string;
  schemaVersion: number;
  recoveredFromBackup: boolean;
  warning: string | null;
}
