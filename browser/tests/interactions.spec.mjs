import { test, expect, dashboard, action } from "./fixtures.mjs";

test("artifact commands support keyboard navigation, Escape, and return focus", async ({
  page,
  api,
}) => {
  await dashboard(page);
  const trigger = page.getByRole("button", {
    name: "Actions for Study metadata",
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const enabled = page.locator(".resource-menu button:enabled");
  await expect(enabled.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(enabled.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(enabled.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(enabled.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".resource-menu")).toHaveCount(0);
  await action(page, "Permissions…");
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("picker Escape closes suggestions before closing the containing dialog", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Permissions…");
  const input = page.getByRole("combobox", {
    name: "User or group",
    exact: true,
  });
  await input.fill("Research");
  await expect(
    page.locator('cedar-group-picker [role="option"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('cedar-group-picker [role="option"]')).toHaveCount(
    0,
  );
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(input).toBeFocused();
});

test("failed save retains input, sends its revision, and blocks duplicate submission", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Rename");
  api.fail = true;
  api.pending = true;
  const input = page.getByLabel("Name", { exact: true });
  await input.fill("Unsaved study");
  const save = page
    .locator("dialog")
    .getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Your edits have been kept",
  );
  await expect(input).toHaveValue("Unsaved study");
  expect(api.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  expect(api.requests.find((r) => r.method === "POST").revision).toBe(
    '"fixture-revision"',
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("delete names its target and cancellation makes no request", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Delete");
  await expect(page.locator("dialog")).toContainText("Study metadata");
  await expect(page.locator("dialog")).toContainText("This will delete");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(api.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});

test("URL retains search, ordering and page through reload and Back", async ({
  page,
  api,
}) => {
  await page.goto("/dashboard?search=study&sort=-name&offset=50");
  await expect(page.locator("th").first()).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  expect(api.requests.some((r) => r.path.endsWith("/search"))).toBe(true);
  await page.getByRole("button", { name: "Title", exact: false }).click();
  await expect(page).toHaveURL(/sort=name/);
  await page.reload();
  await expect(page.locator("th").first()).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await page.goBack();
  await expect(page).toHaveURL(/offset=50/);
});

test("unsaved metadata cannot be lost by leaving, and read-only mode cannot save", async ({
  page,
  api,
}) => {
  await page.goto("/instances/edit/instance");
  const input = page.getByLabel("Metadata name");
  await expect(input).toHaveValue("Study record");
  await input.fill("Working record");
  await expect(page.locator(".metadata-toolbar")).toContainText(
    "Unsaved changes",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(input).toHaveValue("Working record");
  await input.fill("Study record");
  await expect(page.locator(".metadata-toolbar")).toContainText("Saved");
  api.readonly = true;
  await page.reload();
  await expect(input).toHaveAttribute("readonly", "");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
});

test("field errors are linked to inputs and invalid forms send no write", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Rename");
  const input = page.getByLabel("Name", { exact: true });
  await input.fill("   ");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#name-error")).toHaveText("Enter a name.");
  expect(api.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});

test("ownership confirmation identifies recipient and cancellation preserves permissions", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Permissions…");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Sam Curator");
    expect(dialog.message()).toContain("Study metadata");
    await dialog.dismiss();
  });
  await page
    .getByRole("checkbox", { name: "Make Sam Curator the owner" })
    .click();
  expect(api.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
});

test("no-match feedback is announced and clearing recovers the picker", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Permissions…");
  const input = page.getByRole("combobox", {
    name: "User or group",
    exact: true,
  });
  await input.fill("absent user");
  await expect(page.getByRole("status")).toContainText("No matches found");
  await input.fill("");
  await expect(page.getByText("No matches found.")).toHaveCount(0);
  await input.fill("Research");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Add", exact: true }),
  ).toBeEnabled();
});
