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

export function buildSearchDocuments(projects: ProjectSummary[], files: CaseFileNode[]): SearchDocumentRecord[] {
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
        id: `case-${caseItem.id}`,
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
        id: `knowledge-${item.id}`,
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
  return records;
}

export async function searchWorkbench(
  database: DatabaseService | null,
  projects: ProjectSummary[],
  files: CaseFileNode[],
  query: string
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const health = database?.getHealth();
  if (database && health?.ok && health.fts5Available) {
    try {
      const sqliteResults = database.search(trimmed, SEARCH_RESULT_LIMIT);
      const fallbackResults = fallbackSearch(projects, files, trimmed);
      return mergeResults(fallbackResults, sqliteResults);
    } catch {
      return fallbackSearch(projects, files, trimmed);
    }
  }
  return fallbackSearch(projects, files, trimmed);
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

export function fallbackSearch(projects: ProjectSummary[], files: CaseFileNode[], query: string): SearchResult[] {
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
        snippet: "来自本地项目列表"
      });
    }

    for (const caseItem of project.cases) {
      if (caseItem.title.toLowerCase().includes(trimmed) || caseItem.currentSummary.toLowerCase().includes(trimmed)) {
        results.push({
          id: `case-${caseItem.id}`,
          title: caseItem.title,
          type: "case",
          location: project.name,
          snippet: caseItem.currentSummary
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
          id: `knowledge-${item.id}`,
          title: item.title,
          type: "knowledge",
          location: sourceParts.join(" · "),
          snippet: item.summary
        });
      }
    }
  }

  const flatten = (nodes: CaseFileNode[]) => {
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(trimmed) || node.relativePath.toLowerCase().includes(trimmed)) {
        results.push({
          id: `file-${node.relativePath}`,
          title: node.name,
          type: "file",
          location: node.relativePath,
          snippet: `当前案件文件：${node.purpose}`
        });
      }
      if (node.children) flatten(node.children);
    }
  };
  flatten(files);

  return results.slice(0, SEARCH_RESULT_LIMIT);
}

function flattenFiles(nodes: CaseFileNode[], records: SearchDocumentRecord[], updatedAt: string): void {
  for (const node of nodes) {
    records.push({
      id: `file-${node.relativePath}`,
      type: "file",
      projectId: "active-project",
      caseId: null,
      title: node.name,
      location: node.relativePath,
      snippet: `当前案件文件：${node.purpose}`,
      sourcePath: node.relativePath,
      status: node.purpose,
      content: [node.name, node.relativePath, node.purpose].join(" "),
      updatedAt
    });
    if (node.children) flattenFiles(node.children, records, updatedAt);
  }
}
