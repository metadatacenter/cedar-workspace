import { expect, it, vi } from "vitest";
import { deferred, resource, workspaceRig } from "./testing/workspace-fixture";
import { Resource } from "./resource";

for (const older of ["enrichment", "detail", "menu"])
  for (const newer of ["detail", "menu", "description"])
    for (const oldFirst of [false, true]) {
      if (older === newer) continue;
      it(`${older} cannot replace newer ${newer}; old first=${oldFirst}`, async () => {
        const old = deferred<{ data: Resource }>();
        const fresh = deferred<{ data: Resource }>();
        const r = resource("item", "template");
        const report = vi.fn().mockResolvedValue({ data: r });
        if (older === "enrichment") report.mockReturnValueOnce(old.promise);
        const m = await workspaceRig(report);
        const event = {
          currentTarget: document.createElement("button"),
        } as unknown as MouseEvent;
        let previous: Promise<void> | undefined;
        if (older !== "enrichment") {
          report.mockReturnValueOnce(old.promise);
          previous =
            older === "detail" ? m.host.select(r) : m.host.toggleMenu(r, event);
        }
        const latest = {
          ...r,
          "schema:description": "fresh",
          currentUserPermissions: { capabilities: ["readResource"] },
        };
        let next: Promise<void> | undefined;
        if (newer === "description") m.host.descriptionSaved(latest);
        else {
          report.mockReturnValueOnce(fresh.promise);
          next =
            newer === "detail" ? m.host.select(r) : m.host.toggleMenu(r, event);
        }
        const settleOld = async () => {
          old.resolve({ data: { ...r, "schema:description": "stale" } });
          await previous;
          await vi.waitFor(() =>
            expect(
              m.host.state.report.find((op) => op.scope === "enrichment")
                ?.status,
            ).toBe("ready"),
          );
        };
        if (oldFirst) await settleOld();
        fresh.resolve({ data: latest });
        await next;
        if (!oldFirst) await settleOld();
        expect(m.host.rows()[0]["schema:description"]).toBe("fresh");
        expect(m.host.rows()[0].currentUserPermissions?.capabilities).toEqual([
          "readResource",
        ]);
        if (m.host.selected())
          expect(m.host.selected()!["schema:description"]).toBe("fresh");
        expect(m.host.error()).toBe("");
        m.fixture.destroy();
      });
    }
