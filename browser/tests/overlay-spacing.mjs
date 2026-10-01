import { expect } from '@playwright/test';

// Compare computed styles with inherited tokens, not a second set of CSS values.
export async function tokenStyles(locator, rules) {
  expect(await locator.count(), 'spacing contract must match rendered elements').toBeGreaterThan(0);
  for (const element of await locator.all()) {
    const values = await element.evaluate((target, rules) => {
      const actual = getComputedStyle(target);
      const values = Object.fromEntries(Object.keys(rules).map(property => [property, {actual: actual.getPropertyValue(property)}]));
      const probe = document.createElement('span');
      probe.style.display = 'none';
      target.append(probe);
      for (const [property, token] of Object.entries(rules)) {
        probe.style.setProperty(property, token.startsWith('--') ? `var(${token})` : token);
        values[property].expected = getComputedStyle(probe).getPropertyValue(property);
      }
      probe.remove();
      return values;
    }, rules);
    for (const [property, value] of Object.entries(values))
      expect(value.actual, `${property} must follow overlay spacing`).toBe(value.expected);
  }
}

export const menuItemSpacing = {
  'min-height': '--cedar-control-height-default',
  'padding-top': '--cedar-space-2',
  'padding-bottom': '--cedar-space-2',
};

export const feedbackSpacing = {
  'padding-top': '--cedar-space-2',
  'padding-bottom': '--cedar-space-2',
  'padding-left': '--cedar-space-3',
  'padding-right': '--cedar-space-3',
};
