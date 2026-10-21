import {
  Collection,
  mintResourceId,
  resourceSelector,
  resourcePathId,
} from "./resource-address";
import { OperationCoordinator } from "./operation-coordinator";
import { refusedToNonOwner, writeRequiresRecovery } from "./write-failure";
import {
  ActionJournalStore,
  actionJournalScope,
  journaledActions,
} from "./action-journal";
import { validAccessReport } from "./access-validation";
import { validListing } from "./resource";
import { Tooltip } from "./tooltip";
import { validMoveTarget } from "./resource-moves";
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
import { Backend, HttpError, failureText } from "./backend.service";
import {
  Resource,
  Listing,
  collections,
  title,
  can,
  openThroughAFolder,
  openThroughText,
} from "./resource";
import { I18n } from "./i18n";
import { ServerLanguage } from "./server-text";
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
    ServerLanguage,
  ],
  templateUrl: "./resource-dialog.html",
})
export class ResourceDialog implements OnInit, AfterViewInit, OnDestroy {
  readonly confirmation = inject(Confirmation);
  private readonly i18n = inject(I18n);
  @Input({ required: true }) action = "";
  @Input() resource?: Resource;
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
  readonly reloadRequired = signal(false);
  readonly inspectionRequired = signal(false);
  private get conditional() {
    return ["rename", "move", "delete", "make-open", "make-not-open"].includes(this.action);
  }
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
  private initialValues: string | null = null;
  private etag: string | null = null;
  private alive = true;
  // New folder, Copy and Create Draft mint the identity they create at the first submit and send it
  // with every attempt. A lookup of that identity, or of the version Publish last sent, settles a
  // lost reply.
  private identity: string | null = null;
  private sentVersion: Version | null = null;
  private journal?: ActionJournalStore;
  readonly state = new OperationCoordinator<"load" | "browse" | "write">();
  private originalFocus = document.activeElement as HTMLElement | null;
  get headingIcon() {
    return (
      (
        {
          "new-folder": "folder",
          rename: "edit",
          copy: "copy",
          move: "move",
          delete: "delete",
          publish: "publish",
          draft: "new-record",
          "make-open": "globe",
          "make-not-open": "lock",
        } as Record<string, string>
      )[this.action] ?? "info"
    );
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
    return ["make-open", "make-not-open", "publish", "draft"].includes(
      this.action,
    )
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
    this.state.dispose();
    this.originalFocus?.focus();
  }
  ngOnInit() {
    void this.load();
  }
  private values() {
    // Browsing a destination changes navigation, not authored content to preserve.
    return JSON.stringify([this.name, this.description, this.version]);
  }
  async close() {
    if (!this.alive || (this.busy() && !this.preparing())) return;
    const decision = this.state.checkpoint();
    const values = this.values();
    const resource = this.resource;
    const action = this.action;
    // Publishing and drafting ask only for a version, which is quick to choose again.
    if (
      !["publish", "draft"].includes(this.action) &&
      this.initialValues !== null &&
      this.values() !== this.initialValues &&
      !(await this.confirmation.confirm(
        this.i18n.t("ResourceDialog.DiscardChanges"),
      ))
    )
      return;
    if (
      !decision() || this.values() !== values || this.resource !== resource ||
      this.action !== action || (this.busy() && !this.preparing())
    ) return;
    // Closing abandons an action whose outcome is known. One whose outcome is unknown is kept, so
    // reopening it cannot send a second copy, folder or draft.
    if (!this.inspectionRequired()) this.forget();
    this.alive = false;
    this.state.dispose();
    this.closed.emit();
  }
  async load() {
    if (!this.alive || this.inspectionRequired() || (this.busy() && !this.preparing())) return;
    const recovering = this.reloadRequired();
    const draft = { name: this.name, description: this.description, version: this.version };
    const destination = recovering ? this.target : this.folder;
    const operation = this.state.begin("load", ["browse"]);
    this.busy.set(true);
    this.etag = null;
    this.error.set("");
    try {
      const r = this.resource;
      this.target = this.folder;
      if (r) {
        this.name =
          this.action === "copy"
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
          if (!operation.current()) return;
          if (recovering) {
            if (reply.data?.["@id"] !== r["@id"] || !reply.etag?.trim())
              throw new Error(this.i18n.t("ResourceDialog.NoRevision"));
            const report = await this.api.report(r);
            if (!operation.current()) return;
            const capability = ({ rename: "updateResource", move: "moveResource", delete: "deleteResource", "make-open": "enableOpenView", "make-not-open": "disableOpenView" } as Record<string, string>)[this.action];
            if (!validAccessReport(report.data, r) || !can(report.data, capability))
              throw new Error(this.i18n.t("ResourceDialog.RecoveryDenied"));
          }
          this.etag = reply.etag;
          this.openViewPath = reply.data.pathInfo;
          this.name = this.title({ ...r, ...reply.data });
          this.description = reply.data["schema:description"] || "";
        }
      }
      if (!operation.current()) return;
      if (this.choosesFolder)
        await this.browse(destination, 0, this.folderSort, false);
      if (!operation.current()) return;
      if (!this.error()) this.reloadRequired.set(false);
      if (!recovering) this.adoptRetained();
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current()) this.fail(e);
    } finally {
      if (!operation.current()) return;
      this.busy.set(
        this.state.report.some((entry) => entry.status === "pending"),
      );
      this.initialValues = this.values();
      if (recovering) Object.assign(this, draft);
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
    // Only a rename holds what the person typed; the dialog's other actions have nothing to keep.
    this.error.set(failureText(e, this.i18n, this.action === "rename"));
  }
  async browse(
    id: string,
    offset = 0,
    sort: FolderSort = this.folderSort,
    adopt = true,
  ) {
    if (!this.alive || this.state.report.some(op => op.scope === "write" && op.status === "pending")) return;
    const operation = this.state.begin("browse");
    this.error.set("");
    this.busy.set(true);
    try {
      const [reply, targetReply] = await Promise.all([
        this.api.request<Listing>(
          "/folders/" +
            encodeURIComponent(resourcePathId(id)) +
            "/contents?resource_types=folder&sort=" +
            sort +
            "&limit=50&offset=" +
            offset,
        ),
        this.api.request<Resource>("/folders/" + encodeURIComponent(resourcePathId(id))),
      ]);
      if (!operation.current()) return;
      if (!validListing(reply.data))
        throw new Error(this.i18n.t("Errors.InvalidListing"));
      const targetResource = targetReply.data;
      this.target = id;
      this.folderSort = sort;
      this.targetOffset = offset;
      this.targetTotal = reply.data.totalCount;
      this.folders.set(reply.data.resources);
      this.path.set(reply.data.pathInfo || []);
      this.targetResource = targetResource;
      this.error.set("");
      // Choosing the destination of an unfinished action picks that action up again.
      if (adopt) this.adoptRetained();
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current()) this.fail(e);
    } finally {
      if (operation.current())
        this.busy.set(
          this.state.report.some((entry) => entry.status === "pending"),
        );
    }
  }
  sortFolders(sort: FolderSort) {
    void this.browse(this.target, 0, sort);
  }
  get destinationAllowed() {
    // Moving is held to the rule dragging shares: never into itself or below itself.
    if (this.action === "move" && this.resource)
      return (
        !!this.targetResource &&
        validMoveTarget([this.resource], this.targetResource)
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
    if (!this.alive || this.busy() || this.reloadRequired() || !this.destinationAllowed) return;
    this.submitted = true;
    if (this.nameError || this.versionError) return;
    // What is created gets its identity before the first attempt and keeps it for every later one,
    // so a repeat can never create a second folder, copy or draft. Until the deployment's base is
    // known no identity can be minted, and the server mints one as it always has.
    const collection = this.createdCollection();
    if (collection) this.identity ??= mintResourceId(collection);
    const operation = this.state.begin("write", ["load", "browse"]);
    this.busy.set(true);
    this.error.set("");
    const r = this.resource;
    const id = r?.["@id"];
    const journaled = this.journaled;
    let attempted = false;
    try {
      if (
        ["rename", "move", "delete", "make-open", "make-not-open"].includes(
          this.action,
        ) &&
        !this.etag
      )
        throw new Error(this.i18n.t("ResourceDialog.NoRevision"));
      this.sentVersion = this.version;
      if (journaled) this.retain(true);
      attempted = true;
      switch (this.action) {
        case "new-folder": {
          const folder = {
            folderId: resourceSelector(this.folder),
            name: this.name.trim(),
            // The folder API requires a nonempty description even though it is
            // optional in the dialog. Use the folder name as the initial value.
            description: this.description.trim() || this.name.trim(),
          };
          await (this.identity
            ? this.api.request(
                "/folders/" + encodeURIComponent(resourcePathId(this.identity)),
                "PUT",
                { "@id": this.identity, ...folder },
              )
            : this.api.request("/folders", "POST", folder));
          break;
        }
        case "rename":
          await this.api.request(
            "/command/rename-resource",
            "POST",
            {
              "@id": resourceSelector(id!),
              "schema:name": this.name.trim(),
              "schema:description": this.description,
            },
            this.etag,
          );
          break;
        case "copy":
          await this.api.request("/command/copy-artifact-to-folder", "POST", {
            "@id": resourceSelector(id!),
            targetFolderId: resourceSelector(this.target),
            nameTemplate: this.name.trim(),
            ...(this.identity ? { copyId: this.identity } : {}),
          });
          break;
        case "move":
          await this.api.request(
            "/command/move-resource-to-folder",
            "POST",
            { "@id": resourceSelector(id!), targetFolderId: resourceSelector(this.target) },
            this.etag,
          );
          break;
        case "publish":
          await this.api.request("/command/publish-artifact", "POST", {
            "@id": resourceSelector(id!),
            newVersion: formatVersion(this.version),
          });
          break;
        case "draft":
          await this.api.request("/command/create-draft-artifact", "POST", {
            "@id": resourceSelector(id!),
            newVersion: formatVersion(this.version),
            folderId: resourceSelector(this.target),
            // The draft is shared as the version it is drafted from is.
            propagateSharing: true,
            newFolderName: null,
            ...(this.identity ? { draftId: this.identity } : {}),
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
            { "@id": resourceSelector(id!) },
            this.etag,
          );
          break;
        default:
          throw new Error(this.i18n.t("ResourceDialog.UnknownAction"));
      }
      // The outcome is known even when this dialog is no longer open to report it.
      if (journaled) this.forget();
      if (operation.current()) {
        operation.finish();
        this.saved.emit();
      }
    } catch (e) {
      operation.fail(e);
      if (operation.current() && this.ownerOnly(e)) {
        // Only the owner may publish an artifact or create a draft of it. Nothing happened, so nothing is
        // kept for a later attempt to settle, and the identity this attempt was sent under is discarded.
        this.forget();
        this.identity = null;
        this.error.set(
          this.i18n.t(
            this.action === "publish"
              ? "ResourceDialog.PublishOnlyByOwner"
              : "ResourceDialog.DraftOnlyByOwner",
          ),
        );
      } else if (operation.current()) {
        if (writeRequiresRecovery(e)) {
          this.reloadRequired.set(true);
          // Creation, copy and publication carry no revision, so only a lookup can settle them.
          this.inspectionRequired.set(attempted && !this.conditional);
        }
        if (journaled && attempted) this.retain(this.inspectionRequired());
        // An identity already taken may be this action's own earlier attempt. The status names
        // Retry, and the transport's "changed since it was read" does not apply.
        const occupied =
          !!this.identity &&
          e instanceof HttpError &&
          [412, 428].includes(e.status);
        if (occupied) this.error.set("");
        else this.fail(e);
      }
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
  // An action is kept and looked up by what identifies its outcome: the identity it creates, or for
  // Publish the version it sends.
  private get journaled() {
    return (
      journaledActions.includes(this.action) &&
      (this.action === "publish" || !!this.identity)
    );
  }
  /** Whether this Publish or Create Draft was refused because the person is not the artifact's owner. */
  private ownerOnly(error: unknown) {
    return ["publish", "draft"].includes(this.action) && refusedToNonOwner(error);
  }
  /** Retry offers a lookup only where one can settle the outcome. */
  get settles() {
    return (
      this.inspectionRequired() &&
      this.journaled &&
      (this.action !== "publish" || !!this.sentVersion)
    );
  }
  /**
   * Learn whether the action whose reply was lost took effect, without sending it again. It did: the
   * dialog completes as on success. It did not: submit is offered again with the same identity and
   * values. Anything else leaves the dialog as it was, and Retry can be used again.
   */
  async settle() {
    if (!this.alive || !this.settles || this.busy()) return;
    const operation = this.state.begin("write", ["load", "browse"]);
    this.busy.set(true);
    this.error.set("");
    try {
      const outcome = await this.lookup();
      if (!operation.current()) return;
      if (outcome === "unresolved")
        throw new Error(this.i18n.t("Errors.InvalidResourceReport"));
      if (outcome === "committed") {
        this.forget();
        operation.finish();
        this.saved.emit();
        return;
      }
      this.reloadRequired.set(false);
      this.inspectionRequired.set(false);
      this.retain(false);
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current()) this.fail(e);
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
  private async lookup(): Promise<"committed" | "absent" | "unresolved"> {
    const r = this.resource;
    const same = (a: unknown, b: unknown) =>
      typeof a === "string" &&
      typeof b === "string" &&
      resourceSelector(a) === resourceSelector(b);
    // Not found answers the question. Any other refusal leaves it open.
    const read = async (path: string) => {
      try {
        return (await this.api.request<Record<string, unknown>>(path)).data;
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }
    };
    const address = (collection: string, id: string) =>
      "/" + collection + "/" + encodeURIComponent(resourcePathId(id));
    switch (this.action) {
      case "new-folder": {
        const folder = await read(address("folders", this.identity!));
        if (!folder) return "absent";
        const path = (folder as unknown as Resource).pathInfo;
        // The parent is the second-to-last folder of the path.
        return same(folder["@id"], this.identity) &&
          Array.isArray(path) &&
          same(path.at(-2)?.["@id"], this.folder)
          ? "committed"
          : "unresolved";
      }
      case "copy":
      case "draft": {
        const artifact = await read(
          address(collections[r!.resourceType], this.identity!),
        );
        if (!artifact) return "absent";
        const source =
          this.action === "copy" ? "pav:derivedFrom" : "pav:previousVersion";
        return same(artifact["@id"], this.identity) &&
          same(artifact[source], r!["@id"])
          ? "committed"
          : "unresolved";
      }
      case "publish": {
        const source = await read(
          address(collections[r!.resourceType], r!["@id"]),
        );
        if (
          source?.["bibo:status"] === "bibo:published" &&
          source["pav:version"] === formatVersion(this.sentVersion!)
        )
          return "committed";
        return source?.["bibo:status"] === "bibo:draft" &&
          source["pav:version"] === r!["pav:version"]
          ? "absent"
          : "unresolved";
      }
    }
    return "unresolved";
  }
  /** The collection the action creates in, or null for an action that creates nothing. */
  private createdCollection(): Collection | null {
    if (this.action === "new-folder") return "folders";
    if ((this.action === "copy" || this.action === "draft") && this.resource)
      return collections[this.resource.resourceType] as Collection;
    return null;
  }
  // Each action on each item at each destination has its own journal entry. Without a deployment,
  // an account or browser storage, nothing is kept and the dialog works as before.
  private journalStore(): ActionJournalStore | null {
    if (!journaledActions.includes(this.action)) return null;
    try {
      const deployment = this.api.config?.resourceRestAPI;
      const account = this.api.userId;
      if (!deployment || !account) return null;
      const destination =
        this.action === "new-folder"
          ? this.folder
          : this.action === "publish"
            ? ""
            : this.target;
      return new ActionJournalStore(
        actionJournalScope(
          deployment,
          account,
          this.action,
          resourceSelector(this.resource?.["@id"] ?? ""),
          resourceSelector(destination),
        ),
        sessionStorage,
      );
    } catch {
      return null;
    }
  }
  private retain(uncertain: boolean) {
    const store = this.journalStore();
    // A destination chosen after an attempt that did not happen moves the entry there.
    if (this.journal && this.journal.scope !== store?.scope) this.forget();
    if (!store) return;
    this.journal = store;
    try {
      store.write({
        format: "cedar-workspace-action",
        version: 1,
        scope: store.scope,
        id: this.identity,
        values: {
          name: this.name,
          description: this.description,
          version: this.sentVersion ?? this.version,
        },
        uncertain,
      });
    } catch {}
  }
  private forget() {
    try {
      this.journal?.clear();
    } catch {}
    this.journal = undefined;
  }
  // A dialog that has sent nothing takes up the entry for its action, item and destination: the
  // identity, the values, and whether the outcome is still unknown.
  private adoptRetained() {
    if (this.identity || this.journal || this.sentVersion) return;
    const store = this.journalStore();
    if (!store) return;
    let entry;
    try {
      entry = store.read(this.createdCollection());
    } catch {
      return;
    }
    if (!entry) return;
    this.journal = store;
    this.identity = entry.id;
    this.sentVersion = entry.values.version;
    this.name = entry.values.name;
    this.description = entry.values.description;
    this.version = entry.values.version;
    if (entry.uncertain) {
      this.reloadRequired.set(true);
      this.inspectionRequired.set(true);
    }
  }
}
