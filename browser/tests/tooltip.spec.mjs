import { test, expect, dashboard, action } from "./fixtures.mjs";

test("help appears promptly, stays hoverable, and Escape preserves selection", async ({ page, api }) => {
  await dashboard(page);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  const card = page.locator(".explorer-item").first();
  await card.click({ position: { x: 20, y: 90 } });
  const trigger = card.locator(".row-actions > button");
  await trigger.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveText("Actions", { timeout: 700 });
  await expect(trigger).not.toHaveAttribute("title");
  await expect(trigger).toHaveAttribute("aria-describedby", await tip.getAttribute("id"));
  await tip.hover();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await expect(card).toHaveClass(/selected/);
  await expect(trigger).not.toHaveAttribute("aria-describedby");
  await page.mouse.move(0, 0);
  await trigger.focus();
  await expect(tip).toBeVisible({ timeout: 300 });
  await trigger.click();
  await expect(tip).toHaveCount(0);
  await expect(page.locator(".resource-menu")).toBeVisible();
});

test("short hovers cancel and help also works outside the grid", async ({ page, api }) => {
  await dashboard(page);
  const sort = page.locator("cedar-sort-menu > button");
  await sort.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await sort.hover();
  await expect(page.getByRole("tooltip")).toBeVisible({ timeout: 700 });
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.goto("/profile");
  const copy = page.locator(".profile-copy").first();
  await copy.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible({ timeout: 700 });
  const box = await tip.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await page.goto("/dashboard");
  await expect(tip).toHaveCount(0);
});

test("permission help is visible above the modal and Escape only dismisses help", async ({ page, api }) => {
  await dashboard(page);
  await action(page, "Permissions…");
  const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
  const trigger = dialog.locator("[data-cedar-help]").first();
  await trigger.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible({ timeout: 700 });
  expect(await tip.evaluate(el => {
    const box = el.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await expect(dialog).toBeVisible();
});
