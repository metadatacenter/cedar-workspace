import {test, expect, resource} from "./fixtures.mjs";

for (const committed of [true, false]) {
  test(`bulk move recovers through listing and placement outages when the lost reply ${committed ? "hid a commit" : "preceded a commit"}`, async ({page, api}) => {
    const folder = {...resource, "@id":"destination", resourceType:"folder", "schema:name":"Archive",
      currentUserPermissions:{capabilities:["readResource","moveIntoFolder"]}};
    const items = ["a","b","c"].map(id => ({...resource,"@id":id,resourceType:"instance","schema:name":"Sample " + id}));
    const moved = new Set(), attempts = [];
    let listingDown = false, reportsDown = false, refusing = true;
    await page.route("**/api/resource/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith("/contents")) {
        if (listingDown) return route.fulfill({status:503,json:{message:"Listing unavailable"}});
        const destination = path.includes("/destination/");
        const resources = destination ? items.filter(r => moved.has(r["@id"]))
          : [folder,...items.filter(r => !moved.has(r["@id"]))];
        return route.fulfill({json:{resources,totalCount:resources.length,pathInfo:[]}});
      }
      if (path.endsWith("/move-resource-to-folder")) {
        const id = request.postDataJSON()["@id"];
        expect(request.headers()["if-match"]).toBe('"' + id + '"');
        attempts.push(id);
        listingDown = true;
        if (id === "c" && refusing) return route.fulfill({status:403,json:{message:"Move refused"}});
        if (id === "b" && refusing) {
          if (committed) moved.add(id);
          return route.abort("connectionclosed");
        }
        moved.add(id);
        return route.fulfill({json:{}});
      }
      const r = [folder,...items].find(r => path.includes("/" + r["@id"] + "/") || path.endsWith("/" + r["@id"]));
      if (!r) return route.fallback();
      if (reportsDown && path.endsWith("/report")) return route.fulfill({status:503,json:{message:"Placement unavailable"}});
      return route.fulfill({json:{...r,pathInfo:[{"@id":moved.has(r["@id"])?"destination":"home",resourceType:"folder"},r]},
        headers:{ETag:'"' + r["@id"] + '"'}});
    });
    await page.goto("/dashboard?view=list");
    const row = id => page.locator(`[data-resource-id="${id}"]`);
    await expect(row("c")).toBeVisible();
    for (const id of ["a","b","c"]) await row(id).locator(".resource-icon").click({modifiers:id === "a" ? [] : ["ControlOrMeta"]});
    async function drag(id) {
      const source = await row(id).locator(".resource-icon").boundingBox(), target = await row("destination").boundingBox();
      await page.mouse.move(source.x + source.width/2,source.y + source.height/2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width/2 + 10,source.y + source.height/2 + 10,{steps:3});
      await page.mouse.move(target.x + 50,target.y + target.height/2,{steps:12});
      await expect(page.locator("body")).toHaveClass(/explorer-can-drop/);
      await page.mouse.up();
    }
    await drag("a");
    await expect(page.locator(".toast").getByText("Moved 1 item.",{exact:true})).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Listing unavailable");
    await expect(page.getByRole("alert")).toContainText("Move refused");
    expect(attempts).toEqual(["a","b","c"]);
    await expect(row("a")).toHaveAccessibleDescription("");
    await expect(row("b")).toHaveAccessibleDescription("Selected");
    await expect(row("c")).toHaveAccessibleDescription("Selected");
    const refresh = page.getByRole("button",{name:"Refresh workspace"});
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(row("b")).toHaveAccessibleDescription("Selected");
    await expect(row("c")).toHaveAccessibleDescription("Selected");
    reportsDown = true;
    await drag("b");
    await expect(page.getByRole("alert")).toContainText("Placement unavailable");
    expect(attempts).toEqual(["a","b","c"]);
    await expect(row("b")).toHaveAccessibleDescription("Selected");
    await expect(row("c")).toHaveAccessibleDescription("Selected");
    reportsDown = false; refusing = false;
    await drag("b");
    await expect(page.locator(".toast").getByText("Moved 2 items.",{exact:true})).toBeVisible();
    expect(attempts).toEqual(committed ? ["a","b","c","c"] : ["a","b","c","b","c"]);
    await expect(page.getByRole("alert")).toContainText("Listing unavailable");
    await expect(page.locator("tr.selected")).toHaveCount(0);
    listingDown = false;
    await refresh.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("tr[data-resource-id]")).toHaveCount(1);
    await row("destination").locator(".resource-icon").dblclick();
    for (const id of ["a","b","c"]) await expect(row(id)).toBeVisible();
    expect(attempts).toHaveLength(committed ? 4 : 5);
  });
}
