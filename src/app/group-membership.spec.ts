import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { Confirmation } from "./confirmation";
import { Groups, CallerMembership } from "./groups";

const group = { "@id": "team", "schema:name": "Team" };
const otherGroup = { "@id": "other", "schema:name": "Other" };
const me = { user: { "@id": "me" }, member: true, administrator: true };
const admin = { user: { "@id": "admin" }, member: true, administrator: true };

async function render(
  membership: unknown = { member: false, administrator: false },
) {
  const readMembership = vi.fn(async (): Promise<unknown> => membership);
  const request = vi.fn(
    async (path: string): Promise<{ data: unknown; etag?: string }> => {
      if (path.endsWith("/membership/me"))
        return { data: await readMembership() };
      if (path === "/users") return { data: { users: [] } };
      if (path.endsWith("/users")) throw new HttpError(403, "Forbidden");
      if (path.endsWith("/groups"))
        return { data: { groups: [group, otherGroup] } };
      return {
        data: path.endsWith("/other") ? otherGroup : group,
        etag: '"1"',
      };
    },
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Backend,
        useValue: {
          init: async () => true,
          request,
          profile: { "@id": "me" },
          config: { groupRestAPI: "https://groups.example" },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Groups);
  fixture.detectChanges();
  await vi.waitFor(() => expect(fixture.componentInstance.ready()).toBe(true));
  await fixture.whenStable();
  const host = fixture.componentInstance;
  return {
    fixture,
    host,
    request,
    readMembership,
    el: fixture.nativeElement as HTMLElement,
  };
}

describe("the caller's group membership", () => {
  it.each([
    [
      false,
      "You are not a member of this group. You can view its name and description.",
    ],
    [true, "You are a member of this group, but not a Group Administrator."],
  ] as const)(
    "explains membership %s without exposing a roster or enabling writes",
    async (member, message) => {
      const { fixture, host, el } = await render({
        member,
        administrator: false,
      });
      await host.select(group);
      await fixture.whenStable();
      expect(el.textContent).toContain(message);
      expect(el.textContent).toContain(
        "Only administrators of this group can view its member list.",
      );
      expect(el.querySelector("#group-name")?.hasAttribute("disabled")).toBe(
        true,
      );
      expect(el.querySelector(".groups-member-count")).toBeNull();
      expect(el.querySelector(".groups-add-member")).toBeNull();
      expect(host.canAdmin).toBe(false);
      (el.querySelector("#delete-group-tab") as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(el.textContent).toContain(message);
      expect(el.textContent).toContain(
        "Only administrators of this group can delete it.",
      );
      expect(el.querySelector(".groups-delete-button")).toBeNull();
    },
  );

  it.each([404, 403, 500, "malformed", "partial", "missing"])(
    "keeps membership unknown after %s and preserves group details",
    async (outcome) => {
      const { fixture, host, el, readMembership } = await render();
      host.callerMembership.set({ member: false, administrator: false });
      readMembership.mockImplementation(async () => {
        if (typeof outcome === "number")
          throw new HttpError(outcome, "Unavailable");
        return outcome === "malformed"
          ? { member: "false", administrator: false }
          : outcome === "partial"
            ? { member: false }
            : undefined;
      });
      await host.select(group);
      await fixture.whenStable();
      expect(host.callerMembership()).toBeNull();
      expect(host.selected()).toEqual(group);
      expect(host.error()).toBe("");
      expect(el.textContent).toContain(
        "You can view this group's name and description.",
      );
      expect(el.textContent).not.toContain("You are not a member");
      expect(el.textContent).not.toContain("You are a member");
      expect(host.canAdmin).toBe(false);
    },
  );

  it("does not carry membership into another group or accept a late reply", async () => {
    const { host, readMembership } = await render();
    await host.select(group);
    let resolve!: (value: CallerMembership) => void;
    readMembership.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const oldSelection = host.select(group);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    expect(host.callerMembership()).toBeNull();
    readMembership.mockResolvedValue({ member: true, administrator: false });
    await host.select(otherGroup);
    resolve({ member: false, administrator: false });
    await oldSelection;
    expect(host.selected()).toEqual(otherGroup);
    expect(host.callerMembership()).toEqual({
      member: true,
      administrator: false,
    });
  });

  it("keeps the built-in group explanation and hides its roster", async () => {
    const { host, request, fixture, el } = await render();
    const everyone = { ...group, specialGroup: "EVERYBODY" };
    request.mockResolvedValueOnce({ data: everyone, etag: '"1"' });
    await host.select(everyone);
    await fixture.whenStable();
    expect(el.textContent).toContain(
      "This built-in group contains every CEDAR user and cannot be changed.",
    );
    expect(el.textContent).not.toContain("You are not a member");
    expect(
      request.mock.calls.some(([path]) => path.endsWith("/team/users")),
    ).toBe(false);
    expect(host.canAdmin).toBe(false);
  });

  it.each(["demote", "remove"])(
    "updates own status after self-%s without retaining the roster",
    async (action) => {
      const { host, request, readMembership } = await render();
      host.selected.set(group);
      host.members.set([me, admin]);
      host.memberEtag = '"1"';
      host.callerMembership.set({ member: true, administrator: true });
      vi.spyOn(TestBed.inject(Confirmation), "confirm").mockResolvedValue(true);
      const users =
        action === "demote"
          ? [{ ...me, administrator: false }, admin]
          : [admin];
      request.mockResolvedValueOnce({ data: { users }, etag: '"2"' });
      if (action === "demote") await host.toggleAdmin(me);
      else await host.removeMember(me);
      expect(host.callerMembership()).toEqual({
        member: action === "demote",
        administrator: false,
      });
      expect(host.members()).toBeNull();
      expect(host.restricted()).toBe(true);
      expect(host.canAdmin).toBe(false);
      expect(readMembership).not.toHaveBeenCalled();
    },
  );
});
