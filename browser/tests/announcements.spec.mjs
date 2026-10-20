import { test, expect, resource } from "./fixtures.mjs";

const items = Array.from({ length: 120 }, (_, index) => ({
  ...resource,
  "@id": `item-${index + 1}`,
  resourceType: "instance",
  "schema:name": `Record ${String(index + 1).padStart(3, "0")}`,
}));

/**
 * Home lists 120 records, 50 to a page, and none once filtered to fields. A search for "study" finds
 * one record and any other search none. The shared fixture answers everything else.
 */
async function listing(page) {
  await page.route("**/api/resource/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/folders/home/contents")) {
      const offset = Number(url.searchParams.get("offset") || 0);
      const resources = url.searchParams.get("resource_types") === "field" ? [] : items;
      return route.fulfill({
        json: { resources: resources.slice(offset, offset + 50), totalCount: resources.length, pathInfo: [] },
      });
    }
    if (url.pathname.endsWith("/search") && url.searchParams.has("q")) {
      const resources = url.searchParams.get("q") === "study" ? items.slice(0, 1) : [];
      return route.fulfill({ json: { resources, totalCount: resources.length, pathInfo: [] } });
    }
    const item = items.find((r) =>
      new RegExp(`/template-instances/${r["@id"]}(/report)?$`).test(url.pathname),
    );
    return item
      ? route.fulfill({ json: item, headers: { ETag: '"fixture-revision"' } })
      : route.fallback();
  });
}

/** Record every text the listing's status region takes from now on. */
async function record(page) {
  await page.evaluate(() => {
    const region = document.querySelector(".listing-announcement");
    window.__announcements = [];
    new MutationObserver(() => window.__announcements.push(region.textContent.trim())).observe(
      region,
      { childList: true, characterData: true, subtree: true },
    );
  });
  return () => page.evaluate(() => window.__announcements.filter(Boolean));
}

test("a search, a filter and a page change announce their results once, without moving focus", async ({
  page,
  api,
}) => {
  await listing(page);
  await page.goto("/dashboard?view=list");
  await expect(page.getByText("Displaying 1–50 of 120", { exact: true })).toBeVisible();
  const region = page.locator(".listing-announcement");
  // A polite region waits for the screen reader to finish what it is saying.
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region).toHaveText("");
  const announced = await record(page);

  const search = page.getByRole("textbox", { name: "Search workspace" });
  await search.fill("study");
  await search.press("Enter");
  await expect(region).toHaveText("Displaying 1–1 of 1");
  await expect(search).toBeFocused();
  await search.fill("nothing");
  await search.press("Enter");
  await expect(region).toHaveText("No items found.");
  await expect(search).toBeFocused();

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(region).toHaveText("Displaying 1–50 of 120");
  const type = page.locator("cedar-filter-chip").first().getByRole("button").first();
  await type.click();
  await page.getByRole("checkbox", { name: "Field", exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(region).toHaveText("No items found.");
  await expect(type).toBeFocused();
  await page.getByRole("button", { name: "Clear type filter" }).click();
  await expect(region).toHaveText("Displaying 1–50 of 120");

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(region).toHaveText("Displaying 51–100 of 120");

  // Selecting, opening the Information panel and refreshing change no result, so nothing is said.
  await page.getByRole("row", { name: /Record 051/ }).click();
  await expect(page.getByRole("complementary", { name: "Resource information" })).toContainText("Record 051");
  await page.getByRole("button", { name: "Refresh workspace", exact: true }).click();
  await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
  expect(await announced()).toEqual([
    "Displaying 1–1 of 1",
    "No items found.",
    "Displaying 1–50 of 120",
    "No items found.",
    "Displaying 1–50 of 120",
    "Displaying 51–100 of 120",
  ]);
});
