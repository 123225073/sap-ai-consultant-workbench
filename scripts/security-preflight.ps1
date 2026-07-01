param(
  [switch]$RequireClean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "== $Title =="
}

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

Write-Section "Git status"
git status --short
if ($RequireClean) {
  $status = git status --short
  if ($status) {
    throw "Working tree is not clean."
  }
}

Write-Section "Remote"
git remote -v

Write-Section "Ignore rules"
$ignoreTargets = @(
  ".env",
  ".env.local",
  ".sap-adt-cli/",
  ".sap-abap-cli/",
  ".sap-adt-cli-sebang/",
  "SAPUILandscape.xml",
  "saplogon.ini",
  "local-data/",
  "workspace-data/",
  "SAPAIWorkbench/",
  "customer-data/",
  "client-data/",
  "case-data/",
  "sap-real-output/",
  "exports/",
  "indexes/",
  "logs/",
  "temp/",
  "tmp/",
  "screenshots/",
  ".worktrees/"
)

foreach ($target in $ignoreTargets) {
  git check-ignore -q $target
  if ($LASTEXITCODE -ne 0) {
    throw "Missing .gitignore coverage for $target"
  }
  Write-Host "OK ignored: $target"
}

Write-Section "High-confidence secret scan"
$patterns = @(
  "-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----",
  "sk-[A-Za-z0-9]{20,}",
  "ghp_[A-Za-z0-9]{20,}",
  "github_pat_[A-Za-z0-9_]{20,}",
  "xox[baprs]-[A-Za-z0-9-]{20,}",
  "AKIA[0-9A-Z]{16}",
  "(?i)(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*['""][^'""]{8,}['""]"
)

$hits = @()
foreach ($pattern in $patterns) {
  $result = rg -n --hidden --glob "!.git/**" --glob "!node_modules/**" --glob "!dist/**" --glob "!build/**" --glob "!out/**" -- $pattern .
  if ($LASTEXITCODE -eq 0) {
    $hits += $result
  } elseif ($LASTEXITCODE -gt 1) {
    throw "Secret scan command failed for pattern: $pattern"
  }
}

if ($hits.Count -gt 0) {
  $hits | ForEach-Object { Write-Host $_ }
  throw "High-confidence secret scan found possible secrets. Review before committing."
}

Write-Section "Desktop delete-operation scan"
$deleteHits = rg -n --glob "!dist/**" --glob "!node_modules/**" -- "rm\(|unlink|trashItem|shell\.trashItem|delete.*file|remove.*file" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $deleteHits | ForEach-Object { Write-Host $_ }
  throw "Desktop code contains file delete operation patterns. Phase 1B must not expose delete."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Delete-operation scan failed."
}

Write-Section "Result"
Write-Host "Security preflight passed."
