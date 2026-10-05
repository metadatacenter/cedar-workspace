// Leaving the dashboard for an editor and coming back, across artifact type, Info panel tab, list or
// grid view, the way the editor was reached, and whether the folder holds the artifact opened. An
// editor returns to the address it was given, so each case follows that address back and checks what
// it restores: the selection, the tab, the view, and an address that has forgotten both.
import { test, expect, resource } from "./fixtures.mjs";

const TYPES = {
  template: { path: "templates", versioned: true },
  element: { path: "elements", versioned: true },
  field: { path: "fields", versioned: true },
  instance: { path: "instances", versioned: false },
};

const artifact = (type, id, name, extra = {}) => ({
  ...resource,
  "@id": id,
  resourceType: type,
  "schema:name": name,
  ...extra,
});

/** The listing holds the artifact, and the newer version too when `listed` says so. */
async function setup(page, type, listed) {
  const current = artifact(type, `${type}-current`, `Current ${type}`, { "pav:version": "1.0.0", "bibo:status": "bibo:published" });
  const newer = artifact(type, `${type}-newer`, `Newer ${type}`, { "pav:version": "2.0.0", "bibo:status": "bibo:draft" });
  const versions = TYPES[type].versioned ? [newer, current] : undefined;
  const listing = listed ? [current, newer] : [current];
  await page.route("**/api/resource/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/contents") || path.endsWith("/search"))
      return route.fulfill({ json: { resources: listing, totalCount: listing.length, pathInfo: [] } });
    const found = [current, newer].find((r) => path.includes("/" + r["@id"] + "/") || path.endsWith("/" + r["@id"]));
    if (found) return route.fulfill({ json: { ...found, versions }, headers: { ETag: '"1"' } });
    return route.fulfill({ json: { ...resource, "@id": "home", resourceType: "folder", "schema:name": "Home" } });
  });
  // Every editor is a stand-in page; the test follows its return address as a real editor would.
  await page.route(
    (url) => /^\/(templates|elements|fields|instances)\/(edit|create)\//.test(url.pathname),
    (route) => route.fulfill({ contentType: "text/html", body: "<h1>Editor</h1>" }),
  );
  return { current, newer };
}

/** How each exit is taken from the dashboard, and which artifact it opens. */
const EXITS = {
  // Double-clicking a grid card opens its editor; the first click of the two selects it again.
  open: async (page, { current }) => {
    await page.locator(`[data-resource-id="${current["@id"]}"] .resource-icon`).dblclick();
    return current;
  },
  // In list view the name is a link to the editor.
  name: async (page, { current }) => {
    await page.locator(`[data-resource-id="${current["@id"]}"] td:first-child a`).click();
    return current;
  },
  // A template can be populated from its row.
  populate: async (page, { current }) => {
    await page.locator(`[data-resource-id="${current["@id"]}"] .explorer-populate`).click();
    return current;
  },
  // The Version tab links the newer version.
  version: async (page, { newer }) => {
    await page.locator(".information .latest-version a").click();
    return newer;
  },
};

const cases = [];
for (const [type, { versioned }] of Object.entries(TYPES))
  for (const tab of versioned ? ["Details", "Version"] : ["Details"])
    for (const view of ["grid", "list"])
      for (const exit of Object.keys(EXITS)) {
        // A grid card opens by double-click, a list row by its name.
        if (exit === "name" && view === "grid") continue;
        if (exit === "open" && view === "list") continue;
        if (exit === "populate" && type !== "template") continue;
        if (exit === "version" && tab !== "Version") continue;
        for (const listed of exit === "version" ? [true, false] : [true])
          cases.push({ type, tab, view, exit, listed });
      }

for (const { type, tab, view, exit, listed } of cases) {
  test(`return to a ${type} on ${tab} in ${view} view after ${exit}${exit === "version" ? (listed ? ", version listed" : ", version elsewhere") : ""}`, async ({ page, api }) => {
    const fixture = await setup(page, type, listed);
    await page.goto(view === "list" ? "/dashboard?view=list" : "/dashboard");
    const item = page.locator(`[data-resource-id="${fixture.current["@id"]}"]`);
    await item.locator(".resource-icon").click();
    await expect(item).toHaveAttribute("aria-selected", "true");
    const info = page.locator(".information");
    await info.getByRole("tab", { name: tab, exact: true }).click();
    await expect(info.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");

    const opened = await EXITS[exit](page, fixture);
    await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
    const returnTo = new URL(page.url()).searchParams.get("returnTo");
    expect(returnTo, "every editor is given a way back").toBeTruthy();
    await page.goto(returnTo);

    // The selection is the opened artifact when the folder holds it, and otherwise the one whose
    // panel led there. A versioned artifact returns on the tab it was left on.
    const expected = listed ? opened : fixture.current;
    await expect(page.locator(`[data-resource-id="${expected["@id"]}"]`)).toHaveAttribute("aria-selected", "true");
    await expect(info.locator("h1")).toContainText(expected["schema:name"]);
    const shown = TYPES[type].versioned ? tab : "Details";
    await expect(info.getByRole("tab", { name: shown, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".table-scroll")).toHaveClass(view === "grid" ? /explorer-grid/ : /^(?!.*explorer-grid)/);
    await expect(page).not.toHaveURL(/[?&](selected|tab)=/);
    if (view === "list") await expect(page).toHaveURL(/[?&]view=list/);
  });
}
