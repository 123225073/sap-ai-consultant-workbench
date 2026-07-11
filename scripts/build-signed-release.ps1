[CmdletBinding()]
param(
  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "release-signing-common.ps1")
Set-Location $repoRoot

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "正式 Windows 发布只能在 Windows 主机上执行。"
}

$signing = Resolve-ReleaseSigningConfiguration
$brand = Resolve-ReleaseBrandApproval -RepositoryRoot $repoRoot
$signTool = Find-SignTool
Assert-CleanGitWorkingTree -RepositoryRoot $repoRoot

Write-Host "签名身份预检通过：$($signing.SourceDescription)"
Write-Host "品牌与发布主体预检通过：$($brand.ProductName) / $($brand.PublisherLegalName)"
Write-Host "预期签名证书指纹：$($signing.ExpectedSignerThumbprint)"
Write-Host "SignTool：$signTool"

if ($PreflightOnly) {
  Write-Host "正式发布签名预检通过；未执行构建。"
  exit 0
}

$rootPackage = Get-Content -Raw -Encoding utf8 (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$desktopPackage = Get-Content -Raw -Encoding utf8 (Join-Path $repoRoot "apps\desktop\package.json") | ConvertFrom-Json
$version = [string]$desktopPackage.version
if ([string]::IsNullOrWhiteSpace($version) -or $version -ne [string]$rootPackage.version) {
  throw "根 package.json 与桌面应用版本不一致，正式发布已停止。"
}

$commit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) {
  throw "无法读取当前 Git commit，正式发布已停止。"
}
$shortCommit = $commit.Substring(0, 12)
$releaseDir = Join-Path $repoRoot ("release\signed\{0}\{1}" -f $version, $shortCommit)
if (Test-Path -LiteralPath $releaseDir) {
  throw "发布目录已存在，拒绝覆盖既有证据：$releaseDir"
}

Invoke-CheckedCommand -FilePath "npm.cmd" -Arguments @("ci") -FailureMessage "npm ci 失败，正式发布已停止。"
Invoke-CheckedCommand -FilePath "npm.cmd" -Arguments @("run", "verify") -FailureMessage "全量验证失败，正式发布已停止。"

$packageArguments = @(
  "--workspace", "apps/desktop", "run", "package:win:signed", "--",
  "--config.directories.output=$releaseDir"
)
if ($signing.Mode -eq "certificateStore") {
  $packageArguments += "--config.win.signtoolOptions.certificateSha1=$($signing.ExpectedSignerThumbprint)"
}

Invoke-CheckedCommand -FilePath "npm.cmd" -Arguments $packageArguments -FailureMessage "Windows 强制签名打包失败。"

$artifacts = Get-RequiredReleaseArtifacts -ReleaseDirectory $releaseDir -Version $version -ProductName $brand.ProductName -ArtifactPrefix $brand.ArtifactPrefix
$evidence = @()
foreach ($role in @("mainApplication", "installer", "portable")) {
  $evidence += Get-AuthenticodeReleaseEvidence `
    -Role $role `
    -Path $artifacts[$role] `
    -RepositoryRoot $repoRoot `
    -SignToolPath $signTool `
    -ExpectedSignerThumbprint $signing.ExpectedSignerThumbprint
}

$evidenceDir = Join-Path $releaseDir "release-evidence"
New-Item -ItemType Directory -Path $evidenceDir | Out-Null
$uninstallerPath = Join-Path $evidenceDir "embedded-uninstaller.exe"
Export-InstalledNsisUninstaller `
  -InstallerPath $artifacts.installer `
  -DestinationPath $uninstallerPath `
  -ProductName ([string]$desktopPackage.productName) `
  -ExpectedSignerThumbprint $signing.ExpectedSignerThumbprint
$artifacts.uninstaller = $uninstallerPath

$evidence += Get-AuthenticodeReleaseEvidence `
  -Role "uninstaller" `
  -Path $artifacts.uninstaller `
  -RepositoryRoot $repoRoot `
  -SignToolPath $signTool `
  -ExpectedSignerThumbprint $signing.ExpectedSignerThumbprint

Assert-SameReleaseSigner -Evidence $evidence
Assert-CleanGitWorkingTree -RepositoryRoot $repoRoot

$manifestPath = Write-SignedReleaseManifest `
  -RepositoryRoot $repoRoot `
  -ReleaseDirectory $releaseDir `
  -Version $version `
  -Commit $commit `
  -SigningConfiguration $signing `
  -SignToolPath $signTool `
  -ArtifactEvidence $evidence `
  -InstallerPath $artifacts.installer `
  -ExtractedUninstallerPath $uninstallerPath `
  -BrandApproval $brand

Write-Host "正式 Windows 签名发布门禁通过。"
Write-Host "发布目录：$releaseDir"
Write-Host "证据清单：$manifestPath"
