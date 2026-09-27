import {
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { FilterChip } from "./filter-chip";
import {
  ListingFilters,
  DatePreset,
  dateBounds,
  emptyFilters,
  parseDate,
  resourceTypes,
} from "./listing-filters";
import { Icon } from "./icon";
import { I18n } from "./i18n";

@Component({
  selector: "cedar-resource-filters",
  imports: [FormsModule, FilterChip, Icon, TranslatePipe],
  templateUrl: "./resource-filters.html",
  styleUrl: "./resource-filters.scss",
})
export class ResourceFilters {
  private static nextId = 0;
  readonly id = `resource-filters-${ResourceFilters.nextId++}`;
  readonly value = input.required<ListingFilters>();
  readonly change = output<ListingFilters>();
  readonly version = input("all");
  readonly versionChange = output<string>();
  readonly open = signal<"type" | "date" | null>(null);
  readonly types = resourceTypes;
  readonly draft = signal<ListingFilters>(emptyFilters());
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly i18n = inject(I18n);
  private trigger?: HTMLElement;
  get presets(): { value: DatePreset; label: string }[] {
    const year = new Date().getFullYear();
    const t = this.i18n.t.bind(this.i18n);
    return [
      { value: "today", label: t("Filters.Presets.Today") },
      { value: "week", label: t("Filters.Presets.Week") },
      { value: "month", label: t("Filters.Presets.Month") },
      { value: "year", label: t("Filters.Presets.Year", { year }) },
      {
        value: "last-year",
        label: t("Filters.Presets.LastYear", { year: year - 1 }),
      },
      { value: "custom", label: t("Filters.Presets.Custom") },
    ];
  }
  get typeLabel(): string {
    return (
      this.types
        .filter((type) => this.value().types.includes(type.value))
        .map((type) => this.i18n.t(type.label))
        .join(", ") || this.i18n.t("Common.Type")
    );
  }
  get dateLabel(): string {
    const v = this.value();
    if (v.modified !== "custom")
      return (
        this.presets.find((p) => p.value === v.modified)?.label ||
        this.i18n.t("Common.LastModified")
      );
    const format = (value: string) =>
      new Intl.DateTimeFormat(this.i18n.locale("en-GB"), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(parseDate(value)!);
    if (v.after && v.before)
      return this.i18n.t("Filters.Range", {
        after: format(v.after),
        before: format(v.before),
      });
    return v.after
      ? this.i18n.t("Filters.From", { date: format(v.after) })
      : v.before
        ? this.i18n.t("Filters.Through", { date: format(v.before) })
        : this.i18n.t("Common.LastModified");
  }
  get rangeError(): string {
    const d = this.draft();
    if ((d.after && !parseDate(d.after)) || (d.before && !parseDate(d.before)))
      return this.i18n.t("Filters.InvalidDate");
    return d.after && d.before && d.after > d.before
      ? this.i18n.t("Filters.RangeOrder")
      : "";
  }
  toggle(kind: "type" | "date") {
    if (this.open() === kind) {
      this.close();
      return;
    }
    this.trigger = document.activeElement as HTMLElement;
    const value = this.value();
    this.draft.set({ ...value, types: [...value.types], ...dateBounds(value) });
    this.open.set(kind);
    setTimeout(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(
          '[role="dialog"] button, [role="dialog"] input',
        )
        ?.focus(),
    );
  }
  close(restore = true) {
    this.open.set(null);
    if (restore) this.trigger?.focus();
  }
  selectType(type: (typeof resourceTypes)[number]["value"]) {
    this.draft.update((v) => ({
      ...v,
      types: v.types.includes(type)
        ? v.types.filter((t) => t !== type)
        : this.types
            .filter((t) => v.types.includes(t.value) || t.value === type)
            .map((t) => t.value),
    }));
  }
  preset(modified: DatePreset) {
    this.draft.update((v) => ({
      ...v,
      modified,
      ...dateBounds({ ...v, modified }),
    }));
  }
  editDate(key: "after" | "before", value: string) {
    this.draft.update((v) => ({
      ...v,
      modified: "custom",
      [key]: value || undefined,
    }));
  }
  apply() {
    if (this.open() === "date" && this.rangeError) return;
    const draft = this.draft();
    this.change.emit(
      this.open() === "type"
        ? { ...this.value(), types: draft.types }
        : {
            ...this.value(),
            modified: draft.after || draft.before ? draft.modified : undefined,
            after: draft.after,
            before: draft.before,
          },
    );
    this.close();
  }
  clearDraft() {
    this.draft.update((v) =>
      this.open() === "type"
        ? { ...v, types: [] }
        : { ...v, modified: undefined, after: undefined, before: undefined },
    );
  }
  clear(kind?: "type" | "date") {
    this.change.emit(
      kind === "type"
        ? { ...this.value(), types: [] }
        : kind === "date"
          ? { types: this.value().types }
          : emptyFilters(),
    );
    this.close(false);
  }
  @HostListener("document:click", ["$event"])
  outside(event: MouseEvent) {
    if (!this.host.nativeElement.contains(event.target as Node))
      this.close(false);
  }
  @HostListener("keydown", ["$event"])
  key(event: KeyboardEvent) {
    if (!this.open()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
    if (event.key === "Tab") {
      const controls = [
        ...this.host.nativeElement.querySelectorAll<HTMLElement>(
          '[role="dialog"] button:not(:disabled), [role="dialog"] input',
        ),
      ];
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
}
