import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { resourceSelector, useDeploymentDomain } from "./resource-address";

const config = { resourceRestAPI: "https://resource.example", userRestAPI: "https://user.example", groupRestAPI: "https://group.example" };
const profile = { "@id": "me", homeFolderId: "https://repo.example/folders/home" };
describe("Backend initialization recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useDeploymentDomain(null);
  });
  it.each(["configuration", "authentication", "profile"])("retries a failed %s stage without replaying successful authentication", async (stage) => {
    let fail = true;
    const auth = vi.fn((ok: (value: boolean) => void, reject: () => void) => fail && stage === "authentication" ? reject() : ok(true));
    vi.stubGlobal("KeycloakUserHandler", class {
      initUserHandler = auth;
      refreshToken(_seconds: number, ok: () => void) { ok(); }
      getToken() { return "token"; }
      getParsedToken() { return { sub: "me" }; }
      doLogin() {}
      doLogout() {}
    });
    const fetcher = vi.fn(async (path: string) => {
      const configuration = path.startsWith("/config/");
      if (fail && stage === (configuration ? "configuration" : "profile")) return new Response("", { status: 503 });
      return Response.json(configuration ? config : profile);
    });
    vi.stubGlobal("fetch", fetcher);
    const api = TestBed.runInInjectionContext(() => new Backend());
    const first = api.init();
    expect(api.init()).toBe(first);
    await expect(first).rejects.toThrow();
    fail = false;
    const retry = api.init();
    expect(api.init()).toBe(retry);
    await expect(retry).resolves.toBe(true);
    const calls = fetcher.mock.calls.length;
    await expect(api.init()).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(fetcher.mock.calls.filter(([path]) => path.startsWith("/config/"))).toHaveLength(stage === "profile" ? 1 : 2);
    expect(api.profile).toEqual(profile);
  });
  // The configured resource API names the base; a home folder minted under an earlier domain does not.
  it("learns the base to shorten against from the configured resource API, not the home folder", async () => {
    const uuid = "7f0a0f3e-f0e5-4c29-85fa-e646e0fbee22";
    const legacy = { "@id": "me", homeFolderId: `https://repo.metadatacenter.net/folders/${uuid}` };
    vi.stubGlobal("KeycloakUserHandler", class {
      initUserHandler(ok: (value: boolean) => void) { ok(true); }
      refreshToken(_seconds: number, ok: () => void) { ok(); }
      getToken() { return "token"; }
      getParsedToken() { return { sub: "me" }; }
      doLogin() {}
      doLogout() {}
    });
    vi.stubGlobal("fetch", vi.fn(async (path: string) => Response.json(path.startsWith("/config/") ? config : legacy)));
    const api = TestBed.runInInjectionContext(() => new Backend());
    await expect(api.init()).resolves.toBe(true);
    expect(resourceSelector(legacy.homeFolderId)).toBe(legacy.homeFolderId);
    expect(resourceSelector(`https://repo.example/folders/${uuid}`)).toBe(`folders/${uuid}`);
  });
});
