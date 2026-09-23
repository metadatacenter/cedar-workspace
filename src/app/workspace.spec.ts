import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace, actions } from "./workspace";
import { Backend } from "./backend.service";
import { Config, Resource } from "./resource";
const folder: Resource = {
  "@id": "home",
  resourceType: "folder",
  "schema:name": "My workspace",
  currentUserPermissions: { capabilities: ["readResource", "createInFolder"] },
};
const template: Resource = {
  "@id": "template-id",
  resourceType: "template",
  "schema:name": "A template",
  currentUserPermissions: { capabilities: ["readResource"] },
};
const config = {
  resourceRestAPI: "https://api.example",
  templateDesignerFrontend: "https://designer.example",
  workspaceFrontend: "https://workspace.example",
  openViewBase: "https://openview.example",
} as Config;
describe("Angular Workspace", () => {
  afterEach(() => vi.unstubAllGlobals());
  let api: {
    init: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    report: ReturnType<typeof vi.fn>;
    profile: { homeFolderId: string };
    config: Config;
  };
  beforeEach(() => {
    api = {
      init: vi.fn().mockResolvedValue(true),
      request: vi.fn(async (path: string) => ({
        data:
          path.includes("/contents") || path.includes("/search")
            ? { resources: [template], totalCount: 1, pathInfo: [folder] }
            : folder,
      })),
      report: vi.fn().mockResolvedValue({
        data: {
          ...template,
          currentUserPermissions: {
            capabilities: ["readResource"],
            availableActions: ["populate"],
          },
        },
      }),
      profile: { homeFolderId: "home" },
      config,
    };
    TestBed.configureTestingModule({
      imports: [Workspace],
      providers: [provideRouter([]), { provide: Backend, useValue: api }],
    });
  });
  async function render() {
    const f = TestBed.createComponent(Workspace);
    f.detectChanges();
    await vi.waitFor(() =>
      expect(f.componentInstance.currentFolder()).toBeDefined(),
    );
    await f.whenStable();
    f.detectChanges();
    return f;
  }
  it("shows one friendly modified column and retains its timestamp for hover", async () => {
    const f = await render();
    const stamp = new Date(f.componentInstance.now() - 180_000).toISOString();
    f.componentInstance.rows.set([{ ...template, "pav:lastUpdatedOn": stamp }]);
    f.detectChanges();
    const table: HTMLTableElement = f.nativeElement.querySelector("table");
    expect(
      [...table.querySelectorAll("th")].map((th) => th.textContent?.trim()),
    ).toEqual(["Name", "Last modified", "Actions"]);
    const time = table.querySelector("time")!;
    expect(time.textContent?.trim()).toBe("3 minutes ago");
    expect(time.getAttribute("datetime")).toBe(stamp);
    expect(time.getAttribute("title")).toBe(stamp);
    const navigate = vi.spyOn(TestBed.inject(Router), "navigate");
    table
      .querySelectorAll("th button")[1]
      .dispatchEvent(new MouseEvent("click"));
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ sort: "lastUpdatedOnTS" }),
      }),
    );
  });
  it("renders the table and destinations with empty information until selection", async () => {
    const f = await render();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll("table").length).toBe(1);
    expect(el.querySelectorAll(".destinations a").length).toBe(4);
    expect(
      [...el.querySelectorAll("[role=tab]")].map((e) => e.textContent?.trim()),
    ).toEqual([]);
    expect(f.componentInstance.selected()).toBeUndefined();
    expect(el.querySelector(".information")?.textContent).toContain(
      "Select an item to see its details",
    );
    await f.componentInstance.select(template);
    await f.componentInstance.load();
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.selected()).toBeUndefined();
    expect(el.querySelector(".information h1")).toBeNull();
    expect(el.textContent).not.toMatch(
      /Categories|Tile view|Filter by type/,
    );
  });
  it.each(["folder", "instance", "template", "element", "field"] as const)(
    "shows Version only for versioned schema resources: %s",
    async (resourceType) => {
      const f = await render();
      const r: Resource = { ...template, resourceType };
      api.report.mockResolvedValue({ data: r });
      // Selecting another resource must also leave any previous Version view.
      f.componentInstance.tab = "version";
      await f.componentInstance.select(r);
      f.detectChanges();
      const tabs = [
        ...f.nativeElement.querySelectorAll('[role="tab"]'),
      ] as HTMLElement[];
      expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(
        resourceType === "folder" || resourceType === "instance"
          ? ["Info"]
          : ["Info", "Version"],
      );
      expect(tabs[0].getAttribute("aria-selected")).toBe("true");
      if (tabs.length === 2) {
        tabs[1].click();
        f.detectChanges();
        expect(tabs[1].getAttribute("aria-selected")).toBe("true");
      }
    },
  );
  it("hydrates Populate from the report even when listings omit available actions", async () => {
    const f = await render();
    expect(
      f.nativeElement.querySelector('[aria-label="Populate template"]'),
    ).not.toBeNull();
    expect(api.report).toHaveBeenCalledWith(template);
  });
  it("keeps the table while navigation and information panels collapse independently", async () => {
    const f = await render();
    (
      f.nativeElement.querySelector(
        '[aria-label="Collapse navigation"]',
      ) as HTMLElement
    ).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector(".destinations")).toBeNull();
    expect(f.nativeElement.querySelector("table")).not.toBeNull();
    (
      f.nativeElement.querySelector(
        '[aria-label="Collapse information"]',
      ) as HTMLElement
    ).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector("[role=tablist]")).toBeNull();
    expect(
      f.nativeElement.querySelector('[aria-label="Expand navigation"]'),
    ).not.toBeNull();
  });
  it("keeps row selection from disabling New Folder in the current folder", async () => {
    const f = await render();
    await f.componentInstance.select(template);
    f.detectChanges();
    expect(f.componentInstance.currentFolder()).toEqual(folder);
    expect(f.nativeElement.querySelector(".new-menu button").disabled).toBe(
      false,
    );
  });
  it("ignores late detail responses when a newer item is selected", async () => {
    const f = await render();
    let resolve!: (value: unknown) => void;
    api.report
      .mockReturnValueOnce(new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce({
        data: { ...template, "@id": "newer", "schema:name": "Newer" },
      });
    const old = f.componentInstance.select(template);
    await f.componentInstance.select({ ...template, "@id": "newer" });
    resolve({ data: template });
    await old;
    expect(f.componentInstance.selected()?.["@id"]).toBe("newer");
  });
  it("keeps listed rows when an optional template report fails", async () => {
    api.report.mockRejectedValue(new Error("Unavailable report"));
    const f = await render();
    expect(f.componentInstance.rows()).toEqual([template]);
    expect(f.componentInstance.error()).toBe("");
  });
  it("opens Permissions without changing the workspace route or its selected listing", async () => {
    const f = await render();
    const before = window.location.href;
    const rows = f.componentInstance.rows();
    await f.componentInstance.act("permissions", template);
    expect(f.componentInstance.dialog()).toEqual({
      action: "permissions",
      resource: template,
    });
    expect(window.location.href).toBe(before);
    expect(f.componentInstance.rows()).toBe(rows);
  });
  it("exposes the original action set and gates it using the server capabilities", () => {
    const list = actions(template);
    expect(list.find((a) => a.id === "permissions")).toEqual({
      id: "permissions",
      label: "Permissions…",
      enabled: true,
    });
    expect(list.map((a) => a.id)).toEqual([
      "populate",
      "open",
      "permissions",
      "copy",
      "move",
      "rename",
      "folder-id",
      "parent-id",
      "json",
      "yaml",
      "yamlc",
      "publish",
      "draft",
      "delete",
      "datacite",
      "make-open",
      "make-not-open",
      "openview",
    ]);
    expect(list.find((a) => a.id === "delete")?.enabled).toBe(false);
    expect(list.find((a) => a.id === "open")?.enabled).toBe(true);
  });
  for (const resourceType of [
    "template",
    "element",
    "field",
    "instance",
    "folder",
  ] as const) {
    for (const editable of [false, true]) {
      it(`renders the legacy menu for ${editable ? "editable" : "read-only"} ${resourceType} resources`, async () => {
        vi.stubGlobal("dataciteEnabled", false);
        vi.stubGlobal("makeOpenEnabled", true);
        const f = await render();
        const resource: Resource = {
          ...template,
          resourceType,
          pathInfo: [folder],
          currentUserPermissions: {
            capabilities: [
              "readResource",
              ...(editable
                ? [
                    "copyFromResource",
                    "moveResource",
                    "updateResource",
                    "deleteResource",
                  ]
                : []),
            ],
            availableActions: editable
              ? ["populate", "publish", "enableOpenView"]
              : [],
          },
        };
        api.report.mockResolvedValue({ data: resource });
        f.componentInstance.rows.set([resource]);
        f.detectChanges();
        (
          f.nativeElement.querySelector(
            '[aria-label="Actions for A template"]',
          ) as HTMLButtonElement
        ).click();
        await f.whenStable();
        f.detectChanges();
        const buttons = [
          ...(
            f.nativeElement as HTMLElement
          ).querySelectorAll<HTMLButtonElement>(".resource-menu button"),
        ];
        expect(buttons.map((b) => b.textContent?.trim())).toEqual([
          "Populate",
          "Open",
          "Permissions…",
          "Copy",
          "Move",
          "Rename",
          "Copy Folder ID",
          "Copy Parent Folder ID",
          "Download JSON",
          "Download YAML",
          "Download Compact YAML",
          ...(resourceType === "instance" ? [] : ["Publish", "Create Draft"]),
          "Delete",
          "DataCite wizard",
          "Make Open",
          "Make Not Open",
          "Open in OpenView",
        ]);
        const disabled = (name: string) =>
          buttons.find((b) => b.textContent?.trim() === name)!.disabled;
        expect(disabled("Permissions…")).toBe(false);
        expect(disabled("Copy")).toBe(!editable || resourceType === "folder");
        expect(disabled("Populate")).toBe(
          !editable || resourceType !== "template",
        );
        expect(disabled("Delete")).toBe(!editable);
        expect(disabled("Download JSON")).toBe(resourceType === "folder");
        expect(disabled("Copy Folder ID")).toBe(resourceType !== "folder");
        expect(disabled("DataCite wizard")).toBe(true);
        expect(disabled("Make Open")).toBe(!editable);
        const act = vi.spyOn(f.componentInstance, "act");
        buttons
          .find((b) => b.textContent?.trim() === "DataCite wizard")!
          .click();
        expect(act).not.toHaveBeenCalled();
      });
    }
  }
  it("shows published lifecycle actions from the fresh report and leaves disabled features visible", async () => {
    vi.stubGlobal("makeOpenEnabled", false);
    vi.stubGlobal("dataciteEnabled", false);
    const f = await render();
    api.report.mockResolvedValue({
      data: {
        ...template,
        isOpen: true,
        currentUserPermissions: {
          capabilities: ["readResource"],
          availableActions: ["createDraft", "disableOpenView"],
        },
      },
    });
    (
      f.nativeElement.querySelector(
        '[aria-label="Actions for A template"]',
      ) as HTMLButtonElement
    ).click();
    await f.whenStable();
    f.detectChanges();
    const button = (label: string) =>
      [
        ...(f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          ".resource-menu button",
        ),
      ].find((b) => b.textContent?.trim() === label)!;
    expect(button("Create Draft").disabled).toBe(false);
    for (const label of [
      "Publish",
      "Make Open",
      "Make Not Open",
      "Open in OpenView",
      "DataCite wizard",
    ])
      expect(button(label).disabled).toBe(true);
    window.dispatchEvent(new Event("resize"));
    f.detectChanges();
    expect(f.nativeElement.querySelector(".resource-menu")).toBeNull();
  });
});
