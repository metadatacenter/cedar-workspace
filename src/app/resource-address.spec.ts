import { afterEach, describe, expect, it } from "vitest";
import { resourceIri, resourcePathId, resourceSelector, useDeploymentApi, useDeploymentDomain } from "./resource-address";

/**
 * The compact address of a folder or artifact, across the deployment's base, the form an identifier
 * arrives in and the collection. The server expands a short selector onto its own base only, so the
 * browser may shorten an identity on that base and nothing else, and shortening must round-trip.
 */
const UUID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const COLLECTIONS = ["folders", "templates", "template-elements", "template-fields", "template-instances"];
const BASES: Record<string, string | null> = {
  "a development deployment": "https://repo.metadatacenter.orgx/",
  "the production deployment": "https://repo.metadatacenter.org/",
  "a deployment not yet known": null,
};
// Each form gives the identifier, and whether it is this deployment's own identity.
const FORMS: Record<string, (collection: string, base: string | null) => { id: string; own: boolean }> = {
  "its own identity": (c, b) => ({ id: `${b ?? "https://repo.metadatacenter.orgx/"}${c}/${UUID}`, own: !!b }),
  "its own identity with an upper-case uuid": (c, b) => ({ id: `${b ?? "https://repo.metadatacenter.orgx/"}${c}/${UUID.toUpperCase()}`, own: !!b }),
  "another CEDAR host's identity": (c, b) => ({ id: `https://repo.metadatacenter.${b?.includes(".org/") ? "orgx" : "org"}/${c}/${UUID}`, own: false }),
  "its own host over http": (c, b) => ({ id: `${(b ?? "https://repo.metadatacenter.orgx/").replace("https:", "http:")}${c}/${UUID}`, own: false }),
  "a malformed uuid": (c, b) => ({ id: `${b ?? "https://repo.metadatacenter.orgx/"}${c}/${UUID.slice(1)}`, own: false }),
  "a name rather than a uuid": (c, b) => ({ id: `${b ?? "https://repo.metadatacenter.orgx/"}${c}/home`, own: false }),
  "a trailing slash": (c, b) => ({ id: `${b ?? "https://repo.metadatacenter.orgx/"}${c}/${UUID}/`, own: false }),
  "a user rather than a resource": (_c, b) => ({ id: `${b ?? "https://repo.metadatacenter.orgx/"}users/${UUID}`, own: false }),
};

const cases: [string, string, string][] = [];
for (const base of Object.keys(BASES))
  for (const form of Object.keys(FORMS)) for (const collection of COLLECTIONS) cases.push([base, form, collection]);

describe("compact resource addresses", () => {
  afterEach(() => useDeploymentDomain(null));

  it.each(cases)("on %s, %s in %s", (baseName, formName, collection) => {
    const base = BASES[baseName];
    useDeploymentDomain(base ? new URL(base).hostname.replace(/^repo\./, "") : null);
    const home = `${base ?? "https://repo.metadatacenter.orgx/"}folders/${UUID}`;
    const { id, own } = FORMS[formName](collection, base);
    const uuid = id.slice(id.lastIndexOf("/") + 1);
    const selector = resourceSelector(id);
    expect(selector).toBe(own ? `${collection}/${uuid}` : id);
    expect(resourcePathId(id)).toBe(own ? uuid : id);
    // Shortening is undone exactly; anything left absolute is already its own identity.
    expect(resourceIri(selector, home)).toBe(id);
  });

  it.each(COLLECTIONS)("expands a typed %s selector onto the deployment's base, or the example's until it is known", (collection) => {
    const selector = `${collection}/${UUID}`;
    expect(resourceIri(selector, `https://repo.metadatacenter.orgy/folders/${UUID}`)).toBe(
      `https://repo.metadatacenter.orgy/${selector}`,
    );
    expect(resourceIri(selector, "home")).toBe(selector);
    useDeploymentDomain("metadatacenter.orgx");
    expect(resourceIri(selector, `https://repo.metadatacenter.orgy/folders/${UUID}`)).toBe(
      `https://repo.metadatacenter.orgx/${selector}`,
    );
    expect(resourcePathId(selector)).toBe(UUID);
    expect(resourceSelector(selector)).toBe(selector);
  });

  it.each([
    ["https://resource.metadatacenter.org", "https://repo.metadatacenter.org/"],
    ["https://resource.metadatacenter.org/", "https://repo.metadatacenter.org/"],
    ["https://resource.staging.metadatacenter.org", "https://repo.staging.metadatacenter.org/"],
    ["https://resource.metadatacenter.orgx", "https://repo.metadatacenter.orgx/"],
  ])("learns the base from the resource API %s", (api, base) => {
    useDeploymentApi(api);
    expect(resourceSelector(`${base}templates/${UUID}`)).toBe(`templates/${UUID}`);
    expect(resourcePathId(`${base}folders/${UUID}`)).toBe(UUID);
  });

  it("learns no base from a resource API on any other host", () => {
    for (const api of ["https://api.example", "https://user.metadatacenter.org", "https://metadatacenter.org", "not a URL", "", null, undefined]) {
      useDeploymentApi(api);
      expect(resourceSelector(`https://repo.metadatacenter.org/templates/${UUID}`)).toBe(
        `https://repo.metadatacenter.org/templates/${UUID}`,
      );
    }
  });

  // An account created when CEDAR ran on metadatacenter.net keeps its home folder and its older
  // resources on that base. The server would expand a short selector for one onto .org instead.
  it("keeps an earlier domain's identities absolute while shortening the deployment's own", () => {
    useDeploymentApi("https://resource.metadatacenter.org");
    const home = `https://repo.metadatacenter.net/folders/${UUID}`;
    for (const collection of COLLECTIONS) {
      const legacy = `https://repo.metadatacenter.net/${collection}/${UUID}`;
      expect(resourceSelector(legacy)).toBe(legacy);
      expect(resourcePathId(legacy)).toBe(legacy);
      expect(resourceIri(resourceSelector(legacy), home)).toBe(legacy);
      const own = `https://repo.metadatacenter.org/${collection}/${UUID}`;
      expect(resourceSelector(own)).toBe(`${collection}/${UUID}`);
      expect(resourceIri(resourceSelector(own), home)).toBe(own);
    }
  });

  it("learns the base from the deployment's domain", () => {
    useDeploymentDomain("metadatacenter.org");
    expect(resourceSelector(`https://repo.metadatacenter.org/templates/${UUID}`)).toBe(`templates/${UUID}`);
    expect(resourceSelector(`https://repo.metadatacenter.orgx/templates/${UUID}`)).toBe(
      `https://repo.metadatacenter.orgx/templates/${UUID}`,
    );
    useDeploymentDomain(undefined);
    expect(resourceSelector(`https://repo.metadatacenter.org/templates/${UUID}`)).toBe(
      `https://repo.metadatacenter.org/templates/${UUID}`,
    );
  });
});
