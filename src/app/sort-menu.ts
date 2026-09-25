import {
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";

@Component({
  selector: "cedar-sort-menu",
  imports: [Icon, TranslatePipe],
  templateUrl: "./sort-menu.html",
  styleUrl: "./sort-menu.scss",
})
export class SortMenu {
  readonly sort = input("name");
  readonly foldersFirst = input(false);
  readonly version = input("all");
  readonly versionChange = output<string>();
  readonly sortChange = output<string>();
  readonly foldersFirstChange = output<boolean>();
  readonly open = signal(false);
  readonly top = signal(0);
  readonly left = signal(0);
  readonly trigger = viewChild<ElementRef<HTMLButtonElement>>("trigger");
  readonly panel = viewChild<ElementRef<HTMLElement>>("panel");
  private readonly host = inject(ElementRef<HTMLElement>);
  // Labels are translation keys.
  readonly fields = [
    { value: "name", label: "Sort.Fields.Name" },
    { value: "lastUpdatedOnTS", label: "Sort.Fields.LastModified" },
    { value: "createdOnTS", label: "Sort.Fields.Created" },
  ];
  get field() {
    return this.sort().replace(/^-/, "");
  }
  get descending() {
    return this.sort().startsWith("-");
  }
  get directions() {
    return this.field === "name"
      ? ["Sort.Directions.AToZ", "Sort.Directions.ZToA"]
      : ["Sort.Directions.Oldest", "Sort.Directions.Newest"];
  }
  toggle() {
    if (this.open()) return this.close();
    const rect = this.trigger()!.nativeElement.getBoundingClientRect();
    this.left.set(
      Math.max(8, Math.min(rect.right - 256, window.innerWidth - 264)),
    );
    this.top.set(Math.max(8, rect.bottom + 4));
    this.open.set(true);
    // The conditional panel must render before measuring and focusing it.
    requestAnimationFrame(() => {
      const panel = this.panel()?.nativeElement;
      if (!panel) return;
      const height = panel.getBoundingClientRect().height;
      this.top.set(
        Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)),
      );
      panel.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
  }
  close(restoreFocus = true) {
    this.open.set(false);
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }
  chooseField(field: string) {
    this.sortChange.emit((this.descending ? "-" : "") + field);
    this.close();
  }
  chooseDirection(descending: boolean) {
    this.sortChange.emit((descending ? "-" : "") + this.field);
    this.close();
  }
  chooseFolders(first: boolean) {
    this.foldersFirstChange.emit(first);
    this.close();
  }
  key(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = [
        ...this.panel()!.nativeElement.querySelectorAll<HTMLButtonElement>(
          "button",
        ),
      ];
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus();
    }
  }
  @HostListener("document:click", ["$event"])
  outside(event: MouseEvent) {
    if (!this.host.nativeElement.contains(event.target as Node))
      this.close(false);
  }
  @HostListener("focusout", ["$event"])
  focusOut(event: FocusEvent) {
    // Safari blurs the focused item on pointer-down without focusing the
    // clicked button. Keep the menu mounted until that click can select it.
    // Explicit focus transfers (including Tab) and outside clicks still dismiss.
    if (
      event.relatedTarget instanceof Node &&
      !this.host.nativeElement.contains(event.relatedTarget)
    )
      this.close(false);
  }
  @HostListener("window:resize")
  resized() {
    this.close(false);
  }
}
