import { describe, expect, it } from "vitest";
import { FriendlyDatePipe } from "./friendly-date";

describe("Workspace friendly dates", () => {
  const pipe = new FriendlyDatePipe();
  const now = new Date(2026, 8, 22, 12).getTime();
  it.each([
    [0, "Just now"],
    [59_999, "Just now"],
    [60_000, "1 minute ago"],
    [180_000, "3 minutes ago"],
    [3_600_000, "1 hour ago"],
    [10_800_000, "3 hours ago"],
    [86_400_000, "1 day ago"],
    [259_200_000, "3 days ago"],
    [604_799_999, "6 days ago"],
    [604_800_000, "15 Sept"],
  ])("formats an age of %i milliseconds as %s", (age, expected) => {
    expect(pipe.transform(new Date(now - age).toISOString(), now)).toBe(
      expected,
    );
  });
  it("includes the year only outside the current local year", () => {
    expect(pipe.transform(new Date(2026, 3, 6).toISOString(), now)).toBe(
      "6 Apr",
    );
    expect(pipe.transform(new Date(2021, 5, 4).toISOString(), now)).toBe(
      "4 Jun 2021",
    );
  });
  it("uses an absolute date for future timestamps", () => {
    expect(pipe.transform(new Date(2026, 8, 23).toISOString(), now)).toBe(
      "23 Sept",
    );
  });
  it("handles missing and invalid dates", () => {
    expect(pipe.transform(undefined, now)).toBe("—");
    expect(pipe.transform("invalid", now)).toBe("—");
  });
});
