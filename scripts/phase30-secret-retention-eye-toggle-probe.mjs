import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const PROBE_MARKER = "phase30-secret-retention-eye-toggle-probe";

function pass(name) {
  process.stdout.write(`${name}=ok\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/ConfigCenter.tsx"), "utf8");
const appSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8");

assert(source.includes("phase27-secret-eye-toggle"), `${PROBE_MARKER}: secret eye toggle marker missing`);
assert(source.includes("useRef"), "project-change guard should use useRef");
assert(source.includes("previousProjectIdRef"), "project-change guard missing");
assert(source.includes("adtSecretDirty") && source.includes("apiSecretDirtyByProvider"), "secret dirty state missing");
assert(source.includes("const hasPendingAdtSecret = adtSecretDirty;"), "ADT pending secret should use dirty flag");
assert(source.includes("const hasPendingApiSecret = apiSecretDirty;"), "API pending secret should use dirty flag");
assert(source.includes("setAdtSecretDirty(value.length > 0);"), "ADT secret edits should mark dirty only when non-empty");
assert(source.includes("setApiSecretDirtyByProvider") && source.includes("value.length > 0"), "API secret edits should mark the selected provider dirty only when non-empty");
pass("dirtyFlagsGateVerification");

assert(source.includes("show ? <Eye size={16} /> : <EyeOff size={16} />"), "secret eye icon should represent current visibility state");
assert(source.includes('type={show ? "text" : "password"}'), "secret field type should still follow visibility state");
assert(source.includes("aria-label={toggleLabel}"), "secret eye button should keep action-oriented accessibility labels");
assert(source.includes("disabled={!containsValue}"), "saved secrets must not be revealable when the field has no new input");
pass("eyeIconMatchesCurrentState");

const saveAdtStart = source.indexOf("async function saveAdtSettings");
const saveAdtEnd = source.indexOf("async function verifyAdt", saveAdtStart);
const saveAdtBlock = source.slice(saveAdtStart, saveAdtEnd);
assert(saveAdtStart > 0 && saveAdtEnd > saveAdtStart, "saveAdtSettings block not found");
assert(saveAdtBlock.includes("adtSecretDirty"), "saveAdtSettings should only save changed SAP password");
assert(saveAdtBlock.includes('const configSaved = await saveCurrentSection("adt");'), "saveAdtSettings should capture the SAP section save result");
assert(saveAdtBlock.includes("if (!configSaved) return;"), "saveAdtSettings must not save SAP password when config save fails");
assert(saveAdtBlock.includes('setAdtEntry("")'), "saveAdtSettings must clear SAP password after saving");
assert(saveAdtBlock.includes("setShowAdtSecret(false)"), "saveAdtSettings must hide SAP password after saving");
assert(saveAdtBlock.includes("setAdtSecretDirty(false)"), "saveAdtSettings should mark SAP password clean after saving");
pass("sapPasswordClearedAfterSave");

const saveModelStart = source.indexOf("async function saveModelSettings");
const saveModelEnd = source.indexOf("async function saveFeishuSettings", saveModelStart);
const saveModelBlock = source.slice(saveModelStart, saveModelEnd);
assert(saveModelStart > 0 && saveModelEnd > saveModelStart, "saveModelSettings block not found");
assert(saveModelBlock.includes("apiSecretDirty"), "saveModelSettings should only save changed API key");
assert(saveModelBlock.includes('const configSaved = await saveCurrentSection("models");'), "saveModelSettings should capture the model section save result");
assert(saveModelBlock.includes("if (!configSaved) return;"), "saveModelSettings must not save API key when config save fails");
assert(saveModelBlock.includes('if (input) input.value = ""'), "saveModelSettings must clear the selected API key after saving");
assert(saveModelBlock.includes("setShowApiSecrets"), "saveModelSettings must hide the selected API key after saving");
assert(saveModelBlock.includes("setApiSecretDirtyByProvider"), "saveModelSettings should mark the selected API key clean after saving");
pass("apiKeyClearedAfterSave");

assert(appSource.includes("async function saveProjectConfig(projectId: string, config: ProjectSummary[\"config\"]): Promise<boolean>"), "saveProjectConfig should return a success flag");
assert(appSource.includes("return true;") && appSource.includes("return false;"), "saveProjectConfig should return true or false");
pass("configSaveFailureBlocksSecretSave");

const effectStart = source.indexOf("useEffect(() => {");
const effectEnd = source.indexOf("}, [project?.id", effectStart);
const projectEffectBlock = source.slice(effectStart, effectEnd);
assert(projectEffectBlock.includes("projectChanged"), "secret clearing should be limited to project changes");
assert(projectEffectBlock.includes('setAdtEntry("")'), "project change should clear SAP password field");
assert(projectEffectBlock.includes("apiInputRefs.current = {};"), "project change should clear API key fields");
pass("projectChangeStillClearsSecrets");

assert(appSource.includes("输入框已清空"), "save notice should explain immediate secret clearing");
assert(appSource.includes("已保存值不会回显到页面"), "save notice should explain non-reveal boundary");
pass("secretClearingNotice");

pass(PROBE_MARKER);
