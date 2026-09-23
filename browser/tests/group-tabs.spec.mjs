import { test, expect } from "./fixtures.mjs";

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
