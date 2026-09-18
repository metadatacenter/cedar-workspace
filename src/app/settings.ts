import { Component, OnInit, inject, signal } from "@angular/core";
import { formatDate } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Backend } from "./backend.service";
import { AccountShell } from "./account-shell";
import { CeeLoader } from "./cee-loader";
import { dateFormats } from "./date-format";
declare global {
  interface Window {
    cedarVersion?: string;
    cedarVersionModifier?: string;
    cedarEmbeddableEditorVersion?: string;
  }
}
@Component({
  selector: "cedar-settings-page",
  imports: [FormsModule, AccountShell],
  templateUrl: "./settings.html",
})
export class Settings implements OnInit {
  readonly api = inject(Backend);
  readonly loader = inject(CeeLoader);
  readonly loading = signal(true);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly ceeVersion = signal("Loading…");
  readonly version = window.cedarVersion || "unknown";
  readonly modifier = window.cedarVersionModifier || "";
  readonly formats = Object.entries(dateFormats).map(([value, format]) => ({
    value,
    label: formatDate(new Date(), format, "en-US") + " (" + value + ")",
  }));
  selected = "MM/DD/YYYY";
  saved = "MM/DD/YYYY";
  async ngOnInit() {
    try {
      if (!(await this.api.init())) return;
      this.selected = this.saved =
        this.api.profile.uiPreferences?.preferredDateFormat || "MM/DD/YYYY";
      this.ready.set(true);
      this.loading.set(false);
      try {
        await this.loader.load();
        this.ceeVersion.set(window.cedarEmbeddableEditorVersion || "unknown");
      } catch {
        this.ceeVersion.set("Unavailable");
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.loading.set(false);
    }
  }
  async save(value: string) {
    if (this.busy() || !Object.hasOwn(dateFormats, value)) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await this.api.request(this.api.userPath, "PUT", {
        "uiPreferences.preferredDateFormat": value,
      });
      this.api.profile.uiPreferences = {
        ...this.api.profile.uiPreferences,
        preferredDateFormat: value,
      };
      this.saved = this.selected = value;
      this.notice.set("Date format saved.");
    } catch (e) {
      this.selected = this.saved;
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
