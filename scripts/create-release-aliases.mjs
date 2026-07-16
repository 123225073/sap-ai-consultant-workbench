import { createReadStream } from "node:fs";
import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const version = String(rootPackage.version ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
  throw new Error("无法从根 package.json 读取有效版本号，未生成双击启动入口。");
}

const releaseRoot = path.join(repoRoot, "release", version);
const portablePath = path.join(releaseRoot, `SAP-AI-Consultant-Workbench-${version}-x64-Portable.exe`);
const aliases = [
  path.join(releaseRoot, "SAP-AI顾问工作台-双击启动.exe"),
  path.join(releaseRoot, "SAP-AI顾问工作台-最新版-双击启动.exe")
];
const source = await stat(portablePath);
if (!source.isFile() || source.size < 10_000_000) {
  throw new Error("Portable 产物不存在或内容不完整，未生成双击启动入口。");
}

for (const aliasPath of aliases) {
  await copyFile(portablePath, aliasPath);
  const copied = await stat(aliasPath);
  if (!copied.isFile() || copied.size !== source.size) {
    throw new Error(`双击启动入口校验失败：${path.basename(aliasPath)}`);
  }
  console.log(`release-alias=ok ${path.basename(aliasPath)} ${copied.size} bytes`);
}

async function sha256(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

async function gitOutput(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, windowsHide: true });
  return stdout.trim();
}

const artifactPaths = [
  path.join(releaseRoot, `SAP-AI-Consultant-Workbench-${version}-x64-Setup.exe`),
  portablePath,
  ...aliases,
  path.join(releaseRoot, "win-unpacked", "SAP AI 顾问工作台.exe")
];
const artifacts = [];
for (const artifactPath of artifactPaths) {
  const artifactStat = await stat(artifactPath);
  artifacts.push({
    file: path.relative(releaseRoot, artifactPath).replaceAll("\\", "/"),
    bytes: artifactStat.size,
    sha256: await sha256(artifactPath)
  });
}

const gitCommit = await gitOutput(["rev-parse", "HEAD"]);
const gitDirty = Boolean(await gitOutput(["status", "--porcelain"]));
if (gitDirty) {
  throw new Error("打包过程中检测到 Git 工作树发生变化，未生成可发布追溯清单。请检查后重新打包。");
}
const sourceLock = JSON.parse(await readFile(path.join(repoRoot, "release", ".package-win-source.json"), "utf8"));
if (sourceLock.gitCommit !== gitCommit) {
  throw new Error(`打包期间 Git 提交发生变化，产物来源无法确认。开始提交：${String(sourceLock.gitCommit)}；当前提交：${gitCommit}。`);
}
const metadata = {
  product: "SAP AI 顾问工作台",
  version,
  gitCommit,
  gitDirty,
  builtAt: new Date().toISOString(),
  artifacts
};
await writeFile(path.join(releaseRoot, "BUILD-METADATA.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
await writeFile(
  path.join(releaseRoot, "SHA256SUMS.txt"),
  `${artifacts.map((artifact) => `${artifact.sha256} *${artifact.file}`).join("\n")}\n`,
  "utf8"
);
console.log(`release-traceability=ok commit=${gitCommit} dirty=${gitDirty} artifacts=${artifacts.length}`);
