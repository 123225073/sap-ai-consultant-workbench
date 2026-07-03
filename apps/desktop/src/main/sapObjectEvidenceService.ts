import { createHash } from "node:crypto";
import type {
  AdtRedactedSystemInfo,
  AdtVerificationMode,
  CaseGeneratedFile,
  SapObjectEvidenceRequest,
  SapObjectEvidenceSummary,
  SapObjectEvidenceType
} from "../shared/workbenchTypes";

export const SAP_OBJECT_EVIDENCE_ALLOWED_TYPES = [
  "program",
  "class",
  "function",
  "include",
  "table",
  "structure"
] as const;

export const sapObjectEvidenceBoundary = "SAP read-only evidence: one explicit object for the active case only; no SAP write, no arbitrary SQL, no batch reads, no transport, no raw connector output.";

export interface SapObjectEvidenceConnectorResult {
  objectType: SapObjectEvidenceType;
  objectName: string;
  functionGroup: string | null;
  system: AdtRedactedSystemInfo;
  sourceMode: AdtVerificationMode;
  evidenceKind?: "fixed-adt-readonly-source";
  content: string;
  readAt: string;
}

export interface SapObjectEvidenceRecord {
  summary: SapObjectEvidenceSummary;
  content: string;
}

const MAX_OBJECT_NAME_CHARS = 48;
const MAX_EVIDENCE_TEXT_CHARS = 20000;

const allowedTypes = new Set<string>(SAP_OBJECT_EVIDENCE_ALLOWED_TYPES);

const unsafeNamePatterns = [
  /[\u0000-\u001f\u007f]/,
  /\s/,
  /\.\./,
  /[\\:*?"<>|]/,
  /[#;&]/,
  /^[a-z][a-z0-9+.-]*:/i,
  /\*/,
  /\?/,
  /\b(SELECT|UPDATE|INSERT|DELETE|MODIFY|CALL|SUBMIT|TRANSACTION|TRANSPORT|ACTIVATE|PACKAGE|NAMESPACE|WHERE|FROM)\b/i
];

const hardUnsafeEvidenceTextPatterns = [
  /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /secure-store:sec_[a-f0-9]{32}/i,
  /bearer\s+[a-z0-9._~+/=-]{12,}/i,
  /authorization\s*[:=]\s*[^\n\r]+/i,
  /cookie\s*[:=]\s*[^\n\r]+/i,
  /sap_sessionid/i,
  /mysapsso2/i,
  /x-csrf-token\s*[:=]\s*[^\n\r]+/i,
  /sk-(?:proj-)?[a-z0-9_-]{20,}/i,
  /github_pat_[a-z0-9_]{20,}/i,
  /ghp_[a-z0-9]{20,}/i,
  /xox[baprs]-[a-z0-9-]{20,}/i,
  /akia[0-9a-z]{16}/i,
  /api[_-]?key\s*[:=]/i,
  /client[_-]?secret\s*[:=]/i,
  /access[_-]?key\s*[:=]/i,
  /secret\s*[:=]/i,
  /password\s*[:=]/i,
  /passwd\s*[:=]/i,
  /token\s*[:=]/i
];

const commandLikeEvidenceTextPatterns = [
  /\bSELECT\s+[\s\S]{0,300}\s+FROM\s+[\w/]+/i,
  /\bCALL\s+(FUNCTION|TRANSACTION)\b/i,
  /\bINSERT\s+[\w/]+\b|\bUPDATE\s+[\w/]+\b|\bMODIFY\s+[\w/]+\b|\bDELETE\s+FROM\s+[\w/]+\b/i
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeObjectName(value: unknown, label: string): string {
  const normalized = text(value).toUpperCase();
  if (!normalized || normalized.length > MAX_OBJECT_NAME_CHARS) {
    throw new Error(`${label} is required and must be ${MAX_OBJECT_NAME_CHARS} characters or less.`);
  }
  if (unsafeNamePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`${label} contains unsafe characters or command-like text.`);
  }
  const slashCount = normalized.split("/").length - 1;
  if (slashCount !== 0 && !(slashCount === 2 && normalized.startsWith("/"))) {
    throw new Error(`${label} must be a plain SAP name or a slash namespace name.`);
  }

  const namespaceMatch = normalized.match(/^\/[A-Z0-9_]{1,12}\/[A-Z0-9_][A-Z0-9_/$-]{0,39}$/);
  const normalMatch = normalized.match(/^[A-Z0-9_][A-Z0-9_/$-]{0,47}$/);
  if (!namespaceMatch && !normalMatch) {
    throw new Error(`${label} is not a supported SAP object identifier.`);
  }

  return normalized;
}

export function parseSapObjectEvidenceRequest(input: unknown): SapObjectEvidenceRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("SAP evidence request must be an object.");
  }
  const candidate = input as Partial<SapObjectEvidenceRequest>;
  const allowedKeys = new Set(["objectType", "objectName", "functionGroup"]);
  const extraKeys = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) {
    throw new Error("SAP evidence request contains unsupported fields.");
  }
  const objectType = text(candidate.objectType);
  if (!allowedTypes.has(objectType)) {
    throw new Error("SAP evidence object type is not supported.");
  }

  const request: SapObjectEvidenceRequest = {
    objectType: objectType as SapObjectEvidenceType,
    objectName: normalizeObjectName(candidate.objectName, "SAP object name")
  };

  if (request.objectType === "function" && text(candidate.functionGroup)) {
    request.functionGroup = normalizeObjectName(candidate.functionGroup, "Function group");
  }

  if (request.objectType !== "function" && text(candidate.functionGroup)) {
    throw new Error("Function group is only allowed for function evidence.");
  }

  return request;
}

function hasTableLikeRows(value: string): boolean {
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const structuredRows = lines.filter((line) => line.split(/\t|,|\|/).filter((cell) => cell.trim().length > 0).length >= 5);
  return structuredRows.length >= 6;
}

export function assertSafeSapObjectEvidenceText(value: string, options: { allowReadOnlySourceText?: boolean } = {}): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error("SAP evidence connector returned empty content.");
  }
  if (normalized.length > MAX_EVIDENCE_TEXT_CHARS) {
    throw new Error("SAP evidence content is larger than the current single-object limit.");
  }
  if (hardUnsafeEvidenceTextPatterns.some((pattern) => pattern.test(normalized)) || hasTableLikeRows(normalized)) {
    throw new Error("SAP evidence content did not pass the safety checks.");
  }
  if (options.allowReadOnlySourceText !== true && commandLikeEvidenceTextPatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error("SAP evidence content did not pass the safety checks.");
  }
  return normalized;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "object";
}

function timestampSlug(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").slice(0, 15) || "time";
}

function csvCell(value: string | number): string {
  const safe = String(value).replaceAll("\"", "\"\"");
  return `"${safe}"`;
}

function metadataLines(summary: SapObjectEvidenceSummary): string[] {
  return [
    `Object type: ${summary.objectType}`,
    `Object name: ${summary.objectName}`,
    `Function group: ${summary.functionGroup ?? "not applicable"}`,
    `System alias: ${summary.systemAlias}`,
    `Endpoint: ${summary.endpointHost}`,
    `Client: ${summary.client}`,
    `User: ${summary.usernameMasked}`,
    `Source mode: ${summary.sourceMode}`,
    `Read at: ${summary.readAt}`,
    `Content length: ${summary.contentLength}`,
    `Digest: ${summary.digest}`
  ];
}

export function normalizeSapObjectEvidenceResult(result: SapObjectEvidenceConnectorResult): SapObjectEvidenceRecord {
  const content = assertSafeSapObjectEvidenceText(result.content, {
    allowReadOnlySourceText: result.evidenceKind === "fixed-adt-readonly-source" && result.sourceMode === "adt"
  });
  const summary: SapObjectEvidenceSummary = {
    objectType: result.objectType,
    objectName: normalizeObjectName(result.objectName, "SAP object name"),
    functionGroup: result.functionGroup ? normalizeObjectName(result.functionGroup, "Function group") : null,
    systemAlias: result.system.alias,
    endpointHost: result.system.endpointHost,
    client: result.system.client,
    usernameMasked: result.system.usernameMasked,
    sourceMode: result.sourceMode,
    readAt: result.readAt,
    contentLength: content.length,
    digest: digest(content)
  };

  return { summary, content };
}

export function renderSapObjectEvidenceFiles(record: SapObjectEvidenceRecord): CaseGeneratedFile[] {
  const slug = `${record.summary.objectType}-${safeSlug(record.summary.objectName)}-${timestampSlug(record.summary.readAt)}-${record.summary.digest.slice(0, 12)}`;
  const evidencePath = `evidence/sap-object-evidence-${slug}.md`;
  const snapshotPath = `snapshots/sap-object-snapshot-${slug}.txt`;
  const summaryPath = `outputs/sap-object-evidence-summary-${slug}.md`;

  return [
    {
      relativePath: evidencePath,
      purpose: "evidence",
      content: [
        "# SAP Read-Only Object Evidence",
        "",
        ...metadataLines(record.summary).map((line) => `- ${line}`),
        "",
        "## Boundary",
        "",
        sapObjectEvidenceBoundary,
        "",
        "## Snapshot",
        "",
        `Full sanitized object evidence is stored in ${snapshotPath}.`
      ].join("\n")
    },
    {
      relativePath: snapshotPath,
      purpose: "snapshot",
      content: [
        "# SAP Read-Only Object Snapshot",
        "",
        ...metadataLines(record.summary),
        "",
        "-----BEGIN SAP READ-ONLY EVIDENCE-----",
        record.content,
        "-----END SAP READ-ONLY EVIDENCE-----",
        ""
      ].join("\n")
    },
    {
      relativePath: summaryPath,
      purpose: "output",
      content: [
        "# SAP Evidence Summary",
        "",
        `A read-only SAP evidence record was attached to the current case for ${record.summary.objectType} ${record.summary.objectName}.`,
        "",
        "| Field | Value |",
        "|---|---|",
        `| Object | ${record.summary.objectType} ${record.summary.objectName} |`,
        `| System | ${record.summary.systemAlias} / ${record.summary.client} |`,
        `| Source mode | ${record.summary.sourceMode} |`,
        `| Read at | ${record.summary.readAt} |`,
        `| Digest | ${record.summary.digest.slice(0, 16)} |`,
        "",
        "This summary is safe for search and case context. Detailed evidence remains in restricted case evidence files and is not sent to the model by default."
      ].join("\n")
    },
    {
      relativePath: `technical/sap-object-evidence-metadata-${slug}.csv`,
      purpose: "technical",
      content: [
        ["field", "value"].map(csvCell).join(","),
        ["objectType", record.summary.objectType].map(csvCell).join(","),
        ["objectName", record.summary.objectName].map(csvCell).join(","),
        ["functionGroup", record.summary.functionGroup ?? ""].map(csvCell).join(","),
        ["systemAlias", record.summary.systemAlias].map(csvCell).join(","),
        ["endpointHost", record.summary.endpointHost].map(csvCell).join(","),
        ["client", record.summary.client].map(csvCell).join(","),
        ["usernameMasked", record.summary.usernameMasked].map(csvCell).join(","),
        ["sourceMode", record.summary.sourceMode].map(csvCell).join(","),
        ["readAt", record.summary.readAt].map(csvCell).join(","),
        ["contentLength", record.summary.contentLength].map(csvCell).join(","),
        ["digest", record.summary.digest].map(csvCell).join(",")
      ].join("\n") + "\n"
    }
  ];
}
