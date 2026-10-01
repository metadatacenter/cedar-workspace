import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.mjs';
import { deletionPlan } from './folder-deletion-fixture.mjs';
import { selectionFixture, selectDeletion, selectionResources } from './selection-deletion-fixture.mjs';
for(const grid of [true,false]) test(`selection delete reviews nested folders and artifacts once in ${grid?'grid':'list'}`,async({page,api})=>{
  const writes=await selectionFixture(page);
  await expect(page.getByRole('button',{name:/^Delete \(/})).toHaveCount(0);
  if(!grid) await page.getByRole('button',{name:'List view',exact:true}).click();
  const dialog=await selectDeletion(page);
  await expect(dialog).toHaveAccessibleName('Delete selected items (4)?');
  await expect(dialog.getByRole('list',{name:'Selected items'})).toContainText('Study folder');
  await expect(dialog).toContainText('Total items to delete: 8.');
  await expect(dialog).toContainText('This cannot be undone');
  await dialog.getByText('View complete inventory',{exact:true}).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(8);
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button',{name:'Delete selected items and contents',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(writes).toEqual([
    {path:'/api/resource/folders/folder/deletion',method:'POST',body:{token:deletionPlan.token},etag:undefined},
    {path:'/api/resource/template-instances/separate',method:'DELETE',body:null,etag:'"content-7"'},
  ]);
  await expect(page.getByRole('button',{name:/^Delete \(/})).toHaveCount(0);
});
test('cancellation returns keyboard focus without changing selection or sending deletes',async({page,api})=>{
  const writes=await selectionFixture(page);const dialog=await selectDeletion(page);
  await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await expect(page.getByRole('button',{name:'Delete (4)',exact:true})).toBeFocused();
  expect(writes).toHaveLength(0);
});
test('permission refusal disables the complete selection, with accessible explanation',async({page,api})=>{
  const writes=await selectionFixture(page,{denied:true});const dialog=await selectDeletion(page,['folder','separate']);
  await expect(dialog.getByRole('button',{name:'Delete selected items and contents'})).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('Items without delete permission: 1');
  expect(writes).toHaveLength(0);
});
test('a failure after deleting a folder reports its confirmed contents and does not retry',async({page,api})=>{
  const writes=await selectionFixture(page,{failAt:2});const dialog=await selectDeletion(page,['folder','separate']);
  await dialog.getByRole('button',{name:'Delete selected items and contents'}).click();
  await expect(dialog).toContainText('Confirmed deletions so far');
  await expect(dialog).toContainText('Some items may already have been deleted');
  await expect(dialog.getByRole('button',{name:'Delete selected items and contents'})).toBeDisabled();
  expect(writes).toHaveLength(2);
  await dialog.getByRole('button',{name:'Refresh inventory'}).click();
  await expect(dialog).toContainText('Total items to delete: 1.');
  expect(writes).toHaveLength(2);
});
for(const width of [1440,375]) test(`selection confirmation layout, central styling and accessibility at ${width}`,async({page,api})=>{
  await page.setViewportSize({width,height:1000});await selectionFixture(page);const dialog=await selectDeletion(page);
  await dialog.getByText('View complete inventory',{exact:true}).click();
  const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  await expect(dialog.getByRole('button',{name:'Delete selected items and contents'})).toBeInViewport();
  expect((await new AxeBuilder({page}).include('cedar-folder-deletion-dialog').analyze()).violations).toEqual([]);
  const color=await dialog.locator('.destructive-action').evaluate(el=>{
    const probe=document.createElement('span');probe.style.color='var(--cedar-text-destructive)';el.append(probe);
    const colors={actual:getComputedStyle(el).color,expected:getComputedStyle(probe).color};probe.remove();return colors;
  });
  expect(color.actual).toBe(color.expected);
  if(width===375) {
    const inventory=dialog.locator('.deletion-inventory');
    await inventory.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
    await expect(inventory.locator('tbody tr').first().locator('td').last()).toBeInViewport();
    await inventory.evaluate(el=>{el.scrollLeft=0;});
  }
  if(process.env.WORKSPACE_VISUAL) await expect(dialog).toHaveScreenshot(`selection-delete-${width}.png`);
});

test('individual records share one confirmation and retain content revision guards',async({page,api})=>{
  const writes=await selectionFixture(page);const dialog=await selectDeletion(page,['instance1','separate']);
  await expect(dialog).toContainText('Do you want to delete these 2 items?');
  await expect(dialog.locator('details, .deletion-counts')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Refresh inventory'})).toHaveCount(0);
  await expect(dialog).not.toContainText('folder');
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(writes.map(w=>w.method)).toEqual(['DELETE','DELETE']);
  expect(writes.every(w=>w.etag==='"content-7"')).toBe(true);
});

for(const width of [1440,375]) test(`item-only deletion is a simple confirmation at ${width}`,async({page,api})=>{
  await page.setViewportSize({width,height:1000});
  const writes=await selectionFixture(page);const dialog=await selectDeletion(page,['instance1','separate']);
  await expect(dialog).toHaveAccessibleName('Delete');
  await expect(dialog.getByText('Do you want to delete these 2 items?',{exact:true})).toBeVisible();
  await expect(dialog.locator('details, .deletion-counts')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Refresh inventory'})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  expect((await dialog.boundingBox()).height).toBeLessThan(250);
  expect((await new AxeBuilder({page}).include('cedar-folder-deletion-dialog').analyze()).violations).toEqual([]);
  if(process.env.WORKSPACE_VISUAL) await expect(dialog).toHaveScreenshot(`simple-delete-${width}.png`);
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(0);
});

test('simple item confirmation still refuses missing delete permission',async({page,api})=>{
  const writes=await selectionFixture(page,{denied:true});
  await page.locator('[data-resource-id="separate"] .resource-icon').click();
  await page.getByRole('button',{name:'Delete (1)',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Items without delete permission: 1');
  await expect(dialog.getByRole('button',{name:'Delete',exact:true})).toBeDisabled();
  await expect(dialog.locator('details, .deletion-counts')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(writes).toHaveLength(0);
});

async function dragToBin(page, sourceId, selectedIds = []) {
  for (const [index,id] of selectedIds.entries()) {
    await page.locator(`[data-resource-id="${id}"] .resource-icon`).click({modifiers:index ? ['ControlOrMeta'] : []});
  }
  const row=page.locator(`[data-resource-id="${sourceId}"]`);
  const source=await row.locator('.resource-icon').boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(source.x+source.width/2+10,source.y+source.height/2+10,{steps:3});
  await expect(page.locator('body')).toHaveClass(/explorer-dragging/);
  const bin=page.locator('.selection-delete');
  await expect(bin).toHaveText('');
  await expect(bin.locator('cedar-icon[name="delete"]')).toBeVisible();
  await expect(page.locator('cedar-drag-preview .destination')).toHaveText('Drag onto a folder or the trash icon');
  await expect(page.locator('cedar-drag-preview .destination cedar-icon')).toHaveCount(0);
  await expect(bin).toHaveClass(/explorer-drop-eligible/);
  const destination=await bin.boundingBox();
  await page.mouse.move(destination.x+destination.width/2,destination.y+destination.height/2,{steps:12});
  await expect(bin).toHaveClass(/explorer-delete-target/);
  await expect(page.locator('cedar-drag-preview')).toContainText('Drop to confirm deletion');
  await expect(page.locator('body')).toHaveClass(/explorer-can-drop/);
}
for (const grid of [true,false]) {
  for(const kind of ['single','multiple','folders']) test(`dropping ${kind} on the bin opens the usual confirmation in ${grid?'grid':'list'}`,async({page,api})=>{
    const writes=await selectionFixture(page);
    if(!grid) await page.getByRole('button',{name:'List view',exact:true}).click();
    const ids=kind==='single' ? [] : kind==='multiple' ? ['instance1','separate'] : ['folder','separate'];
    await dragToBin(page,kind==='folders' ? 'folder':'instance1',ids);
    if(process.env.WORKSPACE_VISUAL && grid && kind==='folders') await expect(page).toHaveScreenshot('bin-drop.png');
    expect(writes).toHaveLength(0);
    await page.mouse.up();
    const dialog=page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/explorer-dragging/);
    const confirm=dialog.getByRole('button',{name:kind==='folders'?'Delete selected items and contents':'Delete',exact:true});
    await expect(confirm).toBeEnabled();
    if(kind==='folders') await expect(dialog).toContainText('Total items to delete: 8.');
    else await expect(dialog).toContainText(`Do you want to delete these ${kind==='single'?1:2} items?`);
    expect(writes).toHaveLength(0);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.locator('.selection-delete')).toBeFocused();
    expect(writes).toHaveLength(0);
    // The same selection remains available; clicking the bin follows the same path.
    await page.locator('.selection-delete').click();
    await expect(confirm).toBeEnabled();
    await confirm.click();await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(kind==='single'?1:2);
    expect(writes.some(w=>w.path.includes('move-resource'))).toBe(false);
  });
}
test('leaving the bin before releasing cancels the deletion drop',async({page,api})=>{
  const writes=await selectionFixture(page);await dragToBin(page,'instance1');
  await page.mouse.move(20,600,{steps:10});
  await expect(page.locator('.selection-delete')).not.toHaveClass(/explorer-delete-target/);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
test('a bin drop checks fresh delete permission before enabling confirmation',async({page,api})=>{
  const writes=await selectionFixture(page,{denied:true});
  await dragToBin(page,'separate');await page.mouse.up();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Items without delete permission: 1');
  await expect(dialog.getByRole('button',{name:'Delete',exact:true})).toBeDisabled();
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
});
test('items with delete permission but no move permission can be dragged to the bin',async({page,api})=>{
  const writes=await selectionFixture(page);
  const deletable={...selectionResources[2],currentUserPermissions:{capabilities:['readResource','deleteResource']}};
  await page.route('**/api/resource/folders/home/contents?*',route=>route.fulfill({json:{resources:[deletable],totalCount:1,pathInfo:[]}}));
  await page.route('**/api/resource/template-instances/instance1/report',route=>route.fulfill({json:deletable}));
  await page.reload();
  await expect(page.locator('.explorer-item')).toHaveCount(1);
  await dragToBin(page,'instance1');await page.mouse.up();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'Delete',exact:true})).toBeEnabled();
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(dialog).toBeHidden();expect(writes).toHaveLength(1);
});
