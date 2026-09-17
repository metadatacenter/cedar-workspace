import { Component, Input } from "@angular/core";
@Component({
  selector: "cedar-account-shell",
  template: ` <header class="account-header">
      <a href="/dashboard">← Workspace</a>
      <h1>{{ title }}</h1>
    </header>
    <nav class="account-nav" aria-label="Account pages">
      <a href="/profile">Profile</a><a href="/settings">Settings</a
      ><a href="/groups">Groups</a><a href="/privacy">Privacy</a>
    </nav>
    <main class="account-content">
      @if (error) {
        <p class="alert" role="alert">{{ error }}</p>
      }
      @if (notice) {
        <p class="notice" role="status">{{ notice }}</p>
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
