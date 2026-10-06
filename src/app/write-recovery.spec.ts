import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "./backend.service";
import { RevisionCoordinator } from "./revision-coordinator";
import { metadataRig } from "./testing/metadata-fixture";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

for (const status of [0, 200, 201, 400, 401, 403, 404, 408, 409, 412, 422, 428, 429, 500, 503]) {
  const recovery = ![400, 422, 429].includes(status);
  const uncertain = [0, 200, 201, 408, 500, 503].includes(status);
  it(`revision recovery after HTTP ${status} requires a successful read`, () => {
    const state = new RevisionCoordinator();
    state.write()!.fail(new HttpError(status, "Write failed"));
    expect(state.reloadRequired()).toBe(recovery);
    if (recovery) {
      expect(state.write()).toBeNull();
      state.read()!.fail(new Error("Read failed"));
      expect(state.write()).toBeNull();
      state.read()!.finish();
      expect(state.write()).not.toBeNull();
    }
    state.dispose();
  });
  for (const mode of ["create", "edit"]) {
    it(`${mode} does not repeat an uncertain mutation after HTTP ${status}`, async () => {
      const m = await metadataRig(mode);
      try {
        m.edit();
        m.request.mockRejectedValueOnce(new HttpError(status, "Write failed"));
        await m.host.save();
        expect(m.host.state.reloadRequired()).toBe(recovery);
        expect(m.host.state.uncertainCreation()).toBe(mode === "create" && uncertain);
        expect(m.host.dirty()).toBe(true);
        const calls = m.request.mock.calls.length;
        if (recovery) {
          await m.host.save();
          expect(m.request).toHaveBeenCalledTimes(calls);
          await m.host.reload();
          if (mode === "create" && uncertain) {
            expect(m.request).toHaveBeenCalledTimes(calls);
            expect(m.host.state.reloadRequired()).toBe(true);
          } else expect(m.host.state.reloadRequired()).toBe(false);
        }
      } finally { m.host.ngOnDestroy(); }
    });
  }
}
