import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
} as Config;
describe("Angular Workspace", () => {
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
  it("renders only a table, Info/Version tabs, and the four workspace destinations", async () => {
    const f = await render();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll("table").length).toBe(1);
    expect(el.querySelectorAll(".destinations a").length).toBe(4);
    expect(
      [...el.querySelectorAll("[role=tab]")].map((e) => e.textContent?.trim()),
    ).toEqual(["Info", "Version"]);
    expect(el.textContent).not.toMatch(
      /Categories|Latest|Tile view|Filter by type/,
    );
  });
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
  it("exposes the original action set and gates it using the server capabilities", () => {
    const list = actions(template);
    expect(list.map((a) => a.id)).toEqual([
      "populate",
      "open",
      "share",
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
});
