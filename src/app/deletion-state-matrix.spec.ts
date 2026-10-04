import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { Backend } from "./backend.service";
import { DeletionPlan, FolderDeletionDialog } from "./folder-deletion-dialog";
import { validDeletionPlan, validDeletionOutcome } from "./deletion-validation";
import { emptyCounts } from "./selection-deletion";

function inventory(depth = 1): DeletionPlan {
  const items = Array.from({ length: depth + 1 }, (_, i) => ({
    id: `folder-${i}`,
    name: `Folder ${i}`,
    type: "folder" as const,
    parentId: i ? `folder-${i - 1}` : null,
    depth: i,
    deletable: true,
    protectedFolder: false,
    instancesInside: 0,
    instancesOutside: 0,
  }));
  return {
    token: "confirmed-token",
    allowed: true,
    counts: { ...emptyCounts(), folder: items.length },
    items,
    restrictedItems: 0,
    protectedFolders: 0,
    templatesWithInstances: 0,
    templatesWithOutsideInstances: 0,
    instancesOutside: 0,
  };
}
function setup(bulk = false) {
  const request = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: Backend, useValue: { request, path: () => "/folders/root" } },
    ],
  });
  const host = TestBed.runInInjectionContext(() => new FolderDeletionDialog());
  host.resource = { "@id": "folder-0", resourceType: "folder" };
  if (bulk) host.resources = [host.resource];
  host.dialog = {
    nativeElement: { close: vi.fn() },
  } as unknown as typeof host.dialog;
  return { host, request };
}
const corruptions: [string, (plan: DeletionPlan) => unknown][] = [
  ["null", () => null],
  ["empty", () => ({})],
  ["missing token", (p) => ({ ...p, token: " " })],
  ["string permission", (p) => ({ ...p, allowed: "true" })],
  ["missing counts", (p) => ({ ...p, counts: {} })],
  ["negative count", (p) => ({ ...p, counts: { ...p.counts, folder: -1 } })],
  ["fractional count", (p) => ({ ...p, counts: { ...p.counts, folder: 2.1 } })],
  ["wrong count", (p) => ({ ...p, counts: { ...p.counts, folder: 3 } })],
  ["missing items", (p) => ({ ...p, items: null })],
  ["empty inventory", (p) => ({ ...p, items: [] })],
  ["duplicate identifier", (p) => ({ ...p, items: [p.items[0], p.items[0]] })],
  [
    "wrong root",
    (p) => ({
      ...p,
      items: p.items.map((i) => ({ ...i, id: `wrong-${i.id}` })),
    }),
  ],
  [
    "unknown type",
    (p) => ({
      ...p,
      items: p.items.map((i) => ({ ...i, type: "constructor" })),
    }),
  ],
  [
    "unknown parent",
    (p) => ({
      ...p,
      items: [p.items[0], { ...p.items[1], parentId: "missing" }],
    }),
  ],
  [
    "cycle",
    (p) => ({
      ...p,
      items: [p.items[0], { ...p.items[1], parentId: p.items[1].id }],
    }),
  ],
  [
    "wrong depth",
    (p) => ({ ...p, items: [p.items[0], { ...p.items[1], depth: 0 }] }),
  ],
  [
    "string permission flag",
    (p) => ({
      ...p,
      items: [p.items[0], { ...p.items[1], deletable: "true" }],
    }),
  ],
  ["false summary", (p) => ({ ...p, restrictedItems: 1 })],
  [
    "hidden blocker",
    (p) => ({
      ...p,
      items: [p.items[0], { ...p.items[1], deletable: false }],
      restrictedItems: 1,
    }),
  ],
  [
    "unknown reference count",
    (p) => ({
      ...p,
      items: [p.items[0], { ...p.items[1], instancesOutside: NaN }],
    }),
  ],
];
for (const bulk of [false, true]) {
  describe(bulk ? "selected-folder deletion" : "single-folder deletion", () => {
    for (const [name, corrupt] of corruptions) {
      it(`${name} disables confirmation and a fresh valid inventory recovers`, async () => {
        const { host, request } = setup(bulk);
        request.mockResolvedValueOnce({ data: corrupt(inventory()) });
        await host.load();
        expect(host.plan()).toBeNull();
        expect(host.error()).not.toBe("");
        await host.confirm();
        expect(request).toHaveBeenCalledTimes(1);
        request.mockResolvedValueOnce({ data: inventory() });
        await host.load();
        expect(host.plan()?.allowed).toBe(true);
        expect(host.error()).toBe("");
        request.mockResolvedValueOnce({
          data: {
            status: "completed",
            deleted: inventory().counts,
            remaining: 0,
          },
        });
        const saved = vi.spyOn(host.saved, "emit");
        await host.confirm();
        await host.confirm();
        expect(saved).toHaveBeenCalledOnce();
        expect(request).toHaveBeenCalledTimes(3);
      });
    }
    for (const reply of [
      null,
      {},
      { status: "completed", deleted: emptyCounts(), remaining: 0 },
      {
        status: "stopped",
        deleted: { ...emptyCounts(), folder: 3 },
        remaining: 0,
      },
      { status: "completed", deleted: inventory().counts, remaining: 1 },
      { status: "unknown", deleted: emptyCounts(), remaining: 2 },
    ]) {
      it(`malformed outcome ${JSON.stringify(reply)} cannot report completion or reuse confirmation`, async () => {
        const { host, request } = setup(bulk);
        request.mockResolvedValueOnce({ data: inventory() });
        await host.load();
        request.mockResolvedValueOnce({ data: reply });
        const saved = vi.spyOn(host.saved, "emit"),
          changed = vi.spyOn(host.changed, "emit");
        await host.confirm();
        await host.confirm();
        expect(saved).not.toHaveBeenCalled();
        expect(changed).toHaveBeenCalledOnce();
        expect(request).toHaveBeenCalledTimes(2);
        expect(host.plan()).toBeNull();
        expect(host.error()).not.toBe("");
      });
    }
    for (const phase of ["read", "write"]) {
      for (const outcome of ["success", "failure"]) {
        it(`destroyed ${phase} ignores ${outcome} and cannot start more deletion`, async () => {
          const { host, request } = setup(bulk);
          if (phase === "write") {
            request.mockResolvedValueOnce({ data: inventory() });
            await host.load();
          }
          let resolve!: (v: unknown) => void, reject!: (e: Error) => void;
          request.mockImplementationOnce(
            () =>
              new Promise((yes, no) => {
                resolve = yes;
                reject = no;
              }),
          );
          const pending = phase === "read" ? host.load() : host.confirm();
          host.ngOnDestroy();
          const saved = vi.spyOn(host.saved, "emit"),
            changed = vi.spyOn(host.changed, "emit");
          if (outcome === "success")
            resolve({
              data:
                phase === "read"
                  ? inventory()
                  : {
                      status: "completed",
                      deleted: inventory().counts,
                      remaining: 0,
                    },
            });
          else reject(new Error("Late failure"));
          await pending;
          await host.confirm();
          await host.load();
          expect(saved).not.toHaveBeenCalled();
          expect(changed).not.toHaveBeenCalled();
          expect(request).toHaveBeenCalledTimes(phase === "read" ? 1 : 2);
        });
      }
    }
    it("a changed selection cannot use the old inventory", async () => {
      const { host, request } = setup(bulk);
      request.mockResolvedValueOnce({ data: inventory() });
      await host.load();
      if (bulk) host.resources = [{ "@id": "other", resourceType: "folder" }];
      else host.resource = { "@id": "other", resourceType: "folder" };
      await host.confirm();
      expect(request).toHaveBeenCalledTimes(1);
      expect(host.plan()).toBeNull();
    });
  });
}
for (const depth of [1, 3, 8]) {
  for (const blocker of ["none", "permission", "protected", "redacted"]) {
    it(`depth ${depth}, ${blocker}: validates deep blockers and redaction without treating them as malformed`, () => {
      const p = inventory(depth);
      if (blocker === "permission" || blocker === "redacted") {
        p.items[depth].deletable = false;
        p.restrictedItems = 1;
        p.allowed = false;
      }
      if (blocker === "protected") {
        p.items[depth].protectedFolder = true;
        p.protectedFolders = 1;
        p.allowed = false;
      }
      if (blocker === "redacted") {
        p.items[depth].id = null;
        p.items[depth].name = null;
        p.items[depth].parentId = null;
      }
      expect(validDeletionPlan(p, "folder-0")).toBe(true);
      for (const status of ["changed", "blocked"])
        expect(
          validDeletionOutcome(
            { status, deleted: emptyCounts(), remaining: 100 },
            p,
          ),
        ).toBe(true);
    });
  }
}

it("single-folder retries accumulate only confirmed progress across fresh inventories", async () => {
  const { host, request } = setup();
  request.mockResolvedValueOnce({ data: inventory(3) });
  await host.load();
  request.mockResolvedValueOnce({
    data: {
      status: "stopped",
      deleted: { ...emptyCounts(), folder: 1 },
      remaining: 3,
    },
  });
  await host.confirm();
  expect(host.outcome()?.deleted.folder).toBe(1);
  request.mockResolvedValueOnce({ data: inventory(2) });
  await host.load();
  request.mockResolvedValueOnce({
    data: {
      status: "stopped",
      deleted: { ...emptyCounts(), folder: 1 },
      remaining: 2,
    },
  });
  await host.confirm();
  expect(host.outcome()?.deleted.folder).toBe(2);
  expect(host.outcome()?.remaining).toBe(2);
  expect(host.confirmedCounts().folder).toBe(2);
  await host.confirm();
  expect(request).toHaveBeenCalledTimes(4);
});
