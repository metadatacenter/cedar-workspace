import {test, expect} from './fixtures.mjs';

for (const width of [1440, 375]) {
  test(`Workspace return uses one style across pages at ${width}`, async ({page, api}) => {
    await page.setViewportSize({width, height:1000});
    let reference;
    for (const route of ['groups', 'profile', 'settings', 'privacy', 'instances/edit/instance']) {
      await page.goto('/' + route);
      const control = page.locator('cedar-workspace-return').getByRole(route.startsWith('instances') ? 'button' : 'link', {name:'Back to Workspace', exact:true});
      await expect(control).toBeVisible();
      await expect(control).toHaveText('Workspace');
      const appearance = await control.evaluate(element => {
        const style = getComputedStyle(element);
        return Object.fromEntries(['color', 'fontSize', 'fontWeight', 'padding', 'gap', 'minHeight', 'display', 'alignItems'].map(key => [key, style[key]]));
      });
      reference ??= appearance;
      expect(appearance).toEqual(reference);
      await expect(control.locator('cedar-icon[name="back"] svg')).toHaveCount(1);
      if (!route.startsWith('instances')) {
        await control.click();
        await expect(page).toHaveURL(/\/dashboard$/);
      } else {
        await expect(page.getByLabel('Instance name', {exact:true})).toHaveValue('Study record');
        await control.click();
        await expect(page).toHaveURL(/\/dashboard\?/);
      }
    }
  });
}
