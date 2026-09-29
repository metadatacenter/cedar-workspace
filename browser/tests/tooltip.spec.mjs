import { test, expect, dashboard, action } from "./fixtures.mjs";

test("workspace icon tooltip text follows Hungarian localization", async ({page, api}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'languages', {get: () => ['hu-HU']}));
  await page.goto('/dashboard');
  for (const label of ['Listanézet', 'Rácsnézet', 'Munkaterület frissítése']) {
    await page.getByRole('button', {name: label, exact: true}).hover();
    await expect(page.getByRole('tooltip')).toHaveText(label, {timeout: 700});
    await page.keyboard.press('Escape');
  }
});

test("workspace icon controls expose prompt localized help", async ({page, api}) => {
  await dashboard(page);
  for (const label of ["Search", "User menu", "More menu", "Collapse navigation", "Refresh workspace", "List view", "Grid view", "Collapse information"]) {
    const control = page.locator(`[aria-label="${label}"]`).first();
    await control.hover();
    await expect(page.getByRole("tooltip")).toHaveText(label, {timeout: 700});
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await action(page, 'Rename');
  await page.getByRole('button', {name: 'Close dialog', exact: true}).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Close dialog', {timeout: 700});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
});

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
