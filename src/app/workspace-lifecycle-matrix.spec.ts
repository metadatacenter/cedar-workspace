import { TestBed } from "@angular/core/testing";
import { expect, it, vi } from "vitest";
import { Resource } from "./resource";
import { Workspace } from "./workspace";
import { resource, workspaceRig, deferred } from "./testing/workspace-fixture";

// The same resource is published by different scopes, including callbacks belonging
// to a destroyed component while its replacement uses the same backend service.
for (const scopes of [
  ["enrichment", "detail"],
  ["detail", "menu"],
  ["menu", "detail"],
])
  for (const oldFirst of [true, false])
    for (const recreate of [true, false])
      for (const writable of [true, false])
        for (const revisionChanged of [true, false]) {
          it(`${scopes.join(" → ")}, oldFirst=${oldFirst}, recreate=${recreate}, writable=${writable}, revisionChanged=${revisionChanged}`, async () => {
            const r = {
              ...resource("item", "template"),
              "pav:version": "1.0.0",
            };
            const old = deferred<{ data: Resource }>();
            const fresh = deferred<{ data: Resource }>();
            const report = vi.fn().mockResolvedValue({ data: r });
            if (scopes[0] === "enrichment")
              report.mockReturnValueOnce(old.promise);
            const m = await workspaceRig(report);
            let fixture = m.fixture;
            let host = m.host;
            const event = {
              currentTarget: document.createElement("button"),
            } as unknown as MouseEvent;
            let oldWork: Promise<void> | undefined;
            if (scopes[0] !== "enrichment") {
              report.mockReturnValueOnce(old.promise);
              oldWork =
                scopes[0] === "detail"
                  ? host.select(r)
                  : host.toggleMenu(r, event);
            }
            if (recreate) {
              fixture.destroy();
              fixture = TestBed.createComponent(Workspace);
              fixture.detectChanges();
              host = fixture.componentInstance;
              await vi.waitFor(() =>
                expect(host.currentFolder()).toBeDefined(),
              );
            }
            const latest: Resource = {
              ...r,
              "schema:description": "latest",
              "pav:version": revisionChanged ? "2.0.0" : "1.0.0",
              currentUserPermissions: {
                capabilities: writable
                  ? ["readResource", "updateResource"]
                  : ["readResource"],
              },
            };
            report.mockReturnValueOnce(fresh.promise);
            const newWork =
              scopes[1] === "detail"
                ? host.select(r)
                : host.toggleMenu(r, event);
            const settleOld = async () => {
              old.resolve({ data: { ...r, "schema:description": "obsolete" } });
              await oldWork;
              if (!recreate)
                await vi.waitFor(() =>
                  expect(
                    host.state.report.find((op) => op.scope === "enrichment")
                      ?.status,
                  ).toBe("ready"),
                );
            };
            if (oldFirst) await settleOld();
            fresh.resolve({ data: latest });
            await newWork;
            if (!oldFirst) await settleOld();
            expect(host.rows()[0]).toEqual(latest);
            expect(
              host
                .actions(host.rows()[0])
                .find((action) => action.id === "rename")?.enabled,
            ).toBe(writable);
            if (host.selected()) expect(host.selected()).toEqual(latest);
            expect(host.error()).toBe("");
            fixture.destroy();
          });
        }
