import { describe, expect, it } from "vitest";
import {
  applyListingFilters,
  dateBounds,
  filterQuery,
  filtersFromParams,
  parseDate,
} from "./listing-filters";

describe("Workspace filters", () => {
  it.each([
    ["today", "2026-01-03", "2026-01-03"],
    ["week", "2025-12-28", "2026-01-03"],
    ["month", "2025-12-05", "2026-01-03"],
    ["year", "2026-01-01", "2026-01-03"],
    ["last-year", "2025-01-01", "2025-12-31"],
  ] as const)(
    "resolves %s across year boundaries",
    (modified, after, before) => {
      expect(
        dateBounds({ types: [], modified }, new Date(2026, 0, 3, 12)),
      ).toEqual({ after, before });
    },
  );
  it("keeps multiple types, removes duplicates and invalid URL types", () => {
    expect(
      filtersFromParams(
        new URLSearchParams({ resource_types: "field,folder,field,invalid" }),
      ).types,
    ).toEqual(["folder", "field"]);
  });
  it("serializes inclusive calendar dates to an exclusive next local midnight", () => {
    const params = new URLSearchParams({
      resource_types: "template,field",
      modified: "custom",
      after: "2026-03-08",
      before: "2026-03-08",
    });
    const query = new URLSearchParams({ offset: "50" });
    applyListingFilters(query, params);
    expect(query.get("resource_types")).toBe("template,field");
    expect(query.get("modified_after")).toBe(
      String(new Date(2026, 2, 8).getTime()),
    );
    expect(query.get("modified_before")).toBe(
      String(new Date(2026, 2, 9).getTime()),
    );
    expect(query.get("offset")).toBe("50");
  });
  it("allows open ranges and rejects impossible dates", () => {
    expect(parseDate("2026-02-29")).toBeUndefined();
    expect(parseDate("2024-02-29")).toBeDefined();
    const query = new URLSearchParams();
    applyListingFilters(
      query,
      new URLSearchParams({ modified: "custom", before: "2026-09-22" }),
    );
    expect(query.has("modified_after")).toBe(false);
    expect(query.get("modified_before")).toBe(
      String(new Date(2026, 8, 23).getTime()),
    );
  });
  it("clears stale custom dates and resets pagination when changing a filter", () => {
    expect(
      filterQuery({
        types: ["folder", "template"],
        modified: "week",
        after: "2026-01-01",
      }),
    ).toEqual({
      resource_types: "folder,template",
      modified: "week",
      after: null,
      before: null,
      offset: null,
    });
  });
});
