import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from "@angular/core";

/**
 * Holds a sticky element directly beneath a sticky bar, whatever height the bar wraps to. The page
 * keeps the room both take clear when it scrolls something into view, so a field reached by Tab or
 * by a listed problem comes to rest below them rather than under them.
 */
@Directive({ selector: "[cedarPinBelow]" })
export class PinBelow {
  readonly cedarPinBelow = input.required<HTMLElement>();
  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const bar = this.cedarPinBelow();
      const root = document.documentElement;
      const place = () => {
        this.host.style.top = `${bar.offsetHeight}px`;
        root.style.scrollPaddingTop = `${bar.offsetHeight + this.host.offsetHeight}px`;
      };
      const observer = new ResizeObserver(place);
      observer.observe(bar, { box: "border-box" });
      observer.observe(this.host, { box: "border-box" });
      destroyRef.onDestroy(() => {
        observer.disconnect();
        root.style.removeProperty("scroll-padding-top");
      });
    });
  }
}
