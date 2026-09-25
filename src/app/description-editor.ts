import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend, Reply } from "./backend.service";
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
      ></textarea>
      @if (dirty) {
        <div class="actions">
          <button type="button" [disabled]="busy()" (click)="cancel()">
            {{ "Common.Cancel" | translate }}
          </button>
          <button
            type="button"
            class="primary"
            [disabled]="busy()"
            (click)="save()"
          >
            {{ (busy() ? "Common.Saving" : "Common.Save") | translate }}
          </button>
        </div>
      }
    } @else {
      <div class="heading">{{ "Common.Description" | translate }}</div>
      <p>
        {{
          resource()["schema:description"] || ("Description.Empty" | translate)
        }}
      </p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      @if (!snapshot()) {
        <button type="button" (click)="load()">
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
    effect(() => {
      const r = this.resource();
      if (this.editable && this.loaded !== r["@id"]) {
        this.loaded = r["@id"];
        void this.load();
      }
    });
  }
  async load() {
    const r = this.resource();
    this.busy.set(true);
    this.error.set("");
    this.snapshot.set(null);
    try {
      const reply = await this.api.snapshot(r, true);
      this.snapshot.set({ ...reply, data: { ...r, ...reply.data } });
      this.draft.set(reply.data["schema:description"] || "");
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  cancel() {
    this.draft.set(this.snapshot()?.data["schema:description"] || "");
    void this.load();
  }
  async save() {
    const snapshot = this.snapshot();
    if (!snapshot || !this.editable || !this.dirty || this.busy()) return;
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
      this.snapshot.set({ data: updated, etag: reply.etag });
      this.saved.emit(updated);
      // Re-read the revision before another edit; the command may not return an ETag.
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
