import { Injector, afterNextRender } from "@angular/core";

/**
 * Return focus that an action took from the page, once Angular has drawn the action's outcome.
 *
 * An action disables controls while it runs, which takes focus from the one pressed, and its
 * outcome can remove that control. Focus goes back to the control that had it when that is still
 * there and enabled, and otherwise to the control `fallback` gives. Focus the person has since
 * moved stays where they put it.
 */
export function returnFocus(
  focused: Element | null,
  fallback: (() => HTMLElement | null | undefined) | null | undefined,
  injector: Injector,
) {
  afterNextRender(
    () =>
      // A form control takes its disabled binding a microtask after Angular draws it, so the
      // controls are read once that has happened.
      queueMicrotask(() => {
        // A focused control the action left disabled keeps focus until the browser next draws the
        // page, and loses it then. This can run first, so such a control counts as having lost it.
        const active = document.activeElement;
        if (active && active !== document.body && !active.matches(":disabled")) return;
        const before =
          focused instanceof HTMLElement &&
          focused !== document.body &&
          focused.isConnected &&
          !focused.matches(":disabled")
            ? focused
            : null;
        (before ?? fallback?.())?.focus();
      }),
    { injector },
  );
}
