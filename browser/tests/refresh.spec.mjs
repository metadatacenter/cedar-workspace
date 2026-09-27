import { test, expect, resource } from "./fixtures.mjs";

const folder = { "@id": "home", resourceType: "folder", "schema:name": "My workspace" };
const items = Array.from({ length: 9 }, (_, i) => ({
  ...resource, "@id": `instance-${i}`, resourceType: "instance",
  "schema:name": `Instance ${i + 1}`,
}));

for (const empty of [false, true]) {
  test(`refresh preserves breadcrumb and pagination geometry for ${empty ? "empty" : "populated"} folders`, async ({ page, api }) => {
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = new Promise(resolve => { started = resolve; });
    let refreshing = false;
    await page.route("**/api/resource/folders/home/contents?**", async route => {
      if (refreshing) {
        started();
        await gate;
      }
      await route.fulfill({ json: {
        resources: empty ? [] : items.map(item => ({
          ...item, "schema:name": item["schema:name"] + (refreshing ? " refreshed" : ""),
        })),
        totalCount: empty ? 0 : items.length,
        pathInfo: [folder],
      } });
    });
    await page.goto("/dashboard?folders=first");
    const refresh = page.getByRole("button", { name: "Refresh workspace" });
    const breadcrumb = page.getByRole("navigation", { name: "Folder breadcrumb" });
    const paging = page.locator(".paging");
    await expect(refresh).toBeEnabled();
    await expect(breadcrumb).toHaveText("My workspace");
    await expect(page.locator("tbody tr")).toHaveCount(empty ? 0 : 9);
    const link = await breadcrumb.getByRole("link").elementHandle();
    const before = await paging.boundingBox();
    const pathBefore = await breadcrumb.boundingBox();
    refreshing = true;
    await refresh.click();
    await pending;
    await expect(refresh).toBeDisabled();
    await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status")).toHaveText("Refreshing…");
    await expect(breadcrumb).toHaveText("My workspace");
    expect(await link.evaluate(el => el.isConnected)).toBe(true);
    expect(await breadcrumb.boundingBox()).toEqual(pathBefore);
    expect(await paging.boundingBox()).toEqual(before);
    if (empty) await expect(page.getByText("No items found.", { exact: true })).toBeVisible();
    release();
    await expect(refresh).toBeEnabled();
    await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
    if (!empty) await expect(page.locator("tbody tr").first()).toContainText("Instance 1 refreshed");
    expect(await paging.boundingBox()).toEqual(before);
    expect(await link.evaluate(el => el.isConnected)).toBe(true);
    await expect(page).toHaveURL(/folders=first/);
    expect(api.requests.filter(request => request.method !== "GET")).toEqual([]);
  });
}

test("failed refresh keeps the last listing and breadcrumb and allows retry", async ({ page, api }) => {
  await page.goto("/dashboard?folders=first");
  const refresh = page.getByRole("button", { name: "Refresh workspace" });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(refresh).toBeEnabled();
  await page.route("**/api/resource/folders/home/contents?**", route => route.fulfill({
    status: 503, json: { message: "Refresh unavailable" },
  }));
  await refresh.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(refresh).toBeEnabled();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Folder breadcrumb" })).toHaveText("My workspace");
  await page.unroute("**/api/resource/folders/home/contents?**");
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
