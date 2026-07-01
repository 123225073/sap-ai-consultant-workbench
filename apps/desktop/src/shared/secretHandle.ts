import type { SecretHandle, SecretKind } from "./workbenchTypes";

const MANAGED_SECRET_REF_PATTERN = /^secure-store:sec_[a-f0-9]{32}$/;

export function isManagedSecretRef(value: unknown): value is string {
  return typeof value === "string" && MANAGED_SECRET_REF_PATTERN.test(value);
}

export function emptySecretHandle(kind: SecretKind): SecretHandle {
  return {
    secretRef: null,
    kind,
    store: null,
    state: "not-set",
    updatedAt: null
  };
}
