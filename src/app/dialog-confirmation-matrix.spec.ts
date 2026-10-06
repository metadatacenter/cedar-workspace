import { TestBed } from "@angular/core/testing";
import { expect, it, vi } from "vitest";
import { ResourceDialog } from "./resource-dialog";
import { Backend, HttpError } from "./backend.service";
import { Confirmation } from "./confirmation";
import { deferred, resource } from "./testing/workspace-fixture";

for (const action of ["rename", "new-folder"])
  for (const accept of [true, false])
    for (const transition of [
      "stable",
      "edit",
      "reload",
      "pending write",
      "failed write",
      "destroy",
    ])
      it(`${action}: ${accept ? "accept" : "cancel"} discard after ${transition}`, async () => {
        const r = resource("item");
        const answer = deferred<boolean>();
        const write = deferred<unknown>();
        const api = {
          snapshot: vi.fn().mockResolvedValue({ data: r, etag: '"revision"' }),
          request: vi.fn().mockReturnValue(write.promise),
        };
        TestBed.configureTestingModule({
          providers: [
            { provide: Backend, useValue: api },
            {
              provide: Confirmation,
              useValue: { confirm: () => answer.promise },
            },
          ],
        });
        const host = TestBed.runInInjectionContext(() => new ResourceDialog());
        host.resource = r;
        host.action = action;
        await host.load();
        host.name = "Draft";
        const closed = vi.spyOn(host.closed, "emit");
        const closing = host.close();
        let saving: Promise<void> | undefined;
        if (transition === "edit") host.name = "Later draft";
        if (transition === "reload") await host.load();
        if (transition.includes("write")) {
          saving = host.submit();
          if (transition === "failed write") {
            write.reject(new HttpError(0, "Unknown result"));
            await saving;
          }
        }
        if (transition === "destroy") host.ngOnDestroy();
        answer.resolve(accept);
        await closing;
        expect(closed).toHaveBeenCalledTimes(
          Number(accept && transition === "stable"),
        );
        if (transition === "pending write") {
          write.resolve({});
          await saving;
        }
        host.ngOnDestroy();
      });
