import { Toast } from "./toast";
import { WorkspaceReturn } from "./workspace-return";
import { Component, Input } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
@Component({
  imports: [Toast, WorkspaceReturn, TranslatePipe],
  selector: "cedar-account-shell",
  template: ` <header class="account-header">
      <cedar-workspace-return />
      <h1>{{ title }}</h1>
    </header>
    <main class="account-content">
      @if (error) {
        <p class="alert" role="alert">{{ error }}</p>
      }
      @if (notice) {
        <cedar-toast [message]="notice" />
      }
      @if (loading) {
        <p role="status">{{ "Common.Loading" | translate }}</p>
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
