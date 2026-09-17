import { Injectable } from "@angular/core";
import { Config, Resource, collections } from "./resource";
interface Auth {
  initUserHandler(ok: (authenticated: boolean) => void, fail: () => void): void;
  refreshToken(seconds: number, ok: () => void, fail: () => void): void;
  getToken(): string;
  getParsedToken(): { sub: string; realm_access?: { roles: string[] } };
  doLogin(): void;
  doLogout(options?: object): void;
}
declare global {
  interface Window {
    KeycloakUserHandler: new () => Auth;
    dataciteEnabled?: boolean;
    makeOpenEnabled?: boolean;
  }
}
export interface Reply<T> {
  data: T;
  etag: string | null;
}
@Injectable({ providedIn: "root" })
export class Backend {
  config!: Config;
  profile!: { homeFolderId: string; permissions?: string[] };
  private auth!: Auth;
  private refresh?: Promise<void>;
  private readonly session = crypto.randomUUID();
  async init() {
    const response = await fetch("/config/url-service.conf.json", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("Unable to load workspace configuration.");
    this.config = await response.json();
    this.auth = new window.KeycloakUserHandler();
    const authenticated = await new Promise<boolean>((resolve, reject) =>
      this.auth.initUserHandler(resolve, () =>
        reject(new Error("Sign-in failed. Please reload.")),
      ),
    );
    if (!authenticated) {
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
  logout() {
    this.auth.doLogout({ redirectUri: location.origin });
  }
  get monitoringAllowed() {
    return this.profile?.permissions?.includes("permission_monitor_read");
  }
  private renew(seconds: number) {
    return (this.refresh ||= new Promise<void>((resolve, reject) =>
      this.auth.refreshToken(seconds, resolve, () =>
        reject(new Error("Your session expired. Please sign in again.")),
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
      this.config.impexRestAPI,
    ].map((base) => new URL(base).origin);
    if (!allowed.includes(new URL(url).origin))
      throw new Error("Untrusted API destination.");
    await this.renew(30);
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers: Record<string, string> = {
        Authorization: "Bearer " + this.auth.getToken(),
        Accept: accept,
        "CEDAR-Client-Session-Id": this.session,
      };
      if (body !== undefined && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
      if (etag) headers["If-Match"] = etag;
      const response = await fetch(url, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      });
      if (response.status === 401 && attempt === 0) {
        await this.renew(-1);
        continue;
      }
      if (!response.ok) {
        if (response.status === 412)
          throw new Error(
            "This item changed since you opened it. Your edits have been kept. Cancel and reopen to review the latest version.",
          );
        let message = "";
        try {
          const data = await response.json();
          message = data.message || data.error || "";
        } catch {}
        throw new Error(message || `Request failed (${response.status}).`);
      }
      return response;
    }
    throw new Error("Your session expired. Please sign in again.");
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
