import { Confirmation } from "./confirmation";
import { TestBed } from "@angular/core/testing";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Profile, displayAccountDate } from "./profile";
import { Backend, HttpError } from "./backend.service";
import { canChangeKey } from "./api-key-state";
import { ApiKey } from "./account-types";
describe("Profile", () => {
  let host: Profile;
  let request: ReturnType<typeof vi.fn>;
  const key: ApiKey = {
    id: "key1",
    key: "not-a-real-secret",
    enabled: true,
    description: "Test",
  };
  beforeEach(() => {
    request = vi
      .fn()
      .mockResolvedValue({ data: { homeFolderId: "home", apiKeys: [key] } });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            request,
            init: vi.fn().mockResolvedValue(true),
            profile: { homeFolderId: "home" },
            userPath: "https://user.example/users/u",
            userId: "u",
            email: "u@example.org",
            config: { resourceRestAPI: "https://resource.example" },
          },
        },
      ],
    });
    host = TestBed.runInInjectionContext(() => new Profile());
    host.ready.set(true);
    host.loading.set(false);
    vi.spyOn(TestBed.inject(Confirmation), "confirm").mockResolvedValue(true);
  });
  afterEach(() => vi.restoreAllMocks());
  it("masks keys until explicitly revealed and keeps examples free of secrets", async () => {
    await host.ngOnInit();
    expect(host.keyText(key)).not.toContain(key.key);
    expect(JSON.stringify(host.examples)).not.toContain(key.key);
    host.toggle(key);
    expect(host.keyText(key)).toBe(key.key);
    host.toggle(key);
    expect(host.keyText(key)).not.toContain(key.key);
  });
  it("retains the last active key even when disabled keys exist", () => {
    host.keys.set([key, { ...key, id: "off", enabled: false }]);
    expect(host.canDelete(key)).toBe(false);
    expect(host.canDelete(host.keys()[1])).toBe(true);
  });
  it("creates with a trimmed description and resets visibility", async () => {
    host.description = " New key ";
    host.revealed.set(new Set(["key1"]));
    await host.mutate("create");
    expect(request).toHaveBeenCalledWith(
      "https://user.example/users/u/api-keys",
      "POST",
      { description: "New key" },
    );
    expect(host.description).toBe("");
    expect(host.revealed().size).toBe(0);
  });
  it("does not regenerate if confirmation is cancelled", async () => {
    vi.mocked(TestBed.inject(Confirmation).confirm).mockResolvedValue(false);
    await host.mutate("regenerate", key);
    expect(request).not.toHaveBeenCalled();
  });
  it("prevents concurrent writes and preserves input after failure", async () => {
    host.description = "Keep";
    let reject!: (e: Error) => void;
    request.mockImplementation(() => new Promise((_r, j) => (reject = j)));
    const saving = host.mutate("create");
    await host.mutate("create");
    expect(request).toHaveBeenCalledTimes(1);
    reject(new Error("Unavailable"));
    await saving;
    expect(host.description).toBe("Keep");
    expect(host.busy()).toBe(false);
  });
  it("enforces the creation limit and prevents deleting the only active key", async () => {
    host.keys.set(
      Array.from({ length: 20 }, (_, i) => ({ ...key, id: String(i) })),
    );
    await host.mutate("create");
    expect(request).not.toHaveBeenCalled();
    host.keys.set([key]);
    await host.mutate("delete", key);
    expect(request).not.toHaveBeenCalled();
  });
  it("formats legacy array dates and rejects invalid dates", () => {
    expect(displayAccountDate([2026, 9, 17])).not.toBe("");
    expect(displayAccountDate("invalid")).toBe("");
  });
  for (const action of ["create", "regenerate", "delete"] as const) {
    for (const status of [400, 401, 403, 404, 409, 412, 422, 428, 500, 503]) {
      it(`${action}: HTTP ${status} retains keys and safely recovers`, async () => {
        const keys = [key, { ...key, id: "other", key: "other-test-value" }];
        host.keys.set(keys);
        host.description = "Keep description";
        request.mockRejectedValue(new HttpError(status, "Rejected"));
        await host.mutate(action, action === "create" ? undefined : key);
        expect(host.keys()).toBe(keys);
        expect(host.description).toBe("Keep description");
        expect(host.reloadRequired()).toBe(![400, 422].includes(status));
        await host.mutate(action, action === "create" ? undefined : key);
        expect(request).toHaveBeenCalledTimes(
          [400, 422].includes(status) ? 2 : 1,
        );
        request
          .mockResolvedValueOnce({
            data: { homeFolderId: "home", apiKeys: keys },
          })
          .mockResolvedValueOnce({ data: {} });
        await host.ngOnInit();
        expect(host.reloadRequired()).toBe(false);
        expect(host.error()).toBe("");
        expect(host.description).toBe("Keep description");
      });
    }
    for (const invalid of [
      null,
      {},
      [{ ...key, enabled: "true" }],
      [key, key],
    ]) {
      it(`${action} rejects malformed acknowledgement ${JSON.stringify(invalid)}`, async () => {
        const keys = [key, { ...key, id: "other" }];
        host.keys.set(keys);
        request.mockResolvedValue({ data: { apiKeys: invalid } });
        await host.mutate(action, action === "create" ? undefined : key);
        expect(host.keys()).toBe(keys);
        expect(host.reloadRequired()).toBe(true);
        expect(host.error()).toContain("valid API-key state");
      });
    }
    for (const outcome of ["success", "failure"]) {
      it(`${action} ignores ${outcome} after page destruction`, async () => {
        const keys = [key, { ...key, id: "other" }];
        host.keys.set(keys);
        let resolve!: (v: unknown) => void, reject!: (e: Error) => void;
        request.mockImplementationOnce(
          () =>
            new Promise((yes, no) => {
              resolve = yes;
              reject = no;
            }),
        );
        const pending = host.mutate(
          action,
          action === "create" ? undefined : key,
        );
        await vi.waitFor(() => expect(resolve).toBeDefined());
        host.ngOnDestroy();
        if (outcome === "success") resolve({ data: { apiKeys: [] } });
        else reject(new Error("Late failure"));
        await pending;
        expect(host.keys()).toBe(keys);
        expect(host.notice()).toBe("");
        expect(host.error()).toBe("");
        expect(host.api.profile.apiKeys).toBeUndefined();
      });
    }
  }
  for (const action of ["regenerate", "delete"] as const) {
    for (const transition of ["destroy", "reload", "write", "replacement"]) {
      it(`${action} confirmation cannot survive ${transition}`, async () => {
        host.keys.set([key, { ...key, id: "other" }]);
        let decide!: (v: boolean) => void;
        vi.mocked(TestBed.inject(Confirmation).confirm).mockImplementationOnce(
          () => new Promise((resolve) => (decide = resolve)),
        );
        const pending = host.mutate(action, key);
        if (transition === "destroy") host.ngOnDestroy();
        if (transition === "reload") {
          request
            .mockResolvedValueOnce({
              data: { homeFolderId: "home", apiKeys: [key] },
            })
            .mockResolvedValueOnce({ data: {} });
          await host.ngOnInit();
        }
        if (transition === "write") {
          request.mockRejectedValueOnce(new HttpError(400, "Rejected"));
          await host.mutate("create");
        }
        if (transition === "replacement")
          host.keys.set([{ ...key }, { ...key, id: "other" }]);
        request.mockClear();
        decide(true);
        await pending;
        expect(request).not.toHaveBeenCalled();
      });
    }
  }
  for (const count of [0, 1, 2, 19, 20, 21]) {
    for (const active of [0, 1, 2]) {
      for (const action of ["create", "regenerate", "delete"] as const) {
        it(`${action}: ${count} keys with ${active} requested active keys`, () => {
          const keys = Array.from({ length: count }, (_, i) => ({
            ...key,
            id: String(i),
            enabled: i < active,
          }));
          const target = keys[0];
          expect(canChangeKey(keys, action, target)).toBe(
            action === "create"
              ? count < 20
              : action === "regenerate"
                ? count > 0
                : count > 1 && (active === 0 || active > 1),
          );
          if (action !== "create")
            expect(canChangeKey(keys, action, { ...key, id: "missing" })).toBe(
              false,
            );
        });
      }
    }
  }
  it("preserves description edits made after a creation starts", async () => {
    host.description = "Submitted";
    let finish!: (v: unknown) => void;
    request.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const pending = host.mutate("create");
    host.description = "Next key";
    finish({ data: { apiKeys: [key] } });
    await pending;
    expect(host.description).toBe("Next key");
    expect(host.keys()).toEqual([key]);
  });
  for (const invalid of [null, {}, { homeFolderId: "home", apiKeys: null }, { homeFolderId: "home", apiKeys: [key, key] }]) {
    it(`invalid incoming profile ${JSON.stringify(invalid)} cannot enable key mutations`, async () => {
      request.mockResolvedValueOnce({ data: invalid });
      await host.ngOnInit();
      expect(host.ready()).toBe(false);
      expect(host.error()).toContain("valid API-key state");
      request.mockClear(); await host.mutate("create"); expect(request).not.toHaveBeenCalled();
      request.mockResolvedValueOnce({ data: { homeFolderId: "home", apiKeys: [key] } }).mockResolvedValueOnce({ data: {} });
      await host.ngOnInit();
      expect(host.ready()).toBe(true); expect(host.error()).toBe("");
    });
  }
  for (const action of ["create", "regenerate", "delete"] as const) {
    it(`unchanged successful ${action} response is not an acknowledgement`, async () => {
      const keys = [key, { ...key, id: "other" }]; host.keys.set(keys);
      request.mockResolvedValueOnce({ data: { apiKeys: keys } });
      await host.mutate(action, action === "create" ? undefined : key);
      expect(host.reloadRequired()).toBe(true);
      expect(host.notice()).toBe("");
    });
  }

});
