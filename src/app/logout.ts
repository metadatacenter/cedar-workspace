import { Component, inject, OnInit, signal } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend } from "./backend.service";
import { I18n } from "./i18n";
@Component({
  selector: "cedar-logout-page",
  imports: [TranslatePipe],
  template: `<main class="account-content">
    <h1>{{ "Logout.Title" | translate }}</h1>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <a href="/logout">{{ "Logout.Retry" | translate }}</a>
    } @else {
      <p role="status">{{ "Logout.SigningOut" | translate }}</p>
    }
  </main>`,
})
export class Logout implements OnInit {
  readonly api = inject(Backend);
  private readonly i18n = inject(I18n);
  readonly error = signal("");
  async ngOnInit() {
    try {
      await this.api.logout();
    } catch (e) {
      this.error.set(
        e instanceof Error ? e.message : this.i18n.t("Logout.Failed"),
      );
    }
  }
}
