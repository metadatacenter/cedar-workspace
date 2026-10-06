import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { Settings } from "./settings";
import { deferred } from "./testing/workspace-fixture";

function setup() {
  const api = {
    init: vi.fn(async () => true),
    request: vi.fn(),
    userPath: "https://user.example/users/me",
    profile: {
      uiPreferences: { preferredDateFormat: "YYYY-MM-DD", other: "keep" },
    },
  };
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
  for (const order of ["old-first", "new-first"])
    for (const oldFails of [false, true])
      for (const newFails of [false, true]) {
        it(`ignores disposed writes: ${order}, old failure=${oldFails}, new failure=${newFails}`, async () => {
          const { api, create } = setup();
          const oldReply = deferred<unknown>(),
            newReply = deferred<unknown>();
          api.request
            .mockReturnValueOnce(oldReply.promise)
            .mockReturnValueOnce(newReply.promise);
          const old = create();
          await old.ngOnInit();
          const oldSave = old.save("DD/MM/YYYY");
          old.ngOnDestroy();
          const fresh = create();
          await fresh.ngOnInit();
          const freshSave = fresh.save("MM/DD/YYYY");
          const finishOld = async () => {
            oldFails
              ? oldReply.reject(new Error("Old failure"))
              : oldReply.resolve({});
            await oldSave;
          };
          const finishNew = async () => {
            newFails
              ? newReply.reject(new Error("New failure"))
              : newReply.resolve({});
            await freshSave;
          };
          if (order === "old-first") {
            await finishOld();
            await finishNew();
          } else {
            await finishNew();
            await finishOld();
          }
          const expected = newFails ? "YYYY-MM-DD" : "MM/DD/YYYY";
          expect(api.profile.uiPreferences).toEqual({
            preferredDateFormat: expected,
            other: "keep",
          });
          expect(fresh.saved).toBe(expected);
          expect(old.notice()).toBe("");
          expect(old.error()).toBe("");
          await old.save("DD/MM/YYYY");
          expect(api.request).toHaveBeenCalledTimes(2);
        });
      }
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
        const before = [
          host.selected,
          host.ready(),
          host.error(),
          host.ceeVersion(),
        ];
        fails ? reply.reject(new Error("Late failure")) : reply.resolve(true);
        await init;
        expect([
          host.selected,
          host.ready(),
          host.error(),
          host.ceeVersion(),
        ]).toEqual(before);
      });
    }
  it("cannot update a replacement profile with an earlier user's preference", async () => {
    const { api, create } = setup();
    const host = create();
    await host.ngOnInit();
    const reply = deferred<unknown>();
    api.request.mockReturnValue(reply.promise);
    const saving = host.save("DD/MM/YYYY");
    api.profile = {
      uiPreferences: { preferredDateFormat: "MM/DD/YYYY", other: "new user" },
    };
    reply.resolve({});
    await saving;
    expect(api.profile.uiPreferences.preferredDateFormat).toBe("MM/DD/YYYY");
    expect(host.notice()).toBe("");
  });
});
