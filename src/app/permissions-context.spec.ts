import { TestBed } from "@angular/core/testing";
import { expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { PermissionsDialog } from "./permissions-dialog";
import { Confirmation } from "./confirmation";
import { deferred } from "./testing/workspace-fixture";
import type { Resource } from "./resource";
const owner = {"@id": "owner"}, user = {"@id": "user"};
const acl = {owner, userPermissions: [{user, role: "viewer"}], groupPermissions: []};
const r = (id: string, writable = true): Resource => ({"@id": id, resourceType: "template", currentUserPermissions: {capabilities: writable ? ["manageGrants", "transferOwnership"] : []}});
async function rig() {
  const api = {path: (r: Resource) => "/templates/" + r["@id"], config: {groupRestAPI: "https://groups.example"}, report: vi.fn(async (r: Resource) => ({data: r})), request: vi.fn(async (path: string) => ({data: path.endsWith("/groups") ? {groups: []} : path === "/users" ? {users: [owner, user]} : acl, etag: path.includes("/b/") ? '"b"' : '"a"'}))};
  TestBed.configureTestingModule({providers: [{provide: Backend, useValue: api}]});
  const host = TestBed.runInInjectionContext(() => new PermissionsDialog());
  host.resource = r("a"); host.ngOnInit();
  await vi.waitFor(() => expect(host.busy()).toBe(false));
  return {host, api};
}
for (const phase of ["read", "write", "confirmation"])
  for (const writable of [true, false])
    it(`a rebound resource ignores the old ${phase}, writable=${writable}`, async () => {
      const {host, api} = await rig();
      const pending = deferred<any>();
      let work: Promise<unknown>;
      const closed = vi.spyOn(host.closed, "emit");
      if (phase === "read") { api.request.mockReturnValueOnce(pending.promise); work = host.load(); }
      else if (phase === "write") { api.request.mockReturnValueOnce(pending.promise); work = host.changeRole(host.grants[0], "editor"); }
      else { vi.spyOn(TestBed.inject(Confirmation), "confirm").mockReturnValueOnce(pending.promise); work = host.transfer(host.grants[0]); }
      host.resource = r("b", writable);
      expect(host.current()).toBeNull();
      expect(host.etag).toBeNull();
      await vi.waitFor(() => expect(host.busy()).toBe(false));
      pending.resolve(phase === "confirmation" ? true : {data: acl, etag: '"old"'});
      await work;
      expect(host.current()?.["@id"]).toBe("b");
      expect(host.etag).toBe('"b"');
      expect(host.canManage).toBe(writable);
      expect(host.error()).toBe("");
      expect(closed).not.toHaveBeenCalled();
      host.ngOnDestroy();
    });
it("the host cannot retarget a loaded ACL by mutating its input object", async () => {
  const {host, api} = await rig();
  const input = r("b"); host.resource = input;
  await vi.waitFor(() => expect(host.busy()).toBe(false));
  input["@id"] = "unread-resource";
  api.request.mockClear();
  await host.changeRole(host.grants[0], "editor");
  expect(api.request.mock.calls[0][0]).toBe("/templates/b/permissions");
  host.ngOnDestroy();
});
