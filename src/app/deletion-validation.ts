import { nonempty, record } from "./access-validation";
import type { DeletionPlan, DeletionOutcome } from "./folder-deletion-dialog";
import { collections, ResourceType } from "./resource";

const types = Object.keys(collections) as ResourceType[];
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const counts = (value: unknown): value is Record<ResourceType, number> =>
  record(value) &&
  Object.keys(value).length === types.length &&
  types.every((type) => count(value[type]));
const total = (value: Record<ResourceType, number>) =>
  types.reduce((sum, type) => sum + value[type], 0);

/** Validate the server's complete, potentially redacted inventory before asking for consent. */
export function validDeletionPlan(
  value: unknown,
  root: string,
): value is DeletionPlan {
  if (
    !record(value) ||
    !nonempty(value.token) ||
    typeof value.allowed !== "boolean" ||
    !counts(value.counts) ||
    !Array.isArray(value.items) ||
    !value.items.length
  )
    return false;
  const items = value.items;
  const inventoryCounts = value.counts;
  if (
    !items.every(
      (item) =>
        record(item) &&
        (item.id === null || nonempty(item.id)) &&
        (item.name === null || typeof item.name === "string") &&
        typeof item.type === "string" &&
        Object.hasOwn(collections, item.type) &&
        (item.parentId === null || nonempty(item.parentId)) &&
        count(item.depth) &&
        typeof item.deletable === "boolean" &&
        typeof item.protectedFolder === "boolean" &&
        count(item.instancesInside) &&
        count(item.instancesOutside) &&
        (item.type === "template" ||
          (item.instancesInside === 0 && item.instancesOutside === 0)),
    )
  )
    return false;
  const ids = new Map(
    items.filter((item) => item.id !== null).map((item) => [item.id, item]),
  );
  if (ids.size !== items.filter((item) => item.id !== null).length)
    return false;
  const start = ids.get(root);
  if (!start || start.type !== "folder" || start.parentId !== null)
    return false;
  if (
    !items.every((item) => {
      if (item.depth < start.depth || item.depth - start.depth >= items.length)
        return false;
      if (item === start) return true;
      if (item.depth === start.depth) return false;
      if (item.parentId === null)
        return (
          items.some(
            (parent) =>
              parent.id === null &&
              parent.type === "folder" &&
              parent.depth === item.depth - 1,
          ) || item.id === null
        );
      const parent = ids.get(item.parentId);
      return parent?.type === "folder" && parent.depth === item.depth - 1;
    })
  )
    return false;
  if (
    !types.every(
      (type) =>
        inventoryCounts[type] ===
        items.filter((item) => item.type === type).length,
    )
  )
    return false;
  const summaries = {
    restrictedItems: items.filter((item) => !item.deletable).length,
    protectedFolders: items.filter((item) => item.protectedFolder).length,
    templatesWithInstances: items.filter(
      (item) => item.instancesInside + item.instancesOutside > 0,
    ).length,
    templatesWithOutsideInstances: items.filter(
      (item) => item.instancesOutside > 0,
    ).length,
    instancesOutside: items.reduce(
      (sum, item) => sum + item.instancesOutside,
      0,
    ),
  };
  return (
    Object.entries(summaries).every(
      ([key, expected]) => count(value[key]) && value[key] === expected,
    ) &&
    items.every((item) => item.instancesInside <= inventoryCounts.instance) &&
    value.allowed ===
      (summaries.restrictedItems === 0 &&
        summaries.protectedFolders === 0 &&
        summaries.instancesOutside === 0)
  );
}

export function validDeletionOutcome(
  value: unknown,
  plan: DeletionPlan,
): value is DeletionOutcome {
  if (
    !record(value) ||
    !["completed", "changed", "blocked", "stopped"].includes(
      value.status as string,
    ) ||
    !counts(value.deleted) ||
    !count(value.remaining) ||
    (value.code != null && typeof value.code !== "string")
  )
    return false;
  if (value.status === "changed" || value.status === "blocked")
    return total(value.deleted) === 0;
  const deleted = value.deleted;
  return (
    types.every((type) => deleted[type] <= plan.counts[type]) &&
    total(value.deleted) + value.remaining === total(plan.counts) &&
    (value.status !== "completed" || value.remaining === 0)
  );
}
