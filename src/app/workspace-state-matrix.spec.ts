import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { ResourceDialog } from "./resource-dialog";
import { DescriptionEditor } from "./description-editor";
import { Workspace } from "./workspace";
import { Resource } from "./resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const resource = (
  id: string,
  type: Resource["resourceType"] = "element",
): Resource => ({
  "@id": id,
  resourceType: type,
  "schema:name": id,
  "schema:description": id + " description",
  currentUserPermissions: {
    capabilities: [
      "readResource",
      "updateResource",
      "copyIntoFolder",
      "createInFolder",
    ],
  },
});
const home = resource("home", "folder");
const reply = (id: string) => ({ data: resource(id), etag: '"' + id + '"' });

for (const refresh of [false, true]) {
  for (const bad of [
    null,
    {},
    { resources: null, totalCount: 0 },
    { resources: [resource("same"), resource("same")], totalCount: 2 },
    { resources: [{ "@id": "bad", resourceType: "unknown" }], totalCount: 1 },
    { resources: [resource("same")], totalCount: -1 },
    { resources: [], totalCount: 0, pathInfo: {} },
  ]) {
    it(`rejects a malformed listing and recovers without stale selection: refresh=${refresh}, ${JSON.stringify(bad)}`, async () => {
      let listing: unknown = {
        resources: [resource("same")],
        totalCount: 1,
        pathInfo: [home],
      };
      const api = {
        init: vi.fn().mockResolvedValue(true),
        profile: { homeFolderId: "home" },
        config: {
          templateDesignerFrontend: "https://designer.example",
          workspaceFrontend: "https://workspace.example",
          openViewBase: "https://openview.example",
        },
        report: vi.fn().mockResolvedValue(reply("same")),
        request: vi.fn(async (path: string) => ({
          data: path.includes("/contents") ? listing : home,
        })),
      };
      TestBed.configureTestingModule({
        providers: [provideRouter([]), { provide: Backend, useValue: api }],
      });
      const fixture = TestBed.createComponent(Workspace);
      fixture.detectChanges();
      const workspace = fixture.componentInstance;
      await vi.waitFor(() => expect(workspace.currentFolder()).toBeDefined());
      await workspace.select(resource("same"));
      listing = bad;
      await workspace.load(refresh);
      expect(workspace.error()).toContain("incomplete resource list");
      expect(workspace.loading()).toBe(false);
      expect(workspace.selectionIds()).toEqual([]);
      expect(workspace.selected()).toBeUndefined();
      expect(workspace.rows()).toEqual(refresh ? [resource("same")] : []);
      expect(workspace.total()).toBe(refresh ? 1 : 0);
      listing = { resources: [resource("new")], totalCount: 1 };
      await workspace.load();
      expect(workspace.error()).toBe("");
      expect(workspace.rows()).toEqual([resource("new")]);
      fixture.destroy();
    });
  }
}

for (const query of [
  "sharing=shared-with-me",
  "sharing=shared-with-everybody",
  "search=Study",
])
  for (const pathInfo of [undefined, null, []])
    for (const empty of [false, true]) {
      it(`accepts search without a folder breadcrumb: ${query}, path=${JSON.stringify(pathInfo)}, empty=${empty}`, async () => {
        const rows = empty ? [] : [resource("shared")];
        const api = {
          init: vi.fn().mockResolvedValue(true),
          profile: { homeFolderId: "home" },
          config: {
            templateDesignerFrontend: "https://designer.example",
            workspaceFrontend: "https://workspace.example",
            openViewBase: "https://openview.example",
          },
          request: vi.fn(async (path: string) => ({
            data: path.startsWith("/search?")
              ? { resources: rows, totalCount: rows.length, pathInfo }
              : path.includes("/contents")
                ? {
                    resources: [resource("old")],
                    totalCount: 1,
                    pathInfo: [home],
                  }
                : home,
          })),
        };
        TestBed.configureTestingModule({
          providers: [provideRouter([]), { provide: Backend, useValue: api }],
        });
        const fixture = TestBed.createComponent(Workspace);
        fixture.detectChanges();
        const workspace = fixture.componentInstance;
        await vi.waitFor(() => expect(workspace.currentFolder()).toBeDefined());
        workspace.params = new URLSearchParams(query);
        await workspace.load();
        expect(api.request).toHaveBeenCalledWith(
          expect.stringContaining("/search?"),
        );
        expect(workspace.error()).toBe("");
        expect(workspace.rows()).toEqual(rows);
        expect(workspace.total()).toBe(rows.length);
        expect(workspace.path()).toEqual([]);
        expect(workspace.loading()).toBe(false);
        fixture.destroy();
      });
    }

for (const oldFails of [false, true]) {
  for (const newFails of [false, true]) {
    for (const oldFirst of [false, true]) {
      describe(`out-of-order reads: oldFails=${oldFails}, newFails=${newFails}, oldFirst=${oldFirst}`, () => {
        it("the destination, permissions, error and busy state belong to the latest browse", async () => {
          const old = deferred<void>(),
            current = deferred<void>();
          const api = {
            request: vi.fn(async (path: string) => {
              const id = path.split("/")[2].split("?")[0];
              if (id === "old") await old.promise;
              if (id === "current") await current.promise;
              return {
                data: path.includes("/contents")
                  ? {
                      resources: [],
                      totalCount: 0,
                      pathInfo: [resource(id, "folder")],
                    }
                  : resource(id, "folder"),
              };
            }),
          };
          TestBed.configureTestingModule({
            providers: [{ provide: Backend, useValue: api }],
          });
          const dialog = TestBed.runInInjectionContext(
            () => new ResourceDialog(),
          );
          dialog.action = "copy";
          dialog.resource = resource("source");
          dialog.folder = "home";
          await dialog.load();
          const a = dialog.browse("old"),
            b = dialog.browse("current");
          expect(dialog.busy()).toBe(true);
          const settleOld = async () => {
            oldFails ? old.reject(new Error("old failure")) : old.resolve();
            await a;
          };
          const settleNew = async () => {
            newFails
              ? current.reject(new Error("current failure"))
              : current.resolve();
            await b;
          };
          if (oldFirst) {
            await settleOld();
            expect(dialog.busy()).toBe(true);
            await settleNew();
          } else {
            await settleNew();
            await settleOld();
          }
          expect(dialog.busy()).toBe(false);
          expect(dialog.error()).toBe(newFails ? "current failure" : "");
          expect(dialog.destinationAllowed).toBe(true);
          if (!newFails) expect(dialog.target).toBe("current");
          if (newFails) expect(dialog.target).toBe("home");
          await dialog.browse("home");
          expect(dialog.error()).toBe("");
          expect(dialog.destinationAllowed).toBe(true);
          dialog.ngOnDestroy();
        });

        it("the description draft and revision stay with the selected resource", async () => {
          const old = deferred<ReturnType<typeof reply>>(),
            current = deferred<ReturnType<typeof reply>>();
          const api = {
            snapshot: vi.fn((r: Resource) =>
              r["@id"] === "old" ? old.promise : current.promise,
            ),
            request: vi.fn(),
          };
          TestBed.configureTestingModule({
            providers: [{ provide: Backend, useValue: api }],
          });
          const fixture = TestBed.createComponent(DescriptionEditor);
          fixture.componentRef.setInput("resource", resource("old"));
          fixture.detectChanges();
          fixture.componentRef.setInput("resource", resource("current"));
          fixture.detectChanges();
          const settleOld = async () => {
            oldFails
              ? old.reject(new Error("old failure"))
              : old.resolve(reply("old"));
            await Promise.resolve();
            await Promise.resolve();
          };
          const settleNew = async () => {
            newFails
              ? current.reject(new Error("current failure"))
              : current.resolve(reply("current"));
            await Promise.resolve();
            await Promise.resolve();
          };
          if (oldFirst) {
            await settleOld();
            expect(fixture.componentInstance.busy()).toBe(true);
            await settleNew();
          } else {
            await settleNew();
            await settleOld();
          }
          const editor = fixture.componentInstance;
          expect(editor.busy()).toBe(false);
          expect(editor.error()).toBe(newFails ? "current failure" : "");
          expect(editor.snapshot()?.data["@id"] ?? null).toBe(
            newFails ? null : "current",
          );
          expect(editor.draft()).toBe("current description");
          api.snapshot.mockResolvedValue(reply("current"));
          await editor.load();
          expect(editor.error()).toBe("");
          expect(editor.snapshot()?.etag).toBe('"current"');
          fixture.destroy();
        });
      });
    }
  }
}

describe("listing, menu and selection ownership", () => {
  for (const outcome of ["success", "failure"] as const) {
    for (const transition of ["refresh", "close", "dispose"] as const) {
      it(`${transition} excludes the old menu's ${outcome}`, async () => {
        const pending = deferred<{ data: Resource }>();
        const api = {
          init: vi.fn().mockResolvedValue(true),
          profile: { homeFolderId: "home" },
          config: {
            templateDesignerFrontend: "https://designer.example",
            workspaceFrontend: "https://workspace.example",
            openViewBase: "https://openview.example",
          },
          request: vi.fn(async (path: string) => ({
            data: path.includes("/contents")
              ? {
                  resources: [resource("same")],
                  totalCount: 1,
                  pathInfo: [home],
                }
              : home,
          })),
          report: vi.fn().mockResolvedValue({ data: resource("same") }),
        };
        TestBed.configureTestingModule({
          providers: [provideRouter([]), { provide: Backend, useValue: api }],
        });
        const fixture = TestBed.createComponent(Workspace);
        fixture.detectChanges();
        await vi.waitFor(() =>
          expect(fixture.componentInstance.currentFolder()).toBeDefined(),
        );
        const workspace = fixture.componentInstance;
        api.report.mockReturnValue(pending.promise);
        const button = document.createElement("button");
        const event = { currentTarget: button } as unknown as MouseEvent;
        const opening = workspace.toggleMenu(resource("same"), event);
        if (transition === "refresh") await workspace.load(true);
        if (transition === "close")
          await workspace.toggleMenu(resource("same"), event);
        if (transition === "dispose") fixture.destroy();
        outcome === "failure"
          ? pending.reject(new Error("obsolete error"))
          : pending.resolve({
              data: { ...resource("same"), "schema:name": "obsolete name" },
            });
        await opening;
        expect(workspace.error()).toBe("");
        expect(workspace.rows()[0]["schema:name"]).toBe("same");
        if (transition !== "dispose") fixture.destroy();
      });
    }
  }
});

for (const outcome of ["success", "failure"] as const) {
  for (const transition of ["select", "revoke", "dispose"] as const) {
    it(`description ${outcome} after ${transition} cannot publish against the wrong resource`, async () => {
      const write = deferred<{ data: Resource; etag: string }>();
      const api = {
        snapshot: vi.fn(async (r: Resource) => reply(r["@id"])),
        request: vi.fn(() => write.promise),
      };
      TestBed.configureTestingModule({
        providers: [{ provide: Backend, useValue: api }],
      });
      const fixture = TestBed.createComponent(DescriptionEditor);
      fixture.componentRef.setInput("resource", resource("old"));
      fixture.detectChanges();
      await vi.waitFor(() =>
        expect(fixture.componentInstance.snapshot()).not.toBeNull(),
      );
      const editor = fixture.componentInstance;
      const saved = vi.fn();
      editor.saved.subscribe(saved);
      editor.draft.set("edited");
      const saving = editor.save();
      if (transition === "dispose") fixture.destroy();
      else {
        fixture.componentRef.setInput(
          "resource",
          transition === "select"
            ? resource("current")
            : {
                ...resource("old"),
                currentUserPermissions: { capabilities: [] },
              },
        );
        fixture.detectChanges();
        await Promise.resolve();
      }
      outcome === "failure"
        ? write.reject(new Error("obsolete write failure"))
        : write.resolve(reply("old"));
      await saving;
      expect(saved).not.toHaveBeenCalled();
      expect(editor.error()).toBe("");
      if (transition !== "dispose") fixture.destroy();
    });
  }
}
