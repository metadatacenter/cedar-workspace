import { Component, inject, OnInit, signal } from "@angular/core";
import { Backend } from "./backend.service";
@Component({
  selector: "cedar-logout-page",
  template: `<main class="account-content">
    <h1>Logout</h1>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <a href="/logout">Retry logout</a>
    } @else {
      <p role="status">Signing out…</p>
    }
  </main>`,
})
export class Logout implements OnInit {
  readonly api = inject(Backend);
  readonly error = signal("");
  async ngOnInit() {
    try {
      await this.api.logout();
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : "Unable to sign out. Please try again.",
      );
    }
  }
}
