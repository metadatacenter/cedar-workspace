import { test, expect, resource } from "./fixtures.mjs";

const root = { ...resource, "@id": "root", resourceType: "folder", "schema:name": "/" };
const projects = { ...resource, "@id": "projects", resourceType: "folder", "schema:name": "Projects" };

/** Answer the folder reads a listing of `projects` or the root makes; the fixture answers the rest. */
async function folders(page) {
  await page.route("**/api/resource/folders/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const folder = { root, projects }[id];
    return folder
      ? route.fulfill({ json: folder, headers: { ETag: '"fixture-revision"' } })
      : route.fallback();
  });
}

for (const [address, title] of [
  ["/profile", "Profile – CEDAR Workspace"],
  ["/settings", "Settings – CEDAR Workspace"],
  ["/groups", "Groups – CEDAR Workspace"],
  ["/privacy", "Privacy – CEDAR Workspace"],
  ["/instances/edit/instance", "Metadata Editor – CEDAR Workspace"],
  ["/instances/create/template", "Metadata Editor – CEDAR Workspace"],
  ["/dashboard", "Home – CEDAR Workspace"],
  ["/dashboard?search=study", "Search results for “study” – CEDAR Workspace"],
  ["/dashboard?sharing=shared-with-me", "Shared with Me – CEDAR Workspace"],
  ["/dashboard?sharing=shared-with-everybody", "Shared with Everyone – CEDAR Workspace"],
  ["/dashboard?viewMode=view-special-folders", "Community Folders – CEDAR Workspace"],
]) {
  test(`${address} is titled ${title}`, async ({ page, api }) => {
    await page.goto(address);
    await expect(page).toHaveTitle(title);
  });
}

test("a folder is titled by its name once its listing arrives, and the root as All", async ({
  page,
  api,
}) => {
  await folders(page);
  api.pathInfo = [root, projects];
  await page.goto("/dashboard?folderId=projects");
  await expect(page).toHaveTitle("Projects – CEDAR Workspace");
  api.pathInfo = [root];
  await page.goto("/dashboard?folderId=root");
  await expect(page).toHaveTitle("All – CEDAR Workspace");
});

test("the title follows navigation inside the dashboard and survives a change of view", async ({
  page,
  api,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveTitle("Home – CEDAR Workspace");
  await page.getByRole("textbox", { name: "Search workspace" }).fill("study");
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle("Search results for “study” – CEDAR Workspace");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page).toHaveTitle("Search results for “study” – CEDAR Workspace");
  await page.getByRole("link", { name: "Shared with Me", exact: true }).click();
  await expect(page).toHaveTitle("Shared with Me – CEDAR Workspace");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveTitle("Home – CEDAR Workspace");
});

test("titles are translated", async ({ page, api }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "languages", { get: () => ["hu-HU"] }),
  );
  await page.goto("/profile");
  await expect(page).toHaveTitle("Profil – CEDAR Munkaterület");
  await page.goto("/dashboard");
  await expect(page).toHaveTitle("Saját mappa – CEDAR Munkaterület");
  await page.goto("/instances/edit/instance");
  await expect(page).toHaveTitle("Metaadat-szerkesztő – CEDAR Munkaterület");
});
