import { TestBed } from "@angular/core/testing";
import { afterEach, describe, it, expect, vi } from "vitest";
import { Backend } from "./backend.service";
import { Logout } from "./logout";
describe("Logout", () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup(authenticated = true) {
    const logout = vi.fn().mockResolvedValue(undefined),
      login = vi.fn(),
      assign = vi.fn();
    vi.stubGlobal("location", { origin: "https://workspace.example", assign });
    vi.stubGlobal(
      "KeycloakUserHandler",
      class {
        initUserHandler(ok: (authenticated: boolean) => void) {
          ok(authenticated);
        }
        doLogout = logout;
        doLogin = login;
        getParsedToken() {
          return { sub: "me" };
        }
        refreshToken(_n: number, ok: () => void) {
          ok();
        }
        getToken() {
          return "test";
        }
      },
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            userRestAPI: "https://user.example",
            resourceRestAPI: "https://resource.example",
            groupRestAPI: "https://group.example",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    return { api: new Backend(), logout, login, assign, fetcher };
  }
  it("signs out without fetching the user profile", async () => {
    const { api, logout, fetcher } = setup();
    await api.logout();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledWith({
      redirectUri: "https://workspace.example/",
    });
  });
  it("returns an already signed-out visitor to the same origin without logging in", async () => {
    const { api, logout, login, assign } = setup(false);
    await api.logout();
    expect(login).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("https://workspace.example/");
  });
  it("can sign out even if the profile request failed", async () => {
    const { api, fetcher, logout } = setup();
    fetcher
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userRestAPI: "https://user.example",
            resourceRestAPI: "https://resource.example",
            groupRestAPI: "https://group.example",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(api.init()).rejects.toThrow();
    await api.logout();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("shows a logout failure rather than falsely reporting success", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("Sign-out unavailable"));
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: { logout } }],
    });
    const page = TestBed.runInInjectionContext(() => new Logout());
    await page.ngOnInit();
    expect(page.error()).toBe("Sign-out unavailable");
  });
});
