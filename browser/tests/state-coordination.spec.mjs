import { test, expect, resource } from "./fixtures.mjs";

for (const failure of [false, true]) {
  test(`a late description ${failure ? "failure" : "response"} cannot overwrite the selected item`, async ({ page, api }) => {
    const items = ["first", "second"].map(id => ({ ...resource, "@id": id, resourceType: "element", "schema:name": id, "schema:description": id + " description" }));
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { started = resolve; });
    await page.route("**/api/resource/folders/home/contents?**", route => route.fulfill({ json: { resources: items, totalCount: 2, pathInfo: [] } }));
    await page.route("**/api/resource/template-elements/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const item = items.find(item => path.includes("/" + item["@id"])) ?? items[0];
      if (path.endsWith("/first")) { started(); await gate; }
      await route.fulfill(path.endsWith("/first") && failure
        ? { status: 503, json: { message: "obsolete description failure" } }
        : { json: item, headers: { ETag: '"' + item["@id"] + '"' } });
    });
    await page.goto("/dashboard");
    await page.locator('.explorer-item[data-resource-id="first"]').click();
    await requested;
    await page.locator('.explorer-item[data-resource-id="second"]').click();
    const description = page.locator("#resource-description");
    await expect(description).toHaveValue("second description");
    const obsoleteReply = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/first"));
    release();
    await obsoleteReply;
    await expect(description).toBeEnabled();
    await description.fill("second edited");
    await expect(description).toHaveValue("second edited");
    await expect(page.getByText("obsolete description failure")).toHaveCount(0);
    expect(api.requests.filter(request => request.method !== "GET")).toEqual([]);
  });
}

for (const bad of [{ resources: null, totalCount: 0 }, { resources: [resource, resource], totalCount: 2 }]) {
  test(`a malformed listing cannot become selectable and a refresh recovers: ${JSON.stringify(bad)}`, async ({ page, api }) => {
    await page.route("**/api/resource/folders/home/contents?**", route => route.fulfill({ json: bad }));
    await page.goto("/dashboard");
    await expect(page.getByRole("alert")).toContainText("incomplete resource list");
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await page.unroute("**/api/resource/folders/home/contents?**");
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(api.requests.filter(request => request.method !== "GET")).toEqual([]);
  });
}
