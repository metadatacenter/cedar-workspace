import { test, expect, dashboard, action, resource } from "./fixtures.mjs";
import AxeBuilder from "@axe-core/playwright";
import { tokenStyles, menuItemSpacing } from './overlay-spacing.mjs';

const owner = { "@id": "owner", firstName: "Alex", lastName: "Researcher" };
const user = { "@id": "collaborator", firstName: "Sam", lastName: "Curator" };
const group = { "@id": "team", "schema:name": "Research team" };

test("principal picker keeps pointer and keyboard selection readable and synchronized", async ({ page, api }) => {
  await page.route("**/templates/template/permissions", route => route.fulfill({
    json: { owner, userPermissions: [], groupPermissions: [] }, headers: { ETag: '"acl"' },
  }));
  await dashboard(page);
  await action(page, "Permissions…");
  const input = page.getByRole("combobox", { name: "User or group" });
  await input.fill("r");
  const team = page.getByRole("option", { name: "Research team (Group)", exact: true });
  const sam = page.getByRole("option", { name: "Sam Curator", exact: true });
  await expect(team).toHaveAttribute("aria-selected", "true");
  await tokenStyles(page.locator('cedar-group-picker [role="option"]'), menuItemSpacing);
  await sam.hover();
  await expect(sam).toHaveAttribute("aria-selected", "true");
  await expect(team).toHaveAttribute("aria-selected", "false");
  expect((await new AxeBuilder({ page }).include("cedar-group-picker").analyze()).violations).toEqual([]);
  await input.press("ArrowUp");
  await expect(team).toHaveAttribute("aria-selected", "true");
  await expect(sam).toHaveAttribute("aria-selected", "false");
  await expect(sam).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await sam.click();
  await expect(input).toHaveValue("Sam Curator");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
});

for (const kind of ["user", "group"]) {
  test(`adding and removing a ${kind} preserves the permissions form while saving and refreshing`, async ({ page, api }) => {
    let permissions = { owner, userPermissions: [], groupPermissions: [] };
    let finishWrite;
    let finishReport;
    await page.route("**/templates/template/permissions", async route => {
      if (route.request().method() === "PUT") {
        await new Promise(resolve => { finishWrite = resolve; });
        const submitted = route.request().postDataJSON();
        permissions = {
          owner,
          userPermissions: submitted.userPermissions.map(g => ({ ...g, user })),
          groupPermissions: submitted.groupPermissions.map(g => ({ ...g, group })),
        };
      }
      await route.fulfill({ json: permissions, headers: { ETag: '"acl"' } });
    });
    await dashboard(page);
    await action(page, "Permissions…");
    const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
    const input = dialog.getByRole("combobox", { name: "User or group" });
    await expect(input).toBeEnabled();
    await input.evaluate(el => { window.originalPermissionPicker = el; });
    const table = dialog.getByRole("table", { name: "Direct resource permissions" });
    const initialTop = (await table.boundingBox()).y;
    await page.route("**/templates/template/report", async route => {
      await new Promise(resolve => { finishReport = resolve; });
      await route.fulfill({ json: resource });
    });
    const name = kind === "user" ? "Sam Curator" : "Research team";
    await input.fill(name);
    await page.getByRole("option", { name: kind === "user" ? name : name + " (Group)", exact: true }).click();
    for (const operation of ["add", "remove"]) {
      finishWrite = undefined;
      finishReport = undefined;
      await dialog.getByRole("button", { name: operation === "add" ? "Add" : "Remove direct role for " + name, exact: true }).click();
      await expect.poll(() => !!finishWrite).toBe(true);
      await expect(input).toBeDisabled();
      expect((await table.boundingBox()).y).toBe(initialTop);
      finishWrite();
      await expect.poll(() => !!finishReport).toBe(true);
      await expect(input).toBeVisible();
      await expect(input).toBeDisabled();
      expect(await input.evaluate(el => el === window.originalPermissionPicker)).toBe(true);
      expect((await table.boundingBox()).y).toBe(initialTop);
      finishReport();
      await expect(input).toBeEnabled();
      await expect(table.getByText(name, { exact: true })).toHaveCount(operation === "add" ? 1 : 0);
    }
  });
}

for (const failure of [403, 409, 412, 428, 503, "invalid", "no-revision"]) {
  test(`permissions ${failure} blocks another write until an explicit valid reload`, async ({ page, api }) => {
    let writes = 0;
    let recovered = false;
    await page.route("**/templates/template/permissions", async route => {
      if (route.request().method() === "PUT") {
        writes++;
        if (typeof failure === "number") return route.fulfill({ status: failure, json: { errorMessage: "Permissions rejected" } });
        return route.fulfill({ json: failure === "invalid" ? {} : { owner, userPermissions: [{ user, role: "viewer" }], groupPermissions: [] }, headers: failure === "invalid" ? { ETag: '"bad"' } : {} });
      }
      return route.fulfill({ json: { owner, userPermissions: [], groupPermissions: [] }, headers: { ETag: recovered ? '"fresh"' : '"initial"' } });
    });
    await dashboard(page);
    await action(page, "Permissions…");
    const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
    const input = dialog.getByRole("combobox", { name: "User or group" });
    await input.fill("Sam");
    await page.getByRole("option", { name: "Sam Curator", exact: true }).click();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(writes).toBe(1);
    const add = dialog.getByRole("button", { name: "Add", exact: true });
    if (await add.count()) await expect(add).toBeDisabled();
    recovered = true;
    await dialog.getByRole("button", { name: "Reload permissions", exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(writes).toBe(1);
  });
}

test("an unchanged ACL acknowledgement blocks repeat writes until reload", async ({ page, api }) => {
  let writes = 0;
  await page.route("**/templates/template/permissions", route => {
    if (route.request().method() === "PUT") writes++;
    return route.fulfill({ json: { owner, userPermissions: [{ user, role: "viewer" }], groupPermissions: [] }, headers: { ETag: '"acl"' } });
  });
  await dashboard(page);
  await action(page, "Permissions…");
  const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
  const role = dialog.getByRole("combobox", { name: /Role for Sam/ });
  await role.selectOption("editor");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(role).toBeDisabled();
  expect(writes).toBe(1);
  await dialog.getByRole("button", { name: /Reload/ }).click();
  await expect(role).toBeEnabled();
  await expect(role).toHaveValue("viewer");
  expect(writes).toBe(1);
});

for (const width of [1440, 375]) {
  for (const reader of [false, true]) {
    test(`caller access and role explanations stay readable at ${width} for ${reader ? "reader" : "owner"}`, async ({ page, api }, testInfo) => {
      await page.setViewportSize({ width, height: 950 });
      api.readonly = reader;
      await page.route("**/templates/template/report", route => route.fulfill({
        json: { ...resource, currentUserPermissions: reader
          ? { role: "viewer", owner: false, capabilities: ["readResource"] }
          : resource.currentUserPermissions },
      }));
      await dashboard(page);
      await action(page, "Permissions…");
      const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
      const summary = dialog.locator(".caller-access");
      await expect(summary).toContainText(reader ? "Your role: Viewer." : "You own this resource.");
      await expect(summary).toContainText(reader ? "You cannot change roles on this resource." : "You can change roles on this resource.");
      await expect(dialog.locator(".role-help")).toContainText("can view, edit and delete.");
      await expect(dialog).toContainText("Removing a direct role may leave access from these sources.");
      if (!reader) await expect(dialog).toContainText("You do not need to belong to the group.");
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await dialog.locator(".access-list").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
      expect((await new AxeBuilder({ page }).include("cedar-permissions-dialog").analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("permissions.png") });
    });
  }
}

test("caller summary follows a saved self-demotion and clears after a failed access refresh", async ({ page, api }) => {
  let access = { role: "manager", owner: false, capabilities: ["readResource", "manageGrants"] };
  let failed = false;
  await page.route("**/templates/template/report", route => route.fulfill(failed
    ? { status: 503, json: { errorMessage: "Access report unavailable" } }
    : { json: { ...resource, currentUserPermissions: access } }));
  await page.route("**/templates/template/permissions", route => {
    if (route.request().method() === "PUT") {
      access = { role: "viewer", owner: false, capabilities: ["readResource"] };
      return route.fulfill({ json: { ...route.request().postDataJSON(), owner: user }, headers: { ETag: '"changed"' } });
    }
    return route.fulfill({ json: { owner: user, userPermissions: [{ user: owner, role: "manager" }], groupPermissions: [] }, headers: { ETag: '"initial"' } });
  });
  await dashboard(page);
  await action(page, "Permissions…");
  const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
  await expect(dialog.locator(".caller-access")).toContainText("Your role: Manager.");
  await dialog.getByRole("combobox", { name: "Role for Alex Researcher" }).selectOption("viewer");
  await expect(dialog.locator(".caller-access")).toContainText("Your role: Viewer. You cannot change roles on this resource.");
  await expect(dialog.getByRole("combobox", { name: "User or group" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  failed = true;
  await action(page, "Permissions…");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.locator(".caller-access")).toHaveCount(0);
});
