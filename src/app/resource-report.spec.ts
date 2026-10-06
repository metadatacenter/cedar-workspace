import { expect, it, vi } from "vitest";
import { resource, workspaceRig } from "./testing/workspace-fixture";
import { validResourceReport } from "./resource-report";
const r = resource("item", "template");
const malformed: unknown[] = [
  null,
  [],
  {},
  { ...r, "@id": "other" },
  { ...r, resourceType: "folder" },
  ...Object.entries({
    "schema:name": {},
    "bibo:status": 1,
    currentUserPermissions: { capabilities: "updateResource" },
    pathInfo: {},
    versions: [null],
    isBasedOn: "template",
    derivedFrom: { "@id": "x", "pav:version": 1 },
    isOpen: "true",
    numberOfInstances: -1,
    everybodyPermission: [],
  }).map(([key, value]) => ({ ...r, [key]: value })),
];
for (const bad of malformed) {
  it(`rejects malformed report ${JSON.stringify(bad)}`, () =>
    expect(validResourceReport(bad, r)).toBe(false));
  for (const scope of ["enrichment", "detail", "menu"]) {
    it(`${scope} rejects ${JSON.stringify(bad)} without replacing identity or capabilities`, async () => {
      const report = vi
        .fn()
        .mockResolvedValue({ data: scope === "enrichment" ? bad : r });
      const m = await workspaceRig(report);
      report.mockResolvedValue({ data: bad });
      if (scope === "detail") await m.host.select(r);
      if (scope === "menu")
        await m.host.toggleMenu(r, {
          currentTarget: document.createElement("button"),
        } as unknown as MouseEvent);
      await vi.waitFor(() =>
        expect(m.host.error()).toContain("resource details"),
      );
      expect(m.host.rows()).toEqual([r]);
      if (scope === "detail") expect(m.host.selected()).toEqual(r);
      report.mockResolvedValue({ data: r });
      await m.host.select(r);
      expect(m.host.error()).toBe("");
      m.fixture.destroy();
    });
  }
}
it("accepts reduced path resources and inaccessible versions without inventing names", () => {
  expect(
    validResourceReport(
      {
        ...r,
        pathInfo: [{ "@id": "home", isOpen: true }],
        versions: [{ "@id": "old", activeUserCanRead: false }],
        derivedFrom: null,
        everybodyPermission: null,
      },
      r,
    ),
  ).toBe(true);
});
