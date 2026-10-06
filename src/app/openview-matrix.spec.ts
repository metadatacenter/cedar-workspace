import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace, actions } from "./workspace";
import { I18n } from "./i18n";
import { Backend } from "./backend.service";
import { Config, Resource } from "./resource";

/**
 * Whether a resource has an OpenView link, asked by the row, the actions menu and the Info panel. The
 * answer depends on whether the deployment runs OpenView, whether the resource was made open, what the
 * listing says of the folders above it, and what its path says once read. All three surfaces must give
 * the same answer and the same address.
 */
const config = {
  resourceRestAPI: "https://api.example",
  templateDesignerFrontend: "https://designer.example",
  workspaceFrontend: "https://workspace.example",
  openViewBase: "https://openview.example",
} as Config;
const home: Resource = {
  "@id": "home",
  resourceType: "folder",
  "schema:name": "Home",
  currentUserPermissions: { capabilities: ["readResource", "createInFolder"] },
};
const above = (id: string, isOpen: boolean): Resource => ({ "@id": id, resourceType: "folder", "schema:name": id, isOpen });
// The folders between the home folder and the resource, once its path has been read.
const PATHS: Record<string, Resource[] | undefined> = {
  unread: undefined,
  "no open folder": [above("closed", false)],
  "one open folder": [above("open", true)],
  "two open folders": [above("outer", true), above("inner", true)],
};

const cases: [boolean | undefined, Resource["resourceType"], boolean, boolean, string][] = [];
for (const deployment of [true, false, undefined])
  for (const kind of ["template", "folder"] as const)
    for (const isOpen of [false, true])
      for (const isOpenImplicitly of [false, true])
        for (const path of Object.keys(PATHS)) cases.push([deployment, kind, isOpen, isOpenImplicitly, path]);

describe("OpenView across the row, the menu and the Info panel", () => {
  afterEach(() => vi.unstubAllGlobals());
  let api: Record<string, unknown>;
  let row: Resource;
  beforeEach(() => {
    api = {
      init: vi.fn().mockResolvedValue(true),
      request: vi.fn(async (path: string) => ({
        data: path.includes("/contents") || path.includes("/search")
          ? { resources: [row], totalCount: 1, pathInfo: [home] }
          : home,
      })),
      report: vi.fn(),
      profile: { homeFolderId: "home" },
      config,
    };
    TestBed.configureTestingModule({
      imports: [Workspace],
      providers: [provideRouter([]), { provide: Backend, useValue: api }],
    });
  });

  it.each(cases)(
    "deployment %s, %s, made open %s, listed as inside an open folder %s, path %s",
    async (deployment, kind, isOpen, isOpenImplicitly, path) => {
      vi.stubGlobal("makeOpenEnabled", deployment);
      row = {
        "@id": "subject",
        resourceType: kind,
        "schema:name": "Subject",
        isOpen,
        isOpenImplicitly,
        currentUserPermissions: { capabilities: ["readResource"] },
      };
      const folders = PATHS[path];
      (api.report as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { ...row, ...(folders ? { pathInfo: [home, ...folders, row] } : {}) },
      });
      const f = TestBed.createComponent(Workspace);
      f.detectChanges();
      await vi.waitFor(() => expect(f.componentInstance.currentFolder()).toBeDefined());
      await f.whenStable();
      await f.componentInstance.select(row);
      f.detectChanges();

      const expected =
        deployment !== false && (isOpen || (folders ? folders.some((p) => p.isOpen) : isOpenImplicitly));
      const address = `https://openview.example/${kind === "folder" ? "folders" : "templates"}/subject`;
      const el = f.nativeElement as HTMLElement;
      const rowLink = el.querySelector<HTMLAnchorElement>(`[data-resource-id="subject"] a[href^="https://openview.example/"]`);
      const panelLink = el.querySelector<HTMLAnchorElement>(".information .open-view a");
      const menu = actions(f.componentInstance.selected()!, TestBed.inject(I18n)).find((a) => a.id === "openview");
      expect({ row: !!rowLink, panel: !!panelLink, menu: !!menu?.enabled }).toEqual({
        row: expected,
        panel: expected,
        menu: expected,
      });
      if (expected) {
        expect(rowLink!.getAttribute("href")).toBe(address);
        expect(panelLink!.getAttribute("href")).toBe(address);
        expect(f.componentInstance.publicLink(f.componentInstance.selected()!)).toBe(address);
      }
    },
  );
});
