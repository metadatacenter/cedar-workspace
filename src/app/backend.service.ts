import type { UserProfile } from "./account-types";
import { Injectable, inject } from "@angular/core";
import { I18n } from "./i18n";
import { Config, Resource, collections } from "./resource";
interface Auth {
  initUserHandler(ok: (authenticated: boolean) => void, fail: () => void): void;
  refreshToken(seconds: number, ok: () => void, fail: () => void): void;
  getToken(): string;
  getParsedToken(): {
    sub: string;
    email?: string;
    realm_access?: { roles: string[] };
  };
  doLogin(): void;
  doLogout(options?: object): void | Promise<void>;
}
declare global {
  interface Window {
    KeycloakUserHandler: new () => Auth;
    dataciteEnabled?: boolean;
    makeOpenEnabled?: boolean;
  }
}
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface Reply<T> {
  data: T;
  etag: string | null;
}
@Injectable({ providedIn: "root" })
export class Backend {
  config!: Config;
  profile!: UserProfile;
  private readonly i18n = inject(I18n);
  get userId() {
    return this.auth.getParsedToken().sub;
  }
  get email() {
    return this.auth.getParsedToken().email || "";
  }
  get userPath() {
    return (
      this.config.userRestAPI.replace(/\/$/, "") +
      "/users/" +
      encodeURIComponent(this.userId)
    );
  }
  private auth!: Auth;
  private refresh?: Promise<void>;
  private readonly session = crypto.randomUUID();
  private initialization?: Promise<boolean>;
  private authentication?: Promise<boolean>;
  private authenticate() {
    return (this.authentication ||= this.initializeAuth());
  }
  init(): Promise<boolean> {
    return (this.initialization ||= this.initialize());
  }
  private async initializeAuth() {
    const response = await fetch("/config/url-service.conf.json", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(this.i18n.t("Errors.ConfigurationUnavailable"));
    this.config = await response.json();
    this.auth = new window.KeycloakUserHandler();
    const authenticated = await new Promise<boolean>((resolve, reject) =>
      this.auth.initUserHandler(resolve, () =>
        reject(new Error(this.i18n.t("Errors.SignInFailed"))),
      ),
    );
    return authenticated;
  }
  private async initialize() {
    if (!(await this.authenticate())) {
      this.auth.doLogin();
      return false;
    }
    this.profile = (
      await this.request<typeof this.profile>(
        `${this.config.userRestAPI}/users/${encodeURIComponent(this.auth.getParsedToken().sub)}`,
      )
    ).data;
    return true;
  }
  async logout() {
    if (await this.authenticate()) {
      await this.auth.doLogout({ redirectUri: location.origin + "/" });
    } else {
      location.assign(location.origin + "/");
    }
  }
  get monitoringAllowed() {
    return this.profile?.permissions?.includes("permission_monitor_read");
  }
  private renew(seconds: number) {
    return (this.refresh ||= new Promise<void>((resolve, reject) =>
      this.auth.refreshToken(seconds, resolve, () =>
        reject(new Error(this.i18n.t("Errors.SessionExpired"))),
      ),
    ).finally(() => {
      this.refresh = undefined;
    }));
  }
  async raw(
    path: string,
    method = "GET",
    body?: unknown,
    etag?: string | null,
    accept = "application/json",
  ): Promise<Response> {
    const url = path.startsWith("/")
      ? this.config.resourceRestAPI.replace(/\/$/, "") + path
      : path;
    // Never send a bearer token to a URL supplied in an artifact or paging response.
    const allowed = [
      this.config.resourceRestAPI,
      this.config.userRestAPI,
      this.config.groupRestAPI,
    ].map((base) => new URL(base).origin);
    if (!allowed.includes(new URL(url).origin))
      throw new Error(this.i18n.t("Errors.UntrustedDestination"));
    await this.renew(30);
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = {
        Authorization: "Bearer " + this.auth.getToken(),
        Accept: accept,
        "CEDAR-Client-Session-Id": this.session,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (etag) headers["If-Match"] = etag;
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 401 && attempt === 0) {
        await this.renew(-1);
        continue;
      }
      if (!response.ok) {
        let message = "";
        try {
          const data = await response.json();
          message = data.message || data.error || "";
        } catch {}
        if (response.status === 412)
          throw new HttpError(
            412,
            /no longer exists/i.test(message)
              ? this.i18n.t("Errors.ItemDeleted")
              : this.i18n.t("Errors.ItemChanged"),
          );
        throw new HttpError(
          response.status,
          message ||
            this.i18n.t("Errors.RequestFailed", { status: response.status }),
        );
      }
      return response;
    }
    throw new Error(this.i18n.t("Errors.SessionExpired"));
  }
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    etag?: string | null,
  ): Promise<Reply<T>> {
    const response = await this.raw(path, method, body, etag);
    const text = await response.text();
    return {
      data: text ? (JSON.parse(text) as T) : (undefined as T),
      etag: response.headers.get("ETag"),
    };
  }
  path(r: Resource) {
    return (
      "/" + collections[r.resourceType] + "/" + encodeURIComponent(r["@id"])
    );
  }
  report(r: Resource) {
    return this.request<Resource>(
      this.path(r) + (r.resourceType === "folder" ? "" : "/report"),
    );
  }
  snapshot(r: Resource, content = false) {
    return this.request<Resource>(
      this.path(r) + (r.resourceType === "folder" || content ? "" : "/details"),
    );
  }
  async download(r: Resource, format: string) {
    const response = await this.raw(
      this.path(r) + "/download?compact=" + (format === "yamlc"),
      "POST",
      {},
      undefined,
      format === "json" ? "application/json" : "application/x-yaml",
    );
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download =
      (r["schema:name"] || "artifact") +
      "." +
      (format === "json" ? "json" : "yaml");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
