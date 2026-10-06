import { selectionFixture, selectDeletion } from "./selection-deletion-fixture.mjs";
import { readFileSync } from "node:fs";
import { test, expect, dashboard, action, resource, home } from "./fixtures.mjs";
import { surfaceCases, checkSurface } from "./surface-contracts.generated.mjs";
import { tokenStyles, menuItemSpacing } from './overlay-spacing.mjs';
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
    await page.getByLabel("Actions menu", { exact: true }).click();
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
  "dashboard-page": async (page) => dashboard(page),
  // The page's embedded editor is skipped here; CEE's own repository checks it.
  "metadata-editor-page": async (page) => {
    await page.goto("/instances/edit/instance");
    await expect(page.getByLabel("Instance name", { exact: true })).toBeVisible();
  },
};
// Each account page waits for its heading and for its content to finish loading.
for (const route of ["groups", "profile", "settings", "privacy"])
  scenarios[`${route}-page`] = async (page) => {
    await page.goto("/" + route);
    await expect(page.getByRole("heading", { name: route[0].toUpperCase() + route.slice(1), exact: true })).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  };
// A successful sign-out leaves the page, so the sign-out fails and the page shows its error.
scenarios["logout-page"] = async (page) => {
  await page.route("**/scripts/handlers/KeycloakUserHandler.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "KeycloakUserHandler.prototype.doLogout = () => Promise.reject(new Error('Sign-out unavailable'));",
    }),
  );
  await page.goto("/logout");
  await expect(page.getByRole("heading", { name: "Logout", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Sign-out unavailable");
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
    await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
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
scenarios['selection-delete-simple'] = async page => { await selectionFixture(page); await selectDeletion(page, ['instance1','separate']); };
scenarios['selection-delete'] = async page => { await selectionFixture(page); await selectDeletion(page); };
scenarios['recursive-delete-owner'] = page => openFolderDeletion(page, deletionOwnerRefusal);
for (const kind of ['confirmation', 'permissions', 'references']) {
  scenarios['recursive-delete-' + kind] = async page => {
    const plan = structuredClone(deletionPlan);
    if (kind === 'permissions') { plan.allowed = false; plan.restrictedItems = 1; plan.items[4].deletable = false; }
    if (kind === 'references') { plan.allowed = false; plan.templatesWithOutsideInstances = 1; plan.instancesOutside = 3; plan.items[2].instancesOutside = 3; }
    await openFolderDeletion(page, plan);
  };
}
// Pages, panels and tabs, each shown with content rather than empty.
async function selectFirst(page) {
  await page.locator("tbody tr").first().press("Enter");
  await expect(page.locator("#workspace-information h1")).toBeVisible();
}
const version = (id, number, extra = {}) => ({...resource, "@id": id, "pav:version": number, "bibo:status": "bibo:published", ...extra});
Object.assign(scenarios, {
  "grid-page": async (page) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".explorer-item")).toHaveCount(1);
  },
  "information-panel": async (page) => {
    await dashboard(page);
    await selectFirst(page);
  },
  "info-tab": async (page) => {
    await page.route("**/templates/template/report", (route) => route.fulfill({json: {
      ...resource,
      pathInfo: [{ "@id": "home", "schema:name": "Home" }, resource],
      everybodyPermission: "read",
      derivedFrom: {...resource, "@id": "source", "schema:name": "Source template"},
      numberOfInstances: 1,
    }}));
    await page.route("**/search?is_based_on=*", (route) => route.fulfill({json: {
      resources: [{...resource, "@id": "instance-id", resourceType: "instance"}], totalCount: 1,
    }}));
    await dashboard(page);
    await selectFirst(page);
    const info = page.locator("#workspace-information");
    await expect(info.getByText("Derived from", { exact: true })).toBeVisible();
    await expect(info.locator(".instance-list")).toBeVisible();
  },
  "version-tab": async (page) => {
    await page.route("**/templates/template/report", (route) => route.fulfill({json: {
      ...version("template", "2.0.0"),
      versions: [
        version("latest", "4.0.0", { "bibo:status": "bibo:draft" }),
        version("next", "3.0.0", { "schema:name": "Study metadata, third edition" }),
        version("template", "2.0.0"),
        version("older", "1.0.0"),
      ],
    }}));
    await dashboard(page);
    await selectFirst(page);
    const info = page.locator("#workspace-information");
    await info.getByRole("tab", { name: "Version", exact: true }).click();
    await expect(info.locator(".latest-version, .next-version, .previous-versions")).toHaveCount(3);
  },
  // An item held over a folder it can move into.
  "drag-preview": async (page) => {
    const folder = {...resource, "@id": "destination", resourceType: "folder", "schema:name": "Archive",
      currentUserPermissions: { capabilities: ["readResource", "moveIntoFolder"] }};
    const item = {...resource, "@id": "a", resourceType: "instance", "schema:name": "Sample a"};
    await page.route("**/api/resource/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/contents"))
        return route.fulfill({json: { resources: [folder, item], totalCount: 2, pathInfo: [] }});
      if (path.endsWith("/folders/home")) return route.fulfill({ json: home });
      const found = path.includes("/a/") || path.endsWith("/a") ? item : folder;
      return route.fulfill({ json: found, headers: { ETag: `"${found["@id"]}"` } });
    });
    await page.goto("/dashboard");
    await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
    const source = page.locator('[data-resource-id="a"]');
    await expect(source).not.toHaveClass(/cdk-drag-disabled/);
    const from = await source.boundingBox();
    const to = await page.locator('[data-resource-id="destination"]').boundingBox();
    await page.mouse.move(from.x + 20, from.y + from.height - 10);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(page.locator("cedar-drag-preview .destination.ready")).toBeVisible();
  },
  "error-alert": async (page) => {
    await page.route("**/api/resource/folders/home/contents?*", (route) =>
      route.fulfill({ status: 503, json: { message: "The workspace is temporarily unavailable." } }));
    await page.goto("/dashboard");
    await expect(page.locator('div.alert[role="alert"]')).toContainText("temporarily unavailable");
  },
  "folder-picker": async (page) => {
    const folder = (id, name, allowed = true) => ({
      "@id": id, resourceType: "folder", "schema:name": name, "pav:lastUpdatedOn": "2026-01-02T12:00:00Z",
      currentUserPermissions: { capabilities: allowed ? ["copyIntoFolder", "moveIntoFolder"] : [] },
    });
    const home = folder("home", "My workspace");
    const children = [folder("archive", "Archive"), folder("restricted", "Read only", false)];
    await page.route("**/folders/**", (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has("resource_types") && url.pathname.endsWith("/contents")) return route.fallback();
      const id = decodeURIComponent(url.pathname.split("/folders/")[1].split("/")[0]);
      if (url.pathname.endsWith("/contents"))
        return route.fulfill({json: {
          resources: id === "home" ? children : [], totalCount: id === "home" ? children.length : 0, pathInfo: [home],
        }});
      return route.fulfill({ json: [home, ...children].find((f) => f["@id"] === id) ?? home });
    });
    await dashboard(page);
    await page.getByRole("button", { name: "Actions for Study metadata" }).click();
    await page.locator(".resource-menu").getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.locator("dialog .folder-scroll")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("dialog .folder-scroll tbody tr")).toHaveCount(2);
  },
  "metadata-quality": async (page) => {
    await scenarios["metadata-errors"](page);
    await expect(page.locator(".metadata-quality")).toHaveCount(2);
  },
  "manage-groups": async (page) => {
    await scenarios["groups-page"](page);
    const search = page.getByRole("combobox", { name: "Find a group", exact: true });
    await search.fill("Research");
    await search.press("Enter");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Research team");
    await expect(page.locator(".groups-member-row")).toHaveCount(2);
  },
  "create-group": async (page) => {
    await scenarios["groups-page"](page);
    await page.getByRole("tab", { name: "Create group", exact: true }).click();
    await expect(page.getByLabel("Group name", { exact: true })).toBeVisible();
  },
  "delete-group-tab": async (page) => {
    await scenarios["groups-page"](page);
    await page.getByRole("tab", { name: "Delete group", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Delete group", exact: true });
    const search = panel.getByRole("combobox", { name: "Group name", exact: true });
    await search.fill("Research");
    await search.press("Enter");
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue("Research team");
  },
});
// Each confirmation opens the shared dialog from the control that asks for it.
const confirmationDialog = (page) => expect(page.locator("dialog.confirmation-dialog")).toBeVisible();
Object.assign(scenarios, {
  "delete-group": async (page) => {
    await scenarios["delete-group-tab"](page);
    await page.getByRole("tabpanel", { name: "Delete group", exact: true })
      .getByRole("button", { name: "Delete group", exact: true }).click();
    await confirmationDialog(page);
  },
  "group-administrator": async (page) => {
    await scenarios["manage-groups"](page);
    await page.getByRole("checkbox", { name: "Sam Curator is a Group Administrator", exact: true }).click();
    await confirmationDialog(page);
  },
  "transfer-ownership": async (page) => {
    await scenarios.permissions(page);
    await page.getByRole("checkbox", { name: "Make Sam Curator the owner", exact: true }).click();
    await confirmationDialog(page);
  },
  "delete-api-key": async (page) => {
    const key = (id, description) => ({
      id, key: `${id}-0123456789abcdef`, enabled: true, description, serviceName: "CEDAR", creationDate: "2026-01-01T12:00:00Z",
    });
    await page.route("**/api/user/users/owner", (route) => route.fulfill({json: {
      "@id": "owner", firstName: "Alex", lastName: "Researcher", email: "alex@example.org", homeFolderId: "home",
      permissions: [], uiPreferences: { preferredDateFormat: "yyyy-MM-dd" },
      apiKeys: [key("analysis", "Analysis scripts"), key("notebook", "Notebook")],
    }}));
    await scenarios["profile-page"](page);
    await page.getByRole("article", { name: "Analysis scripts", exact: true })
      .getByRole("button", { name: "Delete", exact: true }).click();
    await confirmationDialog(page);
  },
  "discard-metadata": async (page) => {
    await page.goto("/instances/edit/instance");
    const name = page.getByLabel("Instance name", { exact: true });
    await expect(name).toHaveValue("Study record");
    await name.fill("Changed record");
    await page.getByRole("button", { name: "Back to Workspace", exact: true }).click();
    await confirmationDialog(page);
  },
});
// Token adoption alone cannot catch two valid margins accumulating into an
// oversized gap. Check the rendered rhythm, including nested form/body stacks.
async function checkDialogSpacing(dialog) {
  const padding = await dialog.evaluate(element => {
    const style = getComputedStyle(element);
    return {top: style.paddingTop, bottom: style.paddingBottom, expected: style.getPropertyValue('--cedar-space-4').trim()};
  });
  expect(padding.top, 'dialog vertical padding').toBe(padding.expected);
  expect(padding.bottom, 'dialog vertical padding').toBe(padding.expected);
  const stacks = await dialog.evaluate(element => {
    const containers = [...element.querySelectorAll('.dialog-stack')];
    if (element.matches('.dialog-stack')) containers.unshift(element);
    return containers.map(container => {
      const style = getComputedStyle(container);
      const token = container.matches('.folder-picker') ? '--cedar-space-1' : '--cedar-space-3';
      const children = [...container.children].filter(child => child.getBoundingClientRect().height > 0);
      return {
        name: container.className,
        expected: parseFloat(style.getPropertyValue(token)),
        gap: parseFloat(style.rowGap),
        margins: children.map(child => [getComputedStyle(child).marginTop, getComputedStyle(child).marginBottom]),
        actual: children.slice(1).map((child, index) => child.getBoundingClientRect().top - children[index].getBoundingClientRect().bottom),
      };
    });
  });
  expect(stacks.length, 'dialog must adopt the shared spacing layout').toBeGreaterThan(0);
  for (const stack of stacks) {
    expect(stack.gap, `${stack.name} uses the shared spacing token`).toBe(stack.expected);
    for (const margin of stack.margins)
      expect(margin, `${stack.name} must not accumulate child margins`).toEqual(['0px', '0px']);
    for (const gap of stack.actual)
      expect(Math.abs(gap - stack.expected), `${stack.name} rendered gap`).toBeLessThanOrEqual(0.5);
  }
}

const stackedDialogs = new Set([
  'new-folder', 'rename', 'copy', 'move', 'publish', 'draft', 'delete', 'make-open',
  'selection-delete-simple', 'selection-delete', 'confirmation', 'recursive-delete-owner', 'recursive-delete-confirmation',
  'recursive-delete-permissions', 'recursive-delete-references',
  'delete-group', 'group-administrator', 'transfer-ownership', 'delete-api-key', 'discard-metadata',
]);

async function checkOverlaySpacing(page, surface) {
  const target = page.locator(surface.selector);
  if (stackedDialogs.has(surface.scenario)) return checkDialogSpacing(target);
  if (surface.contract === 'menu') {
    await tokenStyles(target, {'padding-top': '--cedar-space-1', 'padding-bottom': '--cedar-space-1'});
    await tokenStyles(target.locator('button, a'), menuItemSpacing);
    return;
  }
  const block = token => ({'padding-top': token, 'padding-bottom': token});
  switch (surface.scenario) {
    case 'permissions':
      await tokenStyles(target.locator('header'), block('--cedar-space-3'));
      await tokenStyles(target.locator('.permissions-body'), block('0px'));
      await tokenStyles(target.locator('.access-panel'), block('--cedar-space-2'));
      await tokenStyles(target.locator('footer'), {...block('--cedar-space-2'), 'margin-top': '0px'});
      await tokenStyles(target.locator('h3'), {'margin-top':'0px', 'margin-bottom':'--cedar-space-1'});
      break;
    case 'preview': {
      const narrow = page.viewportSize().width <= 600;
      await tokenStyles(target, block('0px'));
      await tokenStyles(target.locator('header'), block(narrow ? '--cedar-space-3' : '--cedar-space-1'));
      await tokenStyles(target.locator('section'), block(narrow ? '--cedar-space-3' : '--cedar-space-2'));
      break;
    }
    case 'type-filter':
    case 'date-filter':
      await tokenStyles(target.locator('footer'), block('--cedar-space-3'));
      if (surface.scenario === 'type-filter') {
        await tokenStyles(target.locator('.type-options'), block('--cedar-space-3'));
        await tokenStyles(target.locator('.type-options label'), {...menuItemSpacing, 'margin-top':'0px', 'margin-bottom':'0px'});
      } else {
        await tokenStyles(target.locator('.presets'), block('--cedar-space-2'));
        await tokenStyles(target.locator('.presets button'), menuItemSpacing);
        const width = await page.locator('cedar-resource-filters').evaluate(element => element.clientWidth);
        await tokenStyles(target.locator('.range'), {...block(width <= 520 ? '--cedar-space-3' : '--cedar-space-4'), 'row-gap':'--cedar-space-4'});
        await tokenStyles(target.locator('.range label'), {'margin-top':'0px', 'margin-bottom':'0px', 'row-gap':'--cedar-space-2'});
      }
      break;
    default:
      // A new dialog must choose a spacing recipe instead of silently escaping
      // the internal-layout checks behind the generic color/radius contract.
      expect(surface.contract, `Missing spacing coverage: ${surface.id}`).not.toBe('dialog');
  }
}

async function checkDialogHeading(dialog) {
  const close = dialog.locator('header button:has(svg[data-cedar-icon="close"])');
  if (!(await close.count())) return; // Confirmation uses its Cancel/OK footer.
  await tokenStyles(close, {
    width: '--cedar-control-height-default',
    height: '--cedar-control-height-default',
    'padding-left': '0px',
    'padding-right': '0px',
  });
  const alignment = await close.evaluate(button => {
    const heading = button.closest('.dialog-heading');
    const title = heading.querySelector('h2').getBoundingClientRect();
    const icon = button.querySelector('svg').getBoundingClientRect();
    const edge = heading.getBoundingClientRect().right - parseFloat(getComputedStyle(heading).paddingRight);
    return {horizontal: icon.right - edge, vertical: (icon.top + icon.bottom - title.top - title.bottom) / 2};
  });
  expect(Math.abs(alignment.horizontal), 'close icon aligns with the content right edge').toBeLessThanOrEqual(0.5);
  expect(Math.abs(alignment.vertical), 'close icon centers with the heading').toBeLessThanOrEqual(0.5);
  for (const label of await dialog.locator('.field-label').all()) {
    await tokenStyles(label, {'font-weight':'--cedar-font-weight-medium', color:'--cedar-text-muted'});
    for (const input of await label.locator('..').locator('input,textarea').all()) {
      const weight = await input.evaluate(el => getComputedStyle(el).getPropertyValue('--cedar-font-weight-regular').trim());
      await expect(input).toHaveCSS('font-weight', weight);
    }
  }
}

for (const { surface, state, width, title } of surfaceCases(
  registry,
  scenarios,
))
  test(title, async ({ page, api }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await scenarios[surface.scenario](page);
    await checkSurface(page, surface, state, expect, testInfo);
    await checkOverlaySpacing(page, surface);
    if (surface.contract === 'dialog') await checkDialogHeading(page.locator(surface.selector));
  });

test('dialog spacing follows host tokens and rejects accumulated margins', async ({ page, api }) => {
  await scenarios.copy(page);
  const dialog = page.locator('cedar-resource-dialog dialog');
  await dialog.evaluate(element => element.style.setProperty('--cedar-space-3', '14px'));
  await checkDialogSpacing(dialog);
  await dialog.locator('.resource-dialog-resource').evaluate(element => element.style.marginBottom = '24px');
  await expect(checkDialogSpacing(dialog)).rejects.toThrow('must not accumulate child margins');
});

test('sectioned dialog spacing rejects component overrides', async ({page, api}) => {
  await scenarios.permissions(page);
  const surface = registry.surfaces.find(surface => surface.scenario === 'permissions');
  await checkOverlaySpacing(page, surface);
  await page.locator(`${surface.selector} header`).evaluate(element => element.style.paddingTop = '48px');
  await expect(checkOverlaySpacing(page, surface)).rejects.toThrow('padding-top must follow overlay spacing');
});

test("surface contracts detect computed-style drift and honor host tokens", async ({
  page,
  api,
}, testInfo) => {
  const surface = registry.surfaces.find((s) => s.scenario === "artifact-menu");
  await scenarios["artifact-menu"](page);
  const menu = page.locator(surface.selector);
  // A host themes the surface from an ancestor; the vocabulary resolves in that context.
  await menu.evaluate((element) =>
    element.parentElement.style.setProperty("--cedar-surface-raised", "rgb(210, 220, 230)"),
  );
  await checkSurface(page, surface, "open", expect, testInfo);
  await menu.evaluate(
    (element) => (element.style.backgroundColor = "rgb(255, 0, 255)"),
  );
  await expect(
    checkSurface(page, surface, "open", expect, testInfo),
  ).rejects.toThrow("values outside the shared vocabulary");
  // A vocabulary colour in the wrong role still breaks the surface's contract.
  await menu.evaluate(
    (element) => (element.style.backgroundColor = "var(--cedar-surface-subtle)"),
  );
  await expect(
    checkSurface(page, surface, "open", expect, testInfo),
  ).rejects.toThrow("background-color must use");
});
