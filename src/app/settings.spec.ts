import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { Settings } from "./settings";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";
describe("Settings", () => {
  let host: Settings;
  let request: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    request = vi.fn().mockResolvedValue({ data: {} });
    TestBed.configureTestingModule({
      providers: [
        { provide: Backend, useValue: { init: async () => true, request } },
        { provide: CeeLoader, useValue: { load: async () => {} } },
      ],
    });
    host = TestBed.runInInjectionContext(() => new Settings());
  });
  it("shows the page while CEE's version is unavailable", async () => {
    vi.spyOn(host.loader, "load").mockRejectedValue(new Error("offline"));
    await host.ngOnInit();
    expect(host.ready()).toBe(true);
    expect(host.ceeVersion()).toBe("Unavailable");
  });
  it("writes nothing to the account", async () => {
    await host.ngOnInit();
    expect(request).not.toHaveBeenCalled();
  });
});
