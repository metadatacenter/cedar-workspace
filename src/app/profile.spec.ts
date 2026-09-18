import { TestBed } from "@angular/core/testing";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Profile, displayAccountDate } from "./profile";
import { Backend } from "./backend.service";
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
    request = vi.fn().mockResolvedValue({ data: { apiKeys: [key] } });
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
    vi.spyOn(window, "confirm").mockReturnValue(true);
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
    vi.mocked(window.confirm).mockReturnValue(false);
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
});
