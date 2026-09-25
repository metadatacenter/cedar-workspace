import { Icon } from "./icon";
import { Confirmation } from "./confirmation";
import { Component, OnInit, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { Backend } from "./backend.service";
import { AccountShell } from "./account-shell";
import { ApiKey, UserProfile } from "./account-types";
import { I18n } from "./i18n";
/**
 * An account date in the viewer's locale. `locale` is left undefined for
 * English, which keeps the browser's default locale as before localization.
 */
export function displayAccountDate(
  value: string | number | number[] | undefined,
  locale?: string,
): string {
  if (value === undefined || value === null) return "";
  const date = Array.isArray(value)
    ? new Date(
        value[0],
        value[1] - 1,
        value[2],
        value[3] || 0,
        value[4] || 0,
        value[5] || 0,
      )
    : new Date(value);
  return isNaN(date.getTime()) ? "" : date.toLocaleString(locale);
}
@Component({
  selector: "cedar-profile-page",
  imports: [FormsModule, AccountShell, Icon, TranslatePipe],
  templateUrl: "./profile.html",
  styleUrl: "./profile.scss",
})
export class Profile implements OnInit {
  readonly confirmation = inject(Confirmation);
  readonly api = inject(Backend);
  private readonly i18n = inject(I18n);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly keys = signal<ApiKey[]>([]);
  readonly revealed = signal(new Set<string>());
  profile!: UserProfile;
  description = "";
  memberSince = signal("");
  readonly date = (value: string | number | number[] | undefined) =>
    displayAccountDate(value, this.i18n.locale(undefined));
  async ngOnInit() {
    try {
      if (!(await this.api.init())) return;
      this.profile = (
        await this.api.request<UserProfile>(this.api.userPath)
      ).data;
      this.keys.set(this.profile.apiKeys || []);
      this.loading.set(false);
      try {
        this.memberSince.set(
          this.date(
            (
              await this.api.request<{ createdTimestamp: number }>(
                this.api.userPath + "/summary",
              )
            ).data.createdTimestamp,
          ),
        );
      } catch {
        /* Account creation time is optional. */
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.loading.set(false);
    }
  }
  // Each label is a translation key; identifiers are shown in a monospace face.
  get fields(): { label: string; value: string; identifier: boolean }[] {
    const p = this.profile;
    const field = (label: string, value: string, identifier = false) => ({
      label,
      value,
      identifier,
    });
    return p
      ? [
          field("Account.Profile.FirstName", p.firstName || ""),
          field("Account.Profile.LastName", p.lastName || ""),
          field("Account.Profile.Email", p.email || this.api.email),
          field("Account.Profile.Uuid", this.api.userId, true),
          field("Account.Profile.Id", p["@id"] || "", true),
          field("Account.Profile.HomeFolderId", p.homeFolderId, true),
          field(
            "Account.Profile.EncodedHomeFolderId",
            encodeURIComponent(p.homeFolderId),
            true,
          ),
          field(
            "Account.Profile.PreferredDateFormat",
            p.uiPreferences?.preferredDateFormat || "MM/DD/YYYY",
          ),
        ]
      : [];
  }
  toggle(key: ApiKey) {
    this.revealed.update((current) => {
      const next = new Set(current);
      next.has(key.id) ? next.delete(key.id) : next.add(key.id);
      return next;
    });
  }
  keyText(key: ApiKey) {
    return this.revealed().has(key.id) ? key.key : "••••••••••••••••••••";
  }
  canDelete(key: ApiKey) {
    return (
      this.keys().length > 1 &&
      (!key.enabled || this.keys().filter((k) => k.enabled).length > 1)
    );
  }
  async copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.notice.set(this.i18n.t("Account.Profile.Copied"));
    } catch {
      this.error.set(this.i18n.t("Account.Profile.CopyFailed"));
    }
  }
  async mutate(action: "create" | "regenerate" | "delete", key?: ApiKey) {
    if (
      this.busy() ||
      (action === "create" && this.keys().length >= 20) ||
      (action === "delete" && (!key || !this.canDelete(key)))
    )
      return;
    if (
      action !== "create" &&
      (!key ||
        !(await this.confirmation.confirm(
          this.i18n.t(
            action === "delete"
              ? "Account.Profile.ConfirmDelete"
              : "Account.Profile.ConfirmRegenerate",
          ),
        )))
    )
      return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      const path =
        this.api.userPath +
        "/api-keys" +
        (key
          ? "/" +
            encodeURIComponent(key.id) +
            (action === "regenerate" ? "/regenerate" : "")
          : "");
      const body =
        action === "create" && this.description.trim()
          ? { description: this.description.trim() }
          : {};
      const result = await this.api.request<{ apiKeys: ApiKey[] }>(
        path,
        action === "delete" ? "DELETE" : "POST",
        action === "delete" ? undefined : body,
      );
      this.keys.set(result.data.apiKeys);
      this.api.profile.apiKeys = result.data.apiKeys;
      this.revealed.set(new Set());
      if (action === "create") this.description = "";
      this.notice.set(
        this.i18n.t(
          action === "create"
            ? "Account.Profile.KeyCreated"
            : action === "delete"
              ? "Account.Profile.KeyDeleted"
              : "Account.Profile.KeyRegenerated",
        ),
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  get examples() {
    if (!this.profile) return [];
    const base = this.api.config.resourceRestAPI;
    const curl =
      new URL(base).hostname === "resource.metadatacenter.org"
        ? "curl"
        : "curl -k";
    const auth = ' -H "Authorization: apiKey <API_KEY>"';
    // The first item of each pair is a translation key.
    return [
      [
        "Account.Profile.Examples.HomeContents",
        `${curl} "${base}/folders/${encodeURIComponent(this.profile.homeFolderId)}/contents"${auth}`,
      ],
      [
        "Account.Profile.Examples.Shared",
        `${curl} "${base}/search?sharing=shared-with-me"${auth}`,
      ],
      [
        "Account.Profile.Examples.Retrieve",
        `${curl} "${base}/templates/{TEMPLATE_ID}"${auth}`,
      ],
      [
        "Account.Profile.Examples.Create",
        `${curl} -X POST "${base}/templates?folder_id=${encodeURIComponent(this.profile.homeFolderId)}"${auth} -H "Content-Type: application/json" -d @template.json`,
      ],
      [
        "Account.Profile.Examples.Update",
        `${curl} -X PUT "${base}/templates/{TEMPLATE_ID}"${auth} -H 'If-Match: "<ETAG>"' -H "Content-Type: application/json" -d @template.json`,
      ],
      [
        "Account.Profile.Examples.Instances",
        `${curl} "${base}/search?is_based_on={TEMPLATE_ID}&resource_types=instance"${auth}`,
      ],
    ];
  }
}
