import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceDialog } from "./resource-dialog";
import { Backend } from "./backend.service";
import { Resource } from "./resource";
const resource: Resource = {
  "@id": "id",
  resourceType: "template",
  "schema:name": "Original",
  currentUserPermissions: { capabilities: ["updateResource"] },
};
describe("Conditional action dialogs", () => {
  let api: {
    snapshot: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    path: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    api = {
      snapshot: vi
        .fn()
        .mockResolvedValue({ data: resource, etag: '"read-revision"' }),
      request: vi.fn(),
      path: vi.fn().mockReturnValue("/templates/id"),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: api }],
    });
  });
  function dialog(action = "rename") {
    const d = TestBed.runInInjectionContext(() => new ResourceDialog());
    d.action = action;
    d.resource = resource;
    return d;
  }
  it("creates folders without an optional description", async () => {
    const d = dialog("new-folder");
    await d.load();
    d.folder = "parent";
    d.name = " New folder ";
    d.description = "   ";
    await d.submit();
    expect(api.request).toHaveBeenCalledWith("/folders", "POST", {
      folderId: "parent",
      name: "New folder",
      description: "New folder",
    });
  });
  it("keeps edits and read-time revision after a conflict", async () => {
    const d = dialog();
    await d.load();
    d.name = "My edited title";
    api.request.mockRejectedValue(new Error("Conflict"));
    const saved = vi.spyOn(d.saved, "emit");
    await d.submit();
    expect(api.request).toHaveBeenCalledWith(
      "/command/rename-resource",
      "POST",
      {
        "@id": "id",
        "schema:name": "My edited title",
        "schema:description": "",
      },
      '"read-revision"',
    );
    expect(d.name).toBe("My edited title");
    expect(d.error()).toBe("Conflict");
    expect(saved).not.toHaveBeenCalled();
    expect(api.snapshot).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the read omits an ETag", async () => {
    api.snapshot.mockResolvedValue({ data: resource, etag: null });
    const d = dialog();
    await d.load();
    await d.submit();
    expect(api.request).not.toHaveBeenCalled();
    expect(d.error()).toContain("validator");
  });
  it.each(["delete", "rename"])(
    "uses content validators for %s",
    async (action) => {
      const d = dialog(action);
      await d.load();
      expect(api.snapshot).toHaveBeenCalledWith(resource, true);
    },
  );
  it.each(["move", "make-open", "make-not-open"])(
    "uses graph validators for %s",
    async (action) => {
      const d = dialog(action);
      await d.load();
      expect(api.snapshot).toHaveBeenCalledWith(resource, false);
    },
  );
  it("starts a draft at the next patch and refuses a version that does not raise it", async () => {
    const d = dialog("draft");
    d.resource = { ...resource, "pav:version": "1.2.3" };
    api.request.mockResolvedValue({
      data: { resources: [], totalCount: 0, pathInfo: [] },
    });
    await d.load();
    d.target = "home";
    d.targetResource = {
      "@id": "home",
      resourceType: "folder",
      currentUserPermissions: { capabilities: ["copyIntoFolder"] },
    };
    expect(d.destinationAllowed).toBe(true);
    expect(d.version).toEqual([1, 2, 4]);
    expect(d.versionError).toBe("");
    d.version = [1, 2, 3];
    expect(d.versionError).toBe("Use a version later than 1.2.3.");
    api.request.mockClear();
    await d.submit();
    expect(api.request).not.toHaveBeenCalled();
    d.version = [2, 0, 0];
    await d.submit();
    expect(api.request).toHaveBeenCalledWith(
      "/command/create-draft-artifact",
      "POST",
      expect.objectContaining({ "@id": "id", newVersion: "2.0.0" }),
    );
  });
  it("publishes at the current version or later", async () => {
    const d = dialog("publish");
    d.resource = { ...resource, "pav:version": "0.3.0" };
    await d.load();
    expect(d.version).toEqual([0, 3, 0]);
    expect(d.versionError).toBe("");
    d.version = [0, 2, 9];
    expect(d.versionError).toBe("Use version 0.3.0 or later.");
    d.version = [1, 0, 0];
    await d.submit();
    expect(api.request).toHaveBeenCalledWith(
      "/command/publish-artifact",
      "POST",
      { "@id": "id", newVersion: "1.0.0" },
    );
  });
  it("blocks duplicate submissions while a write is pending", async () => {
    const d = dialog();
    await d.load();
    api.request.mockReturnValue(new Promise(() => {}));
    void d.submit();
    void d.submit();
    expect(api.request).toHaveBeenCalledTimes(1);
  });
  it("keeps the displayed destination and permissions together when navigation fails", async () => {
    const d = dialog("copy");
    const current: Resource = {
      "@id": "home",
      resourceType: "folder",
      "schema:name": "Home",
      currentUserPermissions: { capabilities: ["copyIntoFolder"] },
    };
    d.target = "home";
    d.targetResource = current;
    d.path.set([current]);
    api.request
      .mockResolvedValueOnce({
        data: { resources: [], totalCount: 0, pathInfo: [] },
      })
      .mockRejectedValueOnce(new Error("Folder is unavailable"));
    await d.browse("other", 0, "-name");
    expect(d.target).toBe("home");
    expect(d.targetResource).toBe(current);
    expect(d.path()).toEqual([current]);
    expect(d.folderSort).toBe("name");
    expect(d.error()).toBe("Folder is unavailable");
    expect(d.busy()).toBe(false);
  });
});
