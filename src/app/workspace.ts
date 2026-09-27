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
} from "@angular/core";
import { FriendlyDatePipe } from "./friendly-date";
import { TitleCasePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Backend } from "./backend.service";
import {
  Resource,
  Listing,
  title,
  can,
  listingPath,
  resourceLink,
  collections,
} from "./resource";
import { Icon } from "./icon";
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
    {
      id: "folder-id",
      label: label("ResourceActions.CopyFolderId"),
      enabled: r.resourceType === "folder",
    },
    {
      id: "parent-id",
      label: label("ResourceActions.CopyParentFolderId"),
      enabled: !!r.pathInfo?.length,
    },
    ...(
      [
        ["json", "ResourceActions.DownloadJson"],
        ["yaml", "ResourceActions.DownloadYaml"],
        ["yamlc", "ResourceActions.DownloadCompactYaml"],
      ] as const
    ).map(([id, key]) => ({
      id,
      label: label(key),
      enabled: r.resourceType !== "folder" && cap("readResource"),
    })),
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
      id: "datacite",
      label: label("ResourceActions.DataCite"),
      enabled:
        window.dataciteEnabled !== false &&
        ["template", "instance"].includes(r.resourceType),
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
      enabled: window.makeOpenEnabled !== false && !!r.isOpen,
    },
  ];
}
@Component({
  selector: "cedar-workspace-page",
  imports: [
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
    PermissionsDialog,
    Icon,
    TranslatePipe,
  ],
  templateUrl: "./workspace.html",
})
export class Workspace {
  private readonly i18n = inject(I18n);
  readonly cedarVersion = window.cedarVersion || this.i18n.t("Common.Unknown");
  readonly api = inject(Backend);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private injector = inject(Injector);
  readonly title = (r: Resource) => title(r, this.i18n.t("Common.Untitled"));
  readonly can = can;
  readonly actions = (r: Resource) => actions(r, this.i18n);
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
  readonly grid = signal(false);
  readonly selectionIds = signal<string[]>([]);
  readonly selection = computed(() =>
    this.rows().filter((r) => this.selectionIds().includes(r["@id"])),
  );
  readonly moving = signal(false);
  readonly cutItems = signal<Resource[]>([]);
  readonly moveDialog = signal<Resource[] | null>(null);
  readonly dropTarget = signal("");
  private dragging: Resource[] = [];
  private moves = inject(ResourceMoves);
  readonly canMoveSelection = computed(
    () =>
      this.selection().length > 0 &&
      this.selection().every((r) => can(r, "moveResource")),
  );
  readonly selected = signal<Resource | undefined>(undefined);
  readonly instances = signal<Resource[]>([]);
  readonly instanceTotal = signal(0);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly left = signal(true);
  readonly right = signal(true);
  readonly dialog = signal<{ action: string; resource?: Resource } | null>(
    null,
  );
  readonly menu = signal<string | null>(null);
  tab = "info";
  search = "";
  sort = "name";
  folder = "";
  params = new URLSearchParams();
  private listRead = 0;
  private detailRead = 0;
  constructor() {
    const clock = setInterval(() => this.now.set(Date.now()), 60_000);
    void this.start();
    this.destroy.onDestroy(() => {
      clearInterval(clock);
      this.listRead++;
      this.detailRead++;
    });
  }
  async start() {
    try {
      if (!(await this.api.init())) return;
      this.ready.set(true);
      this.route.queryParamMap
        .pipe(takeUntilDestroyed(this.destroy))
        .subscribe((map) => {
          this.params = new URLSearchParams();
          map.keys.forEach((key) => this.params.set(key, map.get(key)!));
          this.search = map.get("search") || "";
          this.folder = map.get("folderId") || this.api.profile.homeFolderId;
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
    const read = ++this.listRead;
    this.detailRead++;
    this.loading.set(true);
    this.refreshing.set(refresh);
    this.error.set("");
    this.selected.set(undefined);
    this.selectionIds.set([]);
    if (!refresh) {
      this.currentFolder.set(undefined);
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
      if (read !== this.listRead) return;
      this.rows.set(data.resources);
      this.total.set(data.totalCount);
      this.path.set(data.pathInfo || []);
      void this.loadFolder(read);
      // Listings omit lifecycle actions. Enrich template links without blocking the table.
      void this.loadTemplateActions(data.resources, read);
    } catch (e) {
      if (read === this.listRead) {
        if (!refresh) this.rows.set([]);
        this.fail(e);
      }
    } finally {
      if (read === this.listRead) {
        this.loading.set(false);
        this.refreshing.set(false);
      }
    }
  }
  private async loadFolder(read: number) {
    try {
      const { data } = await this.api.request<Resource>(
        "/folders/" + encodeURIComponent(this.folder),
      );
      if (read !== this.listRead) return;
      this.currentFolder.set(data);
    } catch (e) {
      if (read === this.listRead) this.fail(e);
    }
  }
  private async loadTemplateActions(resources: Resource[], read: number) {
    const templates = resources.filter((r) => r.resourceType === "template");
    for (let i = 0; i < templates.length; i += 4) {
      if (read !== this.listRead) return;
      const reports = await Promise.allSettled(
        templates.slice(i, i + 4).map((r) => this.api.report(r)),
      );
      if (read !== this.listRead) return;
      reports.forEach((report, index) => {
        if (report.status === "fulfilled")
          this.rows.update((rows) =>
            rows.map((r) =>
              r["@id"] === templates[i + index]["@id"]
                ? { ...r, ...report.value.data }
                : r,
            ),
          );
      });
    }
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
  async select(r: Resource, reveal = true) {
    const read = ++this.detailRead;
    this.selectionIds.set([r["@id"]]);
    this.selected.set(r);
    this.instances.set([]);
    this.instanceTotal.set(0);
    this.tab = "info";
    if (reveal) this.right.set(true);
    try {
      const { data } = await this.api.report(r);
      if (read === this.detailRead) {
        this.selected.set({ ...r, ...data });
        if (r.resourceType === "template") void this.loadInstances(r, read);
        this.rows.update((rows) =>
          rows.map((row) =>
            row["@id"] === r["@id"] ? { ...row, ...data } : row,
          ),
        );
      }
    } catch (e) {
      if (read === this.detailRead) this.fail(e);
    }
  }
  setSelection(ids: string[]) {
    if (this.moving()) return;
    this.selectionIds.set(ids);
    if (ids.length === 1) {
      const r = this.rows().find((r) => r["@id"] === ids[0]);
      if (r) void this.select(r);
    } else {
      this.detailRead++;
      this.selected.set(undefined);
      if (ids.length) this.right.set(true);
    }
  }
  openItem(id: string) {
    const r = this.rows().find((r) => r["@id"] === id);
    if (r) void this.act("open", r);
  }
  startDrag(r: Resource) {
    this.menu.set(null);
    if (!this.selectionIds().includes(r["@id"])) this.setSelection([r["@id"]]);
    this.dragging = [...this.selection()];
  }
  dragMove(event: CdkDragMove) {
    const element = document
      .elementFromPoint(
        event.pointerPosition.x - window.scrollX,
        event.pointerPosition.y - window.scrollY,
      )
      ?.closest<HTMLElement>("[data-drop-id]");
    const id = element?.dataset["dropId"];
    const target = [...this.rows(), ...this.path()].find(
      (r) => r["@id"] === id,
    );
    this.dropTarget.set(
      target &&
        validMoveShape(this.dragging, target) &&
        (can(target, "moveIntoFolder") ||
          this.path().some((p) => p["@id"] === id)) &&
        id !== this.folder
        ? id!
        : "",
    );
  }
  endDrag(event: CdkDragEnd, explorer: ExplorerSelection) {
    const target = this.dropTarget(),
      resources = this.dragging;
    this.dropTarget.set("");
    this.dragging = [];
    event.source.reset();
    explorer.ignoreClick();
    if (target) void this.moveItems(resources, target);
  }
  cutSelection() {
    if (this.canMoveSelection()) this.cutItems.set([...this.selection()]);
  }
  async moveItems(resources: Resource[], target: string) {
    if (this.moving() || !resources.length) return;
    this.moving.set(true);
    this.error.set("");
    try {
      const result = await this.moves.move(resources, target);
      this.cutItems.update((items) =>
        items.filter((r) => !result.moved.includes(r["@id"])),
      );
      await this.load(true);
      this.selectionIds.set(
        result.failed
          .map((f) => f.resource["@id"])
          .filter((id) => this.rows().some((r) => r["@id"] === id)),
      );
      this.notice.set(
        this.i18n.t("Explorer.Moved", { count: result.moved.length }),
      );
      if (result.failed.length)
        this.error.set(
          result.failed
            .map((f) => this.title(f.resource) + ": " + f.message)
            .join("; "),
        );
    } catch (e) {
      this.fail(e);
    } finally {
      this.moving.set(false);
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
  private async loadInstances(r: Resource, read: number) {
    try {
      const { data } = await this.api.request<Listing>(
        "/search?is_based_on=" +
          encodeURIComponent(r["@id"]) +
          "&limit=50&offset=0",
      );
      if (read === this.detailRead) {
        this.instances.set(data.resources);
        this.instanceTotal.set(data.totalCount);
      }
    } catch (e) {
      if (read === this.detailRead) this.fail(e);
    }
  }
  parentId(r: Resource): string | undefined {
    return r.pathInfo?.filter((p) => p["@id"] !== r["@id"]).at(-1)?.["@id"];
  }
  async copyId(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.notice.set(this.i18n.t("Common.IdCopied"));
    } catch (e) {
      this.fail(e);
    }
  }
  async toggleMenu(r: Resource, event: MouseEvent) {
    if (this.menu() === r["@id"]) {
      this.menu.set(null);
      return;
    }
    this.menuTrigger = event.currentTarget as HTMLElement;
    const rect = this.menuTrigger.getBoundingClientRect();
    this.menuLeft.set(
      Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)),
    );
    this.menuTop.set(8);
    this.menu.set(r["@id"]);
    afterNextRender(
      () => {
        if (this.menu() !== r["@id"]) return;
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
      this.rows.update((rows) =>
        rows.map((row) =>
          row["@id"] === r["@id"] ? { ...row, ...data } : row,
        ),
      );
    } catch (e) {
      this.fail(e);
    }
  }
  submitSearch() {
    void this.router.navigate(["/dashboard"], {
      queryParams: this.search.trim()
        ? { search: this.search.trim() }
        : { folderId: this.folder },
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
    if (this.selected()?.["@id"] === resource["@id"])
      this.selected.update((current) => ({ ...current!, ...resource }));
    this.rows.update((rows) =>
      rows.map((row) =>
        row["@id"] === resource["@id"] ? { ...row, ...resource } : row,
      ),
    );
    this.notice.set(this.i18n.t("Dashboard.DescriptionSaved"));
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
  link(r: Resource, populate = false) {
    return resourceLink(
      r,
      this.api.config,
      this.folder,
      location.href,
      populate,
    );
  }
  createLink(kind: string) {
    return (
      this.api.config.templateDesignerFrontend.replace(/\/$/, "") +
      "/" +
      kind +
      "/create?" +
      new URLSearchParams({ folderId: this.folder, returnTo: location.href })
    );
  }
  openView(r: Resource) {
    return (
      this.api.config.openViewBase.replace(/\/$/, "") +
      "/" +
      collections[r.resourceType] +
      "/" +
      encodeURIComponent(r["@id"])
    );
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
            queryParams: { folderId: r["@id"] },
          });
        else location.assign(this.link(r, id === "populate"));
        return;
      }
      if (id === "openview") {
        window.open(this.openView(r), "_blank", "noopener");
        return;
      }
      if (id === "datacite") {
        if (!r.isOpen)
          throw new Error(this.i18n.t("Dashboard.OpenBeforeDataCite"));
        if (
          r.resourceType === "template" &&
          r["bibo:status"] !== "bibo:published"
        )
          throw new Error(this.i18n.t("Dashboard.PublishBeforeDataCite"));
        window.open(
          this.api.config.dataciteDOIBase + "/" + encodeURIComponent(r["@id"]),
          "_blank",
          "noopener",
        );
        return;
      }
      if (id === "folder-id" || id === "parent-id") {
        const path = r.pathInfo || [];
        const parent = path.filter((p) => p["@id"] !== r["@id"]).at(-1);
        await navigator.clipboard.writeText(
          id === "folder-id" ? r["@id"] : parent?.["@id"] || this.folder,
        );
        this.notice.set(this.i18n.t("Common.IdCopied"));
        return;
      }
      if (["json", "yaml", "yamlc"].includes(id)) {
        await this.api.download(r, id);
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
