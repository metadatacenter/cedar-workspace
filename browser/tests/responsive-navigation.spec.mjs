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

for (const width of [1440, 768, 375]) test(`grid view and sort controls wrap together at ${width}`, async ({ page, api }, info) => {
  await page.setViewportSize({ width, height: 667 });
  await listing(page, 'grid');
  const toolbar = page.locator('.explorer-toolbar');
  await toolbar.scrollIntoViewIfNeeded();
  const controls = [
    toolbar.getByRole('button', { name: 'List view', exact: true }),
    toolbar.getByRole('button', { name: 'Grid view', exact: true }),
    toolbar.locator('cedar-sort-menu > button'),
  ];
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  const centers = boxes.map(box => box.y + box.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
  expect(boxes[2].x - boxes[1].x - boxes[1].width).toBeLessThanOrEqual(16);
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[2].x + boxes[2].width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath(`grouped-toolbar-${width}.png`) });
  await controls[2].click();
  await expect(page.getByRole('menuitemradio', { name: 'Name', exact: true })).toBeVisible();
  // The menu moves focus to its checked item on the next frame, and the panel holds the Escape
  // handler. An Escape pressed before focus arrives reaches the page and leaves the menu open.
  await expect(toolbar.locator('cedar-sort-menu [role="menuitemradio"][aria-checked="true"]').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(controls[2]).toBeFocused();
});

for (const view of ['list', 'grid']) test(`tablet long path retains a usable ${view} with both panels open`, async ({ page, api }, info) => {
  await page.setViewportSize({ width: 768, height: 667 });
  await listing(page, view);
  await page.locator('[aria-controls="workspace-information"]').click();
  await expect(page.locator('.workspace')).not.toHaveClass(/right-collapsed|left-collapsed/);
  const region = page.locator('.table-scroll');
  expect((await region.boundingBox()).height).toBeGreaterThanOrEqual(240);
  if (view === 'list') {
    // Scroll the listing until its heading reaches paging. The heading stops at the edge of the
    // region the listing scrolls in, above paging's own strip, so neither covers the other.
    await page.locator('.listing-pane').evaluate((pane) => {
      const heading = pane.querySelector('thead').getBoundingClientRect();
      const paging = document.querySelector('.paging').getBoundingClientRect();
      pane.scrollTop += heading.top - paging.top;
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
      // A phone listing still scrolls sideways to reach the row actions; a tablet one holds them.
      if (width < 768) expect(await region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
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

// Names and versions as long as stored resources carry, so the columns take their full width.
const wide = Array.from({ length: 54 }, (_, i) => ({ ...resource, '@id': `record-${i + 1}`, 'pav:version': '12.10.3',
  'bibo:status': 'bibo:published', 'schema:name': `Record ${i + 1} - Long resource title for the international research collection` }));
async function wideListing(page) {
  await page.route(/\/api\/resource\/templates\/record-\d+(\/report)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.match(/record-\d+/)[0];
    await route.fulfill({ json: wide.find((item) => item['@id'] === id) });
  });
  await page.route('**/api/resource/folders/home/contents?**', (route) =>
    route.fulfill({ json: { resources: wide.slice(0, 50), totalCount: 54, pathInfo } }));
  await page.goto('/dashboard?view=list');
  await expect(page.locator('[data-resource-id="record-1"]')).toBeVisible();
  await expect(page.locator('.table-scroll')).toHaveAttribute('aria-busy', 'false');
}

test('a tablet list with the information panel closed keeps every column and row action in view', async ({ page, api }) => {
  await page.setViewportSize({ width: 768, height: 667 });
  await wideListing(page);
  await expect(page.locator('.workspace')).toHaveClass(/right-collapsed/);
  await expect(page.locator('.workspace')).not.toHaveClass(/left-collapsed/);
  const region = page.locator('.table-scroll');
  expect(await region.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const edge = await region.boundingBox();
  for (const control of [page.locator('thead cedar-sort-menu button').first(),
    ...[1, 2, 3].map((n) => page.getByRole('button', { name: `Actions for Record ${n} - Long resource title for the international research collection`, exact: true }))]) {
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(edge.x);
    expect(box.x + box.width).toBeLessThanOrEqual(edge.x + edge.width + 0.5);
  }
  for (const heading of await page.locator('thead th').all())
    expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('with both tablet panels open, paging has a strip of its own beneath the scrolling listing', async ({ page, api }) => {
  await page.setViewportSize({ width: 768, height: 667 });
  await listing(page, 'list');
  await page.locator('[aria-controls="workspace-information"]').click();
  await expect(page.locator('.workspace')).not.toHaveClass(/right-collapsed|left-collapsed/);
  const geometry = await page.evaluate(() => {
    let scroller = document.querySelector('.explorer-toolbar').parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const paging = document.querySelector('.paging');
    return { holdsPaging: scroller.contains(paging), bottom: scroller.getBoundingClientRect().bottom,
      paging: paging.getBoundingClientRect().top };
  });
  expect(geometry.holdsPaging).toBe(false);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.paging + 0.5);
  await expect(page.locator('.paging')).toBeInViewport({ ratio: 1 });
  const reachable = (locator) => locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top === el || el.contains(top);
  });
  for (const control of [page.getByRole('button', { name: 'List view', exact: true }),
    page.getByRole('button', { name: 'Grid view', exact: true }), page.locator('thead th button').first()]) {
    await control.scrollIntoViewIfNeeded();
    expect(await reachable(control)).toBe(true);
  }
});

for (const panels of ['information', 'both']) test(`with the information panel open on a tablet (${panels}), the row actions stay at the listing's right edge`, async ({ page, api }) => {
  await page.setViewportSize({ width: 768, height: 667 });
  await wideListing(page);
  await page.locator('[aria-controls="workspace-information"]').click();
  if (panels === 'information') await page.locator('[aria-controls="workspace-navigation"]').click();
  await expect(page.locator('.workspace')).not.toHaveClass(/right-collapsed/);
  const region = page.locator('.table-scroll');
  // The table is still wider than the listing and scrolls sideways beneath the pinned column.
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const reachable = (locator) => locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top === el || el.contains(top);
  });
  const name = (n) => `Record ${n} - Long resource title for the international research collection`;
  const controls = [page.locator('thead cedar-sort-menu button').first(),
    ...[1, 2].map((n) => page.getByRole('button', { name: `Actions for ${name(n)}`, exact: true }))];
  // With both panels open the path fills the pane above the table, so bring the table into view, as a user scrolls to it.
  await region.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  for (const position of ['start', 'end']) {
    await region.evaluate((el, position) => { el.scrollLeft = position === 'end' ? el.scrollWidth : 0; }, position);
    const edge = await region.evaluate((el) => { const box = el.getBoundingClientRect(); return { left: box.left, right: box.left + el.clientWidth }; });
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(edge.left);
      expect(box.x + box.width).toBeLessThanOrEqual(edge.right + 0.5);
      expect(await reachable(control)).toBe(true);
    }
  }
  // A row's open menu stays above the pinned cells of the rows beneath it.
  await region.evaluate((el) => { el.scrollLeft = 0; });
  await controls[1].click();
  const menu = page.locator('#resource-menu');
  await expect(menu).toBeVisible();
  for (const item of await menu.getByRole('button').all()) expect(await reachable(item)).toBe(true);
});
