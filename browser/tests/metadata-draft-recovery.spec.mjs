import {test,expect} from './fixtures.mjs';

// A draft holds CEE's own content as well as the name. The page shows a restored draft whatever a
// later save sends, so each save after a restore is checked for what it writes.
const editTitle=page=>page.evaluate(()=>{
  const cee=document.querySelector('cedar-embeddable-editor');
  cee.currentMetadata={...cee.currentMetadata,Title:{'@value':'Recovered title'}};
  cee.dispatchEvent(new CustomEvent('change'));
});

for(const outcome of ['reload','outage','expired session','permission lost','conflict'])
  test(`restore metadata draft after ${outcome}`,async({page,api})=>{
    let writes=0,fail=outcome!=='reload',revision='"original"';
    const saves=[];
    await page.route('**/api/resource/template-instances/instance',route=>{
      if(route.request().method()==='PUT'){
        writes++;
        if(fail)return outcome==='outage'?route.abort('failed'):route.fulfill({status:outcome==='expired session'?401:outcome==='permission lost'?403:412,json:{message:'Refused'}});
        saves.push({body:route.request().postDataJSON(),etag:route.request().headers()['if-match']});
        return route.fulfill({json:{'@id':'instance'},headers:{ETag:'"saved"'}});
      }
      return route.fulfill({json:{'@id':'instance','schema:name':'Study record','schema:isBasedOn':'template'},headers:{ETag:revision}});
    });
    await page.goto('/instances/edit/instance');
    const name=page.getByLabel('Instance name',{exact:true}),save=page.getByRole('button',{name:'Save',exact:true});
    await name.fill('Recover this name');
    await editTitle(page);
    if(outcome!=='reload'){await save.click();await expect(save).toBeDisabled();}
    // A reload while the write is in flight restores it as unconfirmed, so let the refusal arrive first.
    if(['expired session','permission lost'].includes(outcome))await expect(page.getByRole('button',{name:'Recheck access',exact:true})).toBeVisible();
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
      expect(saves).toHaveLength(1);
      expect(saves[0].etag).toBe('"original"');
      expect(saves[0].body['schema:name']).toBe('Recover this name');
      expect(saves[0].body.Title).toEqual({'@value':'Recovered title'});
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
