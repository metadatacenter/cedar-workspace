import { test, expect, resource } from "./fixtures.mjs";

for (const failure of [false, true]) {
  test(`a late description ${failure ? "failure" : "response"} cannot overwrite the selected item`, async ({ page, api }) => {
    const items = ["first", "second"].map(id => ({ ...resource, "@id": id, resourceType: "element", "schema:name": id, "schema:description": id + " description" }));
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { started = resolve; });
    await page.route("**/api/resource/folders/home/contents?**", route => route.fulfill({ json: { resources: items, totalCount: 2, pathInfo: [] } }));
    await page.route("**/api/resource/template-elements/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const item = items.find(item => path.includes("/" + item["@id"])) ?? items[0];
      if (path.endsWith("/first")) { started(); await gate; }
      await route.fulfill(path.endsWith("/first") && failure
        ? { status: 503, json: { message: "obsolete description failure" } }
        : { json: item, headers: { ETag: '"' + item["@id"] + '"' } });
    });
    await page.goto("/dashboard");
    await page.locator('.explorer-item[data-resource-id="first"]').click();
    await requested;
    await page.locator('.explorer-item[data-resource-id="second"]').click();
    const description = page.locator("#resource-description");
    await expect(description).toHaveValue("second description");
    const obsoleteReply = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/first"));
    release();
    await obsoleteReply;
    await expect(description).toBeEnabled();
    await description.fill("second edited");
    await expect(description).toHaveValue("second edited");
    await expect(page.getByText("obsolete description failure")).toHaveCount(0);
    expect(api.requests.filter(request => request.method !== "GET")).toEqual([]);
  });
}

for (const bad of [{ resources: null, totalCount: 0 }, { resources: [resource, resource], totalCount: 2 }]) {
  test(`a malformed listing cannot become selectable and a refresh recovers: ${JSON.stringify(bad)}`, async ({ page, api }) => {
    await page.route("**/api/resource/folders/home/contents?**", route => route.fulfill({ json: bad }));
    await page.goto("/dashboard");
    await expect(page.getByRole("alert")).toContainText("incomplete resource list");
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.unroute("**/api/resource/folders/home/contents?**");
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(api.requests.filter(request => request.method !== "GET")).toEqual([]);
  });
}

for (const depth of [1, 3, 8]) for (const severity of ["errors", "warnings"]) {
  test(`server ${severity} at nesting depth ${depth} stay attached to the submitted draft`, async ({ page, api }) => {
    const path = Array.from({length: depth}, (_, i) => `Child${i}`).concat('Link');
    let template = {properties: {Link: {_ui: {inputType: 'link'}, 'schema:name': 'Link'}}};
    for (let i = depth - 1; i >= 0; i--) template = {properties: {[path[i]]: {type: 'array', items: template}}};
    template['@id'] = 'template'; template['schema:name'] = 'Study';
    await page.route('**/api/resource/templates/template', route => route.fulfill({json: template}));
    let writes = 0;
    await page.route('**/api/resource/template-instances/instance', route => {
      if (route.request().method() === 'GET') return route.fallback();
      writes++;
      return writes === 1
        ? route.fulfill({status: 400, json: {message: 'Server validation failed', objects: {validationReport: {[severity]: [{message: 'Review nested value', location: '/' + path.join('/1/') + '/@id'}]}}}})
        : route.fulfill({json: {'@id': 'instance'}, headers: {ETag: '"next"'}});
    });
    await page.goto('/instances/edit/instance');
    const name = page.getByLabel('Instance name', {exact:true});
    await name.fill('Unsaved');
    const save = page.getByRole('button', {name:'Save',exact:true});
    await save.click();
    const region = page.getByLabel(severity === 'errors' ? 'Metadata errors' : 'Metadata warnings', {exact:true});
    await expect(region).toContainText('Review nested value');
    await region.locator('summary').click();
    await region.getByRole('button', {name:/Review nested value/}).click();
    await expect.poll(() => page.evaluate(() => window.__ceeReveals?.at(-1))).toMatchObject({path, occurrences: Array(depth).fill(1)});
    if (severity === 'errors') await expect(save).toBeDisabled(); else await expect(save).toBeEnabled();
    await name.fill('Corrected');
    await expect(region).toHaveCount(0); await expect(save).toBeEnabled();
    await save.click(); await expect(page.locator('.metadata-save-status')).toHaveText('Saved');
    expect(writes).toBe(2);
  });
}

test('a failed metadata load can retry and a conflict requires an explicit reload', async ({page, api}) => {
  let failLoad = true, conflict = false;
  await page.route('**/api/resource/template-instances/instance', route => {
    if (failLoad) return route.fulfill({status: 503, json: {message:'Temporarily unavailable'}});
    if (conflict && route.request().method() === 'PUT') return route.fulfill({status: 412, json: {message:'Changed elsewhere'}});
    return route.fallback();
  });
  await page.goto('/instances/edit/instance');
  await expect(page.locator('.metadata-save-status')).toHaveText('Unable to load');
  failLoad = false; await page.getByRole('button', {name:'Retry',exact:true}).click();
  const name = page.getByLabel('Instance name', {exact:true}); await expect(name).toHaveValue('Study record');
  await name.fill('Unsaved'); conflict = true;
  const save = page.getByRole('button', {name:'Save',exact:true}); await save.click();
  await expect(save).toBeDisabled(); await expect(name).toHaveValue('Unsaved');
  await page.getByRole('button', {name:'Reload metadata',exact:true}).click();
  await page.locator('.confirmation-dialog').getByRole('button', {name:'Cancel',exact:true}).click();
  await expect(name).toHaveValue('Unsaved');
  await page.getByRole('button', {name:'Reload metadata',exact:true}).click();
  await page.locator('.confirmation-dialog').getByRole('button', {name:'OK',exact:true}).click();
  await expect(name).toHaveValue('Study record'); await expect(save).toBeEnabled();
});

for (const destination of ['Shared with Me', 'Shared with Everyone', 'Search']) for (const empty of [false, true]) {
  test(`${destination} accepts the server's null breadcrumb, empty=${empty}`, async ({page, api}) => {
    const rows = empty ? [] : [resource];
    await page.route('**/api/resource/search?**', route => route.fulfill({json: {resources: rows, totalCount: rows.length, pathInfo: null}}));
    await page.goto('/dashboard');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search'));
    if(destination === 'Search') {
      await page.getByRole('textbox', {name: 'Search workspace', exact:true}).fill('Study');
      await page.getByRole('button', {name:'Search',exact:true}).click();
    } else await page.getByRole('link', {name: destination, exact:true}).click();
    await response;
    await expect(page.locator('.table-scroll')).toHaveAttribute('aria-busy','false');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(rows.length);
    await expect(page.locator('.paging')).toContainText(empty ? 'Displaying 0–0 of 0' : 'Displaying 1–1 of 1');
    expect(api.requests.filter(request => request.method !== 'GET')).toEqual([]);
  });
}

test('an empty page after the collection shrinks reports no displayed rows and can go back',async({page, api})=>{
  await page.route('**/api/resource/search?**',route=>{
    const offset=Number(new URL(route.request().url()).searchParams.get('offset'));
    return route.fulfill({json:{resources:offset?[]:[resource],totalCount:20,pathInfo:null}});
  });
  await page.goto('/dashboard?sharing=shared-with-me&offset=50');
  await expect(page.locator('.paging')).toContainText('Displaying 0–0 of 20');
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Previous',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.paging')).toContainText('Displaying 1–1 of 20');
});

for (const outcome of ['lost connection', 'malformed success', 'server error']) {
  test(`an uncertain metadata create (${outcome}) cannot be repeated`, async ({page, api}) => {
    let writes = 0;
    await page.route('**/api/resource/template-instances?**', route => {
      writes++;
      if (outcome === 'lost connection') return route.abort('failed');
      if (outcome === 'malformed success') return route.fulfill({status: 201, contentType: 'application/json', body: '{broken'});
      return route.fulfill({status: 503, json: {message: 'No acknowledgement'}});
    });
    await page.goto('/instances/create/template');
    const name = page.getByLabel('Instance name', {exact: true});
    await name.fill('Draft to retain');
    const save = page.getByRole('button', {name: 'Save', exact: true});
    await save.click();
    await expect(save).toBeDisabled();
    await expect(page.locator('.metadata-save-status')).toHaveText('Reload required');
    await expect(page.getByRole('alert')).toContainText('Workspace');
    await expect(page.getByRole('button', {name: 'Reload metadata', exact: true})).toHaveCount(0);
    await name.fill('Still my draft');
    await expect(save).toBeDisabled();
    expect(writes).toBe(1);
  });
}

for (const writable of [true, false]) {
  test(`metadata recovery replaces CEE contents and applies writable=${writable}`, async ({page, api}) => {
    let recovering = false;
    await page.route('**/api/resource/template-instances/instance', route => {
      if (route.request().method() === 'PUT') return route.fulfill({status: 412, json: {message: 'Changed'}});
      return route.fulfill({json: {'@id': 'instance', 'schema:isBasedOn': 'template', 'schema:name': recovering ? 'Server revision' : 'Original', Value: {'@value': recovering ? 'new' : 'old'}}, headers: {ETag: recovering ? '"new"' : '"old"'}});
    });
    await page.route('**/api/resource/template-instances/instance/report', route => route.fulfill({json: {currentUserPermissions: {capabilities: !recovering || writable ? ['updateResource'] : []}}}));
    await page.goto('/instances/edit/instance');
    const name = page.getByLabel('Instance name', {exact: true});
    await name.fill('Draft');
    await page.evaluate(() => { window.previousEditor = document.querySelector('cedar-embeddable-editor'); });
    await page.getByRole('button', {name: 'Save', exact: true}).click();
    await page.getByRole('button', {name: 'Reload metadata', exact: true}).click();
    recovering = true;
    await page.locator('.confirmation-dialog').getByRole('button', {name: 'OK', exact: true}).click();
    await expect(name).toHaveValue('Server revision');
    expect(await page.evaluate(() => {
      const editor = document.querySelector('cedar-embeddable-editor');
      return {recreated: editor !== window.previousEditor, oldDisconnected: !window.previousEditor.isConnected, value: editor.currentMetadata.Value['@value'], readOnly: editor.config.readOnlyMode};
    })).toEqual({recreated: true, oldDisconnected: true, value: 'new', readOnly: !writable});
    if (writable) await expect(name).toBeEditable(); else await expect(name).not.toBeEditable();
  });
}

test('a description conflict requires Retry and keeps the draft on the new revision', async ({page, api}) => {
  let revision = '"old"', written;
  await page.route('**/api/resource/templates/template', route => route.fulfill({json: {...resource, 'schema:description': revision === '"old"' ? 'Original' : 'Changed elsewhere'}, headers: {ETag: revision}}));
  await page.route('**/api/resource/command/rename-resource', route => {
    written = route.request().headers()['if-match'];
    return revision === '"old"' ? route.fulfill({status: 412, json: {message: 'Changed'}}) : route.fulfill({json: resource, headers: {ETag: '"saved"'}});
  });
  await page.goto('/dashboard');
  await page.locator('.explorer-item[data-resource-id="template"]').click();
  const description = page.getByRole('textbox', {name: 'Description', exact: true});
  await description.fill('My draft');
  const save = page.getByRole('button', {name: 'Save', exact: true});
  await save.click();
  await expect(save).toBeDisabled();
  revision = '"new"';
  await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(description).toHaveValue('My draft');
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => written).toBe('"new"');
});
