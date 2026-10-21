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

/** Each piece of text a node holds, trimmed, with the language it is in, in document order. */
const languages = (locator) =>
  locator.evaluate((root) => {
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (text.textContent.trim())
        parts.push([text.textContent.trim(), text.parentElement.closest("[lang]")?.getAttribute("lang")]);
    }
    return parts;
  });

test("a list of failed moves marks each server message English, and the rest takes the page's language", async ({
  page,
  api,
}) => {
  const archive = {
    ...resource,
    "@id": "archive",
    resourceType: "folder",
    "schema:name": "Archive",
    currentUserPermissions: { capabilities: ["readResource", "moveIntoFolder"] },
  };
  const samples = ["a", "b"].map((id) => ({
    ...resource,
    "@id": id,
    resourceType: "instance",
    "schema:name": "Sample " + id,
  }));
  await page.route("**/api/resource/**", (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.endsWith("/contents")) {
      const resources = path.includes("/archive/") ? [] : [archive, ...samples];
      return route.fulfill({ json: { resources, totalCount: resources.length, pathInfo: [] } });
    }
    // The server refuses one move with a message of its own, and fails the other with none, which
    // Workspace words itself.
    if (path.endsWith("/move-resource-to-folder"))
      return request.postDataJSON()["@id"] === "a"
        ? route.fulfill({ status: 403, json: { message: "Move refused" } })
        : route.fulfill({ status: 503, body: "" });
    const r = [archive, ...samples].find(
      (r) => path.includes("/" + r["@id"] + "/") || path.endsWith("/" + r["@id"]),
    );
    return r
      ? route.fulfill({
          json: { ...r, pathInfo: [{ "@id": "home", resourceType: "folder" }, r] },
          headers: { ETag: `"${r["@id"]}"` },
        })
      : route.fallback();
  });
  await hungarian(page);
  await page.goto("/dashboard?view=list");
  const row = (id) => page.locator(`[data-resource-id="${id}"]`);
  await expect(row("b")).toBeVisible();
  await row("a").locator(".resource-icon").click();
  await row("b").locator(".resource-icon").click({ modifiers: ["ControlOrMeta"] });
  const source = await row("a").locator(".resource-icon").boundingBox(),
    target = await row("archive").boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2 + 10, { steps: 3 });
  await page.mouse.move(target.x + 50, target.y + target.height / 2, { steps: 12 });
  await expect(page.locator("body")).toHaveClass(/explorer-can-drop/);
  await page.mouse.up();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Sample a: Move refused; Sample b: A kérés sikertelen (503).");
  // Each artifact's name, and Workspace's own words, take the page's language; the server's are English.
  expect(await languages(alert.locator(":scope > span"))).toEqual([
    ["Sample a:", "hu"],
    ["Move refused", "en"],
    [";", "hu"],
    ["Sample b:", "hu"],
    ["A kérés sikertelen (503).", "hu"],
  ]);
});

test("a status Workspace does not know is marked English wherever it shows, and a known one is translated", async ({
  page,
  api,
}) => {
  const retracted = { ...resource, "bibo:status": "bibo:retracted" };
  const version = (id, number, status) => ({
    ...resource,
    "@id": id,
    "pav:version": number,
    "bibo:status": status,
  });
  await page.route("**/api/resource/folders/home/contents?**", (route) =>
    route.fulfill({ json: { resources: [retracted], totalCount: 1, pathInfo: [] } }),
  );
  await page.route("**/templates/template/report", (route) =>
    route.fulfill({
      json: {
        ...retracted,
        // Newest first, and including the template itself.
        versions: [
          retracted,
          version("older", "0.9.0", "bibo:retracted"),
          version("oldest", "0.8.0", "bibo:draft"),
        ],
      },
    }),
  );
  await hungarian(page);
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("lang", "hu");
  const card = page.locator(".explorer-status");
  await expect(card).toHaveText("Retracted");
  expect(await language(card)).toBe("en");

  await page.goto("/dashboard?view=list");
  const cell = page.locator(".explorer-item td").filter({ hasText: "1.0.0" });
  await expect(cell).toHaveText("1.0.0 · Retracted");
  expect(await languages(cell)).toEqual([
    ["1.0.0", "hu"],
    ["·", "hu"],
    ["Retracted", "en"],
  ]);

  await page.locator(".explorer-item td").nth(1).click();
  await page.locator("#information-version-tab").click();
  const status = page.locator(".version dd").nth(2);
  await expect(status).toHaveText("Retracted · Legújabb verzió");
  expect(await languages(status)).toEqual([
    ["Retracted", "en"],
    ["· Legújabb verzió", "hu"],
  ]);
  const previous = page.locator(".previous-versions a");
  await expect(previous).toHaveText(["Study metadata · 0.9.0 · Retracted", "Study metadata · 0.8.0 · Vázlat"]);
  expect(await languages(previous.first())).toEqual([
    ["Study metadata", "hu"],
    ["· 0.9.0", "hu"],
    ["·", "hu"],
    ["Retracted", "en"],
  ]);
  expect(await languages(previous.last())).toEqual([
    ["Study metadata", "hu"],
    ["· 0.8.0", "hu"],
    ["·", "hu"],
    ["Vázlat", "hu"],
  ]);

  await page.locator(".explorer-item .row-actions button").first().click();
  const preview = page.locator("dialog.artifact-preview");
  await expect(preview).not.toHaveClass(/is-preparing/);
  const shown = preview.locator(".preview-facts").getByText("Retracted", { exact: true });
  await expect(shown).toBeVisible();
  expect(await language(shown)).toBe("en");
});

test("CEE's explanations take the page's language, and its English diagnostics are marked English", async ({
  page,
  api,
}) => {
  await hungarian(page);
  await page.goto("/instances/edit/instance");
  await expect(page.locator("html")).toHaveAttribute("lang", "hu");
  await expect(page.getByLabel("Példány neve")).toHaveValue("Study record");
  // CEE explains each problem in the language Workspace gives it, Hungarian here, and keeps its
  // diagnostic in English. An older bundle gives a diagnostic only.
  await page.evaluate(() => {
    const editor = document.querySelector("cedar-embeddable-editor");
    editor.dataQualityReport = {
      isValid: false,
      problems: [
        {
          path: ["Email"],
          code: "valueShape",
          severity: "error",
          message: "Not a valid email address.",
          displayMessage: "Adjon meg egy érvényes e-mail címet.",
        },
        {
          path: ["Title"],
          code: "required",
          severity: "warning",
          message: "A value is required.",
        },
        {
          path: ["Code"],
          code: "pattern",
          severity: "warning",
          message: "The value does not match the pattern.",
        },
      ],
    };
    editor.dispatchEvent(new CustomEvent("change"));
  });
  const errors = page.getByLabel("Metaadathibák", { exact: true });
  const warnings = page.getByLabel("Metaadat-figyelmeztetések", { exact: true });
  await errors.locator(":scope > summary").click();
  await errors.getByText("Technikai részletek", { exact: true }).click();
  await warnings.locator(":scope > summary").click();
  expect(await languages(errors.locator("li"))).toEqual([
    ["Email:", "hu"],
    ["Adjon meg egy érvényes e-mail címet.", "hu"],
    ["Technikai részletek", "hu"],
    ["Not a valid email address.", "en"],
  ]);
  // Workspace words a missing value itself; it shows CEE's diagnostic for what it has no words for.
  expect(await languages(warnings.locator("ul"))).toEqual([
    ["Title:", "hu"],
    ["Egy kötelező érték hiányzik.", "hu"],
    ["Code:", "hu"],
    ["The value does not match the pattern.", "en"],
  ]);
});
