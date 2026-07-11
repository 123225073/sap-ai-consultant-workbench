import type { ProjectSecretTarget } from "../shared/workbenchTypes";

export function cleanSecretTargetSegment(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return cleaned || fallback;
}

export function secretTargetIdFor(target: ProjectSecretTarget): string {
  if (target.kind === "api-key") return cleanSecretTargetSegment(target.providerId ?? "", "provider");
  if (target.kind === "adt-password") return cleanSecretTargetSegment(target.connectionId ?? "", "adt-default");
  if (target.kind === "feishu-token") return "feishu";
  return "codex";
}

export function secretTargetIdCandidates(target: ProjectSecretTarget): string[] {
  const current = secretTargetIdFor(target);
  if (target.kind === "adt-password" && current === "adt-default") {
    return [current, "adt"];
  }
  return [current];
}
