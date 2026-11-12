import { test, expect, dashboard, action, resource } from "./fixtures.mjs";
import { openFolderDeletion } from "./folder-deletion-fixture.mjs";
import { selectionFixture, selectDeletion } from "./selection-deletion-fixture.mjs";
import { VIEWPORTS, check } from "./layout-resilience.generated.mjs";

/**
 * Whether Workspace's screens survive a narrow window, a zoomed window and wider text, and whether
 * their placeholders, field boundaries, icons, focus indicators and selection marks can be seen.
 *
 * The checks are the shared ones the token package generates into `layout-resilience.generated.mjs`,
 * which says what WCAG asks and how each check measures it. This spec reaches each screen and records
 * what Workspace excuses. A finding fails unless `exceptions` names it, and an exception no screen
 * produces fails too, so the list says exactly what remains.
 */

/** Each screen the checks open, and the hosts whose content they leave out. */
const screens = {
  "dashboard list": async (page) => {
    await dashboard(page);
    await select(page);
  },
  "dashboard grid": async (page) => {
    await page.goto("/dashboard");
    await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
    await select(page);
  },
  "filter popover": async (page) => {
    await dashboard(page);
    await page.locator("cedar-filter-chip").first().getByRole("button").first().click();
    await expect(page.getByRole("dialog", { name: "Filter by type" })).toBeVisible();
  },
  groups: async (page) => {
    await page.goto("/groups");
    const find = page.getByRole("combobox", { name: "Find a group", exact: true });
    await find.fill("Research");
    await find.press("Enter");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Research team");
  },
  profile: (page) => account(page, "/profile"),
  settings: (page) => account(page, "/settings"),
  privacy: (page) => account(page, "/privacy"),
  // CEE renders the form in its own shadow root, and its own suite checks it.
  "metadata editor": async (page) => {
    await page.goto("/instances/edit/instance");
    await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
    return ["cedar-embeddable-editor"];
  },
  // The dialogs Workspace opens itself, each over the page it acts on and with its content shown.
  Permissions: async (page) => {
    await dashboard(page);
    await action(page, "Permissions…");
    await expect(page.getByRole("combobox", { name: "User or group" })).toBeEnabled();
  },
  "ownership confirmation": async (page) => {
    await screens.Permissions(page);
    await page.getByRole("checkbox", { name: "Make Sam Curator the owner", exact: true }).click();
    await expect(page.locator("dialog.confirmation-dialog")).toBeVisible();
  },
  Move: (page) => picker(page, "Move"),
  Copy: (page) => picker(page, "Copy"),
  Publish: async (page) => {
    await dashboard(page);
    await action(page, "Publish");
    await expect(page.locator("dialog[open]").getByRole("textbox", { name: "Patch", exact: true })).toBeVisible();
  },
  "Create Draft": async (page) => {
    await page.route("**/templates/template/report", (route) =>
      route.fulfill({ json: { ...resource, "bibo:status": "bibo:published" } }),
    );
    await folders(page);
    await dashboard(page);
    await page.getByRole("button", { name: "Actions for Study metadata", exact: true }).click();
    await page.locator(".resource-menu").getByRole("button", { name: "Create Draft", exact: true }).click();
    await expect(page.locator("dialog .folder-scroll")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("dialog .folder-scroll tbody tr")).toHaveCount(2);
    await expect(page.locator("dialog[open]").getByRole("textbox", { name: "Patch", exact: true })).toHaveValue("1");
  },
  "New folder": async (page) => {
    await dashboard(page);
    await page.locator("#button-create").click();
    await page.locator(".new-menu").getByRole("button", { name: "Folder", exact: true }).click();
    await expect(page.locator("dialog[open]").getByLabel("Name", { exact: true })).toBeVisible();
  },
  rename: async (page) => {
    await dashboard(page);
    await action(page, "Rename");
    await expect(page.locator("dialog[open]").getByLabel("Name", { exact: true })).toHaveValue("Study metadata");
  },
  "discard confirmation": async (page) => {
    await screens.rename(page);
    await page.locator("dialog[open]").getByLabel("Name", { exact: true }).fill("Changed");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.confirmation-dialog")).toBeVisible();
  },
  "deletion confirmation": async (page) => {
    await dashboard(page);
    await action(page, "Delete");
  },
  "folder deletion": async (page) => {
    await openFolderDeletion(page);
  },
  "selection deletion": async (page) => {
    await selectionFixture(page);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await selectDeletion(page);
  },
  "OpenView confirmation": async (page) => {
    await dashboard(page);
    await action(page, "Enable Openview");
  },
  // The preview shows the artifact in CEE, which its own suite checks.
  preview: async (page) => {
    await dashboard(page);
    await page.getByRole("button", { name: "Preview Study metadata", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[aria-busy]")).toHaveAttribute("aria-busy", "false");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Study metadata");
    return ["cedar-embeddable-editor"];
  },
  "group deletion confirmation": async (page) => {
    await page.goto("/groups");
    await page.getByRole("tab", { name: "Delete group", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Delete group", exact: true });
    const find = panel.getByRole("combobox", { name: "Group name", exact: true });
    await find.fill("Research");
    await find.press("Enter");
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue("Research team");
    await panel.getByRole("button", { name: "Delete group", exact: true }).click();
    await expect(page.locator("dialog.confirmation-dialog")).toBeVisible();
  },
};
/** A home folder holding a folder that takes items and one that does not, as Move and Copy list them. */
async function folders(page) {
  const folder = (id, name, allowed = true) => ({
    "@id": id,
    resourceType: "folder",
    "schema:name": name,
    "pav:lastUpdatedOn": "2026-01-02T12:00:00Z",
    currentUserPermissions: { capabilities: allowed ? ["copyIntoFolder", "moveIntoFolder"] : [] },
  });
  const home = folder("home", "My workspace");
  const children = [folder("archive", "Archive"), folder("restricted", "Read only", false)];
  await page.route("**/folders/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("resource_types") && url.pathname.endsWith("/contents")) return route.fallback();
    const id = decodeURIComponent(url.pathname.split("/folders/")[1].split("/")[0]);
    if (url.pathname.endsWith("/contents"))
      return route.fulfill({
        json: {
          resources: id === "home" ? children : [],
          totalCount: id === "home" ? children.length : 0,
          pathInfo: [home],
        },
      });
    return route.fulfill({ json: [home, ...children].find((f) => f["@id"] === id) ?? home });
  });
}
/** The Move or Copy dialog, its folders listed. */
async function picker(page, label) {
  await folders(page);
  await dashboard(page);
  await action(page, label);
  await expect(page.locator("dialog .folder-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("dialog .folder-scroll tbody tr")).toHaveCount(2);
}
/** Select the listing's artifact, which opens it in the Information panel. */
async function select(page) {
  await page.locator('[data-resource-id="template"] .resource-icon').click();
  await expect(page.locator(".information h1")).toHaveText(resource["schema:name"]);
}
async function account(page, address) {
  await page.goto(address);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
}

/** Workspace is the page, so each check measures the whole of it. */
const scope = null;

/** Open overlays beyond the shared ones, whose cover hides the controls beneath until it closes. */
const overlays = [".popover", ".resource-menu", "details[open] > nav"];

/** Every selected item states its selection in ARIA, as a listing row does with aria-selected. */
const selected = [];

/**
 * Data tables that need scrolling in two dimensions, which may scroll sideways inside their own
 * container at 320 px rather than reflow.
 */
const tables = [
  {
    // A dialog opened over the listing leaves it as it is.
    screens: [
      "dashboard list",
      "filter popover",
      "Permissions",
      "ownership confirmation",
      "Move",
      "Copy",
      "Publish",
      "Create Draft",
      "New folder",
      "rename",
      "discard confirmation",
      "deletion confirmation",
      "selection deletion",
      "OpenView confirmation",
      "preview",
    ],
    target: "cedar-workspace.cedar-native-choices div.workspace div.table-scroll",
    reason:
      "The listing is a table of each item's name, last change, version and actions, which a narrow window scrolls inside its container.",
  },
];

/**
 * What the checks find that is left as it is, each with the visible change that would remove it.
 * Fixes that keep every captured width pixel-identical are made instead of listed here. Each entry
 * gives its check, kind, selector, states and why, as `Exception` in the generated declaration says.
 */
const exceptions = [];

/** Each layout check by the name its tests carry. */
const conditions = { reflow: "reflow", resize: "resize", "text spacing": "spacing" };

for (const [screen, open] of Object.entries(screens)) {
  for (const [condition, name] of Object.entries(conditions))
    test(`${screen} survives ${condition}`, async ({ page, api }) => {
      await page.setViewportSize(VIEWPORTS[name]);
      const exclude = (await open(page)) ?? [];
      await page.mouse.move(0, 0);
      const request = { check: name, state: screen, scope, exclude, exceptions };
      // Reach is measured at 320 px and at 640 by 400, and only reflow lets a table scroll in place.
      if (name !== "spacing") request.overlays = overlays;
      if (name === "reflow")
        request.scrollsInPlace = tables.map(({ target, reason, screens }) => ({
          selector: target,
          why: reason,
          states: screens,
        }));
      await check(page, expect, request);
    });
}

/** Each screen with placeholders, the dialogs and tabs that hold the rest among them, and what each shows. */
const fields = {
  "dashboard list": [screens["dashboard list"], ["Search", "No description"]],
  "filter popover": [screens["filter popover"], ["Search"]],
  groups: [screens.groups, ["Search", "Search for a group", "Optional description", "Search for a user"]],
  "Create group": [
    async (page) => {
      await page.goto("/groups");
      await page.getByRole("tab", { name: "Create group", exact: true }).click();
      await expect(page.getByLabel("Group name", { exact: true })).toBeVisible();
    },
    ["Search", "Enter a group name"],
  ],
  "Delete group": [
    async (page) => {
      await page.goto("/groups");
      await page.getByRole("tab", { name: "Delete group", exact: true }).click();
      await expect(page.locator("#delete-group-picker input")).toBeVisible();
    },
    ["Search", "Search for a group"],
  ],
  // Permissions holds the only placeholder in a dialog. Each other dialog shows only those of the
  // page behind it, which are measured again with the dialog over them.
  Permissions: [screens.Permissions, ["Search", "Search by name"]],
  "ownership confirmation": [screens["ownership confirmation"], ["Search", "Search by name"]],
  ...Object.fromEntries(
    [
      "Move",
      "Copy",
      "Publish",
      "Create Draft",
      "New folder",
      "rename",
      "discard confirmation",
      "deletion confirmation",
      "folder deletion",
      "selection deletion",
      "OpenView confirmation",
      "preview",
    ].map((name) => [name, [screens[name], ["Search"]]]),
  ),
  "group deletion confirmation": [screens["group deletion confirmation"], ["Search", "Search for a group"]],
};
for (const [screen, [open, shown]] of Object.entries(fields))
  test(`${screen} draws its placeholders at 4.5:1`, async ({ page, api }) => {
    await page.setViewportSize(VIEWPORTS.placeholder);
    const exclude = (await open(page)) ?? [];
    await page.mouse.move(0, 0);
    const { measured } = await check(page, expect, { check: "placeholder", state: screen, scope, exclude, exceptions });
    // The check counts what it measures. A count short of the placeholders shown means one went unmeasured.
    expect(measured.placeholder, `placeholders measured, of ${shown.join(", ")}`).toBe(shown.length);
  });

for (const [screen, open] of Object.entries(screens))
  test(`${screen} draws its field boundaries at 3:1`, async ({ page, api }) => {
    await page.setViewportSize(VIEWPORTS.boundary);
    const exclude = (await open(page)) ?? [];
    await page.mouse.move(0, 0);
    const { measured } = await check(page, expect, { check: "boundary", state: screen, scope, exclude, exceptions });
    // A selector that stops matching would let the check pass by measuring nothing.
    if (screen === "dashboard list") expect(measured.boundary, "controls that draw a boundary").toBeGreaterThan(0);
  });

for (const [screen, open] of Object.entries(screens))
  test(`${screen} draws its icons, focus indicators and selection marks at 3:1`, async ({ page, api }) => {
    await page.setViewportSize(VIEWPORTS.indicators);
    const exclude = (await open(page)) ?? [];
    await page.mouse.move(0, 0);
    const { measured } = await check(page, expect, {
      check: "indicators",
      state: screen,
      scope,
      exclude,
      selected,
      exceptions,
    });
    // A selector that stops matching would let the check pass by measuring nothing.
    if (screen === "dashboard list") {
      expect(measured.icon, "icons").toBeGreaterThan(0);
      expect(measured.focus, "focus indicators").toBeGreaterThan(0);
      expect(measured.selection, "selection marks").toBeGreaterThan(0);
    }
  });
