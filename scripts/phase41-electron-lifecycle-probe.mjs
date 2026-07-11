import { build } from "esbuild";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(process.cwd());
const tempRoot = await mkdtemp(path.join(tmpdir(), "sap-ai-phase41-lifecycle-"));
const bundlePath = path.join(tempRoot, "logger-probe.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await build({
    stdin: {
      contents: `
        export { AppLifecycleLogger } from ${JSON.stringify(path.join(repoRoot, "apps/desktop/src/main/appLifecycleLogger.ts"))};
      `,
      resolveDir: repoRoot,
      sourcefile: "phase41-lifecycle-entry.ts",
      loader: "ts"
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: bundlePath,
    logLevel: "silent"
  });

  const { AppLifecycleLogger } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
  const userDataPath = path.join(tempRoot, "user-data");
  const fixedTime = new Date("2026-07-11T08:09:10.000Z");
  const logger = new AppLifecycleLogger(userDataPath, () => fixedTime);
  logger.write("renderer-process-gone", {
    reason: "crashed",
    exitCode: 17,
    recoveryOffered: true,
    secret: "sk-phase41-secret-must-not-appear",
    customerBody: "客户正文不得进入日志",
    source: "https://example.invalid/?api_key=secret"
  });

  const logDirectory = path.join(userDataPath, "logs");
  const logFiles = await readdir(logDirectory);
  assert(logFiles.length === 1 && logFiles[0] === "lifecycle-2026-07-11.log", "lifecycle log must be stored by day under userData/logs");
  const logText = await readFile(path.join(logDirectory, logFiles[0]), "utf8");
  const entry = JSON.parse(logText.trim());
  assert(entry.event === "renderer-process-gone" && entry.reason === "crashed", "safe lifecycle metadata was not preserved");
  assert(entry.exitCode === 17 && entry.recoveryOffered === true, "numeric or boolean lifecycle metadata was not preserved");
  assert(entry.source === "[redacted]", "free-form URL metadata was not redacted");
  assert(!logText.includes("phase41-secret") && !logText.includes("客户正文") && !logText.includes("customerBody"), "secret or customer content reached the lifecycle log");
  process.stdout.write("phase41-lifecycle-logger-runtime=ok\n");

  const [mainSource, loggerSource, desktopPackageSource, rootPackageSource] = await Promise.all([
    readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/src/main/appLifecycleLogger.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps/desktop/package.json"), "utf8"),
    readFile(path.join(repoRoot, "package.json"), "utf8")
  ]);
  const desktopPackage = JSON.parse(desktopPackageSource);
  const rootPackage = JSON.parse(rootPackageSource);

  const lockIndex = mainSource.indexOf("app.requestSingleInstanceLock()");
  const readyIndex = mainSource.indexOf("app.whenReady()");
  assert(lockIndex >= 0 && readyIndex > lockIndex, "single-instance lock must be requested before app readiness");
  assert(mainSource.includes('app.on("second-instance"') && mainSource.includes("window.restore()") && mainSource.includes("window.focus()"), "second instance does not restore and focus the existing window");
  assert(mainSource.includes('webContents.on("did-fail-load"') && mainSource.includes('webContents.on("render-process-gone"'), "renderer failure lifecycle handlers are incomplete");
  assert(mainSource.includes('process.on("unhandledRejection"') && mainSource.includes('process.on("uncaughtException"'), "process failure lifecycle handlers are incomplete");
  assert(mainSource.includes("await window.loadURL") && mainSource.includes("await window.loadFile") && mainSource.includes("renderer-load-rejected"), "loadURL/loadFile promise failures are not captured");
  assert((mainSource.match(/webContents\.reload\(\)/g) ?? []).length === 1, "renderer reload must have exactly one controlled call site");
  assert(mainSource.includes("rendererRecoveryUsed = true") && mainSource.includes("if (!recoveryOffered)"), "renderer recovery is not bounded to one offer");
  assert(!mainSource.includes("_errorDescription,") || !mainSource.includes("errorDescription:"), "did-fail-load description must not enter lifecycle logs");
  const lifecycleCalls = [...mainSource.matchAll(/lifecycleLogger\.write\([\s\S]*?\);/g)].map((match) => match[0]).join("\n");
  assert(!lifecycleCalls.includes("error.message") && !lifecycleCalls.includes("error.stack"), "exception body or stack must not enter lifecycle logs");
  assert(loggerSource.includes("ALLOWED_FIELD_NAMES") && loggerSource.includes("Free-form text"), "logger does not enforce allowlisted metadata");
  assert(loggerSource.includes("beginSession()") && loggerSource.includes("previous-session-unclean") && loggerSource.includes("endSession()"), "unclean previous sessions are not diagnosable");
  assert(mainSource.includes("lifecycleErrorCode(error)") && mainSource.includes('source: "process"'), "process failures lack a safe diagnostic category");
  assert(mainSource.includes("const workspaceHostRoot = app.isPackaged") && mainSource.includes('? app.getPath("userData")'), "packaged app must ignore development workspace overrides");
  assert(desktopPackage.scripts.start === "electron .", "desktop production start must launch the static Electron build");
  assert(rootPackage.scripts.start === "npm --workspace apps/desktop run start", "root production start must delegate to the static desktop start");
  assert(!desktopPackage.scripts["dev:desktop"], "Phase 41 must not add an ambiguous Vite/Electron dev launcher");
  assert(rootPackage.scripts["probe:phase41"]?.includes("node scripts/phase41-electron-lifecycle-probe.mjs"), "Phase 41 lifecycle probe script is missing");
  process.stdout.write("phase41-electron-lifecycle-static=ok\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
