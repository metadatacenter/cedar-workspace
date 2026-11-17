import { test, expect, resource } from './fixtures.mjs';

const names = ['All', 'Users', 'Test User', 'Independent review',
  'Research programme with a very long descriptive folder name for multi-site longitudinal sample collection',
  'Participant specimens and associated environmental metadata wave 2026 international collaboration'];
const pathInfo = names.map((name, i) => ({ ...resource, '@id': `folder-${i}`, resourceType: 'folder', 'schema:name': name }));
const resources = Array.from({ length: 54 }, (_, i) => ({ ...resource, '@id': `record-${i + 1}`, 'schema:name': `Record ${i + 1}` }));

async function listing(page, view) {
  await page.route(/\/api\/resource\/templates\/record-\d+(\/report)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.match(/record-\d+/)[0];
    await route.fulfill({ json: resources.find((item) => item['@id'] === id) });
  });
  await page.route('**/api/resource/folders/home/contents?**', async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
    await route.fulfill({ json: { resources: resources.slice(offset, offset + 50), totalCount: 54, pathInfo } });
  });
  await page.goto(`/dashboard?view=${view}`);
  await expect(page.locator('[data-resource-id="record-1"]')).toBeVisible();
  await expect(page.locator('.table-scroll')).toHaveAttribute('aria-busy', 'false');
}

for (const view of ['list', 'grid']) test(`tablet long path retains a usable ${view} with both panels open`, async ({ page, api }, info) => {
  await page.setViewportSize({ width: 768, height: 667 });
  await listing(page, view);
  await page.locator('[aria-controls="workspace-information"]').click();
  await expect(page.locator('.workspace')).not.toHaveClass(/right-collapsed|left-collapsed/);
  const region = page.locator('.table-scroll');
  expect((await region.boundingBox()).height).toBeGreaterThanOrEqual(240);
  if (view === 'list') {
    // Inspect the overlap while the outer pane scrolls: a visible, in-viewport
    // footer can still be painted over by the table's sticky heading.
    await page.locator('.workspace > main').evaluate((main) => {
      const heading = main.querySelector('thead').getBoundingClientRect();
      const paging = main.querySelector('.paging').getBoundingClientRect();
      main.scrollTop += heading.top - paging.top;
    });
    for (const name of ['Previous', 'Next']) {
      const action = page.getByRole('button', { name, exact: true });
      expect(await action.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top === button || button.contains(top);
      })).toBe(true);
    }
    await page.screenshot({ path: info.outputPath('tablet-paging-over-heading.png') });
  }
  await region.scrollIntoViewIfNeeded();
  await expect(page.locator('[data-resource-id="record-1"]')).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`tablet-long-path-${view}.png`) });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(region).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('[data-resource-id="record-51"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
});

for (const width of [1440, 768, 375]) for (const view of ['list', 'grid']) {
  test(`settled ${view} pagination and row actions remain reachable at ${width}`, async ({ page, api }, info) => {
    await page.setViewportSize({ width, height: 667 });
    await listing(page, view);
    const region = page.locator('.table-scroll');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    const previous = page.getByRole('button', { name: 'Previous', exact: true });
    await next.click();
    await expect(page.locator('[data-resource-id="record-51"]')).toBeVisible();
    await expect(page.locator('[data-resource-id="record-1"]')).toHaveCount(0);
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.paging')).toContainText('51–54 of 54');
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(page.locator('[data-resource-id="record-1"]')).toBeVisible();
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.paging')).toContainText('1–50 of 54');
    await expect(previous).toBeDisabled();
    const action = page.getByRole('button', { name: 'Actions for Record 1', exact: true });
    if (view === 'list') {
      await region.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      if (width <= 768) expect(await region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport();
    await action.click();
    await expect(page.locator('#resource-menu')).toBeVisible();
    await expect(page.locator('#resource-menu button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#resource-menu')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`settled-actions-${view}-${width}.png`) });
  });
}

test('phone explicitly opened information receives focus and closing returns to the selected row', async ({ page, api }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await listing(page, 'list');
  const toggle = page.locator('[aria-controls="workspace-information"]');
  await toggle.click();
  const row = page.locator('[data-resource-id="record-1"]');
  await row.locator('.resource-icon').click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('#workspace-information')).toBeFocused();
  await expect(page.locator('#information-name')).toBeInViewport();
  await toggle.click();
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport();
});

test('breadcrumb separators share the first line of their full folder name', async ({ page, api }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await listing(page, 'list');
  await expect(page.locator('.table-toolbar .breadcrumbs a')).toHaveText(names);
  const gaps = await page.locator('.breadcrumb-segment').evaluateAll((segments) => segments.flatMap((segment) => {
    const separator = segment.querySelector('.breadcrumb-separator');
    if (!separator) return [];
    const range = document.createRange();
    range.selectNodeContents(segment.querySelector('a'));
    const firstLine = range.getClientRects()[0];
    return [Math.abs(firstLine.top - separator.getBoundingClientRect().top)];
  }));
  expect(Math.max(...gaps)).toBeLessThanOrEqual(1);
});

test('tablet central scrolling keeps filter actions reachable with both panels open', async ({ page, api }) => {
  await page.setViewportSize({ width: 768, height: 667 });
  await listing(page, 'list');
  await page.locator('[aria-controls="workspace-information"]').click();
  await page.locator('cedar-resource-filters').getByRole('button', { name: 'Last modified', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Filter by last modified' });
  await popup.getByRole('button', { name: 'Last 30 days', exact: true }).click();
  const apply = popup.getByRole('button', { name: 'Apply', exact: true });
  await apply.scrollIntoViewIfNeeded();
  await expect(apply).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.workspace > main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await apply.click();
  await expect(popup).toHaveCount(0);
});
