import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
  cwd: repoRoot,
  windowsHide: true
});

const changes = stdout
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean);

if (changes.length > 0) {
  const preview = changes.slice(0, 20).join("\n");
  throw new Error(`正式 Windows 安装包只能从已提交且无未保存改动的 Git 版本生成。请先完成提交后再打包。\n${preview}`);
}

console.log("release-clean-tree=ok");

const { stdout: commitStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  windowsHide: true
});
const releaseRoot = path.join(repoRoot, "release");
await mkdir(releaseRoot, { recursive: true });
await writeFile(
  path.join(releaseRoot, ".package-win-source.json"),
  `${JSON.stringify({ gitCommit: commitStdout.trim(), checkedAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8"
);
console.log(`release-source-lock=ok commit=${commitStdout.trim()}`);
