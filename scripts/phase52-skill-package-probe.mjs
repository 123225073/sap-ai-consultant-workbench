import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const buildDir = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase52-build-"));
const workspace = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase52-skill-"));

try {
  const outputPath = path.join(buildDir, "skill-package-service.cjs");
  await build({
    entryPoints: [path.join(root, "apps/desktop/src/main/skillPackageService.ts")],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22"
  });
  const {
    SkillPackageService,
    parseSkillMarkdown,
    validateSkillArchiveEntryPath
  } = createRequire(import.meta.url)(outputPath);

  const builtinService = new SkillPackageService(path.join(workspace, "builtin-state"));
  await builtinService.initialize();
  const builtinRoot = path.join(root, "apps/desktop/resources/builtin-skills");
  const builtinRecords = await builtinService.syncBuiltinSkills(builtinRoot);
  assert.deepEqual(
    builtinRecords.map((item) => item.name).sort(),
    [
      "sap-abap-safe-change",
      "sap-data-reconciliation",
      "sap-development-spec",
      "sap-evidence-first-analysis",
      "sap-incident-closure",
      "sap-ops-demand-intake",
      "sap-ops-intake-router",
      "sap-ops-presentation",
      "sap-ops-process-design",
      "sap-ops-release-closure"
    ]
  );
  assert.ok(builtinRecords.every((item) => !item.enabled && item.source.kind === "builtin"));
  await assert.rejects(builtinService.activateSkill("sap-development-spec"));
  const builtinToEnable = builtinRecords.find((item) => item.name === "sap-development-spec");
  assert.ok(builtinToEnable);
  await builtinService.setEnabled(builtinToEnable.id, true);
  const builtinSpec = await builtinService.activateSkill("sap-development-spec");
  assert.match(builtinSpec.instructions, /开发说明书/);
  const disabledBuiltin = await builtinService.setEnabled(builtinRecords[0].id, false);
  assert.equal(disabledBuiltin.enabled, false);
  const resyncedBuiltins = await builtinService.syncBuiltinSkills(builtinRoot);
  assert.equal(resyncedBuiltins.find((item) => item.id === disabledBuiltin.id)?.enabled, false);
  await assert.rejects(builtinService.removeSkill(disabledBuiltin.id), /内置 Skill.*不能.*移除/);
  const disabledBuiltinPath = path.join(workspace, "builtin-state", "packages", "global", disabledBuiltin.name, "SKILL.md");
  await writeFile(disabledBuiltinPath, "tampered built-in content", "utf8");
  const repairedBuiltins = await builtinService.syncBuiltinSkills(builtinRoot);
  assert.equal(repairedBuiltins.find((item) => item.id === disabledBuiltin.id)?.enabled, false);
  await builtinService.setEnabled(disabledBuiltin.id, true);
  assert.match((await builtinService.activateSkill(disabledBuiltin.name)).instructions, /SAP|开发说明书|事故闭环|对账/);

  const upgradeRoot = path.join(workspace, "builtin-upgrade-source");
  const upgradeSkill = path.join(upgradeRoot, "upgrade-skill");
  await writeSkill(upgradeSkill, {
    name: "upgrade-skill",
    description: "A built-in upgrade workflow used to verify safe package synchronization.",
    body: "# Upgrade Skill\n\nBUILTIN_VERSION_ONE"
  });
  const upgradeService = new SkillPackageService(path.join(workspace, "builtin-upgrade-state"));
  const [versionOne] = await upgradeService.syncBuiltinSkills(upgradeRoot);
  await upgradeService.setEnabled(versionOne.id, false);
  await writeFile(
    path.join(upgradeSkill, "SKILL.md"),
    skillMarkdown(versionOne.name, versionOne.description, "# Upgrade Skill\n\nBUILTIN_VERSION_TWO"),
    "utf8"
  );
  const [versionTwo] = await upgradeService.syncBuiltinSkills(upgradeRoot);
  assert.equal(versionTwo.id, versionOne.id);
  assert.notEqual(versionTwo.sha256, versionOne.sha256);
  assert.equal(versionTwo.enabled, false);
  await upgradeService.setEnabled(versionTwo.id, true);
  assert.match((await upgradeService.activateSkill(versionTwo.name)).instructions, /BUILTIN_VERSION_TWO/);

  const parsed = parseSkillMarkdown([
    "---",
    "name: sap-review",
    "description: >-",
    "  Review SAP changes safely and explain",
    "  when this workflow should be used.",
    "metadata:",
    "  author: probe",
    "  version: \"1.0\"",
    "allowed-tools: Read Bash(git:*)",
    "---",
    "# SAP Review",
    "Use the checked evidence."
  ].join("\n"));
  assert.equal(parsed.frontmatter.name, "sap-review");
  assert.match(parsed.frontmatter.description, /when this workflow/);
  assert.equal(parsed.frontmatter.metadata.version, "1.0");
  assert.equal(parsed.frontmatter.allowedTools, "Read Bash(git:*)");
  assert.match(parsed.body, /checked evidence/);
  const compatibleExternalSkill = parseSkillMarkdown([
    "---",
    "name: sap-adt-cli",
    "description: \"Read ABAP metadata from SAP systems via the ADT REST API.",
    "  Use when the user asks to read or analyze ABAP programs,",
    "  classes, DDIC tables, or Open SQL data preview.\"",
    "metadata:",
    "  version: \"1.0.0\"",
    "  source_urls:",
    "    - \"https://example.invalid/skill\"",
    "  permissions:",
    "    read_paths: [\"<skill_dir>/references/\"]",
    "    requires_elevation: false",
    "---",
    "# SAP ADT CLI"
  ].join("\n"));
  assert.match(compatibleExternalSkill.frontmatter.description, /Open SQL data preview/);
  assert.equal(compatibleExternalSkill.frontmatter.metadata.version, "1.0.0");
  assert.equal(compatibleExternalSkill.frontmatter.metadata.source_urls, '["https://example.invalid/skill"]');
  assert.match(compatibleExternalSkill.frontmatter.metadata.permissions, /requires_elevation/);
  const longDescription = parseSkillMarkdown([
    "---",
    "name: long-description-skill",
    `description: ${"SAP integration guidance. ".repeat(80)}`,
    "---",
    "# Long description"
  ].join("\n"));
  assert.ok(longDescription.frontmatter.description.length > 1_024);
  assert.throws(
    () => parseSkillMarkdown("---\nname: broken-skill\ndescription: \"unterminated\n---\nbody"),
    /引号|损坏/
  );

  for (const unsafePath of ["../escape.txt", "/absolute.txt", "C:/drive.txt", "safe\\..\\escape.txt", "safe//file.txt"]) {
    assert.throws(() => validateSkillArchiveEntryPath(unsafePath), /路径|绝对|磁盘|反斜杠/);
  }
  assert.throws(
    () => validateSkillArchiveEntryPath("one/two/three.txt", { maxDepth: 2 }),
    /最大 2 层/
  );
  assert.equal(validateSkillArchiveEntryPath("references/guide.md"), "references/guide.md");

  const sourcesRoot = path.join(workspace, "sources");
  await mkdir(sourcesRoot, { recursive: true });
  const markerPath = path.join(workspace, "script-must-not-run.txt");
  const safeSource = path.join(sourcesRoot, "safe-skill");
  await writeSkill(safeSource, {
    name: "safe-skill",
    description: "Safely reviews a bounded SAP task. Use when evidence and traceability are required.",
    body: "# Safe Skill\n\nORIGINAL_STAGED_INSTRUCTIONS",
    allowedTools: "Read Bash(*)",
    files: {
      "references/guide.md": "Only load this reference when needed.",
      "assets/template.txt": "Result template",
      "scripts/never-run.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(markerPath)}, "executed");`
    }
  });

  const storageRoot = path.join(workspace, "service-state");
  const service = new SkillPackageService(storageRoot);
  await service.initialize();
  const preview = await service.preflightImport({
    sourceKind: "folder",
    sourcePath: safeSource,
    scope: { kind: "global" }
  });
  assert.equal(preview.name, "safe-skill");
  assert.equal(preview.enabled, false);
  assert.equal(preview.source.kind, "folder");
  assert.equal(preview.scriptStatus, "present-listed-not-executable");
  assert.equal(preview.validation.status, "warning");
  assert.match(preview.instructionSummary, /ORIGINAL_STAGED_INSTRUCTIONS/);
  assert.equal(preview.resources.find((item) => item.relativePath === "scripts/never-run.mjs")?.executionPolicy, "listed-not-executable");
  assert.equal("instructions" in preview, false);
  assert.equal(JSON.stringify(preview).includes(safeSource), false);

  await writeFile(
    path.join(safeSource, "SKILL.md"),
    skillMarkdown("safe-skill", "Safely reviews a bounded SAP task. Use when evidence and traceability are required.", "CHANGED_AFTER_PREFLIGHT"),
    "utf8"
  );
  const installed = await service.confirmImport(preview.importId);
  assert.equal(installed.enabled, false);
  assert.equal(installed.sha256, preview.sha256);
  const enabled = await service.setEnabled(installed.id, true);
  assert.equal(enabled.enabled, true);

  const catalog = await service.getCatalog();
  assert.equal(catalog.length, 1);
  assert.deepEqual(Object.keys(catalog[0]).sort(), ["description", "id", "name", "scope", "sha256", "validationStatus"].sort());
  const activated = await service.activateSkill("safe-skill");
  assert.match(activated.instructions, /ORIGINAL_STAGED_INSTRUCTIONS/);
  assert.doesNotMatch(activated.instructions, /CHANGED_AFTER_PREFLIGHT/);
  assert.equal(activated.allowedToolsPolicy, "advisory-only");
  assert.equal(activated.scriptsExecution, "disabled");
  assert.ok(activated.resources.some((item) => item.relativePath === "scripts/never-run.mjs"));
  const reference = await service.readTextResource(installed.id, "references/guide.md");
  assert.match(reference.content, /load this reference/);
  await assert.rejects(service.readTextResource(installed.id, "scripts/never-run.mjs"), /只展示|不执行/);
  await assert.rejects(
    service.preflightImport({ sourceKind: "folder", sourcePath: safeSource, scope: { kind: "global" } }),
    /同名 Skill/
  );
  assert.deepEqual(await readdir(path.join(storageRoot, ".staging")), []);

  const zipPath = path.join(sourcesRoot, "unsafe.zip");
  await writeFile(zipPath, "not-a-real-zip", "utf8");
  await assert.rejects(
    service.preflightImport({ sourceKind: "zip", sourcePath: zipPath, scope: { kind: "global" } }),
    /受控 zip 解压组件/
  );

  const outside = path.join(workspace, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.txt"), "outside", "utf8");
  const linkedSource = path.join(sourcesRoot, "linked-skill");
  await writeSkill(linkedSource, {
    name: "linked-skill",
    description: "A valid description used to verify symbolic link rejection.",
    body: "# Linked"
  });
  await mkdir(path.join(linkedSource, "references"));
  await symlink(outside, path.join(linkedSource, "references", "escape"), "junction");
  await assert.rejects(
    service.preflightImport({ sourceKind: "folder", sourcePath: linkedSource, scope: { kind: "global" } }),
    /符号链接|目录联接/
  );
  assert.deepEqual(await readdir(path.join(storageRoot, ".staging")), []);

  const countLimited = new SkillPackageService(path.join(workspace, "count-limit"), { limits: { maxFiles: 1 } });
  await assert.rejects(
    countLimited.preflightImport({ sourceKind: "folder", sourcePath: safeSource, scope: { kind: "global" } }),
    /文件数超过 1/
  );

  const sizeSource = path.join(sourcesRoot, "size-skill");
  await writeSkill(sizeSource, {
    name: "size-skill",
    description: "A valid description for package size boundary checks.",
    body: "# Size",
    files: { "assets/large.bin": Buffer.alloc(300, 65) }
  });
  const singleLimited = new SkillPackageService(path.join(workspace, "single-limit"), {
    limits: { maxSingleFileBytes: 256, maxSkillMarkdownBytes: 256 }
  });
  await assert.rejects(
    singleLimited.preflightImport({ sourceKind: "folder", sourcePath: sizeSource, scope: { kind: "global" } }),
    /单文件大小上限/
  );
  const totalLimited = new SkillPackageService(path.join(workspace, "total-limit"), {
    limits: { maxSingleFileBytes: 512, maxSkillMarkdownBytes: 256, maxTotalBytes: 350 }
  });
  await assert.rejects(
    totalLimited.preflightImport({ sourceKind: "folder", sourcePath: sizeSource, scope: { kind: "global" } }),
    /总大小超过/
  );

  const deepSource = path.join(sourcesRoot, "deep-skill");
  await writeSkill(deepSource, {
    name: "deep-skill",
    description: "A valid description for nested path depth checks.",
    body: "# Deep",
    files: { "references/one/two.md": "too deep" }
  });
  const depthLimited = new SkillPackageService(path.join(workspace, "depth-limit"), { limits: { maxDepth: 2 } });
  await assert.rejects(
    depthLimited.preflightImport({ sourceKind: "folder", sourcePath: deepSource, scope: { kind: "global" } }),
    /最大 2 层/
  );

  const brokenSource = path.join(sourcesRoot, "broken-skill");
  await mkdir(brokenSource);
  await writeFile(path.join(brokenSource, "SKILL.md"), "---\nname: broken-skill\ndescription: \"unterminated\n---\n# Broken", "utf8");
  await assert.rejects(
    service.preflightImport({ sourceKind: "folder", sourcePath: brokenSource, scope: { kind: "global" } }),
    /引号|损坏/
  );
  assert.deepEqual(await readdir(path.join(storageRoot, ".staging")), []);

  const tamperSource = path.join(sourcesRoot, "tamper-skill");
  await writeSkill(tamperSource, {
    name: "tamper-skill",
    description: "A valid description for staging integrity checks.",
    body: "# Staging Integrity"
  });
  const tamperPreview = await service.preflightImport({
    sourceKind: "folder",
    sourcePath: tamperSource,
    scope: { kind: "global" }
  });
  const stagingEntries = await readdir(path.join(storageRoot, ".staging"));
  assert.equal(stagingEntries.length, 1);
  await writeFile(path.join(storageRoot, ".staging", stagingEntries[0], "injected.txt"), "changed after preflight", "utf8");
  await assert.rejects(service.confirmImport(tamperPreview.importId), /staging 内容在确认前发生变化/);
  assert.equal(await exists(path.join(storageRoot, "packages", "global", "tamper-skill")), false);
  assert.equal((await service.listPendingPreviews()).some((item) => item.importId === tamperPreview.importId), false);
  assert.deepEqual(await readdir(path.join(storageRoot, ".staging")), []);

  const rollbackSource = path.join(sourcesRoot, "rollback-skill");
  await writeSkill(rollbackSource, {
    name: "rollback-skill",
    description: "A valid description for atomic install rollback checks.",
    body: "# Rollback"
  });
  const rollbackPreview = await service.preflightImport({
    sourceKind: "folder",
    sourcePath: rollbackSource,
    scope: { kind: "global" }
  });
  const registryBackupBlocker = path.join(storageRoot, "skill-packages.json.previous");
  await mkdir(registryBackupBlocker);
  await assert.rejects(service.confirmImport(rollbackPreview.importId), /安装失败|回滚/);
  assert.equal(await exists(path.join(storageRoot, "packages", "global", "rollback-skill")), false);
  assert.equal((await service.listInstalled()).some((item) => item.name === "rollback-skill"), false);
  assert.equal((await service.listPendingPreviews()).some((item) => item.importId === rollbackPreview.importId), true);
  await rm(registryBackupBlocker, { recursive: true, force: true });
  assert.equal(await service.cancelImport(rollbackPreview.importId), true);
  assert.deepEqual(await readdir(path.join(storageRoot, ".staging")), []);

  const projectSource = path.join(sourcesRoot, "project-safe-skill");
  await writeSkill(projectSource, {
    name: "safe-skill",
    description: "Project-specific safe review instructions for project one.",
    body: "# Project Override\n\nPROJECT_ONLY_INSTRUCTIONS"
  });
  const projectPreview = await service.preflightImport({
    sourceKind: "folder",
    sourcePath: projectSource,
    scope: { kind: "project", projectId: "project-1" }
  });
  const projectRecord = await service.confirmImport(projectPreview.importId);
  await service.setEnabled(projectRecord.id, true);
  const projectCatalog = await service.getCatalog("project-1");
  assert.equal(projectCatalog.length, 1);
  assert.equal(projectCatalog[0].id, projectRecord.id);
  const projectActivation = await service.activateSkill("safe-skill", "project-1");
  assert.match(projectActivation.instructions, /PROJECT_ONLY_INSTRUCTIONS/);
  assert.equal(await service.removeSkill(projectRecord.id), true);
  assert.equal((await service.getCatalog("project-1"))[0].id, installed.id);

  const registryText = await readFile(path.join(storageRoot, "skill-packages.json"), "utf8");
  assert.equal(registryText.includes(safeSource), false);
  assert.equal(await exists(markerPath), false);

  const reopened = new SkillPackageService(storageRoot);
  await reopened.initialize();
  assert.equal((await reopened.listInstalled()).length, 1);
  const installedSkillPath = path.join(storageRoot, "packages", "global", "safe-skill", "SKILL.md");
  await writeFile(installedSkillPath, skillMarkdown("safe-skill", installed.description, "TAMPERED_AFTER_INSTALL"), "utf8");
  const invalid = await reopened.validateInstalled(installed.id);
  assert.equal(invalid.validation.status, "invalid");
  assert.equal(invalid.enabled, false);
  assert.match(invalid.validation.diagnostics.map((item) => item.message).join("\n"), /hash/);
  assert.equal((await reopened.getCatalog()).length, 0);

  console.log("Phase 52 Skill package backend probe passed.");
} finally {
  await rm(buildDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}

function skillMarkdown(name, description, body, allowedTools = null) {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    ...(allowedTools ? [`allowed-tools: ${allowedTools}`] : []),
    "---",
    body
  ].join("\n");
}

async function writeSkill(directory, options) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    skillMarkdown(options.name, options.description, options.body, options.allowedTools ?? null),
    "utf8"
  );
  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const target = path.join(directory, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
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
