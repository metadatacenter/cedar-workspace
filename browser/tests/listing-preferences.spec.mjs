import { test, expect } from "./fixtures.mjs";

/**
 * The listing preferences — the type, last-modified and version filters, the sort, folder grouping
 * and the view — follow every link inside the Workspace, and the user profile keeps the last ones
 * chosen for an address that names none of them.
 */
const chosen = {
  resource_types: "template",
  modified: "week",
  version: "latest",
  sort: "-lastUpdatedOnTS",
  folders: "first",
  view: "list",
};
const query = (url) => Object.fromEntries(new URL(url).searchParams);
const listed = async (page) => {
  await expect(page.locator('[data-resource-id="template"]')).toBeVisible();
  await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
};

test("every link inside the Workspace keeps the listing preferences", async ({ page, api }) => {
  await page.goto("/dashboard?" + new URLSearchParams(chosen));
  await listed(page);
  const destinations = page.locator("nav.destinations");
  await destinations.getByRole("link", { name: "Shared with Me", exact: true }).click();
  await expect.poll(() => query(page.url())).toEqual({ ...chosen, sharing: "shared-with-me" });
  await destinations.getByRole("link", { name: "Home", exact: true }).click();
  await expect.poll(() => query(page.url())).toEqual(chosen);
  await page.locator("form.search input").fill("study");
  await page.locator("form.search input").press("Enter");
  await expect.poll(() => query(page.url())).toEqual({ ...chosen, search: "study" });
  await expect(page.locator("cedar-filter-chip").first().getByRole("button").first()).toHaveText("Template");
  await expect(page.getByRole("combobox", { name: "Version", exact: true })).toHaveValue("latest");
});

test("a choice is kept in the profile and opens the next visit", async ({ page, api }) => {
  await page.goto("/dashboard");
  await listed(page);
  await page.getByRole("combobox", { name: "Version", exact: true }).selectOption("latest");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect.poll(() => api.listing).toMatchObject({ version: "latest", viewMode: "list" });
  expect(api.profileWrites.map((w) => Object.keys(w.body))).toEqual([["uiPreferences.workspace"], ["uiPreferences.workspace"]]);

  // An account page returns to a bare address, which opens with the kept choices.
  await page.goto("/profile");
  await page.getByRole("link", { name: "Back to Workspace", exact: true }).click();
  await expect.poll(() => query(page.url())).toEqual({ version: "latest", view: "list", sort: "name" });
  await expect(page.getByRole("combobox", { name: "Version", exact: true })).toHaveValue("latest");
  await expect(page.getByRole("button", { name: "List view", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Back does not return to the bare address: it was replaced, not left behind.
  await page.goBack();
  await expect(page).toHaveURL(/\/profile$/);
});

test("the way back to a listing whose choices are all defaults is the listing it left", async ({ page, api }) => {
  await page.goto("/dashboard");
  await listed(page);
  expect(query(page.url())).toEqual({ sort: "name" });
  // Another tab, or another session, keeps different choices meanwhile.
  api.listing = { ...api.listing, resourceTypes: ["field"], viewMode: "list" };
  await page.goto(page.url());
  await listed(page);
  expect(query(page.url())).toEqual({ sort: "name" });
  await expect(page.locator("cedar-filter-chip").first().getByRole("button").first()).toHaveText("Type");
});

test("an address that names a preference opens as it says", async ({ page, api }) => {
  api.listing = { ...api.listing, resourceTypes: ["template"], version: "latest", viewMode: "list" };
  await page.goto("/dashboard?sort=name");
  await listed(page);
  expect(query(page.url())).toEqual({ sort: "name" });
  await expect(page.locator("cedar-filter-chip").first().getByRole("button").first()).toHaveText("Type");
  await expect(page.getByRole("combobox", { name: "Version", exact: true })).toHaveValue("all");
  await expect(page.getByRole("button", { name: "Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(api.profileWrites).toEqual([]);
});

test("a choice the profile cannot store still holds for the visit", async ({ page, api }) => {
  await page.goto("/dashboard");
  await listed(page);
  api.fail = true;
  await page.getByRole("combobox", { name: "Version", exact: true }).selectOption("latest");
  await expect(page).toHaveURL(/version=latest/);
  await page.locator("nav.destinations").getByRole("link", { name: "Shared with Me", exact: true }).click();
  await expect(page).toHaveURL(/sharing=shared-with-me/);
  await expect(page).toHaveURL(/version=latest/);
  await expect(page.locator("[role=alert]:visible")).toHaveCount(0);
  expect(api.listing.version).toBe("all");
});
