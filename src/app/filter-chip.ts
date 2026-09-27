import { Component, input, output } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";

@Component({
  selector: "cedar-filter-chip",
  imports: [Icon, TranslatePipe],
  template: `<span class="chip" [class.active]="active()">
    <button
      type="button"
      (click)="toggle.emit()"
      aria-haspopup="dialog"
      [attr.aria-expanded]="expanded()"
      [attr.aria-label]="label()"
      [attr.aria-description]="active() ? text() : null"
      [attr.aria-controls]="controls()"
    >
      {{ text() }} <cedar-icon name="chevron-down" size="small" />
    </button>
    @if (active()) {
      <button
        type="button"
        class="clear"
        [attr.aria-label]="
          'Filters.ClearFilter' | translate: { name: label().toLowerCase() }
        "
        (click)="clear.emit()"
      >
        <cedar-icon name="x" size="small" />
      </button>
    }
  </span>`,
  styleUrl: "./filter-chip.scss",
})
export class FilterChip {
  readonly text = input.required<string>();
  readonly label = input.required<string>();
  readonly controls = input.required<string>();
  readonly active = input(false);
  readonly expanded = input(false);
  readonly toggle = output<void>();
  readonly clear = output<void>();
}
