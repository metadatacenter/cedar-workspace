import AxeBuilder from "@axe-core/playwright";
import { test, expect, resource } from "./fixtures.mjs";
const folder = {
  ...resource,
  "@id": "destination",
  resourceType: "folder",
  "schema:name": "Archive",
  currentUserPermissions: { capabilities: ["readResource", "moveIntoFolder"] },
};
const items = ["a", "b", "c"].map((id) => ({
  ...resource,
  "@id": id,
  resourceType: "instance",
  "schema:name": `Sample ${id}`,
}));
async function setup(page, extra = []) {
  const moved = new Set();
  await page.route("**/api/resource/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.includes("/contents"))
      return route.fulfill({
        json: {
          resources: [folder, ...items.filter((r) => !moved.has(r["@id"])), ...extra],
          totalCount: 4 - moved.size,
          pathInfo: [],
        },
      });
    if (path.endsWith("/move-resource-to-folder")) {
      moved.add(request.postDataJSON()["@id"]);
      return route.fulfill({ json: {} });
    }
    const id = decodeURIComponent(path.split("/").filter(Boolean).at(-1));
    const r =
      [...items, ...extra].find(
        (r) => path.includes("/" + r["@id"] + "/") || id === r["@id"],
      ) || folder;
    return route.fulfill({ json: r, headers: { ETag: '"' + r["@id"] + '"' } });
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
  return moved;
}
for (const grid of [true, false]) {
  for (const target of [".resource-icon", ".explorer-modified", "td:first-child"]) {
    test(`double-clicking folder ${target} opens it in ${grid ? "grid" : "list"} view`, async ({page, api}) => {
      await setup(page);
      if (!grid) await page.getByRole("button", {name: "List view", exact: true}).click();
      const folderRow = page.locator('[data-resource-id="destination"]');
      await folderRow.locator(target).click();
      await expect(folderRow).toHaveAttribute("aria-selected", "true");
      await expect(page).not.toHaveURL(/folderId=destination/);
      await folderRow.locator(target).dblclick();
      await expect(page).toHaveURL(/folderId=destination/);
    });
  }
}
test("double-clicking folder actions does not open the folder", async ({page, api}) => {
  await setup(page);
  await page.getByRole("button", {name: "Actions for Archive", exact: true}).dblclick();
  await expect(page).not.toHaveURL(/folderId=destination/);
});

test("grid retains compact sizing, range and list selection, and moves a group with revisions", async ({
  page,
  api,
}) => {
  const moved = await setup(page);
  const rows = page.locator(".explorer-item");
  await expect(rows).toHaveCount(4);
  expect((await rows.nth(1).boundingBox()).height).toBe(106);
  await rows.nth(1).click({ position: { x: 20, y: 90 } });
  await rows.nth(3).click({ position: { x: 20, y: 90 }, modifiers: ["Shift"] });
  await expect(page.locator(".explorer-item.selected")).toHaveCount(3);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".explorer-item.selected")).toHaveCount(3);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator(".table-scroll")).toHaveClass(/explorer-grid/);
  await expect(rows.nth(1)).not.toHaveClass(/cdk-drag-disabled/);
  const source = await rows.nth(1).boundingBox(),
    destination = await rows.first().boundingBox();
  await page.mouse.move(source.x + 20, source.y + 85);
  await page.mouse.down();
  await page.mouse.move(source.x + 25, source.y + 80, { steps: 3 });
  await expect(page.locator("body")).toHaveClass(/explorer-dragging/);
  await expect(page.locator("body")).not.toHaveClass(/explorer-can-drop/);
  await expect(rows.first()).toHaveClass(/explorer-drop-eligible/);
  await page.mouse.move(destination.x + 40, destination.y + 80, { steps: 12 });
  await expect(page.locator(".cdk-drag-preview")).toHaveCount(1);
  const preview = page.locator('cedar-drag-preview');
  await expect(preview).toContainText('3 selected');
  await expect(preview.locator('.item')).toHaveCount(3);
  await expect(preview).toContainText('Move here: Archive');
  await expect(page.locator('body')).toHaveClass(/explorer-can-drop/);
  await expect(rows.first()).toHaveClass(/explorer-drop-target/);
  await expect(rows.first()).toContainText('Move here');
  if (process.env.WORKSPACE_VISUAL)
    await expect(page).toHaveScreenshot('drag-selection.png');
  await page.mouse.up();
  await expect.poll(() => moved.size).toBe(3);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveClass(/explorer-move-complete/);
  await expect(page.locator('.cdk-drag-preview')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/explorer-dragging/);
  await expect(rows.first()).not.toHaveClass(/explorer-move-complete/, {timeout: 3000});
});
for (const grid of [true, false]) {
  test(`dropping outside a folder cancels a single-item drag in ${grid ? 'grid' : 'list'}`, async ({page, api}) => {
    const moved = await setup(page);
    if (!grid) await page.getByRole('button', {name: 'List view', exact: true}).click();
    const source = page.locator('[data-resource-id="a"]');
    const box = await source.boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height - 10);
    await page.mouse.down();
    const target = await page.locator('[data-resource-id="b"]').boundingBox();
    await page.mouse.move(target.x + 20, target.y + target.height - 10, {steps: 12});
    await expect(page.locator('cedar-drag-preview')).toContainText('Sample a');
    await expect(page.locator('cedar-drag-preview')).toContainText('Drag onto a folder');
    await expect(page.locator('cedar-drag-preview .count')).toHaveCount(0);
    await expect(page.locator('body')).toHaveCSS('cursor', 'not-allowed');
    await page.mouse.up();
    await expect(page.locator('cedar-drag-preview')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/explorer-dragging/);
    expect(moved.size).toBe(0);
    await expect(source).toHaveClass(/selected/);
  });
}
test("dragging suppresses existing, underlying and copy-control tooltips until release", async ({page, api}) => {
  const moved = await setup(page);
  const source = page.locator('[data-resource-id="a"]');
  await source.click({position: {x: 20, y: 90}});
  const copy = page.getByRole('button', {name: 'Copy identifier', exact: true});
  await expect(copy).toBeVisible();
  await source.locator('.resource-icon').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Instance');
  const start = await source.locator('.resource-icon').boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  for (const control of [
    page.locator('[data-resource-id="destination"] .resource-icon'),
    page.getByRole('button', {name: 'Actions for Archive', exact: true}),
    page.getByRole('button', {name: 'Refresh workspace', exact: true}),
    copy,
  ]) {
    const box = await control.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 8});
    await expect(page.locator('body')).toHaveClass(/explorer-dragging/);
    // Wait beyond the normal tooltip delay while the pointer stays over the control.
    await page.waitForTimeout(400);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await page.mouse.up();
  await expect(page.locator('body')).not.toHaveClass(/explorer-dragging/);
  await page.waitForTimeout(400);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(moved.size).toBe(0);
  await page.mouse.move(0, 0);
  await copy.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Copy identifier');
  await page.getByRole('button', {name: 'Refresh workspace', exact: true}).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Refresh workspace');
});

test("marquee selects cards and keyboard extends selection without opening a resource", async ({
  page,
  api,
}) => {
  await setup(page);
  const rows = page.locator(".explorer-item");
  await expect(rows).toHaveCount(4);
  const first = await rows.first().boundingBox();
  await page.mouse.move(first.x + 2, first.y - 5);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width - 5, first.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".explorer-item.selected")).toHaveCount(1);
  await rows.nth(1).click({ position: { x: 20, y: 90 } });
  await rows.nth(1).press("Shift+ArrowRight");
  await expect(page.locator(".explorer-item.selected")).toHaveCount(2);
  await expect(page).toHaveURL(/dashboard/);
});

for (const width of [1280, 375]) {
  test(`compact grid is accessible and fits at ${width}`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page);
    await page.mouse.move(0, 0);
    await expect(page.locator(".explorer-grid")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".explorer-grid")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (process.env.WORKSPACE_VISUAL)
      await expect(page).toHaveScreenshot(`grid-${width}.png`, {
        fullPage: true,
      });
  });
}

test("schema cards show version and release status without expanding the cards", async ({
  page,
  api,
}) => {
  await page.route("**/api/resource/folders/home/contents?**", (route) =>
    route.fulfill({
      json: {
        resources: ["template", "element", "field", "instance", "folder"].map(
          (resourceType, index) => ({
            ...resource,
            resourceType,
            isOpen: true,
            "@id": `schema-${index}`,
            "schema:name":
              "A long schema artifact name that occupies two lines",
            "pav:version": "2.1.0",
            "bibo:status": index === 0 ? "bibo:published" : "bibo:draft",
          }),
        ),
        totalCount: 5,
        pathInfo: [],
      },
    }),
  );
  await page.route("**/templates/schema-0/report", (route) =>
    route.fulfill({
      json: {
        ...resource,
        "@id": "schema-0",
        "pav:version": "2.1.0",
        "bibo:status": "bibo:published",
      },
    }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  const cards = page.locator(".explorer-item");
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0).locator(".explorer-release")).toHaveText(
    "2.1.0 · Published",
  );
  await expect(cards.nth(1).locator(".explorer-release")).toHaveText(
    "2.1.0 · Draft",
  );
  await expect(cards.nth(2).locator(".explorer-release")).toHaveText(
    "2.1.0 · Draft",
  );
  await expect(cards.nth(3).locator(".explorer-release")).toHaveCount(0);
  await expect(cards.nth(4).locator(".explorer-release")).toHaveCount(0);
  await expect(cards.nth(4).getByRole('button', {name: /^Preview /})).toHaveCount(0);
  for (const card of (await cards.all()).slice(0, 4)) {
    const eye = card.getByRole('button', {name: /^Preview /});
    await expect(eye).toBeVisible();
    const cardBox = await card.boundingBox(), eyeBox = await eye.boundingBox();
    expect(eyeBox.x).toBeGreaterThan(cardBox.x + cardBox.width / 2);
    expect(eyeBox.y).toBeGreaterThan(cardBox.y + cardBox.height / 2);
  }
  for (const card of await cards.all()) {
    await expect(card.locator('.explorer-kind')).toHaveCSS('font-style', 'normal');
    if (await card.locator('.explorer-release').count()) {
      await expect(card.locator('.explorer-status')).toHaveCSS('font-style', 'normal');
      const release = await card.locator('.explorer-release').boundingBox();
      const icon = await card.locator('.resource-icon').boundingBox();
      const actions = await card.locator('.row-actions').boundingBox();
      expect(release.x).toBeGreaterThanOrEqual(icon.x + icon.width);
      expect(release.x + release.width).toBeLessThanOrEqual(actions.x);
      expect(Math.abs(release.y - icon.y)).toBeLessThanOrEqual(8);
      expect(await card.locator('.explorer-release').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect((await card.boundingBox()).height).toBe(106);
    await expect(card.locator("time")).toBeVisible();
    const center = box => box.y + box.height / 2;
    const icon = await card.locator(".resource-icon svg").boundingBox();
    for (const action of await card.locator(".row-actions > a svg, .row-actions > button svg").all()) {
      expect(Math.abs(center(await action.boundingBox()) - center(icon))).toBeLessThanOrEqual(1);
    }
  }
});


test("card icons share colour, spacing and the right-hand column", async ({page, api}) => {
  await setup(page, [{...resource, isOpen: true}]);
  await expect(page.locator('.brand')).toContainText('CEDAR Workspace');
  const cards = page.locator('.explorer-item');
  await expect(cards).toHaveCount(5);
  await expect(cards.first().locator('.resource-icon')).toHaveCSS('color', await cards.nth(1).locator('.resource-icon').evaluate(el => getComputedStyle(el).color));
  const card = cards.nth(1);
  const eye = await card.locator('.explorer-preview').boundingBox();
  const menu = await card.getByRole('button', {name: 'Actions for Sample a'}).boundingBox();
  const bounds = await card.boundingBox();
  expect(eye.x + eye.width / 2).toBeCloseTo(menu.x + menu.width / 2, 1);
  expect(bounds.y + bounds.height - eye.y - eye.height).toBeLessThanOrEqual(6);
  const actions = cards.last().locator('.row-actions > a, .row-actions > button');
  await expect(actions).toHaveCount(3);
  const boxes = await actions.evaluateAll(nodes => nodes.map(node => {
    const {x, y, width, height} = node.getBoundingClientRect();
    return {x, y, width, height};
  }));
  expect(boxes.map(box => box.width)).toEqual([24, 24, 24]);
  expect(boxes.map(box => box.y)).toEqual([boxes[0].y, boxes[0].y, boxes[0].y]);
  expect(boxes[1].x - boxes[0].x).toBe(boxes[2].x - boxes[1].x);
  if (process.env.WORKSPACE_VISUAL) await expect(cards.last()).toHaveScreenshot('template-card-actions.png');
  await cards.first().getByRole('button', {name: 'Actions for Archive'}).click();
  const entries = page.locator('.resource-menu button');
  await expect(entries).toHaveText(['Open', 'Permissions…', 'Move', 'Rename', 'Delete', 'Enable Openview', 'Disable Openview', 'Open in OpenView']);
});
