import { test, expect, dashboard, resource } from "./fixtures.mjs";
import { focusedControl } from "./focus.mjs";

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

/** Expect focus back on `control`, which the write disabled, rather than on the page. */
const focusOn = (page, control) => expect.poll(() => focusedControl(page)).toBe(control);

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
  // The toast shows the outcome the region says, and has no live region of its own, so it is said once.
  await expect(toast).toHaveText("Group created.");
  await expect(toast).not.toHaveAttribute("role");
  await expect(toast).not.toHaveAttribute("aria-live");
  await expect(page.locator("cedar-toast [role=status]")).toHaveCount(0);
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
  // The write disabled the checkbox, and focus returns to it.
  await focusOn(page, 'checkbox "Sam Curator is a Group Administrator"');
  await administrator.click();
  await confirmation.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(region).toHaveText("Sam Curator is no longer a Group Administrator.");
  await focusOn(page, 'checkbox "Sam Curator is a Group Administrator"');

  const name = page.getByLabel("Name", { exact: true });
  await name.fill("Renamed team");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect(region).toHaveText("Group details saved.");
  await focusOn(page, 'button "Save"');

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
  // The toast shows the outcome the region says, and its own region stays empty, so it is said once.
  await expect(toast).toHaveText("Description saved.");
  await expect(toast).not.toHaveAttribute("role");
  await expect(page.locator("cedar-toast [role=status]")).toHaveText("");
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

/**
 * Record, from the first script of each page loaded, each status region Workspace keeps: the text it
 * held when it entered the page, and each text it said after. A screen reader may say nothing for a
 * region that enters the page holding its text. Loading another page starts the record again.
 */
async function watchRegions(page) {
  await page.addInitScript(() => {
    window.__regions = [];
    const seen = new WeakSet();
    const visit = (node) => {
      if (!(node instanceof Element)) return;
      for (const region of [node, ...node.querySelectorAll("cedar-status")]) {
        if (region.localName !== "cedar-status" || seen.has(region)) continue;
        seen.add(region);
        const entry = { entered: region.textContent, said: [] };
        window.__regions.push(entry);
        new MutationObserver(() => {
          const text = region.textContent.trim();
          if (text) entry.said.push(text);
        }).observe(region, { childList: true, characterData: true, subtree: true });
      }
    };
    new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(visit))).observe(
      document,
      { childList: true, subtree: true },
    );
  });
  return {
    /** Every text this page's regions have said, in the order each region entered the page. */
    said: () => page.evaluate(() => window.__regions.flatMap((entry) => entry.said)),
    /** The texts this page's regions held when they entered it, which is always none. */
    entered: () => page.evaluate(() => [...new Set(window.__regions.map((entry) => entry.entered))]),
  };
}

/** Whether every status region `locator` finds is drawn as nothing: clipped to a pixel at most. */
const drawnAsNothing = (locator) =>
  locator.evaluateAll((regions) =>
    regions.every((region) => {
      const box = region.getBoundingClientRect(),
        style = getComputedStyle(region);
      return box.width <= 1 && box.height <= 1 && style.position === "absolute" && style.clipPath === "inset(50%)";
    }),
  );

test("each toast says its message from a status region already in the page", async ({ page, api }) => {
  const regions = await watchRegions(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } }),
  );
  await dashboard(page);
  const region = page.locator("cedar-toast [role=status]");
  const toast = page.locator(".toast");
  // On an ordinary page the region is there, empty and drawn as nothing, and there is no toast.
  await expect(region).toHaveText("");
  await expect(region).toHaveAttribute("aria-live", "polite");
  expect(await drawnAsNothing(region)).toBe(true);
  await expect(toast).toHaveCount(0);

  await page.getByRole("button", { name: "Actions for Study metadata", exact: true }).click();
  await page.locator(".resource-menu").getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast).toHaveText("Saved.");
  await expect(region).toHaveText("Saved.");
  // The toast only shows the message, so it is said once.
  await expect(toast).not.toHaveAttribute("role");
  await expect(toast).not.toHaveAttribute("aria-live");

  await page.getByRole("button", { name: "Actions for Study metadata", exact: true }).click();
  await page.locator(".resource-menu").getByRole("button", { name: "Permissions…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const dialogRegion = dialog.locator("cedar-toast [role=status]");
  await expect(dialog.getByRole("combobox", { name: "Role for Sam Curator" })).toBeEnabled();
  await expect(dialogRegion).toHaveText("");
  await expect(dialog.locator(".toast")).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "Role for Sam Curator" }).selectOption("editor");
  await expect(dialog.locator(".toast")).toHaveText("Permissions saved.");
  await expect(dialogRegion).toHaveText("Permissions saved.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await regions.entered()).toEqual([""]);
  expect(await regions.said()).toEqual(expect.arrayContaining(["Saved.", "Permissions saved."]));

  await page.goto("/profile");
  const accountRegion = page.locator("cedar-toast [role=status]");
  await expect(page.getByRole("button", { name: "Copy First name", exact: true })).toBeVisible();
  await expect(accountRegion).toHaveText("");
  await page.getByRole("button", { name: "Copy First name", exact: true }).click();
  await expect(toast).toHaveText("Copied.");
  await expect(accountRegion).toHaveText("Copied.");
  expect(await regions.entered()).toEqual([""]);
  expect(await regions.said()).toEqual(["Copied."]);

  await page.goto("/instances/edit/instance");
  await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
  await expect(page.locator("cedar-toast [role=status]")).toHaveText("");
  await expect(toast).toHaveCount(0);
  expect(await regions.entered()).toEqual([""]);
});

test("loading statuses are said from status regions already in the page, outside what is busy", async ({
  page,
  api,
}) => {
  const regions = await watchRegions(page);
  let release, gate = Promise.resolve();
  const hold = () => (gate = new Promise((resolve) => (release = resolve)));
  await page.route("**/api/user/users/owner", async (route) => {
    await gate;
    await route.fallback();
  });
  await page.route("**/api/resource/folders/home/contents?**", async (route) => {
    await gate;
    await route.fallback();
  });
  await page.route("**/api/resource/search?**", async (route) => {
    await gate;
    await route.fallback();
  });

  // The page waits for the account before it shows the workspace.
  hold();
  await page.goto("/dashboard?view=list");
  const connecting = page.locator("p.loading");
  await expect(connecting).toHaveText("Connecting to your workspace…");
  await expect(connecting).not.toHaveAttribute("role");
  const pageRegion = page.locator("cedar-workspace-page > cedar-status");
  await expect(pageRegion).toHaveText("Connecting to your workspace…");
  release();
  await expect(pageRegion).toHaveText("");

  // The listing is busy while it loads, so its region is in the footer beside it.
  await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
  const listingRegion = page.locator(".paging > cedar-status");
  await expect(listingRegion).toHaveText("");
  hold();
  await page.getByRole("button", { name: "Refresh workspace", exact: true }).click();
  await expect(listingRegion).toHaveText("Refreshing…");
  release();
  await expect(listingRegion).toHaveText("");
  hold();
  const search = page.getByRole("textbox", { name: "Search workspace" });
  await search.fill("study");
  await search.press("Enter");
  const loading = page.locator(".table-scroll p.empty");
  await expect(loading).toHaveText("Loading…");
  await expect(loading).not.toHaveAttribute("role");
  await expect(listingRegion).toHaveText("Loading…");
  release();
  await expect(listingRegion).toHaveText("");
  await expect(loading).toHaveCount(0);
  // Nothing is busy, so no status region holds any text, and each is drawn as nothing.
  const all = page.locator("cedar-status");
  expect(await all.evaluateAll((found) => found.map((region) => region.textContent))).toEqual(
    ["", "", ""],
  );
  expect(await drawnAsNothing(all)).toBe(true);
  expect(await regions.entered()).toEqual([""]);
  expect(await regions.said()).toEqual(
    expect.arrayContaining(["Connecting to your workspace…", "Refreshing…", "Loading…"]),
  );

  // Groups says it is loading a group from its own region.
  await page.goto("/groups");
  const groupsRegion = page.locator(".groups-content > cedar-status");
  const find = page.getByRole("combobox", { name: "Find a group", exact: true });
  await expect(find).toBeEnabled();
  await expect(groupsRegion).toHaveText("");
  let releaseGroup;
  await page.route("**/api/group/groups/team", async (route) => {
    await new Promise((resolve) => (releaseGroup = resolve));
    await route.fallback();
  });
  await find.fill("Research");
  await find.press("Enter");
  const groupLoading = page.locator(".groups-content > p").filter({ hasText: "Loading…" });
  await expect(groupLoading).toBeVisible();
  await expect(groupLoading).not.toHaveAttribute("role");
  await expect(groupsRegion).toHaveText("Loading…");
  releaseGroup();
  await expect(groupsRegion).toHaveText("");
  expect(await regions.entered()).toEqual([""]);
});

test("a dialog says what it is preparing from a status region that enters it empty", async ({ page, api }) => {
  const regions = await watchRegions(page);
  await dashboard(page);
  let release;
  await page.route("**/api/resource/templates/template/permissions", async (route) => {
    if (route.request().method() === "GET") await new Promise((resolve) => (release = resolve));
    await route.fallback();
  });
  await page.getByRole("button", { name: "Actions for Study metadata", exact: true }).click();
  await page.locator(".resource-menu").getByRole("button", { name: "Permissions…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const busy = dialog.locator(".permissions-body > cedar-status");
  await expect(busy).toHaveText("Loading…");
  const loading = dialog.locator(".permissions-body > p").filter({ hasText: "Loading…" });
  await expect(loading).toBeVisible();
  await expect(loading).not.toHaveAttribute("role");
  release();
  await expect(busy).toHaveText("");
  await dialog.getByRole("combobox", { name: "Role for Sam Curator" }).selectOption("editor");
  await expect(dialog.locator(".toast")).toHaveText("Permissions saved.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The Copy dialog hides all but its loading status while it reads the folders to copy into.
  let releaseFolders;
  await page.route("**/api/resource/folders/*/contents?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("resource_types") === "folder")
      await new Promise((resolve) => (releaseFolders = resolve));
    await route.fallback();
  });
  await page.getByRole("button", { name: "Actions for Study metadata", exact: true }).click();
  await page.locator(".resource-menu").getByRole("button", { name: "Copy", exact: true }).click();
  const copy = page.locator("cedar-resource-dialog dialog");
  await expect(copy).toHaveClass(/is-preparing/);
  const preparing = copy.locator(".dialog-preparing-status");
  await expect(preparing).toHaveText("Loading…");
  await expect(preparing).not.toHaveAttribute("role");
  await expect(copy.locator(":scope > cedar-status")).toHaveText("Loading…");
  releaseFolders();
  await expect(copy).not.toHaveClass(/is-preparing/);
  await expect(copy.locator(":scope > cedar-status")).toHaveText("");
  await copy.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // So does the preview while it reads the artifact.
  let releaseArtifact;
  await page.route("**/api/resource/templates/template", async (route) => {
    await new Promise((resolve) => (releaseArtifact = resolve));
    await route.fallback();
  });
  await page.getByRole("button", { name: "Preview Study metadata", exact: true }).click();
  const preview = page.locator("dialog.artifact-preview");
  await expect(preview).toHaveClass(/is-preparing/);
  await expect(preview.locator(".dialog-preparing-status > span")).not.toHaveAttribute("role");
  await expect(preview.locator(":scope > cedar-status")).toHaveText("Loading…");
  releaseArtifact();
  await expect(preview).not.toHaveClass(/is-preparing/);
  await expect(preview.locator(":scope > cedar-status")).toHaveText("");

  expect(await regions.entered()).toEqual([""]);
  expect(await regions.said()).toEqual(
    expect.arrayContaining(["Loading…", "Saving permissions…", "Permissions saved."]),
  );
});
