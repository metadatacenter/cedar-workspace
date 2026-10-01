import { selectionFixture, selectDeletion } from "./selection-deletion-fixture.mjs";
import { readFileSync } from "node:fs";
import { test, expect, dashboard, action, resource } from "./fixtures.mjs";
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
    if (kind === 'permissions') { plan.allowed = false; plan.restrictedItems = 1; }
    if (kind === 'references') { plan.allowed = false; plan.templatesWithOutsideInstances = 1; plan.instancesOutside = 3; }
    await openFolderDeletion(page, plan);
  };
}
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
  await menu.evaluate((element) =>
    element.style.setProperty("--cedar-surface-raised", "rgb(210, 220, 230)"),
  );
  await checkSurface(page, surface, "open", expect, testInfo);
  await menu.evaluate(
    (element) => (element.style.backgroundColor = "rgb(255, 0, 255)"),
  );
  await expect(
    checkSurface(page, surface, "open", expect, testInfo),
  ).rejects.toThrow("background-color must use");
});
