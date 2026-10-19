import {test, expect, resource} from "./fixtures.mjs";
import {deletionPlan} from "./folder-deletion-fixture.mjs";
import {selectionFixture, selectionResources, selectDeletion} from "./selection-deletion-fixture.mjs";

for (const outcome of ["uncommitted", "missing", "inaccessible"]) {
  for (const fault of ["503", "disconnect"]) {
    test(`bulk deletion recovers after ${fault} refresh failures and an uncertain ${outcome} delete`, async ({page, api}) => {
      await selectionFixture(page);
      const remaining = {...resource,"@id":"remaining",resourceType:"instance","schema:name":"Remaining record"};
      const items = [...selectionResources,remaining];
      const deleted = new Set(), writes = [];
      let listingDown = false, inventoryDown = false, uncertain = true, denied = false, fresh = false;
      let listingFailures = 0, inventoryFailures = 0;
      await page.route("**/api/resource/**", async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        const id = path.split("/").find(part => items.some(r=>r["@id"] === part));
        const unavailable = () => fault === "503"
          ? route.fulfill({status:503,json:{message:"Unavailable"}}) : route.abort("connectionclosed");
        if (req.method() !== "GET") {
          expect(id).toBeTruthy();
          writes.push({id,method:req.method(),etag:req.headers()["if-match"],body:req.postDataJSON()});
          listingDown = true;
          if (id === "folder") {
            expect(req.postDataJSON()).toEqual({token:deletionPlan.token});
            deletionPlan.items.forEach(item=>deleted.add(item.id));
            return route.fulfill({json:{status:"completed",deleted:deletionPlan.counts,remaining:0}});
          }
          if (id === "separate" && uncertain) {
            if (outcome !== "uncommitted") deleted.add(id);
            return route.abort("connectionclosed");
          }
          deleted.add(id);
          return route.fulfill({status:204});
        }
        if (path.includes("/contents")) {
          if (listingDown) { listingFailures++; return unavailable(); }
          const resources = items.filter(r=>!deleted.has(r["@id"]));
          return route.fulfill({json:{resources,totalCount:resources.length,pathInfo:[]}});
        }
        if (!id) return route.fallback();
        if (inventoryDown && (path.endsWith("/deletion") || path.endsWith("/report"))) {
          inventoryFailures++; return unavailable();
        }
        if (deleted.has(id)) return route.fulfill({status:outcome === "inaccessible" ? 403 : 404,json:{message:"Unavailable resource"}});
        if (path.endsWith("/folder/deletion")) return route.fulfill({json:deletionPlan});
        const item = items.find(r=>r["@id"] === id);
        return route.fulfill({json:denied && id === "remaining" ? {...item,currentUserPermissions:{capabilities:[]}} : item,
          headers:{ETag:fresh ? '"fresh-' + id + '"' : '"original-' + id + '"'}});
      });
      await page.reload();
      await expect(page.locator("tr[data-resource-id]")).toHaveCount(5);
      const dialog = await selectDeletion(page,["folder","separate","remaining"]);
      const confirm = dialog.getByRole("button",{name:"Delete selected items and contents",exact:true});
      const refresh = dialog.getByRole("button",{name:"Refresh inventory",exact:true});
      await confirm.click();
      await expect(dialog).toContainText("Some items may already have been deleted");
      await expect(confirm).toBeDisabled();
      await expect.poll(()=>listingFailures).toBe(1);
      expect(writes.map(w=>w.id)).toEqual(["folder","separate"]);
      expect(writes[1].etag).toBe('"original-separate"');
      const progress = dialog.getByText("Confirmed deletions so far",{exact:true}).locator("xpath=following-sibling::ul[1]");
      const confirmedText = await progress.textContent();
      await expect(progress).toContainText(/Folders\s*:\s*2/);
      await expect(progress).toContainText(/Instances\s*:\s*2/);
      inventoryDown = true;
      for (let attempt=1;attempt<=2;attempt++) {
        await refresh.click();
        await expect.poll(()=>inventoryFailures).toBe(attempt);
        await expect(refresh).toBeEnabled();
        await expect(dialog).toContainText("The complete selection could not be checked");
        await expect(confirm).toBeDisabled();
        expect(await progress.textContent()).toBe(confirmedText);
        expect(writes).toHaveLength(2);
      }
      inventoryDown = false; fresh = true;
      if (outcome === "uncommitted") {
        denied = true;
        await refresh.click();
        await expect(dialog).toContainText("Items without delete permission: 1");
        await expect(confirm).toBeDisabled();
        expect(writes).toHaveLength(2);
        denied = false;
        await refresh.click();
        await expect(confirm).toBeEnabled();
        await expect(dialog).toContainText("Total items to delete: 2.");
        expect(await progress.textContent()).toBe(confirmedText);
        expect(writes).toHaveLength(2);
        uncertain = false;
        await confirm.click();
        await expect(dialog).toBeHidden();
        expect(writes.slice(2).map(w=>[w.id,w.etag])).toEqual([
          ["separate",'"fresh-separate"'],["remaining",'"fresh-remaining"'],
        ]);
      } else {
        await refresh.click();
        await expect(dialog).toContainText("The complete selection could not be checked");
        await expect(refresh).toBeEnabled();
        await expect(confirm).toBeDisabled();
        expect(await progress.textContent()).toBe(confirmedText);
        expect(writes).toHaveLength(2);
        await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
        // Another failed listing read cannot authorize a deletion from stale rows.
        await page.getByRole("button",{name:"Refresh workspace"}).click();
        await expect.poll(()=>listingFailures).toBe(2);
        await expect(page.getByRole("button",{name:"Refresh workspace"})).toBeEnabled();
        expect(writes).toHaveLength(2);
        listingDown = false;
        await page.getByRole("button",{name:"Refresh workspace"}).click();
        await expect(page.locator("tr[data-resource-id]")).toHaveCount(1);
        await selectDeletion(page,["remaining"]);
        expect(writes).toHaveLength(2);
        await page.getByRole("dialog").getByRole("button",{name:"Delete",exact:true}).click();
        await expect(page.getByRole("dialog")).toBeHidden();
        expect(writes.slice(2).map(w=>[w.id,w.etag])).toEqual([["remaining",'"fresh-remaining"']]);
      }
      listingDown = false;
      const reload = page.getByRole("button",{name:"Refresh workspace"});
      await expect(reload).toBeEnabled();
      await reload.click();
      await expect(page.locator("tr[data-resource-id]")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(writes.filter(w=>w.id === "folder")).toHaveLength(1);
      expect(writes.filter(w=>w.id === "separate")).toHaveLength(outcome === "uncommitted" ? 2 : 1);
    });
  }
}
