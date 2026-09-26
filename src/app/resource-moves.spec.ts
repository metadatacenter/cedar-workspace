import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { ResourceMoves } from "./resource-moves";
import { Resource } from "./resource";
const item = (id: string): Resource => ({
  "@id": id,
  resourceType: "instance",
  currentUserPermissions: { capabilities: ["moveResource"] },
});
const target: Resource = {
  "@id": "target",
  resourceType: "folder",
  currentUserPermissions: { capabilities: ["moveIntoFolder"] },
};
describe("group resource moves", () => {
  let api: {
    request: ReturnType<typeof vi.fn>;
    report: ReturnType<typeof vi.fn>;
    snapshot: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    api = {
      request: vi.fn().mockResolvedValue({ data: target }),
      report: vi.fn(async (r) => ({ data: r })),
      snapshot: vi.fn(async (r) => ({ data: r, etag: '"' + r["@id"] + '"' })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: api }],
    });
  });
  it("uses each resource revision and reports partial failure without retrying", async () => {
    api.request.mockImplementation(async (path, method, body) => {
      if (method === "POST" && body["@id"] === "b")
        throw new Error("stale revision");
      return { data: target };
    });
    const result = await TestBed.inject(ResourceMoves).move(
      [item("a"), item("b")],
      "target",
    );
    expect(result.moved).toEqual(["a"]);
    expect(result.failed[0].message).toBe("stale revision");
    expect(api.request).toHaveBeenCalledWith(
      "/command/move-resource-to-folder",
      "POST",
      { "@id": "a", targetFolderId: "target" },
      '"a"',
    );
    expect(api.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(
      2,
    );
  });
  it.each(["permission", "revision"])(
    "does not start writes when preflight fails: %s",
    async (reason) => {
      if (reason === "permission")
        api.report.mockResolvedValue({
          data: { ...item("b"), currentUserPermissions: { capabilities: [] } },
        });
      else api.snapshot.mockResolvedValue({ data: item("b"), etag: null });
      await expect(
        TestBed.inject(ResourceMoves).move([item("a"), item("b")], "target"),
      ).rejects.toThrow();
      expect(
        api.request.mock.calls.filter((c) => c[1] === "POST"),
      ).toHaveLength(0);
    },
  );
  it("rejects moving a folder into its descendant", async () => {
    api.request.mockResolvedValue({
      data: {
        ...target,
        pathInfo: [{ ...item("parent"), resourceType: "folder" }],
      },
    });
    await expect(
      TestBed.inject(ResourceMoves).move(
        [{ ...item("parent"), resourceType: "folder" }],
        "target",
      ),
    ).rejects.toThrow();
    expect(api.snapshot).not.toHaveBeenCalled();
  });
});

it("preserves hierarchy when an ancestor and descendant are both selected", async () => {
  const parent: Resource = { ...item("parent"), resourceType: "folder" };
  const child: Resource = { ...item("child"), pathInfo: [parent] };
  const api = {
    request: vi.fn().mockResolvedValue({ data: target }),
    report: vi.fn(async (r) => ({ data: r })),
    snapshot: vi.fn(async (r) => ({ data: r, etag: '"revision"' })),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: Backend, useValue: api }],
  });
  const result = await TestBed.inject(ResourceMoves).move(
    [child, parent],
    "target",
  );
  expect(api.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(1);
  expect(result.moved).toEqual(["parent", "child"]);
});
