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
  ".lark-cli/",
  ".feishu/",
  "SAPUILandscape.xml",
  "saplogon.ini",
  "secrets/",
  "credentials/",
  "private-credentials.json",
  "sap-credentials-prod",
  "feishu-token-prod",
  "lark-token-prod",
  "api-keys-prod",
  "sample.pem",
  "sample.pfx",
  "sample.pse",
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
  "secure-store:sec_[a-f0-9]{32}",
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

Write-Section "Runtime local data secret scan"
if (Test-Path "local-data/workbench") {
  $runtimePatterns = "secure-store:sec_|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|tenant_access_token|user_access_token|Authorization|Cookie|SAP_SESSIONID|MYSAPSSO2|password\s*[:=]|api[_-]?key\s*[:=]|token\s*[:=]"
  $runtimeHits = rg -n --no-ignore --hidden --glob "*.{md,json}" --glob "!**/secure-store/**" -- $runtimePatterns local-data/workbench
  if ($LASTEXITCODE -eq 0) {
    $runtimeHits | ForEach-Object { Write-Host $_ }
    throw "Runtime local-data contains possible secrets or auth artifacts."
  } elseif ($LASTEXITCODE -gt 1) {
    throw "Runtime local data secret scan failed."
  }
  Write-Host "OK runtime local data scan."
} else {
  Write-Host "Skipped: local-data/workbench does not exist."
}

Write-Section "IPC whitelist"
$allowedIpc = @(
  "workbench:get-state",
  "workbench:create-demo-project",
  "workbench:create-demo-case",
  "workbench:append-message",
  "workbench:get-case-files",
  "workbench:search",
  "workbench:save-project-config",
  "workbench:save-project-secret",
  "workbench:adt-verify-readonly",
  "workbench:feishu-verify-cli",
  "workbench:model-provider-verify",
  "workbench:get-project-standards",
  "workbench:standards-copy-template",
  "workbench:standards-copy-project",
  "workbench:standards-save"
)

$ipcHits = rg -n -- 'ipcMain\.handle\(\x22([^\x22]+)\x22' apps/desktop/src/main
if ($LASTEXITCODE -gt 1) {
  throw "IPC whitelist scan failed."
}
foreach ($line in $ipcHits) {
  if ($line -match 'ipcMain\.handle\("([^"]+)"') {
    $channel = $Matches[1]
    if ($allowedIpc -notcontains $channel) {
      throw "Unexpected IPC channel: $channel"
    }
    Write-Host "OK IPC: $channel"
  }
}

Write-Section "Dangerous IPC name scan"
$dangerousIpcHits = rg -n -- "get-secret|read-secret|export-secret|resolve-secret|get-api-key|read-api-key|export-api-key|resolve-api-key|list-models|chat-completions|run-command|runCommand|exec-command|shell-command|read-file|write-file|open-any-path" apps/desktop/src/main apps/desktop/src/preload
if ($LASTEXITCODE -eq 0) {
  $dangerousIpcHits | ForEach-Object { Write-Host $_ }
  throw "Dangerous IPC-like name found."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Dangerous IPC scan failed."
}

Write-Section "Secret resolution boundary"
$resolveHits = rg -n -- "resolve(Value|ProjectSecret)\(" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $resolveHits) {
    if ($line -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\](main|secureSecretStore)\.ts") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Secret resolution outside approved main-process files."
    }
    Write-Host "OK secret resolution boundary: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Secret resolution boundary scan failed."
}

Write-Section "Renderer secret-ref scan"
$rendererSecretRefHits = rg -n -- "secretRef|secure-store:sec_" apps/desktop/src/renderer apps/desktop/src/preload
if ($LASTEXITCODE -eq 0) {
  $rendererSecretRefHits | ForEach-Object { Write-Host $_ }
  throw "Renderer/preload must not access secretRef values."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Renderer secret-ref scan failed."
}

Write-Section "SAP write-operation scan"
$sapWriteHits = rg -n -- "run-sql|execute-sql|CALL\s+TRANSACTION|SUBMIT\s+|INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_/]+|MODIFY\s+[A-Za-z0-9_/]+|DELETE\s+FROM|activateObject|releaseTransport|createTransport|transportRequest" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $sapWriteHits | ForEach-Object { Write-Host $_ }
  throw "SAP write-like operation pattern found in desktop source."
} elseif ($LASTEXITCODE -gt 1) {
  throw "SAP write-operation scan failed."
}

Write-Section "Raw connector output scan"
$rawOutputHits = rg -n -- "rawStdout|rawStderr|rawResponse|rawBody|rawHeaders|responseBody|responseText|set-cookie|www-authenticate|SAP_SESSIONID|MYSAPSSO2" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $rawOutputHits | ForEach-Object { Write-Host $_ }
  throw "Raw connector output or session field found."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Raw connector output scan failed."
}

Write-Section "Case workflow safety scan"
$caseWorkflowMarkers = rg -n -- "assertNoSensitiveCaseContent|generatedFileTarget|local-workflow|safeContentSummary" apps/desktop/src/main apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0 -and $caseWorkflowMarkers.Count -ge 4) {
  Write-Host "OK case workflow safety markers found."
} elseif ($LASTEXITCODE -eq 1) {
  throw "Case workflow safety markers are missing."
} else {
  throw "Case workflow safety marker scan failed."
}

$unsafeCaseWorkflowHits = rg -n -- "path\.join\(caseRoot,\s*file\.relativePath|modelId:\s*text\(candidate\.modelId|：\$\{message\.content|用户输入：\$\{input\.content|\$\{input\.content\}" apps/desktop/src/main
if ($LASTEXITCODE -eq 0) {
  $unsafeCaseWorkflowHits | ForEach-Object { Write-Host $_ }
  throw "Case workflow may copy raw input or write generated files without path guard."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Case workflow unsafe pattern scan failed."
}

Write-Section "Standards center safety scan"
$standardsMarkers = rg -n -- "assertNoSensitiveStandardsContent|safeNormalizedStandardsContent|no-secrets-project-standards|project-standards\.json|project-standards\.md|copyProjectStandardsFromProject" apps/desktop/src/main apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0 -and $standardsMarkers.Count -ge 6) {
  Write-Host "OK standards center safety markers found."
} elseif ($LASTEXITCODE -eq 1) {
  throw "Standards center safety markers are missing."
} else {
  throw "Standards center safety marker scan failed."
}

$unsafeStandardsPathHits = rg -n -- "standardsRoot.*input|standardsRoot.*relative|project-standards\.\$\{|path\.join\(standardsRoot,\s*(input|.*relative|.*path)" apps/desktop/src/main
if ($LASTEXITCODE -eq 0) {
  $unsafeStandardsPathHits | ForEach-Object { Write-Host $_ }
  throw "Standards center may accept user-controlled standards file paths."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Standards center path scan failed."
}

$standardsLeakHits = rg -n -- "sourceContent|currentContent" apps/desktop/src/main/caseWorkflowService.ts apps/desktop/src/renderer/App.tsx
if ($LASTEXITCODE -eq 0) {
  $standardsLeakHits | ForEach-Object { Write-Host $_ }
  throw "Case workflow or main chat UI must not copy full standards content into assistant replies."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Standards full-content leak scan failed."
}

$standardsKnowledgeHits = rg -n -- "standards.*knowledge|knowledge.*standards|status:\s*['""]published['""]" apps/desktop/src/main/standardsService.ts apps/desktop/src/renderer/StandardsCenter.tsx
if ($LASTEXITCODE -eq 0) {
  $standardsKnowledgeHits | ForEach-Object { Write-Host $_ }
  throw "Standards center must not publish formal knowledge directly."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Standards knowledge-boundary scan failed."
}

Write-Section "Feishu auth artifact scan"
$feishuAuthHits = rg -n -- "device_code|verification_uri|tenant_access_token|user_access_token|authUrl|deviceCode|verificationUri|tenantAccessToken|userAccessToken" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $feishuAuthHits) {
    if ($line -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\]main\.ts") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Feishu auth artifact pattern outside main-process error redaction."
    }
    Write-Host "OK Feishu redaction marker: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Feishu auth artifact scan failed."
}

Write-Section "Child process boundary scan"
$childProcessHits = rg -n -- "execFile\(|spawn\(|exec\(" apps/desktop/src/main
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $childProcessHits) {
    if ($line -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\]feishuCliConnector\.ts") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Child process execution outside approved Feishu connector."
    }
    Write-Host "OK child process boundary: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Child process boundary scan failed."
}

Write-Section "Feishu fixed CLI command scan"
$fixedCliMarkers = rg -n -- "REAL_FEISHU_CLI_COMMANDS|toFixedCliCommand|execFile\(cliCommand" apps/desktop/src/main/feishuCliConnector.ts
if ($LASTEXITCODE -eq 0 -and $fixedCliMarkers.Count -ge 3) {
  Write-Host "OK Feishu connector uses fixed CLI command markers."
} elseif ($LASTEXITCODE -eq 1) {
  throw "Feishu connector is missing fixed CLI command markers."
} else {
  throw "Feishu fixed CLI command marker scan failed."
}

$unsafeFeishuCliHits = rg -n -- "execFile\((input|config|.*Path)|runFixedCli\(input\.cliPath|runFixedCli\(config\.cliPath|function runFixedCli\(cliPath|allowedCliNames|cliBaseName" apps/desktop/src/main
if ($LASTEXITCODE -eq 0) {
  $unsafeFeishuCliHits | ForEach-Object { Write-Host $_ }
  throw "Feishu CLI execution must not use configured paths or basename-only allowlists."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Feishu unsafe CLI execution scan failed."
}

Write-Section "Generic proxy IPC scan"
$proxyIpcHits = rg -n -- "fetch-url|proxy-request|http-proxy|network-request|open-url|request-any-url|fetchUrl|proxyRequest|openUrl" apps/desktop/src/main apps/desktop/src/preload
if ($LASTEXITCODE -eq 0) {
  $proxyIpcHits | ForEach-Object { Write-Host $_ }
  throw "Generic network proxy IPC-like name found."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Generic proxy IPC scan failed."
}

Write-Section "Model base URL safety guard scan"
$modelGuardHits = rg -n -- "isUnsafeModelHost|isDemoModelHost|metadata\.google|169\.254|真实模型渠道必须使用 HTTPS" apps/desktop/src/main/main.ts
if ($LASTEXITCODE -eq 0) {
  Write-Host "OK model URL guard markers found."
} elseif ($LASTEXITCODE -eq 1) {
  throw "Model provider validation is missing URL safety guard markers."
} else {
  throw "Model base URL guard scan failed."
}

Write-Section "Model connector boundary scan"
$modelContextHits = rg -n -- "CaseMessage|conversation|caseItem|readCaseTree|caseFiles|activeCase|workspaceStore|readFile|readdir|fs\." apps/desktop/src/main/modelProviderConnector.ts
if ($LASTEXITCODE -eq 0) {
  $modelContextHits | ForEach-Object { Write-Host $_ }
  throw "Model provider connector must not read case conversation or files."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Model connector context scan failed."
}

$messageHits = rg -n -- "messages:" apps/desktop/src/main/modelProviderConnector.ts
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $messageHits) {
    if ($line -notmatch 'messages:\s*\[\{\s*role:\s*"user",\s*content:\s*"ping"\s*\}\]') {
      $line | ForEach-Object { Write-Host $_ }
      throw "Model provider connector may only send the fixed ping chat test."
    }
    Write-Host "OK fixed model chat test: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Model connector message scan failed."
}

Write-Section "Authorization boundary scan"
$authHits = rg -n -- "Authorization|Bearer|apiKey" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $authHits) {
    if ($line -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\](main|modelProviderConnector)\.ts") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Authorization/API key material outside approved main-process files."
    }
    Write-Host "OK auth boundary: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Authorization boundary scan failed."
}

Write-Section "Desktop delete-operation scan"
$deleteHits = rg -n --glob "!dist/**" --glob "!node_modules/**" -- "rm\(|unlink|trashItem|shell\.trashItem|delete.*file|remove.*file" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $deleteHits | ForEach-Object { Write-Host $_ }
  throw "Desktop code contains file delete operation patterns. The desktop app must not expose delete."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Delete-operation scan failed."
}

Write-Section "Result"
Write-Host "Security preflight passed."
