import { signal } from "@angular/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeRepeater } from "./notice-repeater";
import { statusRegionDelay } from "./status-region";

describe("NoticeRepeater", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a new notice at once", () => {
    const notice = signal("Saved.");
    new NoticeRepeater(notice).show("Copied.");
    expect(notice()).toBe("Copied.");
  });

  it("clears a repeated notice, then shows it again after the status region's delay", () => {
    const notice = signal("Copied.");
    new NoticeRepeater(notice).show("Copied.");
    expect(notice()).toBe("");
    vi.advanceTimersByTime(statusRegionDelay - 1);
    expect(notice()).toBe("");
    vi.advanceTimersByTime(1);
    expect(notice()).toBe("Copied.");
  });

  it("treats a notice that arrives while a repeat waits as a repeat, and shows only the latest", () => {
    const notice = signal("Copied.");
    const notices = new NoticeRepeater(notice);
    notices.show("Copied.");
    notices.show("Saved.");
    expect(notice()).toBe("");
    vi.advanceTimersByTime(statusRegionDelay);
    expect(notice()).toBe("Saved.");
  });

  it("drops a waiting repeat when cancelled", () => {
    const notice = signal("Copied.");
    const notices = new NoticeRepeater(notice);
    notices.show("Copied.");
    notices.cancel();
    vi.advanceTimersByTime(statusRegionDelay);
    expect(notice()).toBe("");
  });
});
