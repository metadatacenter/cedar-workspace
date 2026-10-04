import type { Permissions, Principal } from "./permissions-dialog";
import type { Resource } from "./resource";

export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const nonempty = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim();
export function validPrincipal(value: unknown): value is Principal {
  return (
    record(value) &&
    nonempty(value["@id"]) &&
    ["schema:name", "firstName", "lastName"].every(
      (key) => value[key] == null || typeof value[key] === "string",
    ) &&
    (value.specialGroup == null ||
      typeof value.specialGroup === "boolean" ||
      nonempty(value.specialGroup))
  );
}
export function uniquePrincipals(value: unknown): value is Principal[] {
  return (
    Array.isArray(value) &&
    value.every(validPrincipal) &&
    new Set(value.map((p) => p["@id"])).size === value.length
  );
}
export function validPermissions(
  value: unknown,
  groups: Principal[],
): value is Permissions {
  if (
    !record(value) ||
    !validPrincipal(value.owner) ||
    !Array.isArray(value.userPermissions) ||
    !Array.isArray(value.groupPermissions)
  )
    return false;
  const ids = new Set<string>();
  return [
    [value.userPermissions, "user"],
    [value.groupPermissions, "group"],
  ].every(([grants, kind]) =>
    (grants as unknown[]).every((grant) => {
      if (!record(grant)) return false;
      const node = grant[kind as string];
      if (
        !validPrincipal(node) ||
        ids.has(node["@id"]) ||
        !["viewer", "editor", "manager"].includes(grant.role as string)
      )
        return false;
      ids.add(node["@id"]);
      const special =
        kind === "group" &&
        (node.specialGroup ||
          groups.find((g) => g["@id"] === node["@id"])?.specialGroup);
      return !special || grant.role === "viewer";
    }),
  );
}
export function validAccessReport(
  value: unknown,
  resource: Resource,
): value is Resource {
  if (
    !record(value) ||
    value["@id"] !== resource["@id"] ||
    value.resourceType !== resource.resourceType
  )
    return false;
  const permissions = value.currentUserPermissions;
  return (
    record(permissions) &&
    ["capabilities", "availableActions"].every(
      (key) =>
        permissions[key] == null ||
        (Array.isArray(permissions[key]) && permissions[key].every(nonempty)),
    )
  );
}
