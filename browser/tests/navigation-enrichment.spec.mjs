import { createServer } from 'node:http';
import { test, expect, resource } from './fixtures.mjs';

test('full-page navigation stops pending report batches and Back restores enrichment', async ({ page, api, baseURL }) => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...resource, '@id': `template-${i}`, 'schema:name': `Template ${i}` }));
  const folder = { ...resource, '@id': 'home', resourceType: 'folder', 'schema:name': 'Home' };
  const requests = [];
  const pending = [];
  let returning = false;
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, CEDAR-Client-Session-Id, Content-Type');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    const path = new URL(request.url, 'http://fixture').pathname;
    if (path.endsWith('/report')) {
      requests.push(path);
      const row = rows.find(row => path.includes(`/${row['@id']}/`));
      if (!returning) { pending.push({ response, row }); return; }
      response.end(JSON.stringify(row));
    } else if (path.endsWith('/contents') || path === '/search') {
      response.end(JSON.stringify({ resources: rows, totalCount: rows.length, pathInfo: [folder] }));
    } else if (path === '/folders/home') response.end(JSON.stringify(folder));
    else { response.writeHead(404).end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  const lifecycle = [];
  await page.exposeBinding('recordLifecycle', (_source, event) => lifecycle.push(event));
  await page.addInitScript(() => {
    for (const name of ['beforeunload', 'pagehide', 'visibilitychange', 'pageshow'])
      window.addEventListener(name, event => { void window.recordLifecycle({ name, hidden: document.hidden, persisted: event.persisted }).catch(() => {}); });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/config/url-service.conf.json', route => route.fulfill({ json: {
      resourceRestAPI: apiOrigin, userRestAPI: `${baseURL}/api/user`, groupRestAPI: `${baseURL}/api/group`,
      templateDesignerFrontend: baseURL, workspaceFrontend: baseURL,
    } }));
    await page.route('**/navigation-target', route => route.fulfill({ contentType: 'text/html', body: '<h1>Another page</h1>' }));
    await page.goto('/dashboard');
    await expect.poll(() => requests.length).toBe(4);
    await page.goto('/navigation-target');
    // Release server work after navigation. Neither cancellation nor a late answer may start batch two.
    for (const { response, row } of pending) if (!response.destroyed) response.end(JSON.stringify(row));
    await expect(page.getByRole('heading', { name: 'Another page' })).toBeVisible();
    await page.waitForTimeout(200);
    expect(requests).toHaveLength(4);
    expect(errors, JSON.stringify(lifecycle)).toEqual([]);
    returning = true;
    await page.goBack();
    await expect.poll(() => requests.length).toBe(12);
    await expect(page.getByText('Template 7', { exact: true }).first()).toBeVisible();
    expect(errors, JSON.stringify(lifecycle)).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
