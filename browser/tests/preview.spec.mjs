import { readFile } from 'node:fs/promises';
import { test, expect, resource } from './fixtures.mjs';
const documents = JSON.parse(await readFile(new URL('../fixtures/preview.json', import.meta.url), 'utf8'));
async function setup(page, kind, options = {}) {
  const requests = [];
  // Exercise the actual installed CEE/CEF bundle, including its read-only controls.
  await page.route('**/third_party_components/**', route => route.fulfill({
    path: new URL('../../node_modules/cedar-embeddable-editor/cedar-embeddable-editor.js', import.meta.url).pathname,
    contentType:'text/javascript',
  }));
  const artifact = options.artifact ?? documents[kind];
  const item = {...resource, '@id':'preview-item',resourceType:kind,'schema:name':artifact['schema:name']};
  await page.route('**/api/resource/**', async route => {
    const req = route.request(), path = decodeURIComponent(new URL(req.url()).pathname);
    requests.push({path,method:req.method()});
    if (path.endsWith('/contents')) return route.fulfill({json:{resources:[item,{...resource,'@id':'folder',resourceType:'folder','schema:name':'Folder'}],totalCount:2,pathInfo:[]}});
    if (path.endsWith('/preview-item')) {
      if (options.delay) await options.delay;
      return route.fulfill(options.fail ? {status:403,json:{message:'Forbidden'}} : {json:artifact});
    }
    if (path.includes('/templates/') && kind === 'instance')
      return route.fulfill(options.templateStatus ? {status:options.templateStatus,json:{message:'You do not have the required capability on the artifact'}} : {json:documents.template});
    if (path.includes('/preview-item/')) return route.fulfill({json:item});
    return route.fallback();
  });
  await page.goto('/dashboard');
  await page.getByRole('button',{name:'Grid view',exact:true}).click();
  await expect(page.locator('.explorer-item')).toHaveCount(2);
  await expect(page.getByRole('button',{name:/^Preview /})).toHaveCount(1);
  return {button:page.getByRole('button',{name:'Preview '+item['schema:name'],exact:true}),requests};
}
for (const kind of ['template','element','field','instance']) {
  test(`full-size read-only ${kind} preview uses real CEE/CEF and returns focus`, async ({page,api}) => {
    const {button,requests} = await setup(page,kind);
    const before = page.url();
    await button.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Preview');
    // No schema fetch until explicit activation.
    expect(requests.some(r => r.path.endsWith('/preview-item'))).toBe(false);
    await button.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy','false',{timeout:20000});
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    const viewer = dialog.locator(kind==='field'?'cedar-embeddable-field':'cedar-embeddable-editor');
    await expect(viewer).toBeVisible();
    await expect(dialog.getByRole('heading', {level: 2})).toHaveText(documents[kind]['schema:name']);
    // The title carries the same kind icon as the item behind it in the listing.
    const listed = await page.locator(`.resource-icon[data-type="${kind}"] [data-cedar-icon]`).first().getAttribute('data-cedar-icon');
    await expect(dialog.locator('header h2 .preview-kind [data-cedar-icon]')).toHaveAttribute('data-cedar-icon', listed);
    if (kind === 'field') await expect(viewer.locator('app-cedar-component-header')).toHaveCount(0);
    await expect(viewer.locator('.logo-block')).toHaveCount(0);
    if (kind !== 'field') {
      expect(await viewer.locator('.template-content').evaluate(el => getComputedStyle(el).padding)).toBe('0px');
    }
    if (kind === 'element') {
      await expect(viewer.locator('mat-expansion-panel')).toHaveCount(0);
      const heading = await dialog.locator('header h2').boundingBox();
      const body = await dialog.locator('section').boundingBox();
      expect(heading.y + heading.height).toBeLessThanOrEqual(body.y);
    }
    if (kind==='instance') {
      const text = viewer.getByRole('textbox',{name:'Specimen name',exact:true});
      await expect(text).toHaveJSProperty('readOnly',true);
      await expect(text).toHaveValue('Collected specimen');
      await text.press('x');
      await expect(text).toHaveValue('Collected specimen');
    } else await expect(viewer.locator('.cee-spec-box')).toContainText('80');
    await expect(viewer.locator('input:not([type=hidden]):not([readonly]):not(:disabled),textarea:not([readonly]):not(:disabled),select:not(:disabled),[contenteditable=true]')).toHaveCount(0);
    const metrics = await viewer.evaluate(el => ({transform:getComputedStyle(el).transform, font:getComputedStyle(el.shadowRoot.querySelector('input, .cee-spec-box')).fontSize}));
    expect(metrics.transform).toBe('none');
    expect(parseFloat(metrics.font)).toBeGreaterThanOrEqual(14);
    expect((await dialog.boundingBox()).width).toBeCloseTo(page.viewportSize().width * 0.6, 0);
    expect((await dialog.boundingBox()).height).toBeLessThan(500);
    expect(page.url()).toBe(before);
    expect(requests.every(r=>r.method==='GET')).toBe(true);
    if (await page.getByRole('tooltip').count()) await page.keyboard.press('Escape');
    if (['instance','element'].includes(kind) && process.env.WORKSPACE_VISUAL) await expect(dialog).toHaveScreenshot(`${kind}-preview.png`);
    await dialog.getByRole('button',{name:'Close preview'}).focus();
    if (await page.getByRole('tooltip').count()) {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(page.locator('.explorer-item.selected')).toHaveCount(0);
    await button.click();
    await expect(page.getByRole('dialog').locator('[aria-busy]')).toHaveAttribute('aria-busy','false');
    await page.getByRole('button',{name:'Close preview'}).click();
    await expect(button).toBeFocused();
  });
}
test('a denied preview can be closed and does not offer editing',async ({page,api}) => {
  const {button} = await setup(page,'template',{fail:true});
  await button.click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Close preview'}).click();
  await expect(button).toBeFocused();
});
// An instance can be shared with someone its template is not. Trying again cannot help, so the
// preview says why, rather than that it could not be loaded.
test('an instance preview whose template is not readable says so',async ({page,api}) => {
  const {button} = await setup(page,'instance',{templateStatus:403});
  await button.click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
    "You do not have access to this instance's template, so it cannot be shown.");
});
test('an instance preview whose template fails otherwise asks to try again',async ({page,api}) => {
  const {button} = await setup(page,'instance',{templateStatus:500});
  await button.click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
    'This preview could not be loaded. Close it and try again.');
});
test('closing during a pending preview never mounts the late result',async ({page,api}) => {
  let release;
  const delay = new Promise(resolve=>{release=resolve;});
  const {button} = await setup(page,'template',{delay});
  await button.click();
  const dialog = page.locator('dialog.artifact-preview');
  await expect(dialog).toHaveClass(/is-preparing/);
  await expect(dialog.locator('header')).toBeHidden();
  await expect(dialog.getByRole('status', {includeHidden:true})).toBeVisible();
  await page.getByRole('button',{name:'Close preview'}).click();
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('cedar-embeddable-editor')).toHaveCount(0);
  await expect(button).toBeFocused();
});

for (const kind of ['template', 'element', 'field', 'instance']) {
  test(`${kind} preview reveals its heading and rendered viewer together`, async ({page,api}) => {
    let release;
    const delay = new Promise(resolve => {release = resolve;});
    const {button} = await setup(page, kind, {delay});
    await button.click();
    const dialog = page.locator('dialog.artifact-preview');
    await expect(dialog).toHaveClass(/is-preparing/);
    await expect(dialog.locator('header')).toBeHidden();
    await expect(dialog.getByRole('status', {includeHidden:true})).toBeVisible();
    await expect(dialog.getByRole('button', {name:'Close preview', exact:true})).toBeVisible();
    expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
    await page.evaluate(() => {
      window.previewFrames = [];
      const sample = () => {
        const el = document.querySelector('dialog.artifact-preview');
        if (el && getComputedStyle(el).visibility === 'visible') {
          const viewer = el.querySelector('cedar-embeddable-editor, cedar-embeddable-field');
          const field = viewer?.shadowRoot?.querySelector('input, .cee-spec-box');
          window.previewFrames.push({height:el.getBoundingClientRect().height,
            viewerHeight:viewer?.getBoundingClientRect().height ?? 0,
            fieldHeight:field?.getBoundingClientRect().height ?? 0});
        }
        window.previewFrameId = requestAnimationFrame(sample);
      };
      sample();
    });
    release();
    await expect(dialog.locator('section')).toHaveAttribute('aria-busy', 'false');
    await expect(dialog.getByRole('heading', {level:2})).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.previewFrames.length)).toBeGreaterThan(2);
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.previewFrameId);
      return window.previewFrames;
    });
    expect(frames.every(frame => frame.viewerHeight > 0 && frame.fieldHeight > 0)).toBe(true);
    expect(new Set(frames.map(frame => frame.height)).size).toBe(1);
    await expect(dialog.getByRole('button', {name:'Close preview', exact:true})).toBeFocused();
  });
}

test('preview fits a narrow screen without scaling its fonts', async ({page,api}) => {
  await page.setViewportSize({width:375,height:800});
  const {button} = await setup(page,'instance');
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy','false');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await dialog.locator('section').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(dialog.getByRole('textbox',{name:'Specimen name'})).toHaveCSS('font-size','14px');
  expect((await dialog.boundingBox()).height).toBeLessThan(500);
  if (await page.getByRole('tooltip').count()) await page.keyboard.press('Escape');
  if (process.env.WORKSPACE_VISUAL) await expect(dialog).toHaveScreenshot('instance-preview-mobile.png');
  await page.getByRole('button',{name:'Close preview'}).click();
  await expect(button).toBeFocused();
});

test('list rows offer the same preview without selecting or opening the artifact', async ({page,api}) => {
  await setup(page,'template');
  await page.getByRole('button',{name:'List view',exact:true}).click();
  // Wait for the list button; the grid button has the same accessible name.
  const eyes = page.locator('.row-actions').getByRole('button',{name:/^Preview /});
  await expect(eyes).toHaveCount(1);
  await expect(page.locator('.explorer-item').last().getByRole('button',{name:/^Preview /})).toHaveCount(0);
  await eyes.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy','false');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.locator('cedar-embeddable-editor .cee-spec-box')).toContainText('80');
  await page.getByRole('button',{name:'Close preview'}).click();
  await expect(eyes).toBeFocused();
  await expect(page.locator('.explorer-item.selected')).toHaveCount(0);
});


test('long previews scroll within the viewport while the close button stays visible', async ({page,api}) => {
  const {button} = await setup(page,'template');
  const template = structuredClone(documents.template);
  template._ui.order = [];
  for (let i=0;i<40;i++) {
    const key = 'field'+i;
    template._ui.order.push(key);
    template._ui.propertyLabels[key] = 'Field '+i;
    template.properties[key] = structuredClone(documents.field);
  }
  await page.route('**/api/resource/templates/preview-item', route=>route.fulfill({json:template}));
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy','false');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const body = dialog.locator('section');
  expect(await body.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box.height).toBeLessThan(page.viewportSize().height);
  await body.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect(dialog.getByRole('button',{name:'Close preview'})).toBeInViewport();
  await expect(dialog.locator('cedar-embeddable-editor').getByText('Field 39',{exact:true})).toBeInViewport();
});

for (const [name, type] of [['nihField', 'NIH Grant ID'], ['attributeField', 'Attribute–value pairs']]) {
  test(`CEF owns the complete ${name} preview inside Workspace`, async ({page,api}) => {
    const {button} = await setup(page,'field',{artifact:documents[name]});
    await button.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy','false');
    const field = dialog.locator('cedar-embeddable-field');
    await expect(field.locator('.cee-field-type')).toHaveText(type);
    await expect(field.locator('.cee-field-type [data-field-type-icon]')).toBeVisible();
    await expect(field.locator('.cee-field-spec-description')).toHaveText('A description supplied by the field artifact.');
    await expect(dialog.locator('section > p')).toHaveCount(0);
    if (name === 'nihField') await expect(field.locator('.cee-spec-box')).toBeEmpty();
    expect((await dialog.boundingBox()).height).toBeLessThan(400);
    if (await page.getByRole('tooltip').count()) await page.keyboard.press('Escape');
    if (process.env.WORKSPACE_VISUAL) await expect(dialog).toHaveScreenshot(`${name}-preview.png`);
  });
}


test('element previews retain separators between fields without a trailing rule', async ({page, api}) => {
  const artifact = structuredClone(documents.element);
  artifact.properties.second = structuredClone(artifact.properties.name);
  artifact._ui.order.push('second');
  artifact._ui.propertyLabels.second = 'Second field';
  const {button} = await setup(page, 'element', {artifact});
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  const fields = dialog.locator('.non-iterable-component');
  await expect(fields).toHaveCount(2);
  await expect(fields.first()).toHaveCSS('border-bottom-width', '1px');
  await expect(fields.last()).toHaveCSS('border-bottom-width', '0px');
});

test('moving the preview heading preserves nested element structure', async ({page, api}) => {
  const artifact = structuredClone(documents.element);
  artifact.properties.nested = structuredClone(documents.element);
  artifact._ui.order.push('nested');
  artifact._ui.propertyLabels.nested = 'Nested specimen';
  const {button} = await setup(page, 'element', {artifact});
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  await expect(dialog.locator('header h2')).toHaveText(artifact['schema:name']);
  const nested = dialog.locator('mat-expansion-panel');
  await expect(nested).toHaveCount(1);
  await expect(nested.locator('mat-expansion-panel-header')).toContainText('Nested specimen');
  await expect(nested.locator('.cee-spec-box')).toBeVisible();
  await nested.locator('mat-expansion-panel-header').click();
  await expect(nested.locator('.cee-spec-box')).not.toBeVisible();
});

for (const kind of ['template', 'element', 'field', 'instance']) {
  test(`trying a ${kind} is editable, disposable and never writes an artifact`, async ({page, api}) => {
    const {button, requests} = await setup(page, kind);
    await button.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', {name:'Try out', exact:true}).click();
    await expect(dialog.locator('section')).toHaveAttribute('aria-busy', 'false');
    await expect(dialog.getByRole('status')).toContainText('nothing is saved');
    await expect(dialog.locator('.try-out-notice')).toHaveCSS('text-align', 'center');
    const viewer = dialog.locator(kind === 'field' ? 'cedar-embeddable-field' : 'cedar-embeddable-editor');
    const input = viewer.getByRole('textbox', {name:'Specimen name', exact:true});
    await expect(input).toBeEditable();
    await input.fill('Disposable experiment');
    await expect(input).toHaveValue('Disposable experiment');
    await expect(dialog.getByRole('button', {name:/save|download/i})).toHaveCount(0);
    await dialog.getByRole('button', {name:'Back to preview', exact:true}).click();
    await expect(dialog.locator('section')).toHaveAttribute('aria-busy', 'false');
    if (kind === 'instance') await expect(input).toHaveValue('Collected specimen');
    else await expect(viewer.locator('.cee-spec-box')).toContainText('80');
    await dialog.getByRole('button', {name:'Try out', exact:true}).click();
    await expect(input).toBeEditable();
    await expect(input).not.toHaveValue('Disposable experiment');
    await input.fill('Discard on close');
    await dialog.getByRole('button', {name:'Close preview', exact:true}).click();
    await button.click();
    await dialog.getByRole('button', {name:'Try out', exact:true}).click();
    await expect(input).toBeEditable();
    await expect(input).not.toHaveValue('Discard on close');
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
}
