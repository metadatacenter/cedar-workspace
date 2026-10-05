import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.mjs";

// Every place Workspace sends a request, against the answers that take different paths through
// it, in both languages. Each failure is shown where the person is, in the language Workspace
// speaks. The only exception is a refusal the server explains, which is shown as the server wrote
// it. Nothing is left blank or still loading, and the browser's own "Failed to fetch" never
// reaches the page.

const catalogue = (language) =>
  JSON.parse(readFileSync(new URL(`../../src/assets/i18n/${language}.json`, import.meta.url), "utf8"));
const CATALOGUES = { en: catalogue("en"), hu: catalogue("hu") };
const translator = (language) => (key, params = {}) => {
  const value = key.split(".").reduce((node, part) => node?.[part], CATALOGUES[language]);
  if (typeof value !== "string") throw new Error(`no ${language} text for ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name]));
};

const EXPLANATION = "The server explains why it refused";
const ANSWERS = {
  "an explained refusal": {
    answer: (route) => route.fulfill({ status: 409, json: { message: EXPLANATION } }),
    text: () => EXPLANATION,
  },
  "an unexplained 500": {
    answer: (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal error</html>" }),
    text: (t) => t("Errors.RequestFailed", { status: 500 }),
  },
  "no answer": {
    answer: (route) => route.abort("failed"),
    text: (t) => t("Errors.Unreachable"),
  },
  "an ended session": {
    answer: (route) => route.fulfill({ status: 401, json: {} }),
    text: (t) => t("Errors.SessionExpired"),
  },
  // Only a request that names the revision it read can meet a conflict.
  "a conflict": {
    conditional: true,
    answer: (route) => route.fulfill({ status: 412, json: { message: "The resource changed" } }),
    text: (t) => t("Errors.ItemChanged"),
  },
};

async function openDashboard(page, t) {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: t("Explorer.List"), exact: true }).click();
  await expect(page.getByRole("link", { name: "Study metadata", exact: true }).first()).toBeVisible();
}

async function resourceAction(page, t, key) {
  await openDashboard(page, t);
  await page.getByRole("button", { name: t("Dashboard.ActionsFor", { name: "Study metadata" }) }).first().click();
  await page.locator(".resource-menu").getByRole("button", { name: t(key), exact: true }).click();
  await expect(page.locator("dialog[open]")).toBeVisible();
}

const submitDialog = (page) => page.locator("dialog[open] button[type=submit]").click();

// Each site says how to reach it, which request to fail, and whether that request is conditional.
// `arm` names the moment from which the request fails: everything before it is answered normally.
const SITES = {
  "loading the workspace": {
    request: (method, path) => method === "GET" && path.endsWith("/contents"),
    arm: "before",
    act: async (page) => page.goto("/dashboard"),
  },
  "refreshing the workspace": {
    request: (method, path) => method === "GET" && path.endsWith("/contents"),
    before: openDashboard,
    act: async (page, t) => page.getByRole("button", { name: t("Dashboard.Refresh") }).click(),
  },
  "loading a search": {
    request: (method, path) => method === "GET" && path.endsWith("/search"),
    arm: "before",
    act: async (page) => page.goto("/dashboard?search=study"),
  },
  "creating a folder": {
    request: (method, path) => method === "POST" && path.endsWith("/api/resource/folders"),
    before: openDashboard,
    act: async (page, t) => {
      await page.getByRole("button", { name: t("Dashboard.New"), exact: true }).click();
      await page.locator(".new-menu nav").getByText(t("ResourceTypes.folder"), { exact: true }).click();
      await page.locator("dialog[open] input").first().fill("Analyses");
      await submitDialog(page);
    },
  },
  "renaming": {
    conditional: true,
    request: (method, path) => method === "POST" && path.endsWith("/command/rename-resource"),
    before: (page, t) => resourceAction(page, t, "ResourceActions.Rename"),
    act: async (page) => {
      await page.locator("dialog[open] input").first().fill("Study metadata, renamed");
      await submitDialog(page);
    },
    // The dialog keeps what was typed, and says so.
    text: { "a conflict": (t) => t("Errors.ChangedEditsKept") },
  },
  "saving a description": {
    conditional: true,
    request: (method, path) => method === "POST" && path.endsWith("/command/rename-resource"),
    before: async (page, t) => {
      await openDashboard(page, t);
      await page.locator("tbody tr").first().press("Enter");
      const description = page.locator("#resource-description");
      await expect(description).toBeEnabled();
      await description.fill("An edited description");
    },
    act: async (page, t) =>
      page.getByRole("complementary", { name: t("Dashboard.Information") })
        .getByRole("button", { name: t("Common.Save"), exact: true }).click(),
    text: { "a conflict": (t) => t("Errors.ChangedEditsKept") },
  },
  "copying": {
    request: (method, path) => method === "POST" && path.endsWith("/command/copy-artifact-to-folder"),
    before: async (page, t) => {
      // The shared fixture's home folder grants no copy into it, which a destination needs.
      await page.route("**/api/resource/folders/home", (route) =>
        route.fulfill({ json: { "@id": "home", resourceType: "folder", "schema:name": "My workspace",
          currentUserPermissions: { capabilities: ["readResource", "copyIntoFolder", "createInFolder"] } } }));
      await resourceAction(page, t, "ResourceActions.Copy");
    },
    act: submitDialog,
  },
  "publishing": {
    request: (method, path) => method === "POST" && path.endsWith("/command/publish-artifact"),
    before: (page, t) => resourceAction(page, t, "ResourceActions.Publish"),
    act: submitDialog,
  },
  "deleting": {
    conditional: true,
    request: (method, path) => method === "DELETE" && path.includes("/templates/template"),
    before: (page, t) => resourceAction(page, t, "ResourceActions.Delete"),
    act: submitDialog,
  },
  "enabling OpenView": {
    conditional: true,
    request: (method, path) => method === "POST" && path.endsWith("/command/make-artifact-open"),
    before: (page, t) => resourceAction(page, t, "ResourceActions.MakeOpen"),
    act: submitDialog,
  },
  "loading permissions": {
    request: (method, path) => method === "GET" && path.endsWith("/permissions"),
    before: openDashboard,
    act: async (page, t) => {
      await page.getByRole("button", { name: t("Dashboard.ActionsFor", { name: "Study metadata" }) }).first().click();
      await page.locator(".resource-menu").getByRole("button", { name: t("ResourceActions.Permissions"), exact: true }).click();
    },
  },
  "loading groups": {
    request: (method, path) => method === "GET" && path.endsWith("/api/group/groups"),
    arm: "before",
    act: async (page) => page.goto("/groups"),
  },
  "creating a group": {
    request: (method, path) => method === "POST" && path.endsWith("/api/group/groups"),
    before: async (page, t) => {
      await page.goto("/groups");
      await page.getByRole("tab", { name: t("Groups.Create"), exact: true }).click();
    },
    act: async (page, t) => {
      await page.getByLabel(t("Groups.GroupName"), { exact: true }).fill("Research team");
      await page.getByRole("button", { name: t("Groups.Create"), exact: true }).click();
    },
  },
  "saving settings": {
    request: (method, path) => method === "PUT" && path === "/api/user/users/owner",
    before: async (page) => page.goto("/settings"),
    // The choice saves as it changes.
    act: async (page) => {
      const format = page.locator("#date-format");
      const other = await format.evaluate((select) =>
        [...select.options].find((option) => option.value !== select.value).value);
      await format.selectOption(other);
    },
  },
  "loading metadata": {
    request: (method, path) => method === "GET" && path.endsWith("/template-instances/instance"),
    arm: "before",
    act: async (page) => page.goto("/instances/edit/instance"),
  },
  "saving metadata": {
    conditional: true,
    request: (method, path) => method === "PUT" && path.endsWith("/template-instances/instance"),
    before: async (page) => {
      await page.goto("/instances/edit/instance");
      await expect(page.locator("#instance-name, input").first()).toBeEnabled();
    },
    act: async (page, t) => {
      await page.getByLabel(t("Metadata.Name"), { exact: true }).fill("Study record, edited");
      await page.getByRole("button", { name: t("Common.Save"), exact: true }).click();
    },
    // The editor keeps the edits on screen, and says so.
    text: { "a conflict": (t) => t("Metadata.ItemChanged") },
  },
};

for (const language of ["en", "hu"])
  for (const [site, spec] of Object.entries(SITES))
    for (const [name, answer] of Object.entries(ANSWERS)) {
      if (answer.conditional && !spec.conditional) continue;
      test(`${site} meets ${name}, in ${language}`, async ({ page, api }) => {
        const t = translator(language);
        if (language === "hu")
          await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["hu-HU"] }));
        let armed = spec.arm === "before";
        await page.route("**/api/**", (route) => {
          const request = route.request();
          const path = decodeURIComponent(new URL(request.url()).pathname);
          if (armed && spec.request(request.method(), path)) return answer.answer(route);
          return route.fallback();
        });
        if (spec.before) await spec.before(page, t);
        armed = true;
        await spec.act(page, t);
        const expected = (spec.text?.[name] ?? answer.text)(t);
        await expect(page.getByRole("alert").filter({ hasText: expected }).first()).toBeVisible();
        await expect(page.getByText("Failed to fetch")).toHaveCount(0);
      });
    }
