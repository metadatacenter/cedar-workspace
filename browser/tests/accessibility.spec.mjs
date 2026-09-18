import AxeBuilder from "@axe-core/playwright";
import { test, expect, dashboard, action } from "./fixtures.mjs";
for (const route of [
  "dashboard",
  "groups",
  "profile",
  "settings",
  "privacy",
  "permissions",
]) {
  test(`accessible ${route}`, async ({ page, api }) => {
    if (route === "permissions") {
      await dashboard(page);
      await action(page, "Permissions…");
    } else {
      await page.goto("/" + route);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  });
}
