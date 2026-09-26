import { describe, expect, it } from "vitest";
import { selectionRange } from "./explorer-selection";
describe("displayed-page selection", () => {
  it("extends a range in either direction using the current sort order", () => {
    expect(selectionRange(["c", "a", "b"], "b", "c")).toEqual(["c", "a", "b"]);
    expect(selectionRange(["c", "a", "b"], "c", "a")).toEqual(["c", "a"]);
  });
  it("does not select another page when its old anchor disappeared", () => {
    expect(selectionRange(["d", "e"], "a", "e")).toEqual(["e"]);
  });
});
