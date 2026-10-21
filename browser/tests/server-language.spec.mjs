import { test, expect, resource } from "./fixtures.mjs";

const hungarian = (page) =>
  page.addInitScript(() =>
    Object.defineProperty(navigator, "languages", { get: () => ["hu-HU"] }),
  );
/** The language a node's text is in: its own `lang`, or the nearest ancestor's. */
const language = (locator) =>
  locator.evaluate((node) => node.closest("[lang]")?.getAttribute("lang"));
const listing = "**/api/resource/folders/home/contents?**";

async function hungarianDashboard(page) {
  await hungarian(page);
  await page.goto("/dashboard?view=list");
  await expect(page.locator("html")).toHaveAttribute("lang", "hu");
  await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
}

test("a server's message is marked English in a Hungarian page, and Workspace's own words are not", async ({
  page,
  api,
}) => {
  await hungarianDashboard(page);
  const refresh = page.getByRole("button", { name: "Munkaterület frissítése", exact: true });
  const alert = page.getByRole("alert");
  await page.route(listing, (route) =>
    route.fulfill({ status: 503, json: { message: "Listing unavailable" } }),
  );
  await refresh.click();
  const message = alert.getByText("Listing unavailable", { exact: true });
  await expect(message).toBeVisible();
  expect(await language(message)).toBe("en");
  // The dismiss button around it keeps the page's language.
  expect(await language(alert.getByRole("button"))).toBe("hu");
  await page.unroute(listing);
  await page.route(listing, (route) => route.fulfill({ status: 503, body: "" }));
  await refresh.click();
  const own = alert.getByText("A kérés sikertelen (503).", { exact: true });
  await expect(own).toBeVisible();
  expect(await language(own)).toBe("hu");
});

test("a role Workspace does not know is marked English, and a known one is translated", async ({
  page,
  api,
}) => {
  let role = "classifier";
  await page.route("**/templates/template/report", (route) =>
    route.fulfill({
      json: { ...resource, currentUserPermissions: { role, capabilities: ["readResource"] } },
    }),
  );
  await hungarianDashboard(page);
  const access = page.locator(".information dt:has-text('Az Ön hozzáférése') + dd > span");
  for (const [stated, shown, lang] of [
    ["classifier", "classifier", "en"],
    ["viewer", "Megtekintő", "hu"],
  ]) {
    role = stated;
    await page.locator(".explorer-item td").nth(1).click();
    await expect(access).toHaveText(shown);
    expect(await language(access)).toBe(lang);
    await page.getByRole("button", { name: "Munkaterület frissítése", exact: true }).click();
    await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
  }
});

test("each place that shows a server's message marks it English", async ({ page, api }) => {
  const groupTaken = "There is a group with the same name present in the system. Group names must be unique!";
  const badName = "The name is not valid";
  const unreadable = "You do not have read access to the permissions";
  const unsaved = "The description could not be saved";
  const noProfile = "You are not allowed to read other user's profile!";
  await page.route("**/api/group/groups", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 400, json: { message: groupTaken } })
      : route.fallback(),
  );
  await page.route("**/templates/template/permissions", (route) =>
    route.fulfill({ status: 403, json: { message: unreadable } }),
  );
  await page.route("**/api/resource/**", (route) => {
    const request = route.request();
    const body = request.method() === "GET" ? null : request.postDataJSON();
    if (body?.["schema:description"] === "Edited")
      return route.fulfill({ status: 400, json: { message: unsaved } });
    if (body?.["schema:name"] === "Renamed")
      return route.fulfill({ status: 400, json: { message: badName } });
    return route.fallback();
  });
  await hungarianDashboard(page);
  const shown = async (text) => {
    const node = page.getByText(text, { exact: true });
    await expect(node).toBeVisible();
    expect(await language(node), text).toBe("en");
  };

  // The rename dialog.
  await page.locator(".row-actions > button").last().click();
  await page.locator(".resource-menu button").filter({ hasText: "Átnevezés" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.locator("button").last()).toBeEnabled();
  await dialog.locator("input").first().fill("Renamed");
  await dialog.locator("footer button").last().click();
  await shown(badName);
  // Leaving the dialog discards the typed name, which a confirmation checks first.
  await page.keyboard.press("Escape");
  await page.locator("dialog.confirmation-dialog button.primary").click();
  await expect(dialog).toHaveCount(0);

  // The Permissions dialog.
  await page.locator(".row-actions > button").last().click();
  await page.locator(".resource-menu button").filter({ hasText: "Jogosultságok" }).click();
  await shown(unreadable);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // The Information panel's description.
  await page.locator(".explorer-item td").nth(1).click();
  await page.locator("#resource-description").fill("Edited");
  await page.locator("cedar-description-editor .actions .primary").click();
  await shown(unsaved);

  // Groups.
  await page.goto("/groups");
  await page.locator("#create-group-tab").click();
  await page.locator("#new-group-name").fill("Research team");
  await page.locator(".groups-create-form button").click();
  await shown(groupTaken);

  // An account page.
  await page.route("**/api/user/users/owner", (route) =>
    route.fulfill({ status: 403, json: { message: noProfile } }),
  );
  await page.goto("/profile");
  await shown(noProfile);
});
