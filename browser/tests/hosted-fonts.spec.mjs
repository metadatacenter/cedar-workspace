import { test, expect } from './fixtures.mjs';

test('hosted typography requests only the unicode subsets in use', async ({ page, api }) => {
  const fonts = new Set();
  const failures = [];
  page.on('request', request => { if (request.resourceType() === 'font') fonts.add(request.url()); });
  page.on('requestfailed', request => { if (request.resourceType() === 'font') failures.push(request.url()); });
  await page.goto('/dashboard');
  await expect(page.getByText('Study metadata', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.size).toBe(2);
  expect([...fonts].every(url => url.endsWith('.woff2'))).toBe(true);
  await page.evaluate(async () => {
    await Promise.all([400, 500].map(weight => document.fonts.load(`${weight} 14px "CEDAR Roboto"`, 'Árvíztűrő tükörfúrógép')));
  });
  expect(fonts.size).toBe(4);
  expect(failures).toEqual([]);
});
