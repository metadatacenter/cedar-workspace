import { DOCUMENT, Injectable, inject, signal } from "@angular/core";

/**
 * Shared suppression for pointer gestures, including both tooltip renderers, and the input that
 * last moved focus.
 */
@Injectable({ providedIn: "root" })
export class TooltipController {
  private readonly suspended = signal(false);
  readonly suppressed = this.suspended.asReadonly();
  private pointer = false;

  constructor() {
    // WebKit counts focus that a script moves as focus-visible unless a click focused something
    // first. A button there takes no focus from a click or a tap, so a dialog opened from one,
    // which focuses its first button, showed that button's help. Help therefore opens on focus
    // only when the keyboard was the last input.
    const document = inject(DOCUMENT);
    document.addEventListener("pointerdown", () => (this.pointer = true), true);
    document.addEventListener("keydown", () => (this.pointer = false), true);
  }

  /** Whether the last input came from the keyboard, or no input has come yet. */
  keyboardLast() {
    return !this.pointer;
  }

  suspend() {
    this.suspended.set(true);
  }
  resume() {
    this.suspended.set(false);
  }
}
