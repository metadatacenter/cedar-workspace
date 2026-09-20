import { Confirmation } from "./confirmation";
import { TestBed } from "@angular/core/testing";
import { ElementRef } from "@angular/core";
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  UrlSegment,
} from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MetadataEditor,
  metadataKey,
  metadataRoute,
  workspaceReturn,
} from "./metadata-editor";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import type { CedarEmbeddableEditorElement } from "cedar-embeddable-editor";

describe("Modern metadata host", () => {
  let api: {
    init: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    profile: { homeFolderId: string };
  };
  let cee: CedarEmbeddableEditorElement;
  let host: MetadataEditor;
  let address: ReturnType<typeof vi.fn>;
  let route: {
    snapshot: {
      paramMap: ReturnType<typeof convertToParamMap>;
      queryParamMap: ReturnType<typeof convertToParamMap>;
    };
  };
  const template = {
    "@id": "template-id",
    "schema:name": "Study",
    "schema:description": "Study description",
  };
  beforeEach(() => {
    api = {
      init: vi.fn().mockResolvedValue(true),
      profile: { homeFolderId: "home" },
      request: vi.fn(async (path: string) => {
        if (path === "/templates/template-id")
          return { data: template, etag: '"t1"' };
        if (path === "/template-instances/instance-id")
          return {
            data: {
              "@id": "instance-id",
              "schema:isBasedOn": "template-id",
              "schema:name": "Saved metadata",
            },
            etag: '"i1"',
          };
        return {
          data: {
            currentUserPermissions: {
              capabilities: ["updateResource", "createInFolder"],
            },
          },
          etag: '"g1"',
        };
      }),
    };
    address = vi.fn().mockResolvedValue(true);
    route = {
      snapshot: {
        paramMap: convertToParamMap({ mode: "create", id: "template-id" }),
        queryParamMap: convertToParamMap({
          folderId: "folder",
          returnTo: "/dashboard?search=Study",
        }),
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Backend, useValue: api },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigateByUrl: address } },
        {
          provide: CeeLoader,
          useValue: { load: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    });
    cee = document.createElement(
      "cedar-embeddable-editor",
    ) as CedarEmbeddableEditorElement;
    Object.defineProperty(cee, "currentMetadata", {
      value: { Notes: { "@value": "initial" } },
      writable: true,
    });
    Object.defineProperty(cee, "dataQualityReport", {
      value: {
        isValid: true,
        requiredFieldValueCount: 0,
        nonNullRequiredFieldValueCount: 0,
        problems: [],
      },
      writable: true,
    });
    host = TestBed.runInInjectionContext(() => new MetadataEditor());
    host.editor = new ElementRef(cee);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  });
  afterEach(() => {
    host.ngOnDestroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function edit() {
    route.snapshot.paramMap = convertToParamMap({
      mode: "edit",
      id: "instance-id",
    });
    await host.ngAfterViewInit();
  }
  it("configures CEE once after permissions and starts clean", async () => {
    await host.ngAfterViewInit();
    expect(cee.config.readOnlyMode).toBe(false);
    expect(cee.templateObject).toEqual(template);
    expect(host.name).toBe("Study metadata");
    expect(host.returnTo).toBe("/dashboard?search=Study");
    expect(host.loading()).toBe(false);
    expect(host.dirty()).toBe(false);
  });
  it("loads an instance and its template into a read-only editor for viewers", async () => {
    const original = api.request.getMockImplementation()! as (
      path: string,
    ) => Promise<unknown>;
    api.request.mockImplementation(async (path) =>
      path.endsWith("/report")
        ? {
            data: { currentUserPermissions: { capabilities: [] } },
            etag: '"g1"',
          }
        : original(path),
    );
    await edit();
    expect(cee.config.readOnlyMode).toBe(true);
    expect(cee.templateAndInstanceObject.templateObject).toEqual(template);
    const calls = api.request.mock.calls.length;
    await host.save();
    expect(api.request).toHaveBeenCalledTimes(calls);
  });
  it("fails closed on an unreadable permissions report", async () => {
    api.request.mockRejectedValue(new Error("Forbidden"));
    await edit();
    expect(host.writable()).toBe(false);
    expect(host.error()).toBe("Forbidden");
    expect(cee.config).toBeUndefined();
  });
  it("tracks metadata and name edits and their exact reverts", async () => {
    await host.ngAfterViewInit();
    cee.currentMetadata["Notes"] = { "@value": "new" };
    cee.dispatchEvent(new Event("change"));
    expect(host.dirty()).toBe(true);
    cee.currentMetadata["Notes"] = { "@value": "initial" };
    host.changed();
    expect(host.dirty()).toBe(false);
    host.name = "Renamed";
    host.changed();
    expect(host.dirty()).toBe(true);
    host.name = "Study metadata";
    host.changed();
    expect(host.dirty()).toBe(false);
  });
  it("creates once, then updates with each returned ETag without resetting CEE", async () => {
    await host.ngAfterViewInit();
    const input = cee.templateObject;
    api.request.mockResolvedValue({ data: { "@id": "new-id" }, etag: '"i2"' });
    await host.save();
    expect(api.request).toHaveBeenLastCalledWith(
      "/template-instances?folder_id=folder",
      "POST",
      expect.objectContaining({
        "schema:name": "Study metadata",
        "schema:isBasedOn": "template-id",
      }),
      null,
    );
    expect(address).toHaveBeenCalledWith(
      expect.stringMatching(/^\/instances\/edit\/new-id\?.*returnTo=/),
      { replaceUrl: true },
    );
    api.request.mockResolvedValue({ data: { "@id": "new-id" }, etag: '"i3"' });
    await host.save();
    expect(api.request).toHaveBeenLastCalledWith(
      "/template-instances/new-id",
      "PUT",
      expect.objectContaining({ "@id": "new-id" }),
      '"i2"',
    );
    await host.save();
    expect(api.request.mock.lastCall?.[3]).toBe('"i3"');
    expect(cee.templateObject).toBe(input);
    expect(cee.templateAndInstanceObject).toBeUndefined();
  });
  it.each(["Conflict (412)", "Deleted (404)"])(
    "keeps unsaved edits and the read-time validator after %s",
    async (error) => {
      await edit();
      host.name = "Unsaved";
      host.changed();
      api.request.mockRejectedValue(new Error(error));
      await host.save();
      expect(host.error()).toBe(error);
      expect(host.name).toBe("Unsaved");
      expect(host.dirty()).toBe(true);
      await host.save();
      expect(api.request.mock.lastCall?.[3]).toBe('"i1"');
    },
  );
  it("blocks updates without a content ETag", async () => {
    await edit();
    Object.assign(host, { etag: null });
    api.request.mockClear();
    await host.save();
    expect(api.request).not.toHaveBeenCalled();
    expect(host.error()).toContain("validator");
  });
  it("keeps edits made while a save is pending dirty and prevents double submission", async () => {
    await edit();
    let resolve!: (value: { data: object; etag: string }) => void;
    api.request.mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    const pending = host.save();
    const calls = api.request.mock.calls.length;
    await host.save();
    expect(api.request.mock.calls.length).toBe(calls);
    host.name = "Typed during save";
    host.changed();
    resolve({ data: { "@id": "instance-id" }, etag: '"i2"' });
    await pending;
    expect(host.name).toBe("Typed during save");
    expect(host.dirty()).toBe(true);
    expect(host.notice()).toContain("further unsaved");
  });
  it("reports validation issues without preventing incomplete metadata saves", async () => {
    await edit();
    Object.assign(cee.dataQualityReport, {
      isValid: false,
      requiredFieldValueCount: 2,
      nonNullRequiredFieldValueCount: 1,
    });
    host.changed();
    expect(host.missingRequired).toBe(1);
    api.request.mockResolvedValue({
      data: { "@id": "instance-id" },
      etag: '"i2"',
    });
    await host.save();
    expect(host.notice()).toBe("Saved.");
  });
  it("blocks invalid values but permits warnings once errors are corrected", async () => {
    await edit();
    Object.assign(cee.dataQualityReport, {
      isValid: false,
      problems: [
        {
          path: ["Title"],
          field: "Title",
          code: "required",
          message: "A value is required.",
        },
        {
          path: ["Email"],
          field: "Email",
          code: "email",
          message: "Enter a valid email.",
        },
      ],
    });
    host.changed();
    expect(host.validationWarnings).toHaveLength(1);
    expect(host.validationErrors).toHaveLength(1);
    api.request.mockClear();
    await host.save();
    expect(api.request).not.toHaveBeenCalled();
    cee.dataQualityReport.problems.pop();
    host.changed();
    expect(host.validationErrors).toHaveLength(0);
    api.request.mockResolvedValue({
      data: { "@id": "instance-id" },
      etag: '"i2"',
    });
    await host.save();
    expect(host.notice()).toBe("Saved.");
  });
  it("guards dirty navigation and unload, but allows clean navigation", async () => {
    await edit();
    expect(await host.mayLeave()).toBe(true);
    host.name = "Unsaved";
    host.changed();
    vi.spyOn(TestBed.inject(Confirmation), "confirm").mockResolvedValue(false);
    expect(await host.mayLeave()).toBe(false);
    const event = new Event("beforeunload", { cancelable: true });
    host.beforeUnload(event as BeforeUnloadEvent);
    expect(event.defaultPrevented).toBe(true);
    vi.mocked(TestBed.inject(Confirmation).confirm).mockResolvedValue(true);
    expect(await host.mayLeave()).toBe(true);
    host.saving.set(true);
    expect(await host.mayLeave()).toBe(false);
  });
  it("does not configure a destroyed host after asynchronous loading", async () => {
    host.ngOnDestroy();
    await host.ngAfterViewInit();
    expect(cee.config).toBeUndefined();
  });
  it("compares object key order independently while preserving array order", () => {
    expect(metadataKey({ a: 1, b: 2 })).toBe(metadataKey({ b: 2, a: 1 }));
    expect(metadataKey([1, 2])).not.toBe(metadataKey([2, 1]));
  });
  it.each([
    "https://evil.example/dashboard",
    "//evil.example/dashboard",
    "/instances/create/id",
    "javascript:alert(1)",
  ])("rejects unsafe or looping return destination %s", (value) => {
    expect(workspaceReturn(value, "folder")).toBe("/dashboard?folderId=folder");
  });
  it("accepts encoded and old raw identifier route segments", () => {
    const segments = [
      "instances",
      "edit",
      "https:",
      "",
      "repo.example",
      "instances",
      "id",
    ].map((s) => new UrlSegment(s, {}));
    expect(
      metadataRoute(segments, {} as never, {} as never)?.posParams?.["id"].path,
    ).toBe("https://repo.example/instances/id");
    expect(
      metadataRoute([new UrlSegment("groups", {})], {} as never, {} as never),
    ).toBeNull();
  });
});
