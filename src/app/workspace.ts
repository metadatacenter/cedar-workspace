import { resourceSelector, resourcePathId, resourceIri } from "./resource-address";
import { OperationCoordinator } from "./operation-coordinator";
import { validListing } from "./resource";
import { validResourceReport } from "./resource-report";
import { DragPreview } from "./drag-preview";
import { TooltipController } from "./tooltip-controller";
import { Tooltip } from "./tooltip";
import {
  CdkDropList,
  CdkDrag,
  CdkDragPreview,
  CdkDragMove,
  CdkDragEnd,
} from "@angular/cdk/drag-drop";
import { ExplorerSelection } from "./explorer-selection";
import { ResourceMoves, validMoveShape } from "./resource-moves";
import { CopyButton } from "./copy-button";
import { DescriptionEditor } from "./description-editor";
import { SortMenu } from "./sort-menu";
import { ResourceFilters } from "./resource-filters";
import {
  ListingFilters,
  filtersFromParams,
  filterQuery,
} from "./listing-filters";
import { ArtifactPreview } from "./artifact-preview";
import { Toast } from "./toast";
import {
  Component,
  DestroyRef,
  HostListener,
  inject,
  signal,
  afterNextRender,
  ElementRef,
  Injector,
  computed,
  effect,
} from "@angular/core";
import { FriendlyDatePipe } from "./friendly-date";
import { TitleCasePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { ActivatedRoute, NavigationStart, Router, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Backend } from "./backend.service";
import {
  Resource,
  Listing,
  title,
  can,
  offeredInOpenView,
  versioned,
  listingPath,
  resourceLink,
  collections,
} from "./resource";
import { Icon } from "./icon";
import { FolderDeletionDialog } from "./folder-deletion-dialog";
import { ResourceDialog } from "./resource-dialog";
import { PermissionsDialog } from "./permissions-dialog";
import { I18n } from "./i18n";
export interface Action {
  id: string;
  label: string;
  enabled: boolean;
}
export function actions(r: Resource, i18n: Pick<I18n, "t">): Action[] {
  const cap = (key: string) => can(r, key);
  const label = (key: string) => i18n.t(key);
  return [
    {
      id: "populate",
      label: label("ResourceActions.Populate"),
      enabled: r.resourceType === "template" && cap("populate"),
    },
    {
      id: "open",
      label: label("ResourceActions.Open"),
      enabled: cap("readResource"),
    },
    {
      id: "permissions",
      label: label("ResourceActions.Permissions"),
      enabled: cap("readResource"),
    },
    {
      id: "copy",
      label: label("ResourceActions.Copy"),
      enabled: r.resourceType !== "folder" && cap("copyFromResource"),
    },
    {
      id: "move",
      label: label("ResourceActions.Move"),
      enabled: cap("moveResource"),
    },
    {
      id: "rename",
      label: label("ResourceActions.Rename"),
      enabled: cap("updateResource"),
    },
    ...(r.resourceType === "instance"
      ? []
      : [
          {
            id: "publish",
            label: label("ResourceActions.Publish"),
            enabled: cap("publish"),
          },
          {
            id: "draft",
            label: label("ResourceActions.CreateDraft"),
            enabled: cap("createDraft"),
          },
        ]),
    {
      id: "delete",
      label: label("ResourceActions.Delete"),
      enabled: cap("deleteResource"),
    },
    {
      id: "make-open",
      label: label("ResourceActions.MakeOpen"),
      enabled: window.makeOpenEnabled !== false && cap("enableOpenView"),
    },
    {
      id: "make-not-open",
      label: label("ResourceActions.MakeNotOpen"),
      enabled: window.makeOpenEnabled !== false && cap("disableOpenView"),
    },
    {
      id: "openview",
      label: label("ResourceActions.OpenInOpenView"),
      enabled: offeredInOpenView(r),
    },
  ].filter((action) => {
    // Applicability comes from the resource kind; capabilities still gate valid actions.
    switch (action.id) {
      case "populate":
        return r.resourceType === "template";
      case "copy":
        return r.resourceType !== "folder";
      case "publish":
      case "draft":
        return ["template", "element", "field"].includes(r.resourceType);
      default:
        return true;
    }
  });
}
/** The query parameter naming the artifact to select once the listing is loaded. */
const SELECTED_PARAM = "selected";
/** The query parameter naming the Info panel tab to show that artifact on. */
const TAB_PARAM = "tab";
/**
 * The query parameter that keeps the listing in list view. Grid is the default and goes unnamed. The
 * address carries the choice, as it carries sorting, so a return from an editor and a reload keep it.
 */
const VIEW_PARAM = "view";
/** The Info panel's tabs: the artifact's details, and its version and its history. */
type InfoTab = "info" | "version";

@Component({
  selector: "cedar-workspace-page",
  imports: [
    DragPreview,
    Tooltip,
    ArtifactPreview,
    CdkDropList,
    CdkDrag,
    CdkDragPreview,
    ExplorerSelection,
    Toast,
    ResourceFilters,
    SortMenu,
    DescriptionEditor,
    CopyButton,
    FormsModule,
    FriendlyDatePipe,
    RouterLink,
    ResourceDialog,
    FolderDeletionDialog,
    PermissionsDialog,
    Icon,
    TranslatePipe,
  ],
  templateUrl: "./workspace.html",
})
export class Workspace {
  private readonly tooltips = inject(TooltipController);
  protected readonly i18n = inject(I18n);
  readonly cedarVersion = window.cedarVersion || this.i18n.t("Common.Unknown");
  readonly api = inject(Backend);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private injector = inject(Injector);
  readonly title = (r: Resource) => title(r, this.i18n.t("Common.Untitled"));
  readonly can = can;
  readonly offeredInOpenView = offeredInOpenView;
  readonly versioned = versioned;
  readonly actions = (r: Resource) => actions(r, this.i18n);
  attribution(userId?: string, name?: string): string {
    if (this.isCurrentUser(userId))
      return this.i18n.t("Dashboard.ByYou");
    return name ? this.i18n.t("Dashboard.By", { name }) : "";
  }
  ownerName(r: Resource): string {
    return this.isCurrentUser(r.ownedBy)
      ? this.i18n.t("Dashboard.You")
      : r.ownedByUserName || "—";
  }
  private isCurrentUser(userId?: string): boolean {
    return !!userId && userId === this.api.profile?.["@id"];
  }
  /** A role as the server states it, translated when Workspace knows it. */
  role(r: Resource) {
    const role = r.currentUserPermissions?.role;
    return role ? this.i18n.known("Roles." + role, role) : "—";
  }
  /** A version's publication status, translated when Workspace knows it. */
  status(v: Resource) {
    const status = v["bibo:status"]?.replace("bibo:", "");
    if (!status) return "—";
    return this.i18n.known(
      "Status." + status,
      new TitleCasePipe().transform(status),
    );
  }
  readonly now = signal(Date.now());
  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly rows = signal<Resource[]>([]);
  readonly path = signal<Resource[]>([]);
  readonly currentFolder = signal<Resource | undefined>(undefined);
  readonly grid = signal(true);
  readonly preview = signal<Resource | null>(null);
  readonly selectionIds = signal<string[]>([]);
  readonly selection = computed(() =>
    this.rows().filter((r) => this.selectionIds().includes(r["@id"])),
  );
  readonly moving = signal(false);
  readonly cutItems = signal<Resource[]>([]);
  openSelectionDeletion(event: Event) {
    this.reviewDeletion(this.selection(), event.currentTarget as HTMLElement);
  }
  private reviewDeletion(resources: Resource[], trigger: HTMLElement | null) {
    trigger?.focus();
    this.deletionSelection.set([...resources]);
  }
  readonly deletionSelection = signal<Resource[] | null>(null);
  readonly deleteDrop = signal(false);
  readonly dropTarget = signal("");
  readonly dragging = signal<Resource[]>([]);
  readonly validDropIds = computed(() => new Set(
    [...this.rows(), ...this.path()].filter(target =>
      this.dragging().every(r => can(r, "moveResource")) &&
      target["@id"] !== this.folder &&
      validMoveShape(this.dragging(), target) &&
      (can(target, "moveIntoFolder") || this.path().some(p => p["@id"] === target["@id"]))
    ).map(target => target["@id"]),
  ));
  readonly dropName = computed(() => {
    const target = [...this.rows(), ...this.path()].find(r => r["@id"] === this.dropTarget());
    return target ? this.title(target) : "";
  });
  readonly movedTarget = signal("");
  private movedTimer?: ReturnType<typeof setTimeout>;
  private moves = inject(ResourceMoves);
  readonly canMoveSelection = computed(
    () =>
      this.selection().length > 0 &&
      this.selection().every((r) => can(r, "moveResource")),
  );
  canDrag(r: Resource) {
    const items = this.selectionIds().includes(r["@id"]) ? this.selection() : [r];
    return items.length > 0 && items.every(item => can(item, "moveResource") || can(item, "deleteResource"));
  }
  readonly selected = signal<Resource | undefined>(undefined);
  readonly instances = signal<Resource[]>([]);
  readonly instanceTotal = signal(0);
  /** Whether the search for the selected template's instances has answered. */
  readonly instancesLoaded = signal(false);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly left = signal(true);
  readonly right = signal(true);
  readonly dialog = signal<{ action: string; resource?: Resource } | null>(
    null,
  );
  readonly menu = signal<string | null>(null);
  tab: InfoTab = "info";
  search = "";
  sort = "name";
  folder = "";
  params = new URLSearchParams();
  // The listing the URL names, without the artifact to select in it or the tab to show
  // it on: dropping those parameters once applied must not load the listing again.
  private listingKey: string | null = null;
  // An artifact to select once the listing holds it, as an editor returning here names it,
  // and the Info panel tab it was left on.
  private reselect: string | null = null;
  private reselectTab: InfoTab = "info";
  readonly state = new OperationCoordinator<"listing" | "folder" | "detail" | "instances" | "menu" | "enrichment" | "move">();
  private listingGeneration = 0;
  // Detail, menus and background enrichment publish into the same resource state.
  private reports = new OperationCoordinator<string>();
  constructor() {
    effect(() => {
      document.body.classList.toggle("explorer-dragging", this.dragging().length > 0);
      document.body.classList.toggle("explorer-can-drop", !!this.dropTarget() || this.deleteDrop());
    });
    const clock = setInterval(() => this.now.set(Date.now()), 60_000);
    this.router.events
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((event) => {
        if (event instanceof NavigationStart) this.rememberSelection(event);
      });
    void this.start();
    this.destroy.onDestroy(() => {
      clearInterval(clock);
      clearTimeout(this.movedTimer);
      this.tooltips.resume();
      document.body.classList.remove("explorer-dragging", "explorer-can-drop");
      this.state.dispose();
      this.reports.dispose();
    });
  }
  async start() {
    try {
      if (!(await this.api.init()) || !this.state.active) return;
      this.ready.set(true);
      this.route.queryParamMap
        .pipe(takeUntilDestroyed(this.destroy))
        .subscribe((map) => {
          this.params = new URLSearchParams();
          // The view changes how the listing is shown, not what it holds, so it is not part of its key.
          this.grid.set(map.get(VIEW_PARAM) !== "list");
          map.keys
            .filter((key) => ![SELECTED_PARAM, TAB_PARAM, VIEW_PARAM].includes(key))
            .forEach((key) => this.params.set(key, map.get(key)!));
          const selected = map.get(SELECTED_PARAM);
          if (selected) {
            this.reselect = resourceIri(selected, this.api.profile.homeFolderId);
            this.reselectTab = map.get(TAB_PARAM) === "version" ? "version" : "info";
          }
          const listingKey = this.params.toString();
          if (listingKey === this.listingKey && !selected) return;
          this.listingKey = listingKey;
          this.search = map.get("search") || "";
          this.folder = resourceIri(map.get("folderId") || this.api.profile.homeFolderId, this.api.profile.homeFolderId);
          const sort = map.get("sort") || "name";
          this.sort = [
            "name",
            "-name",
            "createdOnTS",
            "-createdOnTS",
            "lastUpdatedOnTS",
            "-lastUpdatedOnTS",
          ].includes(sort)
            ? sort
            : "name";
          const offset = Number(map.get("offset") || 0);
          this.offset.set(
            Number.isSafeInteger(offset) && offset >= 0
              ? Math.floor(offset / 50) * 50
              : 0,
          );
          void this.load();
        });
    } catch (e) {
      this.fail(e);
    }
  }
  fail(e: unknown) {
    this.error.set(e instanceof Error ? e.message : String(e));
  }
  async load(refresh = false) {
    if (!this.state.active) return;
    this.listingGeneration++;
    this.reports.dispose();
    this.reports = new OperationCoordinator<string>();
    clearTimeout(this.movedTimer);
    this.movedTarget.set("");
    const operation = this.state.begin("listing", ["folder", "detail", "instances", "menu", "enrichment"]);
    this.loading.set(true);
    this.refreshing.set(refresh);
    this.error.set("");
    this.selected.set(undefined);
    this.selectionIds.set([]);
    this.currentFolder.set(undefined);
    this.instances.set([]);
    this.instanceTotal.set(0);
    this.instancesLoaded.set(false);
    if (!refresh) {
      this.path.set([]);
    }
    this.menu.set(null);
    try {
      const { data } = await this.api.request<Listing>(
        listingPath(
          this.params,
          this.api.profile.homeFolderId,
          this.sort,
          this.offset(),
        ),
      );
      if (!operation.current()) return;
      if (!validListing(data)) throw new Error(this.i18n.t("Errors.InvalidListing"));
      this.rows.set(data.resources);
      this.total.set(data.totalCount);
      this.path.set(data.pathInfo || []);
      void this.loadFolder();
      // Listings omit lifecycle actions. Enrich template links without blocking the table.
      void this.loadTemplateActions(data.resources);
      this.restoreSelection();
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current()) {
        if (!refresh) {
          this.rows.set([]);
          this.total.set(0);
        }
        this.fail(e);
      }
    } finally {
      if (operation.current()) {
        this.loading.set(false);
        this.refreshing.set(false);
      }
    }
  }
  /**
   * Select again the artifact an editor was opened on, once the listing holds it.
   *
   * Opening an artifact leaves the dashboard for an editor, and coming back loaded a
   * fresh listing with nothing selected. The editor returns to the address it was
   * given, which names the artifact and the Info panel tab it was left on; both
   * parameters are dropped once applied, so a reload or a later return does not
   * select it again.
   */
  private restoreSelection() {
    const id = this.reselect;
    if (id === null) return;
    const tab = this.reselectTab;
    this.reselect = null;
    this.reselectTab = "info";
    const r = this.rows().find((row) => row["@id"] === id);
    if (r) {
      void this.select(r, tab);
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector(`[data-resource-id="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ block: "nearest" }),
        { injector: this.injector },
      );
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [SELECTED_PARAM]: null, [TAB_PARAM]: null },
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }
  /**
   * Where an editor opened from here returns to: this listing, naming the artifact to
   * select again. That is the one opened when the listing shows it, and otherwise the
   * one selected now, as when a link in the Info panel opens an artifact kept elsewhere.
   * The Info panel comes back on the tab it was left on.
   */
  private returnHere(opened?: Resource) {
    const listed =
      opened && this.rows().some((row) => row["@id"] === opened["@id"])
        ? opened
        : undefined;
    const selection = this.selection();
    const keep = listed ?? (selection.length === 1 ? selection[0] : undefined);
    // The query is edited as text: URLSearchParams would re-encode every other
    // parameter, so the way back would no longer be the address the router wrote.
    const url = new URL(location.href);
    const params = url.search
      .slice(1)
      .split("&")
      .filter((param) => param && ![SELECTED_PARAM, TAB_PARAM].includes(param.split("=")[0]));
    if (keep) {
      params.push(SELECTED_PARAM + "=" + encodeURIComponent(resourceSelector(keep["@id"])));
      if (this.tab !== "info") params.push(TAB_PARAM + "=" + this.tab);
    }
    url.search = params.join("&");
    return url.toString();
  }
  /**
   * Name the selected artifact in the history entry a link inside the Workspace leaves.
   *
   * Opening a folder from the Info panel, or following any other link inside the Workspace,
   * adds a history entry, and Back loaded the listing again with nothing selected. The entry
   * left behind now names the selection, as an editor's way back does, so Back selects it
   * again. A navigation that replaces the entry changes nothing. Neither does one that Back
   * or Forward starts, because the browser has already moved to another entry.
   */
  private rememberSelection(event: NavigationStart) {
    if (event.navigationTrigger !== "imperative" || this.router.currentNavigation()?.extras.replaceUrl) return;
    const here = this.returnHere();
    if (here !== location.href) history.replaceState(history.state, "", here);
  }
  private async loadFolder() {
    const operation = this.state.begin("folder");
    try {
      const { data } = await this.api.request<Resource>(
        "/folders/" + encodeURIComponent(resourcePathId(this.folder)),
      );
      if (!operation.current()) return;
      this.checkReport({ "@id": this.folder, resourceType: "folder" }, data);
      this.currentFolder.set(data);
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current()) this.fail(e);
    }
  }
  private async loadTemplateActions(resources: Resource[]) {
    const operation = this.state.begin("enrichment");
    const templates = resources.filter((r) => r.resourceType === "template");
    // Claim the whole background batch now, before a user requests fresher details.
    const owners = templates.map((r) => this.reports.begin(r["@id"]));
    for (let i = 0; i < templates.length; i += 4) {
      if (!operation.current()) return;
      const reports = await Promise.allSettled(
        templates.slice(i, i + 4).map((r, index) =>
          owners[i + index].current() ? this.api.report(r) : Promise.resolve(null)),
      );
      if (!operation.current()) return;
      for (const [index, report] of reports.entries()) {
        if (owners[i + index].current() && report.status === "fulfilled" && report.value) {
          try {
            this.checkReport(templates[i + index], report.value.data);
            this.publishReport(templates[i + index], report.value.data);
          } catch (e) {
            operation.fail(e);
            this.fail(e);
            return;
          }
        }
      }
    }
    operation.finish();
  }
  private menuTrigger: HTMLElement | null = null;
  menuTop = signal(8);
  menuLeft = signal(8);
  @HostListener("document:click", ["$event"]) dismissMenu(event: MouseEvent) {
    const target = event.target as Element;
    if (!target.closest(".row-actions")) this.menu.set(null);
    document
      .querySelectorAll<HTMLDetailsElement>(
        ".new-menu[open], .header-menu[open]",
      )
      .forEach((menu) => {
        if (!menu.contains(target)) menu.open = false;
      });
  }
  @HostListener("window:resize")
  @HostListener("document:keydown.escape")
  escapeMenu() {
    if (this.menu()) this.menuTrigger?.focus();
    this.menu.set(null);
    this.host.nativeElement
      .querySelectorAll<HTMLDetailsElement>("details[open]")
      .forEach((menu) => {
        menu.open = false;
        menu.querySelector<HTMLElement>("summary")?.focus();
      });
  }
  menuKey(event: KeyboardEvent) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        ".resource-menu button:not(:disabled)",
      ),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  }
  async select(r: Resource, tab?: InfoTab) {
    if (!this.state.active) return;
    // Selecting the artifact the panel already shows, as the first click of a double-click does, keeps
    // its tab. Another artifact starts on Details unless a return names its tab.
    tab ??= this.selected()?.["@id"] === r["@id"] ? this.tab : "info";
    const operation = this.state.begin("detail", ["instances"]);
    const owner = this.reports.begin(r["@id"]);
    this.error.set("");
    this.selectionIds.set([r["@id"]]);
    this.selected.set(r);
    this.instances.set([]);
    this.instanceTotal.set(0);
    this.instancesLoaded.set(false);
    // Only an artifact with versions has the Version tab.
    this.tab = tab === "version" && versioned(r) ? "version" : "info";
    try {
      const { data } = await this.api.report(r);
      if (operation.current()) {
        if (owner.current()) {
          this.checkReport(r, data);
          this.publishReport(r, data);
        }
        if (r.resourceType === "template") void this.loadInstances(r);
      }
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current() && owner.current()) this.fail(e);
    }
  }
  setSelection(ids: string[]) {
    if (this.moving()) return;
    this.selectionIds.set(ids);
    if (ids.length === 1) {
      const r = this.rows().find((r) => r["@id"] === ids[0]);
      if (r) void this.select(r);
    } else {
      this.state.cancel("detail", "instances");
      this.selected.set(undefined);
      this.instances.set([]);
      this.instanceTotal.set(0);
      this.instancesLoaded.set(false);
    }
  }
  doubleClickItem(r: Resource, event: MouseEvent) {
    const target = event.target as Element;
    if (this.loading() || this.moving() || target.closest("a,button,input,.row-actions")) return;
    if (this.grid() || r.resourceType === "folder" || target === event.currentTarget)
      this.openItem(r["@id"]);
  }
  openItem(id: string) {
    const r = this.rows().find((r) => r["@id"] === id);
    if (r) void this.act("open", r);
  }
  startDrag(r: Resource) {
    this.deleteDrop.set(false);
    this.dropTarget.set("");
    this.tooltips.suspend();
    this.menu.set(null);
    if (!this.selectionIds().includes(r["@id"])) this.setSelection([r["@id"]]);
    clearTimeout(this.movedTimer);
    this.movedTarget.set("");
    this.dragging.set([...this.selection()]);
  }
  dragMove(event: CdkDragMove) {
    const element = document
      .elementFromPoint(
        event.pointerPosition.x - window.scrollX,
        event.pointerPosition.y - window.scrollY,
      )
      ?.closest<HTMLElement>("[data-drop-id], .selection-delete");
    const deleteTarget = !!element?.matches(".selection-delete:not(:disabled)") && this.dragging().length > 0;
    this.deleteDrop.set(deleteTarget);
    const id = element?.dataset["dropId"];
    this.dropTarget.set(id && this.validDropIds().has(id) ? id : "");
  }
  endDrag(event: CdkDragEnd, explorer: ExplorerSelection) {
    const target = this.dropTarget(),
      deleting = this.deleteDrop(),
      resources = this.dragging();
    this.deleteDrop.set(false);
    this.dropTarget.set("");
    this.dragging.set([]);
    event.source.reset();
    explorer.ignoreClick();
    this.tooltips.resume();
    if (deleting) this.reviewDeletion(resources, this.host.nativeElement.querySelector(".selection-delete"));
    else if (target) void this.moveItems(resources, target);
  }
  cutSelection() {
    if (this.canMoveSelection()) this.cutItems.set([...this.selection()]);
  }
  async moveItems(resources: Resource[], target: string) {
    if (!this.state.active || this.moving() || !resources.length) return;
    const operation = this.state.begin("move");
    let generation = this.listingGeneration;
    const current = () => operation.current() && generation === this.listingGeneration;
    this.moving.set(true);
    this.error.set("");
    try {
      const result = await this.moves.move(resources, target);
      if (!current()) return;
      this.cutItems.update((items) =>
        items.filter((r) => !result.moved.includes(r["@id"])),
      );
      const reload = this.load(true);
      generation = this.listingGeneration;
      await reload;
      if (!current()) return;
      if (result.moved.length) {
        clearTimeout(this.movedTimer);
        this.movedTarget.set(target);
        this.movedTimer = setTimeout(() => {
          if (current()) this.movedTarget.set("");
        }, 1600);
      }
      this.selectionIds.set(
        result.failed
          .map((f) => f.resource["@id"])
          .filter((id) => this.rows().some((r) => r["@id"] === id)),
      );
      this.notice.set(
        this.i18n.counted("Explorer.Moved", result.moved.length, {
          count: result.moved.length,
        }),
      );
      if (result.failed.length)
        this.error.set(
          result.failed
            .map((f) => this.title(f.resource) + ": " + f.message)
            .join("; "),
        );
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (current()) this.fail(e);
    } finally {
      if (operation.current()) this.moving.set(false);
    }
  }
  explorerKeys(event: KeyboardEvent) {
    if (
      (event.target as Element).closest("input,textarea,select") ||
      !(event.metaKey || event.ctrlKey)
    )
      return;
    if (event.key.toLowerCase() === "x") {
      event.preventDefault();
      this.cutSelection();
    }
    if (
      event.key.toLowerCase() === "v" &&
      this.cutItems().length &&
      can(this.currentFolder(), "moveIntoFolder")
    ) {
      event.preventDefault();
      void this.moveItems(this.cutItems(), this.folder);
    }
  }
  private async loadInstances(r: Resource) {
    const operation = this.state.begin("instances");
    try {
      const { data } = await this.api.request<Listing>(
        "/search?is_based_on=" +
          encodeURIComponent(resourceSelector(r["@id"])) +
          "&limit=50&offset=0",
      );
      if (operation.current()) {
        if (!validListing(data)) throw new Error(this.i18n.t("Errors.InvalidListing"));
        this.instances.set(data.resources);
        this.instanceTotal.set(data.totalCount);
        this.instancesLoaded.set(true);
      }
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current()) this.fail(e);
    }
  }
  // The folders above a resource, outermost first. A path may end with the resource itself.
  location(r: Resource): Resource[] {
    return r.pathInfo?.filter((p) => p["@id"] !== r["@id"]) ?? [];
  }
  parentId(r: Resource): string | undefined {
    return this.location(r).at(-1)?.["@id"];
  }
  copyId(value: string) {
    return this.copy(value, "Common.IdCopied");
  }
  copyLink(value: string) {
    return this.copy(value, "Common.LinkCopied");
  }
  private async copy(value: string, notice: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.notice.set(this.i18n.t(notice));
    } catch (e) {
      this.fail(e);
    }
  }
  async toggleMenu(r: Resource, event: MouseEvent) {
    if (!this.state.active) return;
    if (this.menu() === r["@id"]) {
      this.state.cancel("menu");
      this.menu.set(null);
      return;
    }
    const operation = this.state.begin("menu");
    const owner = this.reports.begin(r["@id"]);
    this.menuTrigger = event.currentTarget as HTMLElement;
    const rect = this.menuTrigger.getBoundingClientRect();
    this.menuLeft.set(
      Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)),
    );
    this.menuTop.set(8);
    this.menu.set(r["@id"]);
    afterNextRender(
      () => {
        if (!operation.current() || this.menu() !== r["@id"]) return;
        const menu =
          this.host.nativeElement.querySelector<HTMLElement>(".resource-menu");
        menu
          ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus();
        if (menu)
          this.menuTop.set(
            Math.max(
              8,
              Math.min(
                rect.bottom,
                window.innerHeight - menu.getBoundingClientRect().height - 8,
              ),
            ),
          );
      },
      { injector: this.injector },
    );
    try {
      const { data } = await this.api.report(r);
      if (!operation.current()) return;
      if (owner.current() && this.menu() === r["@id"]) {
        this.checkReport(r, data);
        this.publishReport(r, data);
      }
      operation.finish();
    } catch (e) {
      operation.fail(e);
      if (operation.current() && owner.current() && this.menu() === r["@id"]) this.fail(e);
    }
  }
  navigationQuery(destination: Record<string, string> = {}) {
    // Sorting and the view are preferences; location, search, filters and paging are not.
    return {
      ...(this.params.has("sort") ? { sort: this.sort } : {}),
      ...(this.params.get("folders") === "first" ? { folders: "first" } : {}),
      ...(this.grid() ? {} : { [VIEW_PARAM]: "list" }),
      ...destination,
    };
  }
  setView(grid: boolean) {
    this.grid.set(grid);
    // A preference, not a place: switching views adds no history entry.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: "merge",
      queryParams: { [VIEW_PARAM]: grid ? null : "list" },
      replaceUrl: true,
    });
  }
  submitSearch() {
    void this.router.navigate(["/dashboard"], {
      queryParams: this.navigationQuery(this.search.trim()
        ? { search: this.search.trim() }
        : { folderId: resourceSelector(this.folder) }),
    });
  }
  get filters(): ListingFilters {
    return filtersFromParams(this.params);
  }
  changeFilters(filters: ListingFilters) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: "merge",
      queryParams: filterQuery(filters),
    });
  }
  changeSort(field: string) {
    this.setSort(this.sort === field ? "-" + field : field);
  }
  setFoldersFirst(first: boolean) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: "merge",
      queryParams: { folders: first ? "first" : null, offset: null },
    });
  }
  get version() {
    return this.params.get("version") === "latest" ? "latest" : "all";
  }
  setVersion(version: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: "merge",
      queryParams: {
        version: version === "latest" ? "latest" : null,
        offset: null,
      },
    });
  }
  descriptionSaved(resource: Resource) {
    if (!this.state.active) return;
    this.reports.begin(resource["@id"]);
    this.publishReport(resource, resource);
    this.notice.set(this.i18n.t("Dashboard.DescriptionSaved"));
  }
  private checkReport(expected: Resource, data: unknown) {
    if (!validResourceReport(data, expected)) throw new Error(this.i18n.t("Errors.InvalidResourceReport"));
  }
  private publishReport(resource: Resource, data: Resource) {
    if (this.selected()?.["@id"] === resource["@id"])
      this.selected.update((current) => ({ ...current!, ...data }));
    this.rows.update((rows) =>
      rows.map((row) =>
        row["@id"] === resource["@id"] ? { ...row, ...data } : row,
      ),
    );
  }
  setSort(sort: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: "merge",
      queryParams: {
        sort,
        offset: null,
      },
    });
  }
  page(delta: number) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: "merge",
      queryParams: { offset: Math.max(0, this.offset() + delta * 50) },
    });
  }
  /** " · 0.0.1 · Published" after an artifact's name, from what the report says of it. */
  versionAndStatus(v: Resource): string {
    const status = this.status(v);
    const parts = [
      v["pav:version"] || this.i18n.t("Dashboard.Unversioned"),
      ...(status === "—" ? [] : [status]),
    ];
    return " · " + parts.join(" · ");
  }
  /**
   * Whether the artifact is the newest of its versions.
   *
   * The version history settles it when the report includes one, so the Status line
   * and the Latest entry cannot disagree; without a history, the report's own flag does.
   */
  isLatest(r: Resource): boolean {
    if (!r["pav:version"]) return false;
    return r.versions?.length ? !this.latestVersion(r) : r.isLatestVersion !== false;
  }
  /** The newest version when it is not this one; the report lists versions newest first. */
  latestVersion(r: Resource): Resource | undefined {
    const latest = r.versions?.[0];
    return latest && latest["@id"] !== r["@id"] ? latest : undefined;
  }
  /** What everyone may do with the artifact, when it is shared with everyone. */
  everyoneAccess(r: Resource): string | null {
    if (r.everybodyPermission === "read") return "Dashboard.EveryoneCanView";
    if (r.everybodyPermission === "write") return "Dashboard.EveryoneCanEdit";
    return null;
  }
  /**
   * The versions older than this one, newest first.
   *
   * The report lists the whole version history, newest first and including this
   * version, so the previous ones are those after it.
   */
  previousVersions(r: Resource): Resource[] {
    const versions = r.versions ?? [];
    const here = versions.findIndex((v) => v["@id"] === r["@id"]);
    return here < 0 ? [] : versions.slice(here + 1);
  }
  /** The version after this one, which the latest has none of; the report lists versions newest first. */
  nextVersion(r: Resource): Resource | undefined {
    const versions = r.versions ?? [];
    const here = versions.findIndex((v) => v["@id"] === r["@id"]);
    return here > 0 ? versions[here - 1] : undefined;
  }
  /** Whether the Info panel offers a preview of an artifact it names: one the user may read. */
  previewable(r: Resource): boolean {
    return (
      r.activeUserCanRead !== false &&
      r.resourceType !== "folder" &&
      Object.hasOwn(collections, r.resourceType)
    );
  }
  link(r: Resource, populate = false) {
    return resourceLink(
      r,
      this.api.config,
      this.folder,
      this.returnHere(r),
      populate,
    );
  }
  createLink(kind: string) {
    return (
      this.api.config.templateDesignerFrontend.replace(/\/$/, "") +
      "/" +
      kind +
      "/create?" +
      new URLSearchParams({
        folderId: resourceSelector(this.folder),
        returnTo: this.returnHere(),
      })
    );
  }
  openView(r: Resource) {
    return (
      this.api.config.openViewBase.replace(/\/$/, "") +
      "/" +
      collections[r.resourceType] +
      "/" +
      encodeURIComponent(resourcePathId(r["@id"]))
    );
  }
  // The resource's OpenView address, when a link to it is offered at all.
  publicLink(r: Resource): string | undefined {
    return offeredInOpenView(r) ? this.openView(r) : undefined;
  }
  async act(id: string, r: Resource) {
    this.menuTrigger?.focus();
    this.menu.set(null);
    this.error.set("");
    if (!this.actions(r).find((a) => a.id === id)?.enabled) return;
    try {
      if (id === "open" || id === "populate") {
        if (r.resourceType === "folder")
          void this.router.navigate(["/dashboard"], {
            queryParams: this.navigationQuery({ folderId: resourceSelector(r["@id"]) }),
          });
        else location.assign(this.link(r, id === "populate"));
        return;
      }
      if (id === "openview") {
        window.open(this.openView(r), "_blank", "noopener");
        return;
      }
      this.dialog.set({ action: id, resource: r });
    } catch (e) {
      this.fail(e);
    }
  }
  openNew(action: string) {
    if (!can(this.currentFolder(), "createInFolder")) return;
    document
      .querySelector<HTMLDetailsElement>(".new-menu")
      ?.removeAttribute("open");
    this.dialog.set({ action });
  }
  permissionsClosed(message?: string) {
    if (message) this.notice.set(message);
    this.dialog.set(null);
    void this.load();
  }
  saved() {
    this.dialog.set(null);
    this.notice.set(this.i18n.t("Common.Saved"));
    void this.load();
  }
}
