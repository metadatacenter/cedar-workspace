import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace, actions } from "./workspace";
import { I18n } from "./i18n";
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
    profile: { homeFolderId: string; "@id"?: string };
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
  it("identifies the current creator and modifier by ID, not display name", async () => {
    api.profile["@id"] = "https://metadatacenter.org/users/me";
    const f = await render();
    const resource: Resource = {
      ...template,
      "pav:createdBy": api.profile["@id"],
      "oslc:modifiedBy": "https://metadatacenter.org/users/other",
      createdByUserName: "Same Name",
      lastUpdatedByUserName: "Same Name",
    };
    f.componentInstance.selected.set(resource);
    f.detectChanges();
    const bylines = () =>
      [...(f.nativeElement as HTMLElement).querySelectorAll(".information dd small")]
        .map((el) => el.textContent?.trim());
    expect(bylines()).toEqual(["by you", "by Same Name"]);
    f.componentInstance.selected.set({
      ...resource,
      "oslc:modifiedBy": api.profile["@id"],
      lastUpdatedByUserName: undefined,
    });
    f.detectChanges();
    expect(bylines()).toEqual(["by you", "by you"]);
    expect(f.componentInstance.attribution(undefined, "Same Name")).toBe("by Same Name");
    expect(f.componentInstance.attribution()).toBe("");
  });
  it("shows you for the current owner while preserving other and unknown owners", async () => {
    api.profile["@id"] = "https://metadatacenter.org/users/me";
    const f = await render();
    for (const [ownedBy, ownedByUserName, expected] of [
      [api.profile["@id"], "Same Name", "you"],
      [api.profile["@id"], undefined, "you"],
      ["https://metadatacenter.org/users/other", "Same Name", "Same Name"],
      [undefined, "Same Name", "Same Name"],
      [undefined, undefined, "—"],
    ]) {
      f.componentInstance.selected.set({ ...template, ownedBy, ownedByUserName });
      f.detectChanges();
      const label = [...(f.nativeElement as HTMLElement).querySelectorAll(".information dt")]
        .find((el) => el.textContent?.trim() === "Owner");
      expect(label?.nextElementSibling?.textContent?.trim()).toBe(expected);
    }
  });
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
    expect(time.getAttribute("data-cedar-help")).toBe(stamp);
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
  it("lists version and status after Last modified, blank for instances and folders", async () => {
    const f = await render();
    f.componentInstance.grid.set(false);
    f.componentInstance.rows.set([
      { ...template, "@id": "t", "pav:version": "1.2.0", "bibo:status": "bibo:published" },
      { ...template, "@id": "e", resourceType: "element" },
      { ...template, "@id": "i", resourceType: "instance", "pav:version": "1.0.0" },
      { ...folder, "@id": "f" },
    ]);
    f.detectChanges();
    const table: HTMLTableElement = f.nativeElement.querySelector("table");
    expect(
      [...table.querySelectorAll("th")].map((th) => th.textContent?.trim()),
    ).toEqual(["Name", "Last modified", "Version", "Actions"]);
    expect(
      [...table.querySelectorAll("tbody tr")].map((tr) =>
        tr.querySelectorAll("td")[2].textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toEqual(["1.2.0 · Published", "Unversioned · —", "", ""]);
    // The grid shows version and status on each card instead.
    f.componentInstance.grid.set(true);
    f.detectChanges();
    expect(table.querySelectorAll(".version-column, .explorer-version").length).toBe(0);
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
    expect(el.textContent).not.toMatch(/Categories|Tile view|Filter by type/);
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
          ? ["Details"]
          : ["Details", "Version"],
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
  // OpenView serves a resource made open and anything inside an open folder. The
  // listing says which through isOpen and isOpenImplicitly.
  for (const [label, state, offered] of [
    ["made open", { isOpen: true }, true],
    ["inside an open folder", { isOpenImplicitly: true }, true],
    ["neither made open nor inside an open folder", {}, false],
  ] as const) {
    it(`${offered ? "offers" : "does not offer"} OpenView for a resource ${label}`, async () => {
      const listed: Resource = { ...template, ...state };
      api.request.mockImplementation(async (path: string) => ({
        data:
          path.includes("/contents") || path.includes("/search")
            ? { resources: [listed], totalCount: 1, pathInfo: [folder] }
            : folder,
      }));
      const f = await render();
      const link = (f.nativeElement as HTMLElement).querySelector(
        'a[href^="https://openview.example/"]',
      );
      expect(link !== null).toBe(offered);
      expect(
        actions(listed, TestBed.inject(I18n)).find((a) => a.id === "openview")
          ?.enabled,
      ).toBe(offered);
    });
  }
  // The information panel decides by the resource's path once it has one, so a
  // stale listing flag neither shows the link nor hides it.
  describe("the information panel's OpenView link", () => {
    const uuid = "0f1e2d3c-4b5a-4968-8776-655443322110";
    const artifact: Resource = {
      ...template,
      "@id": `https://repo.metadatacenter.orgx/templates/${uuid}`,
    };
    const openFolder: Resource = {
      "@id": "shared",
      resourceType: "folder",
      "schema:name": "Shared",
      isOpen: true,
    };
    const closedFolder: Resource = { ...openFolder, isOpen: false };
    const headings = (f: { nativeElement: HTMLElement }) =>
      [...f.nativeElement.querySelectorAll(".info-section .description-heading")].map(
        (h) => h.textContent?.trim(),
      );
    const cases: [string, Resource, boolean][] = [
      ["made open", { ...artifact, isOpen: true, pathInfo: [folder, artifact] }, true],
      [
        "inside an open folder",
        { ...artifact, isOpenImplicitly: true, pathInfo: [folder, openFolder, artifact] },
        true,
      ],
      [
        "whose listing says a folder above is open when its path says none is",
        { ...artifact, isOpenImplicitly: true, pathInfo: [folder, closedFolder, artifact] },
        false,
      ],
      ["neither made open nor inside an open folder", { ...artifact, pathInfo: [folder, artifact] }, false],
    ];
    for (const [label, selected, offered] of cases) {
      it(`${offered ? "follows" : "is absent from"} the Identifier for a resource ${label}`, async () => {
        const f = await render();
        f.componentInstance.selected.set(selected);
        f.detectChanges();
        const shown = headings(f);
        if (!offered) {
          expect(shown).not.toContain("OpenView");
          return;
        }
        expect(shown[shown.indexOf("Identifier") + 1]).toBe("OpenView");
        const link = (f.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(".open-view a")!;
        // The compact typed address, not the full IRI.
        expect(link.getAttribute("href")).toBe(`https://openview.example/templates/${uuid}`);
        expect(link.textContent?.trim()).toBe(link.getAttribute("href"));
        expect(link.target).toBe("_blank");
        expect(link.rel).toBe("noopener");
      });
    }
    it("is absent where the deployment does not run OpenView", async () => {
      vi.stubGlobal("makeOpenEnabled", false);
      const f = await render();
      f.componentInstance.selected.set({ ...artifact, isOpen: true, pathInfo: [folder, artifact] });
      f.detectChanges();
      expect(headings(f)).not.toContain("OpenView");
    });
    it("copies the link and says a link was copied", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      // jsdom has no clipboard, and replacing navigator wholesale loses its prototype.
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      try {
        const f = await render();
        f.componentInstance.selected.set({ ...artifact, isOpen: true, pathInfo: [folder, artifact] });
        f.detectChanges();
        const copy = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
          ".open-view .copy-icon",
        )!;
        expect(copy.getAttribute("aria-label")).toBe("Copy OpenView link");
        copy.click();
        await vi.waitFor(() =>
          expect(f.componentInstance.notice()).toBe("Link copied."),
        );
        expect(writeText).toHaveBeenCalledWith(`https://openview.example/templates/${uuid}`);
      } finally {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
    });
  });
  it("exposes the artifact action set and gates it using the server capabilities", () => {
    const list = actions(template, TestBed.inject(I18n));
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
      "publish",
      "draft",
      "delete",
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
      it(`renders applicable menu actions for ${editable ? "editable" : "read-only"} ${resourceType} resources`, async () => {
        vi.stubGlobal("dataciteEnabled", true);
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
          ...(resourceType === "template" ? ["Populate"] : []),
          "Open",
          "Permissions…",
          ...(resourceType !== "folder" ? ["Copy"] : []),
          "Move",
          "Rename",
          ...(["folder", "instance"].includes(resourceType)
            ? []
            : ["Publish", "Create Draft"]),
          "Delete",
          "Enable Openview",
          "Disable Openview",
          "Open in OpenView",
        ]);
        const disabled = (name: string) =>
          buttons.find((b) => b.textContent?.trim() === name)!.disabled;
        expect(disabled("Permissions…")).toBe(false);
        if (resourceType !== "folder") expect(disabled("Copy")).toBe(!editable);
        if (resourceType === "template")
          expect(disabled("Populate")).toBe(!editable);
        expect(disabled("Delete")).toBe(!editable);
        expect(disabled("Enable Openview")).toBe(!editable);
        const act = vi.spyOn(f.componentInstance, "act");
        buttons
          .find((b) => b.textContent?.trim() === "Disable Openview")
          ?.click();
        expect(act).not.toHaveBeenCalled();
      });
    }
  }
  it("shows published lifecycle actions from the fresh report and leaves disabled features visible", async () => {
    vi.stubGlobal("makeOpenEnabled", false);
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
      "Enable Openview",
      "Disable Openview",
      "Open in OpenView",
    ])
      expect(button(label).disabled).toBe(true);
    window.dispatchEvent(new Event("resize"));
    f.detectChanges();
    expect(f.nativeElement.querySelector(".resource-menu")).toBeNull();
  });
});
