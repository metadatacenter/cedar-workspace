import { Directive, ElementRef, HostListener, inject } from "@angular/core";

/** Native modality makes the page inert; explicitly wrap Tab before browser chrome. */
@Directive({ selector: "dialog[cedarDialogKeyboard]" })
export class DialogKeyboard {
  private host = inject<ElementRef<HTMLDialogElement>>(ElementRef);
  @HostListener("keydown", ["$event"])
  key(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const dialog = this.host.nativeElement;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        el.getClientRects().length &&
        !el.closest("[inert]"),
    );
    const active = controls.indexOf(document.activeElement as HTMLElement);
    if (
      !controls.length ||
      active < 0 ||
      (!event.shiftKey && active === controls.length - 1) ||
      (event.shiftKey && active === 0)
    ) {
      event.preventDefault();
      (controls[event.shiftKey ? controls.length - 1 : 0] || dialog).focus();
    }
  }
}
