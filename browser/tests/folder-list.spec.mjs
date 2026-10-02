import AxeBuilder from '@axe-core/playwright';
import { test, expect, dashboard, resource } from './fixtures.mjs';

const folder = (id, name, date = '2026-01-02T12:00:00Z', allowed = true) => ({
  '@id': id, resourceType: 'folder', 'schema:name': name, 'pav:lastUpdatedOn': date,
  currentUserPermissions: {capabilities: allowed ? ['copyIntoFolder', 'moveIntoFolder'] : []},
});
const home = folder('home', 'My workspace');
const children = [folder('archive', 'Archive'), folder('restricted', 'Read only', '2025-09-16T12:00:00Z', false)];

async function openPicker(page, action = 'Copy', many = false, options = {}) {
  const reads = [];
  await page.route('**/folders/**', async route => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/folders/')[1].split('/')[0]);
    if (!url.searchParams.has('resource_types') && url.pathname.endsWith('/contents')) return route.fallback();
    const current = [home, ...children].find(f => f['@id'] === id);
    if (url.pathname.endsWith('/contents')) {
      if (options.pending) await options.pending;
      if (options.fail) return route.fulfill({status: 503, json: {message: 'Folder unavailable'}});
      reads.push({id, sort: url.searchParams.get('sort'), offset: url.searchParams.get('offset')});
      let rows = id === 'home' ? [...children] : [];
      if (many && id === 'home') rows = Array.from({length: 51}, (_, n) => folder('f'+n, 'Folder '+String(n).padStart(2, '0')));
      if (url.searchParams.get('sort').startsWith('-')) rows.reverse();
      const offset = Number(url.searchParams.get('offset'));
      return route.fulfill({json: {resources: rows.slice(offset, offset + 50), totalCount: rows.length, pathInfo: id === 'home' ? [home] : [home, current]}});
    }
    return route.fulfill({json: current});
  });
  if (action === 'Create Draft') await page.route('**/templates/template/report', route => route.fulfill({json: {...resource, 'bibo:status': 'bibo:published'}}));
  await dashboard(page);
  await page.getByRole('button', {name: 'Actions for Study metadata'}).click();
  await page.locator('.resource-menu').getByRole('button', {name: action, exact: true}).click();
  if (!options.pending) await expect(page.locator('dialog .folder-scroll')).toHaveAttribute('aria-busy', 'false');
  return reads;
}

// Create Draft confirms with Ok; Copy and Move save.
const submitLabel = action => action === 'Create Draft' ? 'Ok' : 'Save';

for (const action of ['Copy', 'Move', 'Create Draft']) {
  test(`${action} uses the shared folder list, sorts and navigates with permissions`, async ({page, api}) => {
    const reads = await openPicker(page, action);
    const dialog = page.locator('cedar-resource-dialog dialog');
    const table = dialog.getByRole('table', {name: 'Destination folder'});
    await expect(dialog.locator('.breadcrumbs button')).toHaveText(['My workspace']);
    await expect(dialog.locator('.breadcrumb-separator')).toHaveCount(0);
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Last modified']);
    const dateColumn = table.getByRole('columnheader').last();
    const dateButton = dateColumn.getByRole('button');
    const dateWidth = (await dateColumn.boundingBox()).width;
    const insets = await dateColumn.evaluate(el => {
      const style = getComputedStyle(el);
      return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    });
    expect(dateWidth - (await dateButton.boundingBox()).width - insets).toBeLessThanOrEqual(1);
    await expect(table.locator('[data-cedar-icon="artifact-folder"]')).toHaveCount(2);
    await expect(table.locator('.row-actions')).toHaveCount(0);
    await expect(dialog.getByRole('button', {name:'Previous', exact: true})).toHaveCount(0);
    await expect(table.getByRole('row').nth(1)).toContainText('1 day ago');
    const workspaceRow = await page.locator('.workspace tbody tr').first().boundingBox();
    const folderRow = await table.locator('tbody tr').first().boundingBox();
    // Collapsed borders can distribute half a CSS pixel differently between tables.
    expect(Math.abs(folderRow.height - workspaceRow.height)).toBeLessThanOrEqual(0.5);
    const padding = locator => locator.evaluate(el => getComputedStyle(el).paddingBlock);
    expect(await padding(table.locator('tbody td').first())).toBe(
      await padding(page.locator('.workspace tbody td').first()),
    );
    if (process.env.WORKSPACE_VISUAL) {
      await page.mouse.move(0, 0);
      await expect(dialog).toHaveScreenshot(`folder-${action.replaceAll(' ', '-').toLowerCase()}.png`);
    }
    await expect(table.getByRole('columnheader', {name:'Name'})).toHaveAttribute('aria-sort', 'ascending');
    await table.getByRole('button', {name:'Name', exact:true}).click();
    await expect(table.getByRole('row').nth(1)).toContainText('Read only');
    expect(reads.at(-1)).toEqual({id:'home', sort:'-name', offset:'0'});
    await table.getByRole('button', {name:'Last modified', exact:true}).click();
    await expect(table.getByRole('columnheader', {name:'Last modified'})).toHaveAttribute('aria-sort', 'ascending');
    await table.getByRole('button', {name:'Read only', exact:true}).click();
    await expect(dialog.getByRole('button', {name:submitLabel(action), exact:true})).toBeDisabled();
    await expect(dialog).toContainText('No subfolders');
    await dialog.locator('.breadcrumbs').getByRole('button', {name:'My workspace', exact:true}).click();
    const archive = table.getByRole('button', {name:'Archive', exact:true});
    await archive.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.breadcrumbs').getByRole('button', {name:'Archive', exact:true})).toBeVisible();
    await expect(dialog.locator('.breadcrumbs button')).toHaveText(['My workspace', 'Archive']);
    await expect(dialog.locator('.breadcrumb-separator')).toHaveCount(1);
    await expect(dialog.getByRole('button', {name:submitLabel(action), exact:true})).toBeEnabled();
    expect(reads.at(-1)).toEqual({id:'archive', sort:'lastUpdatedOnTS', offset:'0'});
    await dialog.getByRole('button', {name:submitLabel(action), exact:true}).click();
    await expect(dialog).toHaveCount(0);
    const command = api.requests.find(r => r.path.includes('/command/'));
    expect(command.body.targetFolderId ?? command.body.folderId).toBe('archive');
  });
}

for (const action of ['Copy', 'Move', 'Create Draft']) {
  test(`${action} presents the complete dialog once after its initial reads`, async ({page, api}) => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await openPicker(page, action, false, {pending});
    const dialog = page.locator('cedar-resource-dialog dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
    await expect(dialog.locator('form')).toBeHidden();
    await expect(dialog.getByRole('status', {includeHidden: true})).toBeVisible();
    expect(await dialog.evaluate(el => getComputedStyle(el, '::backdrop').visibility)).toBe('visible');
    // Record only painted panels: there must be no small loading form, disabled
    // intermediate frame or subsequent resize as the breadcrumb and rows arrive.
    await page.evaluate(() => {
      window.dialogFrames = [];
      const sample = () => {
        const el = document.querySelector('cedar-resource-dialog dialog');
        if (el && getComputedStyle(el).visibility === 'visible') {
          const box = el.getBoundingClientRect();
          window.dialogFrames.push({height:box.height, y:box.y,
            rows:el.querySelectorAll('tbody tr').length,
            disabled:el.querySelector('fieldset').disabled});
        }
        window.dialogFrameId = requestAnimationFrame(sample);
      };
      sample();
    });
    release();
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    await expect(dialog.getByRole('button', {name:submitLabel(action), exact:true})).toBeEnabled();
    await expect(dialog.locator('.dialog-preparing-status')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.dialogFrames.length)).toBeGreaterThan(2);
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.dialogFrameId);
      return window.dialogFrames;
    });
    expect(frames.every(frame => frame.rows === 2 && !frame.disabled)).toBe(true);
    expect(new Set(frames.map(frame => `${frame.y}:${frame.height}`)).size).toBe(1);
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  });
}

test('initial destination errors are visible and a pending load can be cancelled safely', async ({page, api}) => {
  await openPicker(page, 'Copy', false, {fail:true});
  const dialog = page.locator('cedar-resource-dialog dialog');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', {name:'Cancel', exact:true}).click();
  let release;
  const pending = new Promise(resolve => {release = resolve;});
  await openPicker(page, 'Move', false, {pending});
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const returned = page.waitForResponse(response => response.url().includes('resource_types=folder'));
  release();
  await returned;
  await expect(page.getByRole('button', {name:'Actions for Study metadata', exact:true})).toBeFocused();
  await expect(dialog).toHaveCount(0);
});

test('folder pagination retains sorting and resets its offset when sorting changes', async ({page, api}) => {
  const reads = await openPicker(page, 'Copy', true);
  const dialog = page.locator('cedar-resource-dialog dialog');
  await dialog.getByRole('button', {name:'Next', exact:true}).click();
  await expect(dialog.getByRole('button', {name:'Folder 50', exact:true})).toBeVisible();
  expect(reads.at(-1).offset).toBe('50');
  await dialog.getByRole('columnheader', {name:'Name'}).getByRole('button').click();
  await expect(dialog.getByRole('button', {name:'Previous', exact:true})).toBeDisabled();
  expect(reads.at(-1)).toEqual({id:'home', sort:'-name', offset:'0'});
});

test('folder list fits a narrow dialog and remains accessible', async ({page, api}) => {
  await page.setViewportSize({width:375, height:900});
  await openPicker(page);
  const dialog = page.locator('cedar-resource-dialog dialog');
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await dialog.locator('.folder-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.mouse.move(0, 0);
  const result = await new AxeBuilder({page}).include('cedar-resource-dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
  if (process.env.WORKSPACE_VISUAL) await expect(dialog).toHaveScreenshot('folder-copy-narrow.png');
});

for (const width of [1440, 375]) {
  test(`Copy keeps an empty destination compact at ${width}`, async ({page, api}) => {
    await page.setViewportSize({width, height:900});
    await openPicker(page);
    await page.route('**/folders/archive/contents?*', route => route.fulfill({json: {
      resources: [], totalCount: 0,
      pathInfo: [folder('all', 'All'), folder('users', 'Users'), home, children[0]],
    }}));
    const dialog = page.locator('cedar-resource-dialog dialog');
    await dialog.locator('cedar-folder-list').getByRole('button', {name:'Archive', exact:true}).click();
    await expect(dialog.getByRole('cell', {name:'No subfolders', exact:true})).toBeVisible();
    const breadcrumb = dialog.locator('.breadcrumbs');
    const buttons = breadcrumb.getByRole('button');
    for (const button of await buttons.all()) {
      const bounds = await button.boundingBox();
      // Inline navigation must not inherit the 36px form-button height/padding.
      expect(bounds.height).toBe(24);
      await expect(button).toHaveCSS('padding-top', '0px');
      await expect(button).toHaveCSS('padding-bottom', '0px');
    }
    const box = await dialog.boundingBox();
    // A content budget catches whitespace growth even when every value is a token.
    expect(box.height).toBeLessThanOrEqual(width === 1440 ? 380 : 420);
    await expect(dialog).toHaveCSS('padding-top', '16px');
    await expect(dialog).toHaveCSS('padding-bottom', '16px');
    await expect(dialog.getByRole('button', {name:'Save', exact:true})).toBeEnabled();
    await page.mouse.move(0, 0);
    if (process.env.WORKSPACE_VISUAL) await expect(dialog).toHaveScreenshot(`folder-copy-empty-${width}.png`);
    expect((await new AxeBuilder({page}).include('cedar-resource-dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  });
}

for (const action of ['Move', 'Copy', 'Create Draft']) {
  for (const exit of ['Cancel', 'Close', 'Escape']) {
    test(`${action} cancels destination browsing through ${exit} without a discard prompt or write`, async ({page, api}) => {
      await openPicker(page, action);
      const dialog = page.locator('cedar-resource-dialog dialog');
      await dialog.locator('cedar-folder-list').getByRole('button', {name:'Archive', exact:true}).click();
      await expect(dialog.locator('.breadcrumbs').getByRole('button', {name:'Archive', exact:true})).toBeVisible();
      if (exit === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', {name:exit === 'Close' ? 'Close dialog' : exit, exact:true}).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.confirmation-dialog')).toHaveCount(0);
      expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
    });
  }
}

for (const [action, field, value, original] of [
  ['Copy', 'Name of copy', 'New copy name', 'Study metadata (copy)'],
]) {
  test(`${action} still protects edited content after browsing and recognises a revert`, async ({page, api}) => {
    await openPicker(page, action);
    const dialog = page.locator('cedar-resource-dialog dialog');
    await dialog.getByRole('textbox', {name:field, exact:true}).fill(value);
    await dialog.locator('cedar-folder-list').getByRole('button', {name:'Archive', exact:true}).click();
    await expect(dialog.locator('.breadcrumbs').getByRole('button', {name:'Archive', exact:true})).toBeVisible();
    await dialog.getByRole('button', {name:'Cancel', exact:true}).click();
    const confirmation = page.locator('.confirmation-dialog');
    await expect(confirmation).toContainText('Discard unsaved changes?');
    await confirmation.getByRole('button', {name:'Cancel', exact:true}).click();
    await expect(dialog.getByRole('textbox', {name:field, exact:true})).toHaveValue(value);
    await dialog.getByRole('textbox', {name:field, exact:true}).fill(original);
    await dialog.getByRole('button', {name:'Cancel', exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
  });
}
