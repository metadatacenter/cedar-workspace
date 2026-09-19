import { Toast } from "./toast";
import { Icon } from "./icon";
import { Component, Input } from "@angular/core";
@Component({
  imports: [Toast, Icon],
  selector: "cedar-account-shell",
  template: ` <header class="account-header">
      <a href="/dashboard"><cedar-icon name="back" /> Workspace</a>
      <h1>{{ title }}</h1>
    </header>
    <nav class="account-nav" aria-label="Account pages">
      <a
        href="/profile"
        [attr.aria-current]="title === 'Profile' ? 'page' : null"
        >Profile</a
      ><a
        href="/settings"
        [attr.aria-current]="title === 'Settings' ? 'page' : null"
        >Settings</a
      ><a
        href="/groups"
        [attr.aria-current]="title === 'Groups' ? 'page' : null"
        >Groups</a
      ><a
        href="/privacy"
        [attr.aria-current]="title === 'Privacy' ? 'page' : null"
        >Privacy</a
      >
    </nav>
    <main class="account-content">
      @if (error) {
        <p class="alert" role="alert">{{ error }}</p>
      }
      @if (notice) {
        <cedar-toast [message]="notice" />
      }
      @if (loading) {
        <p role="status">Loading…</p>
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
