import { Tooltip } from "./tooltip";
import { Component, input, output } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";

/**
 * A filter's chip. An inactive chip shows the filter's name and is named by it. An active chip
 * shows the filter's choice, and its name begins with that choice and goes on to name the filter.
 */
@Component({
  selector: "cedar-filter-chip",
  imports: [Tooltip, Icon, TranslatePipe],
  template: `<span class="chip" [class.active]="active()">
    <button
      type="button"
      (click)="toggle.emit()"
      aria-haspopup="dialog"
      [attr.aria-expanded]="expanded()"
      [attr.aria-label]="
        active()
          ? ('Filters.ActiveChip'
            | translate: { choice: text(), filter: label().toLowerCase() })
          : label()
      "
      [attr.aria-controls]="expanded() ? controls() : null"
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
        [cedarTooltip]="'Filters.ClearFilter' | translate: { name: label().toLowerCase() }"
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
