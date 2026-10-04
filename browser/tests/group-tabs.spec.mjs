import { test, expect } from "./fixtures.mjs";
import AxeBuilder from "@axe-core/playwright";

for (const width of [1440, 375]) {
  test(`Delete group reviews saved details and confirms deletion at ${width}`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/groups");
    const manage = page.getByRole("tab", { name: "Manage groups", exact: true });
    const remove = page.getByRole("tab", { name: "Delete group", exact: true });
    await remove.click();
    const panel = page.getByRole("tabpanel", { name: "Delete group", exact: true });
    const search = panel.getByRole("combobox", { name: "Group name", exact: true });
    await search.fill("Research");
    await search.press("Enter");
    const name = panel.getByLabel("Name", { exact: true });
    await expect(name).toHaveValue("Research team");
    await expect(name).toHaveAttribute("readonly", "");
    await expect(panel.getByLabel("Description", { exact: true })).toHaveAttribute("readonly", "");
    await expect(panel.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(panel.locator(".groups-members-section")).toHaveCount(0);
    const section = await panel.locator(".groups-create-card").boundingBox();
    const nameLabel = await panel.locator('label[for="group-name"]').boundingBox();
    const tabs = await page.locator(".groups-tabs").boundingBox();
    const details = await panel.locator(".groups-details-form").boundingBox();
    const card = await panel.locator(".groups-created-group").boundingBox();
    const input = await search.boundingBox();
    const binIcon = await panel.locator(".groups-delete-button cedar-icon").boundingBox();
    expect(nameLabel.y - section.y - section.height).toBe(8);
    expect(section.y - tabs.y - tabs.height).toBe(0);
    expect(card.y + card.height - details.y - details.height).toBe(9);
    expect(Math.abs(input.x + input.width - binIcon.x - binIcon.width)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Loading disables the picker and can clear WebKit focus. Capture a known state.
    await expect(search).toBeEnabled();
    await search.focus();
    await expect(search).toBeFocused();
    await page.mouse.move(0, 0);
    if (process.env.WORKSPACE_VISUAL)
      await expect(page.locator(".groups-content")).toHaveScreenshot(`groups-delete-${width}.png`);
    expect((await new AxeBuilder({ page }).include("#groups-page").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

    await manage.click();
    await expect(page.getByRole("button", { name: "Delete group", exact: true })).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill("Unsaved name");
    await remove.click();
    await expect(name).toHaveValue("Research team");
    await name.press("Enter");
    expect(api.requests.filter(r => r.method !== "GET")).toEqual([]);
    await manage.click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Unsaved name");
    await remove.click();
    const bin = panel.getByRole("button", { name: "Delete group", exact: true });
    await bin.click();
    const confirmation = page.locator("dialog.confirmation-dialog");
    await expect(confirmation).toContainText("Delete group “Research team”?");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(name).toHaveValue("Research team");
    expect(api.requests.filter(r => r.method !== "GET")).toEqual([]);
    await bin.click();
    await confirmation.getByRole("button", { name: "OK", exact: true }).click();
    await expect(panel.locator(".groups-selected")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("Group deleted.");
    expect(api.requests.filter(r => r.method !== "GET")).toEqual([
      expect.objectContaining({ method: "DELETE", path: "/api/group/groups/team", revision: '"fixture-revision"' }),
    ]);
  });
}

for (const specialGroup of [false, true]) {
  test(`Delete group hides the bin for ${specialGroup ? "built-in groups" : "ordinary members"}`, async ({ page, api }) => {
    api.members[0].administrator = false;
    if (specialGroup) await page.route("**/api/group/groups/team", route => route.fulfill({
      json: { "@id": "team", "schema:name": "Research team", specialGroup: true },
      headers: { ETag: '"fixture-revision"' },
    }));
    await page.goto("/groups");
    await page.getByRole("tab", { name: "Delete group", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Group name", exact: true });
    await search.fill("Research");
    await search.press("Enter");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(specialGroup ? "Everyone" : "Research team");
    await expect(page.getByRole("button", { name: "Delete group", exact: true })).toHaveCount(0);
    expect(api.requests.filter(r => r.method !== "GET")).toEqual([]);
  });
}

test("returning to Create group waits for the complete group without shifting the tabs", async ({
  page,
  api,
}) => {
  await page.goto("/groups");
  const create = page.getByRole("tab", { name: "Create group", exact: true });
  const manage = page.getByRole("tab", { name: "Manage groups", exact: true });
  await create.click();
  await page.getByLabel("Group name", { exact: true }).fill("Research team");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.locator(".groups-member-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await manage.click();
  const panel = await page.locator("#manage-groups-panel").elementHandle();
  const top = (await manage.boundingBox()).y;
  let releaseDetail, releaseRoster, detailStarted, rosterStarted;
  const detailGate = new Promise((resolve) => {
    releaseDetail = resolve;
  });
  const rosterGate = new Promise((resolve) => {
    releaseRoster = resolve;
  });
  const detailRequest = new Promise((resolve) => {
    detailStarted = resolve;
  });
  const rosterRequest = new Promise((resolve) => {
    rosterStarted = resolve;
  });
  await page.route("**/api/group/groups/team", async (route) => {
    detailStarted();
    await detailGate;
    await route.fallback();
  });
  await page.route("**/api/group/groups/team/users", async (route) => {
    rosterStarted();
    await rosterGate;
    await route.fallback();
  });
  const expectStable = async () => {
    await expect(manage).toHaveAttribute("aria-selected", "true");
    await expect(create).toBeDisabled();
    expect(await panel.evaluate((el) => el.isConnected)).toBe(true);
    expect((await manage.boundingBox()).y).toBe(top);
    await expect(page.locator("#create-group-panel")).toHaveCount(0);
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  };
  await create.click();
  await detailRequest;
  await expectStable();
  releaseDetail();
  await rosterRequest;
  await expectStable();
  releaseRoster();
  await expect(create).toHaveAttribute("aria-selected", "true");
  await expect(create).toBeEnabled();
  await expect(page.locator(".groups-member-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  expect((await manage.boundingBox()).y).toBe(top);
});

for (const width of [1440, 375]) {
  test(`every group tab places its heading where Manage groups does at ${width}`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/groups");
    const placements = {};
    for (const name of ["Manage groups", "Create group", "Delete group"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      const heading = page.getByRole("tabpanel", { name, exact: true }).getByRole("heading", { level: 2 });
      await expect(heading).toBeVisible();
      placements[name] = await heading.evaluate((h2) => {
        const tabs = document.querySelector(".groups-tabs").getBoundingClientRect();
        const box = h2.getBoundingClientRect();
        const style = getComputedStyle(h2);
        return { x: box.x, top: box.y - tabs.bottom, size: style.fontSize, weight: style.fontWeight };
      });
    }
    expect(placements["Create group"]).toEqual(placements["Manage groups"]);
    expect(placements["Delete group"]).toEqual(placements["Manage groups"]);
    // A section heading's size, as the Permissions dialog gives its sections; not the larger form heading.
    expect(placements["Manage groups"].size).toBe("18px");
  });
}

for (const failure of [403, 409, 412, 428, 503, "invalid", "no-revision"]) {
  test(`group details ${failure} preserve edits and recover through reload`, async ({ page, api }) => {
    let writes = 0;
    await page.route("**/api/group/groups/team", async route => {
      if (route.request().method() === "PUT") {
        writes++;
        if (typeof failure === "number") return route.fulfill({ status: failure, json: { errorMessage: "Group rejected" } });
        return route.fulfill({ json: failure === "invalid" ? {} : { "@id": "team", "schema:name": "Edited" }, headers: failure === "invalid" ? { ETag: '"bad"' } : {} });
      }
      return route.fulfill({ json: { "@id": "team", "schema:name": "Research team" }, headers: { ETag: '"group"' } });
    });
    await page.goto("/groups");
    const search = page.getByRole("combobox", { name: "Find a group", exact: true });
    await search.fill("Research"); await search.press("Enter");
    const name = page.getByLabel("Name", { exact: true });
    await name.fill("Edited");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(name).toHaveValue("Edited");
    await expect(save).toBeDisabled();
    expect(writes).toBe(1);
    await page.getByRole("button", { name: "Reload group", exact: true }).click();
    await expect(save).toBeEnabled();
    await expect(name).toHaveValue("Research team");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("uncertain group creation requires directory recovery and preserves the entered name", async ({ page, api }) => {
  let writes = 0;
  await page.route("**/api/group/groups", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    writes++;
    return route.fulfill({ status: 503, json: { errorMessage: "Response unavailable" } });
  });
  await page.goto("/groups");
  await page.getByRole("tab", { name: "Create group", exact: true }).click();
  const name = page.getByLabel("Group name", { exact: true });
  await name.fill("New team");
  const create = page.getByRole("button", { name: "Create group", exact: true });
  await create.click();
  await expect(create).toBeDisabled();
  await expect(name).toHaveValue("New team");
  await page.getByRole("button", { name: "Reload groups", exact: true }).click();
  await expect(create).toBeEnabled();
  await expect(name).toHaveValue("New team");
  expect(writes).toBe(1);
});

test("an externally deleted created group does not trap the Create tab", async ({ page, api }) => {
  await page.goto("/groups");
  const createTab = page.getByRole("tab", { name: "Create group", exact: true });
  await createTab.click();
  await page.getByLabel("Group name", { exact: true }).fill("Research team");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Research team");
  await page.getByRole("tab", { name: "Manage groups", exact: true }).click();
  const creation = api.requests.find(r => r.method === "POST" && r.path.endsWith("/groups"));
  expect(creation).toBeTruthy();
  await page.route("**/api/group/groups/*", route => route.request().method() === "GET" ? route.fulfill({ status: 404, json: { message: "Group deleted" } }) : route.fallback());
  await createTab.click();
  await expect(createTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("alert")).toContainText("Group deleted");
  await expect(page.getByLabel("Group name", { exact: true })).toBeEnabled();
  await page.getByLabel("Group name", { exact: true }).fill("Replacement group");
  await expect(page.getByRole("button", { name: "Create group", exact: true })).toBeEnabled();
});
