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
import { Backend, HttpError } from "./backend.service";
import { Resource, title, can } from "./resource";
import { GroupPicker } from "./group-picker";
import { Icon } from "./icon";

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
export const principalName = (p: Principal) =>
  p.specialGroup
    ? "Everyone"
    : p["schema:name"] ||
      [p.firstName, p.lastName].filter(Boolean).join(" ") ||
      "Unnamed user";

@Component({
  selector: "cedar-permissions-dialog",
  imports: [Toast, DialogKeyboard, FormsModule, GroupPicker, Icon],
  templateUrl: "./permissions-dialog.html",
  styleUrl: "./permissions-dialog.scss",
})
export class PermissionsDialog implements OnInit, AfterViewInit, OnDestroy {
  readonly confirmation = inject(Confirmation);
  @Input({ required: true }) resource!: Resource;
  @Output() closed = new EventEmitter<string | undefined>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  readonly api = inject(Backend);
  readonly busy = signal(true);
  readonly error = signal("");
  readonly notice = signal("");
  readonly failedChange = signal("");
  readonly stale = signal(false);
  readonly current = signal<Resource | null>(null);
  readonly permissions = signal<Permissions | null>(null);
  readonly people = signal<(Principal & { kind: "user" | "group" })[]>([]);
  readonly title = title;
  readonly principalName = principalName;
  personId = "";
  role = "viewer";
  etag: string | null = null;
  private alive = true;
  private readGeneration = 0;
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
        label: principalName(p) + (p.kind === "group" ? " (Group)" : ""),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  get selectedPerson() {
    return this.people().find((p) => p["@id"] === this.personId);
  }
  ngOnInit() {
    void this.load();
  }
  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
  }
  ngOnDestroy() {
    this.alive = false;
    this.readGeneration++;
    this.originalFocus?.focus();
  }
  close() {
    if (!this.busy()) this.closed.emit();
  }
  async load() {
    const generation = ++this.readGeneration;
    this.permissions.set(null);
    this.people.set([]);
    this.busy.set(true);
    this.error.set("");
    this.current.set(null);
    this.etag = null;
    try {
      const [report, permissions, groups] = await Promise.all([
        this.api.report(this.resource),
        this.api.request<Permissions>(
          this.api.path(this.resource) + "/permissions",
        ),
        this.api.request<{ groups: Principal[] }>(
          this.api.config.groupRestAPI.replace(/\/$/, "") + "/groups",
        ),
      ]);
      if (!this.alive || generation !== this.readGeneration) return;
      this.current.set(report.data);
      this.permissions.set(permissions.data);
      this.etag = permissions.etag;
      this.stale.set(false);
      this.people.set(
        groups.data.groups.map((p) => ({ ...p, kind: "group" as const })),
      );
      if (this.canManage) {
        const users = await this.api.request<{ users: Principal[] }>("/users");
        if (!this.alive || generation !== this.readGeneration) return;
        this.people.update((groups) => [
          ...users.data.users.map((p) => ({ ...p, kind: "user" as const })),
          ...groups,
        ]);
      }
    } catch (e) {
      if (!this.alive || generation !== this.readGeneration) return;
      this.current.set(null);
      this.fail(e);
    } finally {
      if (this.alive && generation === this.readGeneration)
        this.busy.set(false);
    }
  }
  private fail(e: unknown) {
    if (!this.alive) return;
    this.error.set(e instanceof Error ? e.message : String(e));
    if (e instanceof HttpError && e.status === 412) this.stale.set(true);
  }
  private revision() {
    if (!this.etag)
      throw new Error(
        "No permissions revision was returned. Reload permissions before making changes.",
      );
    return this.etag;
  }
  selectPerson(id: string) {
    this.personId = id;
    this.role = "viewer";
  }
  async add() {
    const person = this.selectedPerson;
    if (!person || !this.options.some((p) => p.id === person["@id"])) return;
    if (
      await this.save(
        [...this.grants, { node: person, kind: person.kind, role: this.role }],
        "Add " + principalName(person) + " as " + this.role,
      )
    )
      this.personId = "";
  }
  async changeRole(grant: Grant, role: string) {
    if (!this.grants.some((g) => g.node["@id"] === grant.node["@id"])) return;
    await this.save(
      this.grants.map((g) =>
        g.node["@id"] === grant.node["@id"] ? { ...g, role } : g,
      ),
      "Set " + principalName(grant.node) + " to " + role,
    );
  }
  async remove(grant: Grant) {
    await this.save(
      this.grants.filter((g) => g.node["@id"] !== grant.node["@id"]),
      "Remove access for " + principalName(grant.node),
    );
  }
  private async save(grants: Grant[], description: string) {
    if (this.busy() || this.stale() || !this.canManage || !this.permissions())
      return false;
    if (
      grants.some(
        (g) =>
          !["viewer", "editor", "manager"].includes(g.role) ||
          (g.node.specialGroup && g.role !== "viewer"),
      )
    )
      return false;
    return this.write(description, () =>
      this.api.request<Permissions>(
        this.api.path(this.resource) + "/permissions",
        "PUT",
        {
          owner: { "@id": this.permissions()!.owner["@id"] },
          userPermissions: grants
            .filter((g) => g.kind === "user")
            .map((g) => ({ user: { "@id": g.node["@id"] }, role: g.role })),
          groupPermissions: grants
            .filter((g) => g.kind === "group")
            .map((g) => ({ group: { "@id": g.node["@id"] }, role: g.role })),
        },
        this.revision(),
      ),
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
    const permissions = this.permissions();
    const resource = this.resource;
    if (
      !(await this.confirmation.confirm(
        "Make " +
          principalName(grant.node) +
          " the owner of “" +
          title(this.resource) +
          "”? You may lose the ability to manage access or transfer ownership.",
      ))
    )
      return;
    if (
      this.busy() ||
      !this.canTransfer ||
      this.permissions() !== permissions ||
      this.resource !== resource
    )
      return;
    const transferred = await this.write(
      "Transfer ownership to " + principalName(grant.node),
      () =>
        this.api.request<Permissions>(
          "/command/transfer-resource-ownership",
          "POST",
          { "@id": this.resource["@id"], newOwnerId: grant.node["@id"] },
          this.revision(),
        ),
    );
    if (transferred && this.alive)
      this.closed.emit(
        "Ownership transferred to " + principalName(grant.node) + ".",
      );
  }
  private async write(
    description: string,
    action: () => Promise<{ data: Permissions; etag: string | null }>,
  ) {
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    this.failedChange.set("");
    let saved = false;
    try {
      const reply = await action();
      if (!this.alive) return false;
      this.permissions.set(reply.data);
      this.etag = reply.etag;
      saved = true;
      this.notice.set("Permissions saved.");
      // A self-demotion or ownership transfer can remove the caller's privileges.
      this.current.set(null);
      const report = await this.api.report(this.resource);
      if (this.alive) this.current.set(report.data);
    } catch (e) {
      this.fail(e);
      if (!saved && this.alive) this.failedChange.set(description);
    } finally {
      if (this.alive) this.busy.set(false);
    }
    return saved;
  }
}
