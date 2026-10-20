import { test, expect, dashboard, resource } from "./fixtures.mjs";

const records = ["a", "b", "c"].map((id) => ({
  ...resource,
  "@id": id,
  "schema:name": `Template ${id}`,
}));

for (const view of ["list", "grid"])
  test(`a selected ${view} row says it is selected without claiming a selectable table`, async ({
    page,
    api,
  }) => {
    await page.route("**/api/resource/folders/home/contents?**", (route) =>
      route.fulfill({ json: { resources: records, totalCount: 3, pathInfo: [] } }),
    );
    await page.route("**/api/resource/templates/**", (route) => {
      const path = new URL(route.request().url()).pathname.split("/");
      const record = records.find((r) => path[4] === r["@id"]);
      return record ? route.fulfill({ json: record, headers: { ETag: '"r"' } }) : route.fallback();
    });
    await page.goto(`/dashboard?view=${view}`);
    const row = (id) => page.locator(`[data-resource-id="${id}"]`);
    await expect(row("c")).toBeVisible();
    // A plain table has no selectable rows, so no row states aria-selected.
    await expect(page.locator(".explorer-item[aria-selected]")).toHaveCount(0);
    for (const id of ["a", "b", "c"]) await expect(row(id)).toHaveAccessibleDescription("");
    await row("a").locator(".resource-icon").click();
    await row("c").locator(".resource-icon").click({ modifiers: ["ControlOrMeta"] });
    await expect(row("a")).toHaveAccessibleDescription("Selected");
    await expect(row("b")).toHaveAccessibleDescription("");
    await expect(row("c")).toHaveAccessibleDescription("Selected");
    await expect(page.locator(".explorer-item[aria-selected]")).toHaveCount(0);
    // The note is never shown, and reads in the page's language.
    await expect(page.locator("#explorer-row-selected")).toBeHidden();
  });

test("a row's version and status are read as two words in both views", async ({ page, api }) => {
  await dashboard(page);
  const name = /^Template Study metadata 1 day ago 1\.0\.0 Draft /;
  await expect(page.getByRole("row", { name })).toHaveCount(1);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.getByRole("row", { name: /^1\.0\.0 Draft Study metadata / })).toHaveCount(1);
  await page.getByRole("button", { name: "Preview Study metadata", exact: true }).click();
  expect(await page.locator(".preview-facts").ariaSnapshot()).toBe(
    ["- paragraph:", "  - text: Template 1.0.0 Draft", "  - time: 1 day ago"].join("\n"),
  );
});

test("each Information tab controls the panel it labels", async ({ page, api }) => {
  await dashboard(page);
  await page.getByRole("row", { name: /^Template Study metadata/ }).locator("td").nth(1).click();
  const info = page.getByRole("complementary", { name: "Resource information" });
  const details = info.getByRole("tab", { name: "Details", exact: true });
  const version = info.getByRole("tab", { name: "Version", exact: true });
  for (const [tab, other, content] of [
    [details, version, "Location"],
    [version, details, "Status"],
  ]) {
    await tab.click();
    const panel = info.getByRole("tabpanel");
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAccessibleName(await tab.textContent().then((text) => text.trim()));
    await expect(panel).toContainText(content);
    for (const control of [tab, other])
      await expect(control).toHaveAttribute("aria-controls", await panel.getAttribute("id"));
  }
});

test("the resource menu's trigger says whether its group is open and which it is", async ({
  page,
  api,
}) => {
  await dashboard(page);
  const trigger = page.getByRole("button", { name: "Actions for Study metadata", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).not.toHaveAttribute("aria-controls");
  await trigger.click();
  const menu = page.getByRole("group", { name: "Artifact actions", exact: true });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("aria-controls", await menu.getAttribute("id"));
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).not.toHaveAttribute("aria-controls");
});
