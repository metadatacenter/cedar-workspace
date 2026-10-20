import { test, expect, resource } from "./fixtures.mjs";

const templates = [
  { ...resource, "@id": "study", "schema:name": "Study metadata", isOpen: true },
  { ...resource, "@id": "survey", "schema:name": "Survey metadata", isOpen: true },
];

/** List two open templates, and answer their reports; the shared fixture answers the rest. */
async function listTemplates(page) {
  await page.route("**/api/resource/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/folders/home/contents"))
      return route.fulfill({ json: { resources: templates, totalCount: 2, pathInfo: [] } });
    const template = templates.find((t) => path.endsWith(`/templates/${t["@id"]}/report`));
    return template
      ? route.fulfill({ json: template, headers: { ETag: '"fixture-revision"' } })
      : route.fallback();
  });
}

for (const view of ["Grid view", "List view"]) {
  test(`each row's icon links are described by its artifact in ${view.toLowerCase()}`, async ({
    page,
    api,
  }) => {
    await listTemplates(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: view, exact: true }).click();
    for (const template of templates) {
      const row = page.locator(`[data-resource-id="${template["@id"]}"]`);
      for (const name of ["Open in OpenView", "Populate template"]) {
        // The name stays the text the link's help shows; the description names the artifact.
        const link = row.getByRole("link", { name, exact: true });
        await expect(link).toHaveAccessibleName(name);
        await expect(link).toHaveAccessibleDescription(template["schema:name"]);
        await link.hover();
        await expect(page.getByRole("tooltip")).toHaveText(name);
        await expect(link).toHaveAccessibleDescription(`${template["schema:name"]} ${name}`);
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await expect(link).toHaveAccessibleDescription(template["schema:name"]);
      }
    }
  });
}
