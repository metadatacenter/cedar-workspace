import { test, expect, dashboard } from "./fixtures.mjs";
import AxeBuilder from "@axe-core/playwright";

test("Type applies multiple selections, cancels drafts, clears independently and restores from URL", async ({
  page,
  api,
}) => {
  await dashboard(page);
  const type = page.getByRole("button", { name: "Type", exact: true });
  await type.click();
  const popup = page.getByRole("dialog", { name: "Filter by type" });
  await popup.getByLabel("Folder", { exact: true }).check();
  await popup.getByLabel("Template", { exact: true }).check();
  await popup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/resource_types=folder(?:%2C|,)template/);
  await expect(type).toHaveText("Folder, Template");
  await type.click();
  await popup.getByLabel("Field", { exact: true }).check();
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(type).toBeFocused();
  await expect(type).toHaveText("Folder, Template");
  await page.reload();
  await expect(type).toHaveText("Folder, Template");
  await type.click();
  await expect(popup.getByLabel("Field", { exact: true })).not.toBeChecked();
  expect(
    (await new AxeBuilder({ page }).include("cedar-resource-filters").analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(type).toBeFocused();
  await page.getByRole("button", { name: "Clear type filter" }).click();
  await expect(page).not.toHaveURL(/resource_types/);
  await expect(type).toHaveText("Type");
});

test("date presets and inclusive custom ranges are sent to the listing API, including after reload", async ({
  page,
  api,
}) => {
  await dashboard(page);
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("/contents?")) requests.push(new URL(r.url()));
  });
  const date = page
    .locator("cedar-resource-filters")
    .getByRole("button", { name: "Last modified", exact: true });
  await date.click();
  const popup = page.getByRole("dialog", { name: "Filter by last modified" });
  await popup.getByRole("button", { name: "Last 7 days", exact: true }).click();
  await expect(popup.getByLabel("After", { exact: true })).toHaveValue(
    "2025-12-28",
  );
  await expect(popup.getByLabel("Before", { exact: true })).toHaveValue(
    "2026-01-03",
  );
  await popup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(date).toHaveText(/Last 7 days/);
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("modified_before"))
    .toBe(String(Date.parse("2026-01-04T00:00:00Z")));
  await date.click();
  await popup.getByLabel("After", { exact: true }).fill("2026-01-10");
  await expect(popup.getByRole("alert")).toHaveText(
    "Before must be on or after After.",
  );
  await expect(
    popup.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await popup.getByLabel("Before", { exact: true }).fill("2026-01-10");
  expect(
    (await new AxeBuilder({ page }).include("cedar-resource-filters").analyze())
      .violations,
  ).toEqual([]);
  await popup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("modified_after"))
    .toBe(String(Date.parse("2026-01-10T00:00:00Z")));
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("modified_before"))
    .toBe(String(Date.parse("2026-01-11T00:00:00Z")));
  await page.reload();
  await expect(date).toHaveText(/10 Jan 2026/);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.has("modified_after"))
    .toBe(false);
});

for (const width of [1440, 375]) {
  test(`filter popovers at ${width}`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 1000 });
    await dashboard(page);
    await page
      .locator("cedar-resource-filters")
      .getByRole("button", { name: "Last modified", exact: true })
      .click();
    const popup = page.getByRole("dialog", { name: "Filter by last modified" });
    await popup
      .getByRole("button", { name: "Last 30 days", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      popup.getByRole("button", { name: "Apply", exact: true }),
    ).toBeInViewport();
    if (process.env.WORKSPACE_VISUAL)
      await expect(page).toHaveScreenshot(`date-filter-${width}.png`, {
        fullPage: true,
      });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await page.getByRole("checkbox", { name: "Folder", exact: true }).check();
    await page.getByRole("checkbox", { name: "Instance", exact: true }).check();
    if (process.env.WORKSPACE_VISUAL)
      await expect(page).toHaveScreenshot(`type-filter-${width}.png`, {
        fullPage: true,
      });
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Type", exact: true }))
      .toHaveText("Folder, Instance");
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    )).toBe(true);
  });
}
