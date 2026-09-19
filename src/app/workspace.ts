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
} from "@angular/core";
import { dateFormat } from "./date-format";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
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
export interface Action {
  id: string;
  label: string;
  enabled: boolean;
}
export function actions(r: Resource): Action[] {
  const cap = (key: string) => can(r, key);
  return [
    {
      id: "populate",
      label: "Populate",
      enabled: r.resourceType === "template" && cap("populate"),
    },
    { id: "open", label: "Open", enabled: cap("readResource") },
    { id: "permissions", label: "Permissions…", enabled: cap("readResource") },
    {
      id: "copy",
      label: "Copy",
      enabled: r.resourceType !== "folder" && cap("copyFromResource"),
    },
    { id: "move", label: "Move", enabled: cap("moveResource") },
    { id: "rename", label: "Rename", enabled: cap("updateResource") },
    {
      id: "folder-id",
      label: "Copy Folder ID",
      enabled: r.resourceType === "folder",
    },
    {
      id: "parent-id",
      label: "Copy Parent Folder ID",
      enabled: !!r.pathInfo?.length,
    },
    ...["json", "yaml", "yamlc"].map((id) => ({
      id,
      label:
        "Download " + { json: "JSON", yaml: "YAML", yamlc: "Compact YAML" }[id],
      enabled: r.resourceType !== "folder" && cap("readResource"),
    })),
    ...(r.resourceType === "instance"
      ? []
      : [
          { id: "publish", label: "Publish", enabled: cap("publish") },
          { id: "draft", label: "Create Draft", enabled: cap("createDraft") },
        ]),
    { id: "delete", label: "Delete", enabled: cap("deleteResource") },
    {
      id: "datacite",
      label: "DataCite wizard",
      enabled:
        window.dataciteEnabled !== false &&
        ["template", "instance"].includes(r.resourceType),
    },
    {
      id: "make-open",
      label: "Make Open",
      enabled: window.makeOpenEnabled !== false && cap("enableOpenView"),
    },
    {
      id: "make-not-open",
      label: "Make Not Open",
      enabled: window.makeOpenEnabled !== false && cap("disableOpenView"),
    },
    {
      id: "openview",
      label: "Open in OpenView",
      enabled: window.makeOpenEnabled !== false && !!r.isOpen,
    },
  ];
}
@Component({
  selector: "cedar-workspace-page",
  imports: [
    Toast,
    FormsModule,
    DatePipe,
    RouterLink,
    ResourceDialog,
    PermissionsDialog,
    Icon,
  ],
  templateUrl: "./workspace.html",
})
export class Workspace {
  readonly cedarVersion = window.cedarVersion || "unknown";
  get preferredDateFormat() {
    return dateFormat(this.api.profile?.uiPreferences?.preferredDateFormat);
  }
  readonly api = inject(Backend);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy = inject(DestroyRef);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private injector = inject(Injector);
  readonly title = title;
  readonly can = can;
  readonly actions = actions;
  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly rows = signal<Resource[]>([]);
  readonly path = signal<Resource[]>([]);
  readonly currentFolder = signal<Resource | undefined>(undefined);
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
    void this.start();
    this.destroy.onDestroy(() => {
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
  async load() {
    const read = ++this.listRead;
    this.detailRead++;
    this.loading.set(true);
    this.error.set("");
    this.selected.set(undefined);
    this.currentFolder.set(undefined);
    this.path.set([]);
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
      const detailRead = this.detailRead;
      void this.loadFolder(read, detailRead);
      // Listings omit lifecycle actions. Enrich template links without blocking the table.
      void this.loadTemplateActions(data.resources, read);
    } catch (e) {
      if (read === this.listRead) {
        this.rows.set([]);
        this.fail(e);
      }
    } finally {
      if (read === this.listRead) this.loading.set(false);
    }
  }
  private async loadFolder(read: number, detailRead: number) {
    try {
      const { data } = await this.api.request<Resource>(
        "/folders/" + encodeURIComponent(this.folder),
      );
      if (read !== this.listRead) return;
      this.currentFolder.set(data);
      if (
        detailRead === this.detailRead &&
        !this.params.has("search") &&
        !this.params.has("sharing") &&
        !this.params.has("viewMode")
      )
        this.selected.set(data);
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
  async copyId(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.notice.set("ID copied.");
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
  changeSort(field: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: "merge",
      queryParams: {
        sort: this.sort === field ? "-" + field : field,
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
    if (!actions(r).find((a) => a.id === id)?.enabled) return;
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
          throw new Error(
            "Make this artifact open before starting the DataCite wizard.",
          );
        if (
          r.resourceType === "template" &&
          r["bibo:status"] !== "bibo:published"
        )
          throw new Error(
            "Publish this template before starting the DataCite wizard.",
          );
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
        this.notice.set("ID copied.");
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
    this.notice.set("Saved.");
    void this.load();
  }
}
