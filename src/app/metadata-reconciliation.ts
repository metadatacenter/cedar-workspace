import type { CeeJsonObject, CeeJsonValue } from "cedar-embeddable-editor";

type Value = CeeJsonValue | undefined;
export interface ReconciliationChange {
  path: string[];
  mine: Value;
  latest: Value;
  conflict: boolean;
  choice?: "mine" | "latest";
}
const object = (value: Value): value is CeeJsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);
const own = (value: CeeJsonObject, key: string): Value =>
  Object.hasOwn(value, key) ? value[key] : undefined;
const key = (value: Value): string | undefined =>
  JSON.stringify(value, (_key, node) =>
    object(node)
      ? Object.fromEntries(
          Object.keys(node)
            .sort()
            .map((k) => [k, node[k]]),
        )
      : node,
  );
// Identity, linkage and repository provenance are never rewritten from an old form.
const repository = new Set([
  "@id",
  "schema:isBasedOn",
  "pav:createdOn",
  "pav:createdBy",
  "pav:lastUpdatedOn",
  "oslc:modifiedBy",
  "pav:version",
  "pav:previousVersion",
  "pav:derivedFrom",
  "bibo:status",
]);

/** Three-way review. Repeated entries are indivisible: indexes do not establish occurrence identity. */
export function reconcileMetadata(
  base: CeeJsonObject,
  mine: CeeJsonObject,
  latest: CeeJsonObject,
  choices: ReadonlyMap<string, "mine" | "latest"> = new Map(),
) {
  const changes: ReconciliationChange[] = [];
  const merge = (
    before: Value,
    local: Value,
    remote: Value,
    path: string[],
  ): Value => {
    if (path.length === 1 && repository.has(path[0]))
      return structuredClone(remote);
    if (key(local) === key(remote)) return structuredClone(remote);
    if (object(before) && object(local) && object(remote)) {
      return Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(before),
            ...Object.keys(local),
            ...Object.keys(remote),
          ]),
        ]
          .map(
            (k) =>
              [
                k,
                merge(own(before, k), own(local, k), own(remote, k), [
                  ...path,
                  k,
                ]),
              ] as const,
          )
          .filter(
            (entry): entry is readonly [string, CeeJsonValue] =>
              entry[1] !== undefined,
          ),
      );
    }
    const conflict = key(before) !== key(local) && key(before) !== key(remote);
    const choice = conflict
      ? choices.get(JSON.stringify(path))
      : key(before) === key(local)
        ? "latest"
        : "mine";
    changes.push({
      path,
      mine: structuredClone(local),
      latest: structuredClone(remote),
      conflict,
      choice,
    });
    return structuredClone(choice === "mine" ? local : remote);
  };
  const metadata = merge(base, mine, latest, []) as CeeJsonObject;
  return {
    metadata,
    changes,
    complete: changes.every((change) => !change.conflict || !!change.choice),
  };
}
