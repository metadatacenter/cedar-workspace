// Rendered equivalents of groups.controller_test.js's template checks and
// cedar-share.directive_test.js. Bootstrap visibility/template-string checks
// become native dialog, event, and DOM assertions in the Angular application.
import { TestBed } from "@angular/core/testing";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Groups } from "./groups";
import { PermissionsDialog } from "./permissions-dialog";
import { Resource } from "./resource";
import { Backend } from "./backend.service";

const owner = {
  "@id": "owner",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "private@example.org",
};
const user = {
  "@id": "user",
  firstName: "Grace",
  lastName: "Hopper",
  email: "other@example.org",
};
const group = { "@id": "group", "schema:name": "Researchers" };
const special = {
  "@id": "everyone",
  "schema:name": "Everybody",
  specialGroup: true,
};
const members = [
  { user: owner, administrator: true, member: true },
  { user, administrator: false, member: true },
];
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
beforeEach(() =>
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    }),
  }),
);
afterEach(() => {
  vi.restoreAllMocks();
  if (originalShowModal)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalShowModal,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

describe("Groups legacy view contracts", () => {
  async function render() {
    const request = vi.fn(async (path: string) => {
      if (path === "/users") return { data: { users: [owner, user] } };
      if (path === "https://groups.example/groups")
        return { data: { groups: [group, special] } };
      if (path.endsWith("/users"))
        return { data: { users: members }, etag: '"members"' };
      return { data: group, etag: '"group"' };
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            init: async () => true,
            request,
            config: { groupRestAPI: "https://groups.example" },
            profile: owner,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(Groups);
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.ready()).toBe(true),
    );
    await fixture.whenStable();
    return {
      fixture,
      host: fixture.componentInstance,
      el: fixture.nativeElement as HTMLElement,
      request,
    };
  }
  it("is a standalone Groups page with a workspace back link and separate Manage/Create/Delete panels", async () => {
    const { el, fixture } = await render();
    expect(el.querySelector("h1")?.textContent).toBe("Groups");
    expect(el.querySelector(".account-nav")).toBeNull();
    expect(
      el
        .querySelector('[aria-label="Back to Workspace"]')
        ?.getAttribute("href"),
    ).toBe("/dashboard");
    expect(
      el.querySelector("#manage-groups-tab")?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(el.querySelector("#new-group-name")).toBeNull();
    (el.querySelector("#create-group-tab") as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelector("#new-group-name")).not.toBeNull();
    expect(el.querySelector("#manage-groups-panel")).toBeNull();
    (el.querySelector("#delete-group-tab") as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelector("#delete-group-panel")).not.toBeNull();
    expect(el.querySelector("#create-group-panel")).toBeNull();
  });
  it("renders the Create editor with member removal and last-administrator protection, without group deletion", async () => {
    const { host, el, fixture } = await render();
    host.activeTab = "create";
    host.createdGroup = group;
    await host.select(group);
    await fixture.whenStable();
    expect(
      el.querySelector(".groups-created-group #group-name"),
    ).not.toBeNull();
    expect(el.querySelector("#group-description")).not.toBeNull();
    // The last administrator's controls refuse while keeping focus, so focus reaches their help.
    const lastAdministrator = el.querySelector(
      '[role="checkbox"][aria-label="Ada Lovelace is a Group Administrator"]',
    );
    expect(lastAdministrator?.getAttribute("aria-disabled")).toBe("true");
    expect(lastAdministrator?.getAttribute("aria-checked")).toBe("true");
    expect(
      lastAdministrator?.querySelector("input")?.hasAttribute("disabled"),
    ).toBe(true);
    const bin = el.querySelector(
      '[aria-label="Remove Ada Lovelace from the group"]',
    );
    expect(bin?.hasAttribute("disabled")).toBe(false);
    expect(bin?.getAttribute("aria-disabled")).toBe("true");
    expect(
      el.querySelector(`[id="${bin?.getAttribute("aria-describedby")}"]`)
        ?.textContent,
    ).toBe("Assign another Group Administrator before removing this member.");
    expect(
      el.querySelector(
        '[data-cedar-help="Assign another Group Administrator before removing this member."]',
      ),
    ).not.toBeNull();
    expect(el.querySelector('[aria-label="Delete group"] svg')).toBeNull();
    expect(
      el.querySelector('[aria-label="Remove Grace Hopper from the group"] svg'),
    ).not.toBeNull();
    expect(el.textContent).toContain("Save");
    // The label is a translated binding, so it is read from the rendered picker.
    expect(
      el.querySelector('cedar-group-picker label[for="new-group-member-input"]')
        ?.textContent,
    ).toBe("Add a member");
    expect(el.textContent).not.toContain("@example.org");
  });
  it("keeps search independent from the selected editor and never claims an unreadable roster is empty", async () => {
    const { fixture, host, el } = await render();
    const search = el.querySelector(
      'input[role="combobox"]',
    ) as HTMLInputElement;
    search.value = "Researchers";
    search.dispatchEvent(new Event("input"));
    await fixture.whenStable();
    (el.querySelector('[role="option"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(search.value).toBe("");
    expect((el.querySelector("#group-name") as HTMLInputElement).value).toBe(
      "Researchers",
    );
    host.members.set(null);
    host.restricted.set(true);
    await fixture.whenStable();
    expect(el.textContent).toContain(
      "Only administrators of this group can view its member list.",
    );
    expect(el.textContent).not.toContain("This group has no members.");
    host.restricted.set(false);
    host.error.set("Roster unavailable");
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      "Roster unavailable",
    );
    expect(el.textContent).not.toContain("This group has no members.");
  });
  it("leaves a cancelled administrator checkbox and roster unchanged", async () => {
    const { fixture, host, el, request } = await render();
    await host.select(group);
    await fixture.whenStable();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    request.mockClear();
    const checkbox = el.querySelector(
      'input[aria-label="Grace Hopper is a Group Administrator"]',
    ) as HTMLInputElement;
    checkbox.click();
    await fixture.whenStable();
    expect(checkbox.checked).toBe(false);
    expect(host.members()?.[1].administrator).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("Permissions legacy view contracts", () => {
  async function render(
    capabilities = ["readResource", "manageGrants", "transferOwnership"],
    kind = "template",
    access: Resource["currentUserPermissions"] = {},
  ) {
    const resource = {
      "@id": "artifact",
      resourceType: kind,
      "schema:name": "Study",
      currentUserPermissions: { capabilities, ...access },
    };
    const request = vi.fn(async (path: string) => {
      if (path === "/users") return { data: { users: [owner, user] } };
      if (path.endsWith("/groups"))
        return { data: { groups: [group, special] } };
      return {
        data: {
          owner,
          userPermissions: [{ user, role: "editor" }],
          groupPermissions: [
            { group, role: "viewer" },
            {
              group: { "@id": "everyone", "schema:name": "Everybody" },
              role: "viewer",
            },
          ],
        },
        etag: '"permissions"',
      };
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            request,
            report: async () => ({ data: resource }),
            path: () => "/templates/artifact",
            config: { groupRestAPI: "https://groups.example" },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(PermissionsDialog);
    fixture.componentRef.setInput("resource", resource);
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.busy()).toBe(false),
    );
    await fixture.whenStable();
    return {
      fixture,
      host: fixture.componentInstance,
      el: fixture.nativeElement as HTMLElement,
      request,
    };
  }
  it("opens a native Permissions dialog with one user/group flow, the resource context, and role vocabulary", async () => {
    const { el, host } = await render();
    expect(el.querySelector("dialog")?.open).toBe(true);
    expect(el.querySelector("h2")?.textContent?.trim()).toBe("Permissions");
    expect(el.querySelector(".resource-name")?.textContent).toBe("Study");
    expect(el.querySelectorAll("cedar-group-picker")).toHaveLength(1);
    expect(el.textContent).toContain("Add users or groups");
    expect(el.textContent).toContain("Owner and direct role assignments");
    expect(
      el.querySelector('[role="columnheader"].type-cell')?.textContent,
    ).toBe("Type");
    expect(
      [...el.querySelectorAll("#share-role option")].map((o) =>
        o.textContent?.trim(),
      ),
    ).toEqual(["Viewer", "Editor", "Manager"]);
    expect(el.textContent).not.toContain("@example.org");
    const closed = vi.spyOn(host.closed, "emit");
    [...el.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Done")!
      .click();
    expect(closed).toHaveBeenCalledOnce();
  });
  it("displays the saved role on initial render and after reloading permissions", async () => {
    const { host, el, fixture } = await render();
    const role = () =>
      el.querySelector(
        'select[aria-label="Role for Grace Hopper"]',
      ) as HTMLSelectElement;
    expect(role().value).toBe("editor");
    await host.load();
    await fixture.whenStable();
    expect(role().value).toBe("editor");
  });
  it("keeps ownership separate, protects the owner and groups, and uses compact bin actions", async () => {
    const { el } = await render();
    const ownerCheck = el.querySelector(
      'input[aria-label="Ada Lovelace is the owner"]',
    ) as HTMLInputElement;
    expect(ownerCheck.checked).toBe(true);
    expect(ownerCheck.disabled).toBe(true);
    expect(
      el.querySelector('[aria-label="Ownership is separate from roles"]'),
    ).not.toBeNull();
    expect(
      (
        el.querySelector(
          '[aria-label="The owner cannot be removed"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        el.querySelector(
          '[aria-label="Make Researchers the owner"]',
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        el.querySelector(
          '[aria-label="Make Grace Hopper the owner"]',
        ) as HTMLInputElement
      ).disabled,
    ).toBe(false);
    expect(el.querySelector('option[value="owner"]')).toBeNull();
    expect(
      el.querySelector(
        '[aria-label="Remove direct role for Researchers"] cedar-icon[name="trash"]',
      ),
    ).not.toBeNull();
    expect(
      [
        ...el.querySelectorAll('select[aria-label="Role for Everyone"] option'),
      ].map((o) => o.textContent?.trim()),
    ).toEqual(["Viewer"]);
  });
  it("explains inherited folder access without embedding group administration", async () => {
    const { el } = await render(undefined, "folder");
    expect(el.textContent).toContain(
      "Access granted here also applies to the resources this folder contains.",
    );
    expect(el.textContent).not.toContain("Manage groups");
    expect(el.textContent).not.toContain("Create group");
    expect(el.querySelector("#new-group-name")).toBeNull();
  });
  it("allows viewers to inspect roles but not edit grants or ownership", async () => {
    const { el } = await render(["readResource"]);
    expect(el.textContent).toContain(
      "You cannot change roles on this resource.",
    );
    expect(el.querySelector("cedar-group-picker")).toBeNull();
    expect(
      (
        el.querySelector(
          'select[aria-label="Role for Grace Hopper"]',
        ) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        el.querySelector(
          '[aria-label="Make Grace Hopper the owner"]',
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      el.querySelector('[aria-label="Remove direct role for Grace Hopper"]'),
    ).toBeNull();
  });
  it.each([
    ["viewer", false], ["editor", false], ["manager", true],
  ] as const)("explains the caller's %s role independently of the direct assignments", async (role, manages) => {
    const { el } = await render(manages ? ["readResource", "manageGrants"] : ["readResource"], "template", { role, owner: false });
    const summary = el.querySelector(".caller-access")!.textContent;
    expect(summary).toContain(`Your role: ${role[0].toUpperCase() + role.slice(1)}.`);
    expect(summary).toContain(manages ? "You can change roles" : "You cannot change roles");
    expect(el.querySelector(".role-help")?.textContent).toContain("can view, edit and delete.");
    expect(el.textContent).toContain("Removing a direct role may leave access");
  });
  it("describes ownership without promising grant management on a protected folder", async () => {
    const { el } = await render(["readResource"], "folder", { owner: true, role: "manager" });
    expect(el.querySelector(".caller-access")?.textContent).toContain("You own this resource. You cannot change roles on this resource.");
    expect(el.querySelector(".caller-access")?.textContent).not.toContain("Your role:");
  });
  it("does not infer a role from administrative capabilities or infer denial from missing data", async () => {
    const { host, el, fixture } = await render();
    expect(el.querySelector(".caller-access")?.textContent).toContain("Your role is not available. You can change roles");
    host.current.set({ ...host.resource, currentUserPermissions: {} });
    await fixture.whenStable();
    expect(el.querySelector(".caller-access")?.textContent).toContain("Your ability to change roles could not be determined.");
    expect(el.querySelector(".caller-access")?.textContent).not.toContain("You cannot");
    host.current.set(null);
    await fixture.whenStable();
    expect(el.querySelector(".caller-access")).toBeNull();
  });
  it("keeps the mounted native dialog open on Escape during a pending save", async () => {
    const { host, el } = await render();
    host.busy.set(true);
    const closed = vi.spyOn(host.closed, "emit");
    const dialog = el.querySelector("dialog")!;
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(closed).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
    host.busy.set(false);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(closed).toHaveBeenCalledOnce();
  });
});
