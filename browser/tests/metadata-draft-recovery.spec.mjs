import {test,expect} from './fixtures.mjs';

for(const outcome of ['reload','outage','expired session','permission lost','conflict'])
  test(`restore metadata draft after ${outcome}`,async({page,api})=>{
    let writes=0,fail=outcome!=='reload',revision='"original"';
    await page.route('**/api/resource/template-instances/instance',route=>{
      if(route.request().method()==='PUT'){
        writes++;
        if(fail)return outcome==='outage'?route.abort('failed'):route.fulfill({status:outcome==='expired session'?401:outcome==='permission lost'?403:412,json:{message:'Refused'}});
        return route.fulfill({json:{'@id':'instance'},headers:{ETag:'"saved"'}});
      }
      return route.fulfill({json:{'@id':'instance','schema:name':'Study record','schema:isBasedOn':'template'},headers:{ETag:revision}});
    });
    await page.goto('/instances/edit/instance');
    const name=page.getByLabel('Instance name',{exact:true}),save=page.getByRole('button',{name:'Save',exact:true});
    await name.fill('Recover this name');
    if(outcome!=='reload'){await save.click();await expect(save).toBeDisabled();}
    page.on('dialog',dialog=>dialog.accept());
    if(outcome==='conflict')revision='"changed"';
    await page.reload();
    await expect(name).toHaveValue('Study record');
    await expect(save).toBeDisabled();
    await page.getByRole('button',{name:'Restore draft',exact:true}).click();
    await expect(name).toHaveValue('Recover this name');
    fail=false;
    if(['outage','expired session','permission lost'].includes(outcome)){
      await page.getByRole('button',{name:outcome==='outage'?'Check save status':'Recheck access',exact:true}).click();
    }
    if(outcome==='conflict'){
      await expect(save).toBeDisabled();expect(writes).toBe(1);
    }else{
      await expect(save).toBeEnabled();await save.click();await expect(page.locator('.metadata-save-status')).toHaveText('Saved');
    }
  });

test('an uncertain create remains blocked through reload',async({page,api})=>{
  let writes=0;
  await page.route('**/api/resource/template-instances?*',route=>{
    writes++;return route.abort('failed');
  });
  await page.goto('/instances/create/template?folderId=home');
  await page.getByLabel('Instance name',{exact:true}).fill('Uncertain creation');
  const save=page.getByRole('button',{name:'Save',exact:true});await save.click();await expect(save).toBeDisabled();
  page.on('dialog',dialog=>dialog.accept());await page.reload();
  await page.getByRole('button',{name:'Restore draft',exact:true}).click();
  await expect(page.getByLabel('Instance name',{exact:true})).toHaveValue('Uncertain creation');
  await expect(save).toBeDisabled();expect(writes).toBe(1);
});
