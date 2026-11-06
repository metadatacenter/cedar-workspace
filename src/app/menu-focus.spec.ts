import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { CloseOnFocusOut, focusLeaves } from "./menu-focus";

@Component({
  imports: [CloseOnFocusOut],
  template: `<button id="before">Before</button>
    <details cedarCloseOnFocusOut open>
      <summary>Menu</summary>
      <nav><a href="/one">One</a><a href="/two">Two</a></nav>
    </details>
    <button id="after">After</button>`,
})
class Host {}

/** Move focus as Tab does, which fires focusout on the element losing it with the next as its related target. */
const leave = (from: Element, to: Element | null) =>
  from.dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: to }),
  );

describe("closing a menu when focus leaves it", () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      menu: el.querySelector("details")!,
      first: el.querySelector('a[href="/one"]')!,
      second: el.querySelector('a[href="/two"]')!,
      before: el.querySelector<HTMLElement>("#before")!,
      after: el.querySelector<HTMLElement>("#after")!,
    };
  }
  it("closes when focus moves past either end of the menu", () => {
    const { menu, first, before, after } = render();
    leave(first, after);
    expect(menu.open).toBe(false);
    menu.open = true;
    leave(menu.querySelector("summary")!, before);
    expect(menu.open).toBe(false);
  });
  it("stays open while focus moves within the menu", () => {
    const { menu, first, second } = render();
    leave(first, second);
    leave(second, menu.querySelector("summary"));
    expect(menu.open).toBe(true);
  });
  it("stays open when focus is lost to no element, as Safari does on pointer-down", () => {
    const { menu, first } = render();
    leave(first, null);
    expect(menu.open).toBe(true);
  });
  it("leaves focus where it went", () => {
    const { first, after } = render();
    after.focus();
    leave(first, after);
    expect(document.activeElement).toBe(after);
  });
  it("counts only a move from inside the named containers to outside them and their surroundings", () => {
    const row = document.createElement("div");
    const menu = document.createElement("div");
    const trigger = document.createElement("button");
    const item = document.createElement("button");
    const outside = document.createElement("button");
    menu.append(item);
    row.append(trigger, menu);
    const event = (target: Element, relatedTarget: Element | null) => {
      const e = new FocusEvent("focusout", { relatedTarget });
      Object.defineProperty(e, "target", { value: target });
      return e;
    };
    expect(focusLeaves(event(item, outside), menu, trigger)).toBe(true);
    expect(focusLeaves(event(item, trigger), menu, trigger)).toBe(false);
    expect(focusLeaves(event(trigger, item), menu, trigger)).toBe(false);
    expect(focusLeaves(event(trigger, outside), menu, trigger)).toBe(true);
    expect(focusLeaves(event(outside, item), menu, trigger)).toBe(false);
    expect(focusLeaves(event(item, null), menu, trigger)).toBe(false);
    // Safari focuses a focusable element around the menu on pointer-down, such as its row.
    expect(focusLeaves(event(item, row), menu, trigger)).toBe(false);
    expect(focusLeaves(event(item, outside), null, undefined)).toBe(false);
  });
});
