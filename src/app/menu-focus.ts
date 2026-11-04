import { Directive, ElementRef, HostListener, inject } from "@angular/core";

/**
 * Whether `event` moves focus from a node inside one of `within` to a node outside all of them.
 *
 * Safari blurs the focused item on pointer-down without focusing the clicked one. Focus goes to no
 * element, or to the nearest focusable element around the menu, such as an artifact's row. Neither
 * counts, so the menu stays mounted until the click can select its item. Explicit focus transfers,
 * Tab among them, still count, and outside clicks dismiss a menu on their own.
 */
export function focusLeaves(
  event: FocusEvent,
  ...within: (Node | null | undefined)[]
) {
  const inside = (node: EventTarget | null) =>
    node instanceof Node &&
    within.some((container) => container?.contains(node));
  const next = event.relatedTarget;
  return (
    inside(event.target) &&
    next instanceof Node &&
    !inside(next) &&
    !within.some((container) => container && next.contains(container))
  );
}

/** Closes a menu built on `<details>` when focus leaves it. Focus stays where it went. */
@Directive({ selector: "details[cedarCloseOnFocusOut]" })
export class CloseOnFocusOut {
  private readonly host = inject<ElementRef<HTMLDetailsElement>>(ElementRef);
  @HostListener("focusout", ["$event"])
  focusOut(event: FocusEvent) {
    const menu = this.host.nativeElement;
    if (menu.open && focusLeaves(event, menu)) menu.open = false;
  }
}
