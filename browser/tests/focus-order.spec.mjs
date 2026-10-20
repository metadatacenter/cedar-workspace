import { test, expect, resource } from "./fixtures.mjs";
import { focusedControl, tabSequence } from "./focus.mjs";

/** Tab from where focus is until it comes back round, naming each stop once. */
async function cycle(page) {
  const stops = await tabSequence(page, 1);
  while (stops.length < 80) {
    stops.push(...(await tabSequence(page, 1)));
    if (stops.at(-1) === stops[0]) return stops.slice(0, -1);
  }
  throw new Error("focus never came back round: " + stops.join(", "));
}

async function loaded(page, address) {
  await page.goto(address);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

const header = [
  'button "Collapse navigation"',
  'link "CEDAR Workspace"',
  'textbox "Search workspace"',
  'button "Search"',
  'summary "User menu"',
  'summary "Actions menu"',
  'button "Collapse information"',
];
const navigation = [
  'button "New"',
  'link "Home"',
  'link "Shared with Me"',
  'link "Shared with Everyone"',
  'link "Community Folders"',
];
const toolbar = [
  'link "My workspace"',
  'button "Refresh workspace"',
  'button "Type"',
  'button "Last modified"',
  'combobox "Version"',
  'button "List view"',
  'button "Grid view"',
];

test("the dashboard's Tab order in grid view runs header, navigation, toolbar, then each card", async ({
  page,
  api,
}) => {
  await loaded(page, "/dashboard");
  expect(await cycle(page)).toEqual([
    ...header,
    ...navigation,
    ...toolbar,
    'button "Sort options"',
    'row "1.0.0Draft Study metadata Preview Study metadata Template · 1 day ago Populate template Actions for Study metadata"',
    'button "Preview Study metadata"',
    'link "Populate template"',
    'button "Actions for Study metadata"',
    "(page)",
  ]);
});

test("the dashboard's Tab order in list view reaches the column sorts and each row's controls", async ({
  page,
  api,
}) => {
  await loaded(page, "/dashboard?view=list");
  expect(await cycle(page)).toEqual([
    ...header,
    ...navigation,
    ...toolbar,
    'button "Name"',
    'button "Last modified"',
    'button "Sort options"',
    'row "Template Study metadata 1 day ago 1.0.0Draft Populate template Preview Study metadata Actions for Study metadata"',
    'link "Study metadata"',
    'link "Populate template"',
    'button "Preview Study metadata"',
    'button "Actions for Study metadata"',
    "(page)",
  ]);
});

test("with an item selected, Tab goes on from its row into the Information panel", async ({
  page,
  api,
}) => {
  await loaded(page, "/dashboard?view=list");
  await page.getByRole("row", { name: /^Template Study metadata/ }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Resource information" })
      .getByRole("heading"),
  ).toHaveText("Study metadata");
  expect(await cycle(page)).toEqual([
    'link "Study metadata"',
    'link "Populate template"',
    'button "Preview Study metadata"',
    'button "Actions for Study metadata"',
    'tab "Details"',
    'tab "Version"',
    'link "template"',
    'button "Preview Study metadata"',
    'button "Copy identifier"',
    'textbox "Description"',
    "(page)",
    ...header,
    ...navigation,
    ...toolbar.slice(0, 5),
    'button "Delete (1)"',
    ...toolbar.slice(5),
    'button "Name"',
    'button "Last modified"',
    'button "Sort options"',
    'row "Template Study metadata 1 day ago 1.0.0Draft Populate template Preview Study metadata Actions for Study metadata"',
  ]);
});

test("an open header menu takes Tab through its links before the next control", async ({
  page,
  api,
}) => {
  await loaded(page, "/dashboard");
  await page.getByRole("textbox", { name: "Search workspace" }).focus();
  expect(await tabSequence(page, 2)).toEqual([
    'button "Search"',
    'summary "User menu"',
  ]);
  await page.keyboard.press("Enter");
  expect(await tabSequence(page, 4)).toEqual([
    'link "Profile"',
    'link "Settings"',
    'link "Logout"',
    'summary "Actions menu"',
  ]);
});

test("Groups' Tab order runs header, the way back, the tabs, then the selected group", async ({
  page,
  api,
}) => {
  const top = [
    'link "CEDAR Workspace"',
    'textbox "Search workspace"',
    'button "Search"',
    'summary "User menu"',
    'summary "Actions menu"',
    'link "Back to Workspace"',
    'tab "Manage groups"',
    'tab "Create group"',
    'tab "Delete group"',
  ];
  await loaded(page, "/groups");
  expect(await cycle(page)).toEqual([
    ...top,
    'combobox "Find a group"',
    "(page)",
  ]);
  const find = page.getByRole("combobox", {
    name: "Find a group",
    exact: true,
  });
  await find.fill("Research");
  await find.press("Enter");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Research team",
  );
  await find.focus();
  expect(await cycle(page)).toEqual([
    'textbox "Name"',
    'textbox "Description"',
    'button "Save"',
    'combobox "Add a member"',
    'checkbox "Alex Researcher is a Group Administrator"',
    'button "Remove Alex Researcher from the group"',
    'checkbox "Sam Curator is a Group Administrator"',
    'button "Remove Sam Curator from the group"',
    "(page)",
    ...top,
    'combobox "Find a group"',
  ]);
  await page.getByRole("tab", { name: "Create group", exact: true }).click();
  await expect(page.getByLabel("Group name", { exact: true })).toBeVisible();
  expect(await tabSequence(page, 2)).toEqual([
    'tab "Delete group"',
    'textbox "Group name"',
  ]);
  await page.getByRole("tab", { name: "Delete group", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Delete group", exact: true }),
  ).toBeVisible();
  expect(await tabSequence(page, 5)).toEqual([
    'combobox "Group name"',
    'textbox "Name"',
    'textbox "Description"',
    'button "Delete group"',
    "(page)",
  ]);
});

test("Profile's Tab order runs the way back, the copy buttons, the key form and the examples", async ({
  page,
  api,
}) => {
  await loaded(page, "/profile");
  expect(await cycle(page)).toEqual([
    'link "Back to Workspace"',
    'button "Copy First name"',
    'button "Copy Last name"',
    'button "Copy Email"',
    'button "Copy UUID"',
    'button "Copy @id"',
    'button "Copy Home folder id"',
    'button "Copy Encoded home folder id"',
    'textbox "New key description (optional)"',
    'button "New key"',
    'button "Copy example: List your home folder contents"',
    'button "Copy example: List resources shared with you"',
    'button "Copy example: Retrieve a template"',
    'button "Copy example: Create a template"',
    'button "Copy example: Update a template (use the ETag returned by GET)"',
    'button "Copy example: Get metadata based on a template"',
    "(page)",
  ]);
});

for (const address of ["/settings", "/privacy"])
  test(`${address.slice(1)} has one control, the way back`, async ({
    page,
    api,
  }) => {
    await loaded(page, address);
    expect(await cycle(page)).toEqual(['link "Back to Workspace"', "(page)"]);
  });

const archive = {
  ...resource,
  "@id": "archive",
  resourceType: "folder",
  "schema:name": "Archive",
  currentUserPermissions: {
    capabilities: ["readResource", "moveIntoFolder", "copyIntoFolder"],
  },
};
const records = ["a", "b", "c"].map((id) => ({
  ...resource,
  "@id": id,
  resourceType: "instance",
  "schema:name": `Record ${id}`,
}));
const row = (id) =>
  `row "Instance Record ${id} 1 day ago Preview Record ${id} Actions for Record ${id}"`;

/**
 * Home lists records a, b and c, after the Archive folder when `folder` is set. Deleting a record
 * or moving it into Archive takes it out of the listing.
 */
async function records3(page, { folder = false } = {}) {
  const gone = new Set();
  await page.route("**/api/resource/**", (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path.endsWith("/move-resource-to-folder")) {
      gone.add(request.postDataJSON()["@id"]);
      return route.fulfill({ json: {} });
    }
    if (request.method() === "DELETE") {
      gone.add(path.split("/").at(-1));
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/contents")) {
      const id = path.split("/").at(-2);
      const resources =
        id !== "home"
          ? []
          : url.searchParams.get("resource_types") === "folder"
            ? [archive]
            : [
                ...(folder ? [archive] : []),
                ...records.filter((r) => !gone.has(r["@id"])),
              ];
      return route.fulfill({
        json: { resources, totalCount: resources.length, pathInfo: [] },
      });
    }
    if (path.endsWith("/folders/archive"))
      return route.fulfill({ json: archive, headers: { ETag: '"archive"' } });
    const r = records.find((r) => path.split("/").includes(r["@id"]));
    return r
      ? route.fulfill({
          json: {
            ...r,
            pathInfo: [{ "@id": "home", resourceType: "folder" }, r],
          },
          headers: { ETag: `"${r["@id"]}"` },
        })
      : route.fallback();
  });
  await loaded(page, "/dashboard?view=list");
}

/** Choose `name` from the menu of the record `id` by keyboard, as from its focused row. */
async function command(page, id, name) {
  await page.getByRole("row", { name: new RegExp(`^Instance Record ${id} `) }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await focusedControl(page)).toBe(`button "Actions for Record ${id}"`);
  await page.keyboard.press("Enter");
  await page
    .locator(".resource-menu")
    .getByRole("button", { name, exact: true })
    .focus();
  await page.keyboard.press("Enter");
  return page.getByRole("dialog");
}

test("deleting the focused item moves focus to the row in its place, the last row, then Refresh", async ({
  page,
  api,
}) => {
  await records3(page);
  for (const [id, next] of [
    ["b", row("c")],
    ["c", row("a")],
    ["a", 'button "Refresh workspace"'],
  ]) {
    const dialog = await command(page, id, "Delete");
    await dialog
      .getByRole("button", { name: "Yes, delete it!", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("row", { name: new RegExp(`^Instance Record ${id} `) }),
    ).toHaveCount(0);
    await expect.poll(() => focusedControl(page)).toBe(next);
  }
});

test("deleting the focused item from the selection bin moves focus to the row in its place", async ({
  page,
  api,
}) => {
  await records3(page);
  await page.getByRole("row", { name: new RegExp("^Instance Record b ") }).click();
  await page.getByRole("button", { name: "Delete (1)", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("row", { name: /^Instance Record b / })).toHaveCount(0);
  await expect.poll(() => focusedControl(page)).toBe(row("c"));
});

test("moving the focused item moves focus to the row in its place", async ({
  page,
  api,
}) => {
  await records3(page, { folder: true });
  const dialog = await command(page, "b", "Move");
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(dialog.locator(".folder-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row", { name: /^Instance Record b / })).toHaveCount(0);
  await expect.poll(() => focusedControl(page)).toBe(row("c"));
});

test("Tab leaves an open resource menu for the next row, and Shift+Tab for its button", async ({
  page,
  api,
}) => {
  await records3(page);
  const trigger = page.getByRole("button", {
    name: "Actions for Record b",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => focusedControl(page)).toBe('button "Open"');
  expect(await tabSequence(page, 7)).toEqual([
    'button "Permissions…"',
    'button "Copy"',
    'button "Move"',
    'button "Rename"',
    'button "Delete"',
    'button "Enable Openview"',
    row("c"),
  ]);
  await page.keyboard.press("Escape");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => focusedControl(page)).toBe('button "Open"');
  expect(await tabSequence(page, 1, "Shift+Tab")).toEqual([
    'button "Actions for Record b"',
  ]);
});

const pages = Array.from({ length: 120 }, (_, index) => ({
  ...resource,
  "@id": `item-${index + 1}`,
  resourceType: "instance",
  "schema:name": `Record ${index + 1}`,
}));

test("a page button keeps focus through loading, and the last page hands it to Previous", async ({
  page,
  api,
}) => {
  await page.route("**/api/resource/folders/home/contents?**", (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset") || 0,
    );
    return route.fulfill({
      json: {
        resources: pages.slice(offset, offset + 50),
        totalCount: pages.length,
        pathInfo: [],
      },
    });
  });
  await loaded(page, "/dashboard?view=list");
  const footer = page.locator(".paging > span:not(.sr-only)");
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(footer).toHaveText("Displaying 51–100 of 120");
  await expect.poll(() => focusedControl(page)).toBe('button "Next"');
  await page.keyboard.press("Enter");
  await expect(footer).toHaveText("Displaying 101–120 of 120");
  await expect(next).toBeDisabled();
  await expect.poll(() => focusedControl(page)).toBe('button "Previous"');
});

test("clearing a filter moves focus to its chip, and clearing them all to the first chip", async ({
  page,
  api,
}) => {
  await loaded(page, "/dashboard?resource_types=folder&modified=week");
  await page
    .getByRole("button", { name: "Clear type filter", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/resource_types/);
  await expect.poll(() => focusedControl(page)).toBe('button "Type"');
  await page
    .getByRole("button", { name: "Clear last modified filter", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/modified=/);
  await expect.poll(() => focusedControl(page)).toBe('button "Last modified"');
  await page.goto("/dashboard?resource_types=folder&modified=week");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/resource_types|modified=/);
  await expect.poll(() => focusedControl(page)).toBe('button "Type"');
});

test("dismissing a notification or an error returns focus to where it came from", async ({
  page,
  api,
}) => {
  await loaded(page, "/dashboard?view=list");
  const toggle = page.getByRole("button", {
    name: "Collapse information",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Actions for Study metadata", exact: true })
    .click();
  await page
    .locator(".resource-menu")
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("Saved.");
  await toggle.focus();
  expect(await tabSequence(page, 1)).toEqual(['button "Dismiss notification"']);
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect
    .poll(() => focusedControl(page))
    .toBe('button "Collapse information"');

  await page.route("**/api/resource/folders/home/contents?**", (route) =>
    route.fulfill({ status: 503, json: { message: "Listing unavailable" } }),
  );
  await page
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Listing unavailable");
  await toggle.focus();
  expect(await tabSequence(page, 1)).toEqual(['button "Dismiss error"']);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => focusedControl(page))
    .toBe('button "Collapse information"');
});
