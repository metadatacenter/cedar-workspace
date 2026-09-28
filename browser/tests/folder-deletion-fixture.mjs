import { resource, expect } from './fixtures.mjs';
export const deletionOwnerRefusal = {code: "FOLDER_DELETE_NOT_OWNER", message: "Only the owner of this folder can delete it and its contents."};
export const deletionPlan = {
  token: 'a'.repeat(64), allowed: true,
  counts: {folder: 2, template: 1, element: 1, field: 1, instance: 2},
  restrictedItems: 0, protectedFolders: 0, templatesWithInstances: 1, templatesWithOutsideInstances: 0, instancesOutside: 0,
  items: [
    {id: 'folder', name: 'Study folder', type: 'folder', parentId: null, depth: 0},
    {id: 'nested', name: 'Study records', type: 'folder', parentId: 'folder', depth: 1},
    {id: 'template', name: 'Study template', type: 'template', parentId: 'folder', depth: 1, instancesInside: 2},
    {id: 'element', name: 'Participant', type: 'element', parentId: 'folder', depth: 1},
    {id: 'field', name: 'Study identifier', type: 'field', parentId: 'folder', depth: 1},
    {id: 'instance1', name: 'Record one', type: 'instance', parentId: 'nested', depth: 2},
    {id: 'instance2', name: 'Record two', type: 'instance', parentId: 'nested', depth: 2},
  ].map(item => ({deletable: true, protectedFolder: false, instancesInside: 0, instancesOutside: 0, ...item})),
};
export async function openFolderDeletion(page, plan = deletionPlan, onDelete) {
  await page.route('**/api/resource/folders/home/contents?*', route => route.fulfill({json: {
    resources: [{...resource, '@id': 'folder', resourceType: 'folder', 'schema:name': 'Study folder'}], totalCount: 1, pathInfo: [],
  }}));
  await page.route('**/api/resource/folders/folder', route => route.fulfill({json: {...resource, '@id': 'folder', resourceType: 'folder', 'schema:name': 'Study folder'}}));
  await page.route('**/api/resource/folders/folder/deletion', async route => {
    if (route.request().method() === 'POST') {
      if (onDelete) return onDelete(route);
      throw new Error('Unexpected destructive request');
    }
    return route.fulfill({status: plan.code ? 403 : 200, json: plan});
  });
  await page.goto('/dashboard');
  await page.getByRole('button', {name: 'Actions for Study folder', exact: true}).click();
  await page.locator('.resource-menu').getByRole('button', {name: 'Delete', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Delete folder and contents'});
  if (plan.code) await expect(dialog.getByRole('alert')).toHaveText(deletionOwnerRefusal.message);
  else await expect(dialog.getByText('Folder count includes the selected folder and every subfolder.')).toBeVisible();
  return dialog;
}
