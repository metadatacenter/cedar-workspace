import { expect, it } from "vitest";
import { workspaceRig, resource, deferred } from "./testing/workspace-fixture";

for (const transition of ["destroy", "navigate", "none"])
  for (const failure of [true, false])
    it(`move ${failure ? "failure" : "success"} after ${transition} belongs only to its original view`, async () => {
      const m = await workspaceRig();
      const pending = deferred<{ moved: string[]; failed: [] }>();
      m.move.mockReturnValue(pending.promise);
      const moving = m.host.moveItems([resource("item")], "target");
      if (transition === "destroy") m.fixture.destroy();
      if (transition === "navigate") await m.host.load();
      m.api.request.mockClear();
      failure ? pending.reject(new Error("Move failed")) : pending.resolve({ moved: ["item"], failed: [] });
      await moving;
      if (transition !== "none") {
        expect(m.api.request).not.toHaveBeenCalled();
        expect(m.host.notice()).toBe("");
        expect(m.host.error()).toBe("");
        expect(m.host.movedTarget()).toBe("");
      } else {
        expect(m.host.moving()).toBe(false);
        expect(m.host.error()).toBe(failure ? "Move failed" : "");
        expect(m.host.movedTarget()).toBe(failure ? "" : "target");
      }
      if (transition !== "destroy") m.fixture.destroy();
      m.api.request.mockClear();
      await m.host.load();
      await m.host.moveItems([resource("item")], "target");
      expect(m.api.request).not.toHaveBeenCalled();
      expect(m.move).toHaveBeenCalledTimes(1);
    });
