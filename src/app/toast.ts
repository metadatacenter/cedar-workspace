import { Tooltip } from "./tooltip";
import { Component, effect, input, signal } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";

@Component({
  selector: "cedar-toast",
  imports: [Tooltip, Icon, TranslatePipe],
  template: `@if (message() && visible()) {
    <div
      class="toast"
      [attr.role]="live() ? 'status' : null"
      [attr.aria-live]="live() ? 'polite' : null"
      [attr.aria-atomic]="live() ? 'true' : null"
      (mouseenter)="pause()"
      (mouseleave)="resume()"
      (focusin)="pause()"
      (focusout)="resume()"
    >
      <cedar-icon name="check" /><span>{{ message() }}</span>
      <button
        (focus)="origin = $event.relatedTarget"
        [attr.aria-label]="'Toast.Dismiss' | translate"
        [cedarTooltip]="'Toast.Dismiss' | translate"
        (click)="dismiss()"
      >
        <cedar-icon name="close" />
      </button>
    </div>
  }`,
  styleUrl: "./toast.scss",
})
export class Toast {
  readonly message = input("");
  /**
   * Whether the toast is a polite status region itself. A page that says its outcomes in a status
   * region of its own turns this off, so that each outcome is said once.
   */
  readonly live = input(true);
  readonly visible = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  constructor() {
    effect((onCleanup) => {
      this.visible.set(!!this.message());
      this.resume();
      onCleanup(() => this.pause());
    });
  }
  pause() {
    clearTimeout(this.timer);
  }
  resume() {
    this.pause();
    this.timer = setTimeout(() => this.visible.set(false), 6000);
  }
  /** The control focus came from to the dismiss button, which gets it back on dismissal. */
  origin: EventTarget | null = null;
  dismiss() {
    this.pause();
    this.visible.set(false);
    if (this.origin instanceof HTMLElement && this.origin.isConnected)
      this.origin.focus();
    this.origin = null;
  }
}
