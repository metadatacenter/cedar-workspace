import { test, expect, dashboard, action, resource } from "./fixtures.mjs";
import { focusedControl, tabSequence } from "./focus.mjs";

const items = [
  { ...resource, "@id": "reports", resourceType: "folder", "schema:name": "Reports" },
  resource,
  { ...resource, "@id": "record", resourceType: "instance", "schema:name": "Study record" },
];

/** List a folder, a template and an instance; the shared fixture answers the rest. */
async function listItems(page) {
  await page.route("**/api/resource/folders/home/contents?**", (route) =>
    route.fulfill({ json: { resources: items, totalCount: items.length, pathInfo: [] } }),
  );
}

test("the list view gives each row's type as text that takes no Tab stop", async ({ page, api }) => {
  await listItems(page);
  await page.goto("/dashboard?view=list");
  for (const [type, name] of [
    ["Folder", "Reports"],
    ["Template", "Study metadata"],
    ["Instance", "Study record"],
  ]) {
    const row = page.getByRole("row", { name: new RegExp(`^${type} ${name} `) });
    await expect(row).toHaveCount(1);
    // The icon stays hidden, and its type is said once, in the language of the page.
    await expect(row.locator(".resource-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(row.getByText(type, { exact: true })).toHaveClass("sr-only");
  }
  const reachable = await page
    .locator(".explorer-item td:first-child *")
    .evaluateAll((nodes) => nodes.filter((node) => node.tabIndex >= 0).map((node) => node.localName));
  // Only the folder's and the artifacts' name links take focus in the name cell.
  expect(reachable).toEqual(["a", "a", "a"]);
});

test("the grid view's cards say their type once, as the text they show", async ({ page, api }) => {
  await listItems(page);
  await page.goto("/dashboard?view=grid");
  const card = page.locator('[data-resource-id="template"]');
  await expect(card.locator(".explorer-kind")).toHaveText("Template ·");
  await expect(card).toHaveAccessibleName(/^1\.0\.0 Draft Study metadata Preview Study metadata Template · /);
  expect((await card.textContent()).match(/Template/g)).toHaveLength(1);
});

test("the last administrator's refused controls explain themselves to focus and to a screen reader", async ({
  page,
  api,
}) => {
  await page.goto("/groups");
  const find = page.getByRole("combobox", { name: "Find a group", exact: true });
  await find.fill("Research");
  await find.press("Enter");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Research team");
  const tip = page.getByRole("tooltip");
  const admin = page.getByRole("checkbox", {
    name: "Alex Researcher is a Group Administrator",
    exact: true,
  });
  const bin = page.getByRole("button", {
    name: "Remove Alex Researcher from the group",
    exact: true,
  });
  const lastAdmin = "A group must have at least one Group Administrator.";
  const assignAnother = "Assign another Group Administrator before removing this member.";
  await expect(admin).toBeChecked();
  await expect(admin).toBeDisabled();
  await expect(admin).toHaveAccessibleDescription(lastAdmin);
  await expect(bin).toBeDisabled();
  await expect(bin).toHaveAccessibleDescription(assignAnother);
  // The stand-in is exactly the disabled checkbox it shows, which the screen reader does not hear twice.
  const shown = admin.locator("input");
  await expect(shown).toBeDisabled();
  await expect(shown).toHaveAttribute("aria-hidden", "true");
  expect(await admin.boundingBox()).toEqual(await shown.boundingBox());

  // Each takes keyboard focus, which opens the help a pointer opens.
  await page.getByRole("combobox", { name: "Add a member", exact: true }).focus();
  expect(await tabSequence(page, 1)).toEqual([
    'checkbox "Alex Researcher is a Group Administrator"',
  ]);
  await expect(tip).toHaveText(lastAdmin);
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  expect(await tabSequence(page, 1)).toEqual([
    'button "Remove Alex Researcher from the group"',
  ]);
  await expect(tip).toHaveText(assignAnother);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  // A pointer refuses too, and hovering still opens the help.
  await admin.click({ force: true });
  await bin.click({ force: true });
  await expect(page.locator("dialog.confirmation-dialog")).toHaveCount(0);
  expect(api.requests.filter((request) => request.method !== "GET")).toEqual([]);
  await expect(admin).toBeChecked();
  await expect(page.locator(".groups-member-row")).toHaveCount(2);
  await page.mouse.move(0, 0);
  await page.locator(".groups-admin-control").first().hover();
  await expect(tip).toHaveText(lastAdmin);

  // Once another member is an administrator, both checkboxes are ordinary ones again.
  await page.mouse.move(0, 0);
  await page
    .getByRole("checkbox", { name: "Sam Curator is a Group Administrator", exact: true })
    .click();
  await page
    .locator("dialog.confirmation-dialog")
    .getByRole("button", { name: "Yes", exact: true })
    .click();
  await expect(admin).toBeEnabled();
  await expect(page.locator(".groups-admin-refused")).toHaveCount(0);
  await expect(bin).toBeEnabled();
  await expect(bin).not.toHaveAttribute("aria-describedby");
});

test("help on a wrapper stays closed when an enabled control inside it takes focus", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Permissions…");
  const owner = page.getByRole("checkbox", { name: "Make Sam Curator the owner", exact: true });
  await page.keyboard.press("Shift");
  await owner.focus();
  await expect.poll(() => owner.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
  expect(await focusedControl(page)).toBe('checkbox "Make Sam Curator the owner"');
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("the Permissions dialog's owner checkboxes explain themselves to focus and to a screen reader", async ({
  page,
  api,
}) => {
  api.permissions.groupPermissions = [
    { group: { "@id": "team", "schema:name": "Research team" }, role: "viewer" },
  ];
  await dashboard(page);
  await action(page, "Permissions…");
  const dialog = page.getByRole("dialog", { name: "Permissions" });
  const tip = page.getByRole("tooltip");
  const owner = dialog.getByRole("checkbox", { name: "Alex Researcher is the owner", exact: true });
  const group = dialog.getByRole("checkbox", { name: "Make Research team the owner", exact: true });
  const ownerHelp = "The owner can manage access and transfer ownership.";
  const groupHelp = "A group cannot own a resource.";
  await expect(owner).toBeChecked();
  await expect(owner).toBeDisabled();
  await expect(owner).toHaveAccessibleDescription(ownerHelp);
  await expect(group).not.toBeChecked();
  await expect(group).toBeDisabled();
  await expect(group).toHaveAccessibleDescription(groupHelp);
  // Each stand-in is exactly the disabled checkbox it shows, which the screen reader does not hear twice.
  for (const standIn of [owner, group]) {
    const shown = standIn.locator("input");
    await expect(shown).toBeDisabled();
    await expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(await standIn.boundingBox()).toEqual(await shown.boundingBox());
  }

  // Each takes keyboard focus, which opens the help a pointer opens.
  await dialog.getByRole("combobox", { name: "User or group", exact: true }).focus();
  expect(await tabSequence(page, 1)).toEqual(['checkbox "Alex Researcher is the owner"']);
  await expect(tip).toHaveText(ownerHelp);
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await dialog.getByRole("combobox", { name: "Role for Research team", exact: true }).focus();
  expect(await tabSequence(page, 1)).toEqual(['checkbox "Make Research team the owner"']);
  await expect(tip).toHaveText(groupHelp);
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  // A pointer refuses too, and hovering still opens the help.
  await owner.click({ force: true });
  await group.click({ force: true });
  await expect(page.locator("dialog.confirmation-dialog")).toHaveCount(0);
  expect(api.requests.filter((request) => request.method !== "GET")).toEqual([]);
  await expect(owner).toBeChecked();
  await expect(group).not.toBeChecked();
  await expect(dialog).toBeVisible();
  await page.mouse.move(0, 0);
  await group.hover();
  await expect(tip).toHaveText(groupHelp);
  await page.mouse.move(0, 0);
  await owner.hover();
  await expect(tip).toHaveText(ownerHelp);

  // A user's checkbox stays an ordinary one, which describes nothing it does not show.
  const user = dialog.getByRole("checkbox", { name: "Make Sam Curator the owner", exact: true });
  await expect(user).toBeEnabled();
  await expect(user).toHaveAccessibleDescription("");
});

test("a refused Save explains itself to focus and to a screen reader", async ({ page, api }) => {
  await page.goto("/instances/edit/instance");
  await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
  const report = (problems) =>
    page.evaluate((problems) => {
      const editor = document.querySelector("cedar-embeddable-editor");
      editor.dataQualityReport = { isValid: !problems.length, problems };
      editor.dispatchEvent(new CustomEvent("change"));
    }, problems);
  await report([{ path: ["Email"], code: "valueShape", severity: "error", message: "Enter a valid email address." }]);
  const save = page.getByRole("button", { name: "Save", exact: true });
  const tip = page.getByRole("tooltip");
  const refused = "Cannot save until errors are fixed";
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).not.toHaveAttribute("disabled");
  await expect(save).toHaveAccessibleDescription(`${refused} 1 error — fix before saving`);

  // It takes keyboard focus, which opens the help a pointer opens, and refuses a key or a click.
  await page.getByRole("button", { name: "Back to Workspace", exact: true }).focus();
  expect(await tabSequence(page, 1)).toEqual(['button "Save"']);
  await expect(tip).toHaveText(refused);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await save.click({ force: true });
  await expect(page.locator(".metadata-save-status")).toHaveText("Unmodified");
  expect(api.requests.filter((request) => request.method !== "GET")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  // Once the errors are fixed, Save is an ordinary button again, with nothing to explain.
  await report([]);
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute("aria-disabled");
  await expect(save).not.toHaveAttribute("aria-describedby");
  await page.getByRole("button", { name: "Back to Workspace", exact: true }).focus();
  expect(await tabSequence(page, 1)).toEqual(['button "Save"']);
  await page.waitForTimeout(400);
  await expect(tip).toHaveCount(0);

  // A Save held back for a reload stays disabled, since the alert beside it says why.
  api.fail = true;
  await page.getByLabel("Instance name").fill("Changed record");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("This item changed since you opened it.");
  await expect(save).toHaveAttribute("disabled");
  await expect(save).not.toHaveAttribute("aria-disabled");
  await expect(save).not.toHaveAttribute("aria-describedby");
});
