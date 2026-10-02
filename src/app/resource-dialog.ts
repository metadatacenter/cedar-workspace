import { Tooltip } from "./tooltip";
import { ResourceMoves, validMoveTarget } from "./resource-moves";
import { Confirmation } from "./confirmation";
import { DialogKeyboard } from "./dialog-keyboard";
import { Icon } from "./icon";
import { FolderList, FolderSort } from "./folder-list";
import {
  FIRST_VERSION,
  Version,
  VersionPicker,
  compareVersions,
  formatVersion,
  parseVersion,
  stepVersion,
} from "./version-picker";
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
  afterNextRender,
  Injector,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend } from "./backend.service";
import {
  Resource,
  Listing,
  title,
  can,
  openThroughAFolder,
  openThroughText,
} from "./resource";
import { I18n } from "./i18n";
@Component({
  selector: "cedar-resource-dialog",
  imports: [
    Tooltip,
    DialogKeyboard,
    Icon,
    FolderList,
    VersionPicker,
    FormsModule,
    TranslatePipe,
  ],
  templateUrl: "./resource-dialog.html",
})
export class ResourceDialog implements OnInit, AfterViewInit, OnDestroy {
  readonly confirmation = inject(Confirmation);
  private readonly i18n = inject(I18n);
  @Input({ required: true }) action = "";
  @Input() resource?: Resource;
  @Input() resources: Resource[] = [];
  @Output() changed = new EventEmitter<void>();
  private moves = inject(ResourceMoves);
  @Input({ required: true }) folder = "";
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  readonly api = inject(Backend);
  readonly title = (r: Resource) => title(r, this.i18n.t("Common.Untitled"));
  // The path the confirmation read, which is fresher than the one the menu had.
  private openViewPath?: Resource[];
  // What changing the resource's own OpenView flag will do. Inside an open folder
  // it stays in OpenView either way, and the confirmation says so.
  openViewMessage(): string {
    const enabling = this.action === "make-open";
    const r = this.resource && {
      ...this.resource,
      pathInfo: this.openViewPath ?? this.resource.pathInfo,
    };
    if (r && openThroughAFolder(r))
      return openThroughText(
        r,
        this.i18n,
        enabling
          ? "ResourceDialog.AlreadyOpenThrough"
          : "ResourceDialog.StaysOpenThrough",
      );
    return this.i18n.t(
      enabling ? "ResourceDialog.WillBeOpen" : "ResourceDialog.WillNotBeOpen",
    );
  }
  readonly can = can;
  readonly busy = signal(true);
  readonly preparing = signal(true);
  private readonly injector = inject(Injector);
  readonly error = signal("");
  readonly folders = signal<Resource[]>([]);
  readonly path = signal<Resource[]>([]);
  submitted = false;
  name = "";
  description = "";
  version: Version = [0, 0, 1];
  target = "";
  targetResource?: Resource;
  targetOffset = 0;
  targetTotal = 0;
  folderSort: FolderSort = "name";
  propagate = true;
  newFolderName = "";
  private initialValues: string | null = null;
  private etag: string | null = null;
  private alive = true;
  private originalFocus = document.activeElement as HTMLElement | null;
  get headingIcon() {
    return ({
      "new-folder": "folder", rename: "edit", copy: "copy", move: "move",
      delete: "delete", publish: "publish",
      draft: "new-record", "make-open": "globe", "make-not-open": "lock",
    } as Record<string, string>)[this.action] ?? "info";
  }
  get heading() {
    const key = (
      {
        "new-folder": "ResourceDialog.Headings.NewFolder",
        rename: "ResourceDialog.Headings.Rename",
        copy: "ResourceDialog.Headings.Copy",
        move: "ResourceDialog.Headings.Move",
        delete: "ResourceDialog.Headings.Delete",
        publish: "ResourceDialog.Headings.Publish",
        draft: "ResourceDialog.Headings.Draft",
        "make-open": "ResourceDialog.Headings.MakeOpen",
        "make-not-open": "ResourceDialog.Headings.MakeNotOpen",
      } as Record<string, string>
    )[this.action];
    return key ? this.i18n.t(key) : this.action;
  }
  /** The translation key for the submit button's text. */
  get submitLabel() {
    if (this.busy()) return "Common.Working";
    if (this.action === "delete") return "ResourceDialog.ConfirmDeleteButton";
    return ["make-open", "make-not-open", "publish"].includes(this.action)
      ? "ResourceDialog.Ok"
      : "Common.Save";
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
    // Browsing a destination changes navigation, not authored content to preserve.
    return JSON.stringify([
      this.name,
      this.description,
      this.version,
      this.propagate,
      this.newFolderName,
    ]);
  }
  async close() {
    if (this.busy() && !this.preparing()) return;
    // A publication asks only for a version, which is quick to choose again.
    if (
      this.action !== "publish" &&
      this.initialValues !== null &&
      this.values() !== this.initialValues &&
      !(await this.confirmation.confirm(
        this.i18n.t("ResourceDialog.DiscardChanges"),
      ))
    )
      return;
    this.closed.emit();
  }
  async load() {
    try {
      const r = this.resource;
      this.target = this.folder;
      if (r) {
        this.name = this.action === "copy"
          ? this.i18n.t("ResourceDialog.CopyName", { name: this.title(r) })
          : this.title(r);
        this.description = r["schema:description"] || "";
        const current = parseVersion(r["pav:version"]);
        // A draft starts at the next patch, the first version it may take.
        if (current)
          this.version =
            this.action === "draft" ? stepVersion(current, 2, 1) : current;
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
          this.openViewPath = reply.data.pathInfo;
          this.name = this.title({ ...r, ...reply.data });
          this.description = reply.data["schema:description"] || "";
        }
      }
      if (this.choosesFolder) await this.browse(this.folder);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
      this.initialValues = this.values();
      if (this.alive) {
        this.preparing.set(false);
        afterNextRender(
          () => {
            if (!this.alive) return;
            const dialog = this.dialog.nativeElement;
            (
              dialog.querySelector<HTMLElement>("[autofocus]:not(:disabled)") ||
              dialog.querySelector<HTMLElement>("button:not(:disabled)") ||
              dialog
            ).focus();
          },
          { injector: this.injector },
        );
      }
    }
  }
  fail(e: unknown) {
    this.error.set(e instanceof Error ? e.message : String(e));
  }
  async browse(id: string, offset = 0, sort: FolderSort = this.folderSort) {
    this.busy.set(true);
    try {
      const [reply, targetReply] = await Promise.all([
        this.api.request<Listing>(
          "/folders/" +
            encodeURIComponent(id) +
            "/contents?resource_types=folder&sort=" +
            sort +
            "&limit=50&offset=" +
            offset,
        ),
        this.api.request<Resource>("/folders/" + encodeURIComponent(id)),
      ]);
      const targetResource = targetReply.data;
      this.target = id;
      this.folderSort = sort;
      this.targetOffset = offset;
      this.targetTotal = reply.data.totalCount;
      this.folders.set(reply.data.resources);
      this.path.set(reply.data.pathInfo || []);
      this.targetResource = targetResource;
      this.error.set("");
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  sortFolders(sort: FolderSort) {
    void this.browse(this.target, 0, sort);
  }
  get destinationAllowed() {
    if (this.action === "move" && this.resources.length)
      return (
        !!this.targetResource &&
        validMoveTarget(this.resources, this.targetResource)
      );
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
      ? this.i18n.t("ResourceDialog.NameRequired")
      : "";
  }
  /**
   * The resource server refuses a draft that does not raise the version and a
   * publication that lowers it. Below 0.0.1 is refused here even when the current
   * version cannot be read, since no artifact is numbered lower.
   */
  get versionError() {
    if (compareVersions(this.version, FIRST_VERSION) < 0)
      return this.i18n.t("ResourceDialog.VersionNotBefore", {
        version: formatVersion(FIRST_VERSION),
      });
    const current = parseVersion(this.resource?.["pav:version"]);
    if (!current) return "";
    const order = compareVersions(this.version, current);
    const version = formatVersion(current);
    if (this.action === "draft" && order <= 0)
      return this.i18n.t("ResourceDialog.VersionAfter", { version });
    if (this.action === "publish" && order < 0)
      return this.i18n.t("ResourceDialog.VersionNotBefore", { version });
    return "";
  }
  async submit() {
    if (this.busy() || !this.destinationAllowed) return;
    this.submitted = true;
    if (this.nameError || this.versionError) return;
    this.busy.set(true);
    this.error.set("");
    if (this.action === "move" && this.resources.length) {
      try {
        const result = await this.moves.move(this.resources, this.target);
        if (result.failed.length) {
          this.resources = result.failed.map((f) => f.resource);
          this.error.set(
            this.i18n.t(
              result.moved.length === 1
                ? "Explorer.MovedOne"
                : "Explorer.Moved",
              {
                count: result.moved.length,
              },
            ) +
              " " +
              result.failed
                .map((f) => this.title(f.resource) + ": " + f.message)
                .join("; "),
          );
          if (result.moved.length) this.changed.emit();
        } else if (this.alive) this.saved.emit();
      } catch (e) {
        this.fail(e);
      } finally {
        this.busy.set(false);
      }
      return;
    }
    const r = this.resource;
    const id = r?.["@id"];
    try {
      if (
        ["rename", "move", "delete", "make-open", "make-not-open"].includes(
          this.action,
        ) &&
        !this.etag
      )
        throw new Error(this.i18n.t("ResourceDialog.NoRevision"));
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
            newVersion: formatVersion(this.version),
          });
          break;
        case "draft":
          await this.api.request("/command/create-draft-artifact", "POST", {
            "@id": id,
            newVersion: formatVersion(this.version),
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
          throw new Error(this.i18n.t("ResourceDialog.UnknownAction"));
      }
      if (this.alive) this.saved.emit();
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}
