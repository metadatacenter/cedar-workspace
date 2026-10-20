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
  await expect(card.locator(".sr-only")).toHaveCount(0);
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
