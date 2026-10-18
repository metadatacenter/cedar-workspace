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
  await expect(save).toHaveAttribute(
    "aria-describedby",
    "metadata-errors-summary",
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
