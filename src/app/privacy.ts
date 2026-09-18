import { Component, OnInit, inject, signal } from "@angular/core";
import { Backend } from "./backend.service";
import { AccountShell } from "./account-shell";
@Component({
  selector: "cedar-privacy-page",
  imports: [AccountShell],
  templateUrl: "./privacy.html",
})
export class Privacy implements OnInit {
  readonly api = inject(Backend);
  readonly loading = signal(true);
  readonly ready = signal(false);
  readonly error = signal("");
  async ngOnInit() {
    try {
      this.ready.set(await this.api.init());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
