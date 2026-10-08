import { Component, OnDestroy, OnInit, inject, signal } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { OperationCoordinator } from "./operation-coordinator";
import { Backend } from "./backend.service";
import { AccountShell } from "./account-shell";
import { CeeLoader } from "./cee-loader";
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
  imports: [AccountShell, TranslatePipe],
  templateUrl: "./settings.html",
})
export class Settings implements OnInit, OnDestroy {
  private readonly operations = new OperationCoordinator<"load">();
  ngOnDestroy() {
    this.operations.dispose();
  }
  readonly api = inject(Backend);
  readonly loader = inject(CeeLoader);
  private readonly i18n = inject(I18n);
  readonly loading = signal(true);
  readonly ready = signal(false);
  readonly error = signal("");
  readonly ceeVersion = signal(this.i18n.t("Common.Loading"));
  readonly version = window.cedarVersion || this.i18n.t("Common.Unknown");
  readonly modifier = window.cedarVersionModifier || "";
  async ngOnInit() {
    if (!this.operations.active) return;
    const operation = this.operations.begin("load");
    try {
      if (!(await this.api.init()) || !operation.current()) return;
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
}
