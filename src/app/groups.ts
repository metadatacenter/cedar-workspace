import { RevisionCoordinator } from "./revision-coordinator";
import { uncertainWrite } from "./write-failure";
import { Operation } from "./operation-coordinator";
import { uniquePrincipals } from "./access-validation";
import {
  sameMembers,
  validGroup,
  validGroups,
  validMembers,
} from "./group-validation";
import { Tooltip } from "./tooltip";
import { Toast } from "./toast";
import { WorkspaceReturn } from "./workspace-return";
import { Confirmation } from "./confirmation";
import { Component, OnInit, OnDestroy, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend, HttpError } from "./backend.service";
import { NgTemplateOutlet } from "@angular/common";
import { Icon } from "./icon";
import { GroupPicker } from "./group-picker";
import { I18n } from "./i18n";
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
export const groupName = (g: Group, i18n: Pick<I18n, "t">) =>
  g.specialGroup ? i18n.t("Common.Everyone") : g["schema:name"];
export const userName = (u: GroupUser, i18n: Pick<I18n, "t">) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ") ||
  i18n.t("Common.UnnamedUser");
@Component({
  selector: "cedar-groups-page",
  imports: [
    Tooltip,
    Toast,
    WorkspaceReturn,
    FormsModule,
    NgTemplateOutlet,
    Icon,
    GroupPicker,
    TranslatePipe,
  ],
  styleUrl: "./groups.scss",
  templateUrl: "./groups.html",
})
export class Groups implements OnInit, OnDestroy {
  private readonly i18n = inject(I18n);
  readonly cedarVersion = window.cedarVersion || this.i18n.t("Common.Unknown");
  readonly confirmation = inject(Confirmation);
  readonly api = inject(Backend);
  readonly loading = signal(true);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly recoveryGroup = signal<Group | null>(null);
  readonly coordinator = new RevisionCoordinator();
  readonly stale = this.coordinator.reloadRequired;
  readonly uncertainCreation = signal(false);
  readonly notice = signal("");
  readonly groups = signal<Group[]>([]);
  readonly users = signal<GroupUser[]>([]);
  readonly selected = signal<Group | null>(null);
  readonly members = signal<Member[] | null>(null);
  readonly restricted = signal(false);
  readonly selecting = signal(false);
  groupEtag: string | null = null;
  memberEtag: string | null = null;
  ngOnDestroy() {
    this.coordinator.dispose();
  }
  activeTab: "manage" | "create" | "delete" = "manage";
  createdGroup: Group | null = null;
  search = "";
  get groupOptions() {
    return this.filteredGroups.map((g) => ({
      id: g["@id"],
      label:
        this.groupName(g) +
        (g["schema:description"]?.trim()
          ? " - " + g["schema:description"]!.trim()
          : ""),
    }));
  }
  get memberOptions() {
    return this.availableUsers.map((u) => ({
      id: u["@id"],
      label: this.userName(u),
    }));
  }
  async chooseGroup(id: string) {
    const group = this.groups().find((g) => g["@id"] === id);
    if (group) await this.select(group);
  }
  async selectTab(tab: "manage" | "create" | "delete") {
    if (!this.coordinator.active || this.busy() || this.selecting()) return;
    if (
      tab === "create" &&
      this.createdGroup &&
      this.selected()?.["@id"] !== this.createdGroup["@id"]
    ) {
      await this.load(this.createdGroup, true);
      return;
    }
    this.activeTab = tab;
    if (
      tab === "manage" &&
      this.selected()?.["@id"] === this.createdGroup?.["@id"]
    ) {
      this.selected.set(null);
      this.members.set(null);
      this.newMember = "";
    }
  }
  newName = "";
  editName = "";
  editDescription = "";
  newMember = "";
  readonly groupName = (g: Group) => groupName(g, this.i18n);
  readonly userName = (u: GroupUser) => userName(u, this.i18n);
  get base() {
    return this.api.config.groupRestAPI.replace(/\/$/, "") + "/groups";
  }
  path(g: Group) {
    return this.base + "/" + encodeURIComponent(g["@id"]);
  }
  get filteredGroups() {
    return this.groups()
      .filter((g) =>
        (this.groupName(g) + " " + (g["schema:description"] || ""))
          .toLowerCase()
          .includes(this.search.toLowerCase()),
      )
      .sort((a, b) => this.groupName(a).localeCompare(this.groupName(b)));
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
    const operation = this.coordinator.read();
    if (!operation) return;
    this.loading.set(true);
    this.ready.set(false);
    this.error.set("");
    try {
      if (!(await this.api.init()) || !operation.current()) return;
      const [groups, users] = await Promise.all([
        this.api.request<{ groups: Group[] }>(this.base),
        this.api.request<{ users: GroupUser[] }>("/users"),
      ]);
      if (!operation.current()) return;
      if (
        !validGroups(groups.data?.groups) ||
        !uniquePrincipals(users.data?.users)
      )
        throw new Error(this.i18n.t("Groups.InvalidResponse"));
      this.groups.set(groups.data.groups);
      if (
        this.createdGroup &&
        !groups.data.groups.some((g) => g["@id"] === this.createdGroup!["@id"])
      )
        this.createdGroup = null;
      this.users.set(
        (users.data.users || []).sort((a, b) =>
          this.userName(a).localeCompare(this.userName(b)),
        ),
      );
      this.ready.set(true);
      this.uncertainCreation.set(false);
      this.selected.set(null);
      this.members.set(null);
      this.groupEtag = this.memberEtag = null;
      this.recoveryGroup.set(null);
      operation.finish();
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      this.fail(e);
    } finally {
      if (operation.current()) {
        if (this.coordinator.phase() === "read") operation.finish();
        this.loading.set(false);
      }
    }
  }
  private fail(e: unknown, recoveryGroup: Group | null = null) {
    this.error.set(e instanceof Error ? e.message : String(e));
    this.recoveryGroup.set(recoveryGroup);
    if (e instanceof HttpError && e.status === 412) this.stale.set(true);
  }
  async select(g: Group) {
    if (!this.coordinator.active || this.busy()) return;
    await this.load(g);
  }
  private async load(g: Group, returningToCreate = false, parent?: Operation) {
    const operation = parent ?? this.coordinator.read();
    if (!operation) return;
    // Keep the current panel intact until both reads complete when changing tabs.
    if (returningToCreate) this.busy.set(true);
    else {
      this.selected.set(null);
      this.members.set(null);
      this.stale.set(false);
      this.restricted.set(false);
      this.selecting.set(true);
      this.groupEtag = this.memberEtag = null;
    }
    this.error.set("");
    this.recoveryGroup.set(null);
    this.newMember = "";
    try {
      const detail = await this.api.request<Group>(this.path(g));
      if (!operation.current()) return;
      if (!validGroup(detail.data) || detail.data["@id"] !== g["@id"])
        throw new Error(this.i18n.t("Groups.InvalidResponse"));
      let members: Member[] | null = null;
      let memberEtag: string | null = null;
      let restricted = !!detail.data.specialGroup;
      if (!restricted) {
        try {
          const roster = await this.api.request<{ users: Member[] }>(
            this.path(g) + "/users",
          );
          if (!operation.current()) return;
          if (!validMembers(roster.data?.users))
            throw new Error(this.i18n.t("Groups.InvalidResponse"));
          memberEtag = roster.etag;
          members = roster.data.users;
        } catch (e) {
          if (!operation.current()) return;
          if (e instanceof HttpError && e.status === 403) restricted = true;
          else {
            if (returningToCreate) throw e;
            this.fail(e, g);
          }
        }
      }
      this.selected.set(detail.data);
      this.members.set(members);
      this.memberEtag = memberEtag;
      this.restricted.set(restricted);

      this.groups.update((groups) =>
        groups.map((value) =>
          value["@id"] === g["@id"] ? detail.data : value,
        ),
      );
      this.groupEtag = detail.etag;
      this.editName = this.groupName(detail.data);
      this.editDescription = detail.data["schema:description"] || "";
      if (returningToCreate) this.activeTab = "create";
      if (!this.error()) {
        if (!parent) operation.finish();
        else this.stale.set(false);
        if (
          members?.some(
            (m) => m.administrator && m.user["@id"] === this.api.profile["@id"],
          ) &&
          (!this.groupEtag?.trim() || !this.memberEtag?.trim())
        ) {
          this.stale.set(true);
          this.fail(new Error(this.i18n.t("Groups.NoRevision")), g);
        }
      } else if (!parent) operation.fail(new Error(this.error()));
    } catch (e) {
      if (operation.current()) {
        if (!parent) operation.fail(e);
        if (e instanceof HttpError && e.status === 404) {
          this.groups.update((groups) =>
            groups.filter((value) => value["@id"] !== g["@id"]),
          );
          if (this.createdGroup?.["@id"] === g["@id"]) {
            this.createdGroup = null;
            if (returningToCreate) this.activeTab = "create";
          }
          if (this.selected()?.["@id"] === g["@id"]) {
            this.selected.set(null);
            this.members.set(null);
          }
          this.fail(e);
        } else this.fail(e, g);
      }
    } finally {
      if (operation.current()) {
        if (returningToCreate) this.busy.set(false);
        else this.selecting.set(false);
      }
    }
  }
  private requireEtag(value: string | null) {
    if (!value?.trim()) {
      this.stale.set(true);
      throw new Error(this.i18n.t("Groups.NoRevision"));
    }
    return value;
  }
  private async write(
    action: (operation: Operation) => Promise<void>,
    message: string,
    needsRevision = true,
  ) {
    if (this.busy() || this.selecting() || (needsRevision && this.stale()))
      return;
    const previousReload = this.stale();
    const operation = this.coordinator.write(!needsRevision);
    if (!operation) return;
    this.busy.set(true);
    this.error.set("");
    this.recoveryGroup.set(null);
    this.notice.set("");
    try {
      await action(operation);
      if (!operation.current()) return;
      operation.finish();
      if (!this.error()) this.notice.set(message);
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      if (!needsRevision) {
        this.uncertainCreation.set(uncertainWrite(e));
        this.stale.set(previousReload);
      }
      const needsReload = needsRevision && this.stale();
      this.fail(e, needsReload ? this.selected() : null);
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
  async create() {
    const name = this.newName.trim();
    if (!name || this.uncertainCreation()) return;
    await this.write(
      async (operation) => {
        const r = await this.api.request<Group>(this.base, "POST", {
          "schema:name": name,
          "schema:description": "",
        });
        if (!operation.current()) return;
        if (!validGroup(r.data))
          throw new Error(this.i18n.t("Groups.InvalidResponse"));
        this.groups.update((gs) => [
          ...gs.filter((g) => g["@id"] !== r.data["@id"]),
          r.data,
        ]);
        this.createdGroup = r.data;
        if (this.newName.trim() === name) this.newName = "";
        this.search = "";
        await this.load(r.data, false, operation);
      },
      this.i18n.t("Groups.Created"),
      false,
    );
  }
  async save() {
    const g = this.selected();
    if (!g || !this.canAdmin || !this.editName.trim()) return;
    const body = {
      "schema:name": this.editName.trim(),
      "schema:description": this.editDescription.trim(),
    };
    await this.write(async (operation) => {
      const r = await this.api.request<Group>(
        this.path(g),
        "PUT",
        body,
        this.requireEtag(this.groupEtag),
      );
      if (!operation.current()) return;
      if (!validGroup(r.data) || r.data["@id"] !== g["@id"])
        throw new Error(this.i18n.t("Groups.InvalidResponse"));
      this.groupEtag = r.etag;
      const current = { ...g, ...r.data, ...body };
      this.selected.set(current);
      if (this.createdGroup?.["@id"] === current["@id"])
        this.createdGroup = current;
      this.groups.update((gs) =>
        gs.map((v) => (v["@id"] === g["@id"] ? current : v)),
      );
      this.requireEtag(this.groupEtag);
    }, this.i18n.t("Groups.DetailsSaved"));
  }
  async remove() {
    const decision = this.coordinator.checkpoint();
    const tab = this.activeTab;
    const g = this.selected();
    if (
      !g ||
      !this.canAdmin ||
      this.busy() ||
      !(await this.confirmation.confirm(
        this.i18n.t("Groups.ConfirmDelete", { name: this.groupName(g) }),
        "groups",
        "delete",
      ))
    )
      return;
    if (
      !decision() ||
      this.activeTab !== tab ||
      this.selected() !== g ||
      !this.canAdmin ||
      this.busy()
    )
      return;
    await this.write(async (operation) => {
      await this.api.request(
        this.path(g),
        "DELETE",
        undefined,
        this.requireEtag(this.groupEtag),
      );
      if (!operation.current()) return;
      this.groups.update((gs) => gs.filter((v) => v["@id"] !== g["@id"]));
      this.selected.set(null);
      this.members.set(null);
      if (this.createdGroup?.["@id"] === g["@id"]) this.createdGroup = null;
    }, this.i18n.t("Groups.Deleted"));
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
      this.busy()
    )
      return;
    await this.saveMembers(this.members()!.filter((v) => v !== m));
  }
  async toggleAdmin(m: Member) {
    const decision = this.coordinator.checkpoint();
    const tab = this.activeTab;
    const group = this.selected();
    if (
      !this.canAdmin ||
      this.onlyAdmin(m) ||
      !this.members()?.includes(m) ||
      this.busy() ||
      !(await this.confirmation.confirm(
        this.i18n.t(
          m.administrator
            ? "Groups.ConfirmRemoveAdministrator"
            : "Groups.ConfirmMakeAdministrator",
          { name: this.userName(m.user) },
        ),
        "user",
      ))
    )
      return;
    if (
      !decision() ||
      this.activeTab !== tab ||
      this.selected() !== group ||
      !this.members()?.includes(m) ||
      this.onlyAdmin(m)
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
    if (
      !g ||
      !this.canAdmin ||
      !validMembers(proposed) ||
      !proposed.some((m) => m.administrator)
    )
      return;
    await this.write(async (operation) => {
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
      if (!operation.current()) return;
      if (
        !validMembers(r.data?.users) ||
        !sameMembers(r.data.users, body.users)
      )
        throw new Error(this.i18n.t("Groups.InvalidResponse"));
      this.memberEtag = r.etag;
      this.members.set(r.data.users);
      this.newMember = "";
      if (!this.canAdmin) {
        this.members.set(null);
        this.restricted.set(true);
      }
      this.requireEtag(this.memberEtag);
    }, this.i18n.t("Groups.MembersSaved"));
  }
}
