import { Injectable, signal } from "@angular/core";

/** Shared suppression for pointer gestures, including both tooltip renderers. */
@Injectable({ providedIn: "root" })
export class TooltipController {
  private readonly suspended = signal(false);
  readonly suppressed = this.suspended.asReadonly();
  suspend() {
    this.suspended.set(true);
  }
  resume() {
    this.suspended.set(false);
  }
}
