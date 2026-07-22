import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const buildRoot = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase54-build-"));
const workspace = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase54-plugin-"));

try {
  const outputPath = path.join(buildRoot, "plugin-package-service.cjs");
  const agentContextOutputPath = path.join(buildRoot, "agent-context-service.cjs");
  await Promise.all([
    build({
      entryPoints: [path.join(root, "apps/desktop/src/main/pluginPackageService.ts")],
      outfile: outputPath,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22"
    }),
    build({
      entryPoints: [path.join(root, "apps/desktop/src/main/agentContextService.ts")],
      outfile: agentContextOutputPath,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22"
    })
  ]);
  const {
    PLUGIN_TURN_CONTEXT_LIMITS,
    PluginPackageService,
    parsePluginManifest,
    validatePluginPackageEntryPath
  } = createRequire(import.meta.url)(outputPath);
  const { AgentContextService } = createRequire(import.meta.url)(agentContextOutputPath);

  const parsed = parsePluginManifest(JSON.stringify(baseManifest("safe-consulting", "1.0.0")));
  assert.equal(parsed.name, "safe-consulting");
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.mcpPresets[0].transport.headerRefs.Authorization, "secure-store:mcp.safe.authorization");
  assert.equal(parsed.skills.length, 2);

  for (const unsafePath of ["../escape.txt", "/absolute.txt", "C:/drive.txt", "safe\\..\\escape.txt", "safe//file.txt", "CON/file.txt"]) {
    assert.throws(() => validatePluginPackageEntryPath(unsafePath), /路径|绝对|磁盘|反斜杠|不安全/);
  }
  assert.throws(
    () => validatePluginPackageEntryPath("one/two/three.txt", { maxDepth: 2 }),
    /最大 2 层/
  );
  assert.equal(validatePluginPackageEntryPath("templates/review.md"), "templates/review.md");

  const sourcesRoot = path.join(workspace, "sources");
  await mkdir(sourcesRoot, { recursive: true });
  const markerPath = path.join(workspace, "plugin-script-must-not-run.txt");
  const versionOneSource = path.join(sourcesRoot, "safe-consulting-v1");
  await writePlugin(versionOneSource, baseManifest("safe-consulting", "1.0.0"), {
    "skills/inline-review/SKILL.md": skillMarkdown("inline-review", "Review bounded SAP evidence without granting extra permissions."),
    "skills/inline-review/references/guide.md": "Use verified evidence only.",
    "skills/inline-review/scripts/never-run.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(markerPath)}, "executed");`,
    "prompts/sap-review.md": "ORIGINAL_STAGED_PROMPT: keep SAP access read-only.",
    "templates/review.md": "# Review template\n\n{{summary}}"
  });

  const storageRoot = path.join(workspace, "service-state");
  const service = new PluginPackageService(storageRoot);
  await service.initialize();
  assert.equal(typeof service.execute, "undefined", "Plugin 服务不得提供直接执行入口");
  const preview = await service.preflightImport({ sourcePath: versionOneSource, scope: { kind: "global" } });
  assert.equal(preview.operation, "install");
  assert.equal(preview.previousVersion, null);
  assert.equal(preview.enabled, false);
  assert.equal(preview.version, "1.0.0");
  assert.equal(preview.components.inlineSkills, 1);
  assert.equal(preview.components.skillReferences, 1);
  assert.equal(preview.components.mcpPresets, 1);
  assert.equal(preview.risks.scriptsPresent, true);
  assert.equal(preview.risks.scriptsExecution, "disabled");
  assert.equal(preview.risks.rendererCode, "forbidden");
  assert.equal(preview.risks.automaticExecution, "forbidden");
  assert.equal(preview.risks.pluginExecution, "none");
  assert.equal(preview.validation.status, "warning");
  assert.equal(
    preview.resources.find((item) => item.relativePath.endsWith("scripts/never-run.mjs"))?.executionPolicy,
    "listed-not-executable"
  );
  assert.equal(JSON.stringify(preview).includes(versionOneSource), false, "预检结果不得暴露绝对来源路径");

  await writeFile(path.join(versionOneSource, "prompts", "sap-review.md"), "CHANGED_AFTER_PREFLIGHT", "utf8");
  const installed = await service.confirmImport(preview.importId);
  assert.equal(installed.enabled, false, "外部 Plugin 安装后必须默认停用");
  assert.equal(installed.sha256, preview.sha256);
  assert.equal(installed.version, "1.0.0");
  assert.equal(installed.rollbackAvailable, false);
  assert.equal(await exists(markerPath), false, "预检和安装不得执行内嵌 Skill 脚本");
  const stagedPrompt = await readFile(
    path.join(storageRoot, "packages", "global", installed.name, installed.sha256, "prompts", "sap-review.md"),
    "utf8"
  );
  assert.match(stagedPrompt, /ORIGINAL_STAGED_PROMPT/);
  assert.doesNotMatch(stagedPrompt, /CHANGED_AFTER_PREFLIGHT/);

  assert.deepEqual(
    await service.resolveTurnContextContributions("@safe-consulting review SAP evidence", null),
    [],
    "停用的 Plugin 不得贡献 Turn 上下文"
  );
  const enabled = await service.setEnabled(installed.id, true);
  assert.equal(enabled.enabled, true);
  const enabledContributions = await service.resolveTurnContextContributions(
    "@safe-consulting /inline-review review SAP evidence",
    null
  );
  const enabledContextText = enabledContributions.map((item) => item.content).join("\n");
  assert.match(enabledContextText, /ORIGINAL_STAGED_PROMPT/);
  assert.match(enabledContextText, /Use only verified evidence/);
  assert.doesNotMatch(enabledContextText, /Review template|never-run|writeFileSync|trusted-readonly-mcp/);
  assert.ok(enabledContributions.length <= PLUGIN_TURN_CONTEXT_LIMITS.maxContributions);
  assert.ok(new Set(enabledContributions.map((item) => item.pluginId)).size <= PLUGIN_TURN_CONTEXT_LIMITS.maxPackages);
  assert.ok(enabledContributions.every((item) => [...item.content].length <= PLUGIN_TURN_CONTEXT_LIMITS.maxCharsPerContribution));
  assert.ok(
    enabledContributions.reduce((total, item) => total + [...item.content].length, 0) <= PLUGIN_TURN_CONTEXT_LIMITS.maxChars
  );
  assert.equal(await exists(markerPath), false, "Turn 上下文加载不得执行内嵌 Skill 脚本");

  await assertAgentContextMergeAndDegradation(AgentContextService, service);

  const disabled = await service.setEnabled(installed.id, false);
  assert.equal(disabled.enabled, false);
  assert.deepEqual(
    await service.resolveTurnContextContributions("@safe-consulting review SAP evidence", null),
    [],
    "Plugin 停用后贡献必须立即消失"
  );
  await service.setEnabled(installed.id, true);
  assert.equal((await service.listInstalled())[0].enabled, true);

  await assert.rejects(
    service.preflightImport({ sourcePath: versionOneSource, scope: { kind: "global" } }),
    /已存在|重复安装/
  );

  const lowerVersionSource = path.join(sourcesRoot, "safe-consulting-v0");
  await writePlugin(lowerVersionSource, baseManifest("safe-consulting", "0.9.0"), pluginFiles(markerPath));
  await assert.rejects(
    service.preflightImport({ sourcePath: lowerVersionSource, scope: { kind: "global" } }),
    /不能低于当前版本/
  );

  const tamperSource = path.join(sourcesRoot, "tamper-plugin");
  await writePlugin(tamperSource, minimalManifest("tamper-plugin", "1.0.0"));
  const tamperPreview = await service.preflightImport({ sourcePath: tamperSource, scope: { kind: "global" } });
  const stagingEntries = await readdir(path.join(storageRoot, ".staging"));
  assert.equal(stagingEntries.length, 1);
  await writeFile(path.join(storageRoot, ".staging", stagingEntries[0], "injected.txt"), "changed after preflight", "utf8");
  await assert.rejects(service.confirmImport(tamperPreview.importId), /未声明|发生变化|拒绝安装/);
  assert.equal((await service.listInstalled()).some((item) => item.name === "tamper-plugin"), false);
  assert.equal((await service.listPendingPreviews()).some((item) => item.importId === tamperPreview.importId), false);
  assert.deepEqual(await readdir(path.join(storageRoot, ".staging")), []);

  await assertMaliciousPackagesRejected(service, sourcesRoot, workspace);
  await assertProjectScopeIsolation(PluginPackageService, sourcesRoot, workspace, markerPath);

  const countLimited = new PluginPackageService(path.join(workspace, "count-limited"), { limits: { maxFiles: 1 } });
  await assert.rejects(
    countLimited.preflightImport({ sourcePath: versionOneSource, scope: { kind: "global" } }),
    /文件数超过 1/
  );

  const versionTwoSource = path.join(sourcesRoot, "safe-consulting-v2");
  await writePlugin(versionTwoSource, baseManifest("safe-consulting", "2.0.0"), {
    ...pluginFiles(markerPath),
    "prompts/sap-review.md": "VERSION_TWO_PROMPT"
  });
  const failedUpgradePreview = await service.preflightImport({
    sourcePath: versionTwoSource,
    scope: { kind: "global" }
  });
  assert.equal(failedUpgradePreview.operation, "upgrade");
  assert.equal(failedUpgradePreview.previousVersion, "1.0.0");
  const registryBackupBlocker = path.join(storageRoot, "plugin-packages.json.previous");
  await mkdir(registryBackupBlocker);
  await assert.rejects(service.confirmImport(failedUpgradePreview.importId), /安装或升级失败|回滚/);
  const afterFailedUpgrade = (await service.listInstalled())[0];
  assert.equal(afterFailedUpgrade.version, "1.0.0", "升级失败必须保留旧版本");
  assert.equal(afterFailedUpgrade.enabled, true, "升级失败必须保留旧启停状态");
  assert.equal(afterFailedUpgrade.sha256, installed.sha256);
  assert.equal((await service.listPendingPreviews()).some((item) => item.importId === failedUpgradePreview.importId), true);
  assert.equal(await exists(path.join(storageRoot, "packages", "global", installed.name, failedUpgradePreview.sha256)), false);
  await rm(registryBackupBlocker, { recursive: true, force: true });
  assert.equal(await service.cancelImport(failedUpgradePreview.importId), true);

  const upgradePreview = await service.preflightImport({ sourcePath: versionTwoSource, scope: { kind: "global" } });
  const upgraded = await service.confirmImport(upgradePreview.importId);
  assert.equal(upgraded.version, "2.0.0");
  assert.equal(upgraded.enabled, false, "升级成功后仍需人工启用新版本");
  assert.equal(upgraded.rollbackAvailable, true);
  assert.equal(upgraded.previousVersion, "1.0.0");
  await service.setEnabled(upgraded.id, true);

  const rolledBack = await service.rollback(upgraded.id);
  assert.equal(rolledBack.version, "1.0.0");
  assert.equal(rolledBack.enabled, false, "显式回滚后必须重新人工启用");
  assert.equal(rolledBack.rollbackAvailable, false);
  assert.equal(await exists(path.join(storageRoot, "packages", "global", installed.name, upgraded.sha256)), false);
  assert.equal(await exists(markerPath), false, "启停、升级和回滚都不得执行 Plugin 内容");

  const reopened = new PluginPackageService(storageRoot);
  await reopened.initialize();
  assert.equal((await reopened.listInstalled())[0].enabled, false);
  await reopened.setEnabled(installed.id, true);
  const reopenedAgain = new PluginPackageService(storageRoot);
  await reopenedAgain.initialize();
  const persisted = (await reopenedAgain.listInstalled())[0];
  assert.equal(persisted.enabled, true, "启停状态必须持久化");
  assert.equal(persisted.version, "1.0.0", "回滚版本必须持久化");

  const activePromptPath = path.join(
    storageRoot,
    "packages",
    "global",
    persisted.name,
    persisted.sha256,
    "prompts",
    "sap-review.md"
  );
  await writeFile(activePromptPath, "TAMPERED_AFTER_INSTALL_PROMPT", "utf8");
  assert.deepEqual(
    await reopenedAgain.resolveTurnContextContributions("@safe-consulting review SAP evidence", null),
    [],
    "Plugin 文件被篡改后不得继续进入 Turn 上下文"
  );
  const invalid = await reopenedAgain.validateInstalled(persisted.id);
  assert.equal(invalid.validation.status, "invalid");
  assert.equal(invalid.enabled, false, "hash 变化后 Plugin 必须自动停用");
  assert.match(invalid.validation.diagnostics.map((item) => item.message).join("\n"), /hash/);

  const registryText = await readFile(path.join(storageRoot, "plugin-packages.json"), "utf8");
  assert.equal(registryText.includes(versionOneSource), false, "注册表不得保存绝对来源路径");
  assert.doesNotMatch(registryText, /plain-secret-value|Bearer phase54/);
  assert.equal(await exists(markerPath), false);

  console.log("Phase 54 declarative Plugin package and Turn context probe passed.");
} finally {
  await rm(buildRoot, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}

async function assertAgentContextMergeAndDegradation(AgentContextService, pluginService) {
  const contextEngine = { build: async (input) => input };
  const skills = {
    getCatalog: async () => [{ id: "skill-standalone", name: "standalone-skill", description: "Standalone review guidance." }],
    activateSkill: async () => ({
      id: "skill-standalone",
      name: "standalone-skill",
      sha256: "b".repeat(64),
      instructions: "STANDALONE_SKILL_INSTRUCTIONS"
    })
  };
  const input = {
    requestId: "phase54-turn",
    target: { threadId: "phase54-thread", projectId: null, caseId: null },
    userContent: "@safe-consulting /standalone-skill review SAP evidence"
  };

  const merged = await new AgentContextService(contextEngine, skills, pluginService).build(input);
  assert.match(merged.skillInstructions.map((item) => item.content).join("\n"), /STANDALONE_SKILL_INSTRUCTIONS/);
  assert.match(merged.skillInstructions.map((item) => item.content).join("\n"), /ORIGINAL_STAGED_PROMPT/);

  const pluginFailure = await new AgentContextService(contextEngine, skills, {
    resolveTurnContextContributions: async () => { throw new Error("optional Plugin unavailable"); }
  }).build(input);
  assert.match(pluginFailure.skillInstructions.map((item) => item.content).join("\n"), /STANDALONE_SKILL_INSTRUCTIONS/);

  const skillFailure = await new AgentContextService(contextEngine, {
    getCatalog: async () => { throw new Error("optional Skill registry unavailable"); },
    activateSkill: async () => { throw new Error("must not be reached"); }
  }, pluginService).build(input);
  assert.match(skillFailure.skillInstructions.map((item) => item.content).join("\n"), /ORIGINAL_STAGED_PROMPT/);
}

async function assertProjectScopeIsolation(PluginPackageService, sourcesRoot, workspace, markerPath) {
  const source = path.join(sourcesRoot, "project-consulting");
  await writePlugin(source, baseManifest("project-consulting", "1.0.0"), pluginFiles(markerPath));
  const service = new PluginPackageService(path.join(workspace, "project-scope-state"));
  const preview = await service.preflightImport({ sourcePath: source, scope: { kind: "project", projectId: "project-a" } });
  const installed = await service.confirmImport(preview.importId);
  await service.setEnabled(installed.id, true);
  assert.deepEqual(await service.resolveTurnContextContributions("@project-consulting SAP review", null), []);
  assert.deepEqual(await service.resolveTurnContextContributions("@project-consulting SAP review", "project-b"), []);
  assert.ok((await service.resolveTurnContextContributions("@project-consulting SAP review", "project-a")).length > 0);
  assert.equal(await exists(markerPath), false);
}

async function assertMaliciousPackagesRejected(service, sourcesRoot, workspace) {
  const rendererPackage = path.join(sourcesRoot, "malicious-renderer");
  await writePlugin(rendererPackage, {
    ...minimalManifest("malicious-renderer", "1.0.0"),
    renderer: { entry: "renderer.js" }
  }, { "renderer.js": "globalThis.compromised = true;" });
  await assert.rejects(
    service.preflightImport({ sourcePath: rendererPackage, scope: { kind: "global" } }),
    /renderer|声明式内容/
  );

  const automaticScriptPackage = path.join(sourcesRoot, "malicious-auto-script");
  await writePlugin(automaticScriptPackage, {
    ...minimalManifest("malicious-auto-script", "1.0.0"),
    scripts: { postInstall: "scripts/install.ps1" }
  }, { "scripts/install.ps1": "Set-Content -Path unsafe.txt -Value unsafe" });
  await assert.rejects(
    service.preflightImport({ sourcePath: automaticScriptPackage, scope: { kind: "global" } }),
    /scripts|声明式内容/
  );

  const plaintextSecretPackage = path.join(sourcesRoot, "malicious-plaintext-secret");
  const secretManifest = minimalManifest("malicious-plaintext-secret", "1.0.0");
  secretManifest.mcpPresets = [{
    id: "unsafe-mcp",
    name: "Unsafe MCP",
    description: "Must be rejected",
    transport: {
      type: "streamable-http",
      endpoint: "https://mcp.example.invalid/api",
      headerRefs: { Authorization: "Bearer phase54-plain-secret-value" }
    }
  }];
  await writePlugin(plaintextSecretPackage, secretManifest);
  await assert.rejects(
    service.preflightImport({ sourcePath: plaintextSecretPackage, scope: { kind: "global" } }),
    /明文密钥|secure-store/
  );

  const traversalPackage = path.join(sourcesRoot, "malicious-traversal");
  const traversalManifest = minimalManifest("malicious-traversal", "1.0.0");
  traversalManifest.promptFragments = [{
    id: "escape",
    name: "Escape",
    description: "Must be rejected",
    path: "../outside.md"
  }];
  await writePlugin(traversalPackage, traversalManifest);
  await assert.rejects(
    service.preflightImport({ sourcePath: traversalPackage, scope: { kind: "global" } }),
    /路径穿越|路径/
  );

  const undeclaredPackage = path.join(sourcesRoot, "malicious-undeclared-code");
  await writePlugin(undeclaredPackage, minimalManifest("malicious-undeclared-code", "1.0.0"), {
    "renderer.js": "globalThis.compromised = true;"
  });
  await assert.rejects(
    service.preflightImport({ sourcePath: undeclaredPackage, scope: { kind: "global" } }),
    /未声明的额外文件/
  );

  const executableTemplatePackage = path.join(sourcesRoot, "malicious-script-template");
  const executableTemplateManifest = minimalManifest("malicious-script-template", "1.0.0");
  executableTemplateManifest.templates = [{
    id: "script-template",
    name: "Script template",
    description: "Must remain data only",
    path: "templates/run.js",
    mediaType: "text/javascript"
  }];
  await writePlugin(executableTemplatePackage, executableTemplateManifest, {
    "templates/run.js": "globalThis.compromised = true;"
  });
  await assert.rejects(
    service.preflightImport({ sourcePath: executableTemplatePackage, scope: { kind: "global" } }),
    /模板|可执行脚本扩展名/
  );

  const outside = path.join(workspace, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.txt"), "outside", "utf8");
  const linkedPackage = path.join(sourcesRoot, "malicious-linked-package");
  await writePlugin(linkedPackage, minimalManifest("malicious-linked-package", "1.0.0"));
  await mkdir(path.join(linkedPackage, "skills"));
  await symlink(outside, path.join(linkedPackage, "skills", "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    service.preflightImport({ sourcePath: linkedPackage, scope: { kind: "global" } }),
    /符号链接|目录联接/
  );
}

function baseManifest(name, version) {
  return {
    schemaVersion: 1,
    name,
    displayName: "Safe Consulting Pack",
    version,
    description: "A declarative SAP consulting capability package used by the Phase 54 probe.",
    publisher: "Phase 54 Probe",
    metadata: { category: "sap-consulting" },
    skills: [
      { kind: "reference", name: "safe-review", version: "1.0.0", sha256: "a".repeat(64) },
      { kind: "inline", path: "skills/inline-review" }
    ],
    mcpPresets: [{
      id: "trusted-readonly-mcp",
      name: "Trusted read-only MCP",
      description: "Connection declaration only; never auto-connect.",
      transport: {
        type: "streamable-http",
        endpoint: "https://mcp.example.invalid/api",
        headerRefs: { Authorization: "secure-store:mcp.safe.authorization" }
      }
    }],
    promptFragments: [{
      id: "sap-review-prompt",
      name: "SAP review prompt",
      description: "Read-only review guidance.",
      path: "prompts/sap-review.md"
    }],
    templates: [{
      id: "review-template",
      name: "Review template",
      description: "Markdown review output template.",
      path: "templates/review.md",
      mediaType: "text/markdown"
    }]
  };
}

function minimalManifest(name, version) {
  return {
    schemaVersion: 1,
    name,
    displayName: name,
    version,
    description: "A minimal declarative Plugin package for Phase 54 safety checks.",
    metadata: {},
    skills: [],
    mcpPresets: [],
    promptFragments: [],
    templates: []
  };
}

function pluginFiles(markerPath) {
  return {
    "skills/inline-review/SKILL.md": skillMarkdown("inline-review", "Review bounded SAP evidence without granting extra permissions."),
    "skills/inline-review/references/guide.md": "Use verified evidence only.",
    "skills/inline-review/scripts/never-run.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(markerPath)}, "executed");`,
    "prompts/sap-review.md": "Keep SAP access read-only.",
    "templates/review.md": "# Review template\n\n{{summary}}"
  };
}

function skillMarkdown(name, description) {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "allowed-tools: Read Bash(*)",
    "---",
    "# Review",
    "Use only verified evidence."
  ].join("\n");
}

async function writePlugin(directory, manifest, files = {}) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "extension.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function exists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
