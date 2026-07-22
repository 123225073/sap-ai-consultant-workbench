import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const buildDir = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase57-build-"));
const workspace = await mkdtemp(path.join(os.tmpdir(), "sap-ai-phase57-discovery-"));

try {
  const outputPath = path.join(buildDir, "skill-discovery-service.cjs");
  await build({
    entryPoints: [path.join(root, "apps/desktop/src/main/skillDiscoveryService.ts")],
    outfile: outputPath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22"
  });
  const { SkillDiscoveryService } = createRequire(import.meta.url)(outputPath);
  const agentsRoot = path.join(workspace, ".agents", "skills");
  const claudeRoot = path.join(workspace, ".claude", "skills");
  await writeSkill(path.join(agentsRoot, "sap-review"), "sap-review", "Review SAP evidence safely.");
  await writeSkill(path.join(claudeRoot, "repository", "skills", "nested-skill"), "nested-skill", "A nested monorepo Skill.");
  await mkdir(path.join(agentsRoot, "broken"), { recursive: true });
  await writeFile(path.join(agentsRoot, "broken", "SKILL.md"), "---\nname: broken\ndescription: \"unterminated\n---\n", "utf8");
  let symlinkCreated = false;
  try {
    await symlink(path.join(agentsRoot, "sap-review"), path.join(agentsRoot, "linked-skill"), "junction");
    symlinkCreated = true;
  } catch {
    // Some Windows environments deny symlink creation; the remaining safety assertions still run.
  }

  const installed = [{ name: "sap-review", scope: { kind: "global" } }];
  const fakeSkillService = { listInstalled: async () => installed };
  const service = new SkillDiscoveryService(fakeSkillService, {
    roots: [
      { source: "agents", label: "Codex 通用目录", directory: agentsRoot },
      { source: "claude", label: "Claude Code 目录", directory: claudeRoot }
    ]
  });
  const report = await service.discover({ kind: "global" });
  assert.equal(report.items.length, 3);
  assert.equal(report.items.find((item) => item.name === "sap-review")?.alreadyInstalled, true);
  assert.equal(report.items.find((item) => item.name === "nested-skill")?.validationStatus, "valid");
  assert.equal(report.items.find((item) => item.name === "broken")?.validationStatus, "invalid");
  if (symlinkCreated) assert.ok(report.skippedSymlinkCount >= 1);
  const nested = report.items.find((item) => item.name === "nested-skill");
  const selected = await service.resolveSelection(report.sessionId, [nested.id], { kind: "global" });
  assert.equal(selected.length, 1);
  await assert.rejects(() => service.resolveSelection("forged", [nested.id], { kind: "global" }), /过期/);
  await assert.rejects(() => service.resolveSelection(report.sessionId, [report.items.find((item) => item.name === "broken").id], { kind: "global" }), /无效/);
  console.log("Phase 57 Skill discovery probe passed.");
} finally {
  await rm(buildDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}

async function writeSkill(directory, name, description) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, "utf8");
}
