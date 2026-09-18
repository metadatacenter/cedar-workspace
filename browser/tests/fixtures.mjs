import { test as base, expect } from "@playwright/test";
const owner = { "@id": "owner", firstName: "Alex", lastName: "Researcher" };
const collaborator = {
  "@id": "collaborator",
  firstName: "Sam",
  lastName: "Curator",
};
const group = {
  "@id": "team",
  "schema:name": "Research team",
  "schema:description": "Shared study metadata",
};
export const capabilities = [
  "readResource",
  "updateResource",
  "createInFolder",
  "manageGrants",
  "transferOwnership",
  "deleteResource",
  "moveResource",
  "copyFromResource",
  "populate",
  "publish",
  "createDraft",
  "enableOpenView",
];
export const resource = {
  "@id": "template",
  resourceType: "template",
  "schema:name": "Study metadata",
  "schema:description": "A representative template for shared research.",
  "pav:version": "1.0.0",
  "bibo:status": "bibo:draft",
  "pav:createdOn": "2026-01-01T12:00:00Z",
  "pav:lastUpdatedOn": "2026-01-02T12:00:00Z",
  ownedByUserName: "Alex Researcher",
  currentUserPermissions: { capabilities, owner: true },
};
const folder = {
  ...resource,
  "@id": "home",
  resourceType: "folder",
  "schema:name": "My workspace",
};
export const test = base.extend({
  api: async ({ page, baseURL }, use) => {
    await page.clock.setFixedTime(new Date("2026-01-03T12:00:00Z"));
    const state = {
      readonly: false,
      fail: false,
      requests: [],
      pending: false,
    };
    await page.addInitScript(() => {
      window.KeycloakUserHandler = class {
        initUserHandler(ok) {
          ok(true);
        }
        refreshToken(seconds, ok) {
          ok();
        }
        getToken() {
          return "fixture-token";
        }
        getParsedToken() {
          return { sub: "owner", email: "alex@example.org" };
        }
        doLogin() {
          throw Error("Unexpected authentication redirect");
        }
      };
    });
    // Host contract fixture only: CEE's own pixels are protected in its existing suite.
    await page.route("**/third_party_components/**", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `
      window.cedarEmbeddableEditorVersion = 'fixture';
      customElements.define('cedar-embeddable-editor', class extends HTMLElement {
        currentMetadata = {}; dataQualityReport = {isValid:true};
        set templateAndInstanceObject(value) { this.currentMetadata = value.instanceObject; }
      });
    `,
      }),
    );
    await page.route("**/config/embeddable-editor-config.json", (route) =>
      route.fulfill({ json: {} }),
    );
    await page.route("**/scripts/**", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.route("**/config/version.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.route("**/config/url-service.conf.json", (route) =>
      route.fulfill({
        json: {
          resourceRestAPI: baseURL + "/api/resource",
          userRestAPI: baseURL + "/api/user",
          groupRestAPI: baseURL + "/api/group",
          impexRestAPI: baseURL + "/api/impex",
          workspaceFrontend: baseURL,
          templateDesignerFrontend: baseURL,
          openViewBase: baseURL,
          monitoringFrontend: baseURL,
        },
      }),
    );
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        path = decodeURIComponent(url.pathname);
      state.requests.push({
        method: request.method(),
        path,
        body: request.postDataJSON(),
        revision: request.headers()["if-match"],
      });
      if (state.pending && request.method() !== "GET")
        await new Promise((resolve) => setTimeout(resolve, 250));
      if (state.fail && request.method() !== "GET")
        return route.fulfill({
          status: 412,
          json: { message: "This resource changed. Reload before saving." },
        });
      const item = {
        ...resource,
        currentUserPermissions: {
          capabilities: state.readonly ? ["readResource"] : capabilities,
          owner: !state.readonly,
        },
      };
      let body;
      if (path.endsWith("/summary")) body = { createdTimestamp: 1767268800000 };
      else if (path.endsWith("/apiKeys")) body = { apiKeys: [] };
      else if (path === "/api/user/users/owner")
        body = {
          ...owner,
          homeFolderId: "home",
          email: "alex@example.org",
          uiPreferences: { preferredDateFormat: "yyyy-MM-dd" },
        };
      else if (path.endsWith("/permissions"))
        body = {
          owner,
          userPermissions: [{ user: collaborator, role: "viewer" }],
          groupPermissions: [],
        };
      else if (path.endsWith("/members"))
        body = {
          members: [
            { user: owner, administrator: true, member: true },
            { user: collaborator, administrator: false, member: true },
          ],
        };
      else if (path.endsWith("/groups/team")) body = group;
      else if (path.endsWith("/groups")) body = { groups: [group] };
      else if (path.endsWith("/users")) body = { users: [owner, collaborator] };
      else if (path.endsWith("/contents") || path.endsWith("/search"))
        body = {
          resources: url.searchParams.has("is_based_on") ? [] : [item],
          totalCount: 1,
          pathInfo: [folder],
        };
      else if (path.includes("/folders/home")) body = folder;
      else if (path.includes("/template-instances/instance"))
        body = path.endsWith("/report")
          ? item
          : {
              "@id": "instance",
              "schema:name": "Study record",
              "schema:isBasedOn": "template",
            };
      else if (path.includes("/templates/template")) body = item;
      else if (path.includes("/command/")) body = item;
      else
        throw new Error(
          "Unmocked fixture request: " + request.method() + " " + path,
        );
      await route.fulfill({
        json: body,
        headers: { ETag: '"fixture-revision"' },
      });
    });
    await use(state);
  },
});
export { expect };
export async function dashboard(page) {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "Study metadata", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".table-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
export async function action(page, name) {
  await page
    .getByRole("button", { name: "Actions for Study metadata" })
    .click();
  await page
    .locator(".resource-menu")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await expect(page.locator("dialog[open] button").last()).toBeEnabled();
}
