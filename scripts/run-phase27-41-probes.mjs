import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const scriptDir = path.resolve("scripts");
const entries = await readdir(scriptDir);
const probes = entries
  .filter((name) => /^(?:phase(?:1[1-9]|2[0-9]|3[0-9]|4[0-3]).*-probe|external-connector-user-errors-probe)\.mjs$/.test(name))
  .sort();

const failed = [];
for (const probe of probes) {
  process.stdout.write(`\n== ${probe} ==\n`);
  const result = spawnSync(process.execPath, [path.join(scriptDir, probe)], { stdio: "inherit", timeout: 120_000 });
  if (result.error?.code === "ETIMEDOUT") {
    process.stderr.write(`探针超时：${probe}\n`);
    failed.push(probe);
  } else if (result.status !== 0) {
    failed.push(probe);
  }
}

if (failed.length > 0) {
  process.stderr.write(`\n失败探针：${failed.join("、")}\n`);
  process.exit(1);
}
process.stdout.write(`\n全部通过：${probes.length} 个探针。\n`);
