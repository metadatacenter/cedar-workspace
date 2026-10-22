import { Toast } from "./toast";
import { WorkspaceReturn } from "./workspace-return";
import { Component, Input } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { ServerLanguage } from "./server-text";
import { StatusRegion } from "./status-region";
@Component({
  imports: [Toast, WorkspaceReturn, TranslatePipe, ServerLanguage, StatusRegion],
  selector: "cedar-account-shell",
  template: ` <header class="account-header">
      <cedar-workspace-return />
      <h1>{{ title }}</h1>
    </header>
    <main class="account-content">
      @if (error) {
        <p class="alert" role="alert" [attr.lang]="error | serverLanguage">{{ error }}</p>
      }
      <!-- The toast and the status region stay in the page while empty, so that a screen reader
           announces each message that arrives in them. -->
      <cedar-toast [message]="notice" />
      <cedar-status [text]="loading ? ('Common.Loading' | translate) : ''" />
      @if (loading) {
        <p>{{ "Common.Loading" | translate }}</p>
      }
      <ng-content />
    </main>`,
})
export class AccountShell {
  @Input() title = "";
  @Input() loading = false;
  @Input() error = "";
  @Input() notice = "";
}
