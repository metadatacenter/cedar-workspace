import {
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";

/**
 * How long a status region is in the page, empty, before it first says anything. A screen reader
 * may say nothing for a region that arrives already holding its text. The Angular CDK's live
 * announcer waits as long between emptying its region and filling it.
 */
export const statusRegionDelay = 100;

/**
 * A polite status region, drawn as nothing, that says its text each time the text changes.
 *
 * Place it where it stays in the page while the status it says comes and goes, so that it is
 * already there before its text arrives. It holds no text until it has been in the page for
 * `statusRegionDelay`, so one that arrives together with a page or a dialog is still heard: text
 * given sooner is said then.
 */
@Component({
  selector: "cedar-status",
  host: {
    class: "sr-only",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  },
  template: "{{ said() }}",
})
export class StatusRegion {
  /** What the region says, or nothing while there is no status to say. */
  readonly text = input("");
  private readonly settled = signal(false);
  readonly said = computed(() => (this.settled() ? this.text() : ""));
  constructor() {
    const destroyed = inject(DestroyRef);
    afterNextRender(() => {
      const timer = setTimeout(() => this.settled.set(true), statusRegionDelay);
      destroyed.onDestroy(() => clearTimeout(timer));
    });
  }
}
