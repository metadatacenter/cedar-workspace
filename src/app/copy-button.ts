import { Component, computed, input, output, signal } from "@angular/core";
import { Icon } from "./icon";

@Component({
  selector: "cedar-copy-button",
  imports: [Icon],
  host: {
    "(mouseenter)": "enter()",
    "(mouseleave)": "hovered.set(false)",
    "(document:keydown.escape)": "dismissed.set(true)",
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
      <span role="tooltip" [id]="id">{{ help() || label() }}</span>
    }
  `,
  styleUrl: "./copy-button.scss",
})
export class CopyButton {
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
  enter() {
    this.dismissed.set(false);
    this.hovered.set(true);
  }
  focus(event: FocusEvent) {
    this.dismissed.set(false);
    this.focused.set((event.target as HTMLElement).matches(":focus-visible"));
  }
}
