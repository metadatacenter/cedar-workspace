import { Confirmation } from "./confirmation";
import { DialogKeyboard } from "./dialog-keyboard";
import { Icon } from "./icon";
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Backend } from "./backend.service";
import { Resource, Listing, title, can } from "./resource";
@Component({
  selector: "cedar-resource-dialog",
  imports: [DialogKeyboard, Icon, FormsModule],
  templateUrl: "./resource-dialog.html",
})
export class ResourceDialog implements OnInit, AfterViewInit, OnDestroy {
  readonly confirmation = inject(Confirmation);
  @Input({ required: true }) action = "";
  @Input() resource?: Resource;
  @Input({ required: true }) folder = "";
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  readonly api = inject(Backend);
  readonly title = title;
  readonly can = can;
  readonly busy = signal(true);
  readonly error = signal("");
  readonly folders = signal<Resource[]>([]);
  readonly path = signal<Resource[]>([]);
  submitted = false;
  name = "";
  description = "";
  version = "";
  target = "";
  targetResource?: Resource;
  targetOffset = 0;
  targetTotal = 0;
  propagate = true;
  newFolderName = "";
  private initialValues: string | null = null;
  private etag: string | null = null;
  private alive = true;
  private originalFocus = document.activeElement as HTMLElement | null;
  get heading() {
    return (
      (
        {
          "new-folder": "New folder",
          rename: "Rename / description",
          copy: "Copy",
          move: "Move",
          delete: "Delete",
          publish: "Publish",
          draft: "Create Draft",
          "make-open": "Make Open",
          "make-not-open": "Make Not Open",
        } as Record<string, string>
      )[this.action] || this.action
    );
  }
  get choosesFolder() {
    return ["copy", "move", "draft"].includes(this.action);
  }
  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy() {
    this.alive = false;
    this.originalFocus?.focus();
  }
  ngOnInit() {
    void this.load();
  }
  private values() {
    return JSON.stringify([
      this.name,
      this.description,
      this.version,
      this.target,
      this.propagate,
      this.newFolderName,
    ]);
  }
  async close() {
    if (this.busy()) return;
    if (
      this.initialValues !== null &&
      this.values() !== this.initialValues &&
      !(await this.confirmation.confirm("Discard unsaved changes?"))
    )
      return;
    this.closed.emit();
  }
  async load() {
    try {
      const r = this.resource;
      this.target = this.folder;
      if (r) {
        this.name = title(r);
        this.description = r["schema:description"] || "";
        this.version = r["pav:version"] || "0.0.1";
        if (
          ["rename", "move", "delete", "make-open", "make-not-open"].includes(
            this.action,
          )
        ) {
          const reply = await this.api.snapshot(
            r,
            this.action === "delete" || this.action === "rename",
          );
          this.etag = reply.etag;
          this.name = title({ ...r, ...reply.data });
          this.description = reply.data["schema:description"] || "";
        }
      }
      if (this.choosesFolder) await this.browse(this.folder);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
      this.initialValues = this.values();
    }
  }
  fail(e: unknown) {
    this.error.set(e instanceof Error ? e.message : String(e));
  }
  async browse(id: string, offset = 0) {
    this.busy.set(true);
    try {
      const reply = await this.api.request<Listing>(
        "/folders/" +
          encodeURIComponent(id) +
          "/contents?resource_types=folder&sort=name&limit=50&offset=" +
          offset,
      );
      this.target = id;
      this.targetOffset = offset;
      this.targetTotal = reply.data.totalCount;
      this.folders.set(reply.data.resources);
      this.path.set(reply.data.pathInfo || []);
      this.targetResource = (
        await this.api.request<Resource>("/folders/" + encodeURIComponent(id))
      ).data;
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  get destinationAllowed() {
    return (
      !this.choosesFolder ||
      (!!this.targetResource &&
        can(
          this.targetResource,
          this.action === "move" ? "moveIntoFolder" : "copyIntoFolder",
        ) &&
        this.target !== this.resource?.["@id"])
    );
  }
  get nameError() {
    return ["new-folder", "rename", "copy"].includes(this.action) &&
      !this.name.trim()
      ? "Enter a name."
      : "";
  }
  get versionError() {
    return ["publish", "draft"].includes(this.action) &&
      !/^\d+\.\d+\.\d+$/.test(this.version)
      ? "Use a version such as 1.0.0."
      : "";
  }
  async submit() {
    if (this.busy() || !this.destinationAllowed) return;
    this.submitted = true;
    if (this.nameError || this.versionError) return;
    this.busy.set(true);
    this.error.set("");
    const r = this.resource;
    const id = r?.["@id"];
    try {
      if (
        ["rename", "move", "delete", "make-open", "make-not-open"].includes(
          this.action,
        ) &&
        !this.etag
      )
        throw new Error(
          "No concurrency validator was returned. Reopen this dialog before saving.",
        );
      switch (this.action) {
        case "new-folder":
          await this.api.request("/folders", "POST", {
            folderId: this.folder,
            name: this.name.trim(),
            // The folder API requires a nonempty description even though it is
            // optional in the dialog. Use the folder name as the initial value.
            description: this.description.trim() || this.name.trim(),
          });
          break;
        case "rename":
          await this.api.request(
            "/command/rename-resource",
            "POST",
            {
              "@id": id,
              "schema:name": this.name.trim(),
              "schema:description": this.description,
            },
            this.etag,
          );
          break;
        case "copy":
          await this.api.request("/command/copy-artifact-to-folder", "POST", {
            "@id": id,
            targetFolderId: this.target,
            nameTemplate: this.name.trim(),
          });
          break;
        case "move":
          await this.api.request(
            "/command/move-resource-to-folder",
            "POST",
            { "@id": id, targetFolderId: this.target },
            this.etag,
          );
          break;
        case "publish":
          await this.api.request("/command/publish-artifact", "POST", {
            "@id": id,
            newVersion: this.version,
          });
          break;
        case "draft":
          await this.api.request("/command/create-draft-artifact", "POST", {
            "@id": id,
            newVersion: this.version,
            folderId: this.target,
            propagateSharing: this.propagate,
            newFolderName: this.newFolderName || null,
          });
          break;
        case "delete":
          await this.api.request(
            this.api.path(r!),
            "DELETE",
            undefined,
            this.etag,
          );
          break;
        case "make-open":
        case "make-not-open":
          await this.api.request(
            "/command/make-" +
              (r!.resourceType === "folder" ? "folder" : "artifact") +
              (this.action === "make-open" ? "-open" : "-not-open"),
            "POST",
            { "@id": id },
            this.etag,
          );
          break;
        default:
          throw new Error("Unknown action.");
      }
      if (this.alive) this.saved.emit();
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}
