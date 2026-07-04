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
  $runtimePatterns = "secure-store:sec_|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|tenant_access_token|user_access_token|Authorization\s*[:=]|Cookie\s*[:=]|SAP_SESSIONID\s*[:=]|MYSAPSSO2\s*[:=]|password\s*[:=]|api[_-]?key\s*[:=]|token\s*[:=]"
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
  "workbench:create-local-project",
  "workbench:create-local-case",
  "workbench:switch-project",
  "workbench:switch-case",
  "workbench:append-message",
  "workbench:get-case-files",
  "workbench:preview-current-case-file",
  "workbench:search",
  "workbench:read-sap-object-evidence",
  "workbench:prepare-feishu-handoff",
  "workbench:save-project-config",
  "workbench:save-project-secret",
  "workbench:adt-verify-readonly",
  "workbench:feishu-verify-cli",
  "workbench:model-provider-verify",
  "workbench:get-project-standards",
  "workbench:standards-copy-template",
  "workbench:standards-copy-project",
  "workbench:standards-save",
  "workbench:get-project-knowledge",
  "workbench:knowledge-import-local-text",
  "workbench:knowledge-import-text-file",
  "workbench:knowledge-review-for-publish",
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

$workbenchIpcLines = Select-String -Path "apps/desktop/src/main/main.ts" -Pattern 'ipcMain\.handle\("workbench:'
if (-not $workbenchIpcLines) {
  throw "No workbench IPC handlers found for trust-boundary scan."
}
foreach ($line in $workbenchIpcLines) {
  if ($line.Line -notmatch "trustedResponse") {
    Write-Host "$($line.Path):$($line.LineNumber):$($line.Line)"
    throw "Workbench IPC handler is missing trustedResponse wrapper."
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
  @{ Pattern = "lastVerifiedModelId"; Path = "apps/desktop/src/renderer/App.tsx" },
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
    $_ -notmatch "apps[/\\]desktop[/\\]src[/\\]main[/\\]main\.ts:.*dialog\.showOpenDialog"
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
    if ($line -match "apps[/\\]desktop[/\\]src[/\\]main[/\\](workspaceStore|searchService|knowledgeService)\.ts") {
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
  @{ Pattern = "file-summary-"; Path = "apps/desktop/src/main/searchService.ts" },
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
  @{ Name = "renderer review submit"; Path = "apps/desktop/src/renderer/KnowledgeCenter.tsx"; Start = "async function runReview"; End = "async function submitImport" }
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
$childProcessHits = rg -n -- "node:child_process|from ['""]child_process['""]|require\(['""]child_process['""]\)|execFile\(|spawn\(" apps/desktop/src/main
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
  @{ Pattern = "buildSafeModelDraftContext"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "assertNoUnsafeModelContextText"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "assertSafeModelDraftResponseText"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "safeModelDraftBoundary"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "renderSafeModelDraftFiles"; Path = "apps/desktop/src/main/safeModelCaseDraftService.ts" },
  @{ Pattern = "generateSafeDraft"; Path = "apps/desktop/src/main/modelProviderConnector.ts" },
  @{ Pattern = "prepareSafeModelDraftRequest"; Path = "apps/desktop/src/main/workspaceStore.ts" },
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

$unsafeSafeModelServiceHits = rg -n -- "ProjectConfig|WorkbenchState|readFile|readdir|node:fs|from ['""]fs['""]|sourceContent|currentContent|item\.content|searchWorkbench|previewCurrentCaseFile" apps/desktop/src/main/safeModelCaseDraftService.ts
if ($LASTEXITCODE -eq 0) {
  $unsafeSafeModelServiceHits | ForEach-Object { Write-Host $_ }
  throw "Safe model draft service must not read workspace state, files, search results, or full standards/knowledge bodies."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Safe model draft service boundary scan failed."
}

$unsafeModelRequestHits = rg -n -- "tools\s*:|functions\s*:|web_search|response_format|stream\s*:\s*true" apps/desktop/src/main/modelProviderConnector.ts
if ($LASTEXITCODE -eq 0) {
  $unsafeModelRequestHits | ForEach-Object { Write-Host $_ }
  throw "Safe model draft request must not enable tools, functions, web search, or streaming."
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
  foreach ($line in $messageHits) {
    if ($line -match 'messages:\s*\[\{\s*role:\s*"user",\s*content:\s*"ping"\s*\}\]') {
      Write-Host "OK fixed model chat test: $line"
      continue
    }
    if ($line -match 'messages:\s*input\.context\.messages') {
      Write-Host "OK safe model draft messages: $line"
      continue
    }
    else {
      $line | ForEach-Object { Write-Host $_ }
      throw "Model provider connector may only send the fixed ping chat test or prebuilt safe model draft context."
    }
  }
} elseif ($LASTEXITCODE -gt 1) {
  throw "Model connector message scan failed."
}

Write-Section "SAP object evidence safety scan"
$sapEvidenceMarkers = @(
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
$deleteHits = rg -n --glob "!dist/**" --glob "!node_modules/**" -- "rm\(|unlink|trashItem|shell\.trashItem|delete.*file|remove.*file" apps/desktop/src
if ($LASTEXITCODE -eq 0) {
  $deleteHits | ForEach-Object { Write-Host $_ }
  throw "Desktop code contains file delete operation patterns. The desktop app must not expose delete."
} elseif ($LASTEXITCODE -gt 1) {
  throw "Delete-operation scan failed."
}

Write-Section "Result"
Write-Host "Security preflight passed."
