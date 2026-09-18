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
