import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { test, expect } from './fixtures.mjs';

const stats = JSON.parse(readFileSync(new URL('../../app/workspace-build/browser-stats.json', import.meta.url)));
const routeScripts = Object.entries(stats.outputs)
  .filter(([, output]) => /src\/app\/(groups|profile|settings|privacy|logout)\.ts$/.test(output.entryPoint ?? ''))
  .map(([file]) => basename(file));

test('account screens stay out of the dashboard download and load when opened', async ({ page, api }) => {
  expect(routeScripts).toHaveLength(5);
  const scripts = new Set();
  page.on('request', request => { if (request.resourceType() === 'script') scripts.add(basename(new URL(request.url()).pathname)); });
  await page.goto('/dashboard');
  await expect(page.getByText('Study metadata', { exact: true }).first()).toBeVisible();
  expect(routeScripts.filter(file => scripts.has(file))).toEqual([]);
  await page.goto('/groups');
  await expect(page.getByRole('tab', { name: 'Manage groups', exact: true })).toBeVisible();
  expect(routeScripts.filter(file => scripts.has(file))).toHaveLength(1);
});
