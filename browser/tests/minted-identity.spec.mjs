import { test, expect, resource } from "./fixtures.mjs";

// Production serves its resource API from resource.<domain>, and Workspace mints the identity of
// each instance it creates on repo.<domain>, so a create is a PUT under that identity and a lost
// reply is settled by looking the identity up. On localhost the base stays unknown and a create
// falls back to a POST whose identity the server chooses. These cases therefore serve Workspace
// from such a host. Every request to it is answered here: the application's own files from the
// local server, the instances from this deployment, and the rest from the shared fixture.
const host = "https://resource.example.test";
const base = "https://repo.example.test/template-instances/";
const local = `http://localhost:${process.env.PORT || 4797}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
test.use({ baseURL: host });

/** Instances stored under the identities they were created with. `lose` drops a write's reply. */
async function deployment(page) {
  const server = { writes: [], reads: [], stored: new Map(), lose: 0 };
  await page.route(`${host}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (/^\/(api|config|scripts|third_party_components)\//.test(url.pathname)) return route.fallback();
    return route.fulfill({ response: await route.fetch({ url: local + url.pathname + url.search }) });
  });
  await page.route(`${host}/api/resource/template-instances/**`, async (route) => {
    const request = route.request(), url = new URL(request.url());
    const [id, part] = decodeURIComponent(url.pathname.slice("/api/resource/template-instances/".length)).split("/");
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      server.writes.push({ id, folder: url.searchParams.get("folder_id"), body, revision: request.headers()["if-match"] });
      // The server refuses a second create under an identity it already holds.
      if (url.searchParams.has("folder_id") && server.stored.has(id))
        return route.fulfill({ status: 412, json: { message: "Taken" } });
      server.stored.set(id, body);
      if (server.lose-- > 0) return route.abort("failed");
      return route.fulfill({ json: { "@id": body["@id"] }, headers: { ETag: '"created"' } });
    }
    server.reads.push(id);
    const stored = server.stored.get(id);
    if (!stored) return route.fulfill({ status: 404, json: { message: "Not found" } });
    return route.fulfill({
      json: part === "report"
        ? { ...resource, "@id": stored["@id"], resourceType: "instance", "schema:name": stored["schema:name"] }
        : stored,
      headers: { ETag: '"created"' },
    });
  });
  return server;
}

test("a create is sent under an identity minted on the deployment's base", async ({ page, api }) => {
  const server = await deployment(page);
  await page.goto("/instances/create/template?folderId=home");
  const name = page.getByLabel("Instance name", { exact: true });
  await name.fill("Minted record");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".metadata-save-status")).toHaveText("Saved");
  expect(server.writes).toHaveLength(1);
  const [write] = server.writes;
  expect(write.id).toMatch(uuid);
  expect(write).toEqual({
    id: write.id,
    folder: "home",
    revision: undefined,
    body: expect.objectContaining({ "@id": base + write.id, "schema:name": "Minted record", "schema:isBasedOn": "template" }),
  });
  await expect(page).toHaveURL((url) => url.origin === host && url.pathname === `/instances/edit/${write.id}`);
});

test("a create whose reply is lost is looked up by its identity and never sent again", async ({ page, api }) => {
  const server = await deployment(page);
  server.lose = 1;
  await page.goto("/instances/create/template?folderId=home");
  const name = page.getByLabel("Instance name", { exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await name.fill("Uncertain record");
  await save.click();
  const check = page.getByRole("button", { name: "Check save status", exact: true });
  await expect(check).toBeVisible();
  await expect(save).toBeDisabled();
  await check.click();
  await expect(check).toHaveCount(0);
  const [write] = server.writes;
  // The lookup asked for the identity the create was sent under, and found what it created.
  expect(server.reads).toContain(write.id);
  await expect(page).toHaveURL((url) => url.origin === host && url.pathname === `/instances/edit/${write.id}`);
  await expect(name).toHaveValue("Uncertain record");
  await expect(page.locator(".metadata-save-status")).toHaveText("Saved");
  expect(server.writes).toHaveLength(1);
});
