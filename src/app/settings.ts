import { Component, OnDestroy, OnInit, inject, signal } from "@angular/core";
import { formatDate } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { OperationCoordinator } from "./operation-coordinator";
import { Backend } from "./backend.service";
import { AccountShell } from "./account-shell";
import { CeeLoader } from "./cee-loader";
import { dateFormats } from "./date-format";
import { I18n } from "./i18n";
declare global {
  interface Window {
    cedarVersion?: string;
    cedarVersionModifier?: string;
    cedarEmbeddableEditorVersion?: string;
  }
}
@Component({
  selector: "cedar-settings-page",
  imports: [FormsModule, AccountShell, TranslatePipe],
  templateUrl: "./settings.html",
})
export class Settings implements OnInit, OnDestroy {
  private readonly operations = new OperationCoordinator<"load" | "save">();
  ngOnDestroy() {
    this.operations.dispose();
  }
  readonly api = inject(Backend);
  readonly loader = inject(CeeLoader);
  private readonly i18n = inject(I18n);
  readonly loading = signal(true);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly ceeVersion = signal(this.i18n.t("Common.Loading"));
  readonly version = window.cedarVersion || this.i18n.t("Common.Unknown");
  readonly modifier = window.cedarVersionModifier || "";
  readonly formats = Object.entries(dateFormats).map(([value, format]) => ({
    value,
    label:
      formatDate(new Date(), format, this.i18n.locale("en-US")) +
      " (" +
      value +
      ")",
  }));
  selected = "MM/DD/YYYY";
  saved = "MM/DD/YYYY";
  async ngOnInit() {
    if (!this.operations.active) return;
    const operation = this.operations.begin("load");
    try {
      if (!(await this.api.init()) || !operation.current()) return;
      this.selected = this.saved =
        this.api.profile.uiPreferences?.preferredDateFormat || "MM/DD/YYYY";
      this.ready.set(true);
      this.loading.set(false);
      try {
        await this.loader.load();
        if (!operation.current()) return;
        this.ceeVersion.set(
          window.cedarEmbeddableEditorVersion || this.i18n.t("Common.Unknown"),
        );
      } catch {
        if (!operation.current()) return;
        this.ceeVersion.set(this.i18n.t("Account.Settings.Unavailable"));
      }
      operation.finish();
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      this.error.set(e instanceof Error ? e.message : String(e));
      this.loading.set(false);
    }
  }
  async save(value: string) {
    if (
      !this.operations.active ||
      this.busy() ||
      !Object.hasOwn(dateFormats, value)
    )
      return;
    const operation = this.operations.begin("save");
    const profile = this.api.profile;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await this.api.request(this.api.userPath, "PUT", {
        "uiPreferences.preferredDateFormat": value,
      });
      if (!operation.current() || this.api.profile !== profile) return;
      this.api.profile.uiPreferences = {
        ...this.api.profile.uiPreferences,
        preferredDateFormat: value,
      };
      this.saved = this.selected = value;
      this.notice.set(this.i18n.t("Account.Settings.Saved"));
      operation.finish();
    } catch (e) {
      if (!operation.current() || this.api.profile !== profile) return;
      operation.fail(e);
      this.selected = this.saved;
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
}
