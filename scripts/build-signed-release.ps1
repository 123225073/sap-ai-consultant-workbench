$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($env:CSC_LINK)) {
  throw "Formal release blocked: CSC_LINK is not configured with an organization-approved Windows code-signing certificate."
}

$status = git status --porcelain
if ($LASTEXITCODE -ne 0) { throw "Unable to read the Git working tree status." }
if ($status) { throw "Formal release blocked: the Git working tree must be clean and reviewed." }

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed; formal release stopped." }
npm run verify
if ($LASTEXITCODE -ne 0) { throw "Full verification failed; formal release stopped." }
npm run package:win
if ($LASTEXITCODE -ne 0) { throw "Windows packaging failed." }

$artifacts = Get-ChildItem -LiteralPath (Join-Path $repoRoot "release\0.1.0") -Recurse -File -Filter *.exe
if (-not $artifacts) { throw "No Windows executable artifacts were found for signature verification." }

$failures = @()
foreach ($artifact in $artifacts) {
  $signature = Get-AuthenticodeSignature -LiteralPath $artifact.FullName
  if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate -or -not $signature.TimeStamperCertificate) {
    $failures += "$($artifact.FullName): signature status $($signature.Status), or trusted timestamp missing."
  }
}
if ($failures.Count -gt 0) {
  throw ("Formal release signature verification failed:`n" + ($failures -join "`n"))
}

$manifest = $artifacts | ForEach-Object {
  $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
  [ordered]@{
    file = $_.FullName.Substring($repoRoot.Length + 1)
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
    signer = $signature.SignerCertificate.Subject
    timestampSigner = $signature.TimeStamperCertificate.Subject
    signatureStatus = $signature.Status.ToString()
  }
}
$commit = (git rev-parse HEAD).Trim()
[ordered]@{
  schemaVersion = 1
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  gitCommit = $commit
  packageVersion = "0.1.0"
  artifacts = $manifest
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $repoRoot "release\0.1.0\signed-release-manifest.json")

Write-Host "Signed release, trusted timestamp, and artifact manifest verification passed."
