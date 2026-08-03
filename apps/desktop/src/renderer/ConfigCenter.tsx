import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Archive, ArrowLeft, ChevronDown, Database, Download, ExternalLink, Eye, EyeOff, FolderInput, KeyRound, PlugZap, Plus, RefreshCw, Save, Search, ShieldCheck, Terminal, Trash2, Workflow } from "lucide-react";
import type { AdtConfig, AdtVerificationReport, ApiProviderConfig, CodexCapabilitySummary, CodexVerificationReport, ConfigStatus, FeishuCliDiscoveryReport, FeishuCliInstallResult, FeishuCliProfileSetupResult, FeishuCliProfileSummary, FeishuVerificationReport, LocalAiInstallResult, LocalAiScanResult, ModelCapability, ModelProviderVerificationReport, ProjectConfig, ProjectSecretInput, ProjectSummary, SapGuiDiscoveryEntry, SapGuiDiscoveryReport, SapSystemEnvironment, SecretHandle, WorkspaceBackupResult, WorkspaceImportResult } from "../shared/workbenchTypes";
import { matchesDiscoveredSapEndpoint } from "../shared/sapConnectionRouting";

const statusLabels: Record<ConfigStatus, string> = {
  "not-configured": "未配置",
  saved: "配置草稿",
  "pending-verification": "待验证",
  verified: "上次检查通过",
  failed: "检查失败"
};

function cloneConfig(config: ProjectConfig): ProjectConfig {
  return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}

export type ProjectConfigSection = "adt" | "models" | "tools" | "feishu" | "codex";

interface PendingProjectConfigSectionSave {
  section: ProjectConfigSection;
  submittedConfig: ProjectConfig;
}

const PROJECT_CONFIG_SECTIONS: ProjectConfigSection[] = ["adt", "models", "tools", "feishu", "codex"];

function sectionValue(config: ProjectConfig, section: ProjectConfigSection): unknown {
  if (section === "adt") return { adt: config.adt, adtConnections: config.adtConnections, activeAdtConnectionId: config.activeAdtConnectionId };
  if (section === "models") return config.apiProviders;
  if (section === "tools") return config.agentTools;
  if (section === "feishu") return config.feishu;
  return config.codex;
}

function sectionChanged(savedConfig: ProjectConfig, draftConfig: ProjectConfig, section: ProjectConfigSection): boolean {
  return JSON.stringify(sectionValue(savedConfig, section)) !== JSON.stringify(sectionValue(draftConfig, section));
}

export function mergeProjectConfigSection(savedConfig: ProjectConfig, draftConfig: ProjectConfig, section: ProjectConfigSection): ProjectConfig {
  const merged = cloneConfig(savedConfig);
  if (section === "adt") {
    const cloned = cloneConfig(draftConfig);
    merged.adt = cloned.adt;
    merged.adtConnections = cloned.adtConnections;
    merged.activeAdtConnectionId = cloned.activeAdtConnectionId;
  }
  if (section === "models") merged.apiProviders = cloneConfig(draftConfig).apiProviders;
  if (section === "tools") merged.agentTools = cloneConfig(draftConfig).agentTools;
  if (section === "feishu") merged.feishu = cloneConfig(draftConfig).feishu;
  if (section === "codex") merged.codex = cloneConfig(draftConfig).codex;
  return merged;
}

export function reconcileProjectConfigDraft(
  previousSavedConfig: ProjectConfig,
  incomingSavedConfig: ProjectConfig,
  currentDraft: ProjectConfig,
  acceptedSection: ProjectConfigSection | null
): ProjectConfig {
  let reconciled = cloneConfig(incomingSavedConfig);
  for (const section of PROJECT_CONFIG_SECTIONS) {
    if (section !== acceptedSection && sectionChanged(previousSavedConfig, currentDraft, section)) {
      reconciled = mergeProjectConfigSection(reconciled, currentDraft, section);
    }
  }
  return reconciled;
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

function FeishuStatusPill({ status, kind }: { status: ConfigStatus; kind: "auth" | "docs" }) {
  const labels: Record<"auth" | "docs", Record<ConfigStatus, string>> = {
    auth: {
      "not-configured": "未配置",
      saved: "配置草稿",
      "pending-verification": "待登录验证",
      verified: "登录检查通过",
      failed: "登录未通过"
    },
    docs: {
      "not-configured": "未配置",
      saved: "配置草稿",
      "pending-verification": "待权限验证",
      verified: "所需 scope 未发现缺失",
      failed: "权限需检查"
    }
  };
  return <span className={`status-pill status-${statusTone(status)}`}>{labels[kind][status]}</span>;
}

function ModelStatusPill({ status }: { status: ConfigStatus }) {
  const labels: Record<ConfigStatus, string> = {
    "not-configured": "未配置",
    saved: "渠道草稿",
    "pending-verification": "待渠道验证",
    verified: "最小测试通过",
    failed: "验证失败"
  };
  return <span className={`status-pill status-${statusTone(status)}`}>{labels[status]}</span>;
}

function SecretStatusPill({ handle }: { handle: SecretHandle }) {
  if (handle.state === "set-in-secure-store") {
    return <span className="status-pill status-blue">已保存</span>;
  }
  if (handle.state === "failed" || handle.state === "missing" || handle.state === "needs-rotation") {
    return <span className="status-pill status-orange">需重新保存</span>;
  }
  return <span className="status-pill status-neutral">未保存</span>;
}

function SecretInput({
  id,
  label,
  value,
  hasValue,
  inputRef,
  saved,
  show,
  onChange,
  onToggle,
  placeholder,
  revealLabel,
  hideLabel
}: {
  id: string;
  label: string;
  value?: string;
  hasValue?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  saved: boolean;
  show: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  placeholder: string;
  revealLabel: string;
  hideLabel: string;
}) {
  const containsValue = value !== undefined ? value.length > 0 : hasValue === true;
  const toggleLabel = containsValue
    ? show ? hideLabel : revealLabel
    : saved ? "已保存密钥不可回显；输入新值后可显示" : revealLabel;
  return (
    <label className="secret-entry" htmlFor={id}>
      <span>{label}</span>
      <div className="secret-input-wrap phase27-secret-eye-toggle">
        <input
          id={id}
          ref={inputRef}
          type={show ? "text" : "password"}
          {...(value === undefined ? {} : { value })}
          onChange={(event) => onChange(event.target.value)}
          placeholder={saved ? "********" : placeholder}
          autoComplete="new-password"
        />
        <button type="button" className="secret-toggle-button" onClick={onToggle} disabled={!containsValue} aria-label={toggleLabel} title={toggleLabel}>
          {show ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
    </label>
  );
}

function EditableModelSelect({ value, options, onChange, listId }: { value: string; options: string[]; onChange: (value: string) => void; listId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="editable-model-select">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="留空时自动选择，也可以直接输入模型 ID"
        list={listId}
      />
      <button type="button" onClick={() => inputRef.current?.showPicker()} disabled={options.length === 0} title={options.length > 0 ? "打开已获取的模型列表" : "测试渠道后可下拉选择模型"} aria-label="打开模型列表">
        <ChevronDown size={16} />
      </button>
      <datalist id={listId}>
        {options.map((modelId) => <option value={modelId} key={modelId} />)}
      </datalist>
    </div>
  );
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

function capabilityLabel(capability: ModelCapability): string {
  const labels: Record<ModelCapability, string> = {
    chat: "文本",
    vision: "名称含视觉",
    reasoning: "名称含推理",
    tools: "名称含工具",
    web: "名称含联网",
    free: "名称含免费"
  };
  return labels[capability];
}

function codexCapabilityPresentation(capability: CodexCapabilitySummary): { status: string; detail: string } {
  if (capability.id === "task-runner") {
    return capability.status === "verified"
      ? { status: "固定只读试跑通过", detail: "只验证了空临时目录中的固定只读回复任务，不代表任意工程任务都能成功。" }
      : { status: "待只读试跑", detail: "尚未通过固定只读回复任务。" };
  }
  if (capability.id === "mcp" || capability.id === "plugins") {
    const label = capability.id === "mcp" ? "MCP" : "插件";
    return capability.status === "verified"
      ? { status: "仅发现命令入口", detail: `只从 Codex CLI 帮助信息发现 ${label} 入口，本轮没有调用或验证该能力。` }
      : { status: "未发现命令入口", detail: `本轮未在 Codex CLI 帮助信息中发现 ${label} 入口。` };
  }
  return {
    status: "未单独验证",
    detail: "本轮固定只读试跑没有加载或执行任何 Skill，不能据此判断 Skills 能力可用。"
  };
}

function reportModeLabel(mode: "fake" | "cli" | "http" | "adt" | null | undefined): string {
  if (mode === "cli") return "真实 CLI 验证";
  if (mode === "http") return "真实 HTTP 验证";
  if (mode === "adt") return "真实 ADT 验证";
  if (mode === "fake") return "模拟验证";
  return "尚未验证";
}

function modelProviderStatusLabel(provider: ApiProviderConfig): string {
  if (!provider.enabled) return "已停用";
  if (!provider.name.trim() || !provider.baseUrl.trim()) return "待填写";
  if (provider.modelSyncStatus === "failed" || provider.chatTestStatus === "failed") return "测试失败";
  if (provider.lastVerificationMode === "http" && provider.modelSyncStatus === "verified" && provider.chatTestStatus === "verified") {
    return `${provider.models.length} 个模型`;
  }
  if (provider.credential.state === "set-in-secure-store") return "待测试";
  return "待保存密钥";
}

function createAdtConnection(index: number): AdtConfig {
  return {
    id: `adt-${Date.now().toString(36)}-${index}`,
    alias: `SAP 连接 ${index}`,
    systemId: "",
    instanceNumber: "",
    environment: "other",
    usage: "",
    routingKeywords: [],
    url: "",
    client: "",
    username: "",
    language: "ZH",
    sslMode: "skip-certificate",
    readOnly: true,
    credential: {
      kind: "adt-password",
      store: null,
      state: "not-set",
      updatedAt: null
    } as SecretHandle,
    configStatus: "not-configured",
    connectionStatus: "pending-verification",
    minimalReadStatus: "pending-verification",
    lastVerificationMode: null,
    lastCheckedAt: null
  };
}

function inferSapEnvironment(entry: SapGuiDiscoveryEntry): SapSystemEnvironment {
  const value = `${entry.systemId} ${entry.description}`.toUpperCase();
  if (/(^|\W)(PRD|PROD|PS\d|生产)(\W|$)/.test(value)) return "production";
  if (/(^|\W)(QAS|QA|QS\d|质量|测试)(\W|$)/.test(value)) return "quality";
  if (/(^|\W)(DEV|DS\d|开发)(\W|$)/.test(value)) return "development";
  if (/(^|\W)(SBX|SANDBOX|沙箱)(\W|$)/.test(value)) return "sandbox";
  return "other";
}

function environmentLabel(environment: SapSystemEnvironment): string {
  const labels: Record<SapSystemEnvironment, string> = {
    development: "开发",
    quality: "质量/测试",
    production: "生产",
    sandbox: "沙箱",
    other: "其他"
  };
  return labels[environment];
}

function createModelProvider(index: number): ApiProviderConfig {
  return {
    id: `provider-${Date.now().toString(36)}-${index}`,
    name: `模型渠道 ${index}`,
    providerType: "openai-compatible",
    baseUrl: "",
    enabled: true,
    catalogMode: "remote-with-manual-fallback",
    testModelId: "",
    manualModelIds: [],
    credential: {
      kind: "api-key",
      store: null,
      state: "not-set",
      updatedAt: null
    } as SecretHandle,
    models: [],
    modelSyncStatus: "not-configured",
    chatTestStatus: "not-configured",
    lastVerificationMode: null,
    verifiedModelIds: [],
    lastVerifiedModelId: null,
    lastCheckedAt: null
  };
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
      title: "ADT Service 状态",
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
  const isFakeReport = report?.mode === "fake";

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
          <dt>System ID</dt>
          <dd>{system?.systemId || config.adt.systemId || "未填写"}</dd>
        </div>
        <div>
          <dt>实例编号</dt>
          <dd>{system?.instanceNumber || config.adt.instanceNumber || "未填写"}</dd>
        </div>
        <div>
          <dt>环境</dt>
          <dd>{environmentLabel(system?.environment ?? config.adt.environment)}</dd>
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
          <dt>验证模式</dt>
          <dd>{reportModeLabel(report?.mode)}</dd>
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
          <dd>{report ? (report.ok ? (isFakeReport ? "模拟 T000 最小读取通过，仅用于本地流程自测；不代表真实 SAP 已连通。" : "固定 ADT T000 元数据读取返回了符合预期的内容；只验证这一条最小只读路径，不代表其他对象权限。") : "未通过，不能标记为 T000 只读验证通过。") : "尚未执行本轮验证。"}</dd>
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

function FeishuVerificationReportView({ config, report, hasUnsavedDraft }: { config: ProjectConfig; report: FeishuVerificationReport | null; hasUnsavedDraft: boolean }) {
  const authStatus = report?.authStatus ?? config.feishu.authStatus;
  const docPermissionStatus = report?.docPermissionStatus ?? config.feishu.docPermissionStatus;
  const authAction = report?.authAction;
  const steps = report?.steps ?? [
    {
      id: "cli" as const,
      title: "CLI 检测",
      status: authStatus === "verified" || docPermissionStatus === "verified" ? "passed" as const : "skipped" as const,
      detail: "检查 lark-cli / feishu-cli 是否可执行，不读取授权值。",
      checkedAt: config.feishu.lastCheckedAt ?? ""
    },
    {
      id: "profile" as const,
      title: "Profile 检测",
      status: config.feishu.profile ? "passed" as const : "skipped" as const,
      detail: "从本机 lark-cli profile 列表选择账号，不切换全局默认 profile。",
      checkedAt: config.feishu.lastCheckedAt ?? ""
    },
    {
      id: "auth" as const,
      title: "登录状态",
      status: stepStatusFromConfig(authStatus),
      detail: "检查当前 Profile；如未登录，现有连接器会发起用户授权并可能打开浏览器。",
      checkedAt: config.feishu.lastCheckedAt ?? ""
    },
    {
      id: "docs" as const,
      title: "文档权限",
      status: stepStatusFromConfig(docPermissionStatus),
      detail: "只判断是否发现缺少文档权限，本阶段不创建或更新真实文档。",
      checkedAt: config.feishu.lastCheckedAt ?? ""
    }
  ];
  const firstError = report?.errors[0];
  const conclusion = report
    ? (report.ok ? `${reportModeLabel(report.mode)}已确认 CLI 可执行、当前 Profile 登录状态检查通过，且所需文档 scope 未发现缺失；未验证文档创建或更新。` : "检查未通过，不能据此判断飞书文档流程可用。")
    : hasUnsavedDraft
      ? "飞书配置已修改，保存后需要重新验证。"
      : "本页尚未重新验证；上次结果见上方状态。";

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
          <dt>CLI</dt>
          <dd>{report?.cli.cliName || config.feishu.cliPath || "未填写"}</dd>
        </div>
        <div>
          <dt>安装目录</dt>
          <dd>{report?.cli.installDir || "识别后显示"}</dd>
        </div>
        <div>
          <dt>CLI 版本</dt>
          <dd>{report?.cli.version || "识别后显示"}</dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>{report?.cli.profile || config.feishu.profile || "未填写"}</dd>
        </div>
        <div>
          <dt>Profile 用户</dt>
          <dd>{report?.cli.profileUser || "检查后显示"}</dd>
        </div>
        <div>
          <dt>Token 状态</dt>
          <dd>{report?.cli.profileTokenStatus || "检查后显示"}</dd>
        </div>
        <div>
          <dt>App ID</dt>
          <dd>{report?.cli.appIdMasked || (config.feishu.appId ? `${config.feishu.appId.slice(0, 8)}***` : "未填写")}</dd>
        </div>
        <div>
          <dt>验证模式</dt>
          <dd>{reportModeLabel(report?.mode)}</dd>
        </div>
        <div>
          <dt>登录状态</dt>
          <dd>{authStatus === "verified" ? "当前 Profile 登录检查通过" : authStatus === "failed" ? "登录未通过" : "待检查"}</dd>
        </div>
        <div>
          <dt>文档权限</dt>
          <dd>{docPermissionStatus === "verified" ? "所需文档 scope 未发现缺失；未验证创建/更新" : docPermissionStatus === "failed" ? "scope 缺失或不可判断" : "待检查"}</dd>
        </div>
        <div>
          <dt>最后验证时间</dt>
          <dd>{formatCheckedAt(report?.checkedAt ?? config.feishu.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>验证结论</dt>
          <dd>{conclusion}</dd>
        </div>
      </dl>

      {authAction && authAction.status !== "not-needed" ? (
        <div className={`feishu-auth-action auth-action-${authAction.status}`}>
          <strong>{authAction.status === "completed" ? "本轮授权已完成" : authAction.status === "opened" ? "本轮已打开授权页" : "本轮授权未完成"}</strong>
          <span>{authAction.message}</span>
        </div>
      ) : null}

      {firstError ? (
        <div className="verification-error">
          <strong>{firstError.message}</strong>
          <span>{firstError.suggestion}</span>
        </div>
      ) : null}
    </div>
  );
}

function ModelProviderReportView({ provider, report }: { provider: ApiProviderConfig; report: ModelProviderVerificationReport | null }) {
  const verificationMode = report?.mode ?? provider.lastVerificationMode ?? undefined;
  const steps = report?.steps ?? [
    {
      id: "models" as const,
      title: "准备模型目录",
      status: stepStatusFromConfig(provider.modelSyncStatus),
      detail: provider.catalogMode === "manual" ? "使用已保存的手工模型 ID，不请求远程模型列表。" : "尝试读取远程模型摘要；允许时可回退到已保存的手工模型。",
      checkedAt: provider.lastCheckedAt ?? ""
    },
    {
      id: "chat" as const,
      title: "最小对话测试",
      status: stepStatusFromConfig(provider.chatTestStatus),
      detail: "只验证模型服务能回复基础请求，尚未进入案件任务编排。",
      checkedAt: provider.lastCheckedAt ?? ""
    }
  ];
  const firstError = report?.errors[0];
  const models = report?.models ?? provider.models;
  const selectedModelId = report?.selectedModelId ?? provider.lastVerifiedModelId ?? null;
  const isFakeReport = verificationMode === "fake";
  const eligibleForCaseDraft = provider.enabled && provider.modelSyncStatus === "verified" && provider.chatTestStatus === "verified" && provider.lastVerificationMode === "http" && provider.verifiedModelIds.length > 0 && provider.models.length > 0;

  return (
    <div className="adt-verification-report">
      <div className="verification-steps model-steps">
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
          <dt>渠道名称</dt>
          <dd>{report?.provider.name || provider.name || "未填写"}</dd>
        </div>
        <div>
          <dt>渠道类型</dt>
          <dd>{provider.providerType === "anthropic-compatible" ? "Anthropic Compatible" : provider.providerType === "deepseek" ? "DeepSeek（OpenAI 协议）" : provider.providerType === "custom" ? "自定义 OpenAI 协议" : "OpenAI Compatible"}</dd>
        </div>
        <div>
          <dt>服务主机</dt>
          <dd>{report?.provider.endpointHost || "执行验证后显示脱敏主机"}</dd>
        </div>
        <div>
          <dt>验证模式</dt>
          <dd>{reportModeLabel(verificationMode)}</dd>
        </div>
        <div>
          <dt>模型数量</dt>
          <dd>{models.length} 个</dd>
        </div>
        <div>
          <dt>测试模型</dt>
          <dd>{selectedModelId || "验证后显示"}</dd>
        </div>
        <div>
          <dt>最后验证时间</dt>
          <dd>{formatCheckedAt(report?.checkedAt ?? provider.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>验证结论</dt>
          <dd>{report ? (report.ok ? (isFakeReport ? "模拟模型目录和最小对话通过，仅用于本地流程自测；不能用于案件模型草稿。" : "真实 HTTP 模型目录和所选模型最小对话通过；未验证视觉、工具、联网等扩展能力。") : "最小验证未通过，不能作为案件候选模型。") : eligibleForCaseDraft ? "上次真实 HTTP 模型目录与最小对话通过；扩展能力仍未验证。" : "尚未通过真实 HTTP 模型目录与最小对话。"}</dd>
        </div>
      </dl>

      {models.length > 0 ? (
        <div className="model-list">
          <div className="model-list-note">
            <span>共 {models.length} 个模型，以下为渠道返回的完整目录；标签来自模型名称推断，不代表扩展能力已验证。</span>
          </div>
          {models.map((model) => (
            <div className="model-row" key={model.id}>
              <strong title={model.id}>{model.displayName}</strong>
              <span>
                {model.capabilities.slice(0, 5).map((capability) => (
                  <em key={capability}>{capabilityLabel(capability)}</em>
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {firstError ? (
        <div className="verification-error">
          <strong>{firstError.message}</strong>
          <span>{firstError.suggestion}</span>
        </div>
      ) : null}
    </div>
  );
}

function CodexVerificationReportView({ config, report }: { config: ProjectConfig; report: CodexVerificationReport | null }) {
  const steps = report?.steps ?? [
    {
      id: "cli" as const,
      title: "Codex CLI 检测",
      status: stepStatusFromConfig(config.codex.cliStatus),
      detail: "只检查本机 codex 命令是否可用，不读取 Codex App 历史聊天。",
      checkedAt: config.codex.lastCheckedAt ?? ""
    },
    {
      id: "login" as const,
      title: "登录状态",
      status: stepStatusFromConfig(config.codex.loginStatus),
      detail: "只读取登录状态，不回显 Token 或账号敏感信息。",
      checkedAt: config.codex.lastCheckedAt ?? ""
    },
    {
      id: "readonly-task" as const,
      title: "只读试跑",
      status: stepStatusFromConfig(config.codex.readonlyTaskStatus),
      detail: "在空临时目录执行固定只读探针，不写项目文件。",
      checkedAt: config.codex.lastCheckedAt ?? ""
    }
  ];
  const firstError = report?.errors[0];
  const capabilities = report?.capabilities ?? [];
  const codexReady = config.codex.cliStatus === "verified" && config.codex.loginStatus === "verified";

  return (
    <div className="adt-verification-report codex-verification-report">
      <div className="verification-steps model-steps">
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
          <dt>接入方式</dt>
          <dd>{config.codex.integrationType === "cli" ? "本机 Codex 命令" : "Codex SDK（预留）"}</dd>
        </div>
        <div>
          <dt>命令位置</dt>
          <dd>{report?.cli.executablePath || config.codex.executablePath || "未填写"}</dd>
        </div>
        <div>
          <dt>安装目录</dt>
          <dd>{report?.cli.installDir || "验证后显示"}</dd>
        </div>
        <div>
          <dt>版本</dt>
          <dd>{report?.cli.version || config.codex.version || "验证后显示"}</dd>
        </div>
        <div>
          <dt>最后验证时间</dt>
          <dd>{formatCheckedAt(report?.checkedAt ?? config.codex.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>验证结论</dt>
          <dd>{report ? (report.ok ? (config.codex.readonlyTaskStatus === "verified" ? "Codex CLI 已安装并登录，固定临时只读任务也已通过。" : "Codex CLI 已安装并登录；工程试跑受当前模型、CLI 版本或网络影响，实际使用时会单独提示。") : "Codex CLI 安装或登录检查未通过。") : codexReady ? "Codex CLI 已安装并登录；工程试跑是可选诊断，不影响核心 AI 对话。" : "尚未完成 Codex CLI 安装与登录检查。"}</dd>
        </div>
      </dl>

      {capabilities.length > 0 ? (
        <div className="model-list codex-capability-list">
          <div className="model-list-note">
            <span>入口发现不等于能力验证；只有“工程任务执行”的固定只读试跑在本轮被真实调用。</span>
          </div>
          {capabilities.map((capability) => {
            const presentation = codexCapabilityPresentation(capability);
            return (
              <div className="model-row" key={capability.id}>
                <strong>{capability.label}</strong>
                <span><em>{presentation.status}</em></span>
                <small>{presentation.detail}</small>
              </div>
            );
          })}
        </div>
      ) : null}

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
  onDirtyChange?: (dirty: boolean) => void;
  onCreateWorkspaceBackup: () => Promise<WorkspaceBackupResult | null>;
  onImportWorkspace: () => Promise<WorkspaceImportResult | null>;
  onSave: (projectId: string, config: ProjectConfig) => Promise<boolean>;
  onSaveSecret: (projectId: string, input: ProjectSecretInput) => Promise<boolean>;
  onVerifyAdt: (projectId: string) => Promise<AdtVerificationReport | null>;
  onDiscoverSapGui: () => Promise<SapGuiDiscoveryReport | null>;
  onVerifyFeishu: (projectId: string) => Promise<FeishuVerificationReport | null>;
  onDiscoverFeishu: () => Promise<FeishuCliDiscoveryReport | null>;
  onInstallFeishu: () => Promise<FeishuCliInstallResult | null>;
  onSetupFeishuProfile: (projectId: string) => Promise<FeishuCliProfileSetupResult | null>;
  onOpenFeishuDeveloperConsole: () => Promise<boolean>;
  onVerifyModelProvider: (projectId: string, providerId: string) => Promise<ModelProviderVerificationReport | null>;
  onVerifyCodex: (projectId: string) => Promise<CodexVerificationReport | null>;
  onScanLocalAi: (silent?: boolean) => Promise<LocalAiScanResult | null>;
  onInstallLocalAi: () => Promise<LocalAiInstallResult | null>;
}

type ConfigTabId = "sap" | "models" | "tools" | "feishu" | "capabilities" | "storage";

function ConfigCenter({ project, notice, onBack, onDirtyChange, onCreateWorkspaceBackup, onImportWorkspace, onSave, onSaveSecret, onVerifyAdt, onDiscoverSapGui, onVerifyFeishu, onDiscoverFeishu, onInstallFeishu, onSetupFeishuProfile, onOpenFeishuDeveloperConsole, onVerifyModelProvider, onVerifyCodex, onScanLocalAi, onInstallLocalAi }: ConfigCenterProps) {
  const [draft, setDraft] = useState<ProjectConfig | null>(project ? cloneConfig(project.config) : null);
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigTabId>(project?.sapVersion === "UNKNOWN" ? "models" : "sap");
  const [adtEntry, setAdtEntry] = useState("");
  const [selectedAdtConnectionId, setSelectedAdtConnectionId] = useState(project?.config.activeAdtConnectionId ?? project?.config.adt.id ?? "");
  const [selectedProviderId, setSelectedProviderId] = useState(project?.config.apiProviders[0]?.id ?? "");
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const apiInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [feishuSecretEntry, setFeishuSecretEntry] = useState("");
  const [showAdtSecret, setShowAdtSecret] = useState(false);
  const [showApiSecrets, setShowApiSecrets] = useState<Record<string, boolean>>({});
  const [showFeishuSecret, setShowFeishuSecret] = useState(false);
  const [adtSecretDirty, setAdtSecretDirty] = useState(false);
  const [apiSecretDirtyByProvider, setApiSecretDirtyByProvider] = useState<Record<string, boolean>>({});
  const [feishuSecretDirty, setFeishuSecretDirty] = useState(false);
  const [adtReport, setAdtReport] = useState<AdtVerificationReport | null>(null);
  const [sapGuiDiscovery, setSapGuiDiscovery] = useState<SapGuiDiscoveryReport | null>(null);
  const [selectedSapGuiEntryId, setSelectedSapGuiEntryId] = useState("");
  const [feishuReport, setFeishuReport] = useState<FeishuVerificationReport | null>(null);
  const [feishuDiscovery, setFeishuDiscovery] = useState<FeishuCliDiscoveryReport | null>(null);
  const [modelReports, setModelReports] = useState<Record<string, ModelProviderVerificationReport | null>>({});
  const [codexReport, setCodexReport] = useState<CodexVerificationReport | null>(null);
  const [localAiScan, setLocalAiScan] = useState<LocalAiScanResult | null>(null);
  const [feishuProfileResult, setFeishuProfileResult] = useState<FeishuCliProfileSetupResult | null>(null);
  const [sectionSaveNotice, setSectionSaveNotice] = useState("");
  const [savingAdt, setSavingAdt] = useState(false);
  const [savingFeishu, setSavingFeishu] = useState(false);
  const [installingFeishu, setInstallingFeishu] = useState(false);
  const [discoveringFeishu, setDiscoveringFeishu] = useState(false);
  const [openingFeishuConsole, setOpeningFeishuConsole] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const [savingCodex, setSavingCodex] = useState(false);
  const [verifyingAdt, setVerifyingAdt] = useState(false);
  const [discoveringSapGui, setDiscoveringSapGui] = useState(false);
  const [verifyingFeishu, setVerifyingFeishu] = useState(false);
  const [verifyingModel, setVerifyingModel] = useState(false);
  const [verifyingCodex, setVerifyingCodex] = useState(false);
  const [scanningLocalAi, setScanningLocalAi] = useState(false);
  const [installingLocalAi, setInstallingLocalAi] = useState(false);
  const [transferringWorkspace, setTransferringWorkspace] = useState(false);
  const previousProjectIdRef = useRef<string | null>(null);
  const previousSavedConfigRef = useRef<ProjectConfig | null>(project ? cloneConfig(project.config) : null);
  const pendingSectionSaveRef = useRef<PendingProjectConfigSectionSave | null>(null);

  useEffect(() => {
    const nextProjectId = project?.id ?? null;
    const projectChanged = previousProjectIdRef.current !== nextProjectId;
    previousProjectIdRef.current = nextProjectId;
    const incomingSavedConfig = project ? cloneConfig(project.config) : null;
    const previousSavedConfig = previousSavedConfigRef.current;
    const pendingSectionSave = pendingSectionSaveRef.current;
    setDraft((current) => {
      if (!incomingSavedConfig) return null;
      if (projectChanged || !current || !previousSavedConfig) return incomingSavedConfig;
      const acceptedIncomingSection = pendingSectionSave
        && !sectionChanged(pendingSectionSave.submittedConfig, current, pendingSectionSave.section)
        ? pendingSectionSave.section
        : null;
      return reconcileProjectConfigDraft(
        previousSavedConfig,
        incomingSavedConfig,
        current,
        acceptedIncomingSection
      );
    });
    previousSavedConfigRef.current = incomingSavedConfig;
    pendingSectionSaveRef.current = null;
    setSelectedProviderId((current) => project?.config.apiProviders.some((provider) => provider.id === current)
      ? current
      : project?.config.apiProviders[0]?.id ?? "");
    setSelectedAdtConnectionId((current) => project?.config.adtConnections.some((connection) => connection.id === current)
      ? current
      : project?.config.activeAdtConnectionId ?? project?.config.adt.id ?? "");
    if (projectChanged) {
      setAdtEntry("");
      Object.values(apiInputRefs.current).forEach((input) => { if (input) input.value = ""; });
      apiInputRefs.current = {};
      setFeishuSecretEntry("");
      setShowAdtSecret(false);
      setShowApiSecrets({});
      setShowFeishuSecret(false);
      setAdtSecretDirty(false);
      setApiSecretDirtyByProvider({});
      setFeishuSecretDirty(false);
      setFeishuDiscovery(null);
      setFeishuProfileResult(null);
      setSectionSaveNotice("");
    }
  }, [project?.id, project?.config.updatedAt, project?.config.adt.credential.updatedAt, project?.config.apiProviders.map((provider) => `${provider.id}:${provider.credential.updatedAt ?? ""}`).join("|"), project?.config.feishu.credential.updatedAt]);

  useEffect(() => {
    if (!project?.id || project.sapVersion === "UNKNOWN") return;
    let cancelled = false;
    setDiscoveringSapGui(true);
    void onDiscoverSapGui()
      .then((report) => {
        if (!report || cancelled) return;
        setSapGuiDiscovery(report);
        setSelectedSapGuiEntryId((current) => report.entries.some((item) => item.id === current) ? current : report.entries[0]?.id ?? "");
      })
      .finally(() => { if (!cancelled) setDiscoveringSapGui(false); });
    return () => { cancelled = true; };
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    setDiscoveringFeishu(true);
    void onDiscoverFeishu()
      .then((report) => {
        if (report && !cancelled) applyFeishuDiscovery(report);
      })
      .finally(() => {
        if (!cancelled) setDiscoveringFeishu(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  useEffect(() => {
    if (project?.sapVersion === "UNKNOWN") setActiveConfigTab("models");
  }, [project?.id, project?.sapVersion]);

  useEffect(() => {
    setAdtReport(null);
    setFeishuReport(null);
    setModelReports({});
    setCodexReport(null);
  }, [project?.id]);

  useEffect(() => {
    let cancelled = false;
    setScanningLocalAi(true);
    void onScanLocalAi(true)
      .then((result) => {
        if (!cancelled && result) setLocalAiScan(result);
      })
      .finally(() => {
        if (!cancelled) setScanningLocalAi(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const configDraftDirty = Boolean(
    project && draft && (
      JSON.stringify(project.config) !== JSON.stringify(draft) ||
      adtSecretDirty ||
      feishuSecretDirty ||
      Object.values(apiSecretDirtyByProvider).some(Boolean)
    )
  );
  useEffect(() => {
    onDirtyChange?.(configDraftDirty);
    return () => onDirtyChange?.(false);
  }, [configDraftDirty, onDirtyChange]);

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

  const provider = draft.apiProviders.find((item) => item.id === selectedProviderId) ?? draft.apiProviders[0];
  const filteredProviders = draft.apiProviders.filter((item) => item.name.toLowerCase().includes(providerSearchQuery.trim().toLowerCase()));
  const adtConnections = draft.adtConnections.length > 0 ? draft.adtConnections : [draft.adt];
  const adtConnection = adtConnections.find((item) => item.id === selectedAdtConnectionId)
    ?? adtConnections.find((item) => item.id === draft.activeAdtConnectionId)
    ?? adtConnections[0];
  const adtConnectionGroups = Object.entries(adtConnections.reduce<Record<string, AdtConfig[]>>((groups, connection) => {
    const systemId = connection.systemId.trim().toUpperCase() || "未分组";
    groups[systemId] = [...(groups[systemId] ?? []), connection];
    return groups;
  }, {})).sort(([left], [right]) => left.localeCompare(right, "zh-CN"));
  const sapProject = project.sapVersion !== "UNKNOWN";
  const showApiSecret = showApiSecrets[provider.id] === true;
  const apiSecretDirty = apiSecretDirtyByProvider[provider.id] === true;
  const modelReport = modelReports[provider.id] ?? null;
  const hasUnsavedAdtConfig = sectionChanged(project.config, draft, "adt");
  const hasUnsavedModelConfig = sectionChanged(project.config, draft, "models");
  const hasUnsavedToolsConfig = sectionChanged(project.config, draft, "tools");
  const hasUnsavedFeishuConfig = sectionChanged(project.config, draft, "feishu");
  const hasUnsavedCodexConfig = sectionChanged(project.config, draft, "codex");
  const hasUnsavedConfig = hasUnsavedAdtConfig || hasUnsavedModelConfig || hasUnsavedToolsConfig || hasUnsavedFeishuConfig || hasUnsavedCodexConfig;
  const visibleAdtConfig: ProjectConfig = hasUnsavedAdtConfig
    ? {
        ...draft,
        adt: {
          ...draft.adt,
          configStatus: "pending-verification",
          connectionStatus: "pending-verification",
          minimalReadStatus: "pending-verification",
          lastVerificationMode: null,
          lastCheckedAt: null
        }
      }
    : draft;
  const visibleFeishuConfig: ProjectConfig = hasUnsavedFeishuConfig
    ? {
        ...draft,
        feishu: {
          ...draft.feishu,
          authStatus: "pending-verification",
          docPermissionStatus: "pending-verification",
          lastCheckedAt: null
        }
      }
    : draft;
  const visibleModelProvider: ApiProviderConfig = hasUnsavedModelConfig
    ? {
        ...provider,
        models: [],
        modelSyncStatus: "pending-verification",
        chatTestStatus: "pending-verification",
        lastVerificationMode: null,
        verifiedModelIds: [],
        lastVerifiedModelId: null,
        lastCheckedAt: null
      }
    : provider;
  const visibleCodexConfig: ProjectConfig = hasUnsavedCodexConfig
    ? {
        ...draft,
        codex: {
          ...draft.codex,
          cliStatus: "pending-verification",
          version: "",
          loginStatus: "pending-verification",
          readonlyTaskStatus: "pending-verification",
          lastCheckedAt: null
        }
      }
    : draft;

  async function saveCurrentSection(section: ProjectConfigSection): Promise<boolean> {
    if (!project || !draft || pendingSectionSaveRef.current) return false;
    const submittedConfig = mergeProjectConfigSection(project.config, draft, section);
    pendingSectionSaveRef.current = { section, submittedConfig };
    const saved = await onSave(project.id, submittedConfig);
    if (!saved) pendingSectionSaveRef.current = null;
    return saved;
  }

  function updateDraft(updater: (config: ProjectConfig) => ProjectConfig) {
    setDraft((current) => current ? updater(current) : current);
  }

  function applyFeishuDiscovery(report: FeishuCliDiscoveryReport) {
    setFeishuDiscovery(report);
    updateDraft((current) => {
      const profileExists = report.profiles.some((profile) => profile.name === current.feishu.profile);
      const nextProfile = profileExists
        ? current.feishu.profile
        : current.feishu.profile
          ? current.feishu.profile
          : report.profiles.length === 1
            ? report.profiles[0].name
            : "";
      return {
        ...current,
        feishu: {
          ...current.feishu,
          cliPath: report.cliPath ?? current.feishu.cliPath,
          profile: nextProfile ?? current.feishu.profile
        }
      };
    });
  }

  function updateAdt(field: keyof ProjectConfig["adt"], value: string) {
    setAdtReport(null);
    updateDraft((current) => {
      const updated = { ...current.adt, [field]: value };
      return {
        ...current,
        adt: updated,
        adtConnections: current.adtConnections.map((item) => item.id === updated.id ? { ...updated } : item)
      };
    });
  }

  function updateAdtKeywords(value: string) {
    setAdtReport(null);
    const routingKeywords = value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
    updateDraft((current) => {
      const updated = { ...current.adt, routingKeywords };
      return { ...current, adt: updated, adtConnections: current.adtConnections.map((item) => item.id === updated.id ? { ...updated } : item) };
    });
  }

  async function discoverSapGui() {
    setDiscoveringSapGui(true);
    try {
      const report = await onDiscoverSapGui();
      if (!report) return;
      setSapGuiDiscovery(report);
      setSelectedSapGuiEntryId((current) => report.entries.some((item) => item.id === current) ? current : report.entries[0]?.id ?? "");
    } finally {
      setDiscoveringSapGui(false);
    }
  }

  function importSapGuiEntry() {
    if (!draft || !sapGuiDiscovery) return;
    const entry = sapGuiDiscovery.entries.find((item) => item.id === selectedSapGuiEntryId);
    if (!entry) return;
    const matchingConnection = draft.adtConnections.find((connection) => matchesDiscoveredSapEndpoint(connection, entry));
    const isBlank = !adtConnection.alias.trim() && !adtConnection.url.trim() && !adtConnection.client.trim() && !adtConnection.username.trim();
    const replaceExisting = Boolean(matchingConnection) || isBlank;
    const base = matchingConnection ?? (isBlank ? adtConnection : createAdtConnection(draft.adtConnections.length + 1));
    const imported: AdtConfig = {
      ...base,
      alias: !base.alias.trim() || /^SAP 连接 \d+$/.test(base.alias.trim()) ? entry.description : base.alias,
      systemId: entry.systemId || base.systemId,
      instanceNumber: entry.instanceNumber,
      environment: inferSapEnvironment(entry),
      url: entry.host,
      sslMode: "skip-certificate"
    };
    setSelectedAdtConnectionId(imported.id);
    setAdtEntry("");
    setAdtSecretDirty(false);
    setShowAdtSecret(false);
    setAdtReport(null);
    updateDraft((current) => ({
      ...current,
      adt: imported,
      activeAdtConnectionId: imported.id,
      adtConnections: replaceExisting
        ? current.adtConnections.map((item) => item.id === imported.id ? imported : item)
        : [...current.adtConnections, imported]
    }));
  }

  function selectAdtConnection(connectionId: string) {
    if (!draft) return;
    const selected = draft.adtConnections.find((item) => item.id === connectionId);
    if (!selected) return;
    setSelectedAdtConnectionId(connectionId);
    setAdtEntry("");
    setAdtSecretDirty(false);
    setShowAdtSecret(false);
    setAdtReport(null);
    updateDraft((current) => ({ ...current, activeAdtConnectionId: connectionId, adt: { ...selected } }));
  }

  function addAdtConnection() {
    if (!draft) return;
    const nextConnection = createAdtConnection(draft.adtConnections.length + 1);
    setSelectedAdtConnectionId(nextConnection.id);
    setAdtEntry("");
    setAdtSecretDirty(false);
    setShowAdtSecret(false);
    setAdtReport(null);
    updateDraft((current) => ({
      ...current,
      adt: nextConnection,
      activeAdtConnectionId: nextConnection.id,
      adtConnections: [...current.adtConnections, nextConnection]
    }));
  }

  function removeAdtConnection() {
    if (!draft || draft.adtConnections.length <= 1) return;
    const currentIndex = draft.adtConnections.findIndex((item) => item.id === adtConnection.id);
    if (currentIndex < 0) return;
    const label = adtConnection.alias.trim() || "当前 SAP 连接";
    if (!window.confirm(`确认移除“${label}”吗？\n\n保存 SAP 配置时，该连接及其已保存的加密密码会一并清理；其他 SAP 连接和本地案件文件不受影响。`)) return;
    const remaining = draft.adtConnections.filter((item) => item.id !== adtConnection.id);
    const next = remaining[Math.min(currentIndex, remaining.length - 1)];
    setSelectedAdtConnectionId(next.id);
    setAdtEntry("");
    setAdtSecretDirty(false);
    setShowAdtSecret(false);
    setAdtReport(null);
    updateDraft((current) => ({
      ...current,
      adt: { ...next },
      activeAdtConnectionId: next.id,
      adtConnections: remaining
    }));
  }

  function updateFeishu(field: keyof ProjectConfig["feishu"], value: string) {
    setFeishuReport(null);
    setFeishuProfileResult(null);
    updateDraft((current) => ({ ...current, feishu: { ...current.feishu, [field]: value } }));
  }

  function profileDisplayName(profile: FeishuCliProfileSummary): string {
    const status = profile.tokenStatus ? ` / ${profile.tokenStatus}` : "";
    const user = profile.user ? ` / ${profile.user}` : "";
    return `${profile.name}${user}${status}`;
  }

  function updateCodex(field: keyof ProjectConfig["codex"], value: string) {
    setCodexReport(null);
    updateDraft((current) => ({ ...current, codex: { ...current.codex, [field]: value } }));
  }

  function updateProvider(field: keyof ApiProviderConfig, value: string | boolean | string[]) {
    setModelReports((current) => ({ ...current, [provider.id]: null }));
    updateDraft((current) => {
      return {
        ...current,
        apiProviders: current.apiProviders.map((item) => item.id === provider.id ? { ...item, [field]: value } : item)
      };
    });
  }

  function addModelProvider() {
    if (!draft) return;
    if (apiSecretDirty && !window.confirm("当前渠道的新 API Key 尚未保存。添加新渠道会清空这次输入，确定继续吗？")) return;
    if (apiSecretDirty) {
      const input = apiInputRefs.current[provider.id];
      if (input) input.value = "";
      setApiSecretDirtyByProvider((current) => ({ ...current, [provider.id]: false }));
      setShowApiSecrets((current) => ({ ...current, [provider.id]: false }));
    }
    const nextProvider = createModelProvider(draft.apiProviders.length + 1);
    updateDraft((current) => ({ ...current, apiProviders: [...current.apiProviders, nextProvider] }));
    setSelectedProviderId(nextProvider.id);
    setModelReports((current) => ({ ...current, [nextProvider.id]: null }));
  }

  function removeModelProvider() {
    if (!draft || draft.apiProviders.length <= 1) return;
    const currentIndex = draft.apiProviders.findIndex((item) => item.id === provider.id);
    if (currentIndex < 0) return;
    const label = provider.name.trim() || "当前模型渠道";
    if (!window.confirm(`确认移除“${label}”吗？\n\n保存模型配置时，该渠道及其已保存的加密 API Key 会一并清理；其他模型渠道和案件文件不受影响。`)) return;
    const remaining = draft.apiProviders.filter((item) => item.id !== provider.id);
    const next = remaining[Math.min(currentIndex, remaining.length - 1)];
    setSelectedProviderId(next.id);
    apiInputRefs.current = Object.fromEntries(Object.entries(apiInputRefs.current).filter(([id]) => id !== provider.id));
    setApiSecretDirtyByProvider((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== provider.id)));
    setShowApiSecrets((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== provider.id)));
    setModelReports((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== provider.id)));
    updateDraft((current) => ({ ...current, apiProviders: remaining }));
  }

  function setCurrentApiEntry(value: string) {
    setApiSecretDirtyByProvider((current) => ({ ...current, [provider.id]: value.length > 0 }));
    setModelReports((current) => ({ ...current, [provider.id]: null }));
  }

  function selectModelProvider(providerId: string) {
    if (providerId === provider.id) return;
    if (apiSecretDirty && !window.confirm("当前渠道的新 API Key 尚未保存。切换渠道会清空这次输入，确定继续吗？")) return;
    if (apiSecretDirty) {
      const input = apiInputRefs.current[provider.id];
      if (input) input.value = "";
      setApiSecretDirtyByProvider((current) => ({ ...current, [provider.id]: false }));
      setShowApiSecrets((current) => ({ ...current, [provider.id]: false }));
    }
    setSelectedProviderId(providerId);
  }

  async function saveAdtSettings() {
    if (!project || !draft || savingAdt) return;
    const secretValue = adtEntry;
    const savesPassword = secretValue.length > 0 && adtSecretDirty;
    setSectionSaveNotice("");
    setSavingAdt(true);
    try {
      const configSaved = await saveCurrentSection("adt");
      if (!configSaved) return;
      if (savesPassword) {
        const saved = await onSaveSecret(project.id, { target: { kind: "adt-password", connectionId: adtConnection.id }, value: secretValue });
        if (!saved) return;
        setAdtSecretDirty(false);
        setAdtEntry("");
        setShowAdtSecret(false);
      }
      setSectionSaveNotice(savesPassword
        ? "SAP 只读连接配置和密码已保存；模型、Feishu、Codex 的未保存草稿没有提交。"
        : "SAP 只读连接配置已保存；模型、Feishu、Codex 的未保存草稿没有提交。");
    } finally {
      setSavingAdt(false);
    }
  }

  async function verifyAdt() {
    if (!project || verifyingAdt || savingAnyConfig || hasUnsavedAdtConfig || hasPendingAdtSecret) return;
    setSectionSaveNotice("");
    setVerifyingAdt(true);
    try {
      const report = await onVerifyAdt(project.id);
      if (report) setAdtReport(report);
    } finally {
      setVerifyingAdt(false);
    }
  }

  async function saveModelSettings() {
    if (!project || !draft || savingModel) return;
    const secretValue = apiInputRefs.current[provider.id]?.value ?? "";
    const providerId = provider.id;
    const savesApiKey = secretValue.length > 0 && apiSecretDirty;
    const hasOtherPendingApiSecrets = Object.entries(apiSecretDirtyByProvider).some(([id, dirty]) => id !== providerId && dirty);
    setSectionSaveNotice("");
    setSavingModel(true);
    try {
      const configSaved = await saveCurrentSection("models");
      if (!configSaved) return;
      if (savesApiKey) {
        const saved = await onSaveSecret(project.id, { target: { kind: "api-key", providerId }, value: secretValue });
        if (!saved) return;
        setApiSecretDirtyByProvider((current) => ({ ...current, [providerId]: false }));
        const input = apiInputRefs.current[providerId];
        if (input) input.value = "";
        setShowApiSecrets((current) => ({ ...current, [providerId]: false }));
      }
      const otherSecretNote = hasOtherPendingApiSecrets ? " 其他模型渠道的新 API Key 输入仍未提交。" : "";
      setSectionSaveNotice(savesApiKey
        ? `AI 模型区配置和「${provider.name || "未命名渠道"}」API Key 已保存；SAP、Feishu、Codex 草稿没有提交。${otherSecretNote}`
        : `AI 模型区配置已保存；SAP、Feishu、Codex 草稿没有提交。${otherSecretNote}`);
    } finally {
      setSavingModel(false);
    }
  }

  async function saveToolSettings() {
    if (!project || !draft || savingTools) return;
    setSectionSaveNotice("");
    setSavingTools(true);
    try {
      const saved = await saveCurrentSection("tools");
      if (saved) setSectionSaveNotice("AI 功能授权已保存；连接配置和其他区域草稿没有提交。");
    } finally {
      setSavingTools(false);
    }
  }

  async function saveFeishuSettings(): Promise<boolean> {
    if (!project || !draft || savingFeishu) return false;
    const secretValue = feishuSecretEntry;
    const savesAppSecret = secretValue.length > 0 && feishuSecretDirty;
    const canWriteProfile = Boolean(draft.feishu.profile.trim() && draft.feishu.appId.trim() && (secretValue.length > 0 || draft.feishu.credential.state === "set-in-secure-store"));
    setSectionSaveNotice("");
    setSavingFeishu(true);
    setFeishuProfileResult(null);
    try {
      const configSaved = await saveCurrentSection("feishu");
      if (!configSaved) return false;
      if (savesAppSecret) {
        const saved = await onSaveSecret(project.id, { target: { kind: "feishu-token" }, value: secretValue });
        if (saved) {
          setFeishuSecretDirty(false);
          setFeishuSecretEntry("");
          setShowFeishuSecret(false);
        } else {
          return false;
        }
      }
      if (canWriteProfile) {
        const result = await onSetupFeishuProfile(project.id);
        if (!result) return false;
        setFeishuProfileResult(result);
        if (!result.ok) {
          setSectionSaveNotice(`Feishu 区配置已保存，但本机 CLI Profile 未写入：${result.errors[0]?.message ?? result.message}`);
          return false;
        }
        const report = await onDiscoverFeishu();
        if (!report) {
          setSectionSaveNotice("Feishu 区配置和 CLI Profile 已保存，但保存后的 CLI 状态刷新失败；请点击“检查 CLI 状态”重试。其他区域草稿没有提交。");
          return false;
        }
        applyFeishuDiscovery(report);
      }
      setSectionSaveNotice(savesAppSecret
        ? `Feishu 区配置和 App Secret 已保存${canWriteProfile ? "，CLI Profile 已更新" : ""}；SAP、模型、Codex 草稿没有提交，也没有发起用户授权。`
        : `Feishu 区配置已保存${canWriteProfile ? "，CLI Profile 已更新" : ""}；SAP、模型、Codex 草稿没有提交，也没有发起用户授权。`);
      return true;
    } finally {
      setSavingFeishu(false);
    }
  }

  async function discoverFeishu() {
    if (discoveringFeishu) return;
    setSectionSaveNotice("");
    setDiscoveringFeishu(true);
    try {
      const report = await onDiscoverFeishu();
      if (report) applyFeishuDiscovery(report);
    } finally {
      setDiscoveringFeishu(false);
    }
  }

  async function installFeishu() {
    if (installingFeishu) return;
    setSectionSaveNotice("");
    setInstallingFeishu(true);
    try {
      const installResult = await onInstallFeishu();
      if (installResult?.ok) {
        const report = await onDiscoverFeishu();
        if (report) applyFeishuDiscovery(report);
      }
    } finally {
      setInstallingFeishu(false);
    }
  }

  async function openFeishuConsole() {
    if (openingFeishuConsole) return;
    setSectionSaveNotice("");
    setOpeningFeishuConsole(true);
    try {
      await onOpenFeishuDeveloperConsole();
    } finally {
      setOpeningFeishuConsole(false);
    }
  }

  async function verifyFeishu() {
    if (!project || verifyingFeishu || savingAnyConfig || hasUnsavedFeishuConfig || hasPendingFeishuSecret) return;
    setSectionSaveNotice("");
    setVerifyingFeishu(true);
    try {
      const report = await onVerifyFeishu(project.id);
      if (report) {
        setFeishuReport(report);
        if (report.ok) setFeishuProfileResult(null);
      }
    } finally {
      setVerifyingFeishu(false);
    }
  }

  async function verifyModelProvider() {
    if (!project || verifyingModel || savingAnyConfig || hasUnsavedModelConfig || hasPendingApiSecret) return;
    setSectionSaveNotice("");
    setVerifyingModel(true);
    try {
      const report = await onVerifyModelProvider(project.id, provider.id);
      if (report) setModelReports((current) => ({ ...current, [provider.id]: report }));
    } finally {
      setVerifyingModel(false);
    }
  }

  async function saveCodexSettings() {
    if (!project || !draft || savingCodex) return;
    setSectionSaveNotice("");
    setSavingCodex(true);
    try {
      const saved = await saveCurrentSection("codex");
      if (saved) {
        setSectionSaveNotice("Codex 区配置已保存；SAP、模型、Feishu 草稿没有提交。");
      }
    } finally {
      setSavingCodex(false);
    }
  }

  async function verifyCodex() {
    if (!project || verifyingCodex || savingAnyConfig || hasUnsavedCodexConfig) return;
    setSectionSaveNotice("");
    setVerifyingCodex(true);
    try {
      const report = await onVerifyCodex(project.id);
      if (report) setCodexReport(report);
    } finally {
      setVerifyingCodex(false);
    }
  }

  async function scanLocalAi() {
    if (scanningLocalAi) return;
    setScanningLocalAi(true);
    try {
      const result = await onScanLocalAi();
      if (result) setLocalAiScan(result);
    } finally {
      setScanningLocalAi(false);
    }
  }

  async function installLocalAi() {
    if (installingLocalAi) return;
    setInstallingLocalAi(true);
    try {
      const result = await onInstallLocalAi();
      if (result?.installed) {
        const scan = await onScanLocalAi();
        if (scan) setLocalAiScan(scan);
      }
    } finally {
      setInstallingLocalAi(false);
    }
  }

  async function createFullBackup() {
    if (transferringWorkspace) return;
    setTransferringWorkspace(true);
    setSectionSaveNotice("");
    try {
      const result = await onCreateWorkspaceBackup();
      if (result) setSectionSaveNotice(`完整备份已创建：${result.fileCount} 个文件，保存到 ${result.backupPath}`);
    } finally {
      setTransferringWorkspace(false);
    }
  }

  async function importExistingWorkspace() {
    if (transferringWorkspace || configDraftDirty) return;
    if (!window.confirm("导入会用所选旧工作台替换当前安装版数据；系统会先完整备份当前数据并在完成后重启。确定继续吗？")) return;
    setTransferringWorkspace(true);
    setSectionSaveNotice("");
    try {
      const result = await onImportWorkspace();
      if (!result) return;
      if (result.status === "cancelled") setSectionSaveNotice("已取消导入，没有修改当前工作台。");
      else setSectionSaveNotice("导入校验通过，正在重启并加载迁移后的项目与配置。");
    } finally {
      setTransferringWorkspace(false);
    }
  }

  const adtCredentialSaved = draft.adt.credential.state === "set-in-secure-store";
  const hasPendingAdtSecret = adtSecretDirty;
  const adtReady = !hasUnsavedAdtConfig && draft.adt.connectionStatus === "verified" && draft.adt.minimalReadStatus === "verified";
  const adtFailed = !hasUnsavedAdtConfig && (draft.adt.connectionStatus === "failed" || draft.adt.minimalReadStatus === "failed" || draft.adt.configStatus === "failed");
  const adtSummaryTone = adtReady ? "green" : adtFailed ? "orange" : hasUnsavedAdtConfig || adtCredentialSaved ? "blue" : "neutral";
  const adtSummaryText = adtReady ? "T000 只读读取通过" : adtFailed ? "需要检查 SAP 配置" : hasUnsavedAdtConfig ? "已修改，待保存" : adtCredentialSaved ? "已保存，待测试" : "未完成";
  const verifiedAdtConnectionCount = adtConnections.filter((item) => item.connectionStatus === "verified" && item.minimalReadStatus === "verified" && item.lastVerificationMode === "adt").length;

  const modelCredentialSaved = provider.credential.state === "set-in-secure-store";
  const hasPendingApiSecret = apiSecretDirty;
  const hasAnyPendingApiSecret = Object.values(apiSecretDirtyByProvider).some(Boolean);
  const modelReady = !hasUnsavedModelConfig && provider.enabled && provider.modelSyncStatus === "verified" && provider.chatTestStatus === "verified" && provider.lastVerificationMode === "http" && provider.verifiedModelIds.length > 0;
  const modelFailed = !hasUnsavedModelConfig && (provider.modelSyncStatus === "failed" || provider.chatTestStatus === "failed");
  const modelSummaryTone = modelReady ? "green" : modelFailed ? "orange" : hasUnsavedModelConfig || modelCredentialSaved ? "blue" : "neutral";
  const modelSummaryText = modelReady ? "模型目录与最小对话通过" : modelFailed ? "需要检查模型配置" : hasUnsavedModelConfig ? "已修改，待保存" : modelCredentialSaved ? "已保存，待测试" : "未完成";
  const readyProviderCount = hasUnsavedModelConfig ? 0 : draft.apiProviders.filter((item) => item.enabled && item.lastVerificationMode === "http" && item.modelSyncStatus === "verified" && item.chatTestStatus === "verified").length;
  const feishuCredentialSaved = draft.feishu.credential.state === "set-in-secure-store";
  const hasPendingFeishuSecret = feishuSecretDirty;
  const hasPendingSecretEntry = hasPendingAdtSecret || hasAnyPendingApiSecret || hasPendingFeishuSecret;

  const feishuReady = visibleFeishuConfig.feishu.authStatus === "verified" && visibleFeishuConfig.feishu.docPermissionStatus === "verified";
  const feishuFailed = visibleFeishuConfig.feishu.authStatus === "failed" || visibleFeishuConfig.feishu.docPermissionStatus === "failed";
  const feishuDetected = Boolean(feishuDiscovery?.installed || draft.feishu.cliPath);
  const feishuSummaryTone = feishuReady ? "green" : feishuFailed ? "orange" : hasUnsavedFeishuConfig || feishuDetected ? "blue" : "neutral";
  const feishuSummaryText = feishuReady ? "登录与 scope 检查通过" : feishuFailed ? "需要检查飞书 CLI" : hasUnsavedFeishuConfig ? "已修改，待保存" : feishuDetected ? "已识别，待检查" : "可选配置";
  const feishuProfiles = feishuDiscovery?.profiles ?? [];
  const selectedFeishuProfile = feishuProfiles.find((profile) => profile.name === draft.feishu.profile);
  const feishuVerificationOk = feishuReport?.ok === true;
  const shouldShowFeishuProfileResult = Boolean(feishuProfileResult && (feishuProfileResult.ok || (!feishuReady && !feishuVerificationOk)));
  const visibleFeishuProfileResult = shouldShowFeishuProfileResult ? feishuProfileResult : null;
  const codexReady = !hasUnsavedCodexConfig && draft.codex.cliStatus === "verified" && draft.codex.loginStatus === "verified";
  const codexFailed = !hasUnsavedCodexConfig && (draft.codex.cliStatus === "failed" || draft.codex.loginStatus === "failed");
  const codexDiscovery = localAiScan?.capabilities.find((item) => item.capabilityId === "codex-cli") ?? null;
  const savingAnyConfig = savingAdt || savingModel || savingTools || savingFeishu || savingCodex;
  const configTabOrder: ConfigTabId[] = sapProject
    ? ["sap", "models", "tools", "feishu", "capabilities", "storage"]
    : ["models", "tools", "feishu", "capabilities", "storage"];

  function handleConfigTabKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, configTabOrder.indexOf(activeConfigTab));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? configTabOrder.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + configTabOrder.length) % configTabOrder.length;
    const nextTab = configTabOrder[nextIndex];
    setActiveConfigTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`config-tab-${nextTab}`)?.focus());
  }

  return (
    <section className="config-workspace phase27-core-config-wizard">
      <div className="config-main">
        <div className="config-heading">
          <button className="icon-button" onClick={onBack} aria-label="返回案件"><ArrowLeft size={18} /></button>
          <div>
            <h1>配置中心</h1>
            <p>当前客户项目：{project.name}。SAP 连接仅属于当前客户项目；AI 模型、Feishu/Lark 和本机能力由整个工作台共用。</p>
          </div>
        </div>

        <div className="phase-notice config-notice">
          <ShieldCheck size={16} />
          <span>{sapProject ? "SAP 当前只做只读检查；" : "其他工作不读取 SAP；"}密码和 API Key 只进入系统安全存储，不会写入项目文件或回显到页面。</span>
        </div>
        {sectionSaveNotice || notice ? <p className="config-notice-secondary">{sectionSaveNotice || notice}</p> : null}
        {hasUnsavedConfig ? <p className="inline-warning">屏幕上有未保存内容。各区独立保存和测试，不会提交其他区域的草稿。</p> : null}
        {hasPendingSecretEntry ? <p className="inline-warning">密码、API Key 或飞书 App Secret 有新输入；只会随所属区域保存。</p> : null}

        <div className="config-domain-navigation">
          <div className="config-domain-navigation-label">
            <span>配置与授权</span>
            <small>连接、AI 授权和可选集成分层管理；每个区域独立保存。</small>
          </div>
          <nav className="config-tabs phase27-compact-status-summary" role="tablist" aria-label="配置类型" onKeyDown={handleConfigTabKeyDown}>
            <span className="config-tab-group-label" role="presentation">客户项目配置</span>
            {sapProject ? <button id="config-tab-sap" data-config-tab="sap" type="button" role="tab" aria-controls="config-panel-sap" tabIndex={activeConfigTab === "sap" ? 0 : -1} aria-selected={activeConfigTab === "sap"} className={activeConfigTab === "sap" ? "active" : ""} onClick={() => setActiveConfigTab("sap")}>
              <PlugZap size={16} /><span>SAP 系统</span><small>{adtSummaryText}</small>
            </button> : null}
            <span className="config-tab-group-label" role="presentation">工作台全局</span>
            <button id="config-tab-models" data-config-tab="models" type="button" role="tab" aria-controls="config-panel-models" tabIndex={activeConfigTab === "models" ? 0 : -1} aria-selected={activeConfigTab === "models"} className={activeConfigTab === "models" ? "active" : ""} onClick={() => setActiveConfigTab("models")}>
              <KeyRound size={16} /><span>AI 模型</span><small>{readyProviderCount > 0 ? `${readyProviderCount} 个可用` : modelSummaryText}</small>
            </button>
            <span className="config-tab-group-label" role="presentation">功能授权</span>
            <button id="config-tab-tools" data-config-tab="tools" type="button" role="tab" aria-controls="config-panel-tools" tabIndex={activeConfigTab === "tools" ? 0 : -1} aria-selected={activeConfigTab === "tools"} className={activeConfigTab === "tools" ? "active" : ""} onClick={() => setActiveConfigTab("tools")}>
              <ShieldCheck size={16} /><span>AI 工具</span><small>{Object.values(draft.agentTools).filter(Boolean).length} 项已启用</small>
            </button>
            <span className="config-tab-group-label" role="presentation">可选集成</span>
            <button id="config-tab-feishu" data-config-tab="feishu" type="button" role="tab" aria-controls="config-panel-feishu" tabIndex={activeConfigTab === "feishu" ? 0 : -1} aria-selected={activeConfigTab === "feishu"} className={activeConfigTab === "feishu" ? "active" : ""} onClick={() => setActiveConfigTab("feishu")}>
              <Terminal size={16} /><span>Feishu/Lark</span><small>{feishuSummaryText}</small>
            </button>
            <button id="config-tab-capabilities" data-config-tab="capabilities" type="button" role="tab" aria-controls="config-panel-capabilities" tabIndex={activeConfigTab === "capabilities" ? 0 : -1} aria-selected={activeConfigTab === "capabilities"} className={activeConfigTab === "capabilities" ? "active" : ""} onClick={() => setActiveConfigTab("capabilities")}>
              <Workflow size={16} /><span>本机能力</span><small>{codexReady ? "可用增强" : "可选"}</small>
            </button>
            <button id="config-tab-storage" data-config-tab="storage" type="button" role="tab" aria-controls="config-panel-storage" tabIndex={activeConfigTab === "storage" ? 0 : -1} aria-selected={activeConfigTab === "storage"} className={activeConfigTab === "storage" ? "active" : ""} onClick={() => setActiveConfigTab("storage")}>
              <Database size={16} /><span>本地存储</span><small>工作台维护</small>
            </button>
          </nav>
        </div>

        <section className="core-setup-grid single config-tab-stack">
          {sapProject ? <article id="config-panel-sap" role="tabpanel" aria-labelledby="config-tab-sap" className="setup-card core-config-card sap-config-card" hidden={activeConfigTab !== "sap"}>
            <div className="setup-card-title config-domain-title">
              <PlugZap size={18} />
              <div>
                <span className="config-eyebrow">Project 级 · 外部系统</span>
                <h2>SAP 系统与只读连接</h2>
                <p>同一 Project 可管理多个 SID 和 Client；Work 会按问题自动建议连接，有歧义时先让你确认。</p>
              </div>
              <span className={`setup-state setup-${adtSummaryTone}`}>{adtSummaryText}</span>
            </div>

            <section className="sap-gui-discovery" aria-labelledby="sap-import-heading">
              <div className="sap-gui-discovery-heading">
                <div>
                  <span className="config-section-kicker">导入辅助</span>
                  <strong id="sap-import-heading">从本机 SAP Logon 识别系统</strong>
                  <span>{discoveringSapGui ? "正在扫描" : sapGuiDiscovery ? `发现 ${sapGuiDiscovery.entries.length} 个连接定义 · ${sapGuiDiscovery.filesFound} 个配置文件` : "尚未扫描"}</span>
                </div>
                <button type="button" onClick={() => void discoverSapGui()} disabled={discoveringSapGui || savingAnyConfig} title="重新读取本机 SAP GUI Landscape 和 SAP Logon 配置">
                  <RefreshCw size={15} />{discoveringSapGui ? "扫描中" : "重新扫描"}
                </button>
              </div>
              {sapGuiDiscovery?.entries.length ? <div className="sap-gui-import-row">
                <label>
                  <span className="sr-only">选择 SAP Logon 连接</span>
                  <select value={selectedSapGuiEntryId} onChange={(event) => setSelectedSapGuiEntryId(event.target.value)} aria-label="选择本机 SAP Logon 连接">
                    {sapGuiDiscovery.entries.map((entry) => <option value={entry.id} key={entry.id}>
                      {entry.systemId || "需补 SID"} · 实例 {entry.instanceNumber} · {entry.description}
                    </option>)}
                  </select>
                </label>
                <button type="button" onClick={importSapGuiEntry} disabled={!selectedSapGuiEntryId || savingAnyConfig}><Download size={15} />导入基础信息</button>
              </div> : <p>未发现可导入的 SAP Logon 连接。仍可在下方手工填写 SID、实例号和主机。</p>}
              {sapGuiDiscovery?.warnings.map((warning) => <p className="inline-warning" key={warning}>{warning}</p>)}
              <small>只读取系统名称、SID、实例号和主机；不会读取 SAP 密码，也不会自动登录。旧版 SAP Logon 配置可能不保存 SID，导入后需补填再验证。</small>
            </section>

            <div className="sap-connection-workbench">
              <aside className="model-channel-manager adt-connection-list" aria-labelledby="sap-connection-list-heading">
                <div className="model-channel-toolbar">
                  <div>
                    <span className="config-section-kicker">连接对象</span>
                    <strong id="sap-connection-list-heading">已登记连接</strong>
                    <span>{adtConnections.length} 个</span>
                  </div>
                  <div className="model-channel-actions">
                    <button type="button" onClick={addAdtConnection} disabled={savingAnyConfig} title="为当前 Project 添加一套 SAP 只读登录连接"><Plus size={16} />新建</button>
                  </div>
                </div>
                <div className="adt-system-groups" role="group" aria-label="SAP 连接">
                  {adtConnectionGroups.map(([systemId, connections]) => <section className="adt-system-group" key={systemId}>
                    <header><strong>{systemId === "未分组" ? "未填写 SID" : systemId}</strong><span>{connections.length} 个 Client</span></header>
                    <div className="model-channel-list">
                      {connections.map((connection) => {
                        const verified = connection.connectionStatus === "verified" && connection.minimalReadStatus === "verified" && connection.lastVerificationMode === "adt";
                        const failed = connection.connectionStatus === "failed" || connection.minimalReadStatus === "failed" || connection.configStatus === "failed";
                        return <button type="button" aria-pressed={connection.id === adtConnection.id} className={connection.id === adtConnection.id ? "active" : ""} onClick={() => selectAdtConnection(connection.id)} key={connection.id}>
                          <span>{connection.alias.trim() || `${systemId} / Client ${connection.client || "未填"}`}</span>
                          <small>{connection.client ? `Client ${connection.client} · ` : ""}{environmentLabel(connection.environment)} · {verified ? "只读验证通过" : failed ? "验证失败" : connection.credential.state === "set-in-secure-store" ? "已保存，待验证" : "待配置"}</small>
                        </button>;
                      })}
                    </div>
                  </section>)}
                </div>
              </aside>

              <section className="sap-connection-editor" aria-labelledby="sap-connection-editor-heading">
                <header className="sap-connection-editor-heading">
                  <div>
                    <span className="config-section-kicker">对象详情</span>
                    <strong id="sap-connection-editor-heading">{adtConnection.alias.trim() || "未命名 SAP 连接"}</strong>
                    <small>{adtConnection.systemId || "SID 未填写"} · Client {adtConnection.client || "未填写"} · {environmentLabel(adtConnection.environment)}</small>
                  </div>
                  <button className="icon-button danger-icon-button" type="button" onClick={removeAdtConnection} disabled={adtConnections.length <= 1 || savingAnyConfig} title="移除当前 SAP 连接" aria-label="移除当前 SAP 连接"><Trash2 size={16} /></button>
                </header>

                <div className="config-fields">
              <label>
                <span>系统显示名</span>
                <input value={draft.adt.alias} onChange={(event) => updateAdt("alias", event.target.value)} placeholder="例如：DS4 开发系统 220" />
              </label>
              <div className="config-fields compact-fields">
                <label>
                  <span>System ID（SID）</span>
                  <input value={draft.adt.systemId} onChange={(event) => updateAdt("systemId", event.target.value.toUpperCase())} placeholder="例如：DS4" maxLength={3} />
                </label>
                <label>
                  <span>环境</span>
                  <select value={draft.adt.environment} onChange={(event) => updateAdt("environment", event.target.value)}>
                    <option value="development">开发</option>
                    <option value="quality">质量/测试</option>
                    <option value="production">生产</option>
                    <option value="sandbox">沙箱</option>
                    <option value="other">其他</option>
                  </select>
                </label>
              </div>
              <div className="config-fields compact-fields sap-endpoint-fields">
                <label>
                  <span>应用服务器 / ADT 地址</span>
                  <input value={draft.adt.url} onChange={(event) => updateAdt("url", event.target.value)} placeholder="例如：saps4d01.example.com" />
                </label>
                <label>
                  <span>实例编号</span>
                  <input value={draft.adt.instanceNumber} onChange={(event) => updateAdt("instanceNumber", event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="例如：02" inputMode="numeric" maxLength={2} />
                </label>
              </div>
              <div className="config-fields compact-fields">
                <label>
                  <span>Client</span>
                  <input value={draft.adt.client} onChange={(event) => updateAdt("client", event.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="例如：220" inputMode="numeric" maxLength={3} />
                </label>
                <label>
                  <span>用户名</span>
                  <input value={draft.adt.username} onChange={(event) => updateAdt("username", event.target.value)} />
                </label>
              </div>
              <label>
                <span>用途说明</span>
                <input value={draft.adt.usage} onChange={(event) => updateAdt("usage", event.target.value)} placeholder="例如：开发、配置核对、接口联调" />
              </label>
              <label>
                <span>自动识别关键词</span>
                <input value={draft.adt.routingKeywords.join("，")} onChange={(event) => updateAdtKeywords(event.target.value)} placeholder="例如：开发，采购，MM，接口" />
                <small>AI 只用这些词辅助选择连接；多套系统都可能相关时会先让你确认。</small>
              </label>
              <SecretInput
                id="adt-password-input"
                label="SAP 密码"
                value={adtEntry}
                saved={adtCredentialSaved}
                show={showAdtSecret}
                onChange={(value) => {
                  setAdtEntry(value);
                  setAdtSecretDirty(value.length > 0);
                  setAdtReport(null);
                }}
                onToggle={() => setShowAdtSecret((show) => !show)}
                placeholder="请输入 SAP 密码"
                revealLabel="显示 SAP 密码"
                hideLabel="隐藏 SAP 密码"
              />
              <div className="secret-state-line">
                <span>密码状态</span>
                <SecretStatusPill handle={draft.adt.credential} />
              </div>
                </div>

                <details className="setup-advanced-details phase27-advanced-details">
              <summary>高级设置</summary>
              <div className="config-fields">
                <label>
                  <span>语言</span>
                  <input value={draft.adt.language} onChange={(event) => updateAdt("language", event.target.value)} />
                </label>
                <label>
                  <span>SSL 模式</span>
                  <select value={draft.adt.sslMode} onChange={(event) => updateAdt("sslMode", event.target.value)}>
                    <option value="skip-certificate">跳过证书校验</option>
                    <option value="strict">严格校验</option>
                  </select>
                  <small>新连接默认跳过企业内网自签名证书校验；有受信任证书时可改为严格校验。</small>
                </label>
                <label>
                  <span>写入模式</span>
                  <input value="锁定只读" readOnly />
                </label>
                <label>
                  <span>密钥保存时间</span>
                  <input value={formatSavedAt(draft.adt.credential.updatedAt)} readOnly />
                </label>
              </div>
                </details>

                <div className="config-actions sap-connection-actions">
                  <button onClick={() => void saveAdtSettings()} disabled={savingAnyConfig} title="只保存 SAP 区配置和本次输入的 SAP 密码"><Save size={16} />{savingAdt ? "保存中" : "保存当前连接"}</button>
                  <button onClick={() => void verifyAdt()} disabled={verifyingAdt || savingAnyConfig || hasUnsavedAdtConfig || hasPendingAdtSecret} title={hasUnsavedAdtConfig || hasPendingAdtSecret ? "请先保存 SAP 区配置；测试只读取已保存的 SAP 配置" : "执行固定 ADT T000 元数据只读检查"}><PlugZap size={16} />{verifyingAdt ? "测试中" : "测试 T000 只读连接"}</button>
                </div>

                <details className="setup-advanced-details verification-details-fold phase27-folded-verification" open={Boolean(adtReport || adtFailed)}>
                  <summary>验证详情</summary>
                  <AdtVerificationReportView config={visibleAdtConfig} report={adtReport} />
                </details>
              </section>
            </div>
          </article> : null}

          <article id="config-panel-models" role="tabpanel" aria-labelledby="config-tab-models" className="setup-card core-config-card" hidden={activeConfigTab !== "models"}>
            <div className="setup-card-title">
              <KeyRound size={18} />
              <div>
                <span className="config-eyebrow">工作台全局 · 所有客户项目共用</span>
                <h2>AI 模型连接</h2>
                <p>添加多个 OpenAI 或 Anthropic Compatible 渠道，验证后可在 Work 和 Chat 中按渠道选择模型。</p>
              </div>
              <span className={`setup-state setup-${modelSummaryTone}`}>{modelSummaryText}</span>
            </div>

            <div className="model-channel-manager phase39-multi-provider-registry">
              <div className="model-channel-toolbar">
                <div>
                  <strong>模型渠道</strong>
                  <span>{draft.apiProviders.length} 个</span>
                </div>
                <div className="model-channel-actions">
                  <label className="model-channel-enabled" title="关闭后，此渠道的模型不会出现在 Chat 或 Work 的模型选择器中">
                    <input type="checkbox" checked={provider.enabled} onChange={(event) => updateProvider("enabled", event.target.checked)} />
                    <span>{provider.enabled ? "已启用" : "已停用"}</span>
                  </label>
                  <button type="button" onClick={addModelProvider} disabled={savingAnyConfig} title="添加一个新的模型渠道">
                    <Plus size={15} />添加渠道
                  </button>
                  <button className="icon-button danger-icon-button" type="button" onClick={removeModelProvider} disabled={draft.apiProviders.length <= 1 || savingAnyConfig} title="移除当前模型渠道" aria-label="移除当前模型渠道"><Trash2 size={16} /></button>
                </div>
              </div>
              {draft.apiProviders.length > 5 ? <label className="model-channel-search">
                <Search size={14} />
                <input value={providerSearchQuery} onChange={(event) => setProviderSearchQuery(event.target.value)} placeholder="搜索模型渠道" aria-label="搜索模型渠道" />
              </label> : null}
              <div className="model-channel-list" role="group" aria-label="模型渠道">
                {filteredProviders.map((item) => (
                  <button
                    type="button"
                    aria-pressed={item.id === provider.id}
                    className={item.id === provider.id ? "active" : ""}
                    onClick={() => selectModelProvider(item.id)}
                    key={item.id}
                    title={`编辑 ${item.name || "未命名渠道"}`}
                  >
                    <span>{item.name || "未命名渠道"}</span>
                    <small>{modelProviderStatusLabel(item)}</small>
                  </button>
                ))}
                {filteredProviders.length === 0 ? <p className="model-channel-empty">没有匹配的模型渠道。</p> : null}
              </div>
            </div>

            <div className="model-core-fields">
              <div className="config-fields">
                <label>
                  <span>渠道名称</span>
                  <input value={provider.name} onChange={(event) => updateProvider("name", event.target.value)} placeholder="例如：公司 OpenAI 中转" />
                </label>
                <label>
                  <span>Base URL</span>
                  <input value={provider.baseUrl} onChange={(event) => updateProvider("baseUrl", event.target.value)} placeholder="例如：https://api.example.com/v1" />
                </label>
                <SecretInput
                  key={provider.id}
                  id={`api-key-input-${provider.id}`}
                  label="API Key"
                  hasValue={apiSecretDirty}
                  inputRef={(element) => { apiInputRefs.current[provider.id] = element; }}
                  saved={modelCredentialSaved}
                  show={showApiSecret}
                  onChange={setCurrentApiEntry}
                  onToggle={() => setShowApiSecrets((current) => ({ ...current, [provider.id]: !showApiSecret }))}
                  placeholder="请输入 API Key"
                  revealLabel="显示 API Key"
                  hideLabel="隐藏 API Key"
                />
              </div>
              <label>
                <span>测试模型</span>
                <EditableModelSelect
                  value={provider.testModelId ?? ""}
                  onChange={(value) => updateProvider("testModelId", value)}
                  listId={`test-model-options-${provider.id}`}
                  options={[...new Set([...(provider.manualModelIds ?? []), ...provider.models.map((model) => model.id)])]}
                />
                <small>自动读取模型列表后可下拉选择；也可以直接输入列表中没有的模型 ID。</small>
              </label>
              <div className="secret-state-line">
                <span>API Key 状态</span>
                <SecretStatusPill handle={provider.credential} />
              </div>
            </div>

            <div className="config-actions">
              <button onClick={() => void saveModelSettings()} disabled={savingAnyConfig} title="只保存 AI 模型区配置和当前渠道 API Key"><Save size={16} />{savingModel ? "保存中" : "保存模型配置"}</button>
              <button onClick={() => void verifyModelProvider()} disabled={verifyingModel || savingAnyConfig || hasUnsavedModelConfig || hasPendingApiSecret} title={hasUnsavedModelConfig || hasPendingApiSecret ? "请先保存 AI 模型区配置和当前渠道密钥" : "按当前目录方式获取或使用手工模型，并执行所选测试模型的最小对话"}><KeyRound size={16} />{verifyingModel ? "测试中" : "测试渠道"}</button>
            </div>

            <details className="setup-advanced-details phase27-advanced-details">
              <summary>高级设置</summary>
              <div className="config-fields">
                <label>
                  <span>接口协议</span>
                  <select value={provider.providerType} onChange={(event) => updateProvider("providerType", event.target.value)}>
                    <option value="openai-compatible">OpenAI Compatible</option>
                    <option value="anthropic-compatible">Anthropic Compatible</option>
                    <option value="deepseek">DeepSeek（OpenAI 协议）</option>
                    <option value="custom">自定义 OpenAI 协议</option>
                  </select>
                </label>
                <label>
                  <span>模型目录</span>
                  <input value="自动读取 /models；测试模型允许手工输入" readOnly />
                </label>
                <label>
                  <span>密钥保存时间</span>
                  <input value={formatSavedAt(provider.credential.updatedAt)} readOnly />
                </label>
              </div>
            </details>

            <details className="setup-advanced-details verification-details-fold phase27-folded-verification" open={Boolean(modelReport || modelFailed)}>
              <summary>验证详情</summary>
              <ModelProviderReportView provider={visibleModelProvider} report={modelReport} />
            </details>
          </article>
        </section>

        <section id="config-panel-feishu" role="tabpanel" aria-labelledby="config-tab-feishu" className="setup-card optional-setup-card config-tab-panel" hidden={activeConfigTab !== "feishu"}>
          <div className="setup-card-title">
            <Terminal size={18} />
            <div>
              <span className="config-eyebrow">工作台全局 · 所有客户项目共用</span>
              <h2>Feishu/Lark 连接</h2>
              <p>支持本机 Profile；保存后所有客户项目共用当前工作台配置。</p>
            </div>
            <span className={`setup-state setup-${feishuSummaryTone}`}>{feishuSummaryText}</span>
          </div>

          <div className="feishu-action-bar">
            <button type="button" onClick={() => void discoverFeishu()} disabled={discoveringFeishu}>
              <RefreshCw size={16} />{discoveringFeishu ? "检查中" : "检查 CLI 状态"}
            </button>
            <button type="button" onClick={() => void installFeishu()} disabled={installingFeishu}>
              <Download size={16} />{installingFeishu ? "安装中" : "自动安装 CLI"}
            </button>
            <button type="button" onClick={() => void openFeishuConsole()} disabled={openingFeishuConsole}>
              <ExternalLink size={16} />打开飞书后台
            </button>
          </div>

          <div className="feishu-detection-panel">
            <div>
              <span>安装状态</span>
              <strong>{feishuDiscovery ? (feishuDiscovery.installed ? "已安装" : "未安装") : "识别中"}</strong>
              <small>{feishuDiscovery?.message ?? "正在识别本机飞书 CLI。"}</small>
            </div>
            <div>
              <span>CLI 位置</span>
              <strong title={feishuDiscovery?.cliPath ?? draft.feishu.cliPath}>{feishuDiscovery?.installDir ?? "识别后显示"}</strong>
              <small>{feishuDiscovery?.version ? `版本 ${feishuDiscovery.version}` : "未读取版本"}</small>
            </div>
            <div>
              <span>本机 Profile</span>
              <strong>{feishuProfiles.length} 个</strong>
              <small>{selectedFeishuProfile ? profileDisplayName(selectedFeishuProfile) : "未选择"}</small>
            </div>
          </div>

          <div className="config-fields optional-fields">
            <label>
              <span>CLI 路径</span>
              <input value={draft.feishu.cliPath} onChange={(event) => updateFeishu("cliPath", event.target.value)} placeholder="自动识别 lark-cli" />
            </label>
            <label>
              <span>选择已有 Profile</span>
              <select value={draft.feishu.profile} onChange={(event) => updateFeishu("profile", event.target.value)}>
                <option value="">请选择公司/个人 Profile</option>
                {feishuProfiles.map((profile) => (
                  <option key={profile.name} value={profile.name}>{profileDisplayName(profile)}</option>
                ))}
                {draft.feishu.profile && !feishuProfiles.some((profile) => profile.name === draft.feishu.profile) ? (
                  <option value={draft.feishu.profile}>{draft.feishu.profile} / 新建</option>
                ) : null}
              </select>
            </label>
            <label>
              <span>新增/更新 Profile 名称</span>
              <input value={draft.feishu.profile} onChange={(event) => updateFeishu("profile", event.target.value)} placeholder="例如：company 或 personal" />
            </label>
            <label>
              <span>飞书 App ID</span>
              <input value={draft.feishu.appId} onChange={(event) => updateFeishu("appId", event.target.value)} placeholder="例如：cli_xxxxxxxxx" />
            </label>
          </div>
          <SecretInput
            id="feishu-app-secret-input"
            label="飞书 App Secret"
            value={feishuSecretEntry}
            saved={feishuCredentialSaved}
            show={showFeishuSecret}
            onChange={(value) => {
              setFeishuSecretEntry(value);
              setFeishuSecretDirty(value.length > 0);
              setFeishuReport(null);
              setFeishuProfileResult(null);
            }}
            onToggle={() => setShowFeishuSecret((show) => !show)}
            placeholder="从飞书开发者后台复制 App Secret"
            revealLabel="显示飞书 App Secret"
            hideLabel="隐藏飞书 App Secret"
          />
          <div className="secret-state-line">
            <span>App Secret 状态</span>
            <SecretStatusPill handle={draft.feishu.credential} />
          </div>
          <p className="feishu-boundary-note">切换账号只修改本项目使用的 profile；不会执行全局 profile use，也不会自动创建或发布云文档。保存配置会保存 App Secret，并在信息完整时自动写入/更新本机 lark-cli Profile；保存动作不会发起用户授权。“检查登录，必要时发起授权”在未登录时可能打开浏览器。</p>
          {hasUnsavedFeishuConfig ? <p className="inline-warning">飞书 CLI 或 Profile 有未保存改动；保存后需要重新测试。</p> : null}
          {hasPendingFeishuSecret ? <p className="inline-warning">飞书 App Secret 有新输入；保存配置会同时写入本机 CLI Profile。</p> : null}
          {visibleFeishuProfileResult ? (
            <div className={`feishu-profile-result ${visibleFeishuProfileResult.ok ? "profile-result-ok" : "profile-result-failed"}`}>
              <strong>{visibleFeishuProfileResult.ok ? "CLI Profile 已写入" : "CLI Profile 未写入"}</strong>
              <span>{visibleFeishuProfileResult.errors[0]?.message ?? visibleFeishuProfileResult.message}</span>
              {!visibleFeishuProfileResult.ok ? <small>{visibleFeishuProfileResult.errors[0]?.suggestion}</small> : null}
            </div>
          ) : null}
          <div className="config-actions">
            <button onClick={() => void saveFeishuSettings()} disabled={savingAnyConfig} title="只保存 Feishu 区配置、App Secret，并在信息完整时写入本机 CLI Profile"><Save size={16} />{savingFeishu ? "保存并写入中" : "保存 Feishu 配置"}</button>
            <button onClick={() => void verifyFeishu()} disabled={verifyingFeishu || savingAnyConfig || hasUnsavedFeishuConfig || hasPendingFeishuSecret} title={hasUnsavedFeishuConfig || hasPendingFeishuSecret ? "请先保存 Feishu 区配置；检查只读取已保存配置" : "检查当前 Profile 登录和文档 scope；未登录时会发起授权并可能打开浏览器"}><Terminal size={16} />{verifyingFeishu ? "检查或授权中" : "检查登录，必要时发起授权"}</button>
          </div>
          <details className="setup-advanced-details verification-details-fold phase27-folded-verification" open={Boolean(feishuReport || feishuFailed)}>
            <summary>验证详情</summary>
            <FeishuVerificationReportView config={visibleFeishuConfig} report={feishuReport} hasUnsavedDraft={hasUnsavedFeishuConfig} />
          </details>
        </section>

        <section id="config-panel-tools" role="tabpanel" aria-labelledby="config-tab-tools" className="setup-card config-tab-panel tool-authorization-panel" hidden={activeConfigTab !== "tools"}>
          <div className="setup-card-title">
            <ShieldCheck size={18} />
            <div>
              <span className="config-eyebrow">Project 级 · 显式授权</span>
              <h2>AI 功能授权</h2>
              <p>所有功能默认关闭。只有你在这里启用并保存后，模型才会在当前 Project 中看到对应工具。</p>
            </div>
            <span className={`setup-state setup-${Object.values(draft.agentTools).some(Boolean) ? "blue" : "neutral"}`}>{Object.values(draft.agentTools).filter(Boolean).length} / 5 已启用</span>
          </div>

          <div className="authorization-boundary">
            <strong>连接验证不等于允许 AI 调用</strong>
            <span>SAP 配置保存、T000 只读验证、AI 调用授权是三个独立状态；关闭授权不会删除连接和密码。</span>
          </div>

          <div className="tool-authorization-list">
            <label>
              <span><strong>当前运维项目安全上下文</strong><small>允许读取当前运维项目摘要、正式知识引用，并按需列出和读取兄弟线程的有限上下文。</small></span>
              <input type="checkbox" checked={draft.agentTools.caseContextEnabled} onChange={(event) => updateDraft((current) => ({ ...current, agentTools: { ...current.agentTools, caseContextEnabled: event.target.checked } }))} />
            </label>
            <label>
              <span><strong>已导入资料的安全摘录</strong><small>允许检索当前运维项目文件夹内已导入并净化的附件文本。</small></span>
              <input type="checkbox" checked={draft.agentTools.importedEvidenceEnabled} onChange={(event) => updateDraft((current) => ({ ...current, agentTools: { ...current.agentTools, importedEvidenceEnabled: event.target.checked } }))} />
            </label>
            <label>
              <span><strong>已发布知识</strong><small>只检索当前 Project 中经过人工审核并发布的知识。</small></span>
              <input type="checkbox" checked={draft.agentTools.publishedKnowledgeEnabled} onChange={(event) => updateDraft((current) => ({ ...current, agentTools: { ...current.agentTools, publishedKnowledgeEnabled: event.target.checked } }))} />
            </label>
            {sapProject ? <label>
              <span><strong>SAP ADT 只读对象证据</strong><small>{verifiedAdtConnectionCount > 0 ? `${verifiedAdtConnectionCount} 个真实 ADT 连接已验证；支持命名 ABAP/DDIC 对象。` : "尚无真实 ADT 连接通过验证；启用后仍会在执行前阻止读取。"}</small></span>
              <input type="checkbox" checked={draft.agentTools.sapReadonlyEnabled} onChange={(event) => updateDraft((current) => ({ ...current, agentTools: { ...current.agentTools, sapReadonlyEnabled: event.target.checked } }))} />
            </label> : null}
            {sapProject ? <label>
              <span><strong>SAP ADT 通用数据读取</strong><small>{verifiedAdtConnectionCount > 0 ? "允许 AI 根据当前问题选择 DDIC table/view/CDS，先发现字段，再以结构化筛选有界读取；结果写入当前运维项目文件夹。" : "尚无真实 ADT 连接通过验证；启用后仍不会绕过连接和 SAP 后端权限检查。"}</small></span>
              <input type="checkbox" checked={draft.agentTools.sapDataPreviewEnabled} onChange={(event) => updateDraft((current) => ({ ...current, agentTools: { ...current.agentTools, sapDataPreviewEnabled: event.target.checked } }))} />
            </label> : null}
          </div>
          <p className="feishu-boundary-note">对象取证用于读取明确命名的 ABAP/DDIC 定义；通用数据读取用于完成业务任务。AI 只能提交结构化对象、字段和筛选，SQL 由本机受控生成；全程只读、有行数上限。完整明细保存在当前运维项目文件夹，本轮模型会接收有上限的分析数据以继续完成任务。T000 验证通过不代表目标数据源一定有权限。</p>
          {hasUnsavedToolsConfig ? <p className="inline-warning">授权开关尚未保存，当前对话仍使用上次保存的状态。</p> : null}
          <div className="config-actions">
            <button type="button" onClick={() => void saveToolSettings()} disabled={savingAnyConfig}><Save size={16} />{savingTools ? "保存中" : "保存功能授权"}</button>
          </div>
        </section>

        <section id="config-panel-capabilities" role="tabpanel" aria-labelledby="config-tab-capabilities" className="setup-card config-tab-panel" hidden={activeConfigTab !== "capabilities"}>
          <div className="setup-card-title">
            <Workflow size={18} />
            <div>
              <span className="config-eyebrow">工作台全局 · 所有客户项目共用</span>
              <h2>本机 AI 增强能力</h2>
              <p>核心对话使用已配置的 AI 模型；Codex 仅用于可选的工程执行增强。</p>
            </div>
            <span className={`setup-state setup-${codexReady ? "green" : codexFailed ? "orange" : "neutral"}`}>{codexReady ? "Codex 已连接" : "不影响核心功能"}</span>
          </div>
          <div className="local-capability-summary">
            <div>
              <span>核心 AI</span>
              <strong>{readyProviderCount > 0 ? `${readyProviderCount} 个模型渠道可用` : "请先配置 AI 模型渠道"}</strong>
              <small>Work 和 Chat 的基础回复不依赖 Codex CLI。</small>
            </div>
            <div>
              <span>Codex CLI</span>
              <strong>{scanningLocalAi ? "正在扫描本机" : codexDiscovery?.installed ? `已安装${codexDiscovery.version ? ` · ${codexDiscovery.version}` : ""}` : "未安装或未识别"}</strong>
              <small>{codexDiscovery?.pathLabel ?? localAiScan?.message ?? "扫描只检查固定命令和固定目录，不读取历史聊天。"}</small>
            </div>
          </div>
          <div className="feishu-action-bar local-capability-actions">
            <button type="button" onClick={() => void scanLocalAi()} disabled={scanningLocalAi || installingLocalAi}><RefreshCw size={16} />{scanningLocalAi ? "扫描中" : "重新扫描"}</button>
            <button type="button" onClick={() => void installLocalAi()} disabled={installingLocalAi || scanningLocalAi}><Download size={16} />{installingLocalAi ? "处理中" : codexDiscovery?.installed ? "修复或更新 Codex CLI" : "安装 Codex CLI"}</button>
          </div>
          <div className="config-fields">
            <label>
              <span>增强方式</span>
              <select value={draft.codex.integrationType} onChange={(event) => updateCodex("integrationType", event.target.value)}>
                <option value="cli">本机 Codex CLI</option>
              </select>
            </label>
            <label>
              <span>Codex 命令位置</span>
              <input value={draft.codex.executablePath} onChange={(event) => updateCodex("executablePath", event.target.value)} placeholder="自动扫描，或手工选择命令位置" />
            </label>
            <label>
              <span>安装状态</span>
              <div className="readonly-row"><ConfigStatusPill status={visibleCodexConfig.codex.cliStatus} /></div>
            </label>
            <label>
              <span>登录状态</span>
              <div className="readonly-row"><ConfigStatusPill status={visibleCodexConfig.codex.loginStatus} /></div>
            </label>
            <label>
              <span>工程试跑（可选）</span>
              <div className="readonly-row"><ConfigStatusPill status={visibleCodexConfig.codex.readonlyTaskStatus} /></div>
            </label>
            <label>
              <span>版本</span>
              <input value={visibleCodexConfig.codex.version || "扫描后显示"} readOnly />
            </label>
          </div>
          <p className="feishu-boundary-note">未安装或不启用 Codex 时，Work、Chat、规范、知识库、本地文件和已配置模型仍可正常使用。系统不会读取 Codex App 历史聊天。</p>
          <div className="config-actions">
            <button onClick={() => void saveCodexSettings()} disabled={savingAnyConfig} title="只保存本机增强能力配置"><Save size={16} />{savingCodex ? "保存中" : "保存设置"}</button>
            <button onClick={() => void verifyCodex()} disabled={verifyingCodex || savingAnyConfig || hasUnsavedCodexConfig} title={hasUnsavedCodexConfig ? "请先保存设置，再验证 Codex 工程增强" : "验证 Codex CLI 登录状态和固定只读工程任务；不读取历史聊天"}><Terminal size={16} />{verifyingCodex ? "验证中" : "验证 Codex 工程增强"}</button>
          </div>
          <details className="setup-advanced-details verification-details-fold phase27-folded-verification" open={Boolean(codexReport || codexFailed || codexReady)}>
            <summary>扫描详情</summary>
            <CodexVerificationReportView config={visibleCodexConfig} report={codexReport} />
          </details>
        </section>

        <section id="config-panel-storage" role="tabpanel" aria-labelledby="config-tab-storage" className="setup-card config-tab-panel" hidden={activeConfigTab !== "storage"}>
          <div className="setup-card-title">
            <Database size={18} />
            <div>
              <h2>本地存储</h2>
              <p>路径由工作台维护，数据保留在本机，通常不需要手动编辑。</p>
            </div>
          </div>
          <div className="config-fields">
            <label><span>工作区</span><input value={draft.localStorage.workspaceRoot} readOnly /></label>
            <label><span>项目目录</span><input value={draft.localStorage.projectDir} readOnly /></label>
            <label><span>案件目录</span><input value={draft.localStorage.casesDir} readOnly /></label>
            <label><span>搜索数据库</span><input value={draft.localStorage.databasePath ?? "local-data/workbench/app.db"} readOnly /></label>
          </div>
          <div className="config-actions storage-actions">
            <button type="button" onClick={() => void createFullBackup()} disabled={transferringWorkspace} title="备份项目、案件、知识、规范、对话和系统加密后的密钥文件"><Archive size={16} />{transferringWorkspace ? "处理中" : "创建完整备份"}</button>
            <button type="button" onClick={() => void importExistingWorkspace()} disabled={transferringWorkspace || configDraftDirty} title={configDraftDirty ? "请先保存或放弃当前页面草稿" : "选择旧工作台或项目目录，校验后迁移到安装版"}><FolderInput size={16} />导入已有工作台</button>
          </div>
          <p className="feishu-boundary-note">导入前会自动备份当前安装版数据。加密密钥只适合在同一 Windows 用户下迁移；换电脑或换账号后需要重新输入并验证。</p>
        </section>
      </div>

    </section>
  );
}

export default ConfigCenter;
