$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Normalize-CertificateThumbprint {
  param([Parameter(Mandatory = $true)][string]$Thumbprint)

  $normalized = ($Thumbprint -replace "[^0-9A-Fa-f]", "").ToUpperInvariant()
  if ($normalized -notmatch "^[0-9A-F]{40}$") {
    throw "证书 SHA-1 指纹必须是 40 位十六进制字符。这里的 SHA-1 仅用于证书身份定位，产物签名仍固定使用 SHA-256。"
  }
  return $normalized
}

function Get-CodeSigningCertificates {
  $certificates = @()
  foreach ($storePath in @("Cert:\CurrentUser\My", "Cert:\LocalMachine\My")) {
    if (Test-Path $storePath) {
      $certificates += Get-ChildItem $storePath -CodeSigningCert -ErrorAction Stop
    }
  }
  return @($certificates)
}

function Resolve-CertificateStoreIdentity {
  param(
    [string]$Thumbprint,
    [string]$Subject
  )

  $normalizedThumbprint = if ([string]::IsNullOrWhiteSpace($Thumbprint)) { $null } else { Normalize-CertificateThumbprint $Thumbprint }
  $subjectValue = if ([string]::IsNullOrWhiteSpace($Subject)) { $null } else { $Subject.Trim() }
  if ($null -eq $normalizedThumbprint -and $null -eq $subjectValue) {
    throw "证书存储模式需要 WINDOWS_CERTIFICATE_SHA1 或 WINDOWS_CERTIFICATE_SUBJECT。"
  }

  $matches = @(Get-CodeSigningCertificates | Where-Object {
    $thumbprintMatches = $null -eq $normalizedThumbprint -or (Normalize-CertificateThumbprint $_.Thumbprint) -eq $normalizedThumbprint
    $simpleName = $_.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    $subjectMatches = $null -eq $subjectValue -or $_.Subject -ieq $subjectValue -or $simpleName -ieq $subjectValue
    $thumbprintMatches -and $subjectMatches
  })

  if ($matches.Count -eq 0) {
    throw "Windows 证书存储中未找到匹配的组织代码签名证书。"
  }
  if ($matches.Count -gt 1) {
    throw "Windows 证书存储中找到多个匹配证书；请提供 WINDOWS_CERTIFICATE_SHA1 精确定位。"
  }

  $certificate = $matches[0]
  $now = Get-Date
  if (-not $certificate.HasPrivateKey) {
    throw "匹配的代码签名证书没有可用私钥。"
  }
  if ($certificate.NotBefore -gt $now -or $certificate.NotAfter -le $now) {
    throw "匹配的代码签名证书当前不在有效期内。"
  }

  return $certificate
}

function Assert-PfxLinkShape {
  param([Parameter(Mandatory = $true)][string]$Link)

  $value = $Link.Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "CSC_LINK/WIN_CSC_LINK 不能为空。"
  }

  $uri = $null
  if ([System.Uri]::TryCreate($value, [System.UriKind]::Absolute, [ref]$uri)) {
    if ($uri.Scheme -eq "https") {
      return
    }
    if ($uri.Scheme -eq "http") {
      throw "CSC_LINK 远程地址必须使用 HTTPS。"
    }
    if ($uri.Scheme -eq "file") {
      if (-not (Test-Path -LiteralPath $uri.LocalPath -PathType Leaf)) {
        throw "CSC_LINK 指向的 PFX/P12 文件不存在。"
      }
      return
    }
  }

  $looksLikePath = $value -match "[\\/]" -or $value -match "\.(pfx|p12)$"
  if ($looksLikePath) {
    if (-not (Test-Path -LiteralPath $value -PathType Leaf)) {
      throw "CSC_LINK 指向的 PFX/P12 文件不存在。"
    }
    $extension = [System.IO.Path]::GetExtension($value)
    if ($extension -notin @(".pfx", ".p12")) {
      throw "CSC_LINK 的本地文件必须是 .pfx 或 .p12。"
    }
  }
}

function Resolve-ReleaseSigningConfiguration {
  $pfxLink = if (-not [string]::IsNullOrWhiteSpace($env:WIN_CSC_LINK)) { $env:WIN_CSC_LINK } else { $env:CSC_LINK }
  $storeThumbprint = $env:WINDOWS_CERTIFICATE_SHA1
  $storeSubject = $env:WINDOWS_CERTIFICATE_SUBJECT
  $hasPfx = -not [string]::IsNullOrWhiteSpace($pfxLink)
  $hasStoreIdentity = -not [string]::IsNullOrWhiteSpace($storeThumbprint) -or -not [string]::IsNullOrWhiteSpace($storeSubject)

  if ($hasPfx -and $hasStoreIdentity) {
    throw "签名身份配置冲突：PFX/CSC_LINK 与 Windows 证书存储身份只能选择一种。"
  }
  if (-not $hasPfx -and -not $hasStoreIdentity) {
    throw "正式发布被阻止：未配置组织 PFX/CSC_LINK，也未配置 Windows 证书存储身份。"
  }

  if ($hasPfx) {
    Assert-PfxLinkShape -Link $pfxLink
    if ([string]::IsNullOrWhiteSpace($env:WINDOWS_EXPECTED_SIGNER_SHA1)) {
      throw "PFX/CSC_LINK 模式必须配置 WINDOWS_EXPECTED_SIGNER_SHA1，以锁定经组织批准的发布证书。"
    }
    return [pscustomobject][ordered]@{
      Mode = "pfx"
      SourceDescription = if (-not [string]::IsNullOrWhiteSpace($env:WIN_CSC_LINK)) { "WIN_CSC_LINK" } else { "CSC_LINK" }
      ExpectedSignerThumbprint = Normalize-CertificateThumbprint $env:WINDOWS_EXPECTED_SIGNER_SHA1
      StoreLocation = $null
      CertificateSubject = $null
    }
  }

  $certificate = Resolve-CertificateStoreIdentity -Thumbprint $storeThumbprint -Subject $storeSubject
  return [pscustomobject][ordered]@{
    Mode = "certificateStore"
    SourceDescription = "Windows Certificate Store"
    ExpectedSignerThumbprint = Normalize-CertificateThumbprint $certificate.Thumbprint
    StoreLocation = $certificate.PSParentPath
    CertificateSubject = $certificate.Subject
  }
}

function Resolve-ReleaseBrandApproval {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

  $approvalPath = if ([string]::IsNullOrWhiteSpace($env:RELEASE_BRAND_APPROVAL)) {
    Join-Path $RepositoryRoot "apps\desktop\build-resources\release-brand-approval.json"
  } else {
    $configuredPath = if ([System.IO.Path]::IsPathRooted($env:RELEASE_BRAND_APPROVAL)) {
      $env:RELEASE_BRAND_APPROVAL
    } else {
      Join-Path $RepositoryRoot $env:RELEASE_BRAND_APPROVAL
    }
    [System.IO.Path]::GetFullPath($configuredPath)
  }
  if (-not (Test-Path -LiteralPath $approvalPath -PathType Leaf)) {
    throw "正式发布被阻止：缺少经品牌与法务批准的 release-brand-approval.json。"
  }

  $approval = Get-Content -Raw -Encoding utf8 -LiteralPath $approvalPath | ConvertFrom-Json
  foreach ($field in @("mode", "productName", "publisherLegalName", "appId", "artifactPrefix", "iconFile", "iconSha256")) {
    $property = $approval.PSObject.Properties[$field]
    $value = if ($null -eq $property) { $null } else { $property.Value }
    if ([string]::IsNullOrWhiteSpace([string]$value) -or [string]$value -match "<.+>") {
      throw "品牌批准清单字段无效或仍是占位符：$field"
    }
  }
  if ($approval.schemaVersion -ne 1 -or $approval.mode -notin @("independent", "sap-authorized")) {
    throw "品牌批准清单版本或发布模式无效。"
  }

  $desktopPackagePath = Join-Path $RepositoryRoot "apps\desktop\package.json"
  $desktopPackage = Get-Content -Raw -Encoding utf8 -LiteralPath $desktopPackagePath | ConvertFrom-Json
  $authorName = if ($desktopPackage.author -is [string]) { [string]$desktopPackage.author } else { [string]$desktopPackage.author.name }
  if ([string]$desktopPackage.productName -cne [string]$approval.productName -or
      [string]$desktopPackage.build.productName -cne [string]$approval.productName -or
      [string]$desktopPackage.build.appId -cne [string]$approval.appId -or
      $authorName -cne [string]$approval.publisherLegalName) {
    throw "package.json 的产品名、appId 或发布主体与品牌批准清单不一致。"
  }

  $sapBrandPattern = "(?i)(^|[^A-Za-z])SAP([^A-Za-z]|$)"
  $identityText = @($approval.productName, $approval.publisherLegalName, $approval.appId, $approval.artifactPrefix) -join " | "
  if ($approval.mode -eq "independent" -and $identityText -match $sapBrandPattern) {
    throw "独立产品模式不得在产品名、发布主体、appId 或安装包前缀中使用 SAP 品牌。"
  }
  if ($approval.mode -eq "sap-authorized" -and [string]::IsNullOrWhiteSpace([string]$approval.sapAuthorizationReference)) {
    throw "SAP 授权模式必须提供可追溯的书面授权记录编号。"
  }

  $iconPath = [System.IO.Path]::GetFullPath((Join-Path $RepositoryRoot ([string]$approval.iconFile)))
  $repoPrefix = [System.IO.Path]::GetFullPath($RepositoryRoot).TrimEnd("\") + "\"
  if (-not $iconPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $iconPath -PathType Leaf) -or
      [System.IO.Path]::GetExtension($iconPath) -ine ".ico") {
    throw "品牌批准图标必须是仓库内可跟踪的 .ico 文件。"
  }
  $actualIconHash = (Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash
  if ($actualIconHash -cne ([string]$approval.iconSha256).ToUpperInvariant()) {
    throw "正式图标 SHA-256 与品牌批准清单不一致。"
  }

  $iconBytes = [System.IO.File]::ReadAllBytes($iconPath)
  if ($iconBytes.Length -lt 22 -or [BitConverter]::ToUInt16($iconBytes, 2) -ne 1) {
    throw "正式图标不是有效的 Windows ICO。"
  }
  $iconCount = [BitConverter]::ToUInt16($iconBytes, 4)
  if ($iconBytes.Length -lt (6 + 16 * $iconCount)) { throw "正式图标目录损坏。" }
  $sizes = @()
  for ($index = 0; $index -lt $iconCount; $index++) {
    $offset = 6 + 16 * $index
    $width = if ($iconBytes[$offset] -eq 0) { 256 } else { [int]$iconBytes[$offset] }
    $height = if ($iconBytes[$offset + 1] -eq 0) { 256 } else { [int]$iconBytes[$offset + 1] }
    if ($width -eq $height) { $sizes += $width }
  }
  foreach ($requiredSize in @(16, 24, 32, 48, 256)) {
    if ($sizes -notcontains $requiredSize) { throw "正式图标缺少 ${requiredSize}x${requiredSize} 尺寸。" }
  }

  $desktopRoot = Join-Path $RepositoryRoot "apps\desktop"
  foreach ($iconSetting in @($desktopPackage.build.win.icon, $desktopPackage.build.nsis.installerIcon, $desktopPackage.build.nsis.uninstallerIcon)) {
    if ([string]::IsNullOrWhiteSpace([string]$iconSetting)) {
      throw "package.json 必须显式配置主程序、安装器和卸载器图标。"
    }
  }
  $packageIcon = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot ([string]$desktopPackage.build.win.icon)))
  $installerIcon = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot ([string]$desktopPackage.build.nsis.installerIcon)))
  $uninstallerIcon = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot ([string]$desktopPackage.build.nsis.uninstallerIcon)))
  if (@($packageIcon, $installerIcon, $uninstallerIcon) | Where-Object { $_ -ine $iconPath }) {
    throw "主程序、安装器和卸载器必须使用同一份批准图标。"
  }
  if (-not ([string]$desktopPackage.build.nsis.artifactName).StartsWith("$($approval.artifactPrefix)-") -or
      -not ([string]$desktopPackage.build.portable.artifactName).StartsWith("$($approval.artifactPrefix)-")) {
    throw "安装包文件名前缀与品牌批准清单不一致。"
  }

  return [pscustomobject][ordered]@{
    ApprovalPath = $approvalPath
    Mode = [string]$approval.mode
    ProductName = [string]$approval.productName
    PublisherLegalName = [string]$approval.publisherLegalName
    AppId = [string]$approval.appId
    ArtifactPrefix = [string]$approval.artifactPrefix
    IconPath = $iconPath
    IconSha256 = $actualIconHash
    SapAuthorizationReference = [string]$approval.sapAuthorizationReference
  }
}

function Find-SignTool {
  $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kitsRoot) {
    $candidate = Get-ChildItem -LiteralPath $kitsRoot -Recurse -Filter "signtool.exe" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
      Select-Object -First 1
    if ($null -ne $candidate) {
      return $candidate.FullName
    }
  }

  throw "未找到 Windows SDK SignTool，无法建立可信 Authenticode 验证证据。"
}

function Assert-CleanGitWorkingTree {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

  $status = & git -C $RepositoryRoot status --porcelain=v1 --untracked-files=all
  if ($LASTEXITCODE -ne 0) {
    throw "无法读取 Git 工作区状态。"
  }
  if ($status) {
    throw "正式发布被阻止：Git 工作区必须干净并已完成评审。"
  }
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage 退出码：$LASTEXITCODE"
  }
}

function Get-RequiredReleaseArtifacts {
  param(
    [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$ProductName,
    [Parameter(Mandatory = $true)][string]$ArtifactPrefix
  )

  $required = [ordered]@{
    mainApplication = Join-Path $ReleaseDirectory ("win-unpacked\{0}.exe" -f $ProductName)
    installer = Join-Path $ReleaseDirectory ("{0}-{1}-x64-Setup.exe" -f $ArtifactPrefix, $Version)
    portable = Join-Path $ReleaseDirectory ("{0}-{1}-x64-Portable.exe" -f $ArtifactPrefix, $Version)
  }
  foreach ($entry in $required.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) {
      throw "缺少正式发布必需产物 [$($entry.Key)]：$($entry.Value)"
    }
  }
  return $required
}

function Get-InstalledProductEntries {
  param(
    [Parameter(Mandatory = $true)][string]$ProductName
  )

  $entries = @()
  foreach ($registryPath in @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )) {
    $entries += Get-ItemProperty $registryPath -ErrorAction SilentlyContinue |
      Where-Object {
        $displayNameProperty = $_.PSObject.Properties["DisplayName"]
        $null -ne $displayNameProperty -and $displayNameProperty.Value -eq $ProductName
      }
  }
  return @($entries)
}

function Export-InstalledNsisUninstaller {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string]$ProductName,
    [Parameter(Mandatory = $true)][string]$ExpectedSignerThumbprint
  )

  if (Test-Path -LiteralPath $DestinationPath) {
    throw "卸载器证据路径已存在，拒绝覆盖：$DestinationPath"
  }
  if (@(Get-InstalledProductEntries -ProductName $ProductName).Count -gt 0) {
    throw "构建主机已经安装同名产品。为避免破坏现有安装，卸载器证据验证只能在干净 Windows 发布主机执行。"
  }

  $installerSignature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
  if ($installerSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
      $null -eq $installerSignature.SignerCertificate -or
      (Normalize-CertificateThumbprint $installerSignature.SignerCertificate.Thumbprint) -ne (Normalize-CertificateThumbprint $ExpectedSignerThumbprint)) {
    throw "拒绝执行未通过组织 Authenticode 身份验证的安装器。"
  }

  $installRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("sap-ai-release-uninstaller-" + [guid]::NewGuid().ToString("N"))
  if (Test-Path -LiteralPath $installRoot) {
    throw "临时安装路径意外存在：$installRoot"
  }

  $uninstaller = $null
  $installed = $false
  try {
    $installProcess = Start-Process -FilePath $InstallerPath -ArgumentList @("/S", "/currentuser", "/D=$installRoot") -Wait -PassThru
    if ($installProcess.ExitCode -ne 0) {
      throw "NSIS 静默验证安装失败，退出码：$($installProcess.ExitCode)"
    }
    $installed = $true

    $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter "Uninstall*.exe" -File -ErrorAction SilentlyContinue)
    if ($uninstallers.Count -ne 1) {
      throw "验证安装后未找到唯一卸载器。"
    }
    $uninstaller = $uninstallers[0].FullName
    Copy-Item -LiteralPath $uninstaller -Destination $DestinationPath
  } finally {
    if ($installed -and $null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
      $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @("/S") -Wait -PassThru
      if ($uninstallProcess.ExitCode -ne 0) {
        throw "NSIS 验证卸载失败，退出码：$($uninstallProcess.ExitCode)"
      }
    }
  }

  $deadline = (Get-Date).AddSeconds(20)
  while ((Test-Path -LiteralPath $installRoot) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "NSIS 验证卸载后仍残留临时安装目录：$installRoot"
  }
  if (@(Get-InstalledProductEntries -ProductName $ProductName).Count -gt 0) {
    throw "NSIS 验证卸载后仍残留产品注册信息。"
  }
  if (-not (Test-Path -LiteralPath $DestinationPath -PathType Leaf)) {
    throw "验证安装过程未生成卸载器证据文件。"
  }
}

function Get-AuthenticodeReleaseEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$Role,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$SignToolPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSignerThumbprint
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "待验证产物不存在 [$Role]：$Path"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Authenticode 验证失败 [$Role]：$($signature.Status) $($signature.StatusMessage)"
  }
  if ($null -eq $signature.SignerCertificate) {
    throw "产物缺少 Authenticode 签名证书 [$Role]。"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "产物缺少可信时间戳证书 [$Role]。"
  }

  $actualThumbprint = Normalize-CertificateThumbprint $signature.SignerCertificate.Thumbprint
  if ($actualThumbprint -ne (Normalize-CertificateThumbprint $ExpectedSignerThumbprint)) {
    throw "产物签名者不是经批准的组织证书 [$Role]。实际指纹：$actualThumbprint"
  }

  $now = Get-Date
  if ($signature.TimeStamperCertificate.NotBefore -gt $now -or $signature.TimeStamperCertificate.NotAfter -le $now) {
    throw "时间戳证书当前不在有效期内 [$Role]。"
  }

  $signToolOutput = & $SignToolPath verify /pa /all /v /tw $Path 2>&1
  $signToolExitCode = $LASTEXITCODE
  if ($signToolExitCode -ne 0) {
    $summary = ($signToolOutput | Select-Object -Last 12) -join "`n"
    throw "SignTool 可信时间戳验证失败 [$Role]，退出码 $signToolExitCode：`n$summary"
  }

  $fileInfo = Get-Item -LiteralPath $Path
  $versionInfo = $fileInfo.VersionInfo
  return [pscustomobject][ordered]@{
    role = $Role
    file = $fileInfo.FullName.Substring($RepositoryRoot.Length).TrimStart("\")
    bytes = $fileInfo.Length
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    fileVersion = $versionInfo.FileVersion
    productVersion = $versionInfo.ProductVersion
    signatureStatus = $signature.Status.ToString()
    verificationPolicy = "SignTool verify /pa /all /v /tw"
    signer = [ordered]@{
      subject = $signature.SignerCertificate.Subject
      issuer = $signature.SignerCertificate.Issuer
      thumbprint = $actualThumbprint
      serialNumber = $signature.SignerCertificate.SerialNumber
      notBefore = $signature.SignerCertificate.NotBefore.ToUniversalTime().ToString("o")
      notAfter = $signature.SignerCertificate.NotAfter.ToUniversalTime().ToString("o")
    }
    timestamp = [ordered]@{
      subject = $signature.TimeStamperCertificate.Subject
      issuer = $signature.TimeStamperCertificate.Issuer
      thumbprint = Normalize-CertificateThumbprint $signature.TimeStamperCertificate.Thumbprint
      serialNumber = $signature.TimeStamperCertificate.SerialNumber
      notBefore = $signature.TimeStamperCertificate.NotBefore.ToUniversalTime().ToString("o")
      notAfter = $signature.TimeStamperCertificate.NotAfter.ToUniversalTime().ToString("o")
    }
  }
}

function Assert-SameReleaseSigner {
  param([Parameter(Mandatory = $true)][object[]]$Evidence)

  $thumbprints = @($Evidence | ForEach-Object { $_.signer.thumbprint } | Select-Object -Unique)
  if ($thumbprints.Count -ne 1) {
    throw "正式发布产物使用了不一致的签名证书。"
  }
}

function Write-SignedReleaseManifest {
  param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Commit,
    [Parameter(Mandatory = $true)][object]$SigningConfiguration,
    [Parameter(Mandatory = $true)][string]$SignToolPath,
    [Parameter(Mandatory = $true)][object[]]$ArtifactEvidence,
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$ExtractedUninstallerPath,
    [Parameter(Mandatory = $true)][object]$BrandApproval
  )

  $branch = (& git -C $RepositoryRoot branch --show-current).Trim()
  $tree = (& git -C $RepositoryRoot rev-parse "HEAD^{tree}").Trim()
  $nodeVersion = (& node --version).Trim()
  $npmVersion = (& npm --version).Trim()
  $electronBuilderVersion = (& node -p "require('./node_modules/electron-builder/package.json').version").Trim()
  $signToolVersion = (Get-Item -LiteralPath $SignToolPath).VersionInfo.FileVersion

  $inputFiles = @(
    "package.json",
    "package-lock.json",
    "apps\desktop\package.json",
    "scripts\build-signed-release.ps1",
    "scripts\release-signing-common.ps1"
  )
  $inputs = foreach ($relativePath in $inputFiles) {
    $fullPath = Join-Path $RepositoryRoot $relativePath
    [ordered]@{
      file = $relativePath
      sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    }
  }

  $manifest = [ordered]@{
    schemaVersion = 2
    release = [ordered]@{
      product = $BrandApproval.ProductName
      publisherLegalName = $BrandApproval.PublisherLegalName
      appId = $BrandApproval.AppId
      brandMode = $BrandApproval.Mode
      iconSha256 = $BrandApproval.IconSha256
      sapAuthorizationReference = $BrandApproval.SapAuthorizationReference
      version = $Version
      createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
      gitCommit = $Commit
      gitTree = $tree
      gitBranch = $branch
      workingTreeClean = $true
    }
    buildEnvironment = [ordered]@{
      os = [System.Environment]::OSVersion.VersionString
      machine = $env:COMPUTERNAME
      powershell = $PSVersionTable.PSVersion.ToString()
      node = $nodeVersion
      npm = $npmVersion
      electronBuilder = $electronBuilderVersion
      signTool = [ordered]@{
        path = $SignToolPath
        version = $signToolVersion
        sha256 = (Get-FileHash -LiteralPath $SignToolPath -Algorithm SHA256).Hash
      }
    }
    signingPolicy = [ordered]@{
      credentialSource = $SigningConfiguration.SourceDescription
      expectedSignerThumbprint = $SigningConfiguration.ExpectedSignerThumbprint
      fileDigest = "SHA-256"
      timestampProtocol = "RFC 3161"
      timestampDigest = "SHA-256"
      verification = "Windows Authenticode + SignTool /pa /all /v /tw"
    }
    buildInputs = @($inputs)
    artifacts = @($ArtifactEvidence)
    embeddedUninstallerProof = [ordered]@{
      installer = $InstallerPath.Substring($RepositoryRoot.Length).TrimStart("\")
      installerSha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash
      extractedFile = $ExtractedUninstallerPath.Substring($RepositoryRoot.Length).TrimStart("\")
      extractedSha256 = (Get-FileHash -LiteralPath $ExtractedUninstallerPath -Algorithm SHA256).Hash
      extractor = "controlled silent install from final NSIS artifact"
    }
  }

  $manifestPath = Join-Path $ReleaseDirectory "signed-release-manifest.json"
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
  $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
  "$manifestHash *signed-release-manifest.json" | Set-Content -LiteralPath (Join-Path $ReleaseDirectory "signed-release-manifest.sha256") -Encoding ascii
  return $manifestPath
}
