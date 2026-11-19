import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyFilters } from "./listing-filters";
import { ResourceFilters } from "./resource-filters";

describe("Workspace filter popover", () => {
  afterEach(() => vi.useRealTimers());

  for (const kind of ["type", "date"] as const)
    it(`fits and focuses the ${kind} popover when it is drawn, without a timer`, async () => {
      const fixture = TestBed.createComponent(ResourceFilters);
      fixture.componentRef.setInput("value", emptyFilters());
      await fixture.whenStable();
      // A timer once did this work. When it fired before the popover was drawn, the popover kept
      // its fallback height, which put Apply below a 375 by 1000 window, and took no focus.
      vi.useFakeTimers();
      fixture.componentInstance.toggle(kind);
      fixture.detectChanges();
      const popup = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>('[role="dialog"]')!;
      expect(popup.style.getPropertyValue("--filter-available-height")).toMatch(
        /^\d+(\.\d+)?px$/,
      );
      expect(popup.contains(document.activeElement)).toBe(true);
    });
});
