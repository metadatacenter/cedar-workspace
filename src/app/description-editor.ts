import { RevisionCoordinator } from "./revision-coordinator";
import { I18n } from "./i18n";
import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend, Reply, failureText } from "./backend.service";
import { Resource, can, title } from "./resource";

@Component({
  selector: "cedar-description-editor",
  imports: [FormsModule, TranslatePipe],
  template: `
    @if (editable) {
      <label for="resource-description">{{
        "Common.Description" | translate
      }}</label>
      <textarea
        id="resource-description"
        rows="2"
        [placeholder]="'Description.Empty' | translate"
        [ngModel]="draft()"
        (ngModelChange)="draft.set($event)"
        [disabled]="busy() || !snapshot()"
        spellcheck="false"
        autocomplete="off"
      ></textarea>
      @if (dirty) {
        <div class="actions">
          <button type="button" [disabled]="busy()" (click)="cancel()">
            {{ "Common.Cancel" | translate }}
          </button>
          <button
            type="button"
            class="primary"
            [disabled]="busy() || state.reloadRequired()"
            (click)="save()"
          >
            {{ (busy() ? "Common.Saving" : "Common.Save") | translate }}
          </button>
        </div>
      }
    } @else {
      <div class="heading">{{ "Common.Description" | translate }}</div>
      @if (resource()["schema:description"]; as description) {
        <p>{{ description }}</p>
      } @else {
        <p class="no-description">{{ "Description.Empty" | translate }}</p>
      }
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      @if (!snapshot() || state.reloadRequired()) {
        <button type="button" [disabled]="busy()" (click)="load(true)">
          {{ "Common.Retry" | translate }}
        </button>
      }
    }
  `,
  styleUrl: "./description-editor.scss",
})
export class DescriptionEditor {
  readonly resource = input.required<Resource>();
  readonly saved = output<Resource>();
  readonly draft = signal("");
  readonly snapshot = signal<Reply<Resource> | null>(null);
  readonly busy = signal(false);
  readonly error = signal("");
  private readonly api = inject(Backend);
  private loaded = "";
  private readonly i18n = inject(I18n);
  state = new RevisionCoordinator();
  get editable() {
    return can(this.resource(), "updateResource");
  }
  get dirty() {
    return (
      !!this.snapshot() &&
      this.draft() !== (this.snapshot()!.data["schema:description"] || "")
    );
  }
  constructor() {
    inject(DestroyRef).onDestroy(() => this.state.dispose());
    effect(() => {
      const r = this.resource();
      const key = JSON.stringify([r["@id"], this.editable]);
      if (key === this.loaded) return;
      this.loaded = key;
      this.state.dispose();
      this.state = new RevisionCoordinator();
      this.snapshot.set(null);
      this.draft.set(r["schema:description"] || "");
      this.error.set("");
      this.busy.set(false);
      if (this.editable) void this.load();
    });
  }
  async load(preserveDraft = false) {
    const r = this.resource();
    if (!this.editable) return;
    const operation = this.state.read();
    if (!operation) return;
    this.busy.set(true);
    this.error.set("");
    if (!preserveDraft) this.snapshot.set(null);
    try {
      const reply = await this.api.snapshot(r, true);
      if (!operation.current()) return;
      if (!reply.etag)
        throw new Error(this.i18n.t("ResourceDialog.NoRevision"));
      this.snapshot.set({ ...reply, data: { ...r, ...reply.data } });
      if (!preserveDraft) this.draft.set(reply.data["schema:description"] || "");
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current())
        this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
  cancel() {
    if (!this.state.active || this.busy()) return;
    this.draft.set(this.snapshot()?.data["schema:description"] || "");
    void this.load();
  }
  async save() {
    const snapshot = this.snapshot();
    if (!snapshot || !this.editable || !this.dirty || this.busy()) return;
    const operation = this.state.write();
    if (!operation) return;
    this.busy.set(true);
    this.error.set("");
    const updated = { ...snapshot.data, "schema:description": this.draft() };
    try {
      const reply = await this.api.request<Resource>(
        "/command/rename-resource",
        "POST",
        {
          "@id": updated["@id"],
          "schema:name": title(updated),
          "schema:description": this.draft(),
        },
        snapshot.etag,
      );
      if (!operation.current()) return;
      this.snapshot.set({ data: updated, etag: reply.etag });
      operation.finish();
      this.saved.emit(updated);
      // Re-read the revision before another edit; the command may not return an ETag.
      await this.load();
    } catch (e) {
      operation.fail(e);
      // The draft stays in the box, so a conflict says the edits were kept.
      if (operation.current()) this.error.set(failureText(e, this.i18n, true));
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
}
