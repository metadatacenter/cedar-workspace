import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceDialog } from "./resource-dialog";
import { Backend, HttpError } from "./backend.service";
import { Confirmation } from "./confirmation";
import { Resource } from "./resource";
import { useDeploymentDomain } from "./resource-address";
const minted = (collection: string) =>
  expect.stringMatching(
    new RegExp(`^https://repo\\.example/${collection}/[0-9a-f-]{36}$`),
  );
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
  afterEach(() => useDeploymentDomain(null));
  beforeEach(() => {
    useDeploymentDomain("example");
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
    // The folder is created under an identity minted for it, so a lost reply can be looked up.
    const [path, method, body] = api.request.mock.lastCall!;
    expect(body).toEqual({
      "@id": minted("folders"),
      folderId: "parent",
      name: "New folder",
      description: "New folder",
    });
    expect([path, method]).toEqual([
      "/folders/" + body["@id"].split("/").at(-1),
      "PUT",
    ]);
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
    const d = dialog("move");
    d.resource = moved;
    d.targetResource = destination;
    d.target = destination["@id"];
    expect(d.destinationAllowed).toBe(allowed);
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
        draftId: minted("templates"),
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

describe("the Retry control of an action whose outcome is unknown", () => {
  const original = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  beforeEach(() => {
    useDeploymentDomain("example");
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
  });
  afterEach(() => {
    useDeploymentDomain(null);
    sessionStorage.clear();
    if (original)
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  });
  it("appears only while a new folder's outcome is unknown, and the status names it", async () => {
    const request = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            request,
            config: { resourceRestAPI: "https://resource.example" },
            userId: "owner",
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ResourceDialog);
    fixture.componentRef.setInput("action", "new-folder");
    fixture.componentRef.setInput("folder", "home");
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.preparing()).toBe(false),
    );
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    const retry = () =>
      [...page.querySelectorAll("button")].filter(
        (button) => button.textContent?.trim() === "Retry",
      );
    const submit = () =>
      page.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(retry()).toHaveLength(0);
    expect(page.textContent).not.toContain("Use Retry");
    fixture.componentInstance.name = "Results";
    request.mockRejectedValueOnce(new HttpError(0, "No reply"));
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(retry()).toHaveLength(1);
    expect(page.textContent).toContain(
      "This operation may already have completed. Use Retry to check its result before trying again.",
    );
    expect(submit().disabled).toBe(true);
    const [, , body] = request.mock.lastCall!;
    request.mockRejectedValueOnce(new HttpError(404, "Not found"));
    retry()[0].click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(retry()).toHaveLength(0);
    });
    expect(request.mock.lastCall?.[0]).toBe(
      "/folders/" + body["@id"].split("/").at(-1),
    );
    expect(page.textContent).not.toContain("Use Retry");
    expect(submit().disabled).toBe(false);
    fixture.destroy();
  });
  it("sends the copy's identity with Copy", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { resources: [], totalCount: 0, pathInfo: [] },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: { request } }],
    });
    const d = TestBed.runInInjectionContext(() => new ResourceDialog());
    d.action = "copy";
    d.resource = resource;
    d.folder = "home";
    await d.load();
    d.targetResource = {
      "@id": "home",
      resourceType: "folder",
      currentUserPermissions: { capabilities: ["copyIntoFolder"] },
    };
    await d.submit();
    expect(request).toHaveBeenLastCalledWith(
      "/command/copy-artifact-to-folder",
      "POST",
      {
        "@id": "id",
        targetFolderId: "home",
        nameTemplate: "Original (copy)",
        copyId: minted("templates"),
      },
    );
  });
});

// No identity can be minted until Workspace knows the deployment's base. The server then mints one as
// before, and an unknown outcome keeps today's message with no lookup to offer.
describe("a dialog action while the deployment's base is unknown", () => {
  const original = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  beforeEach(() => {
    useDeploymentDomain(null);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
  });
  afterEach(() => {
    sessionStorage.clear();
    if (original)
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  });
  it("creates a folder by POST and offers no Retry for an unknown outcome", async () => {
    const request = vi.fn().mockRejectedValue(new HttpError(0, "No reply"));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            request,
            config: { resourceRestAPI: "https://resource.example" },
            userId: "owner",
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ResourceDialog);
    fixture.componentRef.setInput("action", "new-folder");
    fixture.componentRef.setInput("folder", "home");
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.preparing()).toBe(false),
    );
    fixture.componentInstance.name = "Results";
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(request).toHaveBeenCalledWith("/folders", "POST", {
      folderId: "home",
      name: "Results",
      description: "Results",
    });
    const page = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.inspectionRequired()).toBe(true);
    expect(fixture.componentInstance.settles).toBe(false);
    expect(
      [...page.querySelectorAll("button")].filter(
        (button) => button.textContent?.trim() === "Retry",
      ),
    ).toHaveLength(0);
    expect(page.textContent).toContain(
      "This operation may already have completed. Close this dialog and refresh Workspace to check the result before trying again.",
    );
    expect(sessionStorage.length).toBe(0);
    fixture.destroy();
  });
  it.each(["copy", "draft"])("sends %s without an identity", async (action) => {
    const request = vi.fn().mockResolvedValue({
      data: { resources: [], totalCount: 0, pathInfo: [] },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: { request } }],
    });
    const d = TestBed.runInInjectionContext(() => new ResourceDialog());
    d.action = action;
    d.resource = { ...resource, "pav:version": "1.0.0" };
    d.folder = "home";
    await d.load();
    d.targetResource = {
      "@id": "home",
      resourceType: "folder",
      currentUserPermissions: { capabilities: ["copyIntoFolder"] },
    };
    await d.submit();
    const body = request.mock.lastCall?.[2];
    expect(body).not.toHaveProperty("copyId");
    expect(body).not.toHaveProperty("draftId");
    expect(body["@id"]).toBe("id");
  });
});
