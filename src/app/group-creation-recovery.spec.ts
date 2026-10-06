import { TestBed } from "@angular/core/testing";
import { expect, it, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { Groups } from "./groups";

for (const status of [0, 200, 201, 400, 401, 403, 408, 409, 422, 429, 500, 503])
  it(`group creation after ${status} retains intent and only permits safe retries`, async () => {
    const request = vi.fn().mockRejectedValue(new HttpError(status, "Unconfirmed"));
    TestBed.configureTestingModule({providers: [{provide: Backend, useValue: {request, init: async () => true, profile: {"@id": "me"}, config: {groupRestAPI: "https://groups.example"}}}]});
    const host = TestBed.runInInjectionContext(() => new Groups());
    host.newName = "New group";
    await host.create();
    const uncertain = [0, 200, 201, 408, 500, 503].includes(status);
    expect(host.uncertainCreation()).toBe(uncertain);
    await host.create();
    expect(request).toHaveBeenCalledTimes(uncertain ? 1 : 2);
    if (uncertain) {
      await host.ngOnInit();
      expect(host.uncertainCreation()).toBe(true);
      request.mockImplementation(async (path: string) => ({data: path === "/users" ? {users: []} : {groups: []}}));
      await host.ngOnInit();
      expect(host.uncertainCreation()).toBe(false);
      expect(host.newName).toBe("New group");
    }
    host.ngOnDestroy();
  });
