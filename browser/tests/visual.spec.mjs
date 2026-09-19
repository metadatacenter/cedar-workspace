import { test, expect, dashboard, action } from "./fixtures.mjs";
for (const width of [1440, 375]) {
  for (const route of [
    "dashboard",
    "groups",
    "profile",
    "settings",
    "privacy",
  ]) {
    test(`${route} at ${width}`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 1000 });
      if (route === "dashboard") await dashboard(page);
      else {
        await page.goto("/" + route);
        await expect(
          page.getByRole("heading", {
            name: route[0].toUpperCase() + route.slice(1),
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByText("Loading…", { exact: true })).toHaveCount(
          0,
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (process.env.WORKSPACE_VISUAL)
        await expect(page).toHaveScreenshot(`${route}-${width}.png`, {
          fullPage: true,
        });
    });
  }
  for (const readonly of [false, true]) {
    test(`permissions ${readonly ? "readonly" : "editable"} at ${width}`, async ({
      page,
      api,
    }) => {
      api.readonly = readonly;
      await page.setViewportSize({ width, height: 1000 });
      await dashboard(page);
      await action(page, "Permissions…");
      const dialog = page.locator("dialog[open]");
      const role = dialog.getByRole("combobox", {
        name: "Role for Sam Curator",
      });
      if (readonly) await expect(role).toBeDisabled();
      else await expect(role).toBeEnabled();
      expect(
        await dialog
          .locator(".access-list")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
      if (process.env.WORKSPACE_VISUAL)
        await expect(dialog).toHaveScreenshot(
          `permissions-${readonly}-${width}.png`,
        );
    });
  }
}
test("artifact menu and resource dialog", async ({ page, api }) => {
  await dashboard(page);
  await page
    .getByRole("button", { name: "Actions for Study metadata" })
    .click();
  if (process.env.WORKSPACE_VISUAL)
    await expect(page.locator(".resource-menu")).toHaveScreenshot(
      "artifact-menu.png",
    );
  await page
    .locator(".resource-menu")
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Study metadata",
  );
  if (process.env.WORKSPACE_VISUAL)
    await expect(page.locator("dialog[open]")).toHaveScreenshot(
      "rename-dialog.png",
    );
});

for (const readonly of [false, true]) {
  test(`metadata host ${readonly ? "readonly" : "editable"}`, async ({
    page,
    api,
  }) => {
    api.readonly = readonly;
    await page.goto("/instances/edit/instance");
    await expect(page.getByLabel("Metadata name")).toHaveValue("Study record");
    await expect(page.locator(".metadata-toolbar")).toContainText(
      readonly ? "Read only" : "Saved",
    );
    if (process.env.WORKSPACE_VISUAL)
      await expect(page.locator(".metadata-toolbar")).toHaveScreenshot(
        `metadata-toolbar-${readonly}.png`,
      );
  });
}

// Geometry assertions prevent a baseline refresh from silently approving looser density.
test("workspace follows CEE compact density", async ({ page, api }) => {
  await dashboard(page);
  const sizes = await page.evaluate(() => {
    const height = (selector) =>
      document.querySelector(selector).getBoundingClientRect().height;
    const style = (selector) =>
      getComputedStyle(document.querySelector(selector));
    return {
      rows: [...document.querySelectorAll("tbody tr")].map(
        (row) => row.getBoundingClientRect().height,
      ),
      toolbar: height(".table-toolbar"),
      paginationGap:
        document.querySelector(".paging").getBoundingClientRect().top -
        document.querySelector("table").getBoundingClientRect().bottom,
      navigation: height(".destinations a"),
      navigationGap: style(".destinations").rowGap,
      detailsPadding: style(".information dd").paddingBlockStart,
      tabsGap: style(".information .tabs").marginTop,
      action: height(".row-actions button"),
    };
  });
  expect(sizes.rows.length).toBeGreaterThan(0);
  for (const height of sizes.rows) expect(height).toBeLessThanOrEqual(45);
  expect(sizes.toolbar).toBeLessThanOrEqual(36);
  expect(sizes.paginationGap).toBeLessThanOrEqual(8);
  expect(sizes.navigation).toBeLessThanOrEqual(36);
  expect(sizes.navigationGap).toBe("0px");
  expect(sizes.detailsPadding).toBe("8px");
  expect(sizes.tabsGap).toBe("8px");
  expect(sizes.action).toBeGreaterThanOrEqual(36);
});

for (const width of [1440, 375]) {
  test(`group creation and populated members stay compact at ${width}`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/groups");
    await page.getByRole("tab", { name: "Create group", exact: true }).click();
    await page.getByLabel("Group name", { exact: true }).fill("Research team");
    await page
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    await expect(page.locator(".groups-member-row")).toHaveCount(2);
    await expect(page.getByRole("status")).toHaveText("Group created.");
    await expect(page.locator(".groups-create-card")).toHaveCSS(
      "padding-top",
      "8px",
    );
    await expect(page.locator(".groups-created-group")).toHaveCSS(
      "padding-bottom",
      "8px",
    );
    await expect(page.locator(".groups-details-form")).toHaveCSS(
      "margin-bottom",
      "8px",
    );
    await expect(page.locator(".groups-tabs")).toHaveCSS(
      "margin-bottom",
      "8px",
    );
    await expect(page.locator(".notice")).toHaveCSS("padding-top", "8px");
    await expect(page.locator("#group-name")).toHaveCSS("height", "36px");
    if (width === 1440) {
      for (const row of await page.locator(".groups-member-row").all())
        expect((await row.boundingBox()).height).toBeLessThanOrEqual(45);
    }
    if (process.env.WORKSPACE_VISUAL)
      await expect(page).toHaveScreenshot(`groups-created-${width}.png`, {
        fullPage: true,
      });
  });
}

test("permissions uses compact section gaps and rows", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Permissions…");
  const dialog = page.locator("dialog[open]");
  for (const panel of await dialog.locator(".access-panel").all()) {
    await expect(panel).toHaveCSS("padding-top", "8px");
    await expect(panel).toHaveCSS("padding-bottom", "8px");
  }
  for (const row of await dialog.locator(".access-row").all())
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(45);
  await expect(dialog.locator("footer")).toHaveCSS("padding-top", "8px");
});
