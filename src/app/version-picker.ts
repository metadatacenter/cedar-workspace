import {
  Component,
  ElementRef,
  input,
  model,
  signal,
  viewChildren,
} from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";

/** A version's major, minor and patch numbers. */
export type Version = readonly [major: number, minor: number, patch: number];
type Part = 0 | 1 | 2;

// The resource server reads each part as a Java int, so typing stops at nine digits.
const MAX_DIGITS = 9;
const LARGEST = 10 ** MAX_DIGITS - 1;

/** Read a stored `pav:version`, or null when the resource server would refuse it. */
export function parseVersion(text: string | undefined): Version | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text ?? "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function formatVersion(version: Version): string {
  return version.join(".");
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Step one part. Raising a part resets the parts after it, as a release of that
 * kind does: a major step from 1.2.3 gives 2.0.0, not 2.2.3.
 */
export function stepVersion(version: Version, part: Part, by: 1 | -1): Version {
  const next: [number, number, number] = [...version];
  next[part] = Math.min(LARGEST, Math.max(0, next[part] + by));
  if (by > 0) for (let i = part + 1; i < 3; i++) next[i] = 0;
  return next;
}

/**
 * Three numeric boxes for a version's major, minor and patch numbers.
 *
 * The boxes are text rather than `type="number"` inputs, as in the Embeddable
 * Editor's clock: a number input accepts `e`, `-` and `.`, and the browser
 * draws stepper arrows beside it. Arrow keys step the focused part instead.
 */
@Component({
  selector: "cedar-version-picker",
  imports: [TranslatePipe],
  host: {
    role: "group",
    "[attr.aria-labelledby]": "labelledBy() || null",
  },
  template: `
    @for (part of parts; track part.index) {
      @if (part.index) {
        <span class="separator" aria-hidden="true">.</span>
      }
      <span class="part">
        <input
          #segment
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          [maxLength]="maxDigits"
          [id]="id + '-' + part.name"
          [value]="text(part.index)"
          [attr.aria-invalid]="invalid() || null"
          [attr.aria-describedby]="describedBy() || null"
          (focus)="segment.select()"
          (keydown)="key($event, part.index)"
          (input)="typed(segment, part.index)"
          (paste)="paste($event)"
          (blur)="left(part.index)"
        />
        <label [for]="id + '-' + part.name">{{
          "VersionPicker." + part.name | translate
        }}</label>
      </span>
    }
  `,
  styleUrl: "./version-picker.scss",
})
export class VersionPicker {
  private static nextId = 0;
  readonly id = `version-${VersionPicker.nextId++}`;
  readonly value = model.required<Version>();
  readonly labelledBy = input("");
  readonly describedBy = input("");
  readonly invalid = input(false);
  readonly maxDigits = MAX_DIGITS;
  readonly parts = [
    { index: 0, name: "Major" },
    { index: 1, name: "Minor" },
    { index: 2, name: "Patch" },
  ] as const;
  private readonly segments =
    viewChildren<ElementRef<HTMLInputElement>>("segment");
  /** What the focused box shows while its text is not yet a number, such as when emptied. */
  private readonly draft = signal<{ part: Part; text: string } | null>(null);

  text(part: Part): string {
    const draft = this.draft();
    return draft?.part === part ? draft.text : String(this.value()[part]);
  }

  key(event: KeyboardEvent, part: Part) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      this.draft.set(null);
      this.value.set(
        stepVersion(this.value(), part, event.key === "ArrowUp" ? 1 : -1),
      );
      return;
    }
    // `inputmode` only advises a touch keyboard, so every printable key but a
    // digit is refused here. A dot moves on to the next part, as typing a
    // version from left to right expects.
    const printable =
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
    if (!printable || /^\d$/.test(event.key)) return;
    event.preventDefault();
    if (event.key === "." && part < 2)
      this.segments()[part + 1].nativeElement.focus();
  }

  /** Keep only digits, without leading zeros, from what was typed or dropped in. */
  typed(segment: HTMLInputElement, part: Part) {
    const text = segment.value
      .replace(/\D/g, "")
      .replace(/^0+(?=\d)/, "")
      .slice(0, MAX_DIGITS);
    if (segment.value !== text) segment.value = text;
    this.draft.set({ part, text });
    if (!text) return;
    const next: [number, number, number] = [...this.value()];
    next[part] = Number(text);
    this.value.set(next);
  }

  /** A whole version pasted into any box fills all three. */
  paste(event: ClipboardEvent) {
    const version = parseVersion(event.clipboardData?.getData("text").trim());
    if (!version) return;
    event.preventDefault();
    this.draft.set(null);
    this.value.set(version);
  }

  /** A box left empty shows its number again. */
  left(part: Part) {
    if (this.draft()?.part === part) this.draft.set(null);
  }
}
