import { test, expect, dashboard } from "./fixtures.mjs";

for (const width of [1440, 375]) {
  test(`search focus follows the rounded container at ${width}`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await dashboard(page);
    const search = page.locator("form.search");
    const input = page.getByRole("textbox", {
      name: "Search workspace",
      exact: true,
    });
    await input.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(search).toHaveCSS("outline-style", "solid");
    await expect(search).toHaveCSS("border-radius", "16px");
    await expect(search.locator('input')).toHaveAttribute('autocomplete', 'off');
    await expect(search.locator('input')).toHaveAttribute('autocorrect', 'off');
    await expect(search.locator('input')).toHaveAttribute('spellcheck', 'false');
    if (process.env.WORKSPACE_VISUAL)
      await expect(page.locator(".topbar")).toHaveScreenshot(
        `search-focused-${width}.png`,
      );
    await page.keyboard.press("Tab");
    await expect(
      search.getByRole("button", { name: "Search", exact: true }),
    ).toBeFocused();
    await expect(search).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Tab");
    await expect(search).toHaveCSS("outline-style", "none");
  });
}
