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
interface DeletionOutcome {
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
      footer {
        flex-wrap: wrap;
      }
      dialog[open] {
        display: flex;
        flex-direction: column;
      }
      header,
      footer {
        flex: none;
      }
      .deletion-body {
        overflow: auto;
        min-height: 0;
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
        margin: var(--cedar-space-4) 0;
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
        padding: var(--cedar-table-cell-padding-block) var(--cedar-table-cell-padding-inline);
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
  @Input({ required: true }) resource!: Resource;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() changed = new EventEmitter<void>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  private readonly api = inject(Backend);
  private readonly i18n = inject(I18n);
  readonly plan = signal<DeletionPlan | null>(null);
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
  private alive = true;
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
    this.alive = false;
    this.dialog.nativeElement.close();
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }
  close() {
    if (!this.deleting()) this.closed.emit();
  }
  async load() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.plan.set(null);
    try {
      const response = await this.api.request<DeletionPlan>(this.path);
      if (this.alive) this.plan.set(response.data);
    } catch (e) {
      if (this.alive) this.error.set(this.errorMessage(e, false));
    } finally {
      if (this.alive) this.busy.set(false);
    }
  }
  async confirm() {
    const plan = this.plan();
    if (this.busy() || !plan?.allowed) return;
    this.busy.set(true);
    this.deleting.set(true);
    this.error.set("");
    try {
      const response = await this.api.request<DeletionOutcome>(
        this.path,
        "POST",
        { token: plan.token },
      );
      if (!this.alive) return;
      this.plan.set(null);
      this.outcome.set(response.data);
      if (response.data.status === "completed") this.saved.emit();
      else this.changed.emit();
    } catch (e) {
      if (!this.alive) return;
      // A timeout may have followed a successful delete. Never repeat the confirmed request;
      // refresh the listing and require a new inventory and an explicit new confirmation.
      this.plan.set(null);
      this.error.set(this.errorMessage(e, true));
      this.changed.emit();
    } finally {
      if (this.alive) {
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
    return this.i18n.t("FolderDeletion." + key, {
      count: item.instancesOutside,
    });
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
