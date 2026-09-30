import {
  Component,
  ElementRef,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";
import { DialogKeyboard } from "./dialog-keyboard";

@Injectable({ providedIn: "root" })
export class Confirmation {
  readonly message = signal("");
  readonly icon = signal("warning");
  private resolve?: (accepted: boolean) => void;
  private returnFocus: HTMLElement | null = null;
  confirm(message: string, icon = "warning"): Promise<boolean> {
    // A second activation must not replace a decision already in progress.
    if (this.resolve) return Promise.resolve(false);
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.icon.set(icon);
    this.message.set(message);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
  finish(accepted: boolean) {
    const resolve = this.resolve;
    this.resolve = undefined;
    this.message.set("");
    const target = this.returnFocus;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
    resolve?.(accepted);
  }
}

@Component({
  selector: "cedar-confirmation",
  imports: [DialogKeyboard, TranslatePipe, Icon],
  template: `@if (confirmation.message()) {
    <dialog
      #dialog
      cedarDialogKeyboard
      class="confirmation-dialog dialog-stack"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
      (cancel)="
        $event.preventDefault(); $event.stopPropagation(); decide(false)
      "
    >
      <h2 id="confirmation-title">{{ "Confirmation.Title" | translate }}</h2>
      <p id="confirmation-message">
        <cedar-icon [name]="confirmation.icon()" /><span>{{
          confirmation.message()
        }}</span>
      </p>
      <footer>
        <button autofocus (click)="decide(false)">
          {{ "Common.Cancel" | translate }}</button
        ><button class="primary" (click)="decide(true)">
          {{ "Common.OK" | translate }}
        </button>
      </footer>
    </dialog>
  }`,
  styles: [
    `
      dialog {
        width: min(460px, calc(100vw - 32px));
      }
      p {
        display: flex;
        align-items: center;
        gap: var(--cedar-space-2);
        line-height: var(--cedar-control-line-height-default);
      }
      cedar-icon {
        flex-shrink: 0;
        color: var(--cedar-color-primary);
      }
    `,
  ],
})
export class ConfirmationOutlet {
  readonly confirmation = inject(Confirmation);
  readonly dialog = viewChild<ElementRef<HTMLDialogElement>>("dialog");
  constructor() {
    effect(() => {
      const dialog = this.dialog()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
  }
  decide(accepted: boolean) {
    this.dialog()?.nativeElement.close();
    this.confirmation.finish(accepted);
  }
}
