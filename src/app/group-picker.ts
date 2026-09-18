import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

@Component({
  selector: "cedar-group-picker",
  imports: [FormsModule],
  template: `
    <label [for]="id + '-input'">{{ label }}</label>
    <input
      [id]="id + '-input'"
      type="text"
      role="combobox"
      autocomplete="off"
      [attr.aria-expanded]="open && matches.length > 0"
      [attr.aria-controls]="id + '-options'"
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
      <div class="options" role="listbox" [id]="id + '-options'">
        @for (option of matches; track option.id; let i = $index) {
          <button
            type="button"
            role="option"
            [id]="id + '-option-' + i"
            [attr.aria-selected]="i === active"
            [class.active]="i === active"
            (mousedown)="$event.preventDefault()"
            (click)="choose(option)"
          >
            {{ option.label }}
          </button>
        }
      </div>
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
        font-size: var(--cedar-font-size-small);
        font-weight: var(--cedar-font-weight-medium);
      }
      input {
        display: block;
        width: 100%;
        height: var(--cedar-control-height-default);
        min-height: 0;
        padding: 6px var(--cedar-space-3);
        border-color: var(--cedar-control-border-authoring);
      }
      input::placeholder {
        color: var(--cedar-text-muted);
      }
      .options {
        position: absolute;
        z-index: 5;
        top: 100%;
        left: 0;
        min-width: 160px;
        max-width: 100%;
        padding: var(--cedar-space-1) 0;
        background: var(--cedar-color-on-primary);
        border: 1px solid var(--cedar-border-rule);
        border-radius: var(--cedar-control-radius-default);
        box-shadow: 0 6px 12px rgb(0 0 0 / 18%);
      }
      button {
        display: block;
        width: 100%;
        min-height: 0;
        padding: 3px 20px;
        border-radius: 0;
        text-align: left;
        color: var(--cedar-text-primary);
      }
      button.active,
      button:hover {
        color: var(--cedar-color-on-primary);
        background: var(--cedar-color-primary);
      }
    `,
  ],
})
export class GroupPicker implements OnChanges {
  @Input() id = "";
  @Input() label = "";
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
    if (event.key === "Escape") {
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
