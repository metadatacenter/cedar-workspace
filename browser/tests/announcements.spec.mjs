import { test, expect, dashboard, resource } from "./fixtures.mjs";

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

/**
 * Record every text the status region `selector` takes from now on, and how many times a control
 * had taken focus when it last said something.
 */
async function record(page, selector = ".listing-announcement") {
  await page.evaluate((selector) => {
    const region = document.querySelector(selector);
    window.__announcements = [];
    window.__focusMoves = 0;
    document.addEventListener("focusin", () => window.__focusMoves++, true);
    new MutationObserver(() => {
      const text = region.textContent.trim();
      window.__announcements.push(text);
      if (text) window.__focusMovesWhenSaid = window.__focusMoves;
    }).observe(region, { childList: true, characterData: true, subtree: true });
  }, selector);
  return () => page.evaluate(() => window.__announcements.filter(Boolean));
}

/** Whether, two frames on, no control has taken focus since the region last said something. */
const focusKept = (page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => done(window.__focusMovesWhenSaid === window.__focusMoves)),
        ),
      ),
  );

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

test("Groups says each outcome once, without moving focus, and leaves a failure to its alert", async ({
  page,
  api,
}) => {
  await page.goto("/groups");
  const region = page.locator(".groups-announcement");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region).toHaveText("");
  const announced = await record(page, ".groups-announcement");
  const toast = page.locator(".toast");
  const confirmation = page.locator("dialog.confirmation-dialog");

  await page.getByRole("tab", { name: "Create group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Research team");
  const create = page.getByRole("button", { name: "Create group", exact: true });
  await create.click();
  await expect(region).toHaveText("Group created.");
  // The toast shows the outcome the region says, and is no live region itself, so it is said once.
  await expect(toast).toHaveText("Group created.");
  await expect(toast).not.toHaveAttribute("role");
  await expect(toast).not.toHaveAttribute("aria-live");
  expect(await focusKept(page)).toBe(true);

  const sam = page.locator(".groups-member-row").filter({ hasText: "Sam Curator" });
  const bin = sam.getByRole("button", { name: "Remove Sam Curator from the group", exact: true });
  await bin.click();
  await expect(region).toHaveText("Sam Curator removed from the group.");
  await expect(toast).toHaveText("Group members saved.");
  expect(await focusKept(page)).toBe(true);

  const picker = page.getByRole("combobox", { name: "Add a member", exact: true });
  await picker.fill("Sam");
  await page.getByRole("option", { name: "Sam Curator", exact: true }).click();
  const add = page.getByRole("button", { name: "Add member", exact: true });
  await add.click();
  await expect(region).toHaveText("Sam Curator added to the group.");
  expect(await focusKept(page)).toBe(true);

  const administrator = sam.getByRole("checkbox", { name: "Sam Curator is a Group Administrator", exact: true });
  await administrator.click();
  await confirmation.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(region).toHaveText("Sam Curator is now a Group Administrator.");
  expect(await focusKept(page)).toBe(true);
  await administrator.click();
  await confirmation.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(region).toHaveText("Sam Curator is no longer a Group Administrator.");
  expect(await focusKept(page)).toBe(true);

  const name = page.getByLabel("Name", { exact: true });
  await name.fill("Renamed team");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect(region).toHaveText("Group details saved.");
  expect(await focusKept(page)).toBe(true);

  // A failure clears the region and is said by its alert alone.
  api.fail = true;
  await name.fill("Refused name");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("This item changed since it was read.");
  await expect(region).toHaveText("");
  api.fail = false;
  await page.getByRole("button", { name: "Reload group", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("tab", { name: "Delete group", exact: true }).click();
  const find = page.getByRole("tabpanel", { name: "Delete group", exact: true }).getByRole("combobox", { name: "Group name", exact: true });
  await find.fill("Research");
  await find.press("Enter");
  await page.getByRole("button", { name: "Delete group", exact: true }).click();
  await confirmation.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(region).toHaveText("Group deleted.");
  expect(await focusKept(page)).toBe(true);

  expect(await announced()).toEqual([
    "Group created.",
    "Sam Curator removed from the group.",
    "Sam Curator added to the group.",
    "Sam Curator is now a Group Administrator.",
    "Sam Curator is no longer a Group Administrator.",
    "Group details saved.",
    "Group deleted.",
  ]);
});

test("each description save is said once without moving focus, and a failed one by its alert alone", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await page.getByRole("row", { name: /^Template Study metadata/ }).click();
  const panel = page.getByRole("complementary", { name: "Resource information" });
  const region = panel.locator("cedar-description-editor [role=status]");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region).toHaveText("");
  const announced = await record(page, "cedar-description-editor [role=status]");
  const description = panel.getByRole("textbox", { name: "Description", exact: true });
  const save = panel.getByRole("button", { name: "Save", exact: true });
  const toast = page.locator(".toast");

  await expect(description).toBeEnabled();
  await description.fill("A first description");
  await save.click();
  await expect(region).toHaveText("Description saved.");
  // The toast shows the outcome the region says, and is no live region itself, so it is said once.
  await expect(toast).toHaveText("Description saved.");
  await expect(toast).not.toHaveAttribute("role");
  expect(await focusKept(page)).toBe(true);
  await expect(description).toBeEnabled();
  await description.fill("A second description");
  await save.click();
  await expect(save).toHaveCount(0);
  await expect.poll(announced).toEqual(["Description saved.", "Description saved."]);
  expect(await focusKept(page)).toBe(true);

  api.fail = true;
  await expect(description).toBeEnabled();
  await description.fill("A refused description");
  await save.click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(region).toHaveText("");
  expect(await announced()).toEqual(["Description saved.", "Description saved."]);
});
