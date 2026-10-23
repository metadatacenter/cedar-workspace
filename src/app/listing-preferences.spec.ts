import type {} from "./settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
import { Backend } from "./backend.service";
import { Workspace } from "./workspace";
import {
  ListingPreferences,
  SavedListing,
  defaultPreferences,
  preferenceQuery,
  preferencesFromParams,
  storedPreferences,
} from "./listing-preferences";
import type { Resource } from "./resource";

const chosen: ListingPreferences = {
  resourceTypes: ["folder", "template"],
  modified: "custom",
  modifiedAfter: "2026-01-31",
  modifiedBefore: "2026-10-23",
  version: "latest",
  sortBy: "lastUpdatedOnTS",
  sortDirection: "desc",
  foldersFirst: true,
  viewMode: "list",
};

describe("Listing preferences", () => {
  it("read back from the address they name, and a default other than the sort goes unnamed", () => {
    const query = preferenceQuery(chosen);
    expect(query).toEqual({
      resource_types: "folder,template",
      modified: "custom",
      after: "2026-01-31",
      before: "2026-10-23",
      version: "latest",
      sort: "-lastUpdatedOnTS",
      folders: "first",
      view: "list",
    });
    expect(preferencesFromParams(new URLSearchParams(query), false)).toEqual(chosen);
    expect(preferenceQuery(defaultPreferences())).toEqual({ sort: "name" });
    expect(preferencesFromParams(new URLSearchParams(), true)).toEqual(defaultPreferences());
  });
  it("keep the bounds of a custom range only", () => {
    const params = new URLSearchParams({ modified: "week", after: "2026-01-01", sort: "-size" });
    expect(preferencesFromParams(params, true)).toMatchObject({
      modified: "week",
      modifiedAfter: null,
      sortBy: "name",
      sortDirection: "asc",
    });
  });
  it("read a stored value this release does not know as its default, and nothing else", () => {
    expect(
      storedPreferences({
        resourceTypes: ["dataset", "field"],
        modified: "quarter",
        modifiedAfter: "2026-01-01",
        version: "newest",
        sortBy: "createdOnTS",
        sortDirection: "sideways",
        foldersFirst: "yes",
        viewMode: "list",
      }),
    ).toEqual({
      ...defaultPreferences(),
      resourceTypes: ["field"],
      sortBy: "createdOnTS",
      viewMode: "list",
    });
    expect(storedPreferences({ ...chosen, modifiedBefore: "2026-02-30" })).toEqual({
      ...chosen,
      modifiedBefore: null,
    });
    expect(storedPreferences(null)).toBeUndefined();
    expect(storedPreferences([])).toBeUndefined();
  });
});

describe("Saved listing", () => {
  let api: {
    profile: { homeFolderId: string; uiPreferences?: { workspace?: unknown } };
    userPath: string;
    request: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    api = { profile: { homeFolderId: "home" }, userPath: "/users/me", request: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: Backend, useValue: api }] });
  });
  it("writes one choice at a time, and only the latest of those made meanwhile", async () => {
    let finish!: () => void;
    api.request.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    api.request.mockResolvedValue({ data: {} });
    const saved = TestBed.inject(SavedListing);
    saved.save({ ...defaultPreferences(), viewMode: "list" });
    saved.save({ ...defaultPreferences(), foldersFirst: true });
    saved.save({ ...defaultPreferences(), version: "latest" });
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(saved.current()).toEqual({ ...defaultPreferences(), version: "latest" });
    finish();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
    expect(api.request.mock.calls.map((call) => call[2])).toEqual([
      { "uiPreferences.workspace": { ...defaultPreferences(), viewMode: "list" } },
      { "uiPreferences.workspace": { ...defaultPreferences(), version: "latest" } },
    ]);
    expect(api.request.mock.calls[1].slice(0, 2)).toEqual(["/users/me", "PUT"]);
  });
  it("writes nothing for a choice the profile already holds", () => {
    api.profile.uiPreferences = { workspace: chosen };
    TestBed.inject(SavedListing).save({ ...chosen });
    expect(api.request).not.toHaveBeenCalled();
  });
  it("keeps a choice for the visit when the profile refuses it", async () => {
    api.request.mockRejectedValue(new Error("refused"));
    const saved = TestBed.inject(SavedListing);
    saved.save(chosen);
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(1));
    expect(saved.current()).toEqual(chosen);
  });
});

describe("Workspace listing preferences", () => {
  const folder: Resource = {
    "@id": "home",
    resourceType: "folder",
    "schema:name": "My workspace",
    currentUserPermissions: { capabilities: ["readResource", "createInFolder"] },
  };
  const template: Resource = {
    "@id": "template-id",
    resourceType: "template",
    "schema:name": "A template",
    currentUserPermissions: { capabilities: ["readResource"] },
  };
  let api: {
    init: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    report: ReturnType<typeof vi.fn>;
    profile: { homeFolderId: string; uiPreferences?: { workspace?: unknown } };
    userPath: string;
    config: Record<string, string>;
  };
  beforeEach(() => {
    api = {
      init: vi.fn().mockResolvedValue(true),
      request: vi.fn(async (path: string) => ({
        data:
          path.includes("/contents") || path.includes("/search")
            ? { resources: [template], totalCount: 1, pathInfo: [folder] }
            : folder,
      })),
      report: vi.fn().mockResolvedValue({ data: template }),
      profile: { homeFolderId: "home" },
      userPath: "/users/me",
      config: {
        templateDesignerFrontend: "https://designer.example",
        workspaceFrontend: "https://workspace.example",
        openViewBase: "https://openview.example",
      },
    };
    TestBed.configureTestingModule({
      imports: [Workspace],
      providers: [provideRouter([]), { provide: Backend, useValue: api }],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  async function open(url = "/") {
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(Workspace);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.currentFolder()).toBeDefined());
    return fixture.componentInstance;
  }
  const listings = () =>
    api.request.mock.calls
      .map((call) => String(call[0]))
      .filter((path) => path.includes("/contents"));

  it("opens an address that names no preference with the saved ones", async () => {
    api.profile.uiPreferences = { workspace: chosen };
    const host = await open("/?folderId=home");
    const url = new URL(TestBed.inject(Router).url, "https://workspace.example");
    expect(Object.fromEntries(url.searchParams)).toEqual({ folderId: "home", ...preferenceQuery(chosen) });
    expect(listings()).toHaveLength(1);
    const listing = new URL(listings()[0], "https://api.example").searchParams;
    expect(listing.get("resource_types")).toBe("folder,template");
    expect(listing.get("version")).toBe("latest");
    expect(listing.get("sort")).toBe("foldersFirst,-lastUpdatedOnTS");
    expect(host.grid()).toBe(false);
  });
  it("names the sort in an address that names no preference, when the profile keeps none", async () => {
    await open("/?folderId=home");
    expect(TestBed.inject(Router).url).toBe("/?folderId=home&sort=name");
    expect(listings()).toHaveLength(1);
  });
  it("leaves an address that names a preference as it is", async () => {
    api.profile.uiPreferences = { workspace: chosen };
    const host = await open("/?sort=name");
    expect(TestBed.inject(Router).url).toBe("/?sort=name");
    expect(host.filters.types).toEqual([]);
    expect(host.grid()).toBe(true);
  });
  it("passes every preference on to a link inside the Workspace, and saves each one chosen", async () => {
    const host = await open("/?resource_types=template&modified=week&version=latest&view=list");
    expect(host.navigationQuery({ folderId: "f" })).toEqual({
      sort: "name",
      resource_types: "template",
      modified: "week",
      version: "latest",
      view: "list",
      folderId: "f",
    });
    host.setFoldersFirst(true);
    await vi.waitFor(() =>
      expect(api.request).toHaveBeenCalledWith("/users/me", "PUT", {
        "uiPreferences.workspace": {
          ...defaultPreferences(),
          resourceTypes: ["template"],
          modified: "week",
          version: "latest",
          viewMode: "list",
          foldersFirst: true,
        },
      }),
    );
  });
});
