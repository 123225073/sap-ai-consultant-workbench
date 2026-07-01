import { useEffect, useState } from "react";
import { ArrowLeft, Database, KeyRound, Lock, PlugZap, Save, ShieldCheck, Terminal, Workflow } from "lucide-react";
import type { AdtVerificationReport, ApiProviderConfig, ConfigStatus, ProjectConfig, ProjectSecretInput, ProjectSummary, SecretHandle } from "../shared/workbenchTypes";

const statusLabels: Record<ConfigStatus, string> = {
  "not-configured": "未配置",
  saved: "配置草稿",
  "pending-verification": "待只读验证",
  verified: "只读验证通过",
  failed: "检查失败"
};

function cloneConfig(config: ProjectConfig): ProjectConfig {
  return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}

function statusTone(status: ConfigStatus): "neutral" | "blue" | "orange" | "green" {
  if (status === "verified") return "green";
  if (status === "saved") return "blue";
  if (status === "pending-verification" || status === "failed") return "orange";
  return "neutral";
}

function ConfigStatusPill({ status }: { status: ConfigStatus }) {
  return <span className={`status-pill status-${statusTone(status)}`}>{statusLabels[status]}</span>;
}

function SecretStatusPill({ handle }: { handle: SecretHandle }) {
  if (handle.state === "set-in-secure-store") {
    return <span className="status-pill status-blue">已安全保存，未验证</span>;
  }
  if (handle.state === "failed" || handle.state === "missing" || handle.state === "needs-rotation") {
    return <span className="status-pill status-orange">需要重新保存</span>;
  }
  return <span className="status-pill status-neutral">未保存密钥</span>;
}

function formatSavedAt(value: string | null): string {
  if (!value) return "尚未保存";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "已保存";
  return `保存于 ${date.toLocaleString("zh-CN", { hour12: false })}`;
}

function formatCheckedAt(value: string | null): string {
  if (!value) return "尚未执行验证";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未执行验证";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function disabledReason(label: string) {
  return `${label} · 待后续真实接入`;
}

function firstProvider(config: ProjectConfig): ApiProviderConfig {
  return config.apiProviders[0];
}

function stepStatusFromConfig(status: ConfigStatus): "passed" | "failed" | "skipped" {
  if (status === "verified") return "passed";
  if (status === "failed") return "failed";
  return "skipped";
}

function stepLabel(status: "passed" | "failed" | "skipped"): string {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  return "待验证";
}

function AdtVerificationReportView({ config, report }: { config: ProjectConfig; report: AdtVerificationReport | null }) {
  const steps = report?.steps ?? [
    {
      id: "config" as const,
      title: "配置检查",
      status: stepStatusFromConfig(config.adt.configStatus),
      detail: "检查 URL、Client、用户、语言、SSL、只读开关和安全密钥引用。",
      checkedAt: config.adt.lastCheckedAt ?? ""
    },
    {
      id: "status" as const,
      title: "ADT status",
      status: stepStatusFromConfig(config.adt.connectionStatus),
      detail: "status 通过只表示连接状态可检查，还不能代表 T000 读取成功。",
      checkedAt: config.adt.lastCheckedAt ?? ""
    },
    {
      id: "t000" as const,
      title: "T000 最小读取",
      status: stepStatusFromConfig(config.adt.minimalReadStatus),
      detail: "只有固定 T000 最小读取成功，才允许标记只读验证通过。",
      checkedAt: config.adt.lastCheckedAt ?? ""
    }
  ];
  const firstError = report?.errors[0];
  const system = report?.system;

  return (
    <div className="adt-verification-report">
      <div className="verification-steps">
        {steps.map((item) => (
          <div className={`verification-step step-${item.status}`} key={item.id}>
            <span>{item.title}</span>
            <strong>{stepLabel(item.status)}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>

      <dl className="verification-details">
        <div>
          <dt>系统别名</dt>
          <dd>{system?.alias || config.adt.alias || "未填写"}</dd>
        </div>
        <div>
          <dt>SAP 主机</dt>
          <dd>{system?.endpointHost || "执行验证后显示脱敏主机"}</dd>
        </div>
        <div>
          <dt>Client</dt>
          <dd>{system?.client || config.adt.client || "未填写"}</dd>
        </div>
        <div>
          <dt>用户</dt>
          <dd>{system?.usernameMasked || (config.adt.username ? "验证后脱敏显示" : "未填写")}</dd>
        </div>
        <div>
          <dt>SSL 模式</dt>
          <dd>{(system?.sslMode ?? config.adt.sslMode) === "skip-certificate" ? "跳过证书校验" : "严格校验"}</dd>
        </div>
        <div>
          <dt>写入模式</dt>
          <dd>锁定只读</dd>
        </div>
        <div>
          <dt>传输写入</dt>
          <dd>禁用</dd>
        </div>
        <div>
          <dt>最小读取对象</dt>
          <dd>T000</dd>
        </div>
        <div>
          <dt>最后验证时间</dt>
          <dd>{formatCheckedAt(report?.checkedAt ?? config.adt.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>验证结论</dt>
          <dd>{report ? (report.ok ? "T000 最小读取通过，当前只读链路可用。" : "未通过，不能标记为只读验证通过。") : "尚未执行本轮验证。"}</dd>
        </div>
      </dl>

      {firstError ? (
        <div className="verification-error">
          <strong>{firstError.message}</strong>
          <span>{firstError.suggestion}</span>
        </div>
      ) : null}
    </div>
  );
}

interface ConfigCenterProps {
  project?: ProjectSummary;
  notice: string;
  onBack: () => void;
  onSave: (projectId: string, config: ProjectConfig) => Promise<void>;
  onSaveSecret: (projectId: string, input: ProjectSecretInput) => Promise<boolean>;
  onVerifyAdt: (projectId: string) => Promise<AdtVerificationReport | null>;
}

function ConfigCenter({ project, notice, onBack, onSave, onSaveSecret, onVerifyAdt }: ConfigCenterProps) {
  const [draft, setDraft] = useState<ProjectConfig | null>(project ? cloneConfig(project.config) : null);
  const [adtEntry, setAdtEntry] = useState("");
  const [apiEntry, setApiEntry] = useState("");
  const [adtReport, setAdtReport] = useState<AdtVerificationReport | null>(null);
  const [verifyingAdt, setVerifyingAdt] = useState(false);

  useEffect(() => {
    setDraft(project ? cloneConfig(project.config) : null);
    setAdtEntry("");
    setApiEntry("");
  }, [project?.id, project?.config.updatedAt]);

  useEffect(() => {
    setAdtReport(null);
  }, [project?.id]);

  if (!project || !draft) {
    return (
      <section className="config-workspace">
        <div className="config-main">
          <div className="config-heading">
            <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
            <div>
              <h1>配置中心</h1>
              <p>请先创建或选择一个本地项目。</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const provider = firstProvider(draft);

  function saveDraft() {
    if (draft && project) void onSave(project.id, draft);
  }

  function updateDraft(updater: (config: ProjectConfig) => ProjectConfig) {
    setDraft((current) => current ? updater(current) : current);
  }

  function updateAdt(field: keyof ProjectConfig["adt"], value: string) {
    updateDraft((current) => ({ ...current, adt: { ...current.adt, [field]: value } }));
  }

  function updateFeishu(field: keyof ProjectConfig["feishu"], value: string) {
    updateDraft((current) => ({ ...current, feishu: { ...current.feishu, [field]: value } }));
  }

  function updateCodex(field: keyof ProjectConfig["codex"], value: string) {
    updateDraft((current) => ({ ...current, codex: { ...current.codex, [field]: value } }));
  }

  function updateProvider(field: keyof ApiProviderConfig, value: string | boolean) {
    updateDraft((current) => {
      const currentProvider = firstProvider(current);
      const nextProvider = { ...currentProvider, [field]: value };
      return { ...current, apiProviders: [nextProvider, ...current.apiProviders.slice(1)] };
    });
  }

  async function saveAdtSecret() {
    if (!project || !adtEntry) return;
    const saved = await onSaveSecret(project.id, { target: { kind: "adt-password" }, value: adtEntry });
    if (saved) setAdtEntry("");
  }

  async function verifyAdt() {
    if (!project || verifyingAdt) return;
    setVerifyingAdt(true);
    try {
      const report = await onVerifyAdt(project.id);
      if (report) setAdtReport(report);
    } finally {
      setVerifyingAdt(false);
    }
  }

  async function saveApiSecret() {
    if (!project || !apiEntry) return;
    const saved = await onSaveSecret(project.id, { target: { kind: "api-key", providerId: provider.id }, value: apiEntry });
    if (saved) setApiEntry("");
  }

  return (
    <section className="config-workspace">
      <div className="config-main">
        <div className="config-heading">
          <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
          <div>
            <h1>配置中心</h1>
            <p>{project.name} · 当前项目配置 · ADT 只读验证按项目执行</p>
          </div>
        </div>

        <div className="phase-notice config-notice">
          <ShieldCheck size={16} />
          <span>{notice}</span>
        </div>

        <section className="config-section">
          <div className="config-section-title">
            <Workflow size={18} />
            <div>
              <h2>项目概览</h2>
              <p>配置只作用于当前项目，不是全局配置。</p>
            </div>
          </div>
          <div className="config-fields two-columns">
            <label>
              <span>项目名称</span>
              <input value={project.name} readOnly />
            </label>
            <label>
              <span>系统标签</span>
              <input value={project.systemLabel} readOnly />
            </label>
            <label>
              <span>SAP 版本</span>
              <input value={project.sapVersion} readOnly />
            </label>
            <label>
              <span>配置状态</span>
              <div className="readonly-row"><ConfigStatusPill status={draft.adt.configStatus} /></div>
            </label>
          </div>
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <PlugZap size={18} />
            <div>
              <h2>ADT 连接</h2>
              <p>只保存 URL、Client、用户等非密钥草稿；SAP 默认只读。</p>
            </div>
          </div>
          <div className="config-fields two-columns">
            <label>
              <span>系统别名</span>
              <input value={draft.adt.alias} onChange={(event) => updateAdt("alias", event.target.value)} />
            </label>
            <label>
              <span>SAP URL</span>
              <input value={draft.adt.url} onChange={(event) => updateAdt("url", event.target.value)} />
            </label>
            <label>
              <span>Client</span>
              <input value={draft.adt.client} onChange={(event) => updateAdt("client", event.target.value)} />
            </label>
            <label>
              <span>用户</span>
              <input value={draft.adt.username} onChange={(event) => updateAdt("username", event.target.value)} />
            </label>
            <label>
              <span>语言</span>
              <input value={draft.adt.language} onChange={(event) => updateAdt("language", event.target.value)} />
            </label>
            <label>
              <span>SSL 模式</span>
              <select value={draft.adt.sslMode} onChange={(event) => updateAdt("sslMode", event.target.value)}>
                <option value="strict">严格校验</option>
                <option value="skip-certificate">跳过证书校验</option>
              </select>
            </label>
            <label>
              <span>写入模式</span>
              <input value="锁定只读" readOnly />
            </label>
            <label>
              <span>连接状态</span>
              <div className="readonly-row"><ConfigStatusPill status={draft.adt.connectionStatus} /></div>
            </label>
            <label>
              <span>T000 最小读取</span>
              <div className="readonly-row"><ConfigStatusPill status={draft.adt.minimalReadStatus} /></div>
            </label>
            <label>
              <span>最后验证时间</span>
              <input value={formatCheckedAt(draft.adt.lastCheckedAt)} readOnly />
            </label>
            <label>
              <span>SAP 密钥状态</span>
              <div className="readonly-row"><SecretStatusPill handle={draft.adt.credential} /></div>
            </label>
            <label>
              <span>密钥保存时间</span>
              <input value={formatSavedAt(draft.adt.credential.updatedAt)} readOnly />
            </label>
            <label className="secret-entry">
              <span>SAP 密码</span>
              <input type="password" value={adtEntry} onChange={(event) => setAdtEntry(event.target.value)} placeholder="输入后保存到系统安全存储，不会回显" />
            </label>
          </div>
          <div className="config-actions">
            <button onClick={saveDraft}><Save size={16} />保存非密钥草稿</button>
            <button onClick={() => void saveAdtSecret()} disabled={!adtEntry} title="只保存到系统安全存储，不执行连接验证"><Lock size={16} />{draft.adt.credential.state === "set-in-secure-store" ? "替换安全密钥" : "保存到系统安全存储"}</button>
            <button onClick={() => void verifyAdt()} disabled={verifyingAdt} title="执行配置检查、ADT status 和固定 T000 最小读取"><PlugZap size={16} />{verifyingAdt ? "验证中" : "执行只读验证"}</button>
          </div>
          <AdtVerificationReportView config={draft} report={adtReport} />
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <Terminal size={18} />
            <div>
              <h2>飞书 CLI</h2>
              <p>只记录 CLI 路径和 Profile；不会读取或保存授权值。</p>
            </div>
          </div>
          <div className="config-fields two-columns">
            <label>
              <span>CLI 路径</span>
              <input value={draft.feishu.cliPath} onChange={(event) => updateFeishu("cliPath", event.target.value)} />
            </label>
            <label>
              <span>Profile</span>
              <input value={draft.feishu.profile} onChange={(event) => updateFeishu("profile", event.target.value)} />
            </label>
            <label>
              <span>授权状态</span>
              <div className="readonly-row"><ConfigStatusPill status={draft.feishu.authStatus} /></div>
            </label>
            <label>
              <span>文档权限</span>
              <div className="readonly-row"><ConfigStatusPill status={draft.feishu.docPermissionStatus} /></div>
            </label>
          </div>
          <div className="config-actions">
            <button onClick={saveDraft}><Save size={16} />保存非密钥草稿</button>
            <button disabled title={disabledReason("验证飞书授权")}><Terminal size={16} />验证飞书</button>
          </div>
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <KeyRound size={18} />
            <div>
              <h2>API 与模型</h2>
              <p>只保存渠道类型和 Base URL；不保存 Key，不拉模型列表。</p>
            </div>
          </div>
          <div className="config-fields two-columns">
            <label>
              <span>渠道名称</span>
              <input value={provider.name} onChange={(event) => updateProvider("name", event.target.value)} />
            </label>
            <label>
              <span>渠道类型</span>
              <select value={provider.providerType} onChange={(event) => updateProvider("providerType", event.target.value)}>
                <option value="openai-compatible">OpenAI 兼容</option>
                <option value="deepseek">DeepSeek</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <label>
              <span>Base URL</span>
              <input value={provider.baseUrl} onChange={(event) => updateProvider("baseUrl", event.target.value)} />
            </label>
            <label className="checkbox-row">
              <span>启用草稿</span>
              <input type="checkbox" checked={provider.enabled} onChange={(event) => updateProvider("enabled", event.target.checked)} />
            </label>
            <label>
              <span>模型列表</span>
              <div className="readonly-row"><ConfigStatusPill status={provider.modelSyncStatus} /></div>
            </label>
            <label>
              <span>最小对话测试</span>
              <div className="readonly-row"><ConfigStatusPill status={provider.chatTestStatus} /></div>
            </label>
            <label>
              <span>API Key 状态</span>
              <div className="readonly-row"><SecretStatusPill handle={provider.credential} /></div>
            </label>
            <label>
              <span>密钥保存时间</span>
              <input value={formatSavedAt(provider.credential.updatedAt)} readOnly />
            </label>
            <label className="secret-entry">
              <span>API Key</span>
              <input type="password" value={apiEntry} onChange={(event) => setApiEntry(event.target.value)} placeholder="输入后保存到系统安全存储，不会回显" />
            </label>
          </div>
          <div className="config-actions">
            <button onClick={saveDraft}><Save size={16} />保存非密钥草稿</button>
            <button onClick={() => void saveApiSecret()} disabled={!apiEntry} title="只保存到系统安全存储，不获取模型列表"><Lock size={16} />{provider.credential.state === "set-in-secure-store" ? "替换安全密钥" : "保存到系统安全存储"}</button>
            <button disabled title={disabledReason("获取模型列表")}><KeyRound size={16} />获取模型</button>
          </div>
        </section>

        <section className="config-section">
          <div className="config-section-title">
            <Terminal size={18} />
            <div>
              <h2>Codex 能力</h2>
              <p>当前只描述接入边界，不读取 Codex App 聊天记录。</p>
            </div>
          </div>
          <div className="config-fields two-columns">
            <label>
              <span>接入方式</span>
              <select value={draft.codex.integrationType} onChange={(event) => updateCodex("integrationType", event.target.value)}>
                <option value="cli">CLI</option>
                <option value="sdk">SDK</option>
              </select>
            </label>
            <label>
              <span>执行路径</span>
              <input value={draft.codex.executablePath} onChange={(event) => updateCodex("executablePath", event.target.value)} />
            </label>
            <label>
              <span>CLI 状态</span>
              <div className="readonly-row"><ConfigStatusPill status={draft.codex.cliStatus} /></div>
            </label>
            <label>
              <span>只读任务状态</span>
              <div className="readonly-row"><ConfigStatusPill status={draft.codex.readonlyTaskStatus} /></div>
            </label>
          </div>
          <div className="config-actions">
            <button onClick={saveDraft}><Save size={16} />保存非密钥草稿</button>
            <button disabled title={disabledReason("测试 Codex")}><Terminal size={16} />测试 Codex</button>
          </div>
        </section>

        <section className="config-section last">
          <div className="config-section-title">
            <Database size={18} />
            <div>
              <h2>本地存储</h2>
              <p>当前使用本地 JSON；SQLite 留到后续阶段。</p>
            </div>
          </div>
          <div className="config-fields">
            <label>
              <span>工作区</span>
              <input value={draft.localStorage.workspaceRoot} readOnly />
            </label>
            <label>
              <span>项目目录</span>
              <input value={draft.localStorage.projectDir} readOnly />
            </label>
            <label>
              <span>案件目录</span>
              <input value={draft.localStorage.casesDir} readOnly />
            </label>
            <label>
              <span>状态文件</span>
              <input value={draft.localStorage.stateJsonPath} readOnly />
            </label>
          </div>
        </section>
      </div>

      <aside className="config-side">
        <section>
          <h2>安全边界</h2>
          <ul>
            <li>SAP 密码和 API Key 只进系统安全存储。</li>
            <li>项目配置只保存安全引用，不保存明文密钥。</li>
            <li>ADT 写入模式锁定为只读。</li>
            <li>保存密钥不代表连接已通过检查。</li>
            <li>T000 最小读取通过后，才显示只读验证通过。</li>
          </ul>
        </section>
        <section>
          <h2>验证边界</h2>
          <ul>
            <li>ADT：最小读取成功后才可改变状态。</li>
            <li>飞书：CLI 与权限都要单独验证。</li>
            <li>模型：模型列表和最小对话分开验证。</li>
            <li>Codex：只允许明确白名单能力。</li>
          </ul>
        </section>
        <section>
          <h2>密钥策略</h2>
          <p>Phase 2B 允许录入密钥，但只会交给主进程加密保存。界面不会回显密钥，也不会把密钥写入项目文件。</p>
        </section>
      </aside>
    </section>
  );
}

export default ConfigCenter;
