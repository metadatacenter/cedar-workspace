import { RevisionCoordinator } from "./revision-coordinator";
import { validDeletionPlan, validDeletionOutcome } from "./deletion-validation";
import {
  SelectionInventoryError,
  SelectionDeletion,
  SelectionPlan,
  emptyCounts,
} from "./selection-deletion";
import { Tooltip } from "./tooltip";
import { resourceTypes } from "./listing-filters";
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend, HttpError } from "./backend.service";
import { DialogKeyboard } from "./dialog-keyboard";
import { Icon } from "./icon";
import { I18n } from "./i18n";
import { Resource, ResourceType, title } from "./resource";
export interface DeletionItem {
  id: string | null;
  name: string | null;
  type: ResourceType;
  parentId: string | null;
  depth: number;
  deletable: boolean;
  protectedFolder: boolean;
  instancesInside: number;
  instancesOutside: number;
}
export interface DeletionPlan {
  token: string;
  allowed: boolean;
  counts: Record<ResourceType, number>;
  items: DeletionItem[];
  restrictedItems: number;
  protectedFolders: number;
  templatesWithInstances: number;
  templatesWithOutsideInstances: number;
  instancesOutside: number;
}
export interface DeletionOutcome {
  status: "completed" | "changed" | "blocked" | "stopped";
  deleted: Record<ResourceType, number>;
  remaining: number;
  code?: string;
}
@Component({
  selector: "cedar-folder-deletion-dialog",
  host: { class: "resource-list" },
  imports: [Tooltip, DialogKeyboard, Icon, TranslatePipe],
  templateUrl: "./folder-deletion-dialog.html",
  styles: [
    `
      dialog {
        width: min(48rem, calc(100vw - 2 * var(--cedar-space-4)));
      }
      dialog.simple-confirmation {
        width: fit-content;
        max-width: calc(100vw - 2 * var(--cedar-space-4));
      }
      footer {
        flex-wrap: wrap;
      }
      header,
      footer {
        flex: none;
      }
      .deletion-body {
        overflow: auto;
        min-height: 0;
      }
      .deletion-body > * {
        flex: none;
      }
      .deletion-inventory {
        max-height: 40vh;
        overflow: auto;
        margin-top: var(--cedar-space-3);
      }
      .deletion-counts {
        list-style: none;
        padding: 0;
        display: grid;
        gap: var(--cedar-space-1);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: auto;
      }
      th,
      td {
        width: auto;
        white-space: normal;
        text-align: left;
        overflow-wrap: anywhere;
      }
      th {
        padding: var(--cedar-space-2) var(--cedar-space-3);
        overflow-wrap: normal;
      }
      .inventory-name {
        display: flex;
        align-items: flex-start;
        gap: var(--cedar-space-2);
      }
      .inventory-name > span {
        min-width: 0;
      }
      .inventory-name cedar-icon {
        flex: none;
      }
      .resource-dialog-resource cedar-icon,
      .inventory-name cedar-icon {
        color: var(--cedar-color-primary);
      }
      td:nth-child(2) {
        white-space: nowrap;
      }
      summary {
        cursor: pointer;
        color: var(--cedar-color-primary);
      }
    `,
  ],
})
export class FolderDeletionDialog implements AfterViewInit, OnDestroy {
  readonly resourceTypes = resourceTypes;
  readonly artifactTypes = resourceTypes.filter(
    (type) => type.value !== "folder",
  );
  @Input() resource!: Resource;
  @Input() resources: Resource[] = [];
  private readonly selectionDeletion = inject(SelectionDeletion);
  private prepared: SelectionPlan | null = null;
  private completedIds = new Set<string>();
  readonly confirmedCounts = signal(emptyCounts());
  get bulk() {
    return this.resources.length > 0;
  }
  get selectedFolderCount() {
    return this.resources.filter((r) => r.resourceType === "folder").length;
  }
  get simpleConfirmation() {
    return this.bulk && this.selectedFolderCount === 0;
  }
  get simpleCount() {
    return this.plan() ? this.totalCount() : this.resources.length;
  }
  get selectedNames() {
    return this.resources.map((r) => ({
      resource: r,
      name: title(r, this.i18n.t("Common.Untitled")),
    }));
  }
  readonly totalCount = computed(() =>
    Object.values(this.plan()?.counts ?? {}).reduce((n, count) => n + count, 0),
  );
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() changed = new EventEmitter<void>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  private readonly api = inject(Backend);
  protected readonly i18n = inject(I18n);
  readonly plan = signal<DeletionPlan | null>(null);
  readonly subfolderCount = computed(() =>
    Math.max(0, (this.plan()?.counts.folder ?? 0) - 1),
  );
  private readonly itemsById = computed(
    () =>
      new Map(
        this.plan()
          ?.items.filter((item) => item.id !== null)
          .map((item) => [item.id, item]) ?? [],
      ),
  );
  readonly outcome = signal<DeletionOutcome | null>(null);
  readonly busy = signal(false);
  readonly deleting = signal(false);
  readonly error = signal("");
  readonly coordinator = new RevisionCoordinator();
  private readonly consumed = new WeakSet<DeletionPlan>();
  private preparedContext = "";
  private progressContext = "";
  private get context() {
    return JSON.stringify(
      (this.bulk ? this.resources : [this.resource]).map((r) => [
        r["@id"],
        r.resourceType,
      ]),
    );
  }
  private readonly returnFocus = document.activeElement as HTMLElement | null;
  get name() {
    return title(this.resource, this.i18n.t("Common.Untitled"));
  }
  private get path() {
    return this.api.path(this.resource) + "/deletion";
  }
  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
    void this.load();
  }
  ngOnDestroy() {
    this.coordinator.dispose();
    this.dialog.nativeElement.close();
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }
  close() {
    if (!this.deleting()) this.closed.emit();
  }
  async load() {
    if (this.busy()) return;
    const operation = this.coordinator.read();
    if (!operation) return;
    const context = this.context;
    if (this.progressContext !== context) {
      this.progressContext = context;
      this.confirmedCounts.set(emptyCounts());
      this.completedIds.clear();
      this.outcome.set(null);
    }
    this.preparedContext = "";
    this.busy.set(true);
    this.error.set("");
    this.plan.set(null);
    try {
      if (this.bulk) {
        this.prepared = null;
        const prepared = await this.selectionDeletion.prepare(
          this.resources.filter((r) => !this.completedIds.has(r["@id"])),
        );
        if (operation.current() && context === this.context) {
          this.preparedContext = context;
          this.prepared = prepared;
          this.plan.set(prepared.inventory);
          operation.finish();
        }
        return;
      }
      const response = await this.api.request<DeletionPlan>(this.path);
      if (!operation.current() || context !== this.context) return;
      if (!validDeletionPlan(response.data, this.resource["@id"]))
        throw new Error(this.i18n.t("FolderDeletion.InventoryUnavailable"));
      this.preparedContext = context;
      this.plan.set(response.data);
      operation.finish();
    } catch (e) {
      if (operation.current()) {
        operation.fail(e);
        this.error.set(
          e instanceof SelectionInventoryError
            ? title(e.resource, this.i18n.t("Common.Untitled")) +
                ": " +
                this.errorMessage(e.failure, false)
            : this.bulk
              ? this.i18n.t("SelectionDeletion.InventoryUnavailable")
              : this.errorMessage(e, false),
        );
      }
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
  async confirm() {
    const plan = this.plan();
    if (
      this.busy() ||
      !this.coordinator.active ||
      !plan?.allowed ||
      this.consumed.has(plan)
    )
      return;
    if (this.preparedContext && this.preparedContext !== this.context) {
      this.plan.set(null);
      this.error.set(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
      return;
    }
    if (this.bulk) {
      await this.confirmSelection();
      return;
    }
    if (!validDeletionPlan(plan, this.resource["@id"])) {
      this.plan.set(null);
      this.error.set(this.i18n.t("FolderDeletion.InventoryUnavailable"));
      return;
    }
    const operation = this.coordinator.write();
    if (!operation) return;
    this.consumed.add(plan);
    this.busy.set(true);
    this.deleting.set(true);
    this.error.set("");
    try {
      const response = await this.api.request<DeletionOutcome>(
        this.path,
        "POST",
        { token: plan.token },
      );
      if (!operation.current()) return;
      if (!validDeletionOutcome(response.data, plan))
        throw new Error(this.i18n.t("FolderDeletion.Uncertain"));
      operation.finish();
      if (response.data.status === "completed") {
        // Close before notifying the parent: success must never render the stopped outcome.
        this.dialog.nativeElement.close();
        this.saved.emit();
        return;
      }
      this.plan.set(null);
      const counts = { ...this.confirmedCounts() };
      for (const type of this.resourceTypes)
        counts[type.value] += response.data.deleted[type.value];
      this.confirmedCounts.set(counts);
      this.outcome.set({ ...response.data, deleted: counts });
      this.changed.emit();
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      // A timeout may have followed a successful delete. Never repeat the confirmed request;
      // refresh the listing and require a new inventory and an explicit new confirmation.
      this.plan.set(null);
      this.error.set(this.errorMessage(e, true));
      this.changed.emit();
    } finally {
      if (operation.current()) {
        this.busy.set(false);
        this.deleting.set(false);
      }
    }
  }
  private async confirmSelection() {
    if (!this.prepared) return;
    const operation = this.coordinator.write();
    if (!operation) return;
    const prepared = this.prepared;
    this.prepared = null; // Each confirmation is consumed once, even if the response is lost.
    this.busy.set(true);
    this.deleting.set(true);
    this.error.set("");
    this.outcome.set(null);
    try {
      for (const root of prepared.roots) {
        const result = await this.selectionDeletion.execute(root);
        if (!operation.current()) return;
        const counts = { ...this.confirmedCounts() };
        for (const type of this.resourceTypes)
          counts[type.value] += result.deleted[type.value];
        this.confirmedCounts.set(counts);
        if (result.status !== "completed") {
          this.plan.set(null);
          this.outcome.set({ ...result, deleted: counts });
          operation.finish();
          this.changed.emit();
          return;
        }
        this.completedIds.add(root.resource["@id"]);
        root.plan?.items.forEach((item) => {
          if (item.id) this.completedIds.add(item.id);
        });
      }
      operation.finish();
      this.dialog.nativeElement.close();
      this.saved.emit();
    } catch (e) {
      if (operation.current()) {
        operation.fail(e);
        this.plan.set(null);
        this.error.set(this.i18n.t("SelectionDeletion.Uncertain"));
        this.outcome.set({
          status: "stopped",
          deleted: this.confirmedCounts(),
          remaining: 0,
        });
        this.changed.emit();
      }
    } finally {
      if (operation.current()) {
        this.busy.set(false);
        this.deleting.set(false);
      }
    }
  }
  private readonly reasonKeys = new Map(
    Object.entries({
      FOLDER_DELETE_NOT_OWNER: "NotOwner",
      FOLDER_DELETE_PROTECTED_ROOT: "ProtectedRoot",
      FOLDER_DELETE_INVALID_TOKEN: "Changed",
      FOLDER_DELETE_INVENTORY_UNAVAILABLE: "InventoryUnavailable",
      FOLDER_DELETE_CHANGED: "Changed",
      FOLDER_DELETE_BLOCKED: "Refused",
      FOLDER_DELETE_STOPPED: "Stopped",
      FOLDER_DELETE_ITEM_CHANGED: "ItemChanged",
      FOLDER_DELETE_FOLDER_CHANGED: "FolderChanged",
      FOLDER_DELETE_CLEANUP_PENDING: "CleanupPending",
      FOLDER_DELETE_ARTIFACT_REFUSED: "ArtifactRefused",
      FOLDER_DELETE_COMPLETED: "Completed",
    }),
  );
  outcomeMessage(outcome: DeletionOutcome) {
    return this.i18n.t(
      "FolderDeletion." +
        (this.reasonKeys.get(outcome.code ?? "") ?? "Stopped"),
    );
  }
  private errorMessage(error: unknown, deleting: boolean) {
    let key = deleting ? "Uncertain" : "InventoryUnavailable";
    if (error instanceof HttpError) {
      key =
        this.reasonKeys.get(error.code ?? "") ??
        (
          {
            400: "Changed",
            401: "SessionExpired",
            403: "AccessDenied",
            404: "Missing",
            409: "Changed",
            412: "Changed",
          } as Record<number, string>
        )[error.status] ??
        key;
    }
    // Protocol codes are translated here; raw server/browser errors never become dialog text.
    return this.i18n.t("FolderDeletion." + key);
  }
  check(item: DeletionItem) {
    const key = !item.deletable
      ? "NoPermission"
      : item.protectedFolder
        ? "ProtectedItem"
        : item.instancesOutside
          ? "ExternalCount"
          : "Eligible";
    return this.i18n.counted("FolderDeletion." + key, item.instancesOutside);
  }
  parent(item: DeletionItem) {
    const parent = this.itemsById().get(item.parentId);
    return parent ? this.itemName(parent) : "";
  }
  itemName(item: DeletionItem) {
    return item.id === null
      ? this.i18n.t("FolderDeletion.Restricted")
      : item.name || this.i18n.t("Common.Untitled");
  }
}
