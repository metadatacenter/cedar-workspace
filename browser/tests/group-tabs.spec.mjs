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
