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

test("nested confirmation and permission toast remain accessible and operable", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Permissions…");
  const owner = page.getByRole("checkbox", {
    name: "Make Sam Curator the owner",
  });
  await owner.click();
  await expect(page.locator(".confirmation-dialog")).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".confirmation-dialog")).toHaveCount(0);
  await expect(owner).toBeFocused();
  await page
    .getByRole("combobox", { name: "Role for Sam Curator" })
    .selectOption("editor");
  await expect(page.locator("dialog[open] .toast")).toContainText(
    "Permissions saved.",
  );
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeEnabled();
});
