import AxeBuilder from '@axe-core/playwright';
import { test, expect, dashboard, resource } from './fixtures.mjs';

const folder = (id, name, date = '2026-01-02T12:00:00Z', allowed = true) => ({
  '@id': id, resourceType: 'folder', 'schema:name': name, 'pav:lastUpdatedOn': date,
  currentUserPermissions: {capabilities: allowed ? ['copyIntoFolder', 'moveIntoFolder'] : []},
});
const home = folder('home', 'My workspace');
const children = [folder('archive', 'Archive'), folder('restricted', 'Read only', '2025-09-16T12:00:00Z', false)];

async function openPicker(page, action = 'Copy', many = false) {
  const reads = [];
  await page.route('**/folders/**', async route => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/folders/')[1].split('/')[0]);
    if (!url.searchParams.has('resource_types') && url.pathname.endsWith('/contents')) return route.fallback();
    const current = [home, ...children].find(f => f['@id'] === id);
    if (url.pathname.endsWith('/contents')) {
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
  await expect(page.locator('dialog .folder-scroll')).toHaveAttribute('aria-busy', 'false');
  return reads;
}

for (const action of ['Copy', 'Move', 'Create Draft']) {
  test(`${action} uses the shared folder list, sorts and navigates with permissions`, async ({page, api}) => {
    const reads = await openPicker(page, action);
    const dialog = page.locator('cedar-resource-dialog dialog');
    const table = dialog.getByRole('table', {name: 'Destination folder'});
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Last modified']);
    await expect(table.locator('[data-cedar-icon="artifact-folder"]')).toHaveCount(2);
    await expect(table.locator('.row-actions')).toHaveCount(0);
    await expect(dialog.getByRole('button', {name:'Previous', exact: true})).toHaveCount(0);
    await expect(table.getByRole('row').nth(1)).toContainText('1 day ago');
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
    await expect(dialog.getByRole('button', {name:'Save', exact:true})).toBeDisabled();
    await expect(dialog).toContainText('No subfolders');
    await dialog.locator('.breadcrumbs').getByRole('button', {name:'My workspace', exact:true}).click();
    const archive = table.getByRole('button', {name:'Archive', exact:true});
    await archive.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toContainText('Selected: Archive');
    await expect(dialog.getByRole('button', {name:'Save', exact:true})).toBeEnabled();
    expect(reads.at(-1)).toEqual({id:'archive', sort:'lastUpdatedOnTS', offset:'0'});
    await dialog.getByRole('button', {name:'Save', exact:true}).click();
    await expect(dialog).toHaveCount(0);
    const command = api.requests.find(r => r.path.includes('/command/'));
    expect(command.body.targetFolderId ?? command.body.folderId).toBe('archive');
  });
}

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
