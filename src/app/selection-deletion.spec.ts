import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { Backend } from "./backend.service";
import { SelectionDeletion, emptyCounts } from "./selection-deletion";
import { FolderDeletionDialog, DeletionPlan } from "./folder-deletion-dialog";
import { Resource, ResourceType } from "./resource";
import { provideWorkspaceTranslations } from "./i18n";
const resource = (id: string, type: ResourceType = "instance"): Resource => ({
  "@id": id,
  resourceType: type,
  "schema:name": id,
  numberOfInstances: 0,
  currentUserPermissions: { capabilities: ["deleteResource"] },
});
const folder = resource("folder", "folder"),
  nested = resource("nested", "folder"),
  a = resource("a"),
  b = resource("b");
function plan(resources: Resource[], allowed = true): DeletionPlan {
  const counts = emptyCounts();
  resources.forEach((r) => counts[r.resourceType]++);
  return {
    token: "token",
    allowed,
    counts,
    items: resources.map((r, i) => ({
      id: r["@id"],
      name: r["@id"],
      type: r.resourceType,
      parentId: i ? resources[0]["@id"] : null,
      depth: i ? 1 : 0,
      deletable: allowed,
      protectedFolder: false,
      instancesInside: 0,
      instancesOutside: 0,
    })),
    restrictedItems: allowed ? 0 : resources.length,
    protectedFolders: 0,
    templatesWithInstances: 0,
    templatesWithOutsideInstances: 0,
    instancesOutside: 0,
  };
}
function setup(plans: Record<string, DeletionPlan> = {}) {
  const request = vi.fn(async (path: string) => ({ data: plans[path] }));
  const report = vi.fn(async (r: Resource) => ({ data: r }));
  const snapshot = vi.fn(async (r: Resource) => ({
    data: r,
    etag: '"content-7"',
  }));
  TestBed.configureTestingModule({
    providers: [
      ...provideWorkspaceTranslations("en"),
      {
        provide: Backend,
        useValue: {
          request,
          report,
          snapshot,
          path: (r: Resource) => "/" + r["@id"],
        },
      },
    ],
  });
  return {
    request,
    report,
    snapshot,
    service: TestBed.inject(SelectionDeletion),
    host: TestBed.runInInjectionContext(() => new FolderDeletionDialog()),
  };
}
describe("selection deletion preparation", () => {
  it("counts ancestors, selected children and duplicate selections once and submits only root tokens", async () => {
    const { service, request, report } = setup({
      "/folder/deletion": plan([folder, nested, a]),
      "/nested/deletion": plan([nested, a]),
    });
    const result = await service.prepare([a, nested, folder, a, b]);
    expect(result.inventory.counts).toEqual({
      ...emptyCounts(),
      folder: 2,
      instance: 2,
    });
    expect(result.roots.map((r) => r.resource["@id"])).toEqual(["folder", "b"]);
    expect(report).toHaveBeenCalledTimes(1);
    request.mockResolvedValue({
      data: {
        status: "completed",
        deleted: result.roots[0].plan!.counts,
        remaining: 0,
      },
    } as never);
    await service.execute(result.roots[0]);
    expect(request).toHaveBeenLastCalledWith("/folder/deletion", "POST", {
      token: "token",
    });
    await service.execute(result.roots[1]);
    expect(request).toHaveBeenLastCalledWith(
      "/b",
      "DELETE",
      undefined,
      '"content-7"',
    );
  });
  it("keeps restricted redacted descendants in the inventory and blocks the entire selection", async () => {
    const p = plan([folder, a], false);
    p.items[1].id = null;
    p.items[1].name = null;
    const { service } = setup({ "/folder/deletion": p });
    const result = await service.prepare([folder, b]);
    expect(result.inventory.allowed).toBe(false);
    expect(result.inventory.counts.instance).toBe(2);
    expect(result.inventory.restrictedItems).toBe(2);
  });
  it("does not require a separate child-owner token when an ancestor inventory covers it", async () => {
    const { service, request } = setup();
    request.mockImplementation(async (path) => {
      if (path === "/nested/deletion") throw new Error("403");
      return { data: plan([folder, nested]) };
    });
    expect((await service.prepare([nested, folder])).roots).toHaveLength(1);
  });
  it("fails closed for an unavailable root inventory", async () => {
    const { service, request } = setup();
    request.mockRejectedValue(new Error("timeout"));
    await expect(service.prepare([folder, a])).rejects.toThrow();
    expect(request.mock.calls.every((c) => c.length === 1)).toBe(true);
  });
  it("fails closed if independent folder inventories overlap after a concurrent move", async () => {
    const { service } = setup({
      "/folder/deletion": plan([folder, a]),
      "/nested/deletion": plan([nested, a]),
    });
    await expect(service.prepare([folder, nested])).rejects.toThrow();
  });
  it("checks fresh permission and refuses templates with references", async () => {
    const { service, report } = setup();
    report.mockResolvedValueOnce({
      data: { ...a, currentUserPermissions: { capabilities: [] } },
    });
    expect((await service.prepare([a])).inventory.allowed).toBe(false);
    const t = { ...resource("t", "template"), numberOfInstances: 4 };
    const prepared = await service.prepare([t]);
    expect(prepared.inventory.allowed).toBe(false);
    expect(prepared.inventory.instancesOutside).toBe(4);
  });
  it("requires a content ETag and known template reference count", async () => {
    const { service, snapshot } = setup();
    snapshot.mockResolvedValueOnce({ data: a, etag: null } as never);
    await expect(service.prepare([a])).rejects.toThrow();
    await expect(
      service.prepare([
        { ...resource("t", "template"), numberOfInstances: undefined },
      ]),
    ).rejects.toThrow();
  });
});
describe("selection confirmation", () => {
  it("stops at the first uncertain write, retains confirmed progress, and never automatically retries", async () => {
    const { host, request } = setup();
    host.resources = [a, b, resource("c")];
    await host.load();
    request
      .mockResolvedValueOnce({ data: undefined } as never)
      .mockRejectedValueOnce(new Error("timeout"));
    await host.confirm();
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.confirmedCounts().instance).toBe(1);
    expect(host.plan()).toBeNull();
    expect(host.error()).toContain("Some items may already have been deleted");
    await host.confirm();
    expect(request).toHaveBeenCalledTimes(2);
    await host.load();
    expect(host.plan()?.counts.instance).toBe(2);
  });
  it("retains server-reported partial progress and does not attempt later roots", async () => {
    const { host, request } = setup({ "/folder/deletion": plan([folder, a]) });
    host.resources = [folder, b];
    await host.load();
    request.mockClear();
    request.mockResolvedValue({
      data: {
        status: "stopped",
        deleted: { ...emptyCounts(), instance: 1 },
        remaining: 1,
        code: "FOLDER_DELETE_ITEM_CHANGED",
      },
    } as never);
    await host.confirm();
    expect(host.outcome()?.deleted.instance).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(host.plan()).toBeNull();
  });
  it("cancel and a blocked inventory issue no writes", async () => {
    const { host, request } = setup({
      "/folder/deletion": plan([folder, a], false),
    });
    host.resources = [folder];
    await host.load();
    await host.confirm();
    host.close();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("ignores duplicate confirmation and refuses Escape while deleting", async () => {
    const { host, request } = setup();
    host.resources = [a];
    await host.load();
    let finish!: () => void;
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: undefined } as never);
        }),
    );
    host.dialog = { nativeElement: { close: vi.fn() } } as never;
    const closed = vi.fn(),
      saved = vi.fn();
    host.closed.subscribe(closed);
    host.saved.subscribe(saved);
    const pending = host.confirm();
    await host.confirm();
    host.close();
    expect(request).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(saved).toHaveBeenCalledOnce();
  });
});
