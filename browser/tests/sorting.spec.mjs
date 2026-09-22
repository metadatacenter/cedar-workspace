import { test, expect, dashboard } from "./fixtures.mjs";
import AxeBuilder from "@axe-core/playwright";

test("sort menu, column arrows, folder grouping and URL stay synchronized", async ({ page, api }) => {
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/contents?")) requests.push(new URL(request.url()));
  });
  await dashboard(page);
  const trigger = page.getByRole("button", { name: "Sort options", exact: true });
  const menu = page.getByRole("menu", { name: "Sort options" });
  const choice = (name) => menu.getByRole("menuitemradio", { name, exact: true });
  const nameHeader = page.getByRole("columnheader", { name: "Name" });
  const modifiedHeader = page.getByRole("columnheader", { name: "Last modified" });
  await trigger.click();
  await expect(choice("Name")).toHaveAttribute("aria-checked", "true");
  await expect(choice("Mixed with files")).toHaveAttribute("aria-checked", "true");
  await choice("Z to A").click();
  await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("-name");

  await trigger.click();
  await choice("On top").click();
  await expect(page).toHaveURL(/folders=first/);
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("foldersFirst,-name");
  await nameHeader.getByRole("button").click();
  await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("foldersFirst,name");

  await modifiedHeader.getByRole("button").click();
  await trigger.click();
  await expect(choice("Last modified")).toHaveAttribute("aria-checked", "true");
  await expect(choice("Oldest first")).toHaveAttribute("aria-checked", "true");
  await choice("Newest first").click();
  await expect(modifiedHeader).toHaveAttribute("aria-sort", "descending");
  await trigger.click();
  await choice("Date created").click();
  await expect(nameHeader).toHaveAttribute("aria-sort", "none");
  await expect(modifiedHeader).toHaveAttribute("aria-sort", "none");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("foldersFirst,-createdOnTS");

  await page.reload();
  await trigger.click();
  await expect(choice("Date created")).toHaveAttribute("aria-checked", "true");
  await expect(choice("Newest first")).toHaveAttribute("aria-checked", "true");
  await expect(choice("On top")).toHaveAttribute("aria-checked", "true");
  await choice("Mixed with files").click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("sort")).toBe("-createdOnTS");
  await expect(page).not.toHaveURL(/folders=first/);
});

test("sort menu supports keyboard selection, dismissal and accessible groups", async ({ page, api }) => {
  await dashboard(page);
  const trigger = page.getByRole("button", { name: "Sort options", exact: true });
  const menu = page.getByRole("menu", { name: "Sort options" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "Name", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/sort=lastUpdatedOnTS/);
  await expect(trigger).toBeFocused();
  await trigger.click();
  expect((await new AxeBuilder({ page }).include("cedar-sort-menu").analyze()).violations).toEqual([]);
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitemradio", { name: "Mixed with files" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(menu).toHaveCount(0);
});

for (const width of [1440, 375]) {
  test(`sort options at ${width}`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 1000 });
    await dashboard(page);
    const trigger = page.getByRole("button", { name: "Sort options", exact: true });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Sort options" });
    await expect(menu.getByRole("menuitemradio", { name: "Mixed with files" })).toBeInViewport();
    const sort = await trigger.boundingBox();
    const dots = await page.getByRole("button", { name: "Actions for Study metadata" }).boundingBox();
    expect(Math.abs(sort.x + sort.width / 2 - dots.x - dots.width / 2)).toBeLessThan(2);
    if (process.env.WORKSPACE_VISUAL)
      await expect(menu).toHaveScreenshot(`sort-menu-${width}.png`);
  });
}
