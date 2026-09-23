import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { Icon } from "./icon";

@Component({
  selector: "cedar-copy-button",
  imports: [Icon],
  host: {
    "(mouseenter)": "enter()",
    "(mouseleave)": "hovered.set(false)",
    "(document:keydown.escape)": "dismissed.set(true)",
    "(window:resize)": "dismissed.set(true)",
  },
  template: `
    <button
      type="button"
      class="copy-icon"
      [attr.aria-label]="label()"
      [attr.aria-describedby]="visible() ? id : null"
      (focus)="focus($event)"
      (blur)="focused.set(false)"
      (click)="copied.emit()"
    >
      <cedar-icon name="copy" />
    </button>
    @if (visible()) {
      <span #tooltip role="tooltip" [id]="id">{{ help() || label() }}</span>
    }
  `,
  styleUrl: "./copy-button.scss",
})
export class CopyButton {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tooltip = viewChild<ElementRef<HTMLElement>>("tooltip");
  private static nextId = 0;
  readonly id = `copy-help-${CopyButton.nextId++}`;
  readonly label = input.required<string>();
  readonly help = input("");
  readonly copied = output<void>();
  readonly hovered = signal(false);
  readonly focused = signal(false);
  readonly dismissed = signal(false);
  readonly visible = computed(
    () => !this.dismissed() && (this.hovered() || this.focused()),
  );
  constructor() {
    // Fixed positioning escapes the Instances list's scrolling/clipping box.
    afterRenderEffect(() => {
      const tip = this.tooltip()?.nativeElement;
      if (!tip) return;
      const anchor = this.host.nativeElement.getBoundingClientRect();
      const bounds = tip.getBoundingClientRect();
      const gutter = parseFloat(
        getComputedStyle(tip).getPropertyValue("--cedar-space-2"),
      );
      tip.style.left = `${Math.max(gutter, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - gutter))}px`;
      const above = anchor.top - bounds.height;
      tip.style.top = `${above >= gutter ? above : anchor.bottom}px`;
      tip.style.visibility = "visible";
    });
    const dismiss = () => this.dismissed.set(true);
    document.addEventListener("scroll", dismiss, true);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener("scroll", dismiss, true),
    );
  }
  enter() {
    this.dismissed.set(false);
    this.hovered.set(true);
  }
  focus(event: FocusEvent) {
    this.dismissed.set(false);
    this.focused.set((event.target as HTMLElement).matches(":focus-visible"));
  }
}
