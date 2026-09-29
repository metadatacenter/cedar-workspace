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
    this.timer = setTimeout(() => this.show(), 250);
  }

  focus() {
    if (this.host.matches(":focus-visible")) this.show();
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

  private show() {
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
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("resize", dismiss);
    this.cleanup = () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("resize", dismiss);
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
