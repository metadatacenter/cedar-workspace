import {test,expect,capabilities,resource} from './fixtures.mjs';

test('a stale save retains the draft through reload and never overwrites the latest version', async ({page,api}) => {
  let stored={'@id':'instance','schema:name':'Original name','schema:isBasedOn':'template'};
  let revision='"opened"';
  const writes=[];
  await page.route('**/api/resource/template-instances/instance',route=>{
    if(route.request().method()==='PUT') {
      writes.push({body:route.request().postDataJSON(),etag:route.request().headers()['if-match']});
      return route.fulfill({status:412,json:{message:'Changed by another author'}});
    }
    return route.fulfill({json:stored,headers:{ETag:revision}});
  });
  await page.goto('/instances/edit/instance');
  const name=page.getByLabel('Instance name',{exact:true});
  const save=page.getByRole('button',{name:'Save',exact:true});
  const noComparison=async()=>{
    await expect(page.getByRole('button',{name:'Review latest saved version',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Apply reviewed changes',exact:true})).toHaveCount(0);
    await expect(page.locator('main table')).toHaveCount(0);
  };
  await expect(name).toHaveValue('Original name');
  await noComparison();
  await name.fill('My retained draft');
  await noComparison();
  stored={...stored,'schema:name':'Another author name'};revision='"latest"';
  await save.click();
  await expect(save).toBeDisabled();
  await expect(name).toHaveValue('My retained draft');
  await expect(page.getByRole('alert')).toContainText('This item changed since you opened it.');
  expect(writes).toHaveLength(1);expect(writes[0].etag).toBe('"opened"');
  await noComparison();

  page.on('dialog',dialog=>dialog.accept());
  await page.reload();
  await expect(name).toHaveValue('Another author name');
  await page.getByRole('button',{name:'Restore draft',exact:true}).click();
  await expect(name).toHaveValue('My retained draft');
  await expect(save).toBeDisabled();
  await name.fill('More work on the retained draft');
  await expect(save).toBeDisabled();
  await noComparison();

  const reload=page.getByRole('button',{name:'Reload metadata',exact:true});
  const confirmation=page.locator('dialog.confirmation-dialog');
  await reload.click();
  await expect(confirmation).toContainText('Discard unsaved metadata changes?');
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(name).toHaveValue('More work on the retained draft');
  await expect(save).toBeDisabled();
  await reload.click();
  await confirmation.getByRole('button',{name:'Yes',exact:true}).click();
  await expect(name).toHaveValue('Another author name');
  await expect(page.locator('.metadata-save-status')).toHaveText('Unmodified');
  await expect(page.getByRole('button',{name:'Restore draft',exact:true})).toHaveCount(0);
  await noComparison();
  expect(writes).toHaveLength(1);
});

test('create, save again and reopen with the saved description', async ({page,api}) => {
  let stored;
  const writes=[];
  await page.route('**/api/resource/template-instances**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/report'))
      return route.fulfill({json:{currentUserPermissions:{capabilities}},headers:{ETag:'"report"'}});
    if (['POST','PUT'].includes(route.request().method())) {
      stored={...route.request().postDataJSON(),'@id':'instance'};
      writes.push(structuredClone(stored));
      return route.fulfill({json:{'@id':stored['@id']},headers:{ETag:'"saved"'}});
    }
    return route.fulfill({json:stored,headers:{ETag:'"saved"'}});
  });
  await page.goto('/instances/create/template?folderId=home');
  await page.getByLabel('Instance name',{exact:true}).fill('Description round trip');
  const save=page.getByRole('button',{name:'Save',exact:true});
  await save.click();
  await expect(page.locator('.metadata-save-status')).toHaveText('Saved');
  expect(stored['schema:description']).toBe(resource['schema:description']);
  await expect(page.getByRole('button',{name:'Review latest saved version',exact:true})).toHaveCount(0);
  // Make a real edit so the previous save's status cannot satisfy this save's wait.
  await page.getByLabel('Instance name',{exact:true}).fill('Description round trip updated');
  await expect(page.locator('.metadata-save-status')).toHaveText('Modified');
  await save.click();
  await expect(page.locator('.metadata-save-status')).toHaveText('Saved');
  expect(writes).toHaveLength(2);
  expect(writes[1]['schema:description']).toBe(resource['schema:description']);
  await page.reload();
  await expect(page.getByLabel('Instance name',{exact:true})).toHaveValue('Description round trip updated');
  await expect(page.locator('.metadata-save-status')).toHaveText('Unmodified');
  await expect(page.getByRole('button',{name:'Restore draft',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Review latest saved version',exact:true})).toHaveCount(0);
});
