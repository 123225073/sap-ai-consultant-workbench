export type ExternalConnectorLabel = "ADT Service" | "Codex CLI" | "Feishu/Lark CLI";

export type ExternalConnectorFailureKind =
  | "missing"
  | "timeout"
  | "network"
  | "authentication"
  | "permission"
  | "invalid-response"
  | "execution"
  | "configuration";

export interface ExternalConnectorUserError {
  reason: string;
  suggestion: string;
}

const SUGGESTIONS: Record<ExternalConnectorLabel, Record<ExternalConnectorFailureKind, string>> = {
  "ADT Service": {
    missing: "请确认 SAP 地址正确，并让 Basis 检查 ADT Service 是否已启用。",
    timeout: "请检查 VPN、代理和内网连接，确认 SAP 可访问后重试。",
    network: "请检查 SAP 地址、端口、VPN、代理和内网连接后重试。",
    authentication: "请重新保存 SAP 用户和密码，并确认 Client 正确。",
    permission: "请让 Basis 检查当前账号的 ADT/DDIC 只读权限；工作台不会尝试提升权限。",
    "invalid-response": "请确认地址指向 ADT Service，而不是网页登录页、SSO 门户或代理提示页。",
    execution: "请稍后重试；若仍然失败，请让管理员检查 ADT Service 和 SAP 系统日志。",
    configuration: "请检查 SAP 地址、Client、语言和证书设置后重试。"
  },
  "Codex CLI": {
    missing: "请先安装或打开 Codex App，并确认本机可以运行 codex 命令。",
    timeout: "请稍后重试，并确认 Codex 当前模型和本机网络可用。",
    network: "请检查本机网络和 Codex 服务状态后重试。",
    authentication: "请执行 codex login，或打开 Codex App 完成登录后重试。",
    permission: "请检查 Codex 本机权限和只读 sandbox 设置后重试。",
    "invalid-response": "请重新测试 Codex CLI；工作台不会保存本次原始输出。",
    execution: "请先在配置中心重新测试 Codex CLI，确认通过后再重试。",
    configuration: "请把接入方式设置为本机 Codex CLI 后重试。"
  },
  "Feishu/Lark CLI": {
    missing: "请安装 lark-cli，或在配置中心执行自动安装。",
    timeout: "请稍后重试；若正在授权，请确认浏览器中的授权流程已经完成。",
    network: "请检查本机网络以及 Feishu/Lark 服务是否可访问后重试。",
    authentication: "请完成当前 profile 的 Feishu/Lark 用户授权后重试。",
    permission: "请在 Feishu/Lark 开发者后台补齐所需权限，并重新授权。",
    "invalid-response": "请重新测试 Feishu/Lark CLI；工作台不会显示或保存本次原始输出。",
    execution: "请确认 lark-cli 可以正常运行，然后回到配置中心重试。",
    configuration: "请检查 profile、App ID 和 App Secret 配置后重试。"
  }
};

const REASONS: Record<ExternalConnectorFailureKind, (connector: ExternalConnectorLabel) => string> = {
  missing: (connector) => `未检测到可用的 ${connector}。`,
  timeout: (connector) => `${connector} 响应超时。`,
  network: (connector) => `无法连接 ${connector}。`,
  authentication: (connector) => `${connector} 认证未通过。`,
  permission: (connector) => `${connector} 权限不足。`,
  "invalid-response": (connector) => `${connector} 返回的内容无法识别。`,
  execution: (connector) => `${connector} 没有成功完成操作。`,
  configuration: (connector) => `${connector} 配置不完整或不可用。`
};

export function externalConnectorUserError(
  connector: ExternalConnectorLabel,
  kind: ExternalConnectorFailureKind
): ExternalConnectorUserError {
  return {
    reason: REASONS[kind](connector),
    suggestion: SUGGESTIONS[connector][kind]
  };
}

export function externalConnectorThrownError(copy: ExternalConnectorUserError): Error {
  return new Error(`原因：${copy.reason} 建议：${copy.suggestion}`);
}
