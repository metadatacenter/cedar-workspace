import { expect, it } from "vitest";
import { workspaceRig, resource } from "./testing/workspace-fixture";

it("keeps failed moves selected through refresh outages and reconciles selection after recovery", async () => {
  const m = await workspaceRig();
  const items = [resource("a"), resource("b"), resource("c")];
  m.host.rows.set(items);
  m.host.selectionIds.set(items.map((r) => r["@id"]));
  m.move.mockResolvedValue({
    moved: ["a"],
    failed: [
      { resource: items[1], message: "Lost reply" },
      { resource: items[2], message: "Move refused" },
    ],
  });
  const original = m.api.request.getMockImplementation()!;
  let unavailable = true;
  m.api.request.mockImplementation(async (path) => {
    if (path.includes("/contents")) {
      if (unavailable) throw new Error("Refresh unavailable");
      return { data: { resources: [items[2]], totalCount: 1, pathInfo: [] } };
    }
    return original(path);
  });
  await m.host.moveItems(items, "target");
  expect(m.host.notice()).toBe("Moved 1 item.");
  expect(m.host.error()).toContain("Refresh unavailable");
  expect(m.host.error()).toContain("Lost reply");
  expect(m.host.error()).toContain("Move refused");
  expect(m.host.selectionIds()).toEqual(["b", "c"]);
  await m.host.load(true);
  expect(m.host.selectionIds()).toEqual(["b", "c"]);
  expect(m.move).toHaveBeenCalledTimes(1);
  unavailable = false;
  await m.host.load(true);
  expect(m.host.selectionIds()).toEqual(["c"]);
  expect(m.host.error()).toBe("");
  expect(m.move).toHaveBeenCalledTimes(1);
  m.fixture.destroy();
});

it("does not carry a failed move's pending selection into a new listing", async () => {
  const m = await workspaceRig();
  const item = resource("item");
  m.move.mockResolvedValue({
    moved: [],
    failed: [{ resource: item, message: "Lost reply" }],
  });
  const original = m.api.request.getMockImplementation()!;
  m.api.request.mockRejectedValue(new Error("Refresh unavailable"));
  await m.host.moveItems([item], "target");
  expect(m.host.selectionIds()).toEqual(["item"]);
  m.api.request.mockImplementation(original);
  await m.host.load();
  await m.host.load(true);
  expect(m.host.selectionIds()).toEqual([]);
  m.fixture.destroy();
});
