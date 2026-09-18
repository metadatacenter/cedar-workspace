import { TestBed } from "@angular/core/testing";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  PermissionsDialog,
  Permissions,
  Principal,
} from "./permissions-dialog";
import { Backend, HttpError } from "./backend.service";
import { Resource } from "./resource";
const owner: Principal = { "@id": "owner", firstName: "Owner" };
const user: Principal = { "@id": "user", firstName: "Other" };
const everyone: Principal = {
  "@id": "everyone",
  "schema:name": "everyone",
  specialGroup: true,
};
const resource: Resource = {
  "@id": "artifact",
  resourceType: "template",
  "schema:name": "Template",
  currentUserPermissions: {
    capabilities: ["readResource", "manageGrants", "transferOwnership"],
  },
};
const initial: Permissions = {
  owner,
  userPermissions: [],
  groupPermissions: [],
};

describe("Permissions dialog", () => {
  let host: PermissionsDialog;
  let api: {
    request: ReturnType<typeof vi.fn>;
    report: ReturnType<typeof vi.fn>;
    path: () => string;
    config: { groupRestAPI: string };
  };
  beforeEach(async () => {
    api = {
      report: vi.fn().mockResolvedValue({ data: resource }),
      path: () => "/templates/artifact",
      config: { groupRestAPI: "https://groups.example" },
      request: vi.fn(async (path: string) => {
        if (path === "/users") return { data: { users: [owner, user] } };
        if (path.endsWith("/groups")) return { data: { groups: [everyone] } };
        return { data: structuredClone(initial), etag: '"revision-1"' };
      }),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: api }],
    });
    host = TestBed.runInInjectionContext(() => new PermissionsDialog());
    host.resource = resource;
    await host.load();
    api.request.mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());
  it("saves a selected principal immediately with identifier-only grants and the permissions revision", async () => {
    host.selectPerson("user");
    host.role = "editor";
    api.request.mockResolvedValue({
      data: { ...initial, userPermissions: [{ user, role: "editor" }] },
      etag: '"revision-2"',
    });
    await host.add();
    expect(api.request).toHaveBeenCalledWith(
      "/templates/artifact/permissions",
      "PUT",
      {
        owner: { "@id": "owner" },
        userPermissions: [{ user: { "@id": "user" }, role: "editor" }],
        groupPermissions: [],
      },
      '"revision-1"',
    );
    expect(host.etag).toBe('"revision-2"');
    expect(host.personId).toBe("");
    expect(host.grants[0].role).toBe("editor");
  });
  it("limits Everyone to Viewer and excludes the owner and existing grants from the picker", async () => {
    host.selectPerson("everyone");
    host.role = "manager";
    await host.add();
    expect(api.request).not.toHaveBeenCalled();
    expect(host.options.map((p) => p.id)).not.toContain("owner");
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
    });
    expect(host.options.map((p) => p.id)).not.toContain("user");
  });
  it("keeps failed changes visible and blocks retries with a stale revision until explicit reload", async () => {
    host.selectPerson("user");
    host.role = "editor";
    api.request.mockRejectedValue(
      new HttpError(412, "Permissions changed since they were read"),
    );
    await host.add();
    expect(host.grants).toEqual([]);
    expect(host.personId).toBe("user");
    expect(host.role).toBe("editor");
    expect(host.failedChange()).toContain("Other");
    expect(host.stale()).toBe(true);
    await host.add();
    expect(api.request).toHaveBeenCalledTimes(1);
  });
  it("uses the permissions revision for confirmed user-only ownership transfer and refreshes capabilities", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
      groupPermissions: [{ group: everyone, role: "viewer" }],
    });
    await host.transfer(host.grants[1]);
    expect(window.confirm).not.toHaveBeenCalled();
    const transferred = {
      owner: user,
      userPermissions: [],
      groupPermissions: [],
    };
    api.request.mockResolvedValue({ data: transferred, etag: '"revision-2"' });
    api.report.mockResolvedValue({
      data: {
        ...resource,
        currentUserPermissions: { capabilities: ["readResource"] },
      },
    });
    await host.transfer(host.grants[0]);
    expect(api.request).toHaveBeenCalledWith(
      "/command/transfer-resource-ownership",
      "POST",
      { "@id": "artifact", newOwnerId: "user" },
      '"revision-1"',
    );
    expect(host.permissions()?.owner).toEqual(user);
    expect(host.canManage).toBe(false);
    expect(host.canTransfer).toBe(false);
  });
  it("retains Everyone's special identity when permission extracts omit the flag", async () => {
    host.permissions.set({
      ...initial,
      groupPermissions: [
        {
          group: { "@id": "everyone", "schema:name": "Everybody" },
          role: "viewer",
        },
      ],
    });
    expect(host.grants[0].node.specialGroup).toBe(true);
    expect(host.principalName(host.grants[0].node)).toBe("Everyone");
    await host.changeRole(host.grants[0], "manager");
    expect(api.request).not.toHaveBeenCalled();
  });
  it("honors cancelled ownership transfer", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
    });
    vi.mocked(window.confirm).mockReturnValue(false);
    await host.transfer(host.grants[0]);
    expect(api.request).not.toHaveBeenCalled();
  });
  it("does not fetch users or allow mutations for a viewer", async () => {
    api.report.mockResolvedValue({
      data: {
        ...resource,
        currentUserPermissions: { capabilities: ["readResource"] },
      },
    });
    await host.load();
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(api.request).not.toHaveBeenCalledWith("/users");
    expect(host.canManage).toBe(false);
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
    });
    api.request.mockClear();
    await host.changeRole(host.grants[0], "manager");
    await host.remove(host.grants[0]);
    await host.transfer(host.grants[0]);
    expect(api.request).not.toHaveBeenCalled();
  });
  it("refuses writes with no revision and serializes pending mutations", async () => {
    host.selectPerson("user");
    host.etag = null;
    await host.add();
    expect(api.request).not.toHaveBeenCalled();
    expect(host.error()).toContain("revision");
    host.etag = '"revision-1"';
    api.request.mockReturnValue(new Promise(() => {}));
    void host.add();
    await host.add();
    expect(api.request).toHaveBeenCalledTimes(1);
    const closed = vi.spyOn(host.closed, "emit");
    host.close();
    expect(closed).not.toHaveBeenCalled();
  });
  // Behavioral ports of cedar-share.controller_test.js and the permission service suites.
  it("removes a separately constructed grant by ID without deleting the group", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
      groupPermissions: [{ group: everyone, role: "viewer" }],
    });
    api.request.mockResolvedValue({
      data: { ...initial, userPermissions: [{ user, role: "viewer" }] },
      etag: '"next"',
    });
    await host.remove({
      node: { "@id": "everyone" },
      kind: "group",
      role: "viewer",
    });
    expect(host.grants.map((g) => g.node["@id"])).toEqual(["user"]);
    expect(host.options.map((p) => p.id)).toContain("everyone");
    expect(api.request.mock.calls[0][1]).toBe("PUT");
    expect(host.notice()).toBe("Permissions saved.");
  });
  it("clears the previous resource's grants and choices while a new read is pending", async () => {
    api.report.mockReturnValue(new Promise(() => {}));
    host.resource = { ...resource, "@id": "next", "schema:name": "Next" };
    void host.load();
    expect(host.permissions()).toBeNull();
    expect(host.current()).toBeNull();
    expect(host.options).toEqual([]);
    expect(host.busy()).toBe(true);
    expect(host.title(host.resource)).toBe("Next");
  });
  it("ignores old report responses after a subsequent load", async () => {
    let resolve!: (value: unknown) => void;
    api.report.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const previous = host.load();
    const next = { ...resource, "@id": "next" };
    host.resource = next;
    api.report.mockResolvedValueOnce({ data: next });
    await host.load();
    resolve({ data: resource });
    await previous;
    expect(host.current()?.["@id"]).toBe("next");
  });
  it("ignores an old user-directory response after a new load", async () => {
    let resolve!: (value: unknown) => void;
    api.request
      .mockImplementationOnce(async () => ({ data: initial, etag: '"old"' }))
      .mockImplementationOnce(async () => ({ data: { groups: [] } }))
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const previous = host.load();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    api.request
      .mockResolvedValueOnce({ data: initial, etag: '"next"' })
      .mockResolvedValueOnce({ data: { groups: [] } })
      .mockResolvedValueOnce({ data: { users: [] } });
    await host.load();
    resolve({ data: { users: [user] } });
    await previous;
    expect(host.people()).toEqual([]);
    expect(host.etag).toBe('"next"');
  });
  it("does not update a destroyed dialog when a late read completes", async () => {
    let resolve!: (value: unknown) => void;
    api.report.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const loading = host.load();
    host.ngOnDestroy();
    resolve({ data: resource });
    await loading;
    expect(host.permissions()).toBeNull();
    expect(host.current()).toBeNull();
  });
  it("closes and refreshes the workspace after ownership transfer even if the former owner loses access", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
    });
    const closed = vi.spyOn(host.closed, "emit");
    api.request.mockResolvedValue({
      data: { ...initial, owner: user },
      etag: '"next"',
    });
    api.report.mockRejectedValue(new HttpError(403, "No longer accessible"));
    await host.transfer(host.grants[0]);
    expect(closed).toHaveBeenCalledWith("Ownership transferred to Other.");
    expect(host.canManage).toBe(false);
    expect(host.busy()).toBe(false);
  });
  it("permits transfer only to a directly granted user, never a directory-only user", async () => {
    await host.transfer({ node: user, kind: "user", role: "viewer" });
    expect(api.request).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("waits for a grant save before another role change, removal, or transfer", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
      groupPermissions: [{ group: everyone, role: "viewer" }],
    });
    const [u, g] = host.grants;
    let resolve!: (value: unknown) => void;
    api.request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const pending = host.remove(g);
    await host.remove(u);
    await host.changeRole(u, "manager");
    await host.transfer(u);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(host.grants).toHaveLength(2);
    resolve({
      data: { ...initial, userPermissions: [{ user, role: "viewer" }] },
      etag: '"next"',
    });
    await pending;
    api.request.mockResolvedValue({ data: initial, etag: '"last"' });
    await host.remove(u);
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(host.notice()).toBe("Permissions saved.");
  });
  it("blocks grant writes while ownership is being transferred", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
      groupPermissions: [{ group: everyone, role: "viewer" }],
    });
    const [u, g] = host.grants;
    api.request.mockReturnValue(new Promise(() => {}));
    void host.transfer(u);
    await host.remove(g);
    await host.changeRole(u, "editor");
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request.mock.calls[0][0]).toBe(
      "/command/transfer-resource-ownership",
    );
    expect(host.grants).toHaveLength(2);
  });
  it("rechecks ownership confirmation if a grant write has begun or the resource changed", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
      groupPermissions: [{ group: everyone, role: "viewer" }],
    });
    const [u, g] = host.grants;
    api.request.mockReturnValue(new Promise(() => {}));
    vi.mocked(window.confirm).mockImplementation(() => {
      void host.remove(g);
      return true;
    });
    await host.transfer(u);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request.mock.calls[0][1]).toBe("PUT");
  });
  it("waits for the recovery read after a rejected grant save", async () => {
    host.permissions.set({
      ...initial,
      userPermissions: [{ user, role: "viewer" }],
    });
    const grant = host.grants[0];
    api.request.mockRejectedValueOnce(new HttpError(412, "Changed"));
    await host.remove(grant);
    await host.changeRole(grant, "editor");
    expect(api.request).toHaveBeenCalledTimes(1);
    let resolve!: (value: unknown) => void;
    api.report.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    api.request
      .mockResolvedValueOnce({
        data: { ...initial, userPermissions: [{ user, role: "viewer" }] },
        etag: '"reloaded"',
      })
      .mockResolvedValueOnce({ data: { groups: [everyone] } })
      .mockResolvedValueOnce({ data: { users: [owner, user] } });
    const recovery = host.load();
    await host.remove(grant);
    expect(api.request).toHaveBeenCalledTimes(3);
    resolve({ data: resource });
    await recovery;
    api.request.mockResolvedValueOnce({ data: initial, etag: '"next"' });
    await host.remove(grant);
    expect(api.request.mock.calls.at(-1)?.[3]).toBe('"reloaded"');
  });
  it("narrows whole user and group extracts and keeps the next ACL revision", async () => {
    const richUser = { ...user, email: "private@example.org" };
    const richGroup = { ...everyone, "schema:description": "All users" };
    host.permissions.set({
      ...initial,
      owner: { ...owner, email: "owner@example.org" } as Principal,
      userPermissions: [{ user: richUser, role: "viewer" }],
      groupPermissions: [{ group: richGroup, role: "viewer" }],
    });
    api.request.mockResolvedValue({
      data: {
        ...initial,
        userPermissions: [{ user, role: "editor" }],
        groupPermissions: [{ group: everyone, role: "viewer" }],
      },
      etag: '"next"',
    });
    await host.changeRole(host.grants[0], "editor");
    expect(api.request.mock.calls[0][2]).toEqual({
      owner: { "@id": "owner" },
      userPermissions: [{ user: { "@id": "user" }, role: "editor" }],
      groupPermissions: [{ group: { "@id": "everyone" }, role: "viewer" }],
    });
    expect(host.notice()).toBe("Permissions saved.");
    await host.remove(host.grants[0]);
    expect(api.request.mock.calls[1][3]).toBe('"next"');
  });
  it("uses capabilities, not editor/manager/owner labels, to authorize each operation", () => {
    for (const role of ["viewer", "editor", "manager"]) {
      host.current.set({
        ...resource,
        currentUserPermissions: {
          role,
          owner: true,
          capabilities: ["readResource", "updateResource"],
        },
      });
      expect(host.canManage).toBe(false);
      expect(host.canTransfer).toBe(false);
    }
    host.current.set({
      ...resource,
      currentUserPermissions: { capabilities: ["manageGrants"] },
    });
    expect(host.canManage).toBe(true);
    expect(host.canTransfer).toBe(false);
  });
});
