import { Confirmation } from "./confirmation";
import { Component, OnInit, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Backend } from "./backend.service";
import { AccountShell } from "./account-shell";
import { ApiKey, UserProfile } from "./account-types";
export function displayAccountDate(
  value: string | number | number[] | undefined,
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
  return isNaN(date.getTime()) ? "" : date.toLocaleString();
}
@Component({
  selector: "cedar-profile-page",
  imports: [FormsModule, AccountShell],
  templateUrl: "./profile.html",
})
export class Profile implements OnInit {
  readonly confirmation = inject(Confirmation);
  readonly api = inject(Backend);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly keys = signal<ApiKey[]>([]);
  readonly revealed = signal(new Set<string>());
  profile!: UserProfile;
  description = "";
  memberSince = signal("");
  readonly date = displayAccountDate;
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
          displayAccountDate(
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
  get fields() {
    const p = this.profile;
    return p
      ? [
          ["First name", p.firstName || ""],
          ["Last name", p.lastName || ""],
          ["Email", p.email || this.api.email],
          ["UUID", this.api.userId],
          ["@id", p["@id"] || ""],
          ["Home folder id", p.homeFolderId],
          ["Encoded home folder id", encodeURIComponent(p.homeFolderId)],
          [
            "Preferred date format",
            p.uiPreferences?.preferredDateFormat || "MM/DD/YYYY",
          ],
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
      this.notice.set("Copied.");
    } catch {
      this.error.set("Unable to copy. Please select and copy the text.");
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
          action === "delete"
            ? "Delete this API key? Scripts using it will stop working."
            : "Regenerate this API key? Its previous value will immediately stop working.",
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
        action === "create"
          ? "API key created."
          : action === "delete"
            ? "API key deleted."
            : "API key regenerated.",
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
    return [
      [
        "List your home folder contents",
        `${curl} "${base}/folders/${encodeURIComponent(this.profile.homeFolderId)}/contents"${auth}`,
      ],
      [
        "List resources shared with you",
        `${curl} "${base}/search?sharing=shared-with-me"${auth}`,
      ],
      [
        "Retrieve a template",
        `${curl} "${base}/templates/{TEMPLATE_ID}"${auth}`,
      ],
      [
        "Create a template",
        `${curl} -X POST "${base}/templates?folder_id=${encodeURIComponent(this.profile.homeFolderId)}"${auth} -H "Content-Type: application/json" -d @template.json`,
      ],
      [
        "Update a template (use the ETag returned by GET)",
        `${curl} -X PUT "${base}/templates/{TEMPLATE_ID}"${auth} -H 'If-Match: "<ETAG>"' -H "Content-Type: application/json" -d @template.json`,
      ],
      [
        "Get metadata based on a template",
        `${curl} "${base}/search?is_based_on={TEMPLATE_ID}&resource_types=instance"${auth}`,
      ],
    ];
  }
}
