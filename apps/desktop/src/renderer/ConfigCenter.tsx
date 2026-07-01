import { useEffect, useState } from "react";
import { ArrowLeft, Check, Database, KeyRound, Lock, PlugZap, Save, ShieldCheck, Terminal, Workflow } from "lucide-react";
import type { ApiProviderConfig, ConfigStatus, ProjectConfig, ProjectSummary } from "../shared/workbenchTypes";

const statusLabels: Record<ConfigStatus, string> = {
  "not-configured": "未配置",
  saved: "配置草稿",
  "pending-verification": "待真实验证",
  failed: "检查失败"
};

function cloneConfig(config: ProjectConfig): ProjectConfig {
  return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}

function statusTone(status: ConfigStatus): "neutral" | "blue" | "orange" {
  if (status === "saved") return "blue";
  if (status === "pending-verification" || status === "failed") return "orange";
  return "neutral";
}

function ConfigStatusPill({ status }: { status: ConfigStatus }) {
  return <span className={`status-pill status-${statusTone(status)}`}>{statusLabels[status]}</span>;
}

function disabledReason(label: string) {
  return `${label} · 待后续真实接入`;
}

function firstProvider(config: ProjectConfig): ApiProviderConfig {
  return config.apiProviders[0];
}

interface ConfigCenterProps {
  project?: ProjectSummary;
  notice: string;
  onBack: () => void;
  onSave: (projectId: string, config: ProjectConfig) => Promise<void>;
}

function ConfigCenter({ project, notice, onBack, onSave }: ConfigCenterProps) {
  const [draft, setDraft] = useState<ProjectConfig | null>(project ? cloneConfig(project.config) : null);

  useEffect(() => {
    setDraft(project ? cloneConfig(project.config) : null);
  }, [project?.id, project?.config.updatedAt]);

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

  return (
    <section className="config-workspace">
      <div className="config-main">
        <div className="config-heading">
          <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
          <div>
            <h1>配置中心</h1>
            <p>{project.name} · 当前项目配置 · 真实连接验证未执行</p>
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
          </div>
          <div className="config-actions">
            <button onClick={saveDraft}><Save size={16} />保存非密钥草稿</button>
            <button disabled title={disabledReason("测试 ADT 连接")}><PlugZap size={16} />测试连接</button>
            <button disabled title={disabledReason("读取 T000")}><Check size={16} />读取 T000</button>
          </div>
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
          </div>
          <div className="config-actions">
            <button onClick={saveDraft}><Save size={16} />保存非密钥草稿</button>
            <button disabled title={disabledReason("保存 API Key")}><Lock size={16} />保存密钥</button>
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
            <li>不保存 SAP 密码、API Key、飞书授权值。</li>
            <li>ADT 写入模式锁定为只读。</li>
            <li>保存成功只代表草稿已落盘。</li>
            <li>真实验证要等后续阶段接入。</li>
          </ul>
        </section>
        <section>
          <h2>待接入验证</h2>
          <ul>
            <li>ADT：最小读取成功后才可改变状态。</li>
            <li>飞书：CLI 与权限都要单独验证。</li>
            <li>模型：模型列表和最小对话分开验证。</li>
            <li>Codex：只允许明确白名单能力。</li>
          </ul>
        </section>
        <section>
          <h2>密钥策略</h2>
          <p>Phase 2 不接收密钥。后续只能把密钥放进系统安全存储，本地配置最多保存无意义引用。</p>
        </section>
      </aside>
    </section>
  );
}

export default ConfigCenter;
