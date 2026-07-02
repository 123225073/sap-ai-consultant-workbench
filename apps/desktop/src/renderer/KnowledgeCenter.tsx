import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, CheckCircle2, FileText, Search, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import type { KnowledgeDocumentJobStatus, KnowledgeItem, KnowledgeItemActionInput, KnowledgeItemStatus, ProjectKnowledgeView, ProjectSummary } from "../shared/workbenchTypes";

const statusLabels: Record<KnowledgeItemStatus, string> = {
  draft: "草稿",
  pending: "待确认",
  published: "已发布",
  conflicted: "有冲突",
  expired: "已失效"
};

const statusTone: Record<KnowledgeItemStatus, "neutral" | "green" | "orange" | "blue" | "red"> = {
  draft: "neutral",
  pending: "orange",
  published: "green",
  conflicted: "red",
  expired: "blue"
};

const jobLabels: Record<KnowledgeDocumentJobStatus, string> = {
  queued: "排队中",
  parsed: "已解析，待复核",
  "needs-review": "需人工确认",
  blocked: "暂不可处理"
};

const typeLabels: Record<KnowledgeItem["type"], string> = {
  qa: "QA 问答",
  doc: "文档知识",
  sap_object: "SAP 对象说明",
  case_note: "案件经验",
  timeline_fact: "时间线事实"
};

const sourceTypeLabels: Record<KnowledgeItem["sourceType"], string> = {
  "case-candidate": "案件候选",
  "document-import": "文档导入",
  "qa-import": "QA 导入",
  manual: "人工维护"
};

function statusPill(status: KnowledgeItemStatus) {
  return <span className={`status-pill status-${statusTone[status]}`}>{statusLabels[status]}</span>;
}

function formatTime(value: string | null): string {
  if (!value) return "无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN", { hour12: false });
}

interface KnowledgeCenterProps {
  project?: ProjectSummary;
  notice: string;
  onBack: () => void;
  onPublish: (projectId: string, input: KnowledgeItemActionInput) => Promise<void>;
  onMarkConflict: (projectId: string, input: KnowledgeItemActionInput) => Promise<void>;
  onExpire: (projectId: string, input: KnowledgeItemActionInput) => Promise<void>;
}

function KnowledgeCenter({ project, notice, onBack, onPublish, onMarkConflict, onExpire }: KnowledgeCenterProps) {
  const [view, setView] = useState<ProjectKnowledgeView | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<KnowledgeItemStatus | "all">("pending");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [query, setQuery] = useState("");
  const [busyItemId, setBusyItemId] = useState("");

  useEffect(() => {
    let ignore = false;
    if (!project || !window.workbench) {
      setView(null);
      return;
    }

    window.workbench.getProjectKnowledge(project.id).then((response) => {
      if (ignore) return;
      if (response.ok) {
        setView(response.data);
        setSelectedItemId(response.data.items[0]?.id ?? "");
      }
    });

    return () => {
      ignore = true;
    };
  }, [project?.id, project?.knowledge.updatedAt]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (view?.items ?? []).filter((item) => {
      const statusMatched = selectedStatus === "all" || item.status === selectedStatus;
      const textMatched = !normalized || [item.title, item.summary, item.content, item.type, item.sourceFilePath ?? "", ...item.sapObjects].join(" ").toLowerCase().includes(normalized);
      return statusMatched && textMatched;
    });
  }, [view, selectedStatus, query]);

  const selectedItem = filteredItems.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? null;

  async function runAction(action: "publish" | "conflict" | "expire", item: KnowledgeItem) {
    if (!project || busyItemId) return;
    setBusyItemId(item.id);
    try {
      if (action === "publish") {
        await onPublish(project.id, { itemId: item.id, note: "人工确认入库。" });
      } else if (action === "conflict") {
        await onMarkConflict(project.id, { itemId: item.id, note: "人工标记为与既有知识存在冲突。" });
      } else {
        await onExpire(project.id, { itemId: item.id, note: "人工标记为已失效。" });
      }
    } finally {
      setBusyItemId("");
    }
  }

  if (!project || !view) {
    return (
      <section className="knowledge-workspace">
        <div className="knowledge-main">
          <div className="config-heading">
            <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
            <div>
              <h1>知识库</h1>
              <p>请先创建或选择一个本地项目。</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="knowledge-workspace">
      <div className="knowledge-main">
        <div className="config-heading">
          <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
          <div>
            <h1>知识库</h1>
            <p>{project.name} · {project.sapVersion} · 本地人工确认知识资产</p>
          </div>
        </div>

        <div className="phase-notice config-notice">
          <ShieldCheck size={16} />
          <span>{notice}</span>
        </div>

        <section className="knowledge-toolbar" aria-label="知识库状态概览">
          <div>
            <span>全部知识</span>
            <strong>{view.counts.total}</strong>
          </div>
          <div>
            <span>待确认</span>
            <strong>{view.counts.pending}</strong>
          </div>
          <div>
            <span>已发布</span>
            <strong>{view.counts.published}</strong>
          </div>
          <div>
            <span>冲突/失效</span>
            <strong>{view.counts.conflicted + view.counts.expired}</strong>
          </div>
        </section>

        <section className="knowledge-actions">
          <button disabled title="后续阶段启用，现在不解析真实文件"><FileText size={16} />上传文档（后续）</button>
          <button disabled title="后续阶段启用，现在不导入真实 QA 表"><Archive size={16} />导入 QA 表（后续）</button>
          <button disabled title="后续阶段启用，现在不调用飞书"><FileText size={16} />从飞书同步（后续）</button>
          <label>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题、SAP对象、文档、逻辑图、QA" />
          </label>
        </section>
        <p className="knowledge-action-note">当前阶段只做本地知识审核：不读取上传文件、不导入真实 QA、不连接飞书。</p>

        <section className="knowledge-grid">
          <aside className="knowledge-status-list">
            {(["all", "pending", "published", "conflicted", "expired", "draft"] as const).map((status) => (
              <button className={selectedStatus === status ? "active" : ""} key={status} onClick={() => setSelectedStatus(status)}>
                <span>{status === "all" ? "全部知识" : statusLabels[status]}</span>
                <strong>{status === "all" ? view.counts.total : view.counts[status]}</strong>
              </button>
            ))}
          </aside>

          <div className="knowledge-list">
            {filteredItems.length > 0 ? filteredItems.map((item) => (
              <button className={selectedItem?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedItemId(item.id)}>
                <div>
                  <strong>{item.title}</strong>
                  {statusPill(item.status)}
                </div>
                <span>{item.sourceCaseId ? `案件：${item.sourceCaseId}` : sourceTypeLabels[item.sourceType]} · {item.sapObjects.length ? `对象：${item.sapObjects.join("、")}` : "未绑定对象"}</span>
                <small>{item.confidence !== null ? `置信度 ${Math.round(item.confidence * 100)}%` : "人工维护"}</small>
              </button>
            )) : <div className="empty-state">没有匹配的知识项。</div>}
          </div>
        </section>

        <section className="knowledge-parser-queue">
          <h2>后续解析入口</h2>
          <p>这里先显示本地待处理队列，不代表已经读取或解析真实文档。</p>
          <div>
            {view.documentJobs.map((job) => (
              <article key={job.id}>
                <strong>{job.title}</strong>
                <span>{jobLabels[job.status]}</span>
                <small>{job.detail}</small>
              </article>
            ))}
          </div>
        </section>
      </div>

      <aside className="knowledge-detail">
        {selectedItem ? (
          <>
            <section>
              <div className="knowledge-detail-title">
                <h2>{selectedItem.title}</h2>
                {statusPill(selectedItem.status)}
              </div>
              <dl>
                <div><dt>项目</dt><dd>{project.name}</dd></div>
                <div><dt>类型</dt><dd>{typeLabels[selectedItem.type]}</dd></div>
                <div><dt>来源</dt><dd>{selectedItem.sourceFilePath ?? sourceTypeLabels[selectedItem.sourceType]}</dd></div>
                <div><dt>生效时间</dt><dd>{selectedItem.effectiveFrom ?? "待确认"}</dd></div>
                <div><dt>更新时间</dt><dd>{formatTime(selectedItem.updatedAt)}</dd></div>
              </dl>
            </section>

            <section>
              <h3>内容预览</h3>
              <p>{selectedItem.content}</p>
            </section>

            {selectedItem.status === "conflicted" ? (
              <section className="knowledge-warning">
                <ShieldAlert size={16} />
                <span>该知识存在适用范围或结论冲突，不能直接覆盖已发布知识。</span>
              </section>
            ) : null}

            <section className="knowledge-detail-actions">
              <button disabled={busyItemId === selectedItem.id || selectedItem.status === "published" || selectedItem.status === "conflicted" || selectedItem.status === "expired"} title={selectedItem.status === "conflicted" ? "冲突知识不能直接确认入库" : "人工确认后才会发布"} onClick={() => void runAction("publish", selectedItem)}><CheckCircle2 size={16} />确认入库</button>
              <button disabled={busyItemId === selectedItem.id || selectedItem.status === "conflicted" || selectedItem.status === "expired"} onClick={() => void runAction("conflict", selectedItem)}><ShieldAlert size={16} />标记冲突</button>
              <button disabled={busyItemId === selectedItem.id || selectedItem.status === "expired"} onClick={() => void runAction("expire", selectedItem)}><XCircle size={16} />标记失效</button>
            </section>

            <section className="knowledge-timeline">
              <h3>时间线</h3>
              {selectedItem.timeline.map((event) => (
                <div key={event.id}>
                  <time>{formatTime(event.at)}</time>
                  <span>{event.note}</span>
                </div>
              ))}
            </section>
          </>
        ) : (
          <section>
            <h2>知识详情</h2>
            <p>请选择一个知识项。</p>
          </section>
        )}
      </aside>
    </section>
  );
}

export default KnowledgeCenter;
