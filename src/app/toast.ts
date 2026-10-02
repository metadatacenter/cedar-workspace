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
      role="status"
      aria-live="polite"
      aria-atomic="true"
      (mouseenter)="pause()"
      (mouseleave)="resume()"
      (focusin)="pause()"
      (focusout)="resume()"
    >
      <cedar-icon name="check" /><span>{{ message() }}</span>
      <button
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
  dismiss() {
    this.pause();
    this.visible.set(false);
  }
}
