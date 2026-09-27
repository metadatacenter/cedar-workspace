import { Component, effect, input, signal } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";

@Component({
  selector: "cedar-toast",
  imports: [Icon, TranslatePipe],
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
        (click)="dismiss()"
      >
        <cedar-icon name="close" />
      </button>
    </div>
  }`,
  styles: [
    `
      .toast {
        position: fixed;
        z-index: var(--cedar-layer-overlay);
        right: var(--cedar-space-4);
        bottom: var(--cedar-space-4);
        max-width: calc(100vw - 32px);
        display: flex;
        align-items: center;
        gap: var(--cedar-space-2);
        padding: var(--cedar-space-2) var(--cedar-space-3);
        color: var(--cedar-status-success-text);
        background: var(--cedar-status-success-surface);
        border: 1px solid var(--cedar-border-rule);
        border-radius: var(--cedar-control-radius-default);
        box-shadow: var(--cedar-menu-shadow);
      }
      button {
        color: inherit;
        flex-shrink: 0;
      }
    `,
  ],
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
