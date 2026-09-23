import { describe, expect, it } from "vitest";
import { listingPath, resourceLink, Config, Resource, can } from "./resource";
const config = {
  workspaceFrontend: "https://workspace.example",
  templateDesignerFrontend: "https://designer.example",
} as Config;
const resource: Resource = {
  "@id": "https://repo.example/templates/a?x=1&y=2",
  resourceType: "template",
};
describe("Workspace navigation contract", () => {
  it.each([
    "",
    "search=heart",
    "sharing=shared-with-me",
    "viewMode=view-special-folders",
  ])("filters latest versions on the server: %s", (mode) => {
    const params = new URLSearchParams(mode);
    params.set("version", "latest");
    const url = new URL(
      listingPath(params, "home", "name", 0),
      "https://api.example",
    );
    expect(url.searchParams.get("version")).toBe("latest");
    params.set("version", "unexpected");
    expect(
      new URL(
        listingPath(params, "home", "name", 0),
        "https://api.example",
      ).searchParams.has("version"),
    ).toBe(false);
  });
  it("lists every version and type without legacy filters", () => {
    const url = new URL(
      listingPath(
        new URLSearchParams(),
        "https://repo.example/folders/home",
        "-name",
        50,
      ),
      "https://api.example",
    );
    expect(url.pathname).toBe(
      "/folders/https%3A%2F%2Frepo.example%2Ffolders%2Fhome/contents",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sort: "-name",
      limit: "50",
      offset: "50",
    });
  });
  it.each([
    "",
    "search=heart",
    "sharing=shared-with-me",
    "viewMode=view-special-folders",
  ])(
    "requests folders first before the selected sort across listing modes: %s",
    (mode) => {
      const params = new URLSearchParams(mode);
      params.set("folders", "first");
      const url = new URL(
        listingPath(params, "home", "-createdOnTS", 50),
        "https://api.example",
      );
      expect(url.searchParams.get("sort")).toBe("foldersFirst,-createdOnTS");
      expect(url.searchParams.get("offset")).toBe("50");
    },
  );
  it.each([
    ["search", "heart & lung", "q", "heart & lung"],
    ["sharing", "shared-with-me", "sharing", "shared-with-me"],
    ["viewMode", "view-special-folders", "mode", "special-folders"],
  ])("maps %s to the backend", (key, value, target, expected) => {
    const path = listingPath(
      new URLSearchParams({ [key]: value }),
      "home",
      "name",
      0,
    );
    const url = new URL(path, "https://api.example");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get(target)).toBe(expected);
  });
  it.each(["template", "element", "field"] as const)(
    "sends %s to the split CED host",
    (kind) => {
      const url = new URL(
        resourceLink(
          { ...resource, resourceType: kind },
          config,
          "folder",
          "https://workspace.example/dashboard?search=a",
        ),
      );
      expect(url.origin).toBe(config.templateDesignerFrontend);
      expect(url.pathname).toContain(encodeURIComponent(resource["@id"]));
      expect(url.searchParams.get("returnTo")).toBe(
        "https://workspace.example/dashboard?search=a",
      );
    },
  );
  it("sends populate and metadata edit to the CEE host", () => {
    expect(
      new URL(resourceLink(resource, config, "folder", "return", true))
        .pathname,
    ).toContain("/instances/create/");
    expect(
      new URL(
        resourceLink(
          { ...resource, resourceType: "instance" },
          config,
          "folder",
          "return",
        ),
      ).pathname,
    ).toContain("/instances/edit/");
  });
  it("does not infer permissions from ownership or roles", () => {
    expect(
      can(
        {
          ...resource,
          currentUserPermissions: { owner: true, role: "manager" },
        },
        "deleteResource",
      ),
    ).toBe(false);
    expect(
      can(
        {
          ...resource,
          currentUserPermissions: { availableActions: ["populate"] },
        },
        "populate",
      ),
    ).toBe(true);
  });
});
