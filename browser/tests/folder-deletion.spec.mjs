import { test, expect } from './fixtures.mjs';
import { deletionPlan, deletionOwnerRefusal, openFolderDeletion } from './folder-deletion-fixture.mjs';

test('recursive delete inventories every type and sends only the confirmed token after explicit confirmation', async ({page, api}) => {
  let submitted = null;
  const dialog = await openFolderDeletion(page, deletionPlan, route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({json: {status: 'completed', deleted: deletionPlan.counts, remaining: 0, message: 'Deletion completed.'}});
  });
  await expect(dialog.getByText('All instances of these templates are inside this folder and will be deleted first.')).toBeVisible();
  const counts = dialog.locator('.deletion-counts li');
  await expect(counts).toHaveText(['Templates: 1', 'Elements: 1', 'Fields: 1', 'Instances: 2', 'Templates with instances: 1', 'Subfolders: 1']);
  await expect(counts.locator('strong')).toHaveText(['Templates', 'Elements', 'Fields', 'Instances', 'Templates with instances', 'Subfolders']);
  const lines = await counts.evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
  expect(new Set(lines).size).toBe(6);
  await expect(dialog).not.toContainText('Folder count includes');
  await expect(dialog.locator('.inventory-explanation')).toContainText('All instances of these templates are inside this folder and will be deleted first.');
  expect(submitted).toBeNull();
  const inventory = dialog.getByText('View complete inventory', {exact: true});
  await inventory.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(dialog.locator('.deletion-inventory')).toBeFocused();
  await expect(dialog.locator('tbody tr')).toHaveCount(7);
  await expect(dialog.getByText('Record two', {exact: true})).toBeVisible();
  await dialog.getByRole('button', {name: 'Delete folder and contents', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  expect(submitted).toEqual({token: deletionPlan.token});
});
test('an empty folder has zero subfolders and no inventory explanation', async ({page, api}) => {
  const plan = structuredClone(deletionPlan);
  plan.counts = {folder: 1, template: 0, element: 0, field: 0, instance: 0};
  plan.items = [plan.items[0]];
  plan.templatesWithInstances = 0;
  const dialog = await openFolderDeletion(page, plan);
  await expect(dialog.locator('.deletion-counts li').last()).toHaveText('Subfolders: 0');
  await expect(dialog.locator('.inventory-explanation')).toHaveCount(0);
});
for (const blocker of ['permission', 'references']) {
  test(`recursive delete refuses ${blocker} blockers without issuing a deletion`, async ({page, api}) => {
    const plan = structuredClone(deletionPlan); plan.allowed = false;
    if (blocker === 'permission') { plan.restrictedItems = 1; Object.assign(plan.items[4], {id: null, name: null, deletable: false}); }
    else { plan.templatesWithOutsideInstances = 1; plan.instancesOutside = 3; plan.items[2].instancesOutside = 3; }
    const dialog = await openFolderDeletion(page, plan);
    await expect(dialog.getByRole('button', {name: 'Delete folder and contents', exact: true})).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText(blocker === 'permission' ? 'Items without delete permission: 1' : 'Templates with outside instances: 1 (3 instances)');
    await dialog.getByText('View complete inventory', {exact: true}).click();
    if (blocker === 'permission') await expect(dialog.getByText('Restricted item', {exact: true})).toBeVisible();
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(dialog).not.toBeVisible();
  });
}
test('stale confirmation requires a refreshed inventory and never retries automatically', async ({page, api}) => {
  let attempts = 0;
  const dialog = await openFolderDeletion(page, deletionPlan, route => {
    attempts++;
    return route.fulfill({status: 409, json: {message: 'The folder changed. Review a new inventory before deleting.'}});
  });
  await dialog.getByRole('button', {name: 'Delete folder and contents', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('The folder changed');
  await expect(dialog.getByRole('button', {name: 'Delete folder and contents', exact: true})).toBeDisabled();
  expect(attempts).toBe(1);
  await dialog.getByRole('button', {name: 'Refresh inventory'}).click();
  await expect(dialog.getByRole('button', {name: 'Delete folder and contents', exact: true})).toBeEnabled();
  expect(attempts).toBe(1);
});
test('partial completion reports confirmed deletions and requires a new inventory', async ({page, api}) => {
  const dialog = await openFolderDeletion(page, deletionPlan, route => route.fulfill({json: {
    status: 'stopped', code: 'FOLDER_DELETE_ARTIFACT_REFUSED', deleted: {...deletionPlan.counts, folder: 0, template: 0, element: 0, field: 0}, remaining: 5, message: 'A template acquired an outside instance.',
  }}));
  await dialog.getByRole('button', {name: 'Delete folder and contents', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Deletion stopped');
  await expect(dialog.getByText('Confirmed deletions so far')).toBeVisible();
  await expect(dialog.getByRole('button', {name: 'Delete folder and contents', exact: true})).toBeDisabled();
});
for (const width of [1440, 375]) {
  test(`recursive delete confirmation layout at ${width}`, async ({page, api}) => {
    await page.setViewportSize({width, height: 1000});
    const dialog = await openFolderDeletion(page);
    await dialog.getByText('View complete inventory', {exact: true}).click();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await expect(dialog.getByRole('button', {name: 'Delete folder and contents', exact: true})).toBeInViewport();
    if (process.env.WORKSPACE_VISUAL)
      await expect(dialog).toHaveScreenshot(`recursive-delete-${width}.png`);
  });
}

test('a non-owner receives a clear refusal with no deletion action available', async ({page, api}) => {
  const dialog = await openFolderDeletion(page, deletionOwnerRefusal);
  await expect(dialog.getByRole('button', {name: 'Delete folder and contents', exact: true})).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveText('Only the owner of this folder can delete it and its contents.');
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(dialog).not.toBeVisible();
});
test('ownership lost after review invalidates the confirmation with the specific refusal', async ({page, api}) => {
  const dialog = await openFolderDeletion(page, deletionPlan, route => route.fulfill({status: 403, json: deletionOwnerRefusal}));
  await dialog.getByRole('button', {name: 'Delete folder and contents', exact: true}).click();
  await expect(dialog.getByRole('alert')).toHaveText(deletionOwnerRefusal.message);
  await expect(dialog.getByRole('button', {name: 'Delete folder and contents', exact: true})).toBeDisabled();
});


test('deletion inventory shares Workspace row density while allowing wrapped content', async ({page, api}) => {
  const plan = structuredClone(deletionPlan);
  plan.items[1].name = 'Nested folder with a long descriptive name that must wrap without clipping its contents or hiding the deletion check';
  const dialog = await openFolderDeletion(page, plan);
  await dialog.getByRole('button', {name:'Cancel', exact:true}).click();
  await page.getByRole('button', {name:'List view', exact:true}).click();
  await expect(page.locator('.explorer-grid')).toHaveCount(0);
  const reference = page.locator('.workspace tbody tr').first();
  const referenceHeight = (await reference.boundingBox()).height;
  const referencePadding = await reference.locator('td').first().evaluate(el => getComputedStyle(el).paddingBlock);
  await page.getByRole('button', {name:'Actions for Study folder', exact:true}).click();
  await page.locator('.resource-menu').getByRole('button', {name:'Delete', exact:true}).click();
  await dialog.getByText('View complete inventory', {exact:true}).click();
  const rows = dialog.locator('tbody tr');
  expect(Math.abs((await rows.first().boundingBox()).height - referenceHeight)).toBeLessThanOrEqual(0.5);
  expect(await rows.first().locator('td').first().evaluate(el => getComputedStyle(el).paddingBlock)).toBe(referencePadding);
  await expect(rows.nth(1)).toContainText(plan.items[1].name);
  expect((await rows.nth(1).boundingBox()).height).toBeGreaterThan(referenceHeight);
  await expect(rows.nth(1).locator('td').last()).toHaveText('Eligible');
});

test('pending deletion keeps the dialog and action positions steady', async ({page, api}) => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const dialog = await openFolderDeletion(page, deletionPlan, async route => {
    await response;
    return route.fulfill({json: {status: 'completed', deleted: deletionPlan.counts, remaining: 0}});
  });
  const remove = dialog.getByRole('button', {name: 'Delete folder and contents', exact: true});
  const refresh = dialog.getByRole('button', {name: 'Refresh inventory', exact: true});
  const before = await dialog.boundingBox();
  const buttonBefore = await remove.boundingBox();
  await remove.click();
  await expect(remove).toBeDisabled();
  await expect(refresh).toBeVisible();
  await expect(refresh).toBeDisabled();
  expect(await dialog.boundingBox()).toEqual(before);
  expect(await remove.boundingBox()).toEqual(buttonBefore);
  await expect(dialog.getByRole('list', {name: 'Inventory by resource type'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  finish();
  await expect(dialog).not.toBeVisible();
});

for (const corruption of ["count", "duplicate", "cycle", "hidden-blocker", "string-allowed"]) {
  test(`malformed ${corruption} inventory disables deletion and recovers after refresh`, async ({ page, api }) => {
    const plan = structuredClone(deletionPlan);
    const dialog = await openFolderDeletion(page, plan);
    if (corruption === "count") plan.counts.instance = 99;
    if (corruption === "duplicate") plan.items[1].id = plan.items[0].id;
    if (corruption === "cycle") plan.items[1].parentId = plan.items[1].id;
    if (corruption === "hidden-blocker") { plan.items[1].deletable = false; plan.restrictedItems = 1; }
    if (corruption === "string-allowed") plan.allowed = "true";
    await dialog.getByRole("button", { name: "Refresh inventory", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("complete inventory");
    await expect(dialog.getByRole("button", { name: "Delete folder and contents", exact: true })).toBeDisabled();
    Object.assign(plan, structuredClone(deletionPlan));
    await dialog.getByRole("button", { name: "Refresh inventory", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Delete folder and contents", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });
}
for (const outcome of [{}, { status: "completed", deleted: { ...deletionPlan.counts, instance: 0 }, remaining: 0 }, { status: "stopped", deleted: deletionPlan.counts, remaining: -1 }]) {
  test(`invalid deletion outcome ${JSON.stringify(outcome)} never closes as success or repeats the request`, async ({ page, api }) => {
    let attempts = 0;
    const dialog = await openFolderDeletion(page, deletionPlan, route => { attempts++; return route.fulfill({ json: outcome }); });
    const remove = dialog.getByRole("button", { name: "Delete folder and contents", exact: true });
    await remove.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText("may already have been deleted");
    await expect(remove).toBeDisabled(); expect(attempts).toBe(1);
    await dialog.getByRole("button", { name: "Refresh inventory", exact: true }).click();
    await expect(remove).toBeEnabled(); expect(attempts).toBe(1);
  });
}

for (const rootDepth of [3, 12]) {
  test(`a folder at absolute depth ${rootDepth} retains its relative inventory and can be confirmed`, async ({ page, api }) => {
    const plan = structuredClone(deletionPlan);
    plan.items.forEach(item => item.depth += rootDepth);
    let attempts = 0;
    const dialog = await openFolderDeletion(page, plan, route => {
      attempts++; return route.fulfill({ json: { status: "completed", deleted: plan.counts, remaining: 0 } });
    });
    await dialog.getByRole("button", { name: "Delete folder and contents", exact: true }).click();
    await expect(dialog).not.toBeVisible(); expect(attempts).toBe(1);
  });
}
