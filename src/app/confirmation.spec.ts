import { TestBed } from "@angular/core/testing";
import { describe, it, expect } from "vitest";
import { Confirmation } from "./confirmation";

describe("shared confirmation", () => {
  it("does not let a second request replace or approve the pending decision", async () => {
    const confirmation = TestBed.inject(Confirmation);
    const first = confirmation.confirm("Remove a member?");
    expect(await confirmation.confirm("Delete everything?")).toBe(false);
    expect(confirmation.message()).toBe("Remove a member?");
    confirmation.finish(false);
    expect(await first).toBe(false);
    const next = confirmation.confirm("Save this change?");
    confirmation.finish(true);
    expect(await next).toBe(true);
    expect(confirmation.message()).toBe("");
  });
});
