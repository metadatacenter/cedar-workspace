import { TestBed } from "@angular/core/testing";
import { expect, it, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { ResourceDialog } from "./resource-dialog";
import { resource } from "./testing/workspace-fixture";

for (const action of ["rename", "new-folder", "copy", "draft", "publish"])
  for (const status of [0, 200, 400, 401, 403, 408, 409, 412, 422, 428, 500])
    it(`${action} ${status}: preserves intent and requires the appropriate recovery`, async () => {
      const r = resource("item");
      const request = vi.fn().mockResolvedValue({data: {resources: [], totalCount: 0}});
      const snapshot = vi.fn().mockResolvedValue({data: r, etag: '"old"'});
      const report = vi.fn().mockResolvedValue({data: r});
      TestBed.configureTestingModule({providers: [{provide: Backend, useValue: {request, snapshot, report}}]});
      const host = TestBed.runInInjectionContext(() => new ResourceDialog());
      host.action = action; host.resource = r; host.folder = "home";
      await host.load();
      host.target = "home"; host.targetResource = {...resource("home", "folder"), currentUserPermissions: {capabilities: ["copyIntoFolder"]}};
      host.name = "My draft"; host.description = "Keep this";
      request.mockClear().mockRejectedValue(new HttpError(status, "Rejected"));
      await host.submit();
      const recovery = ![400, 422].includes(status);
      expect(host.reloadRequired()).toBe(recovery);
      await host.submit();
      expect(request).toHaveBeenCalledTimes(recovery ? 1 : 2);
      if (recovery) {
        snapshot.mockRejectedValueOnce(new Error("Offline"));
        await host.load(); await host.submit();
        expect(request).toHaveBeenCalledTimes(1);
        expect(host.description).toBe("Keep this");
        snapshot.mockResolvedValue({data: {...r, "schema:description": "Remote"}, etag: '"new"'});
        await host.load();
        if (action === "rename") {
          expect(host.reloadRequired()).toBe(false);
          request.mockResolvedValue({});
          await host.submit();
          expect(request.mock.calls.at(-1)?.[3]).toBe('"new"');
        } else {
          expect(host.inspectionRequired()).toBe(true);
          expect(host.reloadRequired()).toBe(true);
        }
      }
      host.ngOnDestroy();
    });
