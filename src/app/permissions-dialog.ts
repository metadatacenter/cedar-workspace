import { RevisionCoordinator } from "./revision-coordinator";
import {
  samePermissions,
  uniquePrincipals,
  validAccessReport,
  validPermissions,
} from "./access-validation";
import { Tooltip } from "./tooltip";
import { Toast } from "./toast";
import { Confirmation } from "./confirmation";
import { DialogKeyboard } from "./dialog-keyboard";
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend, HttpError } from "./backend.service";
import { Resource, title, can } from "./resource";
import { GroupPicker } from "./group-picker";
import { Icon } from "./icon";
import { I18n } from "./i18n";

export interface Principal {
  "@id": string;
  "schema:name"?: string;
  firstName?: string;
  lastName?: string;
  specialGroup?: boolean | string;
}
export interface Grant {
  node: Principal;
  kind: "user" | "group";
  role: string;
}
export interface Permissions {
  owner: Principal;
  userPermissions: { user: Principal; role: string }[];
  groupPermissions: { group: Principal; role: string }[];
}
export const principalName = (p: Principal, i18n: Pick<I18n, "t">) =>
  p.specialGroup
    ? i18n.t("Common.Everyone")
    : p["schema:name"] ||
      [p.firstName, p.lastName].filter(Boolean).join(" ") ||
      i18n.t("Common.UnnamedUser");

@Component({
  selector: "cedar-permissions-dialog",
  imports: [
    Tooltip,
    Toast,
    DialogKeyboard,
    FormsModule,
    GroupPicker,
    Icon,
    TranslatePipe,
  ],
  templateUrl: "./permissions-dialog.html",
  styleUrl: "./permissions-dialog.scss",
})
export class PermissionsDialog implements OnInit, AfterViewInit, OnDestroy {
  readonly confirmation = inject(Confirmation);
  private readonly i18n = inject(I18n);
  private boundResource!: Resource;
  private context = "";
  private initialized = false;
  @Input({ required: true })
  set resource(value: Resource) {
    // Own the input: later in-place host edits must not retarget an ACL operation.
    this.boundResource = structuredClone(value);
    const context = JSON.stringify([
      value["@id"],
      value.resourceType,
      value.currentUserPermissions,
    ]);
    if (context === this.context || !this.coordinator.active) return;
    this.context = context;
    this.coordinator.reset();
    this.current.set(null);
    this.permissions.set(null);
    this.people.set([]);
    this.etag = null;
    this.selectPerson("");
    this.error.set("");
    this.notice.set("");
    this.failedChange.set("");
    this.busy.set(false);
    if (this.initialized) void this.load();
  }
  get resource() {
    return this.boundResource;
  }
  @Output() closed = new EventEmitter<string | undefined>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  readonly api = inject(Backend);
  readonly busy = signal(true);
  readonly error = signal("");
  readonly notice = signal("");
  readonly failedChange = signal("");
  readonly coordinator = new RevisionCoordinator();
  readonly stale = this.coordinator.reloadRequired;
  readonly current = signal<Resource | null>(null);
  readonly permissions = signal<Permissions | null>(null);
  readonly people = signal<(Principal & { kind: "user" | "group" })[]>([]);
  readonly title = (r: Resource) => title(r, this.i18n.t("Common.Untitled"));
  readonly principalName = (p: Principal) => principalName(p, this.i18n);
  private roleName(role: string) {
    return this.i18n.known("Roles." + role, role);
  }
  personId = "";
  role = "viewer";
  etag: string | null = null;

  private originalFocus = document.activeElement as HTMLElement | null;
  get canManage() {
    return can(this.current() || undefined, "manageGrants");
  }
  get canTransfer() {
    return can(this.current() || undefined, "transferOwnership");
  }
  get grants(): Grant[] {
    const p = this.permissions();
    return p
      ? [
          ...p.userPermissions.map((g) => ({
            node: g.user,
            role: g.role,
            kind: "user" as const,
          })),
          ...p.groupPermissions.map((g) => ({
            // Permission extracts omit specialGroup; the directory owns that identity.
            node: {
              ...g.group,
              ...this.people().find(
                (p) => p.kind === "group" && p["@id"] === g.group["@id"],
              ),
            },
            role: g.role,
            kind: "group" as const,
          })),
        ]
      : [];
  }
  get options() {
    return this.people()
      .filter(
        (p) =>
          p["@id"] !== this.permissions()?.owner["@id"] &&
          !this.grants.some((g) => g.node["@id"] === p["@id"]),
      )
      .map((p) => ({
        id: p["@id"],
        label:
          p.kind === "group"
            ? this.i18n.t("Permissions.GroupSuffix", {
                name: this.principalName(p),
              })
            : this.principalName(p),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  get selectedPerson() {
    return this.people().find((p) => p["@id"] === this.personId);
  }
  ngOnInit() {
    this.initialized = true;
    void this.load();
  }
  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy() {
    this.coordinator.dispose();
    this.originalFocus?.focus();
  }
  close() {
    if (!this.busy()) this.closed.emit();
  }
  async load() {
    const operation = this.coordinator.read();
    if (!operation) return;
    const resource = this.resource;
    this.notice.set("");
    this.failedChange.set("");
    this.permissions.set(null);
    this.people.set([]);
    this.busy.set(true);
    this.error.set("");
    this.current.set(null);
    this.etag = null;
    try {
      const [report, permissions, groups] = await Promise.all([
        this.api.report(resource),
        this.api.request<Permissions>(this.api.path(resource) + "/permissions"),
        this.api.request<{ groups: Principal[] }>(
          this.api.config.groupRestAPI.replace(/\/$/, "") + "/groups",
        ),
      ]);
      if (!operation.current()) return;
      if (
        !validAccessReport(report.data, resource) ||
        !uniquePrincipals(groups.data?.groups) ||
        !validPermissions(permissions.data, groups.data.groups)
      )
        throw new Error(this.i18n.t("Permissions.InvalidResponse"));
      let people = groups.data.groups.map((p) => ({
        ...p,
        kind: "group" as "group" | "user",
      }));
      if (can(report.data, "manageGrants")) {
        const users = await this.api.request<{ users: Principal[] }>("/users");
        if (!operation.current()) return;
        if (
          !uniquePrincipals(users.data?.users) ||
          !uniquePrincipals([...users.data.users, ...people])
        )
          throw new Error(this.i18n.t("Permissions.InvalidResponse"));
        people = [
          ...users.data.users.map((p) => ({ ...p, kind: "user" as const })),
          ...people,
        ];
      }
      this.current.set(report.data);
      this.permissions.set(permissions.data);
      this.etag = permissions.etag;
      this.people.set(people);
      if (!this.options.some((p) => p.id === this.personId))
        this.selectPerson("");
      if (this.selectedPerson?.specialGroup) this.role = "viewer";
      operation.finish();
      if ((this.canManage || this.canTransfer) && !this.etag?.trim()) {
        this.stale.set(true);
        this.error.set(this.i18n.t("Permissions.NoRevision"));
      }
    } catch (e) {
      if (!operation.current()) return;
      this.current.set(null);
      operation.fail(e);
      this.fail(e);
    } finally {
      if (operation.current()) this.busy.set(false);
    }
  }
  private fail(e: unknown) {
    if (!this.coordinator.active) return;
    this.error.set(e instanceof Error ? e.message : String(e));
    if (e instanceof HttpError && e.status === 412) this.stale.set(true);
  }
  private revision() {
    if (!this.etag?.trim())
      throw new Error(this.i18n.t("Permissions.NoRevision"));
    return this.etag;
  }
  selectPerson(id: string) {
    this.personId = id;
    this.role = "viewer";
  }
  async add() {
    const resource = this.resource;
    const person = this.selectedPerson;
    if (!person || !this.options.some((p) => p.id === person["@id"])) return;
    if (
      (await this.save(
        [...this.grants, { node: person, kind: person.kind, role: this.role }],
        this.i18n.t("Permissions.Changes.Add", {
          name: this.principalName(person),
          role: this.roleName(this.role),
        }),
      )) &&
      this.resource === resource &&
      this.selectedPerson === person
    )
      this.personId = "";
  }
  async changeRole(grant: Grant, role: string) {
    if (!this.grants.some((g) => g.node["@id"] === grant.node["@id"])) return;
    await this.save(
      this.grants.map((g) =>
        g.node["@id"] === grant.node["@id"] ? { ...g, role } : g,
      ),
      this.i18n.t("Permissions.Changes.Set", {
        name: this.principalName(grant.node),
        role: this.roleName(role),
      }),
    );
  }
  async remove(grant: Grant) {
    if (
      !this.grants.some(
        (g) => g.kind === grant.kind && g.node["@id"] === grant.node["@id"],
      )
    )
      return;
    await this.save(
      this.grants.filter((g) => g.node["@id"] !== grant.node["@id"]),
      this.i18n.t("Permissions.Changes.Remove", {
        name: this.principalName(grant.node),
      }),
    );
  }
  private async save(grants: Grant[], description: string) {
    if (
      !this.coordinator.active ||
      this.busy() ||
      this.stale() ||
      !this.canManage ||
      !this.permissions()
    )
      return false;
    if (
      grants.some(
        (g) =>
          !["viewer", "editor", "manager"].includes(g.role) ||
          (g.node.specialGroup && g.role !== "viewer"),
      )
    )
      return false;
    const expected: Permissions = {
      owner: { "@id": this.permissions()!.owner["@id"] },
      userPermissions: grants
        .filter((g) => g.kind === "user")
        .map((g) => ({ user: { "@id": g.node["@id"] }, role: g.role })),
      groupPermissions: grants
        .filter((g) => g.kind === "group")
        .map((g) => ({ group: { "@id": g.node["@id"] }, role: g.role })),
    };
    return this.write(
      description,
      () =>
        this.api.request<Permissions>(
          this.api.path(this.resource) + "/permissions",
          "PUT",
          expected,
          this.revision(),
        ),
      (actual) => samePermissions(actual, expected),
    );
  }

  async transfer(grant: Grant) {
    if (
      this.busy() ||
      this.stale() ||
      !this.canTransfer ||
      grant.kind !== "user" ||
      !this.grants.some(
        (g) => g.kind === "user" && g.node["@id"] === grant.node["@id"],
      )
    )
      return;
    const decision = this.coordinator.checkpoint();
    const permissions = this.permissions();
    const resource = this.resource;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t("Permissions.ConfirmTransfer", {
          name: this.principalName(grant.node),
          resource: this.title(this.resource),
        }),
        "permissions",
      ))
    )
      return;
    if (
      this.busy() ||
      !this.canTransfer ||
      !decision() ||
      this.stale() ||
      this.permissions() !== permissions ||
      this.resource !== resource
    )
      return;
    const transferred = await this.write(
      this.i18n.t("Permissions.Changes.Transfer", {
        name: this.principalName(grant.node),
      }),
      () =>
        this.api.request<Permissions>(
          "/command/transfer-resource-ownership",
          "POST",
          { "@id": this.resource["@id"], newOwnerId: grant.node["@id"] },
          this.revision(),
        ),
      (actual) => actual.owner["@id"] === grant.node["@id"],
    );
    if (transferred && this.coordinator.active && this.resource === resource)
      this.closed.emit(
        this.i18n.t("Permissions.Transferred", {
          name: this.principalName(grant.node),
        }),
      );
  }
  private async write(
    description: string,
    action: () => Promise<{ data: Permissions; etag: string | null }>,
    acknowledges: (actual: Permissions) => boolean,
  ) {
    const operation = this.coordinator.write();
    if (!operation) return false;
    const resource = this.resource;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    this.failedChange.set("");
    let saved = false;
    try {
      const reply = await action();
      if (!operation.current()) return false;
      if (
        !validPermissions(
          reply.data,
          this.people().filter((p) => p.kind === "group"),
        ) ||
        !acknowledges(reply.data)
      )
        throw new Error(this.i18n.t("Permissions.InvalidResponse"));
      this.permissions.set(reply.data);
      this.etag = reply.etag;
      saved = true;
      this.notice.set(this.i18n.t("Permissions.Saved"));
      // Keep the existing layout while all mutation controls remain disabled.
      // Apply refreshed privileges atomically, including a genuine self-demotion.
      const report = await this.api.report(resource);
      if (!operation.current()) return false;
      if (!validAccessReport(report.data, resource))
        throw new Error(this.i18n.t("Permissions.InvalidResponse"));
      this.current.set(report.data);
      if (!this.etag?.trim())
        throw new Error(this.i18n.t("Permissions.NoRevision"));
      operation.finish();
    } catch (e) {
      // A completed write may have revoked access. Never enable stale privileges
      // if their refresh fails; require an explicit permissions reload instead.
      if (!operation.current()) return false;
      if (saved) this.current.set(null);
      operation.fail(e);
      this.fail(e);
      if (!saved && e instanceof HttpError && e.status < 500)
        this.failedChange.set(description);
    } finally {
      if (operation.current()) this.busy.set(false);
    }
    return saved;
  }
}
