$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "release-signing-common.ps1")

$trackedEnvironmentNames = @(
  "WIN_CSC_LINK",
  "CSC_LINK",
  "WINDOWS_EXPECTED_SIGNER_SHA1",
  "WINDOWS_CERTIFICATE_SHA1",
  "WINDOWS_CERTIFICATE_SUBJECT",
  "RELEASE_BRAND_APPROVAL"
)
$originalEnvironment = @{}
foreach ($name in $trackedEnvironmentNames) {
  $originalEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, "Process")
}

$passed = 0
function Assert-Throws {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$ExpectedMessage,
    [Parameter(Mandatory = $true)][string]$Name
  )
  try {
    & $Action
  } catch {
    if ($_.Exception.Message -notlike "*$ExpectedMessage*") {
      throw "测试 [$Name] 抛出了错误，但信息不符合预期：$($_.Exception.Message)"
    }
    $script:passed++
    Write-Host "通过：$Name"
    return
  }
  throw "测试 [$Name] 本应失败，但实际成功。"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("sap-ai-release-signing-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
  foreach ($name in $trackedEnvironmentNames) {
    [System.Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
  Assert-Throws -Action { Resolve-ReleaseSigningConfiguration | Out-Null } -ExpectedMessage "未配置组织 PFX/CSC_LINK" -Name "无证书时正式门禁拒绝"
  Assert-Throws -Action { Resolve-ReleaseBrandApproval -RepositoryRoot $tempRoot | Out-Null } -ExpectedMessage "缺少经品牌与法务批准" -Name "无品牌批准清单时正式门禁拒绝"

  $brandRepo = Join-Path $tempRoot "brand-repo"
  $brandDesktop = Join-Path $brandRepo "apps\desktop"
  $brandResources = Join-Path $brandDesktop "build-resources"
  New-Item -ItemType Directory -Path $brandResources -Force | Out-Null
  @{
    productName = "SAP Test Workbench"
    author = @{ name = "Independent Publisher" }
    build = @{
      productName = "SAP Test Workbench"
      appId = "online.example.sap-test"
      win = @{ icon = "build-resources/icon.ico" }
      nsis = @{ installerIcon = "build-resources/icon.ico"; uninstallerIcon = "build-resources/icon.ico"; artifactName = "SAP-Test-`${version}-`${arch}-Setup.`${ext}" }
      portable = @{ artifactName = "SAP-Test-`${version}-`${arch}-Portable.`${ext}" }
    }
  } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $brandDesktop "package.json")
  @{
    schemaVersion = 1
    mode = "independent"
    productName = "SAP Test Workbench"
    publisherLegalName = "Independent Publisher"
    appId = "online.example.sap-test"
    artifactPrefix = "SAP-Test"
    iconFile = "apps/desktop/build-resources/icon.ico"
    iconSha256 = "00" * 32
    sapAuthorizationReference = $null
  } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $brandResources "release-brand-approval.json")
  Assert-Throws -Action { Resolve-ReleaseBrandApproval -RepositoryRoot $brandRepo | Out-Null } -ExpectedMessage "独立产品模式不得" -Name "独立产品模式拒绝 SAP 品牌身份"

  $env:CSC_LINK = Join-Path $tempRoot "missing.pfx"
  $env:WINDOWS_EXPECTED_SIGNER_SHA1 = "11" * 20
  Assert-Throws -Action { Resolve-ReleaseSigningConfiguration | Out-Null } -ExpectedMessage "PFX/P12 文件不存在" -Name "不存在的 PFX 被拒绝"

  $env:CSC_LINK = "aGVsbG8="
  $env:WINDOWS_CERTIFICATE_SHA1 = "22" * 20
  Assert-Throws -Action { Resolve-ReleaseSigningConfiguration | Out-Null } -ExpectedMessage "配置冲突" -Name "PFX 与证书存储身份冲突被拒绝"

  $env:CSC_LINK = $null
  $env:WINDOWS_EXPECTED_SIGNER_SHA1 = $null
  $env:WINDOWS_CERTIFICATE_SHA1 = "00" * 20
  Assert-Throws -Action { Resolve-ReleaseSigningConfiguration | Out-Null } -ExpectedMessage "未找到匹配" -Name "不存在的证书存储身份被拒绝"

  $unsignedPath = Join-Path $tempRoot "unsigned.exe"
  [System.IO.File]::WriteAllText($unsignedPath, "not a signed executable", [System.Text.Encoding]::ASCII)
  $signTool = Find-SignTool
  Assert-Throws -Action {
    Get-AuthenticodeReleaseEvidence -Role "test" -Path $unsignedPath -RepositoryRoot $tempRoot -SignToolPath $signTool -ExpectedSignerThumbprint ("33" * 20) | Out-Null
  } -ExpectedMessage "Authenticode 验证失败" -Name "未签名产物被拒绝"

  Assert-Throws -Action {
    Export-InstalledNsisUninstaller -InstallerPath $unsignedPath -DestinationPath (Join-Path $tempRoot "never-created.exe") -ProductName "不存在的测试产品" -ExpectedSignerThumbprint ("33" * 20)
  } -ExpectedMessage "拒绝执行未通过组织 Authenticode 身份验证的安装器" -Name "未签名安装器不会被执行"

  $version = "9.9.9"
  $releaseDir = Join-Path $tempRoot "release"
  New-Item -ItemType Directory -Path (Join-Path $releaseDir "win-unpacked") | Out-Null
  foreach ($path in @(
    (Join-Path $releaseDir "win-unpacked\测试应用.exe"),
    (Join-Path $releaseDir "SAP-AI-Consultant-Workbench-$version-x64-Setup.exe"),
    (Join-Path $releaseDir "SAP-AI-Consultant-Workbench-$version-x64-Portable.exe")
  )) {
    [System.IO.File]::WriteAllBytes($path, [byte[]](0x4D, 0x5A))
  }
  $artifacts = Get-RequiredReleaseArtifacts -ReleaseDirectory $releaseDir -Version $version -ProductName "测试应用" -ArtifactPrefix "SAP-AI-Consultant-Workbench"
  if ($artifacts.Count -ne 3) {
    throw "测试 [严格产物发现] 未返回三个必需产物。"
  }
  $passed++
  Write-Host "通过：严格产物发现"

  Write-Host "发布签名定向自测全部通过：$passed 项。"
} finally {
  foreach ($name in $trackedEnvironmentNames) {
    [System.Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], "Process")
  }
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
