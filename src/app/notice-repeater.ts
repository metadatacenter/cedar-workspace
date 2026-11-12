import { WritableSignal } from "@angular/core";
import { statusRegionDelay } from "./status-region";

/**
 * Shows a page's notice so that a repeat of the notice before it is seen and heard again. The toast
 * and its status region react only to a changed notice, so a repeat is cleared first and set again
 * after `statusRegionDelay`. A screen reader says a region's text again only when the region was
 * empty for that long.
 */
export class NoticeRepeater {
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly notice: WritableSignal<string>) {}

  show(message: string): void {
    const repeating = this.timer !== undefined || this.notice() === message;
    this.cancel();
    if (!repeating) {
      this.notice.set(message);
      return;
    }
    this.notice.set("");
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.notice.set(message);
    }, statusRegionDelay);
  }

  /** Drop a repeat that is waiting to be shown. */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
