import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { Settings } from "./settings";
import { deferred } from "./testing/workspace-fixture";

function setup() {
  const api = { init: vi.fn(async () => true) };
  const loader = { load: vi.fn(async () => {}) };
  TestBed.configureTestingModule({
    providers: [
      { provide: Backend, useValue: api },
      { provide: CeeLoader, useValue: loader },
    ],
  });
  const create = () => TestBed.runInInjectionContext(() => new Settings());
  return { api, loader, create };
}
describe("Settings component lifecycle", () => {
  for (const stage of ["initialization", "version"])
    for (const fails of [false, true]) {
      it(`ignores late ${stage} ${fails ? "failure" : "success"}`, async () => {
        const { api, loader, create } = setup();
        const reply = deferred<boolean>();
        if (stage === "initialization") api.init.mockReturnValue(reply.promise);
        else
          loader.load.mockImplementation(async () => {
            await reply.promise;
          });
        const host = create();
        const init = host.ngOnInit();
        await Promise.resolve();
        host.ngOnDestroy();
        const before = [host.ready(), host.error(), host.ceeVersion()];
        fails ? reply.reject(new Error("Late failure")) : reply.resolve(true);
        await init;
        expect([host.ready(), host.error(), host.ceeVersion()]).toEqual(before);
      });
    }
});
