import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { Config } from "./resource";
const config = {
  resourceRestAPI: "https://resource.example",
  userRestAPI: "https://user.example",
  groupRestAPI: "https://group.example",
} as Config;
describe("Authorized backend", () => {
  let api: Backend;
  let fetcher: ReturnType<typeof vi.fn>;
  let renew: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    api = TestBed.runInInjectionContext(() => new Backend());
    api.config = config;
    renew = vi.fn((_s: number, ok: () => void) => ok());
    Object.assign(api, {
      auth: { refreshToken: renew, getToken: () => "test-token" },
    });
    fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("sends the original ETag and returns the next revision", async () => {
    fetcher.mockResolvedValue(
      new Response("{}", { headers: { ETag: '"next"' } }),
    );
    const result = await api.request(
      "/command/rename-resource",
      "POST",
      { "@id": "id" },
      '"original"',
    );
    expect(fetcher.mock.calls[0][1].headers["If-Match"]).toBe('"original"');
    expect(result.etag).toBe('"next"');
  });
  it("does not silently retry conflicting writes", async () => {
    fetcher.mockResolvedValue(new Response("", { status: 412 }));
    await expect(
      api.request("/folders/id", "PUT", {}, '"stale"'),
    ).rejects.toThrow("Your edits have been kept");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes deletion conflicts from concurrent updates", async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "The artifact no longer exists" }),
        { status: 412 },
      ),
    );
    await expect(
      api.request("/template-instances/id", "PUT", {}, '"loaded"'),
    ).rejects.toThrow("This item was deleted. Your edits have been kept.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refreshes once on 401 and keeps the conditional request", async () => {
    fetcher
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}"));
    await api.request("/folders/id", "PUT", {}, '"etag"');
    expect(renew).toHaveBeenCalledWith(
      -1,
      expect.any(Function),
      expect.any(Function),
    );
    expect(fetcher.mock.calls[1][1].headers["If-Match"]).toBe('"etag"');
  });
  it("rejects artifact-provided external destinations before sending credentials", async () => {
    await expect(api.request("https://untrusted.example/data")).rejects.toThrow(
      "Untrusted",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts empty successful deletion responses", async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
    expect((await api.request("/folders/id", "DELETE")).data).toBeUndefined();
  });
});
