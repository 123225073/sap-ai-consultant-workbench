/// <reference types="vite/client" />

import type { CaseFileNode, ProjectConfig, ProjectSecretInput, SearchResult, WorkbenchResponse, WorkbenchState } from "../shared/workbenchTypes";

interface WorkbenchBridge {
  getAppInfo: () => {
    name: string;
    edition: string;
    phase: string;
  };
  getState: () => Promise<WorkbenchResponse<WorkbenchState>>;
  createDemoProject: () => Promise<WorkbenchResponse<WorkbenchState>>;
  createDemoCase: () => Promise<WorkbenchResponse<WorkbenchState>>;
  appendMessage: (content: string) => Promise<WorkbenchResponse<WorkbenchState>>;
  getCaseFiles: () => Promise<WorkbenchResponse<CaseFileNode[]>>;
  search: (query: string) => Promise<WorkbenchResponse<SearchResult[]>>;
  saveProjectConfig: (projectId: string, config: ProjectConfig) => Promise<WorkbenchResponse<WorkbenchState>>;
  saveProjectSecret: (projectId: string, input: ProjectSecretInput) => Promise<WorkbenchResponse<WorkbenchState>>;
}

declare global {
  interface Window {
    workbench?: WorkbenchBridge;
  }
}
