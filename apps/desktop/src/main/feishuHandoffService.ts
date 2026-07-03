import path from "node:path";
import type { CaseGeneratedFile, CaseSummary, FeishuConfig, FeishuHandoffPublishStatus, ProjectSummary } from "../shared/workbenchTypes";

export const FEISHU_HANDOFF_LOCAL_ONLY_MARKER = "feishu-handoff-local-only";

export const FEISHU_HANDOFF_BLOCKED_ACTIONS = [
  "cloud document creation",
  "cloud document update",
  "cloud whiteboard update",
  "device login flow",
  "secret storage",
  "automatic final publish"
] as const;

export interface FeishuHandoffSourceSummary {
  relativePath: string;
  displayName: string;
  fileType: string;
  sizeBytes: number;
  snippet: string;
  updatedAt: string;
}

export interface FeishuHandoffArtifacts {
  createdAt: string;
  publishStatus: FeishuHandoffPublishStatus;
  generatedFiles: CaseGeneratedFile[];
  sourceFiles: string[];
  blockedActions: string[];
}

export interface FeishuHandoffRenderInput {
  project: ProjectSummary;
  caseItem: CaseSummary;
  feishu: FeishuConfig;
  safeOutputSummaries: FeishuHandoffSourceSummary[];
  createdAt?: string;
}

const MAX_SOURCE_FILES = 12;
const MAX_SNIPPET_CHARS = 240;

function timestampSlug(value: string): string {
  return value.replace(/[-:.TZ]/g, "").slice(0, 14);
}

function plain(value: string, fallback = ""): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function mdCell(value: string): string {
  return plain(value).replaceAll("|", "\\|");
}

function mermaidLabel(value: string): string {
  return plain(value, "item").replace(/["<>]/g, "");
}

function snippet(value: string): string {
  const normalized = plain(value);
  return normalized.length > MAX_SNIPPET_CHARS ? `${normalized.slice(0, MAX_SNIPPET_CHARS)}...` : normalized;
}

function statusLabel(value: FeishuConfig): string {
  if (value.authStatus === "verified" && value.docPermissionStatus === "verified") {
    return "verified locally by CLI status checks";
  }
  if (value.authStatus === "verified") {
    return "CLI login verified, document permission not verified";
  }
  return "not verified for cloud publishing";
}

function sensitivePatterns(): RegExp[] {
  return [
    /authorization\s*[:=]/i,
    /cookie\s*[:=]/i,
    /bearer\s+[a-z0-9._~+/=-]{12,}/i,
    /secure-store:sec_[a-f0-9]{32}/i,
    /sk-(?:proj-)?[a-z0-9_-]{20,}/i,
    /api[_-]?key\s*[:=]/i,
    /password\s*[:=]/i,
    /token\s*[:=]/i,
    new RegExp("tenant_" + "access_" + "token", "i"),
    new RegExp("user_" + "access_" + "token", "i"),
    new RegExp("device_" + "code", "i"),
    new RegExp("verification_" + "uri", "i"),
    new RegExp("document_" + "id", "i"),
    /https:\/\/[a-z0-9.-]*feishu/i,
    /https:\/\/[a-z0-9.-]*larksuite/i
  ];
}

export function assertSafeFeishuHandoffText(content: string): string {
  if (sensitivePatterns().some((pattern) => pattern.test(content))) {
    throw new Error("Feishu handoff draft contains a blocked secret, auth, or cloud-publication marker.");
  }
  return content;
}

function renderMarkdown(input: Required<FeishuHandoffRenderInput>, sources: FeishuHandoffSourceSummary[]): string {
  const rows = sources.map((source) => (
    `| ${mdCell(source.displayName)} | ${mdCell(source.relativePath)} | ${mdCell(source.fileType || "text")} | ${mdCell(snippet(source.snippet))} |`
  ));
  const sourceRows = rows.length > 0 ? rows : ["| No safe output source | outputs/ | text | Generate a case output first, then prepare this handoff again. |"];
  return assertSafeFeishuHandoffText([
    "# Feishu CLI Local Handoff Draft",
    "",
    `Marker: ${FEISHU_HANDOFF_LOCAL_ONLY_MARKER}`,
    "",
    "## Status",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Publish status | not-published |`,
    `| Created at | ${input.createdAt} |`,
    `| Project | ${mdCell(input.project.name)} |`,
    `| Case | ${mdCell(input.caseItem.title)} |`,
    `| Feishu profile | ${mdCell(input.feishu.profile || "default")} |`,
    `| Feishu CLI check | ${statusLabel(input.feishu)} |`,
    "",
    "## Boundary",
    "",
    "- This file is a local draft for human review.",
    "- The workbench did not create or update any Feishu cloud document.",
    "- The final cloud publish step must be performed and confirmed by a human.",
    "- No secret values or cloud document identifiers are stored here.",
    "",
    "## Source Outputs",
    "",
    "| Name | Local file | Type | Safe summary |",
    "|---|---|---|---|",
    ...sourceRows,
    "",
    "## Manual Handoff Checklist",
    "",
    "1. Open the Markdown output in this case folder.",
    "2. Review the business wording and remove anything not suitable for the target Feishu workspace.",
    "3. Use the approved Feishu CLI or Feishu client workflow outside this action.",
    "4. Record the final cloud link manually in the case only after the human publish step succeeds.",
    "",
    "## Blocked In This Action",
    "",
    ...FEISHU_HANDOFF_BLOCKED_ACTIONS.map((action) => `- ${action}`)
  ].join("\n"));
}

function renderMermaid(input: Required<FeishuHandoffRenderInput>, sources: FeishuHandoffSourceSummary[]): string {
  const sourceLines = sources.slice(0, 5).map((source, index) => (
    `  S${index + 1}["${mermaidLabel(source.displayName)}"] --> R["Human review"]`
  ));
  return assertSafeFeishuHandoffText([
    "flowchart TD",
    `  A["${mermaidLabel(input.caseItem.title)}"] --> B["Safe local outputs"]`,
    "  B --> R[\"Human review\"]",
    ...sourceLines,
    "  R --> C[\"Approved Feishu workflow outside this app\"]",
    "  C --> D[\"Manual publish confirmation\"]",
    "  D --> E[\"Record final link only after confirmation\"]"
  ].join("\n"));
}

function renderManifest(input: Required<FeishuHandoffRenderInput>, sources: FeishuHandoffSourceSummary[], generatedFiles: string[]): string {
  return assertSafeFeishuHandoffText(`${JSON.stringify({
    schemaVersion: 1,
    marker: FEISHU_HANDOFF_LOCAL_ONLY_MARKER,
    publishStatus: "not-published",
    createdAt: input.createdAt,
    projectId: input.project.id,
    caseId: input.caseItem.id,
    feishuProfile: input.feishu.profile || "default",
    feishuCliStatus: {
      authStatus: input.feishu.authStatus,
      docPermissionStatus: input.feishu.docPermissionStatus,
      lastCheckedAt: input.feishu.lastCheckedAt
    },
    sourceFiles: sources.map((source) => ({
      relativePath: source.relativePath,
      displayName: source.displayName,
      fileType: source.fileType,
      sizeBytes: source.sizeBytes,
      updatedAt: source.updatedAt
    })),
    generatedFiles,
    blockedActions: FEISHU_HANDOFF_BLOCKED_ACTIONS,
    safety: {
      localOnly: true,
      cloudDocumentCreated: false,
      cloudDocumentUpdated: false,
      cloudWhiteboardUpdated: false,
      tokenStored: false,
      finalPublishRequiresHuman: true
    }
  }, null, 2)}\n`);
}

export function renderFeishuHandoffArtifacts(input: FeishuHandoffRenderInput): FeishuHandoffArtifacts {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const normalizedInput: Required<FeishuHandoffRenderInput> = { ...input, createdAt };
  const sources = input.safeOutputSummaries.slice(0, MAX_SOURCE_FILES).map((source) => ({
    ...source,
    relativePath: source.relativePath.replaceAll("\\", "/"),
    displayName: plain(source.displayName, path.basename(source.relativePath)),
    snippet: snippet(source.snippet)
  }));
  const slug = timestampSlug(createdAt);
  const handoffPath = `outputs/feishu-handoff-${slug}.md`;
  const whiteboardPath = `outputs/feishu-whiteboard-${slug}.mmd`;
  const manifestPath = `technical/feishu-handoff-manifest-${slug}.json`;
  const generatedPaths = [handoffPath, whiteboardPath, manifestPath];
  const generatedFiles: CaseGeneratedFile[] = [
    {
      relativePath: handoffPath,
      purpose: "output",
      content: renderMarkdown(normalizedInput, sources)
    },
    {
      relativePath: whiteboardPath,
      purpose: "output",
      content: renderMermaid(normalizedInput, sources)
    },
    {
      relativePath: manifestPath,
      purpose: "technical",
      content: renderManifest(normalizedInput, sources, generatedPaths)
    }
  ];
  return {
    createdAt,
    publishStatus: "not-published",
    generatedFiles,
    sourceFiles: sources.map((source) => source.relativePath),
    blockedActions: [...FEISHU_HANDOFF_BLOCKED_ACTIONS]
  };
}
