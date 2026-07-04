import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, CheckCircle2, FileText, RefreshCcw, Save, Search, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import type { KnowledgeCaseReferenceInput, KnowledgeDocumentJobStatus, KnowledgeEditInput, KnowledgeImportLocalTextInput, KnowledgeImportTextFileResult, KnowledgeItem, KnowledgeItemActionInput, KnowledgeItemStatus, KnowledgeReviewInput, ProjectKnowledgeView, ProjectSummary } from "../shared/workbenchTypes";

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
const PHASE21_KNOWLEDGE_EDIT_REVIEW_MARKER = "phase21-knowledge-edit-conflict-resolution";

const jobLabels: Record<KnowledgeDocumentJobStatus, string> = {
  queued: "排队中",
  parsed: "已整理，待复核",
  "needs-review": "需人工确认",
  blocked: "暂不可处理"
};

const sourceKindLabels: Record<KnowledgeImportLocalTextInput["sourceKind"], string> = {
  "local-text": "本地文本",
  "markdown-note": "Markdown 笔记",
  "qa-text": "QA 文本"
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

const reviewChecklistLabels: { id: keyof KnowledgeReviewInput["checklist"]; label: string }[] = [
  { id: "sourceAndScopeConfirmed", label: "来源和适用范围已确认" },
  { id: "noSecretsConfirmed", label: "不包含密码、Token 或授权信息" },
  { id: "noSapSourceOrWriteOpsConfirmed", label: "不包含 SAP 源码或写操作片段" },
  { id: "noCustomerDetailsConfirmed", label: "不包含客户业务明细数据" }
];

const emptyReviewChecklist: KnowledgeReviewInput["checklist"] = {
  sourceAndScopeConfirmed: false,
  noSecretsConfirmed: false,
  noSapSourceOrWriteOpsConfirmed: false,
  noCustomerDetailsConfirmed: false
};

function statusPill(status: KnowledgeItemStatus) {
  return <span className={`status-pill status-${statusTone[status]}`}>{statusLabels[status]}</span>;
}

function isPhase16LocalTextImportCandidate(item: KnowledgeItem): boolean {
  return item.id.startsWith("knowledge-import-") ||
    ((item.sourceType === "document-import" || item.sourceType === "qa-import") &&
      (item.sourceFilePath ?? "").startsWith("knowledge_candidates/imported-knowledge-"));
}

function isCaseGeneratedKnowledgeCandidate(item: KnowledgeItem): boolean {
  return item.sourceType === "case-candidate" &&
    typeof item.sourceCaseId === "string" &&
    (item.sourceFilePath ?? "").startsWith("knowledge_candidates/");
}

function isPhase21EditedCandidate(item: KnowledgeItem): boolean {
  return item.timeline.some((timelineEvent) =>
    timelineEvent.action === "edited" && timelineEvent.note.includes(PHASE21_KNOWLEDGE_EDIT_REVIEW_MARKER)
  );
}

function hasCompleteReview(item: KnowledgeItem): boolean {
  return Boolean(item.reviewedAt && item.reviewer && item.reviewNote && item.reviewedContentHash && item.reviewChecklist);
}

function hasReusableReviewRecord(item: KnowledgeItem): boolean {
  return Boolean(item.reviewedAt && item.reviewer && item.reviewNote && item.reviewNote.trim().length >= 8 && item.reviewChecklist);
}

function reviewChecklistComplete(checklist: KnowledgeReviewInput["checklist"]): boolean {
  return reviewChecklistLabels.every((item) => checklist[item.id]);
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
  onImport: (input: KnowledgeImportLocalTextInput) => Promise<boolean>;
  onImportTextFile: (projectId: string) => Promise<KnowledgeImportTextFileResult | null>;
  onReview: (projectId: string, input: KnowledgeReviewInput) => Promise<void>;
  onEdit: (projectId: string, input: KnowledgeEditInput) => Promise<boolean>;
  onAttachToCurrentCase: (projectId: string, input: KnowledgeCaseReferenceInput) => Promise<void>;
  onPublish: (projectId: string, input: KnowledgeItemActionInput) => Promise<void>;
  onMarkConflict: (projectId: string, input: KnowledgeItemActionInput) => Promise<void>;
  onExpire: (projectId: string, input: KnowledgeItemActionInput) => Promise<void>;
}

function KnowledgeCenter({ project, notice, onBack, onImport, onImportTextFile, onReview, onEdit, onAttachToCurrentCase, onPublish, onMarkConflict, onExpire }: KnowledgeCenterProps) {
  const [view, setView] = useState<ProjectKnowledgeView | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<KnowledgeItemStatus | "all">("pending");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [query, setQuery] = useState("");
  const [busyItemId, setBusyItemId] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importSourceKind, setImportSourceKind] = useState<KnowledgeImportLocalTextInput["sourceKind"]>("local-text");
  const [importSourceName, setImportSourceName] = useState("本地粘贴文本");
  const [importSapObjects, setImportSapObjects] = useState("");
  const [importBody, setImportBody] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importFileBusy, setImportFileBusy] = useState(false);
  const [importFileStatus, setImportFileStatus] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewChecklist, setReviewChecklist] = useState<KnowledgeReviewInput["checklist"]>(emptyReviewChecklist);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editSapObjects, setEditSapObjects] = useState("");
  const [editEffectiveFrom, setEditEffectiveFrom] = useState("");
  const [editEffectiveTo, setEditEffectiveTo] = useState("");
  const [editNote, setEditNote] = useState("");

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

  useEffect(() => {
    setReviewNote(selectedItem?.reviewNote ?? "");
    setReviewChecklist(selectedItem?.reviewChecklist ?? emptyReviewChecklist);
  }, [selectedItem?.id, selectedItem?.reviewedAt]);

  useEffect(() => {
    setEditTitle(selectedItem?.title ?? "");
    setEditSummary(selectedItem?.summary ?? "");
    setEditContent(selectedItem?.content ?? "");
    setEditSapObjects(selectedItem?.sapObjects.join(" ") ?? "");
    setEditEffectiveFrom(selectedItem?.effectiveFrom ?? "");
    setEditEffectiveTo(selectedItem?.effectiveTo ?? "");
    setEditNote("");
  }, [selectedItem?.id, selectedItem?.updatedAt]);

  const selectedImportedCandidate = selectedItem ? isPhase16LocalTextImportCandidate(selectedItem) : false;
  const selectedCaseGeneratedCandidate = selectedItem ? isCaseGeneratedKnowledgeCandidate(selectedItem) : false;
  const selectedEditedCandidate = selectedItem ? isPhase21EditedCandidate(selectedItem) : false;
  const selectedRequiresReviewGate = selectedImportedCandidate || selectedCaseGeneratedCandidate || selectedEditedCandidate;
  const selectedHasReview = selectedItem ? hasCompleteReview(selectedItem) : false;
  const selectedHasReusableReview = selectedItem ? hasReusableReviewRecord(selectedItem) : false;
  const selectedHasBlockingConflict = selectedItem ? selectedItem.status === "conflicted" || selectedItem.conflictWithIds.length > 0 : false;
  const canReviewSelected = Boolean(selectedItem && selectedRequiresReviewGate && selectedItem.status === "pending" && !selectedHasBlockingConflict && !busyItemId);
  const canEditSelected = Boolean(selectedItem && (selectedItem.status === "draft" || selectedItem.status === "pending" || selectedItem.status === "conflicted") && !busyItemId);
  const reviewReady = reviewNote.trim().length >= 8 && reviewChecklistComplete(reviewChecklist);
  const editReady = editTitle.trim().length > 0 && editSummary.trim().length > 0 && editContent.trim().length > 0 && editNote.trim().length >= 6;
  const publishDisabled = Boolean(
    !selectedItem ||
    busyItemId === selectedItem.id ||
    selectedItem.status === "published" ||
    selectedItem.status === "conflicted" ||
    selectedItem.status === "expired" ||
    selectedItem.conflictWithIds.length > 0 ||
    (selectedRequiresReviewGate && !selectedHasReview)
  );
  const attachDisabled = Boolean(!selectedItem || selectedItem.status !== "published" || !selectedHasReusableReview || busyItemId === selectedItem.id);

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

  async function runAttachToCase(item: KnowledgeItem) {
    if (!project || busyItemId || item.status !== "published") return;
    setBusyItemId(item.id);
    try {
      await onAttachToCurrentCase(project.id, { itemId: item.id, note: "reference published knowledge in current case" });
    } finally {
      setBusyItemId("");
    }
  }

  async function runReview(item: KnowledgeItem) {
    if (!project || busyItemId || !canReviewSelected || !reviewReady) return;
    setBusyItemId(item.id);
    try {
      await onReview(project.id, {
        itemId: item.id,
        note: reviewNote.trim(),
        checklist: reviewChecklist
      });
    } finally {
      setBusyItemId("");
    }
  }

  async function runEdit(item: KnowledgeItem) {
    if (!project || busyItemId || !canEditSelected || !editReady) return;
    setBusyItemId(item.id);
    try {
      const sapObjects = editSapObjects.split(/[\s,，;；]+/).map((value) => value.trim()).filter(Boolean);
      const ok = await onEdit(project.id, {
        itemId: item.id,
        title: editTitle,
        summary: editSummary,
        content: editContent,
        sapObjects,
        effectiveFrom: editEffectiveFrom || null,
        effectiveTo: editEffectiveTo || null,
        note: editNote
      });
      if (ok) {
        setSelectedStatus("pending");
        setSelectedItemId(item.id);
      }
    } finally {
      setBusyItemId("");
    }
  }

  function restoreEditFields(item: KnowledgeItem) {
    setEditTitle(item.title);
    setEditSummary(item.summary);
    setEditContent(item.content);
    setEditSapObjects(item.sapObjects.join(" "));
    setEditEffectiveFrom(item.effectiveFrom ?? "");
    setEditEffectiveTo(item.effectiveTo ?? "");
    setEditNote("");
  }

  async function runTextFileImport() {
    if (!project || importFileBusy) return;
    setImportFileBusy(true);
    setImportFileStatus("正在检查文件内容是否安全。");
    try {
      const result = await onImportTextFile(project.id);
      if (!result) {
        setImportFileStatus("导入未完成。");
      } else if (result.cancelled) {
        setImportFileStatus(result.message);
      } else {
        setSelectedStatus("pending");
        setSelectedItemId(result.knowledgeItemId);
        setImportFileStatus(`${result.file.sourceName} 已生成待确认候选，${result.file.sizeBytes} 字节，${result.file.characterCount} 字。`);
      }
    } finally {
      setImportFileBusy(false);
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || importBusy) return;
    setImportBusy(true);
    try {
      const sapObjects = importSapObjects.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
      const ok = await onImport({
        projectId: project.id,
        title: importTitle,
        sourceKind: importSourceKind,
        sourceName: importSourceName,
        body: importBody,
        sapObjects
      });
      if (ok) {
        setImportTitle("");
        setImportBody("");
        setImportSapObjects("");
        setSelectedStatus("pending");
      }
    } finally {
      setImportBusy(false);
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
          <button disabled={importFileBusy} title="选择一个 Markdown 或 TXT 文件，检查后生成待确认知识候选" onClick={() => void runTextFileImport()}><FileText size={16} />导入 Markdown/TXT</button>
          <button disabled title="当前不读取 QA 表格文件"><Archive size={16} />QA 表读取关闭</button>
          <button disabled title="当前不调用飞书同步"><FileText size={16} />飞书同步关闭</button>
          <label>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题、SAP对象、文档、逻辑图、QA" />
          </label>
        </section>
        <p className="knowledge-action-note">当前只支持单个 Markdown/TXT 小文件或粘贴已脱敏文本；不会保存绝对路径，不会连接飞书，不会自动正式入库。</p>
        {importFileStatus ? <p className="knowledge-file-import-status">{importFileStatus}</p> : null}

        <form className="knowledge-import-form" onSubmit={submitImport}>
          <div className="knowledge-import-fields">
            <label>
              <span>知识标题</span>
              <input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} placeholder="例如：采购订单审批口径" />
            </label>
            <label>
              <span>来源类型</span>
              <select value={importSourceKind} onChange={(event) => setImportSourceKind(event.target.value as KnowledgeImportLocalTextInput["sourceKind"])}>
                {Object.entries(sourceKindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>来源名称</span>
              <input value={importSourceName} onChange={(event) => setImportSourceName(event.target.value)} placeholder="例如：会议纪要摘录" />
            </label>
            <label>
              <span>SAP 对象</span>
              <input value={importSapObjects} onChange={(event) => setImportSapObjects(event.target.value)} placeholder="可选，用空格分隔" />
            </label>
          </div>
          <label className="knowledge-import-body">
            <span>待确认文本</span>
            <textarea value={importBody} onChange={(event) => setImportBody(event.target.value)} placeholder="粘贴已脱敏的业务结论、QA 文本或 Markdown 摘录" />
          </label>
          <div className="knowledge-import-footer">
            <span>当前只生成待确认候选，不会直接进入正式知识库。</span>
            <button disabled={importBusy || !importTitle.trim() || !importSourceName.trim() || !importBody.trim()} type="submit"><ShieldCheck size={16} />生成候选</button>
          </div>
        </form>

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
                <small>{item.confidence !== null ? `置信度 ${Math.round(item.confidence * 100)}%` : item.status === "pending" ? "待人工判断" : "人工维护"}</small>
              </button>
            )) : <div className="empty-state">没有匹配的知识项。</div>}
          </div>
        </section>

        <section className="knowledge-parser-queue">
          <h2>候选处理队列</h2>
          <p>这里只显示本地待确认候选，不代表已经读取真实文件或连接飞书。</p>
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
                <div><dt>SAP对象</dt><dd>{selectedItem.sapObjects.length ? selectedItem.sapObjects.join("、") : "未绑定"}</dd></div>
                <div><dt>生效时间</dt><dd>{selectedItem.effectiveFrom ?? "待确认"}</dd></div>
                <div><dt>更新时间</dt><dd>{formatTime(selectedItem.updatedAt)}</dd></div>
                <div><dt>审核状态</dt><dd>{selectedHasReview ? `${selectedItem.reviewer} · ${formatTime(selectedItem.reviewedAt)}` : "未审核"}</dd></div>
              </dl>
            </section>

            <section>
              <h3>内容预览</h3>
              <p>{selectedItem.content}</p>
            </section>

            {canEditSelected ? (
              <section className="knowledge-edit-form">
                <div className="knowledge-edit-heading">
                  <h3>修改候选</h3>
                  <span>保存后需要重新审核</span>
                </div>
                {selectedItem.status === "conflicted" ? <p className="knowledge-edit-warning">改完后会回到待确认，仍需重新审核后才能入库。</p> : null}
                <label>
                  <span>知识标题</span>
                  <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                </label>
                <label>
                  <span>摘要</span>
                  <textarea value={editSummary} onChange={(event) => setEditSummary(event.target.value)} />
                </label>
                <label>
                  <span>正文</span>
                  <textarea className="knowledge-edit-content" value={editContent} onChange={(event) => setEditContent(event.target.value)} />
                </label>
                <label>
                  <span>SAP对象</span>
                  <input value={editSapObjects} onChange={(event) => setEditSapObjects(event.target.value)} placeholder="用空格分隔" />
                </label>
                <div className="knowledge-edit-dates">
                  <label>
                    <span>生效时间</span>
                    <input type="date" value={editEffectiveFrom} onChange={(event) => setEditEffectiveFrom(event.target.value)} />
                  </label>
                  <label>
                    <span>失效时间</span>
                    <input type="date" value={editEffectiveTo} onChange={(event) => setEditEffectiveTo(event.target.value)} />
                  </label>
                </div>
                <label>
                  <span>修改说明</span>
                  <textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} placeholder="说明改了什么，至少 6 个字" />
                </label>
                <div className="knowledge-edit-actions">
                  <button disabled={!editReady || busyItemId === selectedItem.id} onClick={() => void runEdit(selectedItem)}><Save size={16} />保存为待确认</button>
                  <button disabled={busyItemId === selectedItem.id} onClick={() => restoreEditFields(selectedItem)}><RefreshCcw size={16} />重置</button>
                </div>
              </section>
            ) : null}

            {selectedRequiresReviewGate ? (
              <section className="knowledge-review-gate">
                <div className="knowledge-review-heading">
                  <h3>人工审核门</h3>
                  {selectedHasReview ? <span><ShieldCheck size={14} />已审核</span> : <span><ShieldAlert size={14} />待审核</span>}
                </div>
                <div className="knowledge-review-checks">
                  {reviewChecklistLabels.map((check) => (
                    <label key={check.id}>
                      <input
                        checked={reviewChecklist[check.id]}
                        disabled={!canReviewSelected}
                        type="checkbox"
                        onChange={(event) => setReviewChecklist((current) => ({ ...current, [check.id]: event.target.checked }))}
                      />
                      <span>{check.label}</span>
                    </label>
                  ))}
                </div>
                <label className="knowledge-review-note">
                  <span>审核备注</span>
                  <textarea
                    value={reviewNote}
                    disabled={!canReviewSelected}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="说明为什么这条候选可以进入正式知识库"
                  />
                </label>
                {selectedItem.reviewNote ? <p className="knowledge-review-existing">已记录：{selectedItem.reviewNote}</p> : null}
                <button disabled={!canReviewSelected || !reviewReady} onClick={() => void runReview(selectedItem)}>
                  <ShieldCheck size={16} />记录审核
                </button>
              </section>
            ) : null}

            {selectedItem.status === "conflicted" ? (
              <section className="knowledge-warning">
                <ShieldAlert size={16} />
                <span>该知识存在适用范围或结论冲突，不能直接覆盖已发布知识。</span>
              </section>
            ) : null}

            <section className="knowledge-detail-actions">
              <button disabled={attachDisabled} title="只有已发布且已人工审核的知识才能加入当前案件上下文" onClick={() => void runAttachToCase(selectedItem)}><FileText size={16} />加入当前案件上下文</button>
              <button disabled={publishDisabled} title={selectedRequiresReviewGate && !selectedHasReview ? "该候选必须先记录人工审核" : selectedHasBlockingConflict ? "冲突知识不能直接确认入库" : "人工确认后才会发布"} onClick={() => void runAction("publish", selectedItem)}><CheckCircle2 size={16} />确认入库</button>
              <button disabled={busyItemId === selectedItem.id || selectedItem.status === "published" || selectedItem.status === "conflicted" || selectedItem.status === "expired"} onClick={() => void runAction("conflict", selectedItem)}><ShieldAlert size={16} />标记冲突</button>
              <button disabled={busyItemId === selectedItem.id || selectedItem.status === "published" || selectedItem.status === "expired"} onClick={() => void runAction("expire", selectedItem)}><XCircle size={16} />标记失效</button>
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
