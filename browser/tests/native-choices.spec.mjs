import { test, expect, dashboard, action, resource } from "./fixtures.mjs";

// Compare computed values with the roles themselves, not a copied brand hex.
async function themedChoices(page, region = page) {
  const controls = region.locator('input[type="checkbox"], input[type="radio"]');
  await expect(controls.first()).toBeVisible();
  for (const control of await controls.all()) {
    const colours = await control.evaluate(el => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--cedar-color-primary)';
      el.parentElement.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(el).accentColor, expected };
    });
    expect(colours.actual).toBe(colours.expected);
  }
}

test('Groups, permissions, filters and draft sharing use the shared native theme', async ({page, api}) => {
  await page.goto('/groups');
  await page.getByRole('tab', {name:'Create group', exact:true}).click();
  await page.getByLabel('Group name', {exact:true}).fill('Research team');
  await page.getByRole('button', {name:'Create group', exact:true}).click();
  await expect(page.locator('.groups-member-row')).toHaveCount(2);
  await themedChoices(page);
  await expect(page.locator('input[type="checkbox"]:disabled')).toHaveCount(1);
  await dashboard(page);
  await action(page, 'Permissions…');
  await themedChoices(page, page.getByRole('dialog', {name:'Permissions', exact:true}));
  await page.getByRole('button', {name:'Done', exact:true}).click();
  await page.getByRole('button', {name:'Type', exact:true}).click();
  await themedChoices(page);
  await page.keyboard.press('Escape');
  await page.route('**/templates/template/report', route => route.fulfill({json:{...resource, 'bibo:status':'bibo:published'}}));
  await page.getByRole('button', {name:'Actions for Study metadata'}).click();
  await page.locator('.resource-menu').getByRole('button', {name:'Create Draft', exact:true}).click();
  const draft = page.locator('input[name="propagate"]');
  await expect(draft).toBeVisible();
  await themedChoices(page);
  await page.keyboard.press('Tab');
  await draft.focus();
  expect(await draft.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
});

test('new native checkbox and radio controls inherit tokens in every state', async ({page, api}) => {
  await dashboard(page);
  await page.evaluate(() => {
    const host = document.querySelector('cedar-workspace');
    // A different host palette proves this is token consumption, not a matching hex.
    host.style.setProperty('--cedar-color-primary', 'rgb(120, 40, 90)');
    host.style.setProperty('--cedar-color-primary', 'rgb(120, 40, 90)');
    const form = document.createElement('form');
    form.id = 'native-choice-contract';
    for (const type of ['checkbox','radio']) for (const state of ['checked','unchecked','disabled']) {
      const input = document.createElement('input');
      input.type = type;
      input.checked = state !== 'unchecked';
      input.disabled = state === 'disabled';
      input.setAttribute('aria-label', `${type} ${state}`);
      form.append(input);
    }
    host.prepend(form);
  });
  const form = page.locator('#native-choice-contract');
  await themedChoices(page, form);
  const checkbox = form.getByRole('checkbox', {name:'checkbox unchecked', exact:true});
  await page.keyboard.press('Tab');
  await checkbox.focus();
  await expect(checkbox).toHaveCSS('outline-color', 'rgb(120, 40, 90)');
  await checkbox.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(form.getByRole('checkbox', {name:'checkbox disabled', exact:true})).toBeDisabled();
});
