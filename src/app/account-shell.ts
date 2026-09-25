import { Toast } from "./toast";
import { Icon } from "./icon";
import { Component, Input } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
@Component({
  imports: [Toast, Icon, TranslatePipe],
  selector: "cedar-account-shell",
  template: ` <header class="account-header">
      <a href="/dashboard"
        ><cedar-icon name="back" /> {{ "Common.Workspace" | translate }}</a
      >
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
