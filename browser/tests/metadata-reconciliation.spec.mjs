import {test,expect,capabilities,resource} from './fixtures.mjs';
test('create, review, save again and reopen without a false description difference', async ({page,api}) => {
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
  const review=page.getByRole('button',{name:'Review latest saved version',exact:true});
  await save.click();
  await expect(page.locator('.metadata-save-status')).toHaveText('Saved');
  expect(stored['schema:description']).toBe(resource['schema:description']);
  await review.click();
  await expect(page.getByRole('button',{name:'Apply reviewed changes',exact:true})).toBeVisible();
  await expect(page.locator('main section table tbody tr')).toHaveCount(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
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
  await review.click();
  await expect(page.getByRole('button',{name:'Apply reviewed changes',exact:true})).toBeVisible();
  await expect(page.locator('main section table tbody tr')).toHaveCount(0);
});
test('review a conflicting name and save the chosen value against the reviewed revision',async({page,api})=>{
  let latest='Original name',revision='"opened"';const writes=[];
  await page.route('**/api/resource/template-instances/instance',route=>{
    if(route.request().method()==='PUT'){
      writes.push({body:route.request().postDataJSON(),etag:route.request().headers()['if-match']});
      return route.fulfill({json:{'@id':'instance'},headers:{ETag:'"saved"'}});
    }
    return route.fulfill({json:{'@id':'instance','schema:name':latest,'schema:isBasedOn':'template'},headers:{ETag:revision}});
  });
  await page.goto('/instances/edit/instance');
  await page.getByLabel('Instance name',{exact:true}).fill('My chosen name');
  latest='Another author name';revision='"latest"';
  await page.getByRole('button',{name:'Review latest saved version',exact:true}).click();
  const apply=page.getByRole('button',{name:'Apply reviewed changes',exact:true});
  await expect(apply).toBeDisabled();await expect(page.getByRole('cell',{name:'Another author name'})).toBeVisible();
  await page.getByLabel('Keep my value',{exact:true}).check();await apply.click();
  expect(writes).toHaveLength(0);await expect(page.getByLabel('Instance name',{exact:true})).toHaveValue('My chosen name');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.metadata-save-status')).toHaveText('Saved');
  expect(writes).toHaveLength(1);expect(writes[0].etag).toBe('"latest"');expect(writes[0].body['schema:name']).toBe('My chosen name');
});
