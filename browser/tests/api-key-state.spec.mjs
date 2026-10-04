import { test, expect } from "./fixtures.mjs";
const key = (id) => ({ id, key: `fixture-value-${id}`, enabled: true, description: id });
const profile = { "@id": "owner", homeFolderId: "home", firstName: "Alex", apiKeys: [key("analysis"), key("notebook")] };
for (const action of ["create", "regenerate", "delete"]) {
  for (const failure of [503, "invalid", "unchanged"]) {
    test(`${action} ${failure} keeps the key list and requires reload`, async ({ page, api }) => {
      let writes = 0;
      await page.route("**/api/user/users/owner", route => route.fulfill({ json: profile }));
      await page.route("**/api/user/users/owner/api-keys**", route => {
        writes++;
        return route.fulfill(failure === 503 ? { status: 503, json: { message: "Response unavailable" } } : { json: { apiKeys: failure === "invalid" ? null : profile.apiKeys } });
      });
      await page.goto("/profile");
      const article = page.getByRole("article", { name: "analysis", exact: true });
      if (action === "create") await page.getByRole("button", { name: "New key", exact: true }).click();
      else {
        await article.getByRole("button", { name: action === "delete" ? "Delete" : "Regenerate", exact: true }).click();
        await page.locator("dialog.confirmation-dialog").getByRole("button", { name: "OK", exact: true }).click();
      }
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(article).toBeVisible();
      await expect(article.getByRole("button", { name: "Regenerate", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Reload profile", exact: true }).click();
      await expect(article.getByRole("button", { name: "Regenerate", exact: true })).toBeEnabled();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(writes).toBe(1);
    });
  }
}
