import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";

@Component({
  selector: "cedar-group-picker",
  imports: [FormsModule, TranslatePipe],
  template: `
    @if (!labelledBy) {
      <label [for]="id + '-input'">{{ label }}</label>
    }
    <input
      spellcheck="false"
      [id]="id + '-input'"
      type="text"
      role="combobox"
      [attr.aria-labelledby]="labelledBy || null"
      autocomplete="off"
      [attr.aria-expanded]="open && matches.length > 0"
      [attr.aria-controls]="open && matches.length ? id + '-options' : null"
      [attr.aria-activedescendant]="
        open && matches.length ? id + '-option-' + active : null
      "
      aria-autocomplete="list"
      [placeholder]="placeholder"
      [disabled]="disabled"
      [ngModel]="query"
      (ngModelChange)="search($event)"
      (keydown)="key($event)"
      (focus)="open = !!query"
      (blur)="open = false"
    />
    @if (open && matches.length) {
      <div
        class="options"
        role="listbox"
        [attr.aria-label]="label"
        [id]="id + '-options'"
      >
        @for (option of matches; track option.id; let i = $index) {
          <button
            type="button"
            tabindex="-1"
            role="option"
            [id]="id + '-option-' + i"
            [attr.aria-selected]="i === active"
            [class.active]="i === active"
            (pointermove)="active = i"
            (mousedown)="$event.preventDefault()"
            (click)="choose(option)"
          >
            {{ option.label }}
          </button>
        }
      </div>
    } @else if (open && query.trim()) {
      <p role="status">{{ "GroupPicker.NoMatches" | translate }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
      label {
        display: block;
        margin: 0 0 6px;
        color: var(--cedar-text-muted);
        font-size: var(--cedar-font-size);
        font-weight: var(--cedar-font-weight-medium);
      }
      input {
        display: block;
        width: 100%;
        height: var(--cedar-control-height-default);
        min-height: 0;
        padding: 6px var(--cedar-space-3);
        border-color: var(--cedar-control-border-default);
      }
      input::placeholder {
        color: var(--cedar-text-muted);
      }
      .options {
        position: absolute;
        z-index: var(--cedar-layer-menu);
        top: 100%;
        left: 0;
        min-width: 160px;
        width: 100%;
        max-width: 100%;
        padding: var(--cedar-space-1) 0;
        background: var(--cedar-overlay-surface);
        border: 1px solid var(--cedar-overlay-border);
        border-radius: var(--cedar-menu-radius);
        box-shadow: var(--cedar-menu-shadow);
      }
      button {
        display: block;
        width: 100%;
        min-height: var(--cedar-menu-item-height);
        padding: var(--cedar-menu-item-padding-block)
          var(--cedar-menu-item-padding-inline);
        border-radius: 0;
        text-align: left;
        color: var(--cedar-text-primary);
      }
      button:hover:not(:disabled):not([aria-disabled='true']) {
        color: var(--cedar-text-primary);
        background: transparent;
      }
      button.active,
      button.active:hover:not(:disabled):not([aria-disabled='true']) {
        color: var(--cedar-text-selected);
        background: var(--cedar-surface-selected);
      }
    `,
  ],
})
export class GroupPicker implements OnChanges {
  @Input() id = "";
  @Input() label = "";
  @Input() labelledBy = "";
  @Input() placeholder = "";
  @Input() options: { id: string; label: string }[] = [];
  @Input() value = "";
  @Input() clearOnPick = false;
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();
  @Output() picked = new EventEmitter<string>();
  query = "";
  open = false;
  active = 0;
  ngOnChanges(changes: SimpleChanges) {
    if (changes["value"] && !this.value && !this.open) this.query = "";
  }
  get matches() {
    return this.query.trim()
      ? this.options
          .filter((o) =>
            o.label.toLowerCase().includes(this.query.toLowerCase()),
          )
          .slice(0, 10)
      : [];
  }
  search(value: string) {
    this.query = value;
    this.open = true;
    this.active = 0;
    this.valueChange.emit("");
  }
  choose(option: { id: string; label: string }) {
    this.query = option.label;
    this.open = false;
    this.valueChange.emit(option.id);
    this.picked.emit(option.id);
    if (this.clearOnPick) this.query = "";
  }
  key(event: KeyboardEvent) {
    if (event.key === "Escape" && this.open) {
      event.preventDefault();
      event.stopPropagation();
      this.open = false;
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.open = true;
      this.active = Math.max(
        0,
        Math.min(
          this.matches.length - 1,
          this.active + (event.key === "ArrowDown" ? 1 : -1),
        ),
      );
    } else if (
      event.key === "Enter" &&
      this.open &&
      this.matches[this.active]
    ) {
      event.preventDefault();
      this.choose(this.matches[this.active]);
    }
  }
}
