export type CaseStatus = "active" | "solved" | "archived";

export interface CaseMessage {
  id: string;
  caseId: string;
  role: "user" | "assistant";
  content: string;
  taskMode: "problem-analysis" | "abap-development" | "document-generation" | "flow-diagram";
  modelId: string;
  linkedFileIds: string[];
  createdAt: string;
}

export interface CaseSummary {
  id: string;
  projectId: string;
  title: string;
  status: CaseStatus;
  caseDir: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  folderName: string;
  currentSummary: string;
  messages: CaseMessage[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  sapVersion: "S4" | "ECC" | "UNKNOWN";
  systemLabel: string;
  projectDir: string;
  isVisible: boolean;
  visibleOrder: number;
  connectionState: "demo-readonly" | "not-configured" | "not-verified";
  createdAt: string;
  updatedAt: string;
  cases: CaseSummary[];
}

export interface CaseFileNode {
  id: string;
  caseId: string;
  name: string;
  relativePath: string;
  displayName: string;
  kind: "file" | "directory";
  fileType: string;
  purpose: "summary" | "conversation" | "output" | "candidate_knowledge" | "technical" | "evidence" | "snapshot" | "metadata" | "other";
  size: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  indexedAt: string;
  children?: CaseFileNode[];
}

export interface SearchResult {
  id: string;
  title: string;
  type: "project" | "case" | "file";
  location: string;
  snippet: string;
}

export interface WorkbenchState {
  schemaVersion: number;
  workspaceRoot: string;
  activeProjectId: string;
  activeCaseId: string;
  projects: ProjectSummary[];
  activeCaseFiles: CaseFileNode[];
}

export interface WorkbenchResult<T> {
  ok: true;
  data: T;
}

export interface WorkbenchError {
  ok: false;
  error: string;
}

export type WorkbenchResponse<T> = WorkbenchResult<T> | WorkbenchError;
