import { nonempty, record, validAccessReport } from "./access-validation";
import { Resource, collections } from "./resource";

const textFields = [
  "schema:name",
  "name",
  "schema:description",
  "pav:createdOn",
  "pav:createdBy",
  "oslc:modifiedBy",
  "pav:lastUpdatedOn",
  "pav:version",
  "bibo:status",
  "ownedByUserName",
  "ownedBy",
  "createdByUserName",
  "lastUpdatedByUserName",
  "trustedBy",
  "doi",
  "schema:identifier",
];
const flags = [
  "isOpen",
  "isOpenImplicitly",
  "activeUserCanRead",
  "isLatestVersion",
];

/** Reports are external input, including the reduced resources in paths and version history. */
function fields(value: unknown, depth = 0): boolean {
  if (!record(value) || !nonempty(value["@id"]) || depth > 16) return false;
  if (
    value.resourceType != null &&
    (typeof value.resourceType !== "string" || !Object.hasOwn(collections, value.resourceType))
  )
    return false;
  if (
    !textFields.every(
      (key) => value[key] == null || typeof value[key] === "string",
    )
  )
    return false;
  if (
    !flags.every((key) => value[key] == null || typeof value[key] === "boolean")
  )
    return false;
  if (
    value.everybodyPermission != null &&
    (typeof value.everybodyPermission !== "string" || !["read", "write", "none"].includes(value.everybodyPermission))
  )
    return false;
  if (
    value.numberOfInstances != null &&
    (!Number.isSafeInteger(value.numberOfInstances) ||
      (value.numberOfInstances as number) < 0)
  )
    return false;
  const permissions = value.currentUserPermissions;
  if (
    permissions != null &&
    (!record(permissions) ||
      !["capabilities", "availableActions"].every(
        (key) =>
          permissions[key] == null ||
          (Array.isArray(permissions[key]) && permissions[key].every(nonempty)),
      ) ||
      (permissions.role != null && typeof permissions.role !== "string") ||
      (permissions.owner != null && typeof permissions.owner !== "boolean"))
  )
    return false;
  return (
    ["pathInfo", "versions"].every(
      (key) =>
        value[key] == null ||
        (Array.isArray(value[key]) &&
          value[key].every((item) => fields(item, depth + 1))),
    ) &&
    ["derivedFrom", "isBasedOn"].every(
      (key) => value[key] == null || fields(value[key], depth + 1),
    )
  );
}

export function validResourceReport(
  value: unknown,
  expected: Resource,
): value is Resource {
  return validAccessReport(value, expected) && fields(value);
}
