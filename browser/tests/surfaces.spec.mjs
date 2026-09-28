import { readFileSync } from "node:fs";
import { test, expect, dashboard, action, resource } from "./fixtures.mjs";
import { surfaceCases, checkSurface } from "./surface-contracts.generated.mjs";
import { deletionPlan, deletionOwnerRefusal, openFolderDeletion } from "./folder-deletion-fixture.mjs";
const registry = JSON.parse(
  readFileSync(new URL("../../.ui-surfaces.json", import.meta.url), "utf8"),
);
const scenarios = {
  "artifact-menu": async (page) => {
    await dashboard(page);
    await page
      .getByRole("button", { name: "Actions for Study metadata" })
      .click();
  },
  "folder-menu": async (page) => {
    await page.route("**/api/resource/folders/home/contents?*", (route) =>
      route.fulfill({
        json: {
          resources: [
            {
              ...resource,
              "@id": "folder",
              resourceType: "folder",
              "schema:name": "Folder",
            },
          ],
          totalCount: 1,
          pathInfo: [],
        },
      }),
    );
    await page.route("**/api/resource/folders/folder", (route) =>
      route.fulfill({
        json: {
          ...resource,
          "@id": "folder",
          resourceType: "folder",
          "schema:name": "Folder",
        },
      }),
    );
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await page
      .getByRole("button", { name: "Actions for Folder", exact: true })
      .click();
  },
  "person-menu": async (page) => {
    await dashboard(page);
    await page.getByLabel("User menu", { exact: true }).click();
  },
  "more-menu": async (page) => {
    await dashboard(page);
    await page.getByLabel("More menu", { exact: true }).click();
  },
  "new-menu": async (page) => {
    await dashboard(page);
    await page.locator("#button-create").click();
  },
  "sort-menu": async (page) => {
    await dashboard(page);
    await page
      .getByRole("button", { name: "Sort options", exact: true })
      .click();
  },
  "new-folder": async (page) => {
    await scenarios["new-menu"](page);
    await page
      .locator(".new-menu")
      .getByRole("button", { name: "Folder", exact: true })
      .click();
  },
  confirmation: async (page) => {
    await dashboard(page);
    await action(page, "Rename");
    await page.getByLabel("Name", { exact: true }).fill("Changed");
    await page.keyboard.press("Escape");
  },
  "type-filter": async (page) => {
    await dashboard(page);
    await page.getByRole("button", { name: "Type", exact: true }).click();
  },
  "date-filter": async (page) => {
    await dashboard(page);
    await page
      .getByRole("button", { name: "Last modified", exact: true })
      .first()
      .click();
  },
  preview: async (page) => {
    await dashboard(page);
    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await page
      .getByRole("button", { name: "Preview Study metadata", exact: true })
      .click();
  },
};
for (const [key, label] of Object.entries({
  rename: "Rename",
  copy: "Copy",
  move: "Move",
  publish: "Publish",
  draft: "Create Draft",
  delete: "Delete",
  "make-open": "Enable Openview",
  permissions: "Permissions…",
})) {
  scenarios[key] = async (page) => {
    await dashboard(page);
    if (key === "draft")
      await page.route("**/templates/template/report", (route) =>
        route.fulfill({
          json: { ...resource, "bibo:status": "bibo:published" },
        }),
      );
    await page
      .getByRole("button", { name: "Actions for Study metadata" })
      .click();
    await page
      .locator(".resource-menu")
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(page.locator("dialog[open]")).toBeVisible();
  };
}
for (const kind of ["errors", "warnings"])
  scenarios["metadata-" + kind] = async (page) => {
    await page.goto("/instances/edit/instance");
    await expect(page.getByLabel("Metadata name")).toHaveValue("Study record");
    await page.evaluate(() => {
      const editor = document.querySelector("cedar-embeddable-editor");
      editor.dataQualityReport = {
        isValid: false,
        problems: [
          { path: ["Title"], code: "required", message: "Required" },
          { path: ["Email"], code: "email", message: "Invalid email" },
        ],
      };
      editor.dispatchEvent(new CustomEvent("change"));
    });
  };
scenarios['recursive-delete-owner'] = page => openFolderDeletion(page, deletionOwnerRefusal);
for (const kind of ['confirmation', 'permissions', 'references']) {
  scenarios['recursive-delete-' + kind] = async page => {
    const plan = structuredClone(deletionPlan);
    if (kind === 'permissions') { plan.allowed = false; plan.restrictedItems = 1; }
    if (kind === 'references') { plan.allowed = false; plan.templatesWithOutsideInstances = 1; plan.instancesOutside = 3; }
    await openFolderDeletion(page, plan);
  };
}
for (const { surface, state, width, title } of surfaceCases(
  registry,
  scenarios,
))
  test(title, async ({ page, api }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await scenarios[surface.scenario](page);
    await checkSurface(page, surface, state, expect, testInfo);
  });

test("surface contracts detect computed-style drift and honor host tokens", async ({
  page,
  api,
}, testInfo) => {
  const surface = registry.surfaces.find((s) => s.scenario === "artifact-menu");
  await scenarios["artifact-menu"](page);
  const menu = page.locator(surface.selector);
  await menu.evaluate((element) =>
    element.style.setProperty("--cedar-overlay-surface", "rgb(210, 220, 230)"),
  );
  await checkSurface(page, surface, "open", expect, testInfo);
  await menu.evaluate(
    (element) => (element.style.backgroundColor = "rgb(255, 0, 255)"),
  );
  await expect(
    checkSurface(page, surface, "open", expect, testInfo),
  ).rejects.toThrow("background-color must use");
});
