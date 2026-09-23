import { test, expect, dashboard, action } from "./fixtures.mjs";

test("workspace and rename dialog disable browser spellchecking", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Rename");
  const controls = page.locator("input, textarea");
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    await expect(control).toHaveAttribute("spellcheck", "false");
    await expect(control).toHaveJSProperty("spellcheck", false);
  }
});
