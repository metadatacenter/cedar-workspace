import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { Confirmation } from "./confirmation";
import { Groups } from "./groups";
import { deferred } from "./testing/workspace-fixture";

const group = { "@id": "team", "schema:name": "Team" };
const me = { user: { "@id": "me" }, administrator: true, member: true };
const other = { user: { "@id": "other" }, administrator: false, member: true };
describe("Group confirmation navigation", () => {
  for (const action of ["delete", "promote"])
    for (const tab of ["manage", "create", "delete"] as const)
      for (const approved of [true, false]) {
        it(`expires ${action} after leaving and returning to ${tab}, approved=${approved}`, async () => {
          const reply = deferred<boolean>();
          const request = vi
            .fn()
            .mockResolvedValue({
              data: { users: [me, { ...other, administrator: true }] },
              etag: '"next"',
            });
          const confirm = vi
            .fn()
            .mockReturnValueOnce(reply.promise)
            .mockResolvedValue(true);
          TestBed.configureTestingModule({
            providers: [
              {
                provide: Backend,
                useValue: {
                  request,
                  profile: { "@id": "me" },
                  config: { groupRestAPI: "https://groups.example" },
                },
              },
              { provide: Confirmation, useValue: { confirm } },
            ],
          });
          const host = TestBed.runInInjectionContext(() => new Groups());
          host.groups.set([group]);
          host.selected.set(group);
          host.members.set([me, other]);
          host.groupEtag = '"group"';
          host.memberEtag = '"members"';
          host.activeTab = tab;
          const run = () =>
            action === "delete" ? host.remove() : host.toggleAdmin(other);
          const pending = run();
          await host.selectTab(tab === "manage" ? "delete" : "manage");
          await host.selectTab(tab);
          reply.resolve(approved);
          await pending;
          expect(request).not.toHaveBeenCalled();
          expect(host.selected()).toBe(group);
          expect(host.members()).toEqual([me, other]);
          expect(host.notice()).toBe("");
          await run();
          expect(request).toHaveBeenCalledTimes(1);
        });
      }
  it("does not clear an unresolved write outcome when changing tabs", async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: {} }],
    });
    const host = TestBed.runInInjectionContext(() => new Groups());
    host.stale.set(true);
    await host.selectTab("delete");
    await host.selectTab("manage");
    expect(host.stale()).toBe(true);
  });
});
