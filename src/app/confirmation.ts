import {
  Component,
  ElementRef,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { DialogKeyboard } from "./dialog-keyboard";

@Injectable({ providedIn: "root" })
export class Confirmation {
  readonly message = signal("");
  private resolve?: (accepted: boolean) => void;
  private returnFocus: HTMLElement | null = null;
  confirm(message: string): Promise<boolean> {
    // A second activation must not replace a decision already in progress.
    if (this.resolve) return Promise.resolve(false);
    this.returnFocus = document.activeElement as HTMLElement | null;
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
  imports: [DialogKeyboard],
  template: `@if (confirmation.message()) {
    <dialog
      #dialog
      cedarDialogKeyboard
      class="confirmation-dialog"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
      (cancel)="
        $event.preventDefault(); $event.stopPropagation(); decide(false)
      "
    >
      <h2 id="confirmation-title">Are you sure?</h2>
      <p id="confirmation-message">{{ confirmation.message() }}</p>
      <footer>
        <button autofocus (click)="decide(false)">Cancel</button
        ><button class="primary" (click)="decide(true)">OK</button>
      </footer>
    </dialog>
  }`,
  styles: [
    `
      @use "@org.metadatacenter/cedar-design-tokens/patterns";
      dialog {
        @include patterns.dialog-surface;
        width: min(460px, calc(100vw - 32px));
      }
      h2 {
        @include patterns.artifact-title;
        margin: 0 0 var(--cedar-space-2);
      }
      p {
        margin: 0 0 var(--cedar-space-4);
        line-height: var(--cedar-control-line-height-default);
      }
      footer {
        @include patterns.dialog-actions;
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
