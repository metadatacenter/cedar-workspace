import { test, expect, dashboard, resource } from "./fixtures.mjs";

test("Publish asks for the publication version and refuses 0.0.0", async ({ page, api }) => {
  await page.route("**/templates/template/report", (route) =>
    route.fulfill({ json: { ...resource, "pav:version": "0.0.1" } }),
  );
  await dashboard(page);
  await page.getByRole("button", { name: "Actions for Study metadata" }).click();
  await page.locator(".resource-menu").getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  const instruction = dialog.getByText("Please select the publication version.", { exact: true });
  await expect(instruction).toBeVisible();
  const version = dialog.getByText("Version", { exact: true });
  expect((await instruction.boundingBox()).y).toBeLessThan((await version.boundingBox()).y);
  await expect(dialog.getByRole("textbox", { name: "Patch", exact: true })).toHaveValue("1");
  await dialog.getByRole("textbox", { name: "Patch", exact: true }).fill("0");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Use version 0.0.1 or later.");
  expect(api.requests.filter((request) => request.method !== "GET")).toEqual([]);
});
