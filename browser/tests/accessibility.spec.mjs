import AxeBuilder from "@axe-core/playwright";
import { test, expect, dashboard, action } from "./fixtures.mjs";

/**
 * Every rule axe-core tags for WCAG 2.0, 2.1 and 2.2 at levels A and AA, and Label in Name.
 *
 * Label in Name, WCAG 2.1's criterion 2.5.3, needs a control's accessible name to contain the text
 * it shows. axe-core's rule for it is experimental, and a tag selection leaves experimental rules
 * out, so it runs by name, as in the designer's, the term picker's and CEE's gates.
 */
async function violations(page) {
  const tagged = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const named = await new AxeBuilder({ page })
    .withRules(["label-content-name-mismatch"])
    .analyze();
  return [...tagged.violations, ...named.violations];
}
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
    expect(await violations(page)).toEqual([]);
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
  expect(await violations(page)).toEqual([]);
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
