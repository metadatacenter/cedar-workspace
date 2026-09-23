import { test, expect, dashboard, resource } from "./fixtures.mjs";
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
  await expect(menu.getByRole("menuitemradio", { name: "All", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("menuitemradio", { name: "All", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(menu).toHaveCount(0);
});

for (const width of [1440, 375]) {
  test(`sort options at ${width}`, async ({ page, api, browserName }) => {
    await page.setViewportSize({ width, height: 1000 });
    await dashboard(page);
    const trigger = page.getByRole("button", { name: "Sort options", exact: true });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Sort options" });
    await expect(menu.getByRole("menuitemradio", { name: "Mixed with files" })).toBeInViewport();
    const sort = await trigger.boundingBox();
    const dots = await page.getByRole("button", { name: "Actions for Study metadata" }).boundingBox();
    expect(Math.abs(sort.x + sort.width / 2 - dots.x - dots.width / 2)).toBeLessThan(2);
    if (process.env.WORKSPACE_VISUAL && browserName === "chromium")
      await expect(menu).toHaveScreenshot(`sort-menu-${width}.png`);
  });
}

test("pointer selections update visible order, folder grouping and version results", async ({ page, api }) => {
  const alpha = { ...resource, "@id": "alpha", "schema:name": "Alpha" };
  const historical = { ...resource, "@id": "old", "schema:name": "Alpha historical", "pav:version": "0.9.0" };
  const folder = { ...resource, "@id": "museum", "schema:name": "Museum", resourceType: "folder" };
  const zulu = { ...resource, "@id": "zulu", "schema:name": "Zulu" };
  await page.route("**/api/resource/templates/*/report", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    return route.fulfill({ json: [alpha, historical, zulu].find(item => item["@id"] === id) });
  });
  await page.route("**/api/resource/folders/home/contents?**", route => {
    const params = new URL(route.request().url()).searchParams;
    const orders = {
      name: [alpha, historical, folder, zulu],
      "-name": [zulu, folder, historical, alpha],
      "foldersFirst,-name": [folder, zulu, historical, alpha],
    };
    const resources = orders[params.get("sort")].filter(item => params.get("version") !== "latest" || item !== historical);
    return route.fulfill({ json: { resources, totalCount: resources.length } });
  });
  await page.goto("/dashboard");
  const rows = page.locator("tbody td:first-child");
  await expect(rows).toHaveText(["Alpha", "Alpha historical", "Museum", "Zulu"]);
  const select = async name => {
    await page.getByRole("button", { name: "Sort options", exact: true }).click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
  };
  await select("Z to A");
  await expect(rows).toHaveText(["Zulu", "Museum", "Alpha historical", "Alpha"]);
  await select("On top");
  await expect(rows).toHaveText(["Museum", "Zulu", "Alpha historical", "Alpha"]);
  await select("Latest");
  await expect(rows).toHaveText(["Museum", "Zulu", "Alpha"]);
  await select("All");
  await expect(rows).toHaveText(["Museum", "Zulu", "Alpha historical", "Alpha"]);
  await select("Mixed with files");
  await expect(rows).toHaveText(["Zulu", "Museum", "Alpha historical", "Alpha"]);
});

test('Version selector and menu share persisted server filtering', async ({page, api}) => {
  const requests = [];
  page.on('request', request => { if(request.url().includes('/contents?')) requests.push(new URL(request.url())); });
  await dashboard(page);
  const version = page.getByRole('combobox', {name:'Version', exact:true});
  await expect(version).toHaveValue('all');
  await version.selectOption('latest');
  await expect.poll(() => requests.at(-1)?.searchParams.get('version')).toBe('latest');
  await page.reload();
  await expect(version).toHaveValue('latest');
  await page.getByRole('button', {name:'Sort options', exact:true}).click();
  const group = page.getByRole('menu').getByRole('group', {name:'Version', exact:true});
  await expect(group.getByRole('menuitemradio', {name:'Latest',exact:true})).toHaveAttribute('aria-checked','true');
  await group.getByRole('menuitemradio', {name:'All',exact:true}).click();
  await expect(version).toHaveValue('all');
  await expect.poll(() => requests.at(-1)?.searchParams.has('version')).toBe(false);
  await expect(page).not.toHaveURL(/version=latest/);
});
