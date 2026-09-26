import {
  AfterViewInit,
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  inject,
} from "@angular/core";
import Selecto from "selecto";

export function selectionRange(order: string[], anchor: string, end: string) {
  const a = order.indexOf(anchor),
    b = order.indexOf(end);
  return a < 0 || b < 0
    ? [end]
    : order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Selection geometry is local to the currently loaded page, never hidden pages. */
@Directive({
  selector: "[cedarExplorerSelection]",
  exportAs: "explorerSelection",
})
export class ExplorerSelection implements AfterViewInit, OnDestroy {
  @Input() selection: string[] = [];
  @Input() gridView = false;
  @Input() selectionDisabled = false;
  @Output() selectionChange = new EventEmitter<string[]>();
  @Output() openItem = new EventEmitter<string>();
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private selecto?: Selecto;
  private anchor = "";
  private suppressClick = false;
  private base: string[] = [];
  private elements() {
    return [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>(
        ".explorer-item",
      ),
    ];
  }
  private order() {
    return this.elements().map((e) => e.dataset["resourceId"]!);
  }
  ngAfterViewInit() {
    const root = this.host.nativeElement;
    this.selecto = new Selecto({
      container: root,
      dragContainer: root,
      selectableTargets: [".explorer-item"],
      selectByClick: false,
      selectFromInside: false,
      hitRate: 0,
    });
    this.selecto.on("dragStart", (event) => {
      const input = event.inputEvent as MouseEvent;
      if (
        this.selectionDisabled ||
        (input.target as Element).closest(".explorer-item,button,a,input,thead")
      ) {
        event.stop();
        return;
      }
      this.base =
        input.metaKey || input.ctrlKey || input.shiftKey ? this.selection : [];
    });
    this.selecto.on("select", (event) => {
      if (!event.isDragStartEnd)
        this.selectionChange.emit([
          ...new Set([
            ...this.base,
            ...event.selected.map((e) => e.dataset["resourceId"]!),
          ]),
        ]);
    });
    this.selecto.on("selectEnd", (event) => {
      if (!event.isDragStartEnd) this.ignoreClick();
    });
  }
  ngOnDestroy() {
    this.selecto?.destroy();
  }
  ignoreClick() {
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
  }
  choose(id: string, event: MouseEvent | KeyboardEvent) {
    if (this.selectionDisabled || this.suppressClick) return;
    const additive = event.metaKey || event.ctrlKey;
    let next: string[];
    if (event.shiftKey) {
      const range = selectionRange(this.order(), this.anchor, id);
      next = additive ? [...new Set([...this.selection, ...range])] : range;
    } else {
      next = additive
        ? this.selection.includes(id)
          ? this.selection.filter((v) => v !== id)
          : [...this.selection, id]
        : [id];
      this.anchor = id;
    }
    this.selectionChange.emit(next);
  }
  @HostListener("click", ["$event"]) click(event: MouseEvent) {
    if (this.suppressClick || this.selectionDisabled) return;
    const target = event.target as Element;
    if (target.closest("button,a,input,thead")) return;
    const item = target.closest<HTMLElement>(".explorer-item");
    if (item) this.choose(item.dataset["resourceId"]!, event);
    else this.selectionChange.emit([]);
  }
  @HostListener("keydown", ["$event"]) key(event: KeyboardEvent) {
    if (
      this.selectionDisabled ||
      (event.target as Element).closest("button,a,input,select")
    )
      return;
    const elements = this.elements(),
      order = this.order();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.selectionChange.emit(order);
      return;
    }
    if (event.key === "Escape") {
      if (
        this.gridView &&
        !document.querySelector('[role="tooltip"], .resource-menu')
      )
        this.selectionChange.emit([]);
      return;
    }
    const item = (event.target as Element).closest<HTMLElement>(
      ".explorer-item",
    );
    if (!item) return;
    const id = item.dataset["resourceId"]!;
    if (event.key === "Enter") {
      event.preventDefault();
      if (this.gridView) this.openItem.emit(id);
      else this.choose(id, event);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      this.choose(id, event);
      return;
    }
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const firstTop = elements[0]?.getBoundingClientRect().top;
    const columns =
      elements.filter(
        (e) => Math.abs(e.getBoundingClientRect().top - firstTop!) < 2,
      ).length || 1;
    const index = order.indexOf(id);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? order.length - 1
          : Math.max(
              0,
              Math.min(
                order.length - 1,
                index +
                  ({
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -columns,
                    ArrowDown: columns,
                  }[event.key] || 0),
              ),
            );
    this.choose(order[next], event);
    elements[next]?.focus();
  }
}
