import { Tooltip } from "./tooltip";
import { Component, effect, input, signal } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";
import { StatusRegion } from "./status-region";

@Component({
  selector: "cedar-toast",
  imports: [Tooltip, Icon, TranslatePipe, StatusRegion],
  template: `@if (message() && visible()) {
    <div
      class="toast"
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
  }
  @if (live()) {
    <cedar-status [text]="visible() && !saidElsewhere() ? message() : ''" />
  }`,
  styleUrl: "./toast.scss",
})
export class Toast {
  readonly message = input("");
  /**
   * Whether the toast keeps a status region, which says each message while the toast shows it. A
   * page keeps the toast in place while it has no message, so that the region is there before the
   * first. A page that says every outcome in a status region of its own turns this off, so that
   * each is said once.
   */
  readonly live = input(true);
  /** Whether a status region elsewhere says the current message, so that the toast only shows it. */
  readonly saidElsewhere = input(false);
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
