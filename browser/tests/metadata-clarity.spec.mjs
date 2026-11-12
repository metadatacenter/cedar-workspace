import { test, expect } from "./fixtures.mjs";

test("mixed findings explain Save, use localized copy and keep diagnostics separately accessible", async ({
  page,
  api,
}) => {
  await page.goto("/instances/edit/instance");
  await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
  await page.evaluate(() => {
    const editor = document.querySelector("cedar-embeddable-editor");
    editor.dataQualityReport = {
      isValid: false,
      problems: [
        {
          path: ["Title"],
          code: "required",
          severity: "warning",
          message: "Required",
          displayMessage: "A required value is missing.",
        },
        {
          path: ["Email"],
          code: "valueShape",
          severity: "error",
          message: "Not a valid email address.",
          displayMessage: "Enter a valid email address.",
        },
      ],
    };
    editor.dispatchEvent(new CustomEvent("change"));
  });
  const save = page.getByRole("button", { name: "Save", exact: true });
  const errors = page.getByLabel("Metadata errors", { exact: true });
  const warnings = page.getByLabel("Metadata warnings", { exact: true });
  await expect(save).toBeDisabled();
  // Save says why it refuses, as its help does, then which errors stop it.
  await expect(save).toHaveAttribute(
    "aria-describedby",
    "metadata-save-help metadata-errors-summary",
  );
  await expect(errors.locator(":scope > summary")).toHaveText(
    "1 error — fix before saving",
  );
  await expect(warnings).toContainText(
    "1 warning — warnings do not block saving",
  );
  await errors.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  const link = errors.getByRole("button", {
    name: "Email: Enter a valid email address.",
  });
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.__ceeReveals?.at(-1)))
    .toMatchObject({ path: ["Email"] });
  const details = errors.getByText("Technical details", { exact: true });
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(
    errors.getByText("Not a valid email address.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const editor = document.querySelector("cedar-embeddable-editor");
    editor.dataQualityReport.problems.pop();
    editor.dispatchEvent(new CustomEvent("change"));
  });
  await expect(errors).toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute("aria-describedby");
  expect(api.requests.filter((request) => request.method !== "GET")).toEqual(
    [],
  );
});

for (const reportStyle of ["legacy", "current"])
  test(`email format and incomplete answers remain saveable warnings with ${reportStyle} reports`, async ({
    page,
    api,
  }) => {
    await page.goto("/instances/edit/instance");
    await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
    await page.evaluate((style) => {
      const editor = document.querySelector("cedar-embeddable-editor");
      const current = style === "current";
      editor.dataQualityReport = {
        isValid: false,
        ...(current ? { canSave: true, structurallyValid: true } : {}),
        problems: [
          {
            path: ["Title"],
            code: "required",
            message: "A value is required.",
            ...(current ? { category: "completeness", severity: "warning", blocksSave: false } : {}),
          },
          {
            path: ["Email"],
            code: "email",
            message: "Enter a valid email address.",
            ...(current ? { category: "constraint", severity: "warning", blocksSave: false } : {}),
          },
        ],
      };
      editor.dispatchEvent(new CustomEvent("change"));
    }, reportStyle);
    const errors = page.getByLabel("Metadata errors", { exact: true });
    const warnings = page.getByLabel("Metadata warnings", { exact: true });
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(errors).toHaveCount(0);
    await expect(warnings.locator(":scope > summary")).toHaveText(
      "2 warnings — warnings do not block saving",
    );
    await expect(save).toBeEnabled();
    await expect(save).not.toHaveAttribute("aria-describedby");
    await warnings.locator(":scope > summary").click();
    await warnings.getByRole("button", { name: "Email: Enter a valid email address." }).click();
    await expect
      .poll(() => page.evaluate(() => window.__ceeReveals?.at(-1)))
      .toMatchObject({ path: ["Email"], code: "email", severity: "warning" });
    expect(api.requests.filter((request) => request.method !== "GET")).toEqual([]);
  });

/**
 * Give the editor a report as CEE gives one while a check runs, or once it has finished. A running
 * check is an invalid report that cannot be saved yet and lists no problem.
 */
const validation = (page, pending, problems = []) =>
  page.evaluate(
    ({ pending, problems }) => {
      const editor = document.querySelector("cedar-embeddable-editor");
      const settled = !pending && !problems.length;
      editor.dataQualityReport = { isValid: settled, canSave: settled, pendingValidation: pending, problems };
      editor.dispatchEvent(new CustomEvent("validationChange"));
    },
    { pending, problems },
  );
const look = (button) => {
  const style = getComputedStyle(button);
  return [style.opacity, style.color, style.backgroundColor, style.borderColor, style.cursor, style.pointerEvents];
};

test("Save acts while CEE is still validating: a click and Enter wait, then one save follows", async ({
  page,
  api,
}) => {
  await page.goto("/instances/edit/instance");
  const name = page.getByLabel("Instance name");
  await expect(name).toHaveValue("Study record");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const action = page.locator(".metadata-save-action");
  const status = page.locator(".metadata-save-status");
  const said = page.locator(".metadata-toolbar > cedar-status");
  const tip = page.getByRole("tooltip");
  const writes = () => api.requests.filter((request) => request.method !== "GET");
  await name.fill("Changed record");
  await expect(status).toHaveText("Modified");
  const enabled = await save.evaluate(look);

  await validation(page, true);
  // Save looks as it does when nothing holds it back, and a pointer reaches it.
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute("aria-disabled");
  await expect(save).not.toHaveAttribute("aria-describedby");
  await expect(action).not.toHaveClass(/is-refused/);
  expect(await save.evaluate(look)).toEqual(enabled);
  // Validation alone does not change the status, and Save has nothing to explain.
  await expect(status).toHaveText("Modified");
  await action.hover();
  await page.waitForTimeout(400);
  await expect(tip).toHaveCount(0);

  // A click asks for a save, which waits for the validation and says so.
  await save.click();
  await expect(status).toHaveText("Validating…");
  await expect(said).toHaveText("Validating…");
  // It still looks enabled, once the pointer's hover fill is off it.
  await page.mouse.move(0, 0);
  await expect.poll(() => save.evaluate(look)).toEqual(enabled);
  // Enter asks again, and a report that is still pending changes nothing.
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await validation(page, true);
  await expect(status).toHaveText("Validating…");
  expect(writes()).toEqual([]);

  await validation(page, false);
  await expect(page.locator(".toast")).toHaveText("Saved.");
  await expect(status).toHaveText("Saved");
  // The two requests made one save, and a later report makes no other.
  await validation(page, false);
  await page.waitForTimeout(200);
  expect(writes().map((request) => request.method)).toEqual(["PUT"]);
  expect(writes()[0].body["schema:name"]).toBe("Changed record");
});

test("a Save that waited for validation ends refused by the errors it finds, which the page lists", async ({
  page,
  api,
}) => {
  await page.goto("/instances/edit/instance");
  await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const status = page.locator(".metadata-save-status");
  const tip = page.getByRole("tooltip");
  await validation(page, true);
  await save.click();
  await expect(status).toHaveText("Validating…");
  await validation(page, false, [
    { path: ["Email"], code: "valueShape", severity: "error", message: "Enter a valid email address." },
  ]);
  // The refusal is the one errors give at any other time: listed, described and explained on hover.
  await expect(status).toHaveText("Unmodified");
  await expect(page.getByLabel("Metadata errors", { exact: true }).locator(":scope > summary")).toContainText(
    "1 error",
  );
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toHaveAccessibleDescription("Cannot save until errors are fixed 1 error — fix before saving");
  await page.mouse.move(0, 0);
  await page.locator(".metadata-save-action").hover();
  await expect(tip).toHaveText("Cannot save until errors are fixed");
  expect(api.requests.filter((request) => request.method !== "GET")).toEqual([]);
});
