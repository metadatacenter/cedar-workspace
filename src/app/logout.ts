import { Component, inject, OnInit, signal } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend } from "./backend.service";
import { I18n } from "./i18n";
import { ServerLanguage } from "./server-text";
import { StatusRegion } from "./status-region";
@Component({
  selector: "cedar-logout-page",
  imports: [TranslatePipe, ServerLanguage, StatusRegion],
  template: `<header class="account-header">
      <h1>{{ "Logout.Title" | translate }}</h1>
    </header>
    <main class="account-content">
      <cedar-status [text]="error() ? '' : ('Logout.SigningOut' | translate)" />
      @if (error()) {
        <p role="alert" [attr.lang]="error() | serverLanguage">{{ error() }}</p>
        <a href="/logout">{{ "Logout.Retry" | translate }}</a>
      } @else {
        <p>{{ "Logout.SigningOut" | translate }}</p>
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
