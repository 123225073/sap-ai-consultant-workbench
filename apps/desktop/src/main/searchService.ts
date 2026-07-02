import type { CaseFileNode, KnowledgeItemStatus, KnowledgeItemType, KnowledgeSourceType, ProjectSummary, SearchResult } from "../shared/workbenchTypes";
import type { DatabaseService, SearchDocumentRecord } from "./databaseService";

const SEARCH_RESULT_LIMIT = 12;

const knowledgeStatusLabels: Record<KnowledgeItemStatus, string> = {
  draft: "草稿",
  pending: "待确认",
  published: "已发布",
  conflicted: "有冲突",
  expired: "已失效"
};

const knowledgeTypeLabels: Record<KnowledgeItemType, string> = {
  qa: "QA 问答",
  doc: "文档知识",
  sap_object: "SAP 对象说明",
  case_note: "案件经验",
  timeline_fact: "时间线事实"
};

const knowledgeSourceLabels: Record<KnowledgeSourceType, string> = {
  "case-candidate": "案件候选",
  "document-import": "文档导入",
  "qa-import": "QA 导入",
  manual: "人工维护"
};

export interface SafeOutputSummaryRecord {
  projectId: string;
  caseId: string;
  projectName: string;
  caseTitle: string;
  relativePath: string;
  displayName: string;
  fileType: string;
  sizeBytes: number;
  snippet: string;
  content: string;
  updatedAt: string;
}

export function buildSearchDocuments(projects: ProjectSummary[], files: CaseFileNode[], safeOutputSummaries: SafeOutputSummaryRecord[] = []): SearchDocumentRecord[] {
  const updatedAt = new Date().toISOString();
  const records: SearchDocumentRecord[] = [];
  for (const project of projects) {
    records.push({
      id: `project-${project.id}`,
      type: "project",
      projectId: project.id,
      caseId: null,
      title: project.name,
      location: project.systemLabel,
      snippet: "来自本地项目列表",
      sourcePath: null,
      status: project.connectionState,
      content: [project.name, project.sapVersion, project.systemLabel, project.connectionState].join(" "),
      updatedAt: project.updatedAt
    });

      for (const caseItem of project.cases) {
        records.push({
          id: `case-${project.id}-${caseItem.id}`,
        type: "case",
        projectId: project.id,
        caseId: caseItem.id,
        title: caseItem.title,
        location: project.name,
        snippet: caseItem.currentSummary,
        sourcePath: caseItem.folderName,
        status: caseItem.status,
        content: [caseItem.title, caseItem.currentSummary, caseItem.summary].join(" "),
        updatedAt: caseItem.updatedAt
      });
    }

    for (const item of project.knowledge.items) {
      const statusLabel = knowledgeStatusLabels[item.status];
      const typeLabel = knowledgeTypeLabels[item.type];
      const sourceLabel = knowledgeSourceLabels[item.sourceType];
      const sourceParts = [
        project.name,
        statusLabel,
        sourceLabel,
        item.sourceCaseId ? `案件 ${item.sourceCaseId}` : "",
        item.sourceFilePath ? `来源文件 ${item.sourceFilePath}` : ""
      ].filter(Boolean);
        records.push({
          id: `knowledge-${project.id}-${item.id}`,
        type: "knowledge",
        projectId: project.id,
        caseId: item.sourceCaseId,
        title: item.title,
        location: sourceParts.join(" · "),
        snippet: item.summary,
        sourcePath: item.sourceFilePath,
        status: statusLabel,
        content: [
          item.title,
          item.summary,
          statusLabel,
          typeLabel,
          sourceLabel,
          item.sourceFilePath ?? "",
          ...item.sapObjects
        ].join(" "),
        updatedAt: item.updatedAt
      });
    }
  }

  flattenFiles(files, records, updatedAt);
  appendSafeOutputSummaries(records, safeOutputSummaries);
  return records;
}

export async function searchWorkbench(
  database: DatabaseService | null,
  projects: ProjectSummary[],
  files: CaseFileNode[],
  safeOutputSummaries: SafeOutputSummaryRecord[],
  query: string
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const health = database?.getHealth();
  if (database && health?.ok && health.fts5Available) {
    try {
      const sqliteResults = database.search(trimmed, SEARCH_RESULT_LIMIT);
      const fallbackResults = fallbackSearch(projects, files, safeOutputSummaries, trimmed);
      return mergeResults(fallbackResults, sqliteResults);
    } catch {
      return fallbackSearch(projects, files, safeOutputSummaries, trimmed);
    }
  }
  return fallbackSearch(projects, files, safeOutputSummaries, trimmed);
}

function mergeResults(primary: SearchResult[], fallback: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const item of [...primary, ...fallback]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    results.push(item);
    if (results.length >= SEARCH_RESULT_LIMIT) break;
  }
  return results;
}

export function fallbackSearch(projects: ProjectSummary[], files: CaseFileNode[], safeOutputSummaries: SafeOutputSummaryRecord[], query: string): SearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const results: SearchResult[] = [];

  for (const project of projects) {
    if (project.name.toLowerCase().includes(trimmed) || project.systemLabel.toLowerCase().includes(trimmed)) {
        results.push({
          id: `project-${project.id}`,
          title: project.name,
          type: "project",
          location: project.systemLabel,
          snippet: "来自本地项目列表",
          projectId: project.id,
          caseId: null,
          sourcePath: null
        });
    }

    for (const caseItem of project.cases) {
      if (caseItem.title.toLowerCase().includes(trimmed) || caseItem.currentSummary.toLowerCase().includes(trimmed)) {
        results.push({
          id: `case-${project.id}-${caseItem.id}`,
          title: caseItem.title,
          type: "case",
          location: project.name,
          snippet: caseItem.currentSummary,
          projectId: project.id,
          caseId: caseItem.id,
          sourcePath: caseItem.folderName
        });
      }
    }

    for (const item of project.knowledge.items) {
      const statusLabel = knowledgeStatusLabels[item.status];
      const typeLabel = knowledgeTypeLabels[item.type];
      const sourceLabel = knowledgeSourceLabels[item.sourceType];
      const sourceParts = [
        project.name,
        statusLabel,
        sourceLabel,
        item.sourceCaseId ? `案件 ${item.sourceCaseId}` : "",
        item.sourceFilePath ? `来源文件 ${item.sourceFilePath}` : ""
      ].filter(Boolean);
      const searchable = [
        item.title,
        item.summary,
        item.content,
        item.status,
        statusLabel,
        item.type,
        typeLabel,
        sourceLabel,
        item.sourceFilePath ?? "",
        ...item.sapObjects
      ].join(" ").toLowerCase();
      if (searchable.includes(trimmed)) {
        results.push({
          id: `knowledge-${project.id}-${item.id}`,
          title: item.title,
          type: "knowledge",
          location: sourceParts.join(" · "),
          snippet: item.summary,
          projectId: project.id,
          caseId: item.sourceCaseId,
          sourcePath: item.sourceFilePath
        });
      }
    }
  }

  const flatten = (nodes: CaseFileNode[]) => {
    for (const node of nodes) {
      if (isUnsafeFileSearchPath(node.relativePath)) continue;
      if (node.name.toLowerCase().includes(trimmed) || node.relativePath.toLowerCase().includes(trimmed)) {
        results.push({
          id: `file-${node.relativePath}`,
          title: node.name,
          type: "file",
          location: node.relativePath,
          snippet: `当前案件文件：${node.purpose}`,
          caseId: node.caseId,
          sourcePath: node.relativePath
        });
      }
      if (node.children) flatten(node.children);
    }
  };
  flatten(files);

  for (const summary of safeOutputSummaries) {
    const searchable = [
      summary.displayName,
      summary.relativePath,
      summary.fileType,
      summary.snippet,
      summary.content
    ].join(" ").toLowerCase();
    if (searchable.includes(trimmed)) {
      results.push({
        id: `file-summary-${summary.projectId}-${summary.caseId}-${summary.relativePath}`,
        title: summary.displayName,
        type: "file",
        location: `${summary.projectName} · ${summary.caseTitle} · ${summary.relativePath} · 安全输出摘要`,
        snippet: `安全输出摘要：${summary.snippet}`,
        projectId: summary.projectId,
        caseId: summary.caseId,
        sourcePath: summary.relativePath
      });
    }
  }

  return results.slice(0, SEARCH_RESULT_LIMIT);
}

function appendSafeOutputSummaries(records: SearchDocumentRecord[], safeOutputSummaries: SafeOutputSummaryRecord[]): void {
  for (const summary of safeOutputSummaries) {
    records.push({
      id: `file-summary-${summary.projectId}-${summary.caseId}-${summary.relativePath}`,
      type: "file",
      projectId: summary.projectId,
      caseId: summary.caseId,
      title: summary.displayName,
      location: `${summary.projectName} · ${summary.caseTitle} · ${summary.relativePath} · 安全输出摘要`,
      snippet: `安全输出摘要：${summary.snippet}`,
      sourcePath: summary.relativePath,
      status: "safe-output-summary",
      content: summary.content,
      updatedAt: summary.updatedAt
    });
  }
}

function flattenFiles(nodes: CaseFileNode[], records: SearchDocumentRecord[], updatedAt: string): void {
  for (const node of nodes) {
    if (isUnsafeFileSearchPath(node.relativePath)) continue;
    if (node.kind === "file") {
      records.push({
        id: `file-${node.relativePath}`,
        type: "file",
        projectId: "active-project",
        caseId: node.caseId,
        title: node.name,
        location: node.relativePath,
        snippet: `当前案件文件：${node.purpose}`,
        sourcePath: node.relativePath,
        status: node.purpose,
        content: [node.name, node.relativePath, node.purpose].join(" "),
        updatedAt
      });
    }
    if (node.children) flattenFiles(node.children, records, updatedAt);
  }
}

function isUnsafeFileSearchPath(relativePath: string): boolean {
  const parts = relativePath.split("/").map((part) => part.toLowerCase()).filter(Boolean);
  const basename = parts.at(-1) ?? "";
  const extension = basename.includes(".") ? `.${basename.split(".").pop()}` : "";
  if (parts.some((part) => part === "technical" || part === "evidence" || part === "snapshots")) return true;
  if (parts.some((part) => part === ".sap-adt-cli" || part === ".sap-abap-cli" || part.includes("secure-store"))) return true;
  if (extension === ".json") return true;
  if (basename === "metadata.json" || basename === "messages.json" || basename === "project.json" || basename === "app-state.json") return true;
  return basename.includes("credential") || basename.includes("secret");
}
