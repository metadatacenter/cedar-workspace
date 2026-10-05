import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceDialog } from "./resource-dialog";
import { Backend } from "./backend.service";
import { Confirmation } from "./confirmation";
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
  // Inside an open folder a resource stays in OpenView whatever its own flag says,
  // so the confirmation names the folders that keep it there.
  const shared: Resource = {
    "@id": "shared",
    resourceType: "folder",
    "schema:name": "Shared",
    isOpen: true,
  };
  const archive: Resource = {
    "@id": "archive",
    resourceType: "folder",
    "schema:name": "Archive",
    isOpen: true,
  };
  const home: Resource = { "@id": "home", resourceType: "folder", "schema:name": "Home" };
  it.each([
    ["make-not-open", [home], "This item will no longer be available through OpenView."],
    ["make-open", [home], "This item will be available through OpenView."],
    [
      "make-not-open",
      [home, shared],
      "This item stays available through OpenView while the folder “Shared” is open. Disable Openview on that folder to remove it.",
    ],
    [
      "make-open",
      [home, shared],
      "This item is already available through OpenView because the folder “Shared” is open. Enabling it keeps it available if Openview is later disabled on that folder.",
    ],
    [
      "make-not-open",
      [archive, shared],
      "This item stays available through OpenView while the folders “Archive”, “Shared” are open. Disable Openview on those folders to remove it.",
    ],
  ] as const)(
    "confirms %s for a resource below %j by what will happen",
    async (action, above, message) => {
      api.snapshot.mockResolvedValue({
        data: { ...resource, pathInfo: [...above, resource] },
        etag: '"read-revision"',
      });
      const d = dialog(action);
      await d.load();
      expect(d.openViewMessage()).toBe(message);
    },
  );
  it("says only that a folder above keeps it open before its path has been read", () => {
    const d = dialog("make-not-open");
    d.resource = { ...resource, isOpenImplicitly: true };
    expect(d.openViewMessage()).toBe(
      "This item stays available through OpenView while a folder above it is open. Disable Openview on that folder to remove it.",
    );
  });
  // A folder moved on its own is held to the rule a group of items meets: not into itself and not
  // into any folder below it.
  const moved: Resource = { "@id": "moved", resourceType: "folder", "schema:name": "Moved" };
  const target = (id: string, path: string[], capabilities = ["moveIntoFolder"]): Resource => ({
    "@id": id,
    resourceType: "folder",
    pathInfo: [...path, id].map((p) => ({ "@id": p, resourceType: "folder" as const })),
    currentUserPermissions: { capabilities },
  });
  it.each([
    ["the folder itself", target("moved", ["home"]), false],
    ["a folder inside it", target("child", ["home", "moved"]), false],
    ["a folder two levels inside it", target("grandchild", ["home", "moved", "child"]), false],
    ["an unrelated folder", target("other", ["home"]), true],
    ["a folder that does not accept moves", target("other", ["home"], ["readResource"]), false],
  ] as const)("a single folder may move into %s: %s", (_, destination, allowed) => {
    for (const bulk of [false, true]) {
      const d = dialog("move");
      d.resource = moved;
      d.resources = bulk ? [moved] : [];
      d.targetResource = destination;
      d.target = destination["@id"];
      expect(d.destinationAllowed).toBe(allowed);
    }
  });
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
    // Shared as the published version is, directly in the chosen folder.
    expect(api.request).toHaveBeenCalledWith(
      "/command/create-draft-artifact",
      "POST",
      {
        "@id": "id",
        newVersion: "2.0.0",
        folderId: "home",
        propagateSharing: true,
        newFolderName: null,
      },
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
  for (const [title, stored] of [
    ["at 0.0.1", "0.0.1"],
    ["whose version cannot be read", undefined],
  ] as const)
    it(`refuses version 0.0.0 for a publication or draft of an artifact ${title}`, async () => {
      for (const action of ["publish", "draft"]) {
        const d = dialog(action);
        d.resource = { ...resource, "pav:version": stored };
        d.version = [0, 0, 0];
        expect(d.versionError).toBe("Use version 0.0.1 or later.");
        api.request.mockClear();
        await d.submit();
        expect(api.request).not.toHaveBeenCalled();
      }
    });
  it("labels Publish's and Create Draft's button Ok and closes them after a version change without asking", async () => {
    const asked = vi.spyOn(TestBed.inject(Confirmation), "confirm").mockResolvedValue(false);
    api.request.mockResolvedValue({
      data: { resources: [], totalCount: 0, pathInfo: [] },
    });
    for (const action of ["publish", "draft"]) {
      const d = dialog(action);
      d.resource = { ...resource, "pav:version": "0.3.0" };
      await d.load();
      expect(d.submitLabel).toBe("ResourceDialog.Ok");
      const closed = vi.fn();
      d.closed.subscribe(closed);
      d.version = [1, 0, 0];
      await d.close();
      expect(closed).toHaveBeenCalledOnce();
    }
    expect(asked).not.toHaveBeenCalled();
    // A rename still asks before discarding a changed name.
    const rename = dialog("rename");
    await rename.load();
    expect(rename.submitLabel).toBe("Common.Save");
    rename.name = "Changed";
    await rename.close();
    expect(asked).toHaveBeenCalledOnce();
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
