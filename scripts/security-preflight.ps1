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
  $result = rg -n --no-ignore --hidden --glob "!.git/**" --glob "!**/node_modules/**" --glob "!**/dist/**" --glob "!**/build/**" --glob "!**/out/**" --glob "!local-data/**" -- $pattern .
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
if (Test-Path "local-data") {
  $runtimePatterns = "secure-store:sec_|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|tenant_access_token|user_access_token|Authorization\s*[:=]|Cookie\s*[:=]|SAP_SESSIONID\s*[:=]|MYSAPSSO2\s*[:=]|password\s*[:=]|api[_-]?key\s*[:=]|app[_-]?secret\s*[:=]|client[_-]?secret\s*[:=]|token\s*[:=]"
  $runtimeHits = rg -n --no-ignore --hidden --glob "*.{md,json}" --glob "!**/secure-store/**" -- $runtimePatterns local-data
  if ($LASTEXITCODE -eq 0) {
    $runtimeHits | ForEach-Object { Write-Host $_ }
    throw "Runtime local-data contains possible secrets or auth artifacts."
  } elseif ($LASTEXITCODE -gt 1) {
    throw "Runtime local data secret scan failed."
  }
  Write-Host "OK runtime local data scan."
} else {
  Write-Host "Skipped: local-data does not exist."
}

Write-Section "IPC whitelist"
$allowedIpc = @(
  "workbench:get-state",
  "workbench:create-workspace-backup",
  "workbench:import-workspace",
  "workbench:create-local-project",
  "workbench:create-local-case",
  "workbench:create-daily-chat-thread",
  "workbench:switch-daily-chat-thread",
  "workbench:append-daily-chat-message",
  "workbench:append-daily-chat-message-stream",
  "workbench:switch-project",
  "workbench:hide-project-from-sidebar",
  "workbench:restore-project-to-sidebar",
  "workbench:switch-case",
  "workbench:append-message",
  "workbench:append-message-stream",
  "workbench:get-case-files",
  "workbench:preview-current-case-file",
  "workbench:search",
  "workbench:read-sap-object-evidence",
  "workbench:prepare-feishu-handoff",
  "workbench:feishu-discover-cli",
  "workbench:feishu-install-cli",
  "workbench:feishu-save-profile",
  "workbench:open-feishu-developer-console",
  "workbench:save-project-config",
  "workbench:save-project-secret",
  "workbench:adt-verify-readonly",
  "workbench:feishu-verify-cli",
  "workbench:model-provider-verify",
  "workbench:codex-verify-cli",
  "local-ai-scan",
  "local-ai-install",
  "workbench:get-project-standards",
  "workbench:standards-copy-template",
  "workbench:standards-copy-project",
  "workbench:standards-save",
  "workbench:get-project-knowledge",
  "workbench:knowledge-import-local-text",
  "workbench:knowledge-import-text-file",
  "workbench:knowledge-review-for-publish",
  "workbench:knowledge-edit-candidate",
  "workbench:knowledge-attach-to-current-case",
  "workbench:knowledge-detach-from-current-case",
  "workbench:knowledge-publish",
  "workbench:knowledge-mark-conflict",
  "workbench:knowledge-expire"
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

Write-Section "Trusted renderer IPC boundary"
$trustedRendererMarkers = @(
  @{ Pattern = "isTrustedRendererUrl"; Path = "apps/desktop/src/main/trustedRenderer.ts" },
  @{ Pattern = "assertTrustedRendererEvent"; Path = "apps/desktop/src/main/trustedRenderer.ts" },
  @{ Pattern = "trustedResponse"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "assertTrustedRendererEvent"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "setWindowOpenHandler"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "will-navigate"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "isTrustedRendererUrl(rendererUrl"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "phase17-renderer-trust-filetree-probe"; Path = "scripts/phase17-renderer-trust-filetree-probe.mjs" }
)
foreach ($marker in $trustedRendererMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK trusted renderer marker: $($marker.Pattern)"
  } else {
    throw "Trusted renderer boundary marker is missing: $($marker.Pattern)"
  }
}

$allIpcLines = Select-String -Path "apps/desktop/src/main/main.ts" -Pattern 'ipcMain\.handle\('
if (-not $allIpcLines) {
  throw "No IPC handlers found for trust-boundary scan."
}
foreach ($line in $allIpcLines) {
  if ($line.Line -notmatch "trustedResponse") {
    Write-Host "$($line.Path):$($line.LineNumber):$($line.Line)"
    throw "IPC handler is missing trustedResponse wrapper."
  }
  Write-Host "OK trusted IPC wrapper: $($line.LineNumber)"
}

Write-Section "Dangerous IPC name scan"
$dangerousIpcHits = rg -n -- "get-secret|read-secret|export-secret|resolve-secret|get-api-key|read-api-key|export-api-key|resolve-api-key|list-models|chat-completions|run-command|runCommand|exec-command|shell-command|read-file|write-file|open-any-path|preview-any-file|open-file|open-path|read-current-file|readFileArbitrary|query-sql|execute-sql|raw-sql|read-output-file|full-text-file-search|index-any-file" apps/desktop/src/main apps/desktop/src/preload
if ($LASTEXITCODE -eq 0) {
  $dangerousIpcHits | ForEach-Object { Write-Host $_ }
  throw "Dangerous IPC-like name found."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Dangerous IPC scan failed."
}

Write-Section "Phase 18 composer model selector boundary"
$phase18Markers = @(
  @{ Pattern = "providerId?: string"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "safeWorkflowProviderHint"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "modelSelectionRejected"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "eligibleProviders"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workflowInput.providerId"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "lastVerifiedModelId"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "safeDraftModelOptions"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = 'item.credential.state === "set-in-secure-store"'; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "provider.models.map"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "model-picker-panel"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "model-picker-panel"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "phase18-composer-model-selector-probe"; Path = "scripts/phase18-composer-model-selector-probe.mjs" }
)
foreach ($marker in $phase18Markers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase18 marker: $($marker.Pattern)"
  } else {
    throw "Phase 18 model selector marker is missing: $($marker.Pattern)"
  }
}

Write-Section "Project and case lifecycle safety scan"
$lifecycleMarkers = @(
  @{ Pattern = "createLocalProject"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "createLocalCase"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "switchProject"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "switchCase"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "runExclusive"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "shouldPersistNormalizedState"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "shouldPersistActiveProjectMetadata"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "normalizeLocalStorageConfig"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "assertStrictLifecycleId"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "localStorageConfigForCase"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "parseCreateLocalProjectInput"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "parseCreateLocalCaseInput"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "assertSafeLifecycleText"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "Math.random().toString(16).slice(2)}.tmp"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "createLocalProject"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "createLocalCase"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "switchProject"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "switchCase"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "workbench:create-local-project"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "workbench:create-local-case"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "workbench:switch-project"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "workbench:switch-case"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "legacyStateStorageMigration"; Path = "scripts/phase15-real-project-case-lifecycle-probe.mjs" },
  @{ Pattern = "projectOnlyStorageMigration"; Path = "scripts/phase15-real-project-case-lifecycle-probe.mjs" },
  @{ Pattern = "getStateTimestampStable"; Path = "scripts/phase15-real-project-case-lifecycle-probe.mjs" }
)
foreach ($marker in $lifecycleMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK lifecycle marker: $($marker.Pattern)"
  } else {
    throw "Project/case lifecycle safety marker is missing: $($marker.Pattern)"
  }
}

$lifecycleUnsafeHits = rg -n -- "createLocal(Project|Case)|switch(Project|Case)" apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer | Select-String -Pattern "showOpenDialog|dialog\.show|shell\.open|openExternal|openPath|execFile|spawn\(|exec\(|fetch\(|readFile\(|unlink|rm\("
if ($lifecycleUnsafeHits) {
  $lifecycleUnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Project/case lifecycle must not expose file dialogs, command execution, network calls, or delete operations."
}

$demoIpcHits = rg -n -- "workbench:create-demo-project|workbench:create-demo-case|createDemoProject:|createDemoCase:" apps/desktop/src/main/main.ts apps/desktop/src/preload/preload.ts apps/desktop/src/renderer/vite-env.d.ts
if ($LASTEXITCODE -eq 0) {
  $demoIpcHits | ForEach-Object { Write-Host $_ }
  throw "Demo project/case IPC must not be exposed to the renderer."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Demo IPC exposure scan failed."
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
$sapWriteScanTargets = @(
  "apps/desktop/src/main/adtReadonlyConnector.ts",
  "apps/desktop/src/main/caseWorkflowService.ts",
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/preload",
  "apps/desktop/src/renderer"
)
$sapWriteHits = rg -n -- "run-sql|execute-sql|CALL\s+TRANSACTION|SUBMIT\s+|INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_/]+|MODIFY\s+[A-Za-z0-9_/]+|DELETE\s+FROM|activateObject|releaseTransport|createTransport|transportRequest" $sapWriteScanTargets
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

$caseRootMarkers = @(
  @{ Pattern = "normalizeCaseSummary"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "assertInsideCasesRoot"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = '"projects", project.id, "cases"'; Path = "apps/desktop/src/main/workspaceStore.ts" }
)
foreach ($marker in $caseRootMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK case root marker: $($marker.Pattern)"
  } else {
    throw "Case root safety marker is missing: $($marker.Pattern)"
  }
}

Write-Section "Case file preview safety scan"
$previewMarkers = @(
  @{ Pattern = "previewCurrentCaseFile"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "assertPreviewRelativePath"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "assertSafePreviewFileType"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "redactPreviewContent"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "MAX_PREVIEW_BYTES"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "MAX_PREVIEW_FILE_BYTES"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "SAFE_PREVIEW_EXTENSIONS"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "BLOCKED_PREVIEW_FILENAMES"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "realpath"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "lstat"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:preview-current-case-file"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "previewCurrentCaseFile"; Path = "apps/desktop/src/preload/preload.ts" }
)
foreach ($marker in $previewMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK preview marker: $($marker.Pattern)"
  } else {
    throw "Case file preview safety marker is missing: $($marker.Pattern)"
  }
}

$fileTreeBoundaryMarkers = @(
  @{ Pattern = "assertRealPathInside"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "ensurePlainDirectory"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "safeCaseRootForAccess"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "fs.lstat(absolutePath)"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "stats.isSymbolicLink()"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "readDirectory(caseRoot"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "caseFileTreeSkipsSymlink"; Path = "scripts/phase17-renderer-trust-filetree-probe.mjs" },
  @{ Pattern = "previewRejectsSymlinkPath"; Path = "scripts/phase17-renderer-trust-filetree-probe.mjs" },
  @{ Pattern = "getCaseFilesRejectsCaseRootSymlink"; Path = "scripts/phase17-renderer-trust-filetree-probe.mjs" }
)
foreach ($marker in $fileTreeBoundaryMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK file tree boundary marker: $($marker.Pattern)"
  } else {
    throw "Case file tree boundary marker is missing: $($marker.Pattern)"
  }
}

$rendererFileReadHits = rg -n -- "node:fs|from ['""]fs['""]|require\(['""]fs['""]\)|readFile\(" apps/desktop/src/renderer apps/desktop/src/preload
if ($LASTEXITCODE -eq 0) {
  $rendererFileReadHits | ForEach-Object { Write-Host $_ }
  throw "Renderer/preload must not read files directly."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Renderer/preload file-read scan failed."
}

$desktopOpenHits = rg -n -- "shell\.openPath|shell\.openExternal|dialog\.showOpenDialog|showOpenDialog|openExternal|openPath" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $unexpectedDesktopOpenHits = @($desktopOpenHits | Where-Object {
    $_ -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\]main\.ts:.*dialog\.showOpenDialog" -and
    $_ -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\]main\.ts:.*shell\.openExternal\(FEISHU_DEVELOPER_CONSOLE_URL\)" -and
    $_ -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\]main\.ts:.*shell\.openExternal\(safeUrl\)"
  })
  if ($unexpectedDesktopOpenHits.Count -gt 0) {
    $unexpectedDesktopOpenHits | ForEach-Object { Write-Host $_ }
    throw "Desktop app must not expose system file or URL openers outside the controlled text-file import path."
  }
  $desktopOpenHits | ForEach-Object { Write-Host "OK controlled desktop opener: $_" }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Desktop opener scan failed."
}

$previewUnsafePathHits = rg -n -- "SAP ABAP|SAPUILandscape|saplogon\.ini|\.sap-adt-cli|\.sap-abap-cli" apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $previewUnsafePathHits) {
    if ($line -match "apps[/\\]desktop[/\\]src[/\\]main[/\\](workspaceStore|searchService|knowledgeService|adtEndpointResolver)\.ts") {
      Write-Host "OK desktop safety code blocks old SAP workspace marker: $line"
    } else {
      $line | ForEach-Object { Write-Host $_ }
      throw "Desktop source must not reference old SAP workspace or local SAP credential paths."
    }
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Old SAP workspace path scan failed."
}

Write-Section "Safe output summary index safety scan"
$safeIndexMarkers = @(
  @{ Pattern = "SAFE_INDEX_DIRECTORIES"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "SAFE_INDEX_EXTENSIONS"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "MAX_INDEX_FILE_BYTES"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "redactIndexableText"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "readSafeOutputSummaries"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "hasUnsafeIndexableContent"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "sourcePath: summary.relativePath"; Path = "apps/desktop/src/main/searchService.ts" },
  @{ Pattern = "searchResultLabel"; Path = "apps/desktop/src/renderer/App.tsx" }
)
foreach ($marker in $safeIndexMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK safe index marker: $($marker.Pattern)"
  } else {
    throw "Safe output summary index marker is missing: $($marker.Pattern)"
  }
}

$unsafeIndexScopeHits = rg -n -- "SAFE_INDEX_DIRECTORIES\s*=\s*new Set\(\[[^\]]*(technical|evidence|snapshots|metadata|messages|project)" apps/desktop/src/main/workspaceStore.ts
if ($LASTEXITCODE -eq 0) {
  $unsafeIndexScopeHits | ForEach-Object { Write-Host $_ }
  throw "Safe output summary index must not allow technical, evidence, snapshot, or internal state directories."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Safe output summary index scope scan failed."
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

Write-Section "Knowledge center safety scan"
$knowledgeMarkers = rg -n -- "assertNoSensitiveKnowledgeContent|normalizeProjectKnowledge|no-secrets-project-knowledge|project-knowledge\.json|project-knowledge\.md|appendKnowledgeCandidatesFromCase|publishKnowledgeItem" apps/desktop/src/main apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0 -and $knowledgeMarkers.Count -ge 7) {
  Write-Host "OK knowledge center safety markers found."
} elseif ($LASTEXITCODE -eq 1) {
  throw "Knowledge center safety markers are missing."
} else {
  throw "Knowledge center safety marker scan failed."
}

$unsafeKnowledgePathHits = rg -n -- "knowledgeRoot.*input|knowledgeRoot.*relative|project-knowledge\.\$\{|path\.join\(knowledgeRoot,\s*(input|.*relative|.*path)" apps/desktop/src/main
if ($LASTEXITCODE -eq 0) {
  $unsafeKnowledgePathHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge center may accept user-controlled knowledge file paths."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Knowledge center path scan failed."
}

$knowledgeAutoPublishHits = rg -n -- "appendKnowledgeCandidatesFromCase|createKnowledgeCandidateFromCase|status:\s*`"published`"|status:\s*'published'" apps/desktop/src/main/caseWorkflowService.ts apps/desktop/src/main/workspaceStore.ts
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $knowledgeAutoPublishHits) {
    if ($line -match "status:\s*(`"published`"|'published')") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Case workflow or workspace append path must not auto-publish knowledge."
    }
  }
  Write-Host "OK knowledge append path does not auto-publish."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Knowledge auto-publish scan failed."
}

$knowledgeUnsafeContentHits = rg -n -- "message\.content|input\.content|currentContent|sourceContent|rawStdout|rawStderr" apps/desktop/src/main/knowledgeService.ts apps/desktop/src/renderer/KnowledgeCenter.tsx
if ($LASTEXITCODE -eq 0) {
  $knowledgeUnsafeContentHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge center must not copy raw chat, standards body, or auth artifacts into knowledge records."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Knowledge unsafe content scan failed."
}

$knowledgeGuardMarkers = @(
  @{ Pattern = 'item.status === "conflicted"'; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = 'item.status === "expired"'; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "item.conflictWithIds.length > 0"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "reviewKnowledgeItemForPublish"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "reviewedContentHash"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "assertReviewedContentUnchanged"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = 'result.type === "knowledge"'; Path = "apps/desktop/src/renderer/App.tsx" }
)
foreach ($marker in $knowledgeGuardMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK knowledge guard marker: $($marker.Pattern)"
  } else {
    throw "Knowledge publish/search guard is missing: $($marker.Pattern)"
  }
}

function Get-SourceBlock {
  param(
    [string]$Path,
    [string]$StartMarker,
    [string]$EndMarker
  )
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
  $start = $source.IndexOf($StartMarker, [System.StringComparison]::Ordinal)
  if ($start -lt 0) {
    throw "Missing source block start marker: $StartMarker"
  }
  $end = $source.IndexOf($EndMarker, $start + $StartMarker.Length, [System.StringComparison]::Ordinal)
  if ($end -le $start) {
    throw "Missing source block end marker for: $StartMarker"
  }
  return $source.Substring($start, $end - $start)
}

Write-Section "Knowledge review gate scan"
$knowledgeReviewMarkers = @(
  @{ Pattern = "parseKnowledgeReviewInput"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "KNOWLEDGE_REVIEW_ALLOWED_KEYS"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "knowledgeReviewContentHash"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "reviewKnowledgeItemForPublish"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "assertReviewedContentUnchanged"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = 'item.id.startsWith("knowledge-import-")'; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = 'item.id.startsWith("knowledge-import-")'; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "reviewKnowledgeForPublish"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:knowledge-review-for-publish"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "reviewKnowledgeForPublish"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "reviewKnowledgeForPublish"; Path = "apps/desktop/src/renderer/vite-env.d.ts" },
  @{ Pattern = "knowledge-review-gate"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "publishIdentityTamperedImportedCandidateBlocked"; Path = "scripts/phase19-knowledge-review-gate-probe.mjs" },
  @{ Pattern = "phase19-knowledge-review-gate"; Path = "scripts/phase19-knowledge-review-gate-probe.mjs" }
)
foreach ($marker in $knowledgeReviewMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK knowledge review marker: $($marker.Pattern)"
  } else {
    throw "Knowledge review gate marker is missing: $($marker.Pattern)"
  }
}

$knowledgeReviewForbiddenCapabilities = @(
  "showOpenDialog",
  "dialog.show",
  "readFile(",
  "fetch(",
  "execFile(",
  "spawn(",
  "exec(",
  "openExternal",
  "openPath",
  "loadURL",
  "feishu-sync",
  "unlink",
  "rm("
)

$knowledgeReviewBlocks = @(
  @{ Name = "store review method"; Path = "apps/desktop/src/main/workspaceStore.ts"; Start = "async reviewKnowledgeForPublish(projectId: string, input: unknown)"; End = "async markKnowledgeConflicted" },
  @{ Name = "knowledge review parser"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function parseKnowledgeReviewInput"; End = "function assertStrictKnowledgeProjectId" },
  @{ Name = "knowledge review transition"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function reviewKnowledgeItemForPublish"; End = "export function publishKnowledgeItem" },
  @{ Name = "renderer review submit"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx"; Start = "async function runReview"; End = "async function runEdit" }
)
foreach ($blockSpec in $knowledgeReviewBlocks) {
  $block = Get-SourceBlock -Path $blockSpec.Path -StartMarker $blockSpec.Start -EndMarker $blockSpec.End
  foreach ($forbidden in $knowledgeReviewForbiddenCapabilities) {
    if ($block.Contains($forbidden)) {
      throw "Knowledge review $($blockSpec.Name) contains forbidden capability marker: $forbidden"
    }
  }
  Write-Host "OK knowledge review block capability scan: $($blockSpec.Name)"
}

Write-Section "Knowledge import firewall scan"
$knowledgeImportMarkers = @(
  @{ Pattern = "parseKnowledgeImportLocalTextInput"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "KNOWLEDGE_IMPORT_ALLOWED_KEYS"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "MAX_KNOWLEDGE_IMPORT_BODY_LENGTH"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "createImportedKnowledgeCandidate"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "isPhase16LocalTextImportCandidate"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "imported-knowledge-"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "assertSafeGeneratedWriteTarget"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "writeGeneratedFile"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "isSymbolicLink"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "importKnowledgeLocalText"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "writeCaseGeneratedFiles"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:knowledge-import-local-text"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "importKnowledgeLocalText"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "importKnowledgeLocalText"; Path = "apps/desktop/src/renderer/vite-env.d.ts" },
  @{ Pattern = "documentJobId"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "knowledgeItemId"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "phase16-document-ingestion-firewall"; Path = "scripts/phase16-document-ingestion-firewall-probe.mjs" }
)
foreach ($marker in $knowledgeImportMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK knowledge import marker: $($marker.Pattern)"
  } else {
    throw "Knowledge import firewall marker is missing: $($marker.Pattern)"
  }
}

$knowledgeImportForbiddenCapabilities = @(
  "showOpenDialog",
  "dialog.show",
  "readFile(",
  "fetch(",
  "execFile(",
  "spawn(",
  "exec(",
  "openExternal",
  "openPath",
  "loadURL",
  "feishu-sync",
  "unlink",
  "rm("
)

$knowledgeImportBlocks = @(
  @{ Name = "store import method"; Path = "apps/desktop/src/main/workspaceStore.ts"; Start = "async importKnowledgeLocalText(input: unknown)"; End = "async copyProjectStandardsTemplate" },
  @{ Name = "knowledge import parser"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function parseKnowledgeImportLocalTextInput"; End = "export function assertNoSensitiveKnowledgeContent" },
  @{ Name = "knowledge candidate builder"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function createImportedKnowledgeCandidate"; End = "export function createKnowledgeCandidateFromCase" },
  @{ Name = "renderer import submit"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx"; Start = "async function submitImport"; End = "if (!project || !view)" }
)
foreach ($blockSpec in $knowledgeImportBlocks) {
  $block = Get-SourceBlock -Path $blockSpec.Path -StartMarker $blockSpec.Start -EndMarker $blockSpec.End
  foreach ($forbidden in $knowledgeImportForbiddenCapabilities) {
    if ($block.Contains($forbidden)) {
      throw "Knowledge import $($blockSpec.Name) contains forbidden capability marker: $forbidden"
    }
  }
  Write-Host "OK knowledge import block capability scan: $($blockSpec.Name)"
}

$knowledgeImportUnsafeHits = rg -n -- "knowledge-import-local-text|importKnowledgeLocalText|parseKnowledgeImportLocalTextInput|createImportedKnowledgeCandidate" apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer |
  Select-String -Pattern "showOpenDialog|dialog\.show|readFile\(|fetch\(|execFile\(|spawn\(|exec\(|openExternal|openPath|loadURL|feishu-sync|unlink|rm\("
if ($knowledgeImportUnsafeHits) {
  $knowledgeImportUnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge import firewall must not read arbitrary files, open dialogs, call Feishu/network/commands, or delete."
}

$knowledgeImportPublishHits = rg -n -- "createImportedKnowledgeCandidate|importKnowledgeLocalText|knowledge-import-local-text" apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer |
  Select-String -Pattern "status:\s*['""]published['""]|publishedAt:\s*['""][^'""]+['""]|publishKnowledgeItem"
if ($knowledgeImportPublishHits) {
  $knowledgeImportPublishHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge import firewall must not auto-publish knowledge."
}

$knowledgeImportSourcePathHits = rg -n -- "sourceFilePath\s*:\s*(input|importInput|candidate|.*sourceName)|readFile\(.*sourceFilePath|path\.join\(.*sourceFilePath|openPath\(.*sourceFilePath|shell\.openPath\(.*sourceFilePath" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $knowledgeImportSourcePathHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge import sourceFilePath must be generated by the main process and must not become a filesystem path."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Knowledge import source path scan failed."
}

$knowledgeImportHits = rg -n -- "showOpenDialog|dialog\.show|readFile\(|fetch\(|execFile\(|spawn\(|exec\(|openExternal|loadURL|feishu-sync" apps/desktop/src/main/knowledgeService.ts apps/desktop/src/renderer/KnowledgeCenter.tsx
if ($LASTEXITCODE -eq 0) {
  $knowledgeImportHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge import placeholders must not read files, call Feishu, run commands, or make network requests in Phase 6."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Knowledge import placeholder scan failed."
}

$knowledgeSourcePathHits = rg -n -- "readFile\(.*sourceFilePath|path\.join\(.*sourceFilePath|openPath\(.*sourceFilePath|shell\.openPath\(.*sourceFilePath" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $knowledgeSourcePathHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge sourceFilePath must not be used as a direct filesystem path."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Knowledge source path scan failed."
}

$knowledgeDeleteHits = rg -n -- "deleteKnowledge|removeKnowledge|knowledge\.items\s*=\s*.*filter|project\.knowledge\.items\s*=\s*.*filter|unlink|rm\(" apps/desktop/src/main/knowledgeService.ts apps/desktop/src/main/workspaceStore.ts apps/desktop/src/renderer/KnowledgeCenter.tsx
if ($LASTEXITCODE -eq 0) {
  $knowledgeDeleteHits | ForEach-Object { Write-Host $_ }
  throw "Knowledge center must preserve history and must not delete knowledge items."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Knowledge delete-history scan failed."
}

Write-Section "Phase 20 controlled text file import scan"
$phase20TextFileImportMarkers = @(
  @{ Pattern = "workbench:knowledge-import-text-file"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "workbench:knowledge-import-text-file"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "importKnowledgeTextFile"; Path = "apps/desktop/src/renderer/vite-env.d.ts" },
  @{ Pattern = "importKnowledgeTextFile"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "runTextFileImport"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "KnowledgeImportTextFileInput"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "KnowledgeImportTextFileResult"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "parseKnowledgeImportTextFileInput"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "createKnowledgeImportInputFromTextFile"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "KNOWLEDGE_IMPORT_TEXT_FILE_ALLOWED_EXTENSIONS"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "decodeControlledKnowledgeTextFile"; Path = "apps/desktop/src/main/controlledTextFileImportService.ts" },
  @{ Pattern = "readControlledKnowledgeTextFile"; Path = "apps/desktop/src/main/controlledTextFileImportService.ts" },
  @{ Pattern = "phase20-controlled-text-file-import"; Path = "scripts/phase20-controlled-text-file-import-probe.mjs" }
)
foreach ($marker in $phase20TextFileImportMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase20 text file import marker: $($marker.Pattern)"
  } else {
    throw "Phase 20 controlled text file import marker is missing: $($marker.Pattern)"
  }
}

$phase20MainBlock = Get-SourceBlock -Path "apps/desktop/src/main/main.ts" -StartMarker "async function importKnowledgeTextFile" -EndMarker "function registerWorkbenchHandlers"
foreach ($required in @("dialog.showOpenDialog", "readControlledKnowledgeTextFile", "createKnowledgeImportInputFromTextFile", "store.importKnowledgeLocalText")) {
  if (-not $phase20MainBlock.Contains($required)) {
    throw "Phase 20 main import block is missing required marker: $required"
  }
}
foreach ($forbidden in @("sourceFilePath", "fetch(", "execFile(", "spawn(", "exec(", "openExternal", "openPath", "loadURL", "feishu-sync", "unlink", "rm(")) {
  if ($phase20MainBlock.Contains($forbidden)) {
    throw "Phase 20 main import block contains forbidden marker: $forbidden"
  }
}
Write-Host "OK phase20 main import block capability scan."

$phase20ReadBlock = Get-Content -Raw -Path "apps/desktop/src/main/controlledTextFileImportService.ts"
foreach ($required in @("fs.stat", "fs.readFile", "fileBuffer.length > MAX_KNOWLEDGE_IMPORT_TEXT_FILE_BYTES", "decodeControlledKnowledgeTextFile")) {
  if (-not $phase20ReadBlock.Contains($required)) {
    throw "Phase 20 controlled read block is missing required marker: $required"
  }
}
foreach ($forbidden in @("error.message", "selectedPath,", "sourceFilePath", "fetch(", "execFile(", "spawn(", "exec(", "openExternal", "openPath", "loadURL", "feishu-sync", "unlink", "rm(")) {
  if ($phase20ReadBlock.Contains($forbidden)) {
    throw "Phase 20 controlled read block contains forbidden marker: $forbidden"
  }
}
Write-Host "OK phase20 controlled read block capability scan."

$phase20RendererUnsafeHits = rg -n -- "knowledge-import-text-file|importKnowledgeTextFile|runTextFileImport|KnowledgeImportTextFile" apps/desktop/src/preload apps/desktop/src/renderer |
  Select-String -Pattern "showOpenDialog|dialog\.show|readFile\(|node:fs|from ['""]fs['""]|fetch\(|execFile\(|spawn\(|exec\(|openExternal|openPath|loadURL|feishu-sync|unlink|rm\("
if ($phase20RendererUnsafeHits) {
  $phase20RendererUnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Phase 20 renderer/preload text file import must not read files, open dialogs, call Feishu/network/commands, or delete."
}

$phase20ParserBlock = Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function parseKnowledgeImportTextFileInput" -EndMarker "function assertSafeKnowledgeImportText"
foreach ($forbidden in @("showOpenDialog", "dialog.show", "readFile(", "fetch(", "execFile(", "spawn(", "exec(", "openExternal", "openPath", "loadURL", "feishu-sync", "unlink", "rm(")) {
  if ($phase20ParserBlock.Contains($forbidden)) {
    throw "Phase 20 parser/builder block contains forbidden marker: $forbidden"
  }
}
Write-Host "OK phase20 parser/builder block capability scan."

Write-Section "Phase 21 knowledge edit conflict resolution scan"
$phase21KnowledgeEditMarkers = @(
  @{ Pattern = "parseKnowledgeEditInput"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "KNOWLEDGE_EDIT_ALLOWED_KEYS"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "editKnowledgeCandidate"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "requiresHumanReviewBeforePublish"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "editKnowledgeCandidate"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:knowledge-edit-candidate"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "editKnowledgeCandidate"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "editKnowledgeCandidate"; Path = "apps/desktop/src/renderer/vite-env.d.ts" },
  @{ Pattern = "editKnowledgeCandidate"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "runEdit"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "selectedRequiresReviewGate"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "knowledge-edit-form"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "phase21-knowledge-edit-conflict-resolution"; Path = "scripts/phase21-knowledge-edit-conflict-resolution-probe.mjs" }
)
foreach ($marker in $phase21KnowledgeEditMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase21 knowledge edit marker: $($marker.Pattern)"
  } else {
    throw "Phase 21 knowledge edit marker is missing: $($marker.Pattern)"
  }
}

$phase21AllowedKeysLine = Select-String -SimpleMatch -Pattern "KNOWLEDGE_EDIT_ALLOWED_KEYS" -Path "apps/desktop/src/main/knowledgeService.ts" | Select-Object -First 1
if (-not $phase21AllowedKeysLine) {
  throw "Phase 21 edit allowed keys marker is missing."
}
foreach ($forbiddenInput in @('"status"', '"reviewer"', '"reviewedAt"', '"reviewedContentHash"', '"reviewChecklist"', '"publishedAt"', '"sourceFilePath"')) {
  if ($phase21AllowedKeysLine.Line.Contains($forbiddenInput)) {
    throw "Phase 21 edit input must not accept forbidden field: $forbiddenInput"
  }
}
Write-Host "OK phase21 edit input allowlist excludes state, review, publish, and source path fields."

$phase21KnowledgeEditForbiddenCapabilities = @(
  "showOpenDialog",
  "dialog.show",
  "readFile(",
  "fetch(",
  "execFile(",
  "spawn(",
  "exec(",
  "openExternal",
  "openPath",
  "loadURL",
  "feishu-sync",
  "unlink",
  "rm(",
  'status: "published"',
  "publishedAt:",
  "publishKnowledgeItem"
)

$phase21KnowledgeEditBlocks = @(
  @{ Name = "store edit method"; Path = "apps/desktop/src/main/workspaceStore.ts"; Start = "async editKnowledgeCandidate(projectId: string, input: unknown)"; End = "async markKnowledgeConflicted" },
  @{ Name = "knowledge edit parser"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function parseKnowledgeEditInput"; End = "function assertStrictKnowledgeProjectId" },
  @{ Name = "knowledge edit transition"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function editKnowledgeCandidate"; End = "export function publishKnowledgeItem" },
  @{ Name = "renderer edit submit"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx"; Start = "async function runEdit"; End = "function restoreEditFields" }
)
foreach ($blockSpec in $phase21KnowledgeEditBlocks) {
  $block = Get-SourceBlock -Path $blockSpec.Path -StartMarker $blockSpec.Start -EndMarker $blockSpec.End
  foreach ($forbidden in $phase21KnowledgeEditForbiddenCapabilities) {
    if ($block.Contains($forbidden)) {
      throw "Phase 21 knowledge edit $($blockSpec.Name) contains forbidden marker: $forbidden"
    }
  }
  Write-Host "OK phase21 knowledge edit block capability scan: $($blockSpec.Name)"
}

if (-not ((Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function editKnowledgeCandidate" -EndMarker "export function publishKnowledgeItem").Contains("reviewedContentHash: null"))) {
  throw "Phase 21 edit transition must clear reviewedContentHash."
}
if (-not ((Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function editKnowledgeCandidate" -EndMarker "export function publishKnowledgeItem").Contains('status: "pending"'))) {
  throw "Phase 21 edit transition must return candidates to pending."
}
Write-Host "OK phase21 edit transition invalidates review and returns to pending."

$phase21PublishTransitionBlock = Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function publishKnowledgeItem" -EndMarker "export function markKnowledgeItemConflicted"
foreach ($required in @("requiresHumanReviewBeforePublish(item)", "hasHumanReviewRecord(item)", "assertReviewedContentUnchanged(item)")) {
  if (-not $phase21PublishTransitionBlock.Contains($required)) {
    throw "Phase 21 publish transition must require review for edited candidates: $required"
  }
}
$phase21ReviewTransitionBlock = Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function reviewKnowledgeItemForPublish" -EndMarker "export function editKnowledgeCandidate"
if (-not $phase21ReviewTransitionBlock.Contains("requiresHumanReviewBeforePublish(item)")) {
  throw "Phase 21 review transition must support edited candidates."
}
Write-Host "OK phase21 edited candidates require review before publish."

$phase21ConflictTransitionBlock = Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function markKnowledgeItemConflicted" -EndMarker "export function expireKnowledgeItem"
foreach ($required in @('item.status === "published"', 'item.status === "expired"')) {
  if (-not $phase21ConflictTransitionBlock.Contains($required)) {
    throw "Phase 21 conflict transition must keep published and expired knowledge read-only: $required"
  }
}
$phase21ExpireTransitionBlock = Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function expireKnowledgeItem" -EndMarker "export function knowledgeCounts"
foreach ($required in @('item.status === "published"', 'item.status === "expired"')) {
  if (-not $phase21ExpireTransitionBlock.Contains($required)) {
    throw "Phase 21 expire transition must keep published and expired knowledge read-only: $required"
  }
}
$phase21RendererActionsBlock = Get-SourceBlock -Path "apps/desktop/src/renderer/KnowledgeCenter.tsx" -StartMarker '<section className="knowledge-detail-actions">' -EndMarker '<section className="knowledge-timeline">'
$phase21PublishedRendererGuardCount = [regex]::Matches($phase21RendererActionsBlock, [regex]::Escape('selectedItem.status === "published"')).Count
if ($phase21PublishedRendererGuardCount -lt 2) {
  throw "Phase 21 renderer actions must disable both conflict and expire controls for published knowledge."
}
Write-Host "OK phase21 conflict and expire transitions keep published history read-only."

Write-Section "Phase 22 published knowledge case context scan"
$phase22KnowledgeContextMarkers = @(
  @{ Pattern = "CaseKnowledgeReference"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "KnowledgeCaseReferenceInput"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "knowledgeReferences"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "parseKnowledgeCaseReferenceInput"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "hasReusableReviewRecord"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "createCaseKnowledgeReference"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "phase22-published-knowledge-case-context"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "reconcileCaseKnowledgeReferences"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "caseReferenceFingerprint"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "attachPublishedKnowledgeToCurrentCase"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:knowledge-attach-to-current-case"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "attachKnowledgeToCurrentCase"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "attachKnowledgeToCurrentCase"; Path = "apps/desktop/src/renderer/vite-env.d.ts" },
  @{ Pattern = "attachKnowledgeToCurrentCase"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "runAttachToCase"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "metadataKnowledgeReferences"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "phase22-published-knowledge-case-context"; Path = "scripts/phase22-published-knowledge-case-context-probe.mjs" }
)
foreach ($marker in $phase22KnowledgeContextMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase22 knowledge context marker: $($marker.Pattern)"
  } else {
    throw "Phase 22 knowledge context marker is missing: $($marker.Pattern)"
  }
}

$phase22ForbiddenCapabilities = @(
  "showOpenDialog",
  "dialog.show",
  "readFile(",
  "fetch(",
  "execFile(",
  "spawn(",
  "exec(",
  "openExternal",
  "openPath",
  "loadURL",
  "feishu-sync",
  "unlink",
  "rm(",
  "publishKnowledgeItem",
  "content:"
)

$phase22AttachBlocks = @(
  @{ Name = "store attach method"; Path = "apps/desktop/src/main/workspaceStore.ts"; Start = "async attachPublishedKnowledgeToCurrentCase(projectId: string, input: unknown)"; End = "async markKnowledgeConflicted" },
  @{ Name = "knowledge reference parser"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function parseKnowledgeCaseReferenceInput"; End = "export function parseKnowledgeReviewInput" },
  @{ Name = "knowledge safe reference builder"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "export function createCaseKnowledgeReference"; End = "export function knowledgeCounts" },
  @{ Name = "renderer attach submit"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx"; Start = "async function runAttachToCase"; End = "async function runReview" }
)
foreach ($blockSpec in $phase22AttachBlocks) {
  $block = Get-SourceBlock -Path $blockSpec.Path -StartMarker $blockSpec.Start -EndMarker $blockSpec.End
  foreach ($forbidden in $phase22ForbiddenCapabilities) {
    if ($block.Contains($forbidden)) {
      throw "Phase 22 knowledge context $($blockSpec.Name) contains forbidden marker: $forbidden"
    }
  }
  Write-Host "OK phase22 knowledge context block capability scan: $($blockSpec.Name)"
}

$phase22ReferenceBuilderBlock = Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "export function createCaseKnowledgeReference" -EndMarker "export function knowledgeCounts"
foreach ($required in @('item.status !== "published"', "hasReusableReviewRecord(item)", "assertKnowledgePublishSafe(item)", "summary:", "sourceFilePath: null", "publishedAt:", "attachedAt")) {
  if (-not $phase22ReferenceBuilderBlock.Contains($required)) {
    throw "Phase 22 safe reference builder is missing required marker: $required"
  }
}
if ($phase22ReferenceBuilderBlock.Contains("item.content")) {
  throw "Phase 22 safe reference builder must not copy full knowledge content."
}
Write-Host "OK phase22 safe reference builder copies summary/source metadata only and requires review."

$phase22ReusableReviewBlock = Get-SourceBlock -Path "apps/desktop/src/main/knowledgeService.ts" -StartMarker "function hasReusableReviewRecord" -EndMarker "export function createCaseKnowledgeReference"
foreach ($required in @("hasHumanReviewRecord(item)", "knowledgeReviewContentHash(item)")) {
  if (-not $phase22ReusableReviewBlock.Contains($required)) {
    throw "Reusable published knowledge must require intact human review hash: $required"
  }
}
Write-Host "OK reusable published knowledge requires intact review hash."

foreach ($required in @("metadataKnowledgeReferences", "renderKnowledgeReferenceSection", "phase22-published-knowledge-case-context")) {
  $caseWorkflowHit = Select-String -SimpleMatch -Pattern $required -Path "apps/desktop/src/main/caseWorkflowService.ts"
  if (-not $caseWorkflowHit) {
    throw "Phase 22 case artifact rendering marker is missing: $required"
  }
}
Write-Host "OK phase22 case artifact rendering includes references and metadata marker."

Write-Section "Phase 24 case knowledge candidate projection scan"
$phase24CaseCandidateMarkers = @(
  @{ Pattern = "phase24-case-knowledge-candidate-projection"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "renderProblemAnalysisKnowledgeCandidate"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "isCaseGeneratedKnowledgeCandidate"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "isCaseGeneratedKnowledgeCandidate"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "caseCandidateProjection"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "safeCaseCandidateContent"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "phase24-case-knowledge-candidate-projection-probe"; Path = "scripts/phase24-case-knowledge-candidate-projection-probe.mjs" }
)
foreach ($marker in $phase24CaseCandidateMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase24 marker: $($marker.Pattern)"
  } else {
    throw "Phase 24 case knowledge candidate marker is missing: $($marker.Pattern)"
  }
}

$phase24ForbiddenCapabilities = @(
  "readFile(",
  "readdir",
  "node:fs",
  "fetch(",
  "execFile(",
  "spawn(",
  "openExternal",
  "openPath",
  "workbench:",
  "reviewKnowledgeItemForPublish",
  "publishKnowledgeItem",
  'status: "published"'
)
$phase24Blocks = @(
  @{ Name = "case candidate renderer"; Path = "apps/desktop/src/main/caseWorkflowService.ts"; Start = "function renderProblemAnalysisKnowledgeCandidate"; End = "function modeFilePlan" },
  @{ Name = "case candidate projection"; Path = "apps/desktop/src/main/knowledgeService.ts"; Start = "function caseCandidateProjection"; End = "export function appendKnowledgeCandidatesFromCase" }
)
foreach ($blockSpec in $phase24Blocks) {
  $block = Get-SourceBlock -Path $blockSpec.Path -StartMarker $blockSpec.Start -EndMarker $blockSpec.End
  foreach ($forbidden in $phase24ForbiddenCapabilities) {
    if ($block.Contains($forbidden)) {
      throw "Phase 24 case knowledge candidate $($blockSpec.Name) contains forbidden marker: $forbidden"
    }
  }
  Write-Host "OK phase24 block capability scan: $($blockSpec.Name)"
}

$phase24ProjectionRequiredMarkers = @(
  @{ Pattern = "reviewedContentHash: null"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "reviewChecklist: null"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = 'status: "pending"'; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "sourceFilePath: file.relativePath"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = 'item.status !== "published" && item.status !== "expired"'; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "confidence: null"; Path = "apps/desktop/src/main/knowledgeService.ts" },
  @{ Pattern = "selectedCaseGeneratedCandidate"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = 'selectedItem.status !== "published" && selectedItem.status !== "expired"'; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = 'item.status === "pending"'; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" }
)
foreach ($marker in $phase24ProjectionRequiredMarkers) {
  $projectionHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if (-not $projectionHit) {
    throw "Phase 24 projection/review gate marker is missing: $($marker.Pattern)"
  }
}
Write-Host "OK phase24 candidate projection keeps knowledge pending, unreviewed, and review-gated."

Write-Section "Phase 25 case file and knowledge status clarity scan"
$phase25StatusClarityMarkers = @(
  @{ Pattern = "phase25-case-file-knowledge-status-clarity"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "caseFilePurposeLabel"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "caseFilePurposeTone"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "filePreviewSubtitle"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "file-purpose-legend"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "knowledgeSourceLabel"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "knowledgeReuseLabel"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx" },
  @{ Pattern = "isInternalCaseTreeEntry"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "INTERNAL_CASE_TREE_PATH_NAMES"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "safeFilePurposeLabel"; Path = "apps/desktop/src/main/searchService.ts" },
  @{ Pattern = "safeSearchId"; Path = "apps/desktop/src/main/searchService.ts" },
  @{ Pattern = "phase25-case-file-knowledge-status-clarity-probe"; Path = "scripts/phase25-case-file-knowledge-status-clarity-probe.mjs" }
)
foreach ($marker in $phase25StatusClarityMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase25 marker: $($marker.Pattern)"
  } else {
    throw "Phase 25 status clarity marker is missing: $($marker.Pattern)"
  }
}

$phase25RendererSources = @(
  (Get-Content -Raw "apps/desktop/src/renderer/App.tsx"),
  (Get-Content -Raw "apps/desktop/src/renderer/KnowledgeCenter.tsx")
)
$phase25RendererSource = $phase25RendererSources -join "`n"
foreach ($forbidden in @(
  "readFile(",
  "showOpenDialog",
  "dialog.show",
  "openExternal",
  "openPath",
  "fetch(",
  "execFile(",
  "spawn(",
  "loadURL",
  "feishu-sync",
  "knowledge-publish-auto",
  "sap-write",
  "transport-release",
  "workbench:phase25"
)) {
  if ($phase25RendererSource.Contains($forbidden)) {
    throw "Phase 25 renderer status clarity contains forbidden capability marker: $forbidden"
  }
}
Write-Host "OK phase25 status clarity is renderer-only and adds no unsafe capability."

$phase25AppSource = Get-Content -Raw "apps/desktop/src/renderer/App.tsx"
$phase25KnowledgeSource = Get-Content -Raw "apps/desktop/src/renderer/KnowledgeCenter.tsx"
$phase25SearchSource = Get-Content -Raw "apps/desktop/src/main/searchService.ts"
$phase25WorkspaceSource = Get-Content -Raw "apps/desktop/src/main/workspaceStore.ts"
foreach ($forbiddenVisiblePath in @(
  "filePreview?.relativePath",
  "title={node.relativePath}",
  "selectedItem.sourceFilePath ?? sourceTypeLabels",
  'item.sourceFilePath ?? "",',
  '来源文件 ${item.sourceFilePath}',
  "location: node.relativePath",
  "node.relativePath.toLowerCase()",
  "{result.sourcePath}",
  "response.data.generatedFiles.join"
)) {
  if (
    $phase25AppSource.Contains($forbiddenVisiblePath) -or
    $phase25KnowledgeSource.Contains($forbiddenVisiblePath) -or
    $phase25SearchSource.Contains($forbiddenVisiblePath)
  ) {
    throw "Phase 25 must not expose internal paths in visible UI/search text: $forbiddenVisiblePath"
  }
}
foreach ($requiredBoundary in @(
  'INTERNAL_CASE_TREE_FILENAMES = new Set(["messages.json", "metadata.json", "project.json", "app-state.json"])',
  "INTERNAL_CASE_TREE_PATH_NAMES",
  "if (isInternalCaseTreeEntry(relativePath, kind)) continue",
  "safeFilePurposeLabel(node.purpose)",
  "safeSearchId(projectId, node.caseId, node.relativePath)",
  "sourcePath: null"
)) {
  if (-not ($phase25WorkspaceSource.Contains($requiredBoundary) -or $phase25SearchSource.Contains($requiredBoundary))) {
    throw "Phase 25 internal path/state boundary marker is missing: $requiredBoundary"
  }
}
Write-Host "OK phase25 hides internal state files and visible internal paths."

Write-Section "Phase 26 project visible list removal scan"
$phase26ProjectVisibilityMarkers = @(
  @{ Pattern = "HideProjectFromSidebarInput"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "hideProjectFromSidebar"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "parseHideProjectFromSidebarInput"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "projectVisibilityFingerprint"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:hide-project-from-sidebar"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "workbench:hide-project-from-sidebar"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "hideProjectFromSidebar"; Path = "apps/desktop/src/renderer/vite-env.d.ts" },
  @{ Pattern = "visibleProjects"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "hiddenProjectsVisible"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "project-actions"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "phase26-project-visible-list-removal-probe"; Path = "scripts/phase26-project-visible-list-removal-probe.mjs" }
)
foreach ($marker in $phase26ProjectVisibilityMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase26 marker: $($marker.Pattern)"
  } else {
    throw "Phase 26 project visibility marker is missing: $($marker.Pattern)"
  }
}

$phase26Sources = @(
  "apps/desktop/src/shared/workbenchTypes.ts",
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts",
  "apps/desktop/src/renderer/App.tsx"
)
$phase26UnsafeHits = rg -n -- "workbench:delete-project|deleteProject|removeProjectFiles|state\.projects\s*=\s*state\.projects\.filter|\.projects\.splice|shell\.trashItem|fs\.rm|fs\.unlink|feishu-sync|sap-write|transport-release|activateObject" $phase26Sources
if ($LASTEXITCODE -eq 0) {
  $phase26UnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Phase 26 project visibility must not delete projects, open external surfaces, or add SAP/Feishu write capabilities."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 26 unsafe capability scan failed."
}
$phase26ExternalSurfaceSources = @(
  "apps/desktop/src/main/workspaceStore.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts",
  "apps/desktop/src/renderer/App.tsx"
)
$phase26ExternalSurfaceHits = rg -n -- "openExternal|openPath|showOpenDialog|execFile\(|spawn\(" $phase26ExternalSurfaceSources
if ($LASTEXITCODE -eq 0) {
  $phase26ExternalSurfaceHits | ForEach-Object { Write-Host $_ }
  throw "Phase 26 project visibility must not add renderer/store external surfaces or command execution."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 26 external surface scan failed."
}
Write-Host "OK phase26 hides projects from the sidebar without delete or external capabilities."

Write-Section "Phase 27 config wizard safety scan"
$phase27ConfigWizardMarkers = @(
  @{ Pattern = "phase27-core-config-wizard"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "phase27-compact-status-summary"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "phase27-advanced-details"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "phase27-folded-verification"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "phase27-secret-eye-toggle"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "hasUnsavedConfig"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "onSaveSecret"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "onVerifyAdt"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "onVerifyFeishu"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "onVerifyModelProvider"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "saveAdtSettings"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "saveModelSettings"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "setup-card"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "secret-toggle-button"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "setup-summary-strip"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "phase27-core-config-wizard-probe"; Path = "scripts/phase27-core-config-wizard-probe.mjs" }
)
foreach ($marker in $phase27ConfigWizardMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase27 marker: $($marker.Pattern)"
  } else {
    throw "Phase 27 config wizard marker is missing: $($marker.Pattern)"
  }
}

$phase27RendererSources = @(
  "apps/desktop/src/renderer/ConfigCenter.tsx",
  "apps/desktop/src/renderer/styles.css"
)
$phase27UnsafeHits = rg -n -- "window\.workbench|ipcRenderer\.invoke|ipcMain\.handle|workbench:phase27|workbench:config-wizard|get-secret|read-secret|resolve-secret|get-api-key|read-api-key|secretRef|Authorization|Bearer |run-sql|execute-sql|x-csrf-token|activateObject|createTransport|releaseTransport|transportRequest|docs\s+\+create|docs\s+\+update|docs\s+\+publish|auth\s+login|auth\s+authorize|device_code|verification_uri|tenant_access_token|user_access_token|chat-completions|list-models|fetch\(|showOpenDialog|openExternal|openPath|execFile\(|spawn\(|readFile\(" $phase27RendererSources
if ($LASTEXITCODE -eq 0) {
  $phase27UnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Phase 27 config wizard must remain renderer-only and must not add unsafe IPC, secret, SAP, Feishu, model, file, network, or command capability."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 27 config wizard unsafe capability scan failed."
}

$phase27ConfusingCopyHits = rg -n -- "更换密码|更换 API Key|保存密码|保存 API Key|已安全保存；如需更换，请重新输入|先保存再测试" "apps/desktop/src/renderer/ConfigCenter.tsx"
if ($LASTEXITCODE -eq 0) {
  $phase27ConfusingCopyHits | ForEach-Object { Write-Host $_ }
  throw "Phase 27 config wizard must use unified save/test actions and must not show confusing replace-secret copy."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 27 confusing copy scan failed."
}

$phase27IpcSources = @(
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/vite-env.d.ts"
)
$phase27IpcHits = rg -n -- "workbench:phase27|workbench:config-wizard|workbench:get-secret|workbench:read-secret|workbench:chat-completions|workbench:list-models" $phase27IpcSources
if ($LASTEXITCODE -eq 0) {
  $phase27IpcHits | ForEach-Object { Write-Host $_ }
  throw "Phase 27 config wizard must not add new wizard, secret, or generic model IPC."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 27 config wizard IPC scan failed."
}
Write-Host "OK phase27 config wizard keeps existing IPC and safety boundaries."

Write-Section "Phase 28 basic new case flow safety scan"
$phase28NewCaseMarkers = @(
  @{ Pattern = "creatingCase"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "newCaseInputRef"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "focusNewCaseInput"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "phase28-new-case-flow"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "bridge.createLocalCase"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "case-create button:not(:disabled)"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "workbench:create-local-case"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "createLocalCase"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "phase28-basic-new-case-flow-probe"; Path = "scripts/phase28-basic-new-case-flow-probe.mjs" }
)
foreach ($marker in $phase28NewCaseMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase28 marker: $($marker.Pattern)"
  } else {
    throw "Phase 28 basic new case marker is missing: $($marker.Pattern)"
  }
}

$phase28PrototypeCopyHits = rg -n -- "New case title|Create case|Case title is required\.|Create a case folder in the active project|Local case created\.|输入案件名称|创建案件" "apps/desktop/src/renderer/App.tsx"
if ($LASTEXITCODE -eq 0) {
  $phase28PrototypeCopyHits | ForEach-Object { Write-Host $_ }
  throw "Phase 28 new case flow must not show prototype English copy."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 28 prototype copy scan failed."
}

$phase28RendererHits = rg -n -- "workbench:create-demo-case|createDemoCase|showOpenDialog|openExternal|openPath|execFile\(|spawn\(|fetch\(|readFile\(|unlink|(^|[^A-Za-z0-9_])rm\(" "apps/desktop/src/renderer/App.tsx" "apps/desktop/src/preload/preload.ts"
if ($LASTEXITCODE -eq 0) {
  $phase28RendererHits | ForEach-Object { Write-Host $_ }
  throw "Phase 28 new case flow must not add demo, external, command, file-read, network, or delete capability."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 28 renderer safety scan failed."
}
Write-Host "OK phase28 basic new case flow keeps local lifecycle boundaries."

Write-Section "Phase 30 secret clearing eye toggle scan"
$phase30SecretRetentionMarkers = @(
  @{ Pattern = "adtSecretDirty"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "apiSecretDirty"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "previousProjectIdRef"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "setAdtSecretDirty(false)"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "setApiSecretDirtyByProvider"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "apiInputRefs.current"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "phase30-secret-retention-eye-toggle-probe"; Path = "scripts/phase30-secret-retention-eye-toggle-probe.mjs" }
)
foreach ($marker in $phase30SecretRetentionMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase30 marker: $($marker.Pattern)"
  } else {
    throw "Phase 30 secret retention marker is missing: $($marker.Pattern)"
  }
}

$phase30UnsafeHits = rg -n -- "workbench:get-secret|workbench:read-secret|get-secret|read-secret|resolve-secret|get-api-key|read-api-key|secretRef|secure-store:sec_" "apps/desktop/src/renderer/ConfigCenter.tsx" "apps/desktop/src/preload/preload.ts"
if ($LASTEXITCODE -eq 0) {
  $phase30UnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Phase 30 must not add renderer/preload access to saved secret values."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 30 secret retention unsafe scan failed."
}
Write-Host "OK phase30 keeps secret refs and generic secret-read APIs out of renderer/preload."

Write-Section "Phase 35 config persistence, secret non-reveal, and conversation UX scan"
$phase35Markers = @(
  @{ Pattern = "DailyChatThread"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "activeChatThreadId"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = 'ipcMain.handle("workbench:create-daily-chat-thread"'; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = 'ipcMain.handle("workbench:append-daily-chat-message"'; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "parseAppendDailyChatMessageInput(input)"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "prepareDailyChatAssistantReply"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "isProviderReadyForDailyChat"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "generateDailyChat"; Path = "apps/desktop/src/main/modelProviderConnector.ts" },
  @{ Pattern = "preserveMainOwnedVerification(previousConfig, nextConfig)"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "resetChangedVerification(previousConfig, nextConfig)"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "resetSecretTargetVerification(project.config, target)"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "appendDailyChatMessage"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "groupDailyChatThreads"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = 'activeView === "chat"'; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "project-case-label"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "new-case-project-picker"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "conversation-sidebar-section"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "phase35-config-reveal-conversation-probe"; Path = "scripts/phase35-config-reveal-conversation-probe.mjs" }
)
foreach ($marker in $phase35Markers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase35 marker: $($marker.Pattern)"
  } else {
    throw "Phase 35 marker is missing: $($marker.Pattern)"
  }
}

$phase35WrongConversationHits = rg -n -- "groupConversationThreads|flatMap\(\(item\) => item\.cases\.map\(\(caseItem\) => \(\{ project: item, caseItem \}\)\)" apps/desktop/src/renderer/App.tsx
if ($LASTEXITCODE -eq 0) {
  $phase35WrongConversationHits | ForEach-Object { Write-Host $_ }
  throw "Phase 35 daily conversation must not be derived from project cases."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 35 conversation derivation scan failed."
}
Write-Host "OK phase35 keeps daily conversation independent from project cases."

$phase35DailyChatUnsafeHits = rg -n -- "readSapObjectEvidence|prepareFeishuHandoff|writeCaseMarkdown|writeCaseGeneratedFiles|ensureCaseFiles|refreshSearchIndex" apps/desktop/src/main/workspaceStore.ts
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $phase35DailyChatUnsafeHits) {
    if ($line -match "appendDailyChatMessage|createDailyChatThread|switchDailyChatThread") {
      Write-Host $line
      throw "Phase 35 daily chat methods must not call SAP, Feishu, case file writes, or case indexing."
    }
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 35 daily chat safety scan failed."
}
Write-Host "OK phase35 daily chat path has no SAP/Feishu/case-file side effects."

$savedSecretRevealHits = rg -n -- "reveal-project-secret|revealProjectSecret|ProjectSecretReveal(Input|Result)" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $savedSecretRevealHits | ForEach-Object { Write-Host $_ }
  throw "Saved secret reveal must not be exposed to preload or renderer."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Saved secret non-reveal scan failed."
}
Write-Host "OK saved secrets cannot be revealed to renderer."

Write-Section "Phase 36 Work/Chat project-folder layout scan"
$phase36Markers = @(
  @{ Pattern = "workspace-switch"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "phase40-files-only-context"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "focusNewCaseInput"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = 'navigateView("config")'; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "phase36-work-chat-project-folder-layout"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = ".workspace-switch"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = ".files-panel"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = ".other-work-boundary"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = 'sapVersion: ProjectSummary["sapVersion"]'; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = 'value === "S4" || value === "ECC" || value === "UNKNOWN"'; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "phase36-work-chat-project-folder-layout-probe"; Path = "scripts/phase36-work-chat-project-folder-layout-probe.mjs" }
)
foreach ($marker in $phase36Markers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase36 marker: $($marker.Pattern)"
  } else {
    throw "Phase 36 Work/Chat layout marker is missing: $($marker.Pattern)"
  }
}

$phase36ChatProvenance = Select-String -SimpleMatch -Pattern 'projectId: selectedSafeDraftModel ? project?.id : undefined' -Path "apps/desktop/src/renderer/App.tsx"
if (-not $phase36ChatProvenance) {
  throw "Phase 36 Chat must explicitly record the selected Project-owned model channel provenance."
}
Write-Host "OK phase36 keeps case folders separate while recording Chat model-channel provenance."

Write-Section "Phase 37 case actions and permission UI scan"
$phase37Markers = @(
  @{ Pattern = "CaseActionId"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "ActionPermissionMode"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "caseActions"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "permissionModes"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "runCaseAction"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "case-action-control"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "case-action-run-button"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "permission-mode-control"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "action-confirmation-preview"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = ".case-action-control"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = ".case-action-run-button"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = ".permission-mode-control"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = ".action-confirmation-preview"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "phase37-case-actions-permission-ui"; Path = "scripts/security-preflight.ps1" },
  @{ Pattern = "phase37-case-actions-permission-ui-probe"; Path = "scripts/phase37-case-actions-permission-ui-probe.mjs" }
)
foreach ($marker in $phase37Markers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase37 marker: $($marker.Pattern)"
  } else {
    throw "Phase 37 case action UI marker is missing: $($marker.Pattern)"
  }
}

$phase37OldModeHits = Select-String -SimpleMatch -Pattern "mode-tabs", "selectedTaskMode", "setSelectedTaskMode", "modePlaceholder", 'aria-label="任务模式"' -Path "apps/desktop/src/renderer/App.tsx", "apps/desktop/src/renderer/styles.css"
if ($phase37OldModeHits) {
  $phase37OldModeHits | ForEach-Object { Write-Host $_ }
  throw "Phase 37 Work composer must not reintroduce old task mode tabs."
}
Write-Host "OK phase37 keeps Work composer on free conversation plus on-demand case actions."

Write-Section "Phase 38 case action workflow scan"
$phase38Markers = @(
  @{ Pattern = "CaseActionId"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "ActionPermissionMode"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "actionId?: CaseActionId | null"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "permissionMode: ActionPermissionMode"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "CASE_ACTION_LABELS"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "ACTION_PERMISSION_LABELS"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "normalizeCaseActionId"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "normalizeActionPermissionMode"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "renderCaseActionFiles"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "phase38-case-action-workflow"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "permissionModeUsed"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "actionId: selectedCaseAction.id"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "permissionMode: actionPermissionMode"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "phase38-case-action-workflow-probe"; Path = "scripts/phase38-case-action-workflow-probe.mjs" },
  @{ Pattern = "phase38-case-action-workflow"; Path = "scripts/security-preflight.ps1" }
)
foreach ($marker in $phase38Markers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase38 marker: $($marker.Pattern)"
  } else {
    throw "Phase 38 case action workflow marker is missing: $($marker.Pattern)"
  }
}
Write-Host "OK phase38 persists case action and execution-preference audit context through normal case workflow."

Write-Section "Phase 31 ADT compatible verification scan"
$phase31AdtMarkers = @(
  @{ Pattern = "describeAdtFailure"; Path = "apps/desktop/src/main/adtReadonlyConnector.ts" },
  @{ Pattern = "validateAdtResponse"; Path = "apps/desktop/src/main/adtReadonlyConnector.ts" },
  @{ Pattern = "realT000(true, true, input.client)"; Path = "apps/desktop/src/main/adtReadonlyConnector.ts" },
  @{ Pattern = "verifyAdtCandidate"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = 'return connector.verify({ ...adtInputWithoutPassword(config, candidate.url), password });'; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = 'report.ok && report.system.sslMode === "skip-certificate"'; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "phase31-adt-compatible-verification-probe"; Path = "scripts/phase31-adt-compatible-verification-probe.mjs" }
)
foreach ($marker in $phase31AdtMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase31 marker: $($marker.Pattern)"
  } else {
    throw "Phase 31 ADT compatible verification marker is missing: $($marker.Pattern)"
  }
}

$phase31UnsafeHits = rg -n -- "method\s*:\s*['""](POST|PUT|PATCH|DELETE)['""]|activateObject|releaseTransport|createTransport|transportRequest|x-csrf-token|csrf" "apps/desktop/src/main/adtReadonlyConnector.ts"
if ($LASTEXITCODE -eq 0) {
  $phase31UnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Phase 31 ADT compatibility must remain fixed GET and read-only."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 31 ADT compatibility safety scan failed."
}
Write-Host "OK phase31 keeps ADT verification read-only and compatible with object-read success."

Write-Section "Feishu auth artifact scan"
$feishuAuthHits = rg -n -- "device_code|verification_uri|tenant_access_token|user_access_token|authUrl|deviceCode|verificationUri|tenantAccessToken|userAccessToken" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $feishuAuthHits) {
    $isMainRedaction = $line -match "apps[/\\]desktop[/\\]src[/\\]main[/\\]main\.ts"
    $isConnectorDeviceFlowParser = $line -match "apps[/\\]desktop[/\\]src[/\\]main[/\\]feishuCliConnector\.ts" -and $line -match "device_code|verification_uri|deviceCode|verificationUri"
    if ($line -match "tenant_access_token|user_access_token|tenantAccessToken|userAccessToken") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Feishu access-token artifact pattern is not allowed in source."
    }
    if (-not $isMainRedaction -and -not $isConnectorDeviceFlowParser) {
      $line | ForEach-Object { Write-Host $_ }
      throw "Feishu auth artifact pattern outside main-process error redaction."
    }
    Write-Host "OK Feishu redaction marker: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Feishu auth artifact scan failed."
}

Write-Section "Child process boundary scan"
$childProcessHits = rg -n -- "node:child_process|from ['""]child_process['""]|require\(['""]child_process['""]\)|execFile\(|spawn\(" apps/desktop/src/main
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $childProcessHits) {
    if ($line -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\](feishuCliConnector|codexCliConnector|localAiCapabilityService)\.ts") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Child process execution outside approved Feishu/Codex/local AI connectors."
    }
    Write-Host "OK child process boundary: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Child process boundary scan failed."
}

Write-Section "Codex fixed CLI command scan"
$codexMarkers = @(
  "READONLY_PROBE_MARKER",
  "resolveExecutable",
  "localCodexCandidates",
  "codexCommandFromName",
  "runCaseAssist",
  "sanitizeCodexAssistOutput",
  "--ephemeral",
  "read-only",
  "sap-ai-codex-probe-",
  "sap-ai-codex-case-assist-",
  "CODEX_PROBE_OK"
)
foreach ($marker in $codexMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker -Path "apps/desktop/src/main/codexCliConnector.ts"
  if ($markerHit) {
    Write-Host "OK Codex marker: $marker"
  } else {
    throw "Codex connector safety marker is missing: $marker"
  }
}

$codexDangerHits = rg -n -- "danger-full-access|workspace-write|dangerously-bypass|resume|fork|archive|delete|cloud|app-server|remote-control|mcp-server|\\.codex[/\\]sessions|history|readFile\(" apps/desktop/src/main/codexCliConnector.ts apps/desktop/src/preload apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0) {
  $codexDangerHits | ForEach-Object { Write-Host $_ }
  throw "Codex connector or renderer contains forbidden command/history markers."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Codex dangerous marker scan failed."
}

$codexGenericIpcHits = rg -n -- "codex.*run-command|codex.*shell|codex.*read-file|codex.*history|codex.*session|workbench:codex-(exec|shell|read|history|session)" apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0) {
  $codexGenericIpcHits | ForEach-Object { Write-Host $_ }
  throw "Codex must not expose generic command, file, history, or session IPC."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Codex generic IPC scan failed."
}

Write-Section "Codex case assist safety scan"
$codexCaseAssistMarkers = @(
  @{ Pattern = "codexAssistEnabled?: boolean"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "CodexCaseAssistRun"; Path = "apps/desktop/src/shared/workbenchTypes.ts" },
  @{ Pattern = "prepareCodexCaseAssistRequest"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "codexConfig.cliStatus !== `"verified`""; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "codexConfig.loginStatus !== `"verified`""; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "runCaseAssist"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "wantsCodexCaseAssist"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "CODEX_ASSIST_BOUNDARY"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "renderCodexCaseAssistFiles"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "codex-assist-toggle"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "codex-assist-toggle"; Path = "apps/desktop/src/renderer/styles.css" },
  @{ Pattern = "phase34-codex-case-assist-probe"; Path = "scripts/phase34-codex-case-assist-probe.mjs" }
)
foreach ($marker in $codexCaseAssistMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK Codex case assist marker: $($marker.Pattern)"
  } else {
    throw "Codex case assist marker is missing: $($marker.Pattern)"
  }
}

$codexCaseAssistUnsafeHits = rg -n -g "!localAiCapabilityService.ts" -- "workbench:codex-(case|assist|exec|run)|codex.*session|\\.codex[/\\]sessions|result\.stderr|result\.output|workspace-write|danger-full-access|dangerously-bypass|mcp-server" apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0) {
  $codexCaseAssistUnsafeHits | ForEach-Object { Write-Host $_ }
  throw "Codex case assist contains forbidden IPC, history, raw-output, or unsafe command markers."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Codex case assist unsafe marker scan failed."
}

$codexCaseAssistStdoutMarker = Select-String -SimpleMatch -Pattern "sanitizeCodexAssistOutput(result.stdout)" -Path "apps/desktop/src/main/codexCliConnector.ts"
if ($codexCaseAssistStdoutMarker) {
  Write-Host "OK Codex case assist persists sanitized stdout only."
} else {
  throw "Codex case assist must persist sanitized stdout only."
}

Write-Section "SQLite FTS safety scan"
$sqliteMarkers = @(
  "CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5",
  "unsafeSearchPatterns",
  "replaceSearchDocuments",
  "local-data/workbench/app.db",
  "sqlite3_js_db_export"
)
foreach ($marker in $sqliteMarkers) {
  $markerHits = rg -n --fixed-strings -- $marker apps/desktop/src/main docs/superpowers/plans
  if ($LASTEXITCODE -eq 0) {
    Write-Host "OK SQLite marker: $marker"
  } elseif ($LASTEXITCODE -eq 1) {
    throw "Missing SQLite safety marker: $marker"
  } else {
    throw "SQLite safety marker scan failed for: $marker"
  }
}

$sqlIpcHits = rg -n -- "ipcMain\.handle\([^)]*(sql|sqlite|database|fts)" apps/desktop/src/main apps/desktop/src/preload
if ($LASTEXITCODE -eq 0) {
  $sqlIpcHits | ForEach-Object { Write-Host $_ }
  throw "SQLite/database must not expose generic SQL IPC."
} elseif ($LASTEXITCODE -gt 1) {
  throw "SQLite IPC scan failed."
}

Write-Section "Feishu fixed CLI command scan"
$fixedCliMarkers = rg -n -- "REAL_FEISHU_CLI_COMMANDS|resolveExecutableForInput|executableInvocation|runCliExecutable|app-secret-stdin" apps/desktop/src/main/feishuCliConnector.ts
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

$feishuProfileSwitchHits = rg -n -- 'profile["'']?\s*,\s*["'']use|profile\s+use' apps/desktop/src/main/feishuCliConnector.ts
if ($LASTEXITCODE -eq 0) {
  $feishuProfileSwitchHits | ForEach-Object { Write-Host $_ }
  throw "Feishu connector must not switch the global lark-cli profile."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Feishu profile switch scan failed."
}

$feishuSecretArgHits = rg -n -- "--app-secret|app[_-]?secret\s*[:=]" apps/desktop/src/main/feishuCliConnector.ts
if ($LASTEXITCODE -eq 0) {
  $unexpectedFeishuSecretArgHits = @($feishuSecretArgHits | Where-Object { $_ -notmatch "--app-secret-stdin" })
  if ($unexpectedFeishuSecretArgHits.Count -gt 0) {
    $unexpectedFeishuSecretArgHits | ForEach-Object { Write-Host $_ }
    throw "Feishu App Secret must only be passed with --app-secret-stdin."
  }
  $feishuSecretArgHits | ForEach-Object { Write-Host "OK Feishu App Secret stdin marker: $_" }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Feishu App Secret command scan failed."
}

$feishuAuthStatusProfileMarker = Select-String -SimpleMatch -Pattern '"auth", "status", "--verify", "--profile"' -Path "apps/desktop/src/main/feishuCliConnector.ts"
$feishuAuthCheckProfileMarker = Select-String -SimpleMatch -Pattern '"auth", "check", "--scope", REQUIRED_DOC_SCOPES, "--profile"' -Path "apps/desktop/src/main/feishuCliConnector.ts"
if ($feishuAuthStatusProfileMarker -and $feishuAuthCheckProfileMarker) {
  Write-Host "OK Feishu auth checks carry explicit profile markers."
} else {
  throw "Feishu auth/profile explicit markers are missing."
}

Write-Section "Feishu safe handoff scan"
$feishuHandoffMarkers = @(
  @{ Pattern = "FEISHU_HANDOFF_LOCAL_ONLY_MARKER"; Path = "apps/desktop/src/main/feishuHandoffService.ts" },
  @{ Pattern = "renderFeishuHandoffArtifacts"; Path = "apps/desktop/src/main/feishuHandoffService.ts" },
  @{ Pattern = "prepareFeishuHandoff"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:prepare-feishu-handoff"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "prepareFeishuHandoff"; Path = "apps/desktop/src/preload/preload.ts" }
)
foreach ($marker in $feishuHandoffMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK Feishu handoff marker: $($marker.Pattern)"
  } else {
    throw "Feishu handoff marker is missing: $($marker.Pattern)"
  }
}

$feishuPublishPattern = 'docs\s+\+(create|update|delete|publish|whiteboard[-_\s]+(create|update|publish))|auth\s+(login|authorize)|open\s+https?://[^"\s]*(feishu|larksuite)'
$feishuPublishCommandHits = Get-ChildItem -Path "apps/desktop/src" -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx |
  Select-String -Pattern $feishuPublishPattern
if ($feishuPublishCommandHits) {
  $feishuPublishCommandHits | ForEach-Object { Write-Host "$($_.Path):$($_.LineNumber):$($_.Line)" }
  throw "Feishu cloud publish or authorization command marker found in app source."
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
$safeModelMarkers = @(
  @{ Pattern = "SAFE_MODEL_CONTEXT_ALLOWED_FIELDS"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "SafeModelKnowledgeReferenceInput"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "buildSafeModelDraftContext"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "assertNoUnsafeModelContextText"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "assertSafeModelDraftResponseText"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "safeModelDraftBoundary"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "referencedKnowledgeCount"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "MAX_KNOWLEDGE_REFERENCES"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "renderSafeModelDraftFiles"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "generateSafeDraft"; Path = "apps/desktop/src/main/modelProviderConnector.ts" },
  @{ Pattern = "prepareSafeModelDraftRequest"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "knowledgeReferences: currentCase.knowledgeReferences.map"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "referencedKnowledgeCount"; Path = "apps/desktop/src/main/caseWorkflowService.ts" },
  @{ Pattern = "phase23-referenced-knowledge-safe-model-context-probe"; Path = "scripts/phase23-referenced-knowledge-safe-model-context-probe.mjs" },
  @{ Pattern = "WORKBENCH_ALLOW_FAKE_MODEL_EXECUTION"; Path = "apps/desktop/src/main/main.ts" }
)
foreach ($marker in $safeModelMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK safe model marker: $($marker.Pattern)"
  } else {
    throw "Safe model draft safety marker is missing: $($marker.Pattern)"
  }
}

$unsafeSafeModelServiceHits = rg -n -- "ProjectConfig|WorkbenchState|readFile|readdir|node:fs|from ['""]fs['""]|sourceContent|currentContent|item\.content|sourceFilePath|searchWorkbench|previewCurrentCaseFile" apps/desktop/src/main/safeModelCaseDraftService.ts
if ($LASTEXITCODE -eq 0) {
  $unsafeSafeModelServiceHits | ForEach-Object { Write-Host $_ }
  throw "Safe model draft service must not read workspace state, files, search results, or full standards/knowledge bodies."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Safe model draft service boundary scan failed."
}

$unsafeModelRequestHits = rg -n -- "tools\s*:|functions\s*:|web_search|response_format" apps/desktop/src/main/modelProviderConnector.ts
if ($LASTEXITCODE -eq 0) {
  $unsafeModelRequestHits | ForEach-Object { Write-Host $_ }
  throw "Safe model draft request must not enable tools, functions, web search, or response-format expansion."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Safe model draft request scan failed."
}

$modelContextHits = rg -n -- "CaseMessage|conversation|caseItem|readCaseTree|caseFiles|activeCase|workspaceStore|readFile|readdir|fs\." apps/desktop/src/main/modelProviderConnector.ts
if ($LASTEXITCODE -eq 0) {
  $modelContextHits | ForEach-Object { Write-Host $_ }
  throw "Model provider connector must not read case conversation or files."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Model connector context scan failed."
}

$messageHits = rg -n -- "messages:" apps/desktop/src/main/modelProviderConnector.ts
if ($LASTEXITCODE -eq 0) {
  $dailyChatSystemMarker = @(Select-String -SimpleMatch -Pattern "你是一个中文日常 AI 助手" -Path "apps/desktop/src/main/modelProviderConnector.ts")
  $dailyChatUserMarker = @(Select-String -SimpleMatch -Pattern '{ role: "user", content: input.content }' -Path "apps/desktop/src/main/modelProviderConnector.ts")
  $hasDailyChatMarkers = ($dailyChatSystemMarker.Count -gt 0) -and ($dailyChatUserMarker.Count -gt 0)
  foreach ($line in $messageHits) {
    if ($line -match 'messages:\s*\[\{\s*role:\s*"user",\s*content:\s*"ping"\s*\}\]') {
      Write-Host "OK fixed model chat test: $line"
      continue
    }
    if ($line -match 'messages:\s*input\.context\.messages') {
      Write-Host "OK safe model draft messages: $line"
      continue
    }
    if ($line -match 'messages:\s*dailyChatMessages\(input\)') {
      Write-Host "OK bounded daily chat history messages: $line"
      continue
    }
    if ($line -match 'messages:\s*promptMessages') {
      Write-Host "OK prebuilt bounded streaming messages: $line"
      continue
    }
    if (($line -match 'messages:\s*\[') -and $hasDailyChatMarkers) {
      Write-Host "OK daily chat messages: $line"
      continue
    }
    else {
      $line | ForEach-Object { Write-Host $_ }
      throw "Model provider connector may only send the fixed ping chat test, prebuilt safe model draft context, or bounded daily chat prompt."
    }
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Model connector message scan failed."
}

Write-Section "SAP object evidence safety scan"
$sapEvidenceMarkers = @(
  @{ Pattern = "resolveAdtEndpointCandidates"; Path = "apps/desktop/src/main/adtEndpointResolver.ts" },
  @{ Pattern = "SAPUILandscape.xml"; Path = "apps/desktop/src/main/adtEndpointResolver.ts" },
  @{ Pattern = "saplogon.ini"; Path = "apps/desktop/src/main/adtEndpointResolver.ts" },
  @{ Pattern = "phase29-adt-gui-address-resolution-probe"; Path = "scripts/phase29-adt-gui-address-resolution-probe.mjs" },
  @{ Pattern = "SAP_OBJECT_EVIDENCE_ALLOWED_TYPES"; Path = "apps/desktop/src/main/sapObjectEvidenceService.ts" },
  @{ Pattern = "parseSapObjectEvidenceRequest"; Path = "apps/desktop/src/main/sapObjectEvidenceService.ts" },
  @{ Pattern = "assertSafeSapObjectEvidenceText"; Path = "apps/desktop/src/main/sapObjectEvidenceService.ts" },
  @{ Pattern = "renderSapObjectEvidenceFiles"; Path = "apps/desktop/src/main/sapObjectEvidenceService.ts" },
  @{ Pattern = "ADT_READONLY_FIXED_GET_ENDPOINTS"; Path = "apps/desktop/src/main/adtReadonlyConnector.ts" },
  @{ Pattern = "RealAdtReadonlyConnector"; Path = "apps/desktop/src/main/adtReadonlyConnector.ts" },
  @{ Pattern = "adtReadonlyObjectEvidencePath"; Path = "apps/desktop/src/main/adtReadonlyConnector.ts" },
  @{ Pattern = "readObjectEvidence"; Path = "apps/desktop/src/main/adtReadonlyConnector.ts" },
  @{ Pattern = "appendSapObjectEvidence"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "workbench:read-sap-object-evidence"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "readSapObjectEvidence"; Path = "apps/desktop/src/preload/preload.ts" },
  @{ Pattern = "WORKBENCH_ALLOW_FAKE_ADT_EVIDENCE"; Path = "apps/desktop/src/main/main.ts" }
)
foreach ($marker in $sapEvidenceMarkers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK SAP evidence marker: $($marker.Pattern)"
  } else {
    throw "SAP object evidence marker is missing: $($marker.Pattern)"
  }
}

$genericSapIpcHits = rg -n -- "sap-browser|sap-sql|sap-command|sap-object-search|query-sap|run-sap|runSelect|execute-sql|raw-sap|read-any-sap|sap-proxy" apps/desktop/src/main apps/desktop/src/preload
if ($LASTEXITCODE -eq 0) {
  $genericSapIpcHits | ForEach-Object { Write-Host $_ }
  throw "Generic SAP, SQL, or command IPC-like name found."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Generic SAP IPC scan failed."
}

$adtWriteMethodHits = rg -n -- "method\s*:\s*['""](POST|PUT|PATCH|DELETE)['""]|activateObject|createTransport|releaseTransport|transportRequest" apps/desktop/src/main/adtReadonlyConnector.ts apps/desktop/src/main/sapObjectEvidenceService.ts
if ($LASTEXITCODE -eq 0) {
  $adtWriteMethodHits | ForEach-Object { Write-Host $_ }
  throw "SAP evidence connector contains write-like method markers."
} elseif ($LASTEXITCODE -gt 1) {
  throw "SAP evidence write-method scan failed."
}

$adtForbiddenEndpointHits = rg -n -- "datapreview|repository/informationsystem/search|repository/nodestructure|/sap/bc/adt/cts|/sap/bc/adt/activation|x-csrf-token|csrf" apps/desktop/src/main/adtReadonlyConnector.ts
if ($LASTEXITCODE -eq 0) {
  $adtForbiddenEndpointHits | ForEach-Object { Write-Host $_ }
  throw "SAP evidence connector contains forbidden ADT endpoint or CSRF marker."
} elseif ($LASTEXITCODE -gt 1) {
  throw "SAP evidence forbidden endpoint scan failed."
}

Write-Section "Authorization boundary scan"
$authHits = rg -n -- "Authorization|Bearer|apiKey" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  foreach ($line in $authHits) {
    if ($line -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\](main|modelProviderConnector|adtReadonlyConnector)\.ts") {
      $line | ForEach-Object { Write-Host $_ }
      throw "Authorization/API key material outside approved main-process files."
    }
    Write-Host "OK auth boundary: $line"
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Authorization boundary scan failed."
}

Write-Section "Desktop delete-operation scan"
$deleteHits = rg -n --glob "!dist/**" --glob "!node_modules/**" -- "\brm\(|unlink|trashItem|shell\.trashItem|delete.*file|remove.*file" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $unexpectedDeleteHits = @($deleteHits | Where-Object {
    $_ -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\]secureSecretStore\.ts:\d+:\s+await fs\.unlink\(blobPath\);"
  })
  if ($unexpectedDeleteHits.Count -gt 0) {
    $unexpectedDeleteHits | ForEach-Object { Write-Host $_ }
    throw "Desktop code contains an unapproved file delete operation."
  }
  $deleteHits | ForEach-Object { Write-Host "OK narrow encrypted-secret cleanup: $_" }
  $secureCleanupSource = Get-Content -Raw "apps/desktop/src/main/secureSecretStore.ts"
  foreach ($marker in @("removeProjectTarget", "assertInsideSecureRoot", "blob.projectId === normalizedProjectId", "blob.targetId === targetId")) {
    if (-not $secureCleanupSource.Contains($marker)) {
      throw "Encrypted-secret cleanup boundary is missing marker: $marker"
    }
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Delete-operation scan failed."
}

Write-Section "Phase 39 product realignment and model channel safety scan"
$phase39Markers = @(
  @{ Pattern = "phase39-multi-provider-registry"; Path = "apps/desktop/src/renderer/ConfigCenter.tsx" },
  @{ Pattern = "provider.models.map"; Path = "apps/desktop/src/renderer/App.tsx" },
  @{ Pattern = "preserveMainOwnedVerification(previousConfig, nextConfig)"; Path = "apps/desktop/src/main/workspaceStore.ts" },
  @{ Pattern = "parseAppendDailyChatMessageInput(input)"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "autoHideMenuBar: true"; Path = "apps/desktop/src/main/main.ts" },
  @{ Pattern = "phase39-product-realignment"; Path = "scripts/phase39-product-realignment-probe.mjs" }
)
foreach ($marker in $phase39Markers) {
  $markerHit = Select-String -SimpleMatch -Pattern $marker.Pattern -Path $marker.Path
  if ($markerHit) {
    Write-Host "OK phase39 marker: $($marker.Pattern)"
  } else {
    throw "Phase 39 product realignment marker is missing: $($marker.Pattern)"
  }
}

$rendererVerificationWriteHits = rg -n -- "\.(models|modelSyncStatus|chatTestStatus|lastVerificationMode|lastVerifiedModelId)\s*=\s*[^=]" apps/desktop/src/renderer
if ($LASTEXITCODE -eq 0) {
  $rendererVerificationWriteHits | ForEach-Object { Write-Host $_ }
  throw "Renderer must not imperatively own model verification state."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Phase 39 renderer verification ownership scan failed."
}
Write-Host "OK phase39 keeps verification ownership in the main process."

Write-Section "Result"
Write-Host "Security preflight passed."
