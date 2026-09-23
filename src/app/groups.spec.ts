import { Confirmation } from "./confirmation";
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
    vi.spyOn(TestBed.inject(Confirmation), "confirm").mockResolvedValue(true);
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
    expect(host.recoveryGroup()).toEqual(g);
  });
  it("does not offer an older selected group as recovery for a duplicate creation name", async () => {
    await host.selectTab("create");
    host.newName = "Existing name";
    request.mockRejectedValue(new HttpError(409, "Group names must be unique"));
    await host.create();
    expect(host.error()).toBe("Group names must be unique");
    expect(host.newName).toBe("Existing name");
    expect(host.selected()).toEqual(g);
    expect(host.recoveryGroup()).toBeNull();
  });
  it("offers the failed read's group for recovery even before it can be selected", async () => {
    request.mockRejectedValue(new HttpError(503, "Temporarily unavailable"));
    await host.select(g);
    expect(host.selected()).toBeNull();
    expect(host.recoveryGroup()).toEqual(g);
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
    expect(TestBed.inject(Confirmation).confirm).not.toHaveBeenCalled();
  });
  it("honors cancelled administrator and deletion confirmations", async () => {
    host.members.set([me, other]);
    vi.mocked(TestBed.inject(Confirmation).confirm).mockResolvedValue(false);
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
  // Behavioral ports of legacy groups.controller_test.js and group-etag.service_test.js.
  it("starts in Manage, sorts user names, and calls the built-in group Everyone", async () => {
    request
      .mockResolvedValueOnce({
        data: { groups: [{ ...g, specialGroup: true }] },
      })
      .mockResolvedValueOnce({ data: { users: [other.user, me.user] } });
    await host.ngOnInit();
    expect(host.activeTab).toBe("manage");
    expect(host.users().map(host.userName)).toEqual(["Me", "Other"]);
    expect(host.groupOptions[0].label).toBe("Everyone");
  });
  it("adds descriptions to group choices only when they contain text", () => {
    host.groups.set([{ ...g, "schema:description": " Genomics team " }]);
    expect(host.groupOptions[0].label).toBe("Team - Genomics team");
    host.groups.set([{ ...g, "schema:description": "  " }]);
    expect(host.groupOptions[0].label).toBe("Team");
  });
  it("does not expose email addresses as member names", () => {
    expect(
      host.userName({
        "@id": "id",
        email: "private@example.org",
      } as Member["user"]),
    ).toBe("Unnamed user");
  });
  it("serializes creation, retains failed input, and permits retry", async () => {
    let reject!: (e: Error) => void;
    host.newName = "Researchers";
    request.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    const pending = host.create();
    await host.create();
    expect(request).toHaveBeenCalledTimes(1);
    reject(new Error("Unavailable"));
    await pending;
    expect(host.newName).toBe("Researchers");
    request.mockRejectedValueOnce(new Error("Still unavailable"));
    await host.create();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("stays in Create, clears Manage's selection, and restores the created editor on return", async () => {
    await host.selectTab("create");
    host.newName = "New";
    const created = { ...g, "@id": "created", "schema:name": "New" };
    request
      .mockResolvedValueOnce({ data: created })
      .mockResolvedValueOnce({ data: created, etag: '"g"' })
      .mockResolvedValueOnce({ data: { users: [me] }, etag: '"m"' });
    await host.create();
    expect(host.activeTab).toBe("create");
    expect(host.createdGroup).toEqual(created);
    expect(host.selected()).toEqual(created);
    expect(host.newName).toBe("");
    await host.selectTab("manage");
    expect(host.selected()).toBeNull();
    expect(host.createdGroup).toEqual(created);
    request
      .mockResolvedValueOnce({ data: created, etag: '"g2"' })
      .mockResolvedValueOnce({ data: { users: [me] }, etag: '"m2"' });
    await host.selectTab("create");
    expect(host.selected()).toEqual(created);
    expect(host.canAdmin).toBe(true);
  });
  it("reports roster failures other than forbidden and does not call them an empty roster", async () => {
    request
      .mockResolvedValueOnce({ data: g, etag: '"g"' })
      .mockRejectedValueOnce(new HttpError(500, "Roster unavailable"));
    await host.select(g);
    expect(host.error()).toBe("Roster unavailable");
    expect(host.restricted()).toBe(false);
    expect(host.members()).toBeNull();
  });
  it("recognizes administration only for the signed-in CEDAR identifier", () => {
    host.members.set([{ ...me, user: { ...me.user, "@id": "someone-else" } }]);
    expect(host.canAdmin).toBe(false);
    host.members.set([me]);
    expect(host.canAdmin).toBe(true);
  });
  it("keeps administrator state unchanged when confirmation or the save fails", async () => {
    host.members.set([me, other]);
    vi.mocked(TestBed.inject(Confirmation).confirm).mockResolvedValueOnce(
      false,
    );
    await host.toggleAdmin(other);
    expect(host.members()).toEqual([me, other]);
    request.mockRejectedValueOnce(new Error("Unavailable"));
    await host.toggleAdmin(other);
    expect(host.members()).toEqual([me, other]);
  });
  it("confirms administrator removal and announces the successful membership update", async () => {
    const admin = { ...other, administrator: true };
    host.members.set([me, admin]);
    request.mockResolvedValue({ data: { users: [me, other] }, etag: '"m2"' });
    await host.toggleAdmin(admin);
    expect(TestBed.inject(Confirmation).confirm).toHaveBeenCalledWith(
      "Remove administrator access for Other?",
    );
    expect(host.members()).toEqual([me, other]);
    expect(host.notice()).toBe("Group members saved.");
  });
  it("does not delete another selection if it changes during confirmation", async () => {
    const next = { ...g, "@id": "next" };
    vi.mocked(TestBed.inject(Confirmation).confirm).mockImplementation(
      async () => {
        host.selected.set(next);
        return true;
      },
    );
    await host.remove();
    expect(request).not.toHaveBeenCalled();
    expect(host.selected()).toEqual(next);
  });
  it("removes a separately loaded group by identifier and announces deletion", async () => {
    const keep = { ...g, "@id": "keep" };
    host.groups.set([g, keep]);
    host.selected.set({ ...g });
    host.createdGroup = g;
    request.mockResolvedValue({ data: undefined });
    await host.remove();
    expect(host.groups()).toEqual([keep]);
    expect(host.createdGroup).toBeNull();
    expect(host.notice()).toBe("Group deleted.");
  });
  it("keeps the autocomplete entry and selected editor when deletion fails", async () => {
    request.mockRejectedValue(new HttpError(412, "Changed"));
    await host.remove();
    expect(host.groups()).toEqual([g]);
    expect(host.selected()).toEqual(g);
    expect(host.error()).toBe("Changed");
  });
  it("offers only nonmembers and refuses duplicate member additions", async () => {
    host.users.set([me.user, other.user]);
    expect(host.availableUsers).toEqual([other.user]);
    host.newMember = "me";
    await host.addMember();
    expect(request).not.toHaveBeenCalled();
  });
  it("confirms member removal, updates the roster, and restores that user to the picker", async () => {
    host.users.set([me.user, other.user]);
    host.members.set([me, other]);
    request.mockResolvedValue({ data: { users: [me] }, etag: '"m2"' });
    await host.removeMember(other);
    expect(TestBed.inject(Confirmation).confirm).toHaveBeenCalledWith(
      "Remove Other from this group?",
    );
    expect(host.members()).toEqual([me]);
    expect(host.availableUsers).toEqual([other.user]);
    expect(host.notice()).toBe("Group members saved.");
  });
  it("serializes membership edits and prevents a tab or selection change while saving", async () => {
    host.members.set([me, other]);
    host.users.set([me.user, other.user]);
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const pending = host.removeMember(other);
    await host.toggleAdmin(other);
    await host.selectTab("create");
    expect(host.activeTab).toBe("manage");
    expect(request).toHaveBeenCalledTimes(1);
    resolve({ data: { users: [me] }, etag: '"m2"' });
    await pending;
    host.newMember = "other";
    request.mockResolvedValue({ data: { users: [me, other] }, etag: '"m3"' });
    await host.addMember();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("blocks stale membership writes until the explicit recovery read completes", async () => {
    host.members.set([me, other]);
    request.mockRejectedValueOnce(new HttpError(412, "Changed"));
    await host.removeMember(other);
    await host.toggleAdmin(other);
    expect(request).toHaveBeenCalledTimes(1);
    let resolve!: (value: unknown) => void;
    request
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce({
        data: { users: [me, other] },
        etag: '"new-members"',
      });
    const reload = host.select(g);
    await host.toggleAdmin(other);
    expect(request).toHaveBeenCalledTimes(2);
    resolve({ data: g, etag: '"new-group"' });
    await reload;
    request.mockResolvedValueOnce({
      data: { users: [me] },
      etag: '"next-members"',
    });
    await host.removeMember(other);
    expect(request.mock.calls.at(-1)?.[3]).toBe('"new-members"');
  });
  it("advances the membership revision on every save without changing the group revision", async () => {
    host.users.set([me.user, other.user]);
    for (let revision = 2; revision <= 5; revision++) {
      if (revision % 2 === 0) {
        host.newMember = "other";
        request.mockResolvedValueOnce({
          data: { users: [me, other] },
          etag: '"members' + revision + '"',
        });
        await host.addMember();
      } else {
        request.mockResolvedValueOnce({
          data: { users: [me] },
          etag: '"members' + revision + '"',
        });
        await host.removeMember(other);
      }
      expect(request.mock.calls.at(-1)?.[3]).toBe(
        '"members' + (revision - 1) + '"',
      );
      expect(host.memberEtag).toBe('"members' + revision + '"');
      expect(host.groupEtag).toBe('"group1"');
    }
  });
});
