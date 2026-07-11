# Windows 正式签名与发布证据链

本文说明正式 Windows 安装包的签名门禁。正式发布只能使用组织批准的 Authenticode 代码签名证书；仓库不会创建、提交或替代真实证书。

## 门禁原则

1. Git 工作区必须干净，构建输入必须已经提交并完成评审。
2. electron-builder 使用 `forceCodeSigning=true`，找不到真实签名身份时直接失败。
3. 文件签名固定使用 SHA-256，时间戳使用 RFC 3161 与 SHA-256。
4. 主程序、NSIS 安装器、Portable、安装器内嵌卸载器必须全部通过 Windows Authenticode 和 `SignTool verify /pa /all /v /tw`。
5. 所有产物必须使用同一个、预先锁定指纹的组织证书。
6. 每个 Git commit 只允许生成一个不可覆盖的正式发布目录。
7. 构建成功后生成 `signed-release-manifest.json` 及其 SHA-256 校验文件。
8. 必须提供经品牌与法务批准的 `release-brand-approval.json`；产品名、发布主体、appId、安装包前缀和图标哈希必须与构建配置一致。
9. 独立产品模式禁止在产品名、发布主体、appId 或安装包前缀中使用 SAP；只有提供可追溯书面授权编号时才能选择 `sap-authorized`。

品牌清单格式见 `docs/release/release-brand-approval.example.json`。正式文件默认放在 `apps/desktop/build-resources/release-brand-approval.json`，正式 ICO 必须包含 16、24、32、48 和 256 像素尺寸，主程序、安装器与卸载器必须共用同一批准文件。

## 方式一：PFX / CSC_LINK

在当前进程或 CI Secret 中配置：

```powershell
$env:WIN_CSC_LINK = "C:\secure\organization-code-signing.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<secret>"
$env:WINDOWS_EXPECTED_SIGNER_SHA1 = "<40 位证书指纹>"
npm run release:win:signed:preflight
npm run release:win:signed
```

也兼容 electron-builder 的 `CSC_LINK` 与 `CSC_KEY_PASSWORD`。`WIN_CSC_LINK`/`CSC_LINK` 可以是 PFX/P12 本地路径、HTTPS URL 或 base64；证书和密码不得写入仓库、命令历史、日志或 manifest。

`WINDOWS_EXPECTED_SIGNER_SHA1` 是证书指纹，用于锁定组织批准的签名身份。它不是产物的签名摘要算法；产物仍使用 SHA-256。

## 方式二：Windows 证书存储

证书必须安装在 `CurrentUser\My` 或 `LocalMachine\My`，包含私钥、代码签名用途并处于有效期内。

推荐使用唯一指纹：

```powershell
$env:WINDOWS_CERTIFICATE_SHA1 = "<40 位证书指纹>"
npm run release:win:signed:preflight
npm run release:win:signed
```

也可以使用证书 Subject 或 Common Name：

```powershell
$env:WINDOWS_CERTIFICATE_SUBJECT = "Organization Legal Name"
npm run release:win:signed:preflight
```

如果名称匹配多个证书，门禁会拒绝并要求改用指纹。PFX 与证书存储方式不能同时配置。

## 证据产物

正式产物位于：

```text
release/signed/<version>/<git-commit-prefix>/
```

清单记录：

- Git commit、Git tree、branch 和干净工作区状态；
- Node、npm、electron-builder、PowerShell、Windows、SignTool 版本；
- 构建配置与签名脚本的 SHA-256；
- 四类可执行产物的大小、SHA-256、版本、签名证书和时间戳证书；
- 在干净 Windows 发布主机上对最终 NSIS 包执行受控静默安装，复制实际落盘卸载器后再静默卸载，并记录来源和哈希证明。

`signed-release-manifest.sha256` 应与安装包和 manifest 一起发布到受控发布渠道。发布审批记录还应单独保存证书采购/批准证明、CI run ID、评审记录和制品仓库地址。

## 无证书验证

以下命令不创建测试证书，也不会生成可发布包：

```powershell
npm run release:win:signed:test
npm run release:win:signed:preflight
```

第一条验证拒绝路径；第二条在没有真实证书时必须失败。自签名证书、伪造时间戳或跳过签名验证均不能通过正式门禁。

为验证最终用户实际获得的卸载器，正式门禁会执行一次临时安装和卸载。构建主机如果已安装同名产品会直接失败，因此必须使用干净、隔离的 Windows 发布主机或 CI runner。

## 外部依赖

仓库无法替代以下组织输入：

- 由受信任 CA 签发、组织批准并可用的 Windows 代码签名证书；
- PFX 密码、硬件密钥访问或 CI Secret 管理；
- 可访问的 RFC 3161 时间戳服务；
- Windows SDK SignTool；
- 组织发布审批、证书轮换、吊销响应和制品渠道权限。
