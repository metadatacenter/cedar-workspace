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
  it("uses content validators for delete rather than graph validators", async () => {
    const d = dialog("delete");
    await d.load();
    expect(api.snapshot).toHaveBeenCalledWith(resource, true);
  });
  it("blocks duplicate submissions while a write is pending", async () => {
    const d = dialog();
    await d.load();
    api.request.mockReturnValue(new Promise(() => {}));
    void d.submit();
    void d.submit();
    expect(api.request).toHaveBeenCalledTimes(1);
  });
});
