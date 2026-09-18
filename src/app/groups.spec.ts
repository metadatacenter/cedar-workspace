import { TestBed } from "@angular/core/testing";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Groups, Group, Member } from "./groups";
import { Backend, HttpError } from "./backend.service";
const g: Group = { "@id": "group/id", "schema:name": "Team" };
const me: Member = {
  user: { "@id": "me", firstName: "Me" },
  administrator: true,
  member: true,
};
const other: Member = {
  user: { "@id": "other", firstName: "Other" },
  administrator: false,
  member: true,
};
describe("Groups", () => {
  let host: Groups;
  let request: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    request = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            request,
            profile: { "@id": "me" },
            config: { groupRestAPI: "https://group.example" },
            init: async () => true,
          },
        },
      ],
    });
    host = TestBed.runInInjectionContext(() => new Groups());
    host.selected.set(g);
    host.members.set([me]);
    host.groups.set([g]);
    host.groupEtag = '"group1"';
    host.memberEtag = '"members1"';
    host.editName = "Team";
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());
  it("writes narrowed details with the group revision and advances it", async () => {
    host.editName = " Renamed ";
    host.editDescription = " Description ";
    request.mockResolvedValue({
      data: { ...g, "schema:name": "Renamed" },
      etag: '"group2"',
    });
    await host.save();
    expect(request).toHaveBeenCalledWith(
      "https://group.example/groups/group%2Fid",
      "PUT",
      { "schema:name": "Renamed", "schema:description": "Description" },
      '"group1"',
    );
    expect(host.groupEtag).toBe('"group2"');
    expect(host.memberEtag).toBe('"members1"');
    expect(host.selected()?.["schema:name"]).toBe("Renamed");
  });
  it("keeps group edits after a conflict without changing the saved listing", async () => {
    host.editName = "Local edit";
    request.mockRejectedValue(new HttpError(412, "changed"));
    await host.save();
    expect(host.editName).toBe("Local edit");
    expect(host.groups()[0]["schema:name"]).toBe("Team");
    expect(host.error()).toBe("changed");
  });
  it("sends identifiers only and the membership revision", async () => {
    host.users.set([other.user]);
    host.newMember = "other";
    request.mockResolvedValue({
      data: { users: [me, other] },
      etag: '"members2"',
    });
    await host.addMember();
    expect(request).toHaveBeenCalledWith(
      "https://group.example/groups/group%2Fid/users",
      "PUT",
      {
        users: [
          { user: { "@id": "me" }, administrator: true, member: true },
          { user: { "@id": "other" }, administrator: false, member: true },
        ],
      },
      '"members1"',
    );
    expect(host.memberEtag).toBe('"members2"');
    expect(host.groupEtag).toBe('"group1"');
  });
  it("keeps the persisted membership on failure and retains the requested new member", async () => {
    host.users.set([other.user]);
    host.newMember = "other";
    request.mockRejectedValue(new HttpError(412, "changed"));
    await host.addMember();
    expect(host.members()).toEqual([me]);
    expect(host.newMember).toBe("other");
  });
  it("protects the last administrator from removal and demotion", async () => {
    await host.removeMember(me);
    await host.toggleAdmin(me);
    expect(request).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("honors cancelled administrator and deletion confirmations", async () => {
    host.members.set([me, other]);
    vi.mocked(window.confirm).mockReturnValue(false);
    await host.toggleAdmin(other);
    await host.remove();
    expect(request).not.toHaveBeenCalled();
  });
  it("never gives special groups or ordinary members admin controls", async () => {
    host.selected.set({ ...g, specialGroup: true });
    await host.remove();
    await host.save();
    expect(host.canAdmin).toBe(false);
    host.selected.set(g);
    host.members.set([{ ...me, administrator: false }]);
    await host.save();
    await host.toggleAdmin(other);
    expect(request).not.toHaveBeenCalled();
  });
  it("treats a forbidden roster as restricted, not empty", async () => {
    request
      .mockResolvedValueOnce({ data: g, etag: '"g"' })
      .mockRejectedValueOnce(new HttpError(403, "forbidden"));
    await host.select(g);
    expect(host.restricted()).toBe(true);
    expect(host.members()).toBeNull();
    expect(host.error()).toBe("");
    expect(host.canAdmin).toBe(false);
  });
  it("ignores a late selection response", async () => {
    let resolve!: (value: unknown) => void;
    request
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce({ data: { ...g, "@id": "new" }, etag: '"new"' })
      .mockResolvedValueOnce({ data: { users: [me] }, etag: '"newMembers"' });
    const first = host.select(g);
    await host.select({ ...g, "@id": "new" });
    resolve({ data: g, etag: '"old"' });
    await first;
    expect(host.selected()?.["@id"]).toBe("new");
    expect(host.groupEtag).toBe('"new"');
  });
  it("serializes writes and blocks selection during a pending mutation", async () => {
    request.mockReturnValue(new Promise(() => {}));
    void host.save();
    await host.remove();
    await host.select({ ...g, "@id": "new" });
    await host.save();
    expect(request).toHaveBeenCalledTimes(1);
    expect(host.selected()?.["@id"]).toBe(g["@id"]);
  });
  it("refuses writes without a read-time revision", async () => {
    host.groupEtag = null;
    await host.save();
    expect(request).not.toHaveBeenCalled();
    expect(host.error()).toContain("revision");
  });
  it("clears privileged membership after demoting yourself", async () => {
    host.members.set([me, { ...other, administrator: true }]);
    request.mockResolvedValue({
      data: {
        users: [
          { ...me, administrator: false },
          { ...other, administrator: true },
        ],
      },
      etag: '"next"',
    });
    await host.toggleAdmin(me);
    expect(host.canAdmin).toBe(false);
    expect(host.members()).toBeNull();
    expect(host.restricted()).toBe(true);
  });
  it("creates a group, loads its independent revisions and clears the creation input", async () => {
    host.newName = " New ";
    const created = { ...g, "@id": "created", "schema:name": "New" };
    request
      .mockResolvedValueOnce({ data: created, etag: '"1"' })
      .mockResolvedValueOnce({ data: created, etag: '"1"' })
      .mockResolvedValueOnce({ data: { users: [me] }, etag: '"m1"' });
    await host.create();
    expect(request.mock.calls[0]).toEqual([
      "https://group.example/groups",
      "POST",
      { "schema:name": "New", "schema:description": "" },
    ]);
    expect(host.newName).toBe("");
    expect(host.selected()).toEqual(created);
    expect(host.canAdmin).toBe(true);
  });
  it("deletes only after confirmation using the group revision", async () => {
    request.mockResolvedValue({ data: undefined });
    await host.remove();
    expect(request).toHaveBeenCalledWith(
      "https://group.example/groups/group%2Fid",
      "DELETE",
      undefined,
      '"group1"',
    );
    expect(host.selected()).toBeNull();
    expect(host.groups()).toEqual([]);
  });
});
