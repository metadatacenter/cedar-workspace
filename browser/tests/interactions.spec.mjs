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
  await page.keyboard.press("Escape");
  await expect(page.locator(".confirmation-dialog")).toContainText(
    "Discard unsaved changes?",
  );
  await page
    .locator(".confirmation-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.locator(".confirmation-dialog")).toHaveCount(0);
  await input.focus();
  await page.keyboard.press("Escape");
  await page
    .locator(".confirmation-dialog")
    .getByRole("button", { name: "OK", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("delete names its target and cancellation makes no request", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Delete");
  await expect(page.locator("dialog")).toContainText("Study metadata");
  await expect(page.locator("dialog")).toContainText(
    "Are you sure you want to delete the selected template?",
  );
  await expect(page.locator("dialog").getByRole("button", {
    name: "Yes, delete it!", exact: true,
  })).toBeVisible();
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
  await page.getByRole("button", { name: "Name", exact: false }).click();
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
  const input = page.getByLabel("Metadata Name", { exact: true });
  await expect(input).toHaveValue("Study record");
  await input.fill("Working record");
  await expect(page.locator(".metadata-save-status")).toHaveClass(/is-dirty/);
  expect(await page.locator(".metadata-save-status").evaluate((el) =>
    getComputedStyle(el, "::before").backgroundColor)).toBe("rgb(234, 179, 8)");
  await expect(page.locator(".metadata-toolbar")).toContainText(
    "Unsaved changes",
  );
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page
    .locator(".confirmation-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(input).toHaveValue("Working record");
  await input.fill("Study record");
  await expect(page.locator(".metadata-toolbar")).toContainText("Saved");
  await expect(page.locator(".metadata-save-status")).not.toHaveClass(/is-dirty/);
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
  await page
    .getByRole("checkbox", { name: "Make Sam Curator the owner" })
    .click();
  await expect(page.locator(".confirmation-dialog")).toContainText(
    "Sam Curator",
  );
  await expect(page.locator(".confirmation-dialog")).toContainText(
    "Study metadata",
  );
  await page
    .locator(".confirmation-dialog")
    .getByRole("button", { name: "Cancel" })
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

test("New menu offers only supported creation actions", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  const menu = page.locator(".new-menu nav");
  await expect(menu).toBeVisible();
  await expect(menu.locator("a, button")).toHaveText([
    "Folder",
    "Field",
    "Element",
    "Template",
  ]);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("group members are removed immediately without confirmation and show a success notice", async ({
  page,
  api,
}) => {
  page.on("dialog", () => {
    throw new Error("Unexpected browser popup");
  });
  await page.goto("/groups");
  await page.getByRole("tab", { name: "Create group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Research team");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.locator(".groups-member-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  const remove = page
    .locator(".groups-member-row")
    .filter({ hasText: "Sam Curator" })
    .getByRole("button");
  await remove.click();
  await expect(page.locator(".confirmation-dialog")).toHaveCount(0);
  await expect(page.locator(".groups-member-row")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("Group members saved.");
  expect(api.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  if (process.env.WORKSPACE_VISUAL)
    await expect(page.locator(".toast")).toHaveScreenshot(
      "group-success-toast.png",
    );
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("group creation errors do not offer unrelated reloads, but stale edits can recover", async ({ page, api }) => {
  await page.goto("/groups");
  const search = page.getByRole("combobox", { name: "Find a group", exact: true });
  await search.fill("Research");
  await search.press("Enter");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Research team");
  await page.getByRole("tab", { name: "Create group", exact: true }).click();
  await page.route("**/api/group/groups", route => route.request().method() === "POST"
    ? route.fulfill({ status: 409, json: { message: "Group names must be unique" } })
    : route.fallback());
  const name = page.getByLabel("Group name", { exact: true });
  await name.fill("Research team");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Group names must be unique");
  await expect(name).toHaveValue("Research team");
  await expect(page.getByRole("button", { name: "Reload group" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Manage groups", exact: true }).click();
  api.fail = true;
  await page.getByLabel("Name", { exact: true }).fill("My edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reload group" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My edit");
  api.fail = false;
  await page.getByRole("button", { name: "Reload group" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Research team");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("success toast expires and pauses while hovered without blocking the form", async ({
  page,
  api,
}) => {
  await page.clock.install();
  await page.goto("/groups");
  await page.getByRole("tab", { name: "Create group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Research team");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.clock.runFor(7000);
  await expect(toast).toBeVisible();
  await page.getByLabel("Name", { exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Updated group");
  await page.clock.runFor(6100);
  await expect(toast).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Updated group",
  );
});

for (const [label, field] of [
  ["Last modified", "lastUpdatedOnTS"],
]) {
  test(`${label} sorting shows direction and survives reload`, async ({
    page,
    api,
  }) => {
    await page.goto("/dashboard?offset=50");
    const heading = page.getByRole("columnheader", {
      name: label,
      exact: true,
    });
    const button = heading.getByRole("button", { name: label });
    await button.click();
    await expect(page).toHaveURL(new RegExp(`sort=${field}`));
    await expect(heading).toHaveAttribute("aria-sort", "ascending");
    await expect(
      heading.locator('[data-cedar-icon="chevron-up"]'),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/offset=50/);
    await button.click();
    await expect(page).toHaveURL(new RegExp(`sort=-${field}`));
    await expect(heading).toHaveAttribute("aria-sort", "descending");
    await expect(
      heading.locator('[data-cedar-icon="chevron-down"]'),
    ).toBeVisible();
    await page.reload();
    await expect(heading).toHaveAttribute("aria-sort", "descending");
    await expect(
      heading.locator('[data-cedar-icon="chevron-down"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Name" }),
    ).toHaveAttribute("aria-sort", "none");
  });
}

test("folder separators have no surrounding spacing in navigation, details and destinations", async ({
  page,
  api,
}) => {
  api.pathInfo = [
    { "@id": "root", "schema:name": "/" },
    { "@id": "users", "schema:name": "Users" },
    { "@id": "home", "schema:name": "My workspace" },
  ];
  await dashboard(page);
  async function unspaced(locator, count) {
    await expect(locator).toHaveCount(count);
    for (const separator of await locator.all()) {
      expect(
        await separator.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            start: style.marginInlineStart,
            end: style.marginInlineEnd,
          };
        }),
      ).toEqual({ start: "0px", end: "0px" });
      await expect(separator).toHaveAttribute("aria-hidden", "true");
    }
  }
  await unspaced(page.locator(".breadcrumbs .breadcrumb-separator"), 2);
  await page.locator("tbody tr").first().focus();
  await page.keyboard.press("Enter");
  await unspaced(page.locator(".information .breadcrumb-separator"), 2);
  await page
    .getByRole("button", { name: "Actions for Study metadata" })
    .click();
  await page
    .locator(".resource-menu")
    .getByRole("button", { name: "Move", exact: true })
    .click();
  await unspaced(page.locator("dialog .breadcrumbs .breadcrumb-separator"), 3);
  await expect(
    page.locator("dialog .breadcrumbs button").filter({ hasText: "/" }),
  ).toHaveCount(0);
});

test("profile sections expose labelled copy actions for API examples", async ({
  page,
  api,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.profileCopied = text;
        },
      },
    });
  });
  await page.goto("/profile");
  await expect(page.locator(".account-section-heading")).toHaveCount(3);
  await expect(page.locator(".account-section-heading cedar-icon")).toHaveCount(
    3,
  );
  const example = page.locator(".profile-example").first();
  const text = await example.locator("code").textContent();
  await example
    .getByRole("button", {
      name: "Copy example: List your home folder contents",
    })
    .click();
  await expect.poll(() => page.evaluate(() => window.profileCopied)).toBe(text);
  expect(text).toContain("<API_KEY>");
});

for (const route of ["settings", "privacy", "profile"]) {
  test(`${route} is a styled standalone account page`, async ({
    page,
    api,
  }, testInfo) => {
    await page.goto("/" + route);
    await expect(page.locator(".account-card").first()).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Account pages" }),
    ).toHaveCount(0);
    await expect(page.locator(".account-section-heading").first()).toHaveCSS(
      "border-bottom-width",
      "1px",
    );
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${route}-${width}.png`),
      });
    }
  });
}

test("metadata errors and nonblocking warnings share centered, expandable summaries", async ({
  page,
  api,
}) => {
  await page.goto("/instances/edit/instance");
  await expect(page.getByLabel("Metadata name")).toHaveValue("Study record");
  await page.evaluate(() => {
    const cee = document.querySelector("cedar-embeddable-editor");
    cee.dataQualityReport = {
      isValid: false,
      problems: [
        { path: ["Title"], code: "required", message: "A value is required." },
        { path: ["Email"], code: "email", message: "Enter a valid email." },
      ],
    };
    cee.dispatchEvent(new CustomEvent("change"));
  });
  const errors = page.getByLabel("Metadata errors");
  const warnings = page.getByLabel("Metadata warnings");
  expect(api.requests.some((r) => r.method !== "GET")).toBe(false);
  await expect(errors.locator("summary")).toContainText("1 error");
  await expect(warnings.locator("summary")).toContainText("1 warning");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await errors.locator("summary").click();
  await expect(errors.locator("li")).toBeVisible();
  await warnings.locator("summary").click();
  await expect(warnings.locator("li")).toBeVisible();
  await page
    .locator(".metadata-content")
    .screenshot({ path: "/tmp/metadata-validation-summaries.png" });
  await expect(warnings).toHaveCSS("color", "rgb(180, 83, 9)");
  await page.evaluate(() => {
    const cee = document.querySelector("cedar-embeddable-editor");
    cee.dataQualityReport.problems.pop();
    cee.dispatchEvent(new CustomEvent("change"));
  });
  await expect(errors).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
});
