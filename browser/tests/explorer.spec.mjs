import AxeBuilder from "@axe-core/playwright";
import { test, expect, resource } from "./fixtures.mjs";
const folder = {
  ...resource,
  "@id": "destination",
  resourceType: "folder",
  "schema:name": "Archive",
  currentUserPermissions: { capabilities: ["readResource", "moveIntoFolder"] },
};
const items = ["a", "b", "c"].map((id) => ({
  ...resource,
  "@id": id,
  resourceType: "instance",
  "schema:name": `Sample ${id}`,
}));
async function setup(page) {
  const moved = new Set();
  await page.route("**/api/resource/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.includes("/contents"))
      return route.fulfill({
        json: {
          resources: [folder, ...items.filter((r) => !moved.has(r["@id"]))],
          totalCount: 4 - moved.size,
          pathInfo: [],
        },
      });
    if (path.endsWith("/move-resource-to-folder")) {
      moved.add(request.postDataJSON()["@id"]);
      return route.fulfill({ json: {} });
    }
    const id = decodeURIComponent(path.split("/").filter(Boolean).at(-1));
    const r =
      items.find(
        (r) => path.includes("/" + r["@id"] + "/") || id === r["@id"],
      ) || folder;
    return route.fulfill({ json: r, headers: { ETag: '"' + r["@id"] + '"' } });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  return moved;
}
test("grid retains compact sizing, range and list selection, and moves a group with revisions", async ({
  page,
  api,
}) => {
  const moved = await setup(page);
  const rows = page.locator(".explorer-item");
  await expect(rows).toHaveCount(4);
  expect((await rows.nth(1).boundingBox()).height).toBe(106);
  await rows.nth(1).click({ position: { x: 20, y: 90 } });
  await rows.nth(3).click({ position: { x: 20, y: 90 }, modifiers: ["Shift"] });
  await expect(page.locator(".explorer-item.selected")).toHaveCount(3);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".explorer-item.selected")).toHaveCount(3);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator(".table-scroll")).toHaveClass(/explorer-grid/);
  await expect(rows.nth(1)).not.toHaveClass(/cdk-drag-disabled/);
  const source = await rows.nth(1).boundingBox(),
    destination = await rows.first().boundingBox();
  await page.mouse.move(source.x + 20, source.y + 85);
  await page.mouse.down();
  await page.mouse.move(destination.x + 40, destination.y + 80, { steps: 12 });
  await expect(page.locator(".cdk-drag-preview")).toHaveCount(1);
  await expect(rows.first()).toHaveClass(/explorer-drop-target/);
  await page.mouse.up();
  await expect.poll(() => moved.size).toBe(3);
  await expect(rows).toHaveCount(1);
});
test("marquee selects cards and keyboard extends selection without opening a resource", async ({
  page,
  api,
}) => {
  await setup(page);
  const rows = page.locator(".explorer-item");
  await expect(rows).toHaveCount(4);
  const first = await rows.first().boundingBox();
  await page.mouse.move(first.x + 2, first.y - 5);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width - 5, first.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".explorer-item.selected")).toHaveCount(1);
  await rows.nth(1).click({ position: { x: 20, y: 90 } });
  await rows.nth(1).press("Shift+ArrowRight");
  await expect(page.locator(".explorer-item.selected")).toHaveCount(2);
  await expect(page).toHaveURL(/dashboard/);
});

for (const width of [1280, 375]) {
  test(`compact grid is accessible and fits at ${width}`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page);
    await expect(page.locator(".explorer-grid")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".explorer-grid")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (process.env.WORKSPACE_VISUAL)
      await expect(page).toHaveScreenshot(`grid-${width}.png`, {
        fullPage: true,
      });
  });
}
