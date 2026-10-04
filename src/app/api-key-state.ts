import { nonempty, record } from "./access-validation";
import type { ApiKey } from "./account-types";

export function validApiKeys(value: unknown): value is ApiKey[] {
  return (
    Array.isArray(value) &&
    value.every(
      (key) =>
        record(key) &&
        nonempty(key.id) &&
        nonempty(key.key) &&
        typeof key.enabled === "boolean" &&
        ["description", "serviceName"].every(
          (name) => key[name] == null || typeof key[name] === "string",
        ),
    ) &&
    new Set(value.map((key) => key.id)).size === value.length
  );
}

export function canChangeKey(
  keys: ApiKey[],
  action: "create" | "regenerate" | "delete",
  key?: ApiKey,
) {
  if (action === "create") return keys.length < 20;
  if (!key || !keys.includes(key)) return false;
  return (
    action === "regenerate" ||
    (keys.length > 1 &&
      (!key.enabled || keys.filter((k) => k.enabled).length > 1))
  );
}

/** A successful HTTP response must also acknowledge the requested operation. */
export function acknowledgesKeys(
  before: ApiKey[],
  after: ApiKey[],
  action: "create" | "regenerate" | "delete",
  key?: ApiKey,
) {
  if (action === "create")
    return after.some((value) => !before.some((old) => old.id === value.id));
  if (action === "delete") return !after.some((value) => value.id === key?.id);
  return after.some((value) => value.id === key?.id && value.key !== key?.key);
}
