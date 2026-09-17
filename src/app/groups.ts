import { Component, OnInit, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Backend, HttpError } from "./backend.service";
import { AccountShell } from "./account-shell";
export interface Group {
  "@id": string;
  "schema:name": string;
  "schema:description"?: string;
  specialGroup?: boolean | string;
}
export interface GroupUser {
  "@id": string;
  firstName?: string;
  lastName?: string;
}
export interface Member {
  user: GroupUser;
  administrator: boolean;
  member: boolean;
}
export const groupName = (g: Group) =>
  g.specialGroup ? "Everyone" : g["schema:name"];
export const userName = (u: GroupUser) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ") || "Unnamed user";
@Component({
  selector: "cedar-groups-page",
  imports: [FormsModule, AccountShell],
  templateUrl: "./groups.html",
})
export class Groups implements OnInit {
  readonly api = inject(Backend);
  readonly loading = signal(true);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly groups = signal<Group[]>([]);
  readonly users = signal<GroupUser[]>([]);
  readonly selected = signal<Group | null>(null);
  readonly members = signal<Member[] | null>(null);
  readonly restricted = signal(false);
  readonly selecting = signal(false);
  groupEtag: string | null = null;
  memberEtag: string | null = null;
  private generation = 0;
  search = "";
  newName = "";
  editName = "";
  editDescription = "";
  newMember = "";
  readonly groupName = groupName;
  readonly userName = userName;
  get base() {
    return this.api.config.groupRestAPI.replace(/\/$/, "") + "/groups";
  }
  path(g: Group) {
    return this.base + "/" + encodeURIComponent(g["@id"]);
  }
  get filteredGroups() {
    return this.groups()
      .filter((g) =>
        (groupName(g) + " " + (g["schema:description"] || ""))
          .toLowerCase()
          .includes(this.search.toLowerCase()),
      )
      .sort((a, b) => groupName(a).localeCompare(groupName(b)));
  }
  get availableUsers() {
    return this.users().filter(
      (u) => !this.members()?.some((m) => m.user["@id"] === u["@id"]),
    );
  }
  get canAdmin() {
    const g = this.selected();
    return (
      !!g &&
      !g.specialGroup &&
      !this.selecting() &&
      !!this.members()?.some(
        (m) => m.administrator && m.user["@id"] === this.api.profile["@id"],
      )
    );
  }
  onlyAdmin(m: Member) {
    return (
      m.administrator &&
      this.members()?.filter((u) => u.administrator).length === 1
    );
  }
  async ngOnInit() {
    try {
      if (!(await this.api.init())) return;
      const [groups, users] = await Promise.all([
        this.api.request<{ groups: Group[] }>(this.base),
        this.api.request<{ users: GroupUser[] }>("/users"),
      ]);
      this.groups.set(groups.data.groups || []);
      this.users.set(
        (users.data.users || []).sort((a, b) =>
          userName(a).localeCompare(userName(b)),
        ),
      );
      this.ready.set(true);
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading.set(false);
    }
  }
  private fail(e: unknown) {
    this.error.set(e instanceof Error ? e.message : String(e));
  }
  async select(g: Group) {
    if (this.busy()) return;
    await this.load(g);
  }
  private async load(g: Group) {
    const generation = ++this.generation;
    this.selected.set(null);
    this.members.set(null);
    this.restricted.set(false);
    this.selecting.set(true);
    this.groupEtag = this.memberEtag = null;
    this.error.set("");
    this.newMember = "";
    try {
      const detail = await this.api.request<Group>(this.path(g));
      if (generation !== this.generation) return;
      this.selected.set(detail.data);
      this.groups.update((groups) =>
        groups.map((value) =>
          value["@id"] === g["@id"] ? detail.data : value,
        ),
      );
      this.groupEtag = detail.etag;
      this.editName = groupName(detail.data);
      this.editDescription = detail.data["schema:description"] || "";
      if (detail.data.specialGroup) {
        this.restricted.set(true);
        return;
      }
      try {
        const roster = await this.api.request<{ users: Member[] }>(
          this.path(g) + "/users",
        );
        if (generation !== this.generation) return;
        this.memberEtag = roster.etag;
        this.members.set(roster.data.users || []);
      } catch (e) {
        if (generation !== this.generation) return;
        if (e instanceof HttpError && e.status === 403)
          this.restricted.set(true);
        else this.fail(e);
      }
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    } finally {
      if (generation === this.generation) this.selecting.set(false);
    }
  }
  private requireEtag(value: string | null) {
    if (!value)
      throw new Error(
        "The server did not return a revision. Reload this group before making changes.",
      );
    return value;
  }
  private async write(action: () => Promise<void>, message: string) {
    if (this.busy() || this.selecting()) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await action();
      this.notice.set(message);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  async create() {
    const name = this.newName.trim();
    if (!name) return;
    await this.write(async () => {
      const r = await this.api.request<Group>(this.base, "POST", {
        "schema:name": name,
        "schema:description": "",
      });
      this.groups.update((gs) => [...gs, r.data]);
      this.newName = "";
      this.search = "";
      await this.load(r.data);
    }, "Group created.");
  }
  async save() {
    const g = this.selected();
    if (!g || !this.canAdmin || !this.editName.trim()) return;
    const body = {
      "schema:name": this.editName.trim(),
      "schema:description": this.editDescription.trim(),
    };
    await this.write(async () => {
      const r = await this.api.request<Group>(
        this.path(g),
        "PUT",
        body,
        this.requireEtag(this.groupEtag),
      );
      this.groupEtag = r.etag;
      const current = { ...g, ...body };
      this.selected.set(current);
      this.groups.update((gs) =>
        gs.map((v) => (v["@id"] === g["@id"] ? current : v)),
      );
    }, "Group details saved.");
  }
  async remove() {
    const g = this.selected();
    if (
      !g ||
      !this.canAdmin ||
      this.busy() ||
      !window.confirm("Delete group “" + groupName(g) + "”?")
    )
      return;
    await this.write(async () => {
      await this.api.request(
        this.path(g),
        "DELETE",
        undefined,
        this.requireEtag(this.groupEtag),
      );
      this.groups.update((gs) => gs.filter((v) => v["@id"] !== g["@id"]));
      this.selected.set(null);
      this.members.set(null);
    }, "Group deleted.");
  }
  async addMember() {
    const u = this.availableUsers.find((u) => u["@id"] === this.newMember);
    if (!u || !this.canAdmin) return;
    await this.saveMembers([
      ...(this.members() || []),
      { user: u, administrator: false, member: true },
    ]);
  }
  async removeMember(m: Member) {
    if (
      !this.canAdmin ||
      this.onlyAdmin(m) ||
      !this.members()?.includes(m) ||
      this.busy() ||
      !window.confirm("Remove " + userName(m.user) + " from this group?")
    )
      return;
    await this.saveMembers(this.members()!.filter((v) => v !== m));
  }
  async toggleAdmin(m: Member) {
    if (
      !this.canAdmin ||
      this.onlyAdmin(m) ||
      !this.members()?.includes(m) ||
      this.busy() ||
      !window.confirm(
        (m.administrator
          ? "Remove administrator access for "
          : "Make an administrator: ") +
          userName(m.user) +
          "?",
      )
    )
      return;
    await this.saveMembers(
      this.members()!.map((v) =>
        v === m ? { ...v, administrator: !v.administrator } : v,
      ),
    );
  }
  private async saveMembers(proposed: Member[]) {
    const g = this.selected();
    if (!g || !this.canAdmin) return;
    await this.write(async () => {
      const body = {
        users: proposed.map((m) => ({
          user: { "@id": m.user["@id"] },
          administrator: m.administrator,
          member: m.member,
        })),
      };
      const r = await this.api.request<{ users: Member[] }>(
        this.path(g) + "/users",
        "PUT",
        body,
        this.requireEtag(this.memberEtag),
      );
      this.memberEtag = r.etag;
      this.members.set(r.data.users);
      this.newMember = "";
      if (!this.canAdmin) {
        this.members.set(null);
        this.restricted.set(true);
      }
    }, "Group members saved.");
  }
}
