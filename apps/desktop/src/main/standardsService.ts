import type {
  CopyProjectStandardsInput,
  CopyProjectStandardsFromProjectInput,
  ProjectStandardsProfile,
  ProjectStandardsView,
  ProjectSummary,
  SaveProjectStandardsInput,
  StandardsCategory,
  StandardsCategoryId,
  StandardsCategoryInput,
  StandardsDiffItem,
  StandardsTemplateId,
  StandardsTemplateSummary
} from "../shared/workbenchTypes";

const MAX_CATEGORY_CONTENT_LENGTH = 12000;

const categoryMeta: Record<StandardsCategoryId, { title: string; description: string }> = {
  abap: {
    title: "ABAP 开发规范",
    description: "命名、模块划分、错误处理、只读边界和输出要求。"
  },
  comments: {
    title: "注释规范",
    description: "关键逻辑、变更点、业务口径和边界说明的注释方式。"
  },
  request: {
    title: "请求号描述",
    description: "开发请求、变更说明和上线确认的文字模板。"
  },
  alv: {
    title: "ALV 报表规范",
    description: "字段、筛选条件、异常提示和导出结果要求。"
  },
  interface: {
    title: "接口开发规范",
    description: "入参、出参、错误码、重试和日志边界。"
  },
  document: {
    title: "文档模板",
    description: "开发说明书、技术说明和飞书文档结构。"
  },
  diagram: {
    title: "流程图规范",
    description: "Mermaid、逻辑图和飞书白板素材的表达约束。"
  },
  excel: {
    title: "Excel 导出模板",
    description: "核对表、异常清单和字段说明的导出要求。"
  }
};

type TemplateDefinition = StandardsTemplateSummary & {
  categories: Record<StandardsCategoryId, { content: string; applicableSapVersions: ProjectSummary["sapVersion"][] }>;
};

const s4Template: TemplateDefinition = {
  id: "s4-default",
  name: "S4 默认规范模板",
  sapVersion: "S4",
  description: "适合 S/4HANA 项目的本地起步规范，强调 CDS/新语法兼容和只读验证边界。",
  categories: {
    abap: { content: [
      "优先使用清晰的局部方法拆分业务步骤。",
      "涉及生产系统时，只允许生成代码建议和说明文件，不自动写入 SAP。",
      "读取 SAP 对象前必须确认当前项目、系统别名和 Client。",
      "输出开发建议时必须列出数据来源、影响范围和上线确认点。"
    ].join("\n"), applicableSapVersions: ["S4", "UNKNOWN"] },
    comments: { content: [
      "复杂筛选、金额、库存和组织范围逻辑必须写业务口径注释。",
      "注释解释为什么这样做，不重复描述代码表面动作。",
      "临时兼容逻辑需要写明失效条件。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    request: { content: [
      "请求描述包含：业务背景、处理目标、涉及对象、测试范围、回退方案。",
      "不要在请求描述中写入密码、Token、真实客户明细或大段源码。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    alv: { content: [
      "筛选条件必须展示业务含义和默认范围。",
      "异常数据需要单独列示原因字段。",
      "导出文件字段顺序优先按用户核对习惯组织。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    interface: { content: [
      "接口必须明确幂等键、重试策略和错误返回结构。",
      "日志记录业务主键和错误原因，不记录密钥、Cookie 或完整报文密文。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    document: { content: [
      "默认结构：基本信息、业务背景、处理目标、关键逻辑、数据来源、异常与边界、交付物、上线确认清单。",
      "技术细节放入附录，正文优先保证业务可读。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    diagram: { content: [
      "优先生成 Mermaid 源文件。",
      "节点命名使用业务动作，不使用内部变量名。",
      "复杂分支需要标明判断条件和异常出口。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    excel: { content: [
      "导出文件必须包含来源、生成时间、筛选口径和异常说明。",
      "核对表保留完整表格，不按固定长度切碎。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] }
  }
};

const eccTemplate: TemplateDefinition = {
  id: "ecc-default",
  name: "ECC 默认规范模板",
  sapVersion: "ECC",
  description: "适合 ECC 项目的本地起步规范，强调经典 ABAP、ALV 和兼容边界。",
  categories: {
    abap: { content: [
      "优先使用清晰的 FORM 或局部方法划分读取、处理、输出。",
      "涉及生产系统时，只允许生成代码建议和说明文件，不自动写入 SAP。",
      "修改已有对象前必须保留源码快照和差异说明。",
      "输出建议时明确表、事务、权限和测试数据边界。"
    ].join("\n"), applicableSapVersions: ["ECC", "UNKNOWN"] },
    comments: { content: [
      "复杂业务口径、增强点和兼容逻辑必须写注释。",
      "注释解释业务原因，不堆叠无意义代码翻译。",
      "涉及历史兼容逻辑时记录适用系统和失效条件。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    request: { content: [
      "请求描述包含：问题来源、改动对象、测试路径、影响范围、回退方式。",
      "不要写入 SAP 密码、真实客户表行、Token 或大段源码。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    alv: { content: [
      "ALV 字段名称必须贴近业务核对语言。",
      "关键金额、数量和组织字段需要单位或币种。",
      "异常行需要提供可操作原因。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    interface: { content: [
      "接口程序必须记录来源系统、业务主键和错误分类。",
      "失败重试必须避免重复过账或重复生成单据。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    document: { content: [
      "默认结构：基本信息、业务背景、处理目标、关键逻辑、涉及对象、测试建议、上线确认清单。",
      "证据和源码快照只作为附件引用。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    diagram: { content: [
      "优先生成 Mermaid 源文件。",
      "流程图按用户业务步骤组织，不按程序内部子例程组织。",
      "异常路径必须单独标出。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] },
    excel: { content: [
      "导出文件必须写清筛选口径和数据时间。",
      "字段顺序优先满足业务核对，不按数据库字段顺序机械排列。"
    ].join("\n"), applicableSapVersions: ["S4", "ECC", "UNKNOWN"] }
  }
};

const templates: Record<StandardsTemplateId, TemplateDefinition> = {
  "s4-default": s4Template,
  "ecc-default": eccTemplate
};

function nowIso(): string {
  return new Date().toISOString();
}

function templateForSapVersion(sapVersion: ProjectSummary["sapVersion"]): TemplateDefinition {
  return sapVersion === "ECC" ? eccTemplate : s4Template;
}

function templateSummary(template: TemplateDefinition): StandardsTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    sapVersion: template.sapVersion,
    description: template.description
  };
}

function categoryFromTemplate(id: StandardsCategoryId, template: TemplateDefinition, updatedAt: string): StandardsCategory {
  const templateCategory = template.categories[id];
  return {
    id,
    title: categoryMeta[id].title,
    description: categoryMeta[id].description,
    sourceContent: templateCategory.content,
    currentContent: templateCategory.content,
    applicableSapVersions: templateCategory.applicableSapVersions,
    updatedAt
  };
}

function normalizeCategory(id: StandardsCategoryId, value: unknown, template: TemplateDefinition, updatedAt: string): StandardsCategory {
  const fallback = categoryFromTemplate(id, template, updatedAt);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<StandardsCategory>;
  const sourceContent = safeNormalizedStandardsContent(candidate.sourceContent, fallback.sourceContent);
  const currentContent = safeNormalizedStandardsContent(candidate.currentContent, sourceContent);
  const applicableSapVersions = Array.isArray(candidate.applicableSapVersions)
    ? candidate.applicableSapVersions.filter((version): version is ProjectSummary["sapVersion"] => version === "S4" || version === "ECC" || version === "UNKNOWN")
    : fallback.applicableSapVersions;
  return {
    id,
    title: categoryMeta[id].title,
    description: categoryMeta[id].description,
    sourceContent,
    currentContent,
    applicableSapVersions: applicableSapVersions.length > 0 ? applicableSapVersions : fallback.applicableSapVersions,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : updatedAt
  };
}

function safeNormalizedStandardsContent(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (value.length > MAX_CATEGORY_CONTENT_LENGTH) return fallback;
  try {
    assertNoSensitiveStandardsContent(value);
    return value;
  } catch {
    return fallback;
  }
}

function excerpt(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "空";
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
}

export function standardsTemplates(): StandardsTemplateSummary[] {
  return Object.values(templates).map(templateSummary);
}

export function createProjectStandards(projectId: string, sapVersion: ProjectSummary["sapVersion"], templateId?: StandardsTemplateId): ProjectStandardsProfile {
  const copiedAt = nowIso();
  const template = templateId ? templates[templateId] : templateForSapVersion(sapVersion);
  return {
    schemaVersion: 1,
    projectId,
    sourceType: "sap-version-template",
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    sourceProjectId: null,
    sourceProjectName: null,
    version: 1,
    copiedAt,
    updatedAt: copiedAt,
    categories: (Object.keys(categoryMeta) as StandardsCategoryId[]).map((id) => categoryFromTemplate(id, template, copiedAt))
  };
}

export function normalizeProjectStandards(projectId: string, sapVersion: ProjectSummary["sapVersion"], value: unknown): ProjectStandardsProfile {
  if (!value || typeof value !== "object") {
    return createProjectStandards(projectId, sapVersion);
  }

  const candidate = value as Partial<ProjectStandardsProfile>;
  const template = candidate.sourceTemplateId && templates[candidate.sourceTemplateId] ? templates[candidate.sourceTemplateId] : templateForSapVersion(sapVersion);
  const updatedAt = typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso();
  const categoryById = new Map((Array.isArray(candidate.categories) ? candidate.categories : []).map((category) => [category.id, category]));
  return {
    schemaVersion: 1,
    projectId,
    sourceType: candidate.sourceType === "copied-project" ? "copied-project" : "sap-version-template",
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    sourceProjectId: typeof candidate.sourceProjectId === "string" ? candidate.sourceProjectId : null,
    sourceProjectName: typeof candidate.sourceProjectName === "string" ? candidate.sourceProjectName : null,
    version: typeof candidate.version === "number" && candidate.version >= 1 ? Math.floor(candidate.version) : 1,
    copiedAt: typeof candidate.copiedAt === "string" ? candidate.copiedAt : updatedAt,
    updatedAt,
    categories: (Object.keys(categoryMeta) as StandardsCategoryId[]).map((id) => normalizeCategory(id, categoryById.get(id), template, updatedAt))
  };
}

export function parseCopyProjectStandardsInput(input: unknown): CopyProjectStandardsInput {
  if (!input || typeof input !== "object") {
    throw new Error("规范模板复制请求无效。");
  }
  const templateId = (input as Partial<CopyProjectStandardsInput>).templateId;
  if (templateId !== "s4-default" && templateId !== "ecc-default") {
    throw new Error("不支持的规范模板。");
  }
  return { templateId };
}

export function parseCopyProjectStandardsFromProjectInput(input: unknown): CopyProjectStandardsFromProjectInput {
  if (!input || typeof input !== "object") {
    throw new Error("从其他项目复制规范的请求无效。");
  }
  const sourceProjectId = (input as Partial<CopyProjectStandardsFromProjectInput>).sourceProjectId;
  if (typeof sourceProjectId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(sourceProjectId)) {
    throw new Error("来源项目 ID 无效。");
  }
  return { sourceProjectId };
}

function validateCategoryInput(input: unknown): StandardsCategoryInput | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<StandardsCategoryInput>;
  if (!candidate.id || !(candidate.id in categoryMeta) || typeof candidate.currentContent !== "string") return null;
  assertNoSensitiveStandardsContent(candidate.currentContent);
  if (candidate.currentContent.length > MAX_CATEGORY_CONTENT_LENGTH) {
    throw new Error("单项规范内容过长，请拆分后再保存。");
  }
  return {
    id: candidate.id,
    currentContent: candidate.currentContent.trim()
  };
}

export function parseSaveProjectStandardsInput(input: unknown): SaveProjectStandardsInput {
  if (!input || typeof input !== "object" || !Array.isArray((input as Partial<SaveProjectStandardsInput>).categories)) {
    throw new Error("规范保存请求无效。");
  }
  const categories = (input as Partial<SaveProjectStandardsInput>).categories?.map(validateCategoryInput).filter((item): item is StandardsCategoryInput => Boolean(item)) ?? [];
  if (categories.length === 0) {
    throw new Error("没有可保存的规范内容。");
  }
  return { categories };
}

export function assertNoSensitiveStandardsContent(content: string): void {
  const patterns = [
    /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    /secure-store:sec_[a-f0-9]{32}/i,
    /sk-[a-z0-9]{20,}/i,
    /ghp_[a-z0-9]{20,}/i,
    /github_pat_[a-z0-9_]{20,}/i,
    /xox[baprs]-[a-z0-9-]{20,}/i,
    /akia[0-9a-z]{16}/i,
    /bearer\s+[a-z0-9._-]{12,}/i,
    /authorization\s*[:=]/i,
    /cookie\s*[:=]/i,
    /x-csrf-token/i,
    /sap_sessionid/i,
    /mysapsso2/i,
    /tenant[_-]?access[_-]?token/i,
    /user[_-]?access[_-]?token/i,
    /api[_-]?key\s*[:=]/i,
    /password\s*[:=]/i,
    /passwd\s*[:=]/i,
    /token\s*[:=]/i,
    /^\s*(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION|FORM|MODULE|METHOD)\s+[\w/]+/im,
    /\bENDCLASS\b|\bENDFUNCTION\b|\bENDFORM\b|\bENDMETHOD\b/i
  ];
  if (patterns.some((pattern) => pattern.test(content))) {
    throw new Error("规范内容包含疑似密钥或授权信息，已阻止保存。");
  }
}

export function updateProjectStandards(profile: ProjectStandardsProfile, input: SaveProjectStandardsInput): ProjectStandardsProfile {
  const updatedAt = nowIso();
  const inputById = new Map(input.categories.map((category) => [category.id, category.currentContent]));
  const changed = profile.categories.some((category) => inputById.has(category.id) && inputById.get(category.id) !== category.currentContent);
  if (!changed) {
    return profile;
  }
  return {
    ...profile,
    version: profile.version + 1,
    updatedAt,
    categories: profile.categories.map((category) => ({
      ...category,
      currentContent: inputById.get(category.id) ?? category.currentContent,
      updatedAt: inputById.has(category.id) ? updatedAt : category.updatedAt
    }))
  };
}

export function copyProjectStandardsFromProject(targetProject: ProjectSummary, sourceProject: ProjectSummary): ProjectStandardsProfile {
  if (targetProject.id === sourceProject.id) {
    throw new Error("不能从当前项目复制到自身。");
  }
  const copiedAt = nowIso();
  const normalizedSource = normalizeProjectStandards(sourceProject.id, sourceProject.sapVersion, sourceProject.standards);
  return {
    ...normalizedSource,
    projectId: targetProject.id,
    sourceType: "copied-project",
    sourceProjectId: sourceProject.id,
    sourceProjectName: sourceProject.name,
    version: 1,
    copiedAt,
    updatedAt: copiedAt,
    categories: normalizedSource.categories.map((category) => ({
      ...category,
      sourceContent: category.currentContent,
      currentContent: category.currentContent,
      updatedAt: copiedAt
    }))
  };
}

export function diffProjectStandards(profile: ProjectStandardsProfile, sapVersion: ProjectSummary["sapVersion"]): StandardsDiffItem[] {
  return profile.categories.map((category) => {
    const source = category.sourceContent.trim();
    const current = category.currentContent.trim();
    const status = !category.applicableSapVersions.includes(sapVersion)
      ? "not-applicable"
      : source === current
        ? "same"
        : !source
          ? "project-only"
          : !current
            ? "template-only"
            : "modified";
    return {
      id: category.id,
      title: category.title,
      status,
      sourceExcerpt: excerpt(source),
      currentExcerpt: excerpt(current)
    };
  });
}

export function projectStandardsView(profile: ProjectStandardsProfile, sapVersion: ProjectSummary["sapVersion"]): ProjectStandardsView {
  return {
    profile,
    templates: standardsTemplates(),
    diff: diffProjectStandards(profile, sapVersion)
  };
}

export function standardsSummaryForTask(profile: ProjectStandardsProfile): string {
  const changed = profile.categories.filter((category) => category.currentContent.trim() !== category.sourceContent.trim()).map((category) => category.title);
  const changedText = changed.length > 0 ? `已修改：${changed.join("、")}` : "当前项目仍沿用模板默认内容";
  return `${profile.sourceTemplateName} v${profile.version}；${changedText}`;
}

export function renderProjectStandardsMarkdown(profile: ProjectStandardsProfile): string {
  const lines = [
    "# 项目规范副本",
    "",
    "安全标记：no-secrets-project-standards",
    "",
    `来源模板：${profile.sourceTemplateName}`,
    `来源类型：${profile.sourceType === "copied-project" ? "其他项目复制" : "SAP 版本模板"}`,
    profile.sourceProjectName ? `来源项目：${profile.sourceProjectName}` : null,
    `模板 ID：${profile.sourceTemplateId}`,
    `当前版本：v${profile.version}`,
    `复制时间：${profile.copiedAt}`,
    `更新时间：${profile.updatedAt}`,
    "",
    "说明：本文件是当前项目的本地规范副本，不会自动覆盖其他项目。不要在规范中保存 SAP 密码、API Key、飞书 Token、真实客户明细或大段生产源码。",
    ""
  ].filter((line): line is string => typeof line === "string");

  for (const category of profile.categories) {
    lines.push(`## ${category.title}`, "", category.currentContent || "空", "");
  }

  return `${lines.join("\n")}\n`;
}

export function renderProjectStandardsJson(profile: ProjectStandardsProfile): object {
  return {
    safety: "no-secrets-project-standards",
    profile
  };
}
