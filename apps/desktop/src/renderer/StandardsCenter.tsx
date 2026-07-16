import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, BookOpen, Copy, GitCompare, RefreshCw, Save, ShieldCheck } from "lucide-react";
import type { ProjectStandardsView, ProjectSummary, SaveProjectStandardsInput, StandardsCategoryId, StandardsDiffStatus, StandardsTemplateId } from "../shared/workbenchTypes";

const diffLabels: Record<StandardsDiffStatus, string> = {
  same: "与来源相同",
  modified: "当前项目已修改",
  "project-only": "项目独有",
  "template-only": "模板独有",
  "not-applicable": "不适用当前 SAP 版本"
};

const diffTone: Record<StandardsDiffStatus, "neutral" | "blue" | "orange" | "green"> = {
  same: "green",
  modified: "orange",
  "project-only": "blue",
  "template-only": "neutral",
  "not-applicable": "neutral"
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function cloneDraft(view: ProjectStandardsView): Record<StandardsCategoryId, string> {
  return Object.fromEntries(view.profile.categories.map((category) => [category.id, category.currentContent])) as Record<StandardsCategoryId, string>;
}

function statusPill(status: StandardsDiffStatus) {
  return <span className={`status-pill status-${diffTone[status]}`}>{diffLabels[status]}</span>;
}

interface StandardsCenterProps {
  project?: ProjectSummary;
  projects: ProjectSummary[];
  notice: string;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCopyTemplate: (projectId: string, templateId: StandardsTemplateId) => Promise<void>;
  onCopyFromProject: (projectId: string, sourceProjectId: string) => Promise<void>;
  onSave: (projectId: string, input: SaveProjectStandardsInput) => Promise<void>;
}

function StandardsCenter({ project, projects, notice, onBack, onDirtyChange, onCopyTemplate, onCopyFromProject, onSave }: StandardsCenterProps) {
  const [view, setView] = useState<ProjectStandardsView | null>(null);
  const [draft, setDraft] = useState<Record<StandardsCategoryId, string> | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<StandardsCategoryId>("abap");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<{ projectId: string; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const requestSequence = useRef(0);
  const loadedProjectId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    let cancelled = false;
    const projectId = project?.id;

    const projectChanged = loadedProjectId.current !== projectId;
    loadedProjectId.current = projectId;
    if (projectChanged) {
      setView(null);
      setDraft(null);
      setSourceProjectId("");
    }
    setLoadError(null);

    if (!projectId) {
      setLoading(false);
      return;
    }
    if (!window.workbench) {
      setLoading(false);
      setLoadError({ projectId, message: "当前环境无法连接本地工作台，项目规范未读取。请在桌面应用中重试。" });
      return;
    }

    setLoading(true);
    const isCurrentRequest = () => !cancelled && requestId === requestSequence.current;

    void window.workbench.getProjectStandards(projectId)
      .then((response) => {
        if (!isCurrentRequest()) return;
        if (!response.ok) {
          setLoadError({ projectId, message: response.error || "读取项目规范失败，请重试。" });
          return;
        }
        if (response.data.profile.projectId !== projectId) {
          setLoadError({ projectId, message: "读取结果与当前项目不一致，已阻止显示旧项目规范。请重试。" });
          return;
        }
        if (response.data.profile.categories.length === 0) {
          setLoadError({ projectId, message: "项目规范内容为空或格式不完整，请重新读取或检查本地项目状态。" });
          return;
        }
        setView(response.data);
        setDraft(cloneDraft(response.data));
        setSelectedCategoryId(response.data.profile.categories[0]?.id ?? "abap");
      })
      .catch((error: unknown) => {
        if (!isCurrentRequest()) return;
        const detail = error instanceof Error && error.message ? `：${error.message}` : "";
        setLoadError({ projectId, message: `读取项目规范失败${detail}` });
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.standards.updatedAt, project?.standards.version, reloadKey]);

  const currentView = view?.profile.projectId === project?.id ? view : null;
  const currentDraft = currentView ? draft : null;
  const currentLoadError = loadError && loadError.projectId === project?.id ? loadError.message : null;
  const selectedCategory = currentView?.profile.categories.find((category) => category.id === selectedCategoryId) ?? currentView?.profile.categories[0];
  const selectedDiff = currentView?.diff.find((item) => item.id === selectedCategory?.id);
  const changed = useMemo(() => {
    if (!currentView || !currentDraft) return false;
    return currentView.profile.categories.some((category) => currentDraft[category.id] !== category.currentContent);
  }, [currentView, currentDraft]);
  useEffect(() => {
    onDirtyChange?.(changed);
    return () => onDirtyChange?.(false);
  }, [changed, onDirtyChange]);
  const sourceProjects = useMemo(() => (
    (projects ?? []).filter((item) => item.id !== project?.id && item.isVisible !== false)
  ), [project?.id, projects]);
  const modifiedCount = currentView?.diff.filter((item) => item.status === "modified").length ?? 0;
  const notApplicableCount = currentView?.diff.filter((item) => item.status === "not-applicable").length ?? 0;

  useEffect(() => {
    if (sourceProjectId && !sourceProjects.some((item) => item.id === sourceProjectId)) {
      setSourceProjectId("");
    }
  }, [sourceProjectId, sourceProjects]);

  function confirmStandardsReplacement(actionLabel: string): boolean {
    if (!currentView) return false;
    const hasExistingStandards = currentView.profile.categories.some((category) => category.currentContent.trim().length > 0);
    if (!changed && !hasExistingStandards) return true;
    const consequences = [
      changed ? "未保存的修改会丢失" : null,
      hasExistingStandards ? "当前项目的现有规范会被覆盖" : null
    ].filter((item): item is string => Boolean(item));
    return window.confirm(`${actionLabel}前请确认：${consequences.join("；")}。\n\n是否继续？`);
  }

  async function copyTemplate(templateId: StandardsTemplateId) {
    if (!project || replacing || saving) return;
    const templateName = currentView?.templates.find((template) => template.id === templateId)?.name ?? "所选模板";
    if (!confirmStandardsReplacement(`复制“${templateName}”`)) return;
    setReplacing(true);
    try {
      await onCopyTemplate(project.id, templateId);
    } finally {
      setReplacing(false);
    }
  }

  async function copyFromProject() {
    if (!project || !sourceProjectId || replacing || saving) return;
    const sourceName = sourceProjects.find((item) => item.id === sourceProjectId)?.name ?? "所选项目";
    if (!confirmStandardsReplacement(`从“${sourceName}”复制规范`)) return;
    setReplacing(true);
    try {
      await onCopyFromProject(project.id, sourceProjectId);
    } finally {
      setReplacing(false);
    }
  }

  async function saveDraft() {
    if (!project || !currentView || !currentDraft || saving || replacing) return;
    setSaving(true);
    try {
      await onSave(project.id, {
        categories: currentView.profile.categories.map((category) => ({
          id: category.id,
          currentContent: currentDraft[category.id]
        }))
      });
    } finally {
      setSaving(false);
    }
  }

  function leaveStandardsCenter() {
    onBack();
  }

  if (!project) {
    return (
      <section className="standards-workspace">
        <div className="standards-main">
          <div className="config-heading">
            <button className="icon-button" onClick={leaveStandardsCenter} aria-label="返回案件"><ArrowLeft size={18} /></button>
            <div>
              <h1>规范中心</h1>
              <p>请先创建或选择一个本地项目。</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (currentLoadError) {
    return (
      <section className="standards-workspace">
        <div className="standards-main">
          <div className="config-heading">
            <button className="icon-button" onClick={leaveStandardsCenter} aria-label="返回案件"><ArrowLeft size={18} /></button>
            <div>
              <h1>规范中心</h1>
              <p>{project.name} · {project.sapVersion}</p>
            </div>
          </div>
          <div className="phase-notice config-notice" role="alert">
            <AlertCircle size={16} />
            <span><strong>规范读取失败。</strong> {currentLoadError}</span>
          </div>
          <div className="config-actions">
            <button type="button" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={16} />重新读取项目规范</button>
          </div>
        </div>
      </section>
    );
  }

  if (!currentView || !currentDraft || !selectedCategory) {
    return (
      <section className="standards-workspace">
        <div className="standards-main">
          <div className="config-heading">
            <button className="icon-button" onClick={leaveStandardsCenter} aria-label="返回案件"><ArrowLeft size={18} /></button>
            <div>
              <h1>规范中心</h1>
              <p>{project.name} · {loading ? "正在读取项目规范..." : "项目规范尚未就绪，请稍候。"}</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="standards-workspace">
      <div className="standards-main">
        <div className="config-heading">
          <button className="icon-button" onClick={leaveStandardsCenter} aria-label="返回案件"><ArrowLeft size={18} /></button>
          <div>
            <h1>规范中心</h1>
            <p>{project.name} · {project.sapVersion} · 项目独立规范副本</p>
          </div>
        </div>

        {notice ? (
          <div className="phase-notice config-notice">
            <ShieldCheck size={16} />
            <span>{notice}</span>
          </div>
        ) : null}

        <section className="standards-toolbar">
          <div>
            <span>来源</span>
            <strong>{currentView.profile.sourceType === "copied-project" ? `来自项目：${currentView.profile.sourceProjectName}` : currentView.profile.sourceTemplateName}</strong>
          </div>
          <div>
            <span>当前版本</span>
            <strong>v{currentView.profile.version}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{formatDate(currentView.profile.updatedAt)}</strong>
          </div>
          <div>
            <span>差异</span>
            <strong>{modifiedCount} 项修改 · {notApplicableCount} 项不适用</strong>
          </div>
        </section>

        <section className="standards-actions">
          <div>
            <strong>模板迁移</strong>
            <span>复制后会成为当前项目自己的副本，不覆盖模板，也不影响其他项目。</span>
          </div>
          <div className="config-actions standards-action-buttons">
            {currentView.templates.map((template) => (
              <button key={template.id} disabled={replacing || saving} onClick={() => void copyTemplate(template.id)} title={template.description}>
                <Copy size={16} />复制 {template.sapVersion} 模板
              </button>
            ))}
          </div>
          <div className="standards-copy-project">
            <label>
              <span>从其他项目复制</span>
              <select value={sourceProjectId} disabled={replacing || saving} onChange={(event) => setSourceProjectId(event.target.value)}>
                <option value="">选择来源项目</option>
                {sourceProjects.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <button disabled={!sourceProjectId || replacing || saving} onClick={() => void copyFromProject()}><Copy size={16} />{replacing ? "复制中" : "复制为当前项目副本"}</button>
          </div>
        </section>

        <section className="standards-editor">
          <aside className="standards-category-list">
            {currentView.profile.categories.map((category) => {
              const diff = currentView.diff.find((item) => item.id === category.id);
              return (
                <button className={category.id === selectedCategory.id ? "active" : ""} key={category.id} onClick={() => setSelectedCategoryId(category.id)}>
                  <BookOpen size={16} />
                  <span>{category.title}</span>
                  {diff ? statusPill(diff.status) : null}
                </button>
              );
            })}
          </aside>

          <div className="standards-edit-pane">
            <div className="standards-edit-heading">
              <div>
                <h2>{selectedCategory.title}</h2>
                <p>{selectedCategory.description}</p>
              </div>
              {selectedDiff ? statusPill(selectedDiff.status) : null}
            </div>
            <textarea
              value={currentDraft[selectedCategory.id]}
              onChange={(event) => setDraft((current) => current ? { ...current, [selectedCategory.id]: event.target.value } : current)}
              aria-label={`${selectedCategory.title}内容`}
            />
            <div className="config-actions">
              <button onClick={() => void saveDraft()} disabled={!changed || saving || replacing}><Save size={16} />{saving ? "保存中" : changed ? "保存当前项目版本" : "没有变化"}</button>
            </div>
          </div>
        </section>
      </div>

      <aside className="standards-diff">
        <section>
          <h2><GitCompare size={17} />差异</h2>
          <p>来源模板和当前项目副本的对比，只用于说明当前项目规范变化。</p>
        </section>
        {currentView.diff.map((item) => (
          <section className="diff-item" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              {statusPill(item.status)}
            </div>
            <dl>
              <dt>来源</dt>
              <dd>{item.sourceExcerpt}</dd>
              <dt>当前项目</dt>
              <dd>{item.currentExcerpt}</dd>
            </dl>
          </section>
        ))}
      </aside>
    </section>
  );
}

export default StandardsCenter;
