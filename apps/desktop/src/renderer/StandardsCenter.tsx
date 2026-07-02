import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Copy, GitCompare, Save, ShieldCheck, Sparkles } from "lucide-react";
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
  onCopyTemplate: (projectId: string, templateId: StandardsTemplateId) => Promise<void>;
  onCopyFromProject: (projectId: string, sourceProjectId: string) => Promise<void>;
  onSave: (projectId: string, input: SaveProjectStandardsInput) => Promise<void>;
}

function StandardsCenter({ project, projects, notice, onBack, onCopyTemplate, onCopyFromProject, onSave }: StandardsCenterProps) {
  const [view, setView] = useState<ProjectStandardsView | null>(null);
  const [draft, setDraft] = useState<Record<StandardsCategoryId, string> | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<StandardsCategoryId>("abap");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    if (!project || !window.workbench) {
      setView(null);
      setDraft(null);
      return;
    }

    window.workbench.getProjectStandards(project.id).then((response) => {
      if (ignore) return;
      if (response.ok) {
        setView(response.data);
        setDraft(cloneDraft(response.data));
        setSelectedCategoryId(response.data.profile.categories[0]?.id ?? "abap");
      }
    });

    return () => {
      ignore = true;
    };
  }, [project?.id, project?.standards.updatedAt, project?.standards.version]);

  const selectedCategory = view?.profile.categories.find((category) => category.id === selectedCategoryId) ?? view?.profile.categories[0];
  const selectedDiff = view?.diff.find((item) => item.id === selectedCategory?.id);
  const changed = useMemo(() => {
    if (!view || !draft) return false;
    return view.profile.categories.some((category) => draft[category.id] !== category.currentContent);
  }, [view, draft]);
  const sourceProjects = (projects ?? []).filter((item) => item.id !== project?.id);
  const modifiedCount = view?.diff.filter((item) => item.status === "modified").length ?? 0;
  const notApplicableCount = view?.diff.filter((item) => item.status === "not-applicable").length ?? 0;

  async function copyTemplate(templateId: StandardsTemplateId) {
    if (!project) return;
    await onCopyTemplate(project.id, templateId);
  }

  async function copyFromProject() {
    if (!project || !sourceProjectId) return;
    await onCopyFromProject(project.id, sourceProjectId);
  }

  async function saveDraft() {
    if (!project || !view || !draft || saving) return;
    setSaving(true);
    try {
      await onSave(project.id, {
        categories: view.profile.categories.map((category) => ({
          id: category.id,
          currentContent: draft[category.id]
        }))
      });
    } finally {
      setSaving(false);
    }
  }

  if (!project || !view || !draft || !selectedCategory) {
    return (
      <section className="standards-workspace">
        <div className="standards-main">
          <div className="config-heading">
            <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
            <div>
              <h1>规范中心</h1>
              <p>请先创建或选择一个本地项目。</p>
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
          <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
          <div>
            <h1>规范中心</h1>
            <p>{project.name} · {project.sapVersion} · 项目独立规范副本</p>
          </div>
        </div>

        <div className="phase-notice config-notice">
          <ShieldCheck size={16} />
          <span>{notice}</span>
        </div>

        <section className="standards-toolbar">
          <div>
            <span>来源</span>
            <strong>{view.profile.sourceType === "copied-project" ? `来自项目：${view.profile.sourceProjectName}` : view.profile.sourceTemplateName}</strong>
          </div>
          <div>
            <span>当前版本</span>
            <strong>v{view.profile.version}</strong>
          </div>
          <div>
            <span>更新时间</span>
            <strong>{formatDate(view.profile.updatedAt)}</strong>
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
            {view.templates.map((template) => (
              <button key={template.id} onClick={() => void copyTemplate(template.id)} title={template.description}>
                <Copy size={16} />复制 {template.sapVersion} 模板
              </button>
            ))}
          </div>
          <div className="standards-copy-project">
            <label>
              <span>从其他项目复制</span>
              <select value={sourceProjectId} onChange={(event) => setSourceProjectId(event.target.value)}>
                <option value="">选择来源项目</option>
                {sourceProjects.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <button disabled={!sourceProjectId} onClick={() => void copyFromProject()}><Copy size={16} />复制为当前项目副本</button>
          </div>
        </section>

        <section className="standards-editor">
          <aside className="standards-category-list">
            {view.profile.categories.map((category) => {
              const diff = view.diff.find((item) => item.id === category.id);
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
              value={draft[selectedCategory.id]}
              onChange={(event) => setDraft((current) => current ? { ...current, [selectedCategory.id]: event.target.value } : current)}
              aria-label={`${selectedCategory.title}内容`}
            />
            <div className="config-actions">
              <button onClick={() => void saveDraft()} disabled={!changed || saving}><Save size={16} />{saving ? "保存中" : changed ? "保存当前项目版本" : "没有变化"}</button>
            </div>

            <div className="standards-example">
              <div>
                <Sparkles size={16} />
                <strong>测试生成示例</strong>
              </div>
              <p>ABAP 开发模式会引用当前项目规范 v{view.profile.version}，优先使用「{selectedCategory.title}」中的项目规则。这里只生成本地示例，不调用模型或 SAP。</p>
              <pre>{`示例输出：\n- 项目：${project.name}\n- 规范版本：v${view.profile.version}\n- 使用分类：${selectedCategory.title}\n- 摘要：${draft[selectedCategory.id].replace(/\s+/g, " ").slice(0, 120)}${draft[selectedCategory.id].length > 120 ? "..." : ""}`}</pre>
            </div>

            <details className="standards-advanced">
              <summary>高级选项：查看底层提示词摘要</summary>
              <p>后续真实模型任务只应读取当前项目规范摘要、必要分类和版本号；不得把密钥、真实客户数据或无关技术日志写入提示词。</p>
            </details>
          </div>
        </section>
      </div>

      <aside className="standards-diff">
        <section>
          <h2><GitCompare size={17} />差异</h2>
          <p>来源模板和当前项目副本的对比，只用于说明当前项目规范变化。</p>
        </section>
        {view.diff.map((item) => (
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
