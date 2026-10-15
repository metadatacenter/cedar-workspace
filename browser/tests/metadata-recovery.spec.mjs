import {test,expect} from './fixtures.mjs';
for(const outcome of ['saved','unchanged','conflict','read failed','permission lost','missing revision'])
  test(`metadata save-status check: ${outcome}`,async({page,api})=>{
    const opened={'@id':'instance','schema:name':'Study record','schema:isBasedOn':'template'};
    let submitted,checking=false,writes=0,lastTag;
    await page.route('**/api/resource/template-instances/instance',async route=>{
      if(route.request().method()==='PUT'){
        writes++;lastTag=route.request().headers()['if-match'];submitted=route.request().postDataJSON();
        if(writes===1)return route.abort('failed');
        return route.fulfill({json:{'@id':'instance'},headers:{ETag:'"next"'}});
      }
      if(checking&&outcome==='read failed')return route.abort('failed');
      const data=!checking||outcome==='unchanged'?opened:{...submitted,...(outcome==='conflict'?{'schema:name':'Other author'}:{})};
      return route.fulfill({json:data,headers:checking&&outcome==='missing revision'?{}:{ETag:!checking||outcome==='unchanged'?'"opened"':'"confirmed"'}});
    });
    await page.goto('/instances/edit/instance');
    const name=page.getByLabel('Instance name',{exact:true}),save=page.getByRole('button',{name:'Save',exact:true});
    await name.fill('Submitted');await save.click();
    const check=page.getByRole('button',{name:'Check save status',exact:true});await expect(check).toBeVisible();
    checking=true;
    if(outcome==='permission lost')await page.route('**/api/resource/template-instances/instance/report',route=>route.fulfill({json:{currentUserPermissions:{capabilities:[]}}}));
    await name.fill('Newer input');
    const component=await page.locator('cedar-embeddable-editor').elementHandle();
    await check.click();
    const resolved=['saved','unchanged'].includes(outcome);
    if(resolved){await expect(check).toHaveCount(0);await expect(save).toBeEnabled();}
    else {await expect(page.getByRole('alert')).not.toContainText('Checking save status');await expect(save).toBeDisabled();await expect(check).toBeEnabled();}
    await expect(name).toHaveValue('Newer input');expect(await component.evaluate(el=>el.isConnected)).toBe(true);expect(writes).toBe(1);
    if(resolved){await save.click();await expect(page.locator('.metadata-save-status')).toHaveText('Saved');expect(lastTag).toBe(outcome==='saved'?'"confirmed"':'"opened"');}
  });

test('restored metadata access saves the refused draft without reload',async({page,api})=>{
  let refused=true,writes=0;
  await page.route('**/api/resource/template-instances/instance',route=>{
    if(route.request().method()==='GET')return route.fallback();
    writes++;
    return route.fulfill(refused?{status:403,json:{message:'Access refused'}}:{json:{'@id':'instance'},headers:{ETag:'"saved"'}});
  });
  await page.goto('/instances/edit/instance');
  const name=page.getByLabel('Instance name',{exact:true}),save=page.getByRole('button',{name:'Save',exact:true});
  await name.fill('Refused name');await save.click();
  const check=page.getByRole('button',{name:'Recheck access',exact:true});await expect(check).toBeVisible();
  await expect(page.getByRole('button',{name:'Check save status',exact:true})).toHaveCount(0);
  refused=false;await name.fill('Newer name');await check.click();
  await expect(check).toHaveCount(0);await expect(save).toBeEnabled();await expect(name).toHaveValue('Newer name');
  expect(writes).toBe(1);await save.click();await expect(page.locator('.metadata-save-status')).toHaveText('Saved');expect(writes).toBe(2);
});

test('confirmed metadata update without a revision recovers in place and keeps newer edits',async({page,api})=>{
  let stored={'@id':'instance','schema:name':'Study record','schema:isBasedOn':'template'};
  let writes=0,lastTag;
  await page.route('**/api/resource/template-instances/instance',route=>{
    if(route.request().method()==='PUT'){
      writes++;lastTag=route.request().headers()['if-match'];stored=route.request().postDataJSON();
      return route.fulfill({json:{'@id':'instance'},headers:writes===1?{}:{ETag:'"next"'}});
    }
    return route.fulfill({json:stored,headers:{ETag:writes?'"confirmed"':'"opened"'}});
  });
  await page.goto('/instances/edit/instance');
  const name=page.getByLabel('Instance name',{exact:true}),save=page.getByRole('button',{name:'Save',exact:true});
  await name.fill('Submitted');await save.click();
  const check=page.getByRole('button',{name:'Check save status',exact:true});
  await expect(check).toBeVisible();await expect(save).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Use Check save status before saving again');
  const component=await page.locator('cedar-embeddable-editor').elementHandle();
  await name.fill('Newer input');await check.click();
  await expect(check).toHaveCount(0);await expect(save).toBeEnabled();await expect(name).toHaveValue('Newer input');
  expect(writes).toBe(1);expect(await component.evaluate(el=>el.isConnected)).toBe(true);
  await save.click();await expect(page.locator('.metadata-save-status')).toHaveText('Saved');
  expect(writes).toBe(2);expect(lastTag).toBe('"confirmed"');
});
