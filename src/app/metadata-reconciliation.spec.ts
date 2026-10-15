import { expect, it } from "vitest";
import { reconcileMetadata } from "./metadata-reconciliation";

it("combines independent changes and preserves unknown server properties and provenance", () => {
  const base = {
    "@id": "instance",
    A: { "@value": "old" },
    B: { "@value": "old" },
    "pav:lastUpdatedOn": "old",
  };
  const mine = { ...base, A: { "@value": "mine" } };
  const latest = {
    ...base,
    B: { "@value": "theirs" },
    extra: { unknown: 42 },
    "pav:lastUpdatedOn": "new",
  };
  const result = reconcileMetadata(base, mine, latest);
  expect(result.complete).toBe(true);
  expect(result.metadata).toEqual({ ...latest, A: { "@value": "mine" } });
  expect(base.A["@value"]).toBe("old");
  expect(mine.B["@value"]).toBe("old");
});
it("requires a choice for changes to the same value, including deletion versus edit", () => {
  const base = { A: { "@value": "old" }, B: { "@value": "old" } };
  const mine = { A: { "@value": "mine" } };
  const latest = { A: { "@value": "theirs" }, B: { "@value": "changed" } };
  const result = reconcileMetadata(base, mine, latest);
  expect(result.complete).toBe(false);
  expect(result.changes).toHaveLength(2);
  const choices = new Map(
    result.changes.map((change) => [
      JSON.stringify(change.path),
      "mine" as const,
    ]),
  );
  expect(reconcileMetadata(base, mine, latest, choices)).toMatchObject({
    complete: true,
    metadata: mine,
  });
});
it("never merges repeated occurrences by position or applies a choice to another path", () => {
  const base = { Rows: [{ value: "A" }, { value: "B" }] };
  const mine = { Rows: [{ value: "B" }, { value: "A changed" }] };
  const latest = { Rows: [{ value: "A" }, { value: "B changed" }] };
  expect(reconcileMetadata(base, mine, latest).changes).toEqual([
    {
      path: ["Rows"],
      mine: mine.Rows,
      latest: latest.Rows,
      conflict: true,
      choice: undefined,
    },
  ]);
  expect(
    reconcileMetadata(base, mine, latest, new Map([['["Rows",0]', "mine"]]))
      .complete,
  ).toBe(false);
});
it("does not manufacture a conflict for equivalent property order or equal edits", () => {
  const base = { V: { a: 1, b: 2 } },
    mine = { V: { b: 2, a: 1 } },
    latest = { V: { a: 1, b: 3 } };
  expect(reconcileMetadata(base, mine, latest)).toMatchObject({
    metadata: latest,
    complete: true,
  });
  expect(reconcileMetadata(base, latest, latest).changes).toEqual([]);
});
it("treats prototype-named JSON properties as data without inherited values", () => {
  const base = JSON.parse('{"constructor":{"v":"old"}}');
  const mine = JSON.parse('{"constructor":{"v":"mine"}}');
  const latest = JSON.parse(
    '{"constructor":{"v":"old"},"__proto__":{"kept":true}}',
  );
  expect(reconcileMetadata(base, mine, latest)).toMatchObject({
    complete: true,
    metadata: JSON.parse(
      '{"constructor":{"v":"mine"},"__proto__":{"kept":true}}',
    ),
  });
  expect(
    Object.getPrototypeOf(reconcileMetadata(base, mine, latest).metadata),
  ).toBe(Object.prototype);
});
