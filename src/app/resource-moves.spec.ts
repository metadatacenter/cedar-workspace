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
      report: vi.fn(async (r) => ({
        data: {
          ...r,
          pathInfo: r.pathInfo ?? [{ "@id": "home", resourceType: "folder" }],
        },
      })),
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
  it("checks current placement after a lost reply and does not repeat a committed move", async () => {
    let committed = false;
    api.report.mockImplementation(async (r) => ({
      data: {
        ...r,
        pathInfo: [
          { "@id": committed ? "target" : "home", resourceType: "folder" },
          r,
        ],
      },
    }));
    api.request.mockImplementation(async (_path, method) => {
      if (method === "POST") {
        committed = true;
        throw new Error("Lost reply");
      }
      return { data: target };
    });
    const moves = TestBed.inject(ResourceMoves);
    expect((await moves.move([item("a")], "target")).failed).toHaveLength(1);
    expect((await moves.move([item("a")], "target")).moved).toEqual(["a"]);
    expect(api.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(
      1,
    );
  });
  it.each([undefined, [], [{ "@id": "a" }], [{ "@id": "" }], [null]])(
    "does not write when the current parent is missing or malformed: %j",
    async (pathInfo) => {
      api.report.mockResolvedValue({ data: { ...item("a"), pathInfo } });
      await expect(
        TestBed.inject(ResourceMoves).move([item("a")], "target"),
      ).rejects.toThrow("current folder could not be confirmed");
      expect(
        api.request.mock.calls.filter((c) => c[1] === "POST"),
      ).toHaveLength(0);
    },
  );
  it("only the direct parent proves arrival, not a destination higher in the path", async () => {
    api.report.mockImplementation(async (r) => ({
      data: {
        ...r,
        pathInfo: [target, { "@id": "nested", resourceType: "folder" }, r],
      },
    }));
    expect(
      (await TestBed.inject(ResourceMoves).move([item("a")], "target")).moved,
    ).toEqual(["a"]);
    expect(api.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(
      1,
    );
  });
});

it.each([false, true])(
  "preserves selected ancestor/descendant hierarchy when arrival is already confirmed: %s",
  async (alreadyThere) => {
    const parent: Resource = {
      ...item("parent"),
      resourceType: "folder",
      pathInfo: [
        alreadyThere ? target : { "@id": "home", resourceType: "folder" },
      ],
    };
    const child: Resource = { ...item("child"), pathInfo: [parent] };
    const api = {
      request: vi.fn().mockResolvedValue({ data: target }),
      report: vi.fn(async (r) => ({
        data: {
          ...r,
          pathInfo: r.pathInfo ?? [{ "@id": "home", resourceType: "folder" }],
        },
      })),
      snapshot: vi.fn(async (r) => ({ data: r, etag: '"revision"' })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: api }],
    });
    const result = await TestBed.inject(ResourceMoves).move(
      [child, parent],
      "target",
    );
    expect(api.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(
      alreadyThere ? 0 : 1,
    );
    expect(result.moved).toEqual(["parent", "child"]);
  },
);
