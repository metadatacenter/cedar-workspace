import { test, expect, dashboard, resource } from "./fixtures.mjs";

test("tablet defaults leave room for the listing and preserve explicit information-panel choices", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 768, height: 667 });
  await dashboard(page);
  const toggle = page.locator('[aria-controls="workspace-information"]');
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect((await page.locator("main").boundingBox()).width).toBeGreaterThan(500);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#workspace-information")).toBeVisible();
  await page.setViewportSize({ width: 900, height: 667 });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("untouched information panel follows tablet sizing and restores the desktop default", async ({
  page,
  api,
}) => {
  await dashboard(page);
  const toggle = page.locator('[aria-controls="workspace-information"]');
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.setViewportSize({ width: 768, height: 667 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

for (const view of ["list", "grid"])
  test(`wrapped tablet breadcrumbs stay between the header and filters in ${view} view`, async ({ page, api }) => {
    await page.setViewportSize({ width: 768, height: 667 });
    const pathInfo = ["All", "Users", "Alex Researcher", "Research collection for specimen handling and storage"]
      .map((name, i) => ({...resource, "@id": `folder-${i}`, resourceType: "folder", "schema:name": name}));
    const resources = Array.from({length: 12}, (_, i) => ({...resource, "@id": `template-${i}`}));
    await page.route("**/api/resource/**", route => {
      if (new URL(route.request().url()).pathname.endsWith("/contents"))
        return route.fulfill({json: {resources, totalCount: resources.length, pathInfo}});
      return route.fallback();
    });
    await page.goto(`/dashboard?view=${view}`);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await page.locator('[data-resource-id="template-0"] .resource-icon').click();
      await expect(page.locator("#workspace-information")).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const header = document.querySelector(".topbar").getBoundingClientRect();
        const crumb = document.querySelector(".table-toolbar .breadcrumbs").getBoundingClientRect();
        const filter = document.querySelector("cedar-filter-chip button").getBoundingClientRect();
        return Math.min(crumb.top - header.bottom, filter.top - crumb.bottom);
      })).toBeGreaterThanOrEqual(0);
      const paging = await page.locator(".paging").boundingBox();
      expect(paging.y + paging.height).toBeLessThanOrEqual(667);
    }
  });
