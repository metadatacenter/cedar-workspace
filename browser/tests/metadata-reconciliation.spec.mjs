import {test,expect} from './fixtures.mjs';
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
