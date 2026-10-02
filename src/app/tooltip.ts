import {
  DestroyRef,
  Directive,
  ElementRef,
  effect,
  inject,
  input,
} from "@angular/core";
import { TooltipController } from "./tooltip-controller";

/** Shared, local help: no browser-dependent native-title delay or network request. */
@Directive({
  selector: "[cedarTooltip]",
  host: {
    "[attr.data-cedar-help]": "cedarTooltip() || null",
    "(pointerenter)": "enter($event)",
    "(pointerleave)": "leave()",
    "(focusin)": "focus()",
    "(focusout)": "hide()",
    "(pointerdown)": "hide()",
  },
})
export class Tooltip {
  private readonly controller = inject(TooltipController);
  readonly cedarTooltip = input<string | null | undefined>("");
  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private static nextId = 0;
  private static active?: Tooltip;
  private readonly id = `workspace-help-${Tooltip.nextId++}`;
  private timer?: ReturnType<typeof setTimeout>;
  private tip?: HTMLElement;
  private cleanup?: () => void;

  constructor() {
    effect(() => {
      this.cedarTooltip();
      this.controller.suppressed();
      this.hide();
    });
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  enter(event: PointerEvent) {
    if (event.pointerType === "touch" || this.controller.suppressed()) return;
    this.cancelTimer();
    this.timer = setTimeout(() => this.show(true), 250);
  }

  focus() {
    if (this.host.matches(":focus-visible")) this.show(false);
  }

  leave() {
    this.cancelTimer();
    // Allow the pointer to cross the small gap onto the help itself.
    this.timer = setTimeout(() => this.hide(), 100);
  }

  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private show(byPointer: boolean) {
    this.cancelTimer();
    const text = this.cedarTooltip();
    if (!text || !this.host.isConnected || this.tip || this.controller.suppressed()) return;
    Tooltip.active?.hide();
    Tooltip.active = this;
    const tip = document.createElement("span");
    this.tip = tip;
    tip.id = this.id;
    tip.className = "workspace-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    tip.addEventListener("pointerenter", () => this.cancelTimer());
    tip.addEventListener("pointerleave", () => this.leave());
    // A modal's help must share its top layer rather than sit behind it.
    (this.host.closest("dialog") || document.body).append(tip);
    const descriptions =
      this.host
        .getAttribute("aria-describedby")
        ?.split(/\s+/)
        .filter(Boolean) || [];
    this.host.setAttribute(
      "aria-describedby",
      [...descriptions, this.id].join(" "),
    );
    const anchor = this.host.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    const gutter = 8;
    tip.style.left = `${Math.max(gutter, Math.min(anchor.left, innerWidth - bounds.width - gutter))}px`;
    const below = anchor.bottom + 4;
    tip.style.top = `${Math.max(gutter, below + bounds.height <= innerHeight - gutter ? below : anchor.top - bounds.height - 4)}px`;
    tip.style.visibility = "visible";
    const dismiss = () => this.hide();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.hide();
    };
    // Chrome can lose track of the element under the pointer, as when the pointer leaves the
    // window and comes back, and the trigger is then sent no pointerleave: the help stayed until
    // the next click. Help the pointer opened therefore closes, as leaving would, once the
    // pointer moves over anything that is neither the trigger nor the help.
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (this.host.contains(target) || tip.contains(target))
      )
        return;
      if (this.timer === undefined)
        this.timer = setTimeout(() => this.hide(), 100);
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("pointerdown", dismiss, true);
    if (byPointer) document.addEventListener("pointermove", away, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    this.cleanup = () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("pointermove", away, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }

  hide() {
    this.cancelTimer();
    this.tip?.remove();
    this.tip = undefined;
    this.cleanup?.();
    this.cleanup = undefined;
    const descriptions = this.host
      .getAttribute("aria-describedby")
      ?.split(/\s+/)
      .filter((id) => id && id !== this.id);
    if (descriptions?.length)
      this.host.setAttribute("aria-describedby", descriptions.join(" "));
    else this.host.removeAttribute("aria-describedby");
    if (Tooltip.active === this) Tooltip.active = undefined;
  }
}
