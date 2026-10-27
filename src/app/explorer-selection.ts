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

export function selectionRange(order: string[], anchor: string, end: string) {
  const a = order.indexOf(anchor),
    b = order.indexOf(end);
  return a < 0 || b < 0
    ? [end]
    : order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** A drag across empty space, with each item's position when it began. */
interface MarqueeDrag {
  x: number;
  y: number;
  last: [number, number];
  items: [HTMLElement, DOMRect][];
  done: AbortController;
}

// Mouse events report whole pixels, but Chromium's pointer events report fractional positions.
// The marquee keeps to whole pixels, so its border stays sharp.
const pixel = (event: PointerEvent): [number, number] => [
  Math.floor(event.clientX),
  Math.floor(event.clientY),
];

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
  private marquee = document.createElement("div");
  private drag?: MarqueeDrag;
  // The items the marquee last touched. They outlast the drag, and the next drag releases them
  // when it starts.
  private touched: HTMLElement[] = [];
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
    this.marquee.className = "explorer-marquee";
    this.host.nativeElement.append(this.marquee);
  }
  ngOnDestroy() {
    this.drag?.done.abort();
    this.marquee.remove();
  }
  @HostListener("pointerdown", ["$event"]) press(event: PointerEvent) {
    // The middle and right buttons draw no marquee.
    if (
      this.drag ||
      event.button === 1 ||
      event.button === 2 ||
      this.selectionDisabled ||
      (event.target as Element).closest(".explorer-item,button,a,input,thead")
    )
      return;
    this.base =
      event.metaKey || event.ctrlKey || event.shiftKey ? this.selection : [];
    const [x, y] = pixel(event);
    const done = new AbortController();
    this.drag = {
      x,
      y,
      last: [x, y],
      items: this.elements().map((e) => [e, e.getBoundingClientRect()]),
      done,
    };
    const options = { signal: done.signal };
    window.addEventListener("pointermove", (e) => this.stretch(e), options);
    for (const type of ["pointerup", "pointercancel", "contextmenu", "blur"])
      window.addEventListener(type, () => this.release(), options);
    if (this.touched.length) this.touch([]);
  }
  // A drag would otherwise select the text it crosses.
  @HostListener("selectstart", ["$event"]) keepText(event: Event) {
    if (this.drag) event.preventDefault();
  }
  private stretch(event: PointerEvent) {
    const drag = this.drag!;
    const [x, y] = pixel(event);
    if (x === drag.last[0] && y === drag.last[1]) return;
    drag.last = [x, y];
    const left = Math.min(x, drag.x),
      top = Math.min(y, drag.y),
      right = Math.max(x, drag.x),
      bottom = Math.max(y, drag.y);
    // The press and the pointer are opposite corners of the marquee.
    this.marquee.style.inset = `${top}px calc(100% - ${right}px) calc(100% - ${bottom}px) ${left}px`;
    this.marquee.style.display = "block";
    // An item is touched as soon as the marquee reaches it, even along an edge.
    this.touch(
      drag.items
        .filter(
          ([, r]) =>
            r.left <= right &&
            left <= r.right &&
            r.top <= bottom &&
            top <= r.bottom,
        )
        .map(([item]) => item),
    );
  }
  private touch(items: HTMLElement[]) {
    if (
      items.length === this.touched.length &&
      items.every((item) => this.touched.includes(item))
    )
      return;
    this.touched = items;
    this.selectionChange.emit([
      ...new Set([...this.base, ...items.map((e) => e.dataset["resourceId"]!)]),
    ]);
  }
  private release() {
    this.drag!.done.abort();
    this.drag = undefined;
    this.marquee.style.display = "none";
    this.ignoreClick();
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
