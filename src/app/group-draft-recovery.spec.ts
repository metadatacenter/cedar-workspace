import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { Groups } from "./groups";
const group = {
  "@id": "team",
  "schema:name": "Team",
  "schema:description": "Original",
};
const me = { user: { "@id": "me" }, administrator: true, member: true };

describe("Group draft recovery", () => {
  for (const status of [0, 412, 503])
    for (const edited of ["name", "description", "both"]) {
      it(`keeps edited ${edited} after ${status} and uses the recovered revision`, async () => {
        const request = vi.fn();
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
          ],
        });
        const host = TestBed.runInInjectionContext(() => new Groups());
        host.selected.set(group);
        host.groups.set([group]);
        host.members.set([me]);
        host.groupEtag = '"old"';
        host.memberEtag = '"roster"';
        host.editName = edited === "description" ? "Team" : "My name";
        host.editDescription = edited === "name" ? "Original" : "";
        request.mockRejectedValue(new HttpError(status, "Write failed"));
        await host.save();
        expect(host.stale()).toBe(true);
        request.mockRejectedValue(new HttpError(503, "Read failed"));
        await host.select(host.recoveryGroup()!);
        expect(host.selected()).toBe(group);
        expect(host.stale()).toBe(true);
        const fresh = {
          ...group,
          "schema:name": "Server name",
          "schema:description": "Server description",
        };
        request.mockImplementation(async (path: string) => ({
          data: path.endsWith("/users") ? { users: [me] } : fresh,
          etag: '"fresh"',
        }));
        await host.select(host.recoveryGroup()!);
        expect(host.editName).toBe(
          edited === "description" ? "Server name" : "My name",
        );
        expect(host.editDescription).toBe(
          edited === "name" ? "Server description" : "",
        );
        expect(host.selected()).toEqual(fresh);
        expect(host.stale()).toBe(false);
        request.mockClear();
        request.mockResolvedValue({
          data: {
            ...fresh,
            "schema:name": host.editName,
            "schema:description": host.editDescription,
          },
          etag: '"saved"',
        });
        await host.save();
        expect(request.mock.calls[0][3]).toBe('"fresh"');
      });
    }
  it("retains the draft but disables saving when recovery revokes administration", async () => {
    const request = vi.fn(async (path: string) => ({
      data: path.endsWith("/users")
        ? { users: [{ ...me, administrator: false }] }
        : group,
      etag: '"fresh"',
    }));
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
      ],
    });
    const host = TestBed.runInInjectionContext(() => new Groups());
    host.selected.set(group);
    host.members.set([me]);
    host.stale.set(true);
    host.recoveryGroup.set(group);
    host.editName = "My draft";
    host.editDescription = "Original";
    await host.select(group);
    expect(host.editName).toBe("My draft");
    expect(host.canAdmin).toBe(false);
    request.mockClear();
    await host.save();
    expect(request).not.toHaveBeenCalled();
  });
});
