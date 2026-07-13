import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const scriptDir = path.resolve("scripts");
const entries = await readdir(scriptDir);
const probes = entries
  .filter((name) => /^(?:phase(?:1[1-9]|2[0-9]|3[0-9]|4[0-4]).*-probe|external-connector-user-errors-probe)\.mjs$/.test(name))
  .sort((left, right) => {
    const leftPriority = left === "phase43-desktop-release-uat-probe.mjs" ? 0 : 1;
    const rightPriority = right === "phase43-desktop-release-uat-probe.mjs" ? 0 : 1;
    return leftPriority - rightPriority || left.localeCompare(right);
  });

const failed = [];
for (const probe of probes) {
  process.stdout.write(`\n== ${probe} ==\n`);
  const timeout = probe === "phase43-desktop-release-uat-probe.mjs" ? 240_000 : 120_000;
  const maxAttempts = probe === "phase43-desktop-release-uat-probe.mjs" ? 2 : 1;
  let passed = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(process.execPath, [path.join(scriptDir, probe)], { stdio: "inherit", timeout });
    if (!result.error && result.status === 0) {
      passed = true;
      break;
    }
    const reason = result.error?.code === "ETIMEDOUT" ? "超时" : `退出码 ${result.status ?? "未知"}`;
    if (attempt < maxAttempts) {
      process.stderr.write(`桌面 UAT 首次运行${reason}，清理隔离进程后重试：${probe}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } else {
      process.stderr.write(`探针失败（${reason}）：${probe}\n`);
    }
  }
  if (!passed) failed.push(probe);
}

if (failed.length > 0) {
  process.stderr.write(`\n失败探针：${failed.join("、")}\n`);
  process.exit(1);
}
process.stdout.write(`\n全部通过：${probes.length} 个探针。\n`);
