import { resource, expect } from './fixtures.mjs';
import { deletionPlan } from './folder-deletion-fixture.mjs';
export const selectionResources = [
  {...resource, '@id':'folder', resourceType:'folder', 'schema:name':'Study folder'},
  {...resource, '@id':'nested', resourceType:'folder', 'schema:name':'Study records'},
  {...resource, '@id':'instance1', resourceType:'instance', 'schema:name':'Record one'},
  {...resource, '@id':'separate', resourceType:'instance', 'schema:name':'Separate record'},
];
export async function selectionFixture(page, {plan = deletionPlan, failAt, denied = false} = {}) {
  const writes = [], deleted = new Set();
  await page.route('**/api/resource/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if(req.method() !== 'GET') {
      writes.push({path, method:req.method(), body:req.postDataJSON(), etag:req.headers()['if-match']});
      if(writes.length === failAt) return route.fulfill({status:409,json:{message:'Changed'}});
      if(path.endsWith('/deletion')) {plan.items.forEach(i => deleted.add(i.id));return route.fulfill({json:{status:'completed',deleted:plan.counts,remaining:0}});}
      deleted.add(path.split('/').at(-1));return route.fulfill({status:204});
    }
    if(path.includes('/contents')) return route.fulfill({json:{resources:selectionResources.filter(r => !deleted.has(r['@id'])),totalCount:selectionResources.filter(r => !deleted.has(r['@id'])).length,pathInfo:[]}});
    if(path.endsWith('/folder/deletion')) return route.fulfill({json:plan});
    if(path.endsWith('/nested/deletion')) return route.fulfill({json:{...plan,items:plan.items.filter(i => ['nested','instance1','instance2'].includes(i.id)),counts:{folder:1,template:0,element:0,field:0,instance:2}}});
    const r = selectionResources.find(r => path.split('/').includes(r['@id']));
    if(!r) return route.fallback();
    return route.fulfill({json:denied && path.includes('/separate/report') ? {...r,currentUserPermissions:{capabilities:[]}} : r,headers:{ETag:'"content-7"'}});
  });
  await page.goto('/dashboard');
  await expect(page.locator('.explorer-item')).toHaveCount(4);
  return writes;
}
export async function selectDeletion(page, ids = ['folder','nested','instance1','separate']) {
  for(const [index,id] of ids.entries()) await page.locator(`[data-resource-id="${id}"] .resource-icon`).click({modifiers:index ? ['ControlOrMeta'] : []});
  const action = page.getByRole('button',{name:`Delete (${ids.length})`,exact:true});
  await action.click();
  const dialog = page.getByRole('dialog');
  if(ids.some(id => selectionResources.find(r => r['@id']===id)?.resourceType==='folder'))
    await expect(dialog.getByRole('list',{name:'Inventory by resource type'})).toBeVisible();
  else await expect(dialog.getByRole('button',{name:'Delete',exact:true})).toBeEnabled();
  return dialog;
}
