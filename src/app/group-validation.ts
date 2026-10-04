import {
  nonempty,
  record,
  uniquePrincipals,
  validPrincipal,
} from "./access-validation";
import type { Group, Member } from "./groups";

export function validGroup(value: unknown): value is Group {
  return (
    validPrincipal(value) &&
    nonempty(value["schema:name"]) &&
    ((value as Group)["schema:description"] == null ||
      typeof (value as Group)["schema:description"] === "string")
  );
}
export function validGroups(value: unknown): value is Group[] {
  return uniquePrincipals(value) && value.every(validGroup);
}
export function validMembers(value: unknown): value is Member[] {
  return (
    Array.isArray(value) &&
    value.every(
      (member) =>
        record(member) &&
        validPrincipal(member.user) &&
        typeof member.administrator === "boolean" &&
        typeof member.member === "boolean" &&
        (member.administrator || member.member),
    ) &&
    uniquePrincipals(value.map((member) => member.user))
  );
}
