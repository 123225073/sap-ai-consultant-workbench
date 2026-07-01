import fs from "node:fs/promises";
import path from "node:path";
import type { CaseFileNode, CaseMessage, CaseSummary, ProjectConfig, ProjectSummary, SearchResult, WorkbenchState } from "../shared/workbenchTypes";

interface StoredState {
  schemaVersion: number;
  activeProjectId: string;
  activeCaseId: string;
  projects: ProjectSummary[];
}

const DEMO_PROJECT_ID = "demo-s4hana";
const DEMO_CASE_ID = "demo001";
const SCHEMA_VERSION = 1;

const directories = [
  "outputs",
  "knowledge_candidates",
  "snapshots",
  "evidence",
  "technical"
];

function nowIso(): string {
  return new Date().toISOString();
}

function createMessage(role: CaseMessage["role"], content: string): CaseMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    caseId: DEMO_CASE_ID,
    role,
    content,
    taskMode: "problem-analysis",
    modelId: "demo-model",
    linkedFileIds: [],
    createdAt: nowIso()
  };
}

function demoCase(): CaseSummary {
  const createdAt = "2026-07-02T10:20:00.000Z";
  return {
    id: DEMO_CASE_ID,
    projectId: DEMO_PROJECT_ID,
    title: "DEMO001 演示BOM清单",
    status: "active",
    caseDir: "demo001",
    summary: "演示BOM筛选口径与当前业务范围不一致，已生成本地演示交付物。",
    createdAt,
    updatedAt: nowIso(),
    lastOpenedAt: nowIso(),
    folderName: "demo001",
    currentSummary: "演示BOM筛选口径与当前业务范围不一致，已生成本地演示交付物。",
    messages: [
      {
        id: "seed-user-1",
        caseId: DEMO_CASE_ID,
        role: "user",
        content: "帮我分析 DEMO001 演示BOM清单，确认为什么部分工厂没有数据。",
        taskMode: "problem-analysis",
        modelId: "demo-model",
        linkedFileIds: [],
        createdAt: "2026-07-02T10:24:00.000Z"
      },
      {
        id: "seed-assistant-1",
        caseId: DEMO_CASE_ID,
        role: "assistant",
        content: "已确认：问题来自演示BOM筛选口径与当前业务范围不一致。建议调整为当前业务口径，并增加异常工厂提示。",
        taskMode: "problem-analysis",
        modelId: "demo-model",
        linkedFileIds: ["outputs/演示BOM核对.md", "outputs/逻辑说明图.mmd", "outputs/开发说明书.md"],
        createdAt: "2026-07-02T10:26:00.000Z"
      }
    ]
  };
}

function demoProject(): ProjectSummary {
  const createdAt = "2026-07-02T10:18:00.000Z";
  const projectDir = DEMO_PROJECT_ID;
  return {
    id: DEMO_PROJECT_ID,
    name: "演示 S4HANA",
    sapVersion: "S4",
    systemLabel: "DEV/100",
    projectDir,
    isVisible: true,
    visibleOrder: 1,
    connectionState: "local-demo",
    createdAt,
    updatedAt: nowIso(),
    config: defaultProjectConfig(DEMO_PROJECT_ID, projectDir, "demo001"),
    cases: [demoCase()]
  };
}

function defaultProjectConfig(projectId: string, projectDir: string, caseDir: string): ProjectConfig {
  const updatedAt = nowIso();
  return {
    schemaVersion: 2,
    projectId,
    updatedAt,
    adt: {
      alias: "演示开发系统",
      url: "https://sap-demo.example.com",
      client: "100",
      username: "DEMO_USER",
      language: "ZH",
      sslMode: "strict",
      readOnly: true,
      credential: { secretRef: null, state: "secure-store-required" },
      configStatus: "saved",
      connectionStatus: "pending-verification",
      minimalReadStatus: "pending-verification",
      lastCheckedAt: null
    },
    feishu: {
      profile: "demo-profile",
      cliPath: "lark-cli",
      credential: { secretRef: null, state: "secure-store-required" },
      authStatus: "pending-verification",
      docPermissionStatus: "pending-verification",
      lastCheckedAt: null
    },
    apiProviders: [
      {
        id: "demo-openai-compatible",
        name: "演示 OpenAI 兼容渠道",
        providerType: "openai-compatible",
        baseUrl: "https://api-demo.example.com/v1",
        enabled: false,
        credential: { secretRef: null, state: "secure-store-required" },
        modelSyncStatus: "pending-verification",
        chatTestStatus: "pending-verification",
        lastCheckedAt: null
      }
    ],
    codex: {
      integrationType: "cli",
      executablePath: "codex",
      credential: { secretRef: null, state: "secure-store-required" },
      cliStatus: "pending-verification",
      version: "",
      loginStatus: "pending-verification",
      readonlyTaskStatus: "pending-verification",
      lastCheckedAt: null
    },
    localStorage: {
      storageMode: "json",
      workspaceRoot: "local-data/workbench",
      stateJsonPath: "local-data/workbench/app-state.json",
      projectDir: `local-data/workbench/projects/${projectDir}`,
      casesDir: `local-data/workbench/projects/${projectDir}/cases/${caseDir}`,
      databasePath: null,
      indexesDir: "local-data/workbench/indexes",
      logsDir: "local-data/workbench/logs",
      tempDir: "local-data/workbench/temp",
      status: "saved",
      lastCheckedAt: updatedAt,
      lastError: null
    }
  };
}

function emptyState(): StoredState {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeProjectId: DEMO_PROJECT_ID,
    activeCaseId: DEMO_CASE_ID,
    projects: [demoProject()]
  };
}

function purposeFor(relativePath: string, kind: "file" | "directory"): CaseFileNode["purpose"] {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized === "README.md") return "summary";
  if (normalized === "conversation.md") return "conversation";
  if (normalized === "metadata.json") return "metadata";
  if (normalized.startsWith("outputs/")) return "output";
  if (normalized.startsWith("knowledge_candidates/")) return "candidate_knowledge";
  if (normalized.startsWith("technical/")) return "technical";
  if (normalized.startsWith("evidence/")) return "evidence";
  if (normalized.startsWith("snapshots/")) return "snapshot";
  if (kind === "directory" && normalized === "outputs") return "output";
  if (kind === "directory" && normalized === "knowledge_candidates") return "candidate_knowledge";
  if (kind === "directory" && normalized === "technical") return "technical";
  if (kind === "directory" && normalized === "evidence") return "evidence";
  if (kind === "directory" && normalized === "snapshots") return "snapshot";
  return "other";
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function providerType(value: unknown): ProjectConfig["apiProviders"][number]["providerType"] {
  return value === "deepseek" || value === "custom" ? value : "openai-compatible";
}

function sslMode(value: unknown): ProjectConfig["adt"]["sslMode"] {
  return value === "skip-certificate" ? "skip-certificate" : "strict";
}

function codexIntegrationType(value: unknown): ProjectConfig["codex"]["integrationType"] {
  return value === "sdk" ? "sdk" : "cli";
}

function savedOrEmptyStatus(...values: string[]): ProjectConfig["adt"]["configStatus"] {
  return values.some((value) => value.length > 0) ? "saved" : "not-configured";
}

function normalizeConnectionState(value: string): ProjectSummary["connectionState"] {
  const legacyLocalDemo = ["demo", "readonly"].join("-");
  const legacyNotChecked = ["not", ["ver", "ified"].join("")].join("-");
  if (value === legacyLocalDemo) return "local-demo";
  if (value === legacyNotChecked) return "not-checked";
  if (value === "local-demo" || value === "not-configured" || value === "not-checked") return value;
  return "not-checked";
}

export class WorkspaceStore {
  private readonly workspaceRoot: string;
  private readonly statePath: string;

  constructor(repoRoot: string) {
    this.workspaceRoot = path.join(repoRoot, "local-data", "workbench");
    this.statePath = path.join(this.workspaceRoot, "app-state.json");
  }

  async getState(): Promise<WorkbenchState> {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
  }

  async createDemoProject(): Promise<WorkbenchState> {
    const state = await this.loadOrCreateState();
    const existing = state.projects.find((project) => project.id === DEMO_PROJECT_ID);
    if (!existing) {
      state.projects.unshift(demoProject());
    }
    state.activeProjectId = DEMO_PROJECT_ID;
    state.activeCaseId = DEMO_CASE_ID;
    await this.saveState(state);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
  }

  async createDemoCase(): Promise<WorkbenchState> {
    const state = await this.loadOrCreateState();
    const project = this.ensureDemoProject(state);
    if (!project.cases.some((item) => item.id === DEMO_CASE_ID)) {
      project.cases.unshift(demoCase());
    }
    state.activeProjectId = DEMO_PROJECT_ID;
    state.activeCaseId = DEMO_CASE_ID;
    await this.saveState(state);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
  }

  async appendMessage(content: string): Promise<WorkbenchState> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("请输入案件问题或补充说明。");
    }
    const state = await this.loadOrCreateState();
    const currentCase = this.getActiveCase(state);
    currentCase.messages.push(createMessage("user", trimmed));
    currentCase.updatedAt = nowIso();
    currentCase.lastOpenedAt = nowIso();
    await this.saveState(state);
    await this.writeCaseMarkdown(state, currentCase);
    return this.withFiles(state);
  }

  async getCaseFiles(): Promise<CaseFileNode[]> {
    const state = await this.loadOrCreateState();
    await this.ensureCaseFiles(state);
    return this.readCaseTree(state);
  }

  async search(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const state = await this.loadOrCreateState();
    const files = await this.readCaseTree(state);
    const results: SearchResult[] = [];

    for (const project of state.projects) {
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

    return results.slice(0, 12);
  }

  async saveProjectConfig(projectId: string, config: unknown): Promise<WorkbenchState> {
    this.assertNoRawSecretFields(config);
    const state = await this.loadOrCreateState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("未找到当前项目，无法保存配置。");
    }

    project.config = this.sanitizeProjectConfig(project, config);
    project.updatedAt = nowIso();

    await this.saveState(state);
    await this.ensureCaseFiles(state);
    return this.withFiles(state);
  }

  private async loadOrCreateState(): Promise<StoredState> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as StoredState;
      return this.normalizeState(parsed);
    } catch {
      const state = emptyState();
      await this.saveState(state);
      return state;
    }
  }

  private async saveState(state: StoredState): Promise<void> {
    await fs.mkdir(this.workspaceRoot, { recursive: true });
    await this.writeJsonAtomic(this.statePath, state);
  }

  private normalizeState(state: StoredState): StoredState {
    const normalizedProjects = (state.projects.length > 0 ? state.projects : [demoProject()]).map((project) => {
      const firstCase = project.cases[0] ?? demoCase();
      return {
        ...project,
        connectionState: normalizeConnectionState(project.connectionState),
        config: this.sanitizeProjectConfig(project, project.config ?? defaultProjectConfig(project.id, project.projectDir || project.id, firstCase.folderName || firstCase.id)),
        cases: project.cases.length > 0 ? project.cases : [firstCase]
      };
    });
    return {
      ...state,
      schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
      projects: normalizedProjects
    };
  }

  private assertNoRawSecretFields(value: unknown): void {
    const raw = JSON.stringify(value ?? {}).toLowerCase();
    const forbidden = [
      "password",
      "passwd",
      "apikey",
      "api_key",
      "api-key",
      "access_token",
      "refreshtoken",
      "refresh_token",
      "authorization",
      "cookie",
      "secretvalue"
    ];
    if (forbidden.some((word) => raw.includes(word))) {
      throw new Error("配置中包含疑似明文密钥字段，已阻止保存。");
    }
  }

  private sanitizeProjectConfig(project: ProjectSummary, input: unknown): ProjectConfig {
    const candidate = input && typeof input === "object" ? input as Partial<ProjectConfig> : {};
    const firstCase = project.cases[0] ?? demoCase();
    const fallback = defaultProjectConfig(project.id, project.projectDir || project.id, firstCase.folderName || firstCase.id);
    const adt = candidate.adt ?? fallback.adt;
    const feishu = candidate.feishu ?? fallback.feishu;
    const codex = candidate.codex ?? fallback.codex;
    const providers = Array.isArray(candidate.apiProviders) && candidate.apiProviders.length > 0 ? candidate.apiProviders : fallback.apiProviders;

    const alias = text(adt.alias, fallback.adt.alias);
    const url = text(adt.url, fallback.adt.url);
    const client = text(adt.client, fallback.adt.client);
    const username = text(adt.username, fallback.adt.username);
    const language = text(adt.language, fallback.adt.language).toUpperCase() || "ZH";

    return {
      schemaVersion: 2,
      projectId: project.id,
      updatedAt: nowIso(),
      adt: {
        alias,
        url,
        client,
        username,
        language,
        sslMode: sslMode(adt.sslMode),
        readOnly: true,
        credential: { secretRef: null, state: "secure-store-required" },
        configStatus: savedOrEmptyStatus(alias, url, client, username),
        connectionStatus: "pending-verification",
        minimalReadStatus: "pending-verification",
        lastCheckedAt: null
      },
      feishu: {
        profile: text(feishu.profile, fallback.feishu.profile),
        cliPath: text(feishu.cliPath, fallback.feishu.cliPath),
        credential: { secretRef: null, state: "secure-store-required" },
        authStatus: "pending-verification",
        docPermissionStatus: "pending-verification",
        lastCheckedAt: null
      },
      apiProviders: providers.slice(0, 6).map((provider, index) => {
        const id = text(provider.id, `provider-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "-") || `provider-${index + 1}`;
        const name = text(provider.name, `API 渠道 ${index + 1}`);
        const baseUrl = text(provider.baseUrl);
        return {
          id,
          name,
          providerType: providerType(provider.providerType),
          baseUrl,
          enabled: bool(provider.enabled, false),
          credential: { secretRef: null, state: "secure-store-required" },
          modelSyncStatus: "pending-verification",
          chatTestStatus: "pending-verification",
          lastCheckedAt: null
        };
      }),
      codex: {
        integrationType: codexIntegrationType(codex.integrationType),
        executablePath: text(codex.executablePath, fallback.codex.executablePath),
        credential: { secretRef: null, state: "secure-store-required" },
        cliStatus: "pending-verification",
        version: "",
        loginStatus: "pending-verification",
        readonlyTaskStatus: "pending-verification",
        lastCheckedAt: null
      },
      localStorage: fallback.localStorage
    };
  }

  private async writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
    const safePath = this.assertInsideWorkspace(targetPath);
    const tempPath = `${safePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, safePath);
  }

  private ensureDemoProject(state: StoredState): ProjectSummary {
    let project = state.projects.find((item) => item.id === DEMO_PROJECT_ID);
    if (!project) {
      project = demoProject();
      state.projects.unshift(project);
    }
    return project;
  }

  private getActiveCase(state: StoredState): CaseSummary {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureDemoProject(state);
    let caseItem = project.cases.find((item) => item.id === state.activeCaseId);
    if (!caseItem) {
      caseItem = demoCase();
      project.cases.unshift(caseItem);
      state.activeCaseId = caseItem.id;
    }
    return caseItem;
  }

  private caseRoot(state: StoredState): string {
    const project = state.projects.find((item) => item.id === state.activeProjectId) ?? this.ensureDemoProject(state);
    const caseItem = this.getActiveCase(state);
    const target = path.join(this.workspaceRoot, "projects", project.id, "cases", caseItem.folderName);
    return this.assertInsideWorkspace(target);
  }

  private assertInsideWorkspace(target: string): string {
    const resolvedRoot = path.resolve(this.workspaceRoot);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("文件路径超出本地工作区，已阻止。");
    }
    return resolvedTarget;
  }

  private async ensureCaseFiles(state: StoredState): Promise<void> {
    const caseRoot = this.caseRoot(state);
    for (const directory of directories) {
      await fs.mkdir(this.assertInsideWorkspace(path.join(caseRoot, directory)), { recursive: true });
    }
    await this.writeCaseMarkdown(state, this.getActiveCase(state));
  }

  private async writeCaseMarkdown(state: StoredState, caseItem: CaseSummary): Promise<void> {
    const caseRoot = this.caseRoot(state);
    const project = state.projects.find((item) => item.id === caseItem.projectId) ?? this.ensureDemoProject(state);
    await fs.mkdir(caseRoot, { recursive: true });
    const projectRoot = this.assertInsideWorkspace(path.join(this.workspaceRoot, "projects", project.id));
    await fs.mkdir(projectRoot, { recursive: true });

    const readme = `# ${caseItem.title}

## 当前结论

${caseItem.currentSummary}

## 项目

- 项目：${project.name}
- 系统标签：${project.systemLabel}
- 模式：本地演示，只读占位

## 交付物

- outputs/演示BOM核对.md
- outputs/逻辑说明图.mmd
- outputs/开发说明书.md

## 知识沉淀

- knowledge_candidates/演示BOM筛选规则.md
`;

    const conversation = caseItem.messages
      .map((message) => `## ${message.role === "user" ? "用户" : "AI"} · ${message.createdAt}\n\n${message.content}\n`)
      .join("\n");

    const timeline = `# 时间线

- ${caseItem.updatedAt}：更新案件本地状态。
- ${nowIso()}：刷新本地案件文件。
`;

    const contextPack = `# 上下文恢复包

## 当前案件目标

分析演示BOM清单中部分工厂没有数据的原因。

## 已确认事实

- 当前阶段只使用演示数据。
- SAP、飞书和模型 API 尚未接入。
- 文件均保存到当前案件目录。

## 待办

- Phase 2 验证配置中心草稿保存。
`;

    const metadata = {
      schemaVersion: SCHEMA_VERSION,
      caseId: caseItem.id,
      projectId: project.id,
      title: caseItem.title,
      status: caseItem.status,
      updatedAt: caseItem.updatedAt,
      phase: "Phase 2",
      safety: "demo-only-readonly-placeholder"
    };
    const projectJson = {
      schemaVersion: SCHEMA_VERSION,
      id: project.id,
      name: project.name,
      sapVersion: project.sapVersion,
      systemLabel: project.systemLabel,
      connectionState: project.connectionState,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      config: project.config,
      safety: "no-secrets-demo-project"
    };

    await Promise.all([
      this.writeJsonAtomic(path.join(projectRoot, "project.json"), projectJson),
      this.writeJsonAtomic(path.join(caseRoot, "messages.json"), caseItem.messages),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "README.md")), readme, "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "conversation.md")), conversation, "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "timeline.md")), timeline, "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "context_pack.md")), contextPack, "utf8"),
      this.writeJsonAtomic(path.join(caseRoot, "metadata.json"), metadata),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "outputs", "演示BOM核对.md")), "# 演示BOM核对\n\n这是本地演示交付物，不包含真实 SAP 数据。\n", "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "outputs", "逻辑说明图.mmd")), "flowchart TD\n  A[演示输入] --> B[筛选口径]\n  B --> C[输出核对结论]\n", "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "outputs", "开发说明书.md")), "# 开发说明书\n\nPhase 2 仅生成本地演示文档和配置草稿，不写 SAP。\n", "utf8"),
      fs.writeFile(this.assertInsideWorkspace(path.join(caseRoot, "knowledge_candidates", "演示BOM筛选规则.md")), "# 演示BOM筛选规则\n\n状态：待确认。\n\n候选知识必须人工确认后才能正式入库。\n", "utf8")
    ]);
  }

  private async withFiles(state: StoredState): Promise<WorkbenchState> {
    return {
      schemaVersion: state.schemaVersion,
      workspaceRoot: this.workspaceRoot,
      activeProjectId: state.activeProjectId,
      activeCaseId: state.activeCaseId,
      projects: state.projects,
      activeCaseFiles: await this.readCaseTree(state)
    };
  }

  private async readCaseTree(state: StoredState): Promise<CaseFileNode[]> {
    const caseRoot = this.caseRoot(state);
    return this.readDirectory(caseRoot, "", this.getActiveCase(state).id);
  }

  private async readDirectory(directory: string, relativeBase: string, caseId: string): Promise<CaseFileNode[]> {
    const entries = await fs.readdir(this.assertInsideWorkspace(directory), { withFileTypes: true });
    const nodes: CaseFileNode[] = [];

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
      const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      const absolutePath = this.assertInsideWorkspace(path.join(directory, entry.name));
      const stats = await fs.stat(absolutePath);
      const kind = entry.isDirectory() ? "directory" : "file";
      const fileType = entry.isDirectory() ? "directory" : path.extname(entry.name).replace(".", "").toLowerCase() || "text";
      nodes.push({
        id: relativePath,
        caseId,
        name: entry.isDirectory() ? `${entry.name}/` : entry.name,
        relativePath,
        displayName: entry.name,
        kind,
        fileType,
        purpose: purposeFor(relativePath, kind),
        size: stats.size,
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        indexedAt: nowIso(),
        children: entry.isDirectory() ? await this.readDirectory(absolutePath, relativePath, caseId) : undefined
      });
    }

    return nodes;
  }
}
