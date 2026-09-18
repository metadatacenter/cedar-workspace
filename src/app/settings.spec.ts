import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { Settings } from "./settings";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { dateFormat, dateFormats } from "./date-format";
import { formatDate } from "@angular/common";
describe("Settings", () => {
  let host: Settings;
  let request: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    request = vi.fn().mockResolvedValue({ data: {} });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            init: async () => true,
            request,
            userPath: "https://user.example/users/me",
            profile: {
              uiPreferences: {
                preferredDateFormat: "YYYY-MM-DD",
                other: "preserved",
              },
            },
          },
        },
        { provide: CeeLoader, useValue: { load: async () => {} } },
      ],
    });
    host = TestBed.runInInjectionContext(() => new Settings());
  });
  it("loads the saved preference and supports unavailable CEE independently", async () => {
    vi.spyOn(host.loader, "load").mockRejectedValue(new Error("offline"));
    await host.ngOnInit();
    expect(host.selected).toBe("YYYY-MM-DD");
    expect(host.ready()).toBe(true);
    expect(host.ceeVersion()).toBe("Unavailable");
  });
  it("writes only the date preference and preserves other values", async () => {
    await host.ngOnInit();
    await host.save("DD/MM/YYYY");
    expect(request).toHaveBeenCalledWith(
      "https://user.example/users/me",
      "PUT",
      { "uiPreferences.preferredDateFormat": "DD/MM/YYYY" },
    );
    expect(host.api.profile.uiPreferences?.["other"]).toBe("preserved");
    expect(host.saved).toBe("DD/MM/YYYY");
  });
  it("restores the server value on failure", async () => {
    await host.ngOnInit();
    request.mockRejectedValue(new Error("offline"));
    await host.save("DD/MM/YYYY");
    expect(host.selected).toBe("YYYY-MM-DD");
    expect(host.api.profile.uiPreferences?.preferredDateFormat).toBe(
      "YYYY-MM-DD",
    );
    expect(host.error()).toBe("offline");
  });
  it("rejects unknown formats and overlapping writes", async () => {
    await host.save("nonsense");
    expect(request).not.toHaveBeenCalled();
    request.mockReturnValue(new Promise(() => {}));
    void host.save("DD/MM/YYYY");
    await host.save("YYYY-MM-DD");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("maps every stored format without month/minute or year-boundary errors", () => {
    const d = new Date(2027, 0, 2, 15, 4);
    expect(
      Object.keys(dateFormats).map((f) =>
        formatDate(d, dateFormat(f), "en-US"),
      ),
    ).toEqual([
      "01/02/2027",
      "2027-01-02",
      "02/01/2027",
      "01/02/27",
      "02/01/27",
      "02.01.2027",
      "2 Jan 2027",
      "Jan 2, 2027",
      "Sat, 2 Jan 2027",
    ]);
    expect(dateFormat("invalid")).toBe("MM/dd/yyyy");
  });
});
