# Phase 48 Project SAP 系统景观审查

审查日期：2026-07-13

## 结论

Phase 48 将 SAP 配置归位到 Project，并允许一个 Project 管理多个 SAP 系统与 Client。该模型符合真实 SAP 项目的系统景观：同一客户项目可同时包含 DEV、QAS、PRD 等系统，每个系统还可以有多个 Client。Work 任务不再把“一个登录连接”误当成“一个 Project”。

本产品是个人使用的独立产品，不宣称由 SAP 官方发布，也不把 SAP 商标授权、组织代码签名证书或所谓“官方产品资质”作为本地构建和个人分发的技术门槛。未签名安装包可能触发 Windows SmartScreen 提示，这是发布信任体验问题，不代表应用功能失效。

## 已确认

1. Project 是 SAP 系统景观的所有者，连接配置与左侧 Project 一一关联。
2. 一个 Project 可以保存多个只读 SAP 连接；每条连接分别保存 System ID、Instance Number、Client、用户、语言和 SSL 模式。
3. Instance Number 不再假定为 `00`；用户可明确填写 `02` 等真实实例编号。
4. 默认 SSL 模式按产品约定为“跳过证书校验”，页面明确提示其适用于受控内网；用户仍可切换为严格校验。
5. Work 只读取证必须选择或路由到 Project 内已验证的连接；路由无法确定时不静默猜测生产系统。
6. 所有连接保持只读，未新增激活、传输、过账、删除或批量修改能力。
7. Phase 41、48 探针覆盖多连接保存、实例编号、System ID、默认 SSL、连接路由和只读边界。

## 对抗性审查

- 同一 Project 下 DEV/QAS/PRD 以及多个 Client 不会被拆成多个业务 Project。
- 相同主机但不同 Client 或实例编号可独立保存，不会互相覆盖凭据。
- 没有可靠上下文时不会自动跨系统读取；需要用户问题、任务上下文或显式连接选择提供可审计依据。
- Renderer 不接触 SAP password，凭据仍由 Electron main process 和系统安全存储处理。
- 自动读取本机 SAP Logon 配置只能作为辅助发现，不替代用户确认，也不能保证覆盖 SAProuter、消息服务器、VPN 或自定义连接参数。

## 发布判断

Phase 48 没有代码级发布阻塞。真实 SAP 可用性仍取决于目标电脑网络、SAP 服务、账号权限和服务器配置；这属于目标环境条件，不应被误写为产品必须取得 SAP 官方授权或证书。
