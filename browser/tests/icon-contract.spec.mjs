import {test, expect, dashboard} from './fixtures.mjs';
import {checkIcons} from './surface-contracts.generated.mjs';

for (const primary of ['#0f7686', '#7030a0']) {
  test(`whole-page icon roles follow ${primary}`, async ({page, api}) => {
    await dashboard(page);
    await page.locator('body').evaluate((el, color) => el.style.setProperty('--cedar-color-primary', color), primary);
    await checkIcons(page.locator('body'), 'dashboard', expect);
    await expect(page.locator('#button-create svg')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.getByRole('button', {name:'Actions for Study metadata'}).click();
    await page.locator('.resource-menu').getByRole('button', {name:'Copy', exact:true}).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await expect(page.locator('dialog[open] button[type=submit]')).toBeDisabled();
    await expect(page.locator('dialog[open] button[type=submit]')).toHaveCSS('opacity','0.45');
    await checkIcons(page.locator('dialog').last(), 'copy', expect);
    const resource = page.locator('dialog .resource-dialog-resource svg');
    await expect(resource).toHaveCSS('color', primary === '#0f7686' ? 'rgb(15, 118, 134)' : 'rgb(112, 48, 160)');
    await page.goto('/groups');
    await page.locator('body').evaluate((el, color) => el.style.setProperty('--cedar-color-primary', color), primary);
    const search = page.getByRole('combobox', {name: 'Find a group', exact: true});
    await search.fill('Research');await search.press('Enter');
    await expect(page.getByLabel('Name', {exact:true})).toHaveValue('Research team');
    await expect(page.locator('.groups-member-avatar').first()).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await checkIcons(page.locator('body'), 'groups', expect);
  });
}

test('icon contract catches an overriding local foreground', async ({page, api}) => {
  await dashboard(page);
  const icon = page.locator('#button-create svg');
  await icon.evaluate(el => el.style.setProperty('color', 'black', 'important'));
  await expect(checkIcons(page.locator('body'), 'deliberate drift', expect)).rejects.toThrow();
});
