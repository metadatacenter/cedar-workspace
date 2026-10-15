import { Confirmation } from "./confirmation";
import { TestBed } from "@angular/core/testing";
import { ElementRef, Provider } from "@angular/core";
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
  metadataFieldLabel,
  metadataWarningMessage,
  metadataRoute,
  workspaceReturn,
} from "./metadata-editor";
import { Backend, HttpError } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { provideWorkspaceTranslations } from "./i18n";
import type { CedarEmbeddableEditorElement } from "cedar-embeddable-editor";

describe("Modern metadata host", () => {
  let api: {
    init: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    profile: { homeFolderId: string };
  };
  let cee: CedarEmbeddableEditorElement;
  let host: MetadataEditor;
  let providers: Provider[];
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
      request: vi.fn(async (path: string, method = "GET") => {
        if (method !== "GET")
          return { data: { "@id": "instance-id" }, etag: '"i2"' };
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
    providers = [
      { provide: Backend, useValue: api },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigateByUrl: address } },
      {
        provide: CeeLoader,
        useValue: { load: vi.fn().mockResolvedValue(undefined), mountEditor: () => cee },
      },
    ];
    TestBed.configureTestingModule({ providers });
    cee = document.createElement(
      "cedar-embeddable-editor",
    ) as CedarEmbeddableEditorElement;
    Object.defineProperty(cee, "currentMetadata", {
      value: { Notes: { "@value": "initial" } },
      writable: true,
    });
    Object.assign(cee, { captureSave: () => ({metadata: structuredClone(cee.currentMetadata), needsElementIds: false, acknowledge: () => { throw new Error("Unexpected acknowledgement"); }}) });
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
    host.editorHost = new ElementRef(document.createElement("div"));
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
  it.each(["saved", "unchanged", "conflict", "read failed", "permission lost", "missing revision", "wrong identity"])(
    "checks an unconfirmed update (%s) without replacing the current form", async outcome => {
      await edit();
      const original = api.request.getMockImplementation()! as (path: string, method?: string) => Promise<{data: Record<string, unknown>; etag: string}>;
      let submitted: Record<string, unknown> = {};
      let recovery = false;
      api.request.mockImplementation(async (path, method = "GET", body) => {
        if (method === "PUT") { submitted = structuredClone(body); throw new Error("Lost reply"); }
        if (!recovery || path.endsWith("/report")) {
          if (recovery && outcome === "permission lost") return {data: {currentUserPermissions: {capabilities: []}}};
          return original(path, method);
        }
        if (outcome === "read failed") throw new Error("Offline");
        if (outcome === "unchanged") return original(path, method);
        return {data: {...submitted,
          ...(outcome === "conflict" ? {Notes: {"@value": "Other author"}} : {}),
          ...(outcome === "wrong identity" ? {"@id": "wrong"} : {}),
          "pav:lastUpdatedOn": "new"}, etag: outcome === "missing revision" ? null : '\"confirmed\"'};
      });
      cee.currentMetadata["Notes"] = {"@value": "Submitted"};
      host.changed(); await host.save();
      expect(host.canCheckSave()).toBe(true);
      expect(host.state.reloadRequired()).toBe(true);
      cee.currentMetadata["Notes"] = {"@value": "Newer"}; host.name = "Newer name"; host.changed();
      const form = cee.templateAndInstanceObject;
      recovery = true;
      await host.checkSaveStatus();
      expect(cee.currentMetadata["Notes"]).toEqual({"@value": "Newer"});
      expect(cee.templateAndInstanceObject).toBe(form);
      expect(host.dirty()).toBe(true);
      expect(host.state.reloadRequired()).toBe(!["saved", "unchanged"].includes(outcome));
      expect(host.canCheckSave()).toBe(!["saved", "unchanged"].includes(outcome));
      if (["saved", "unchanged"].includes(outcome)) {
        api.request.mockResolvedValue({data: {"@id": "instance-id"}, etag: '\"next\"'});
        await host.save();
        expect(api.request.mock.lastCall?.[3]).toBe(outcome === "saved" ? '\"confirmed\"' : '\"i1\"');
      } else {
        const calls = api.request.mock.calls.length;
        await host.save(); expect(api.request.mock.calls.length).toBe(calls);
      }
    },
  );
  it("keeps edits made during a recovery read and rejects results after disposal", async () => {
    await edit();
    const original = api.request.getMockImplementation()! as (path: string, method?: string) => Promise<{data: Record<string, unknown>; etag: string}>;
    let submitted: Record<string, unknown> = {};
    api.request.mockImplementation(async (path, method = "GET", body) => {
      if (method === "PUT") {submitted = structuredClone(body); throw new Error("Lost reply");}
      return original(path, method);
    });
    await host.save();
    let release!: (value: unknown) => void;
    api.request.mockImplementation((path) => path.endsWith("/report") ? original(path) : new Promise(resolve => {release = resolve;}));
    const checking = host.checkSaveStatus();
    expect(host.checkingSave()).toBe(true);
    await host.checkSaveStatus();
    cee.currentMetadata["Notes"] = {"@value": "During recovery"}; host.changed();
    host.ngOnDestroy();
    release({data: submitted, etag: '\"confirmed\"'});
    await checking;
    expect(cee.currentMetadata["Notes"]).toEqual({"@value": "During recovery"});
    expect(host.state.reloadRequired()).toBe(true);
  });
  it("acknowledges newly minted element IDs only after the recovered values match", async () => {
    const original = api.request.getMockImplementation()! as (path: string, method?: string) => Promise<{data: Record<string, unknown>; etag: string}>;
    api.request.mockImplementation(async (path, method = "GET") => path === "/templates/template-id"
      ? {data: {...template, properties: {Element: {"@type": "https://schema.metadatacenter.org/core/TemplateElement", properties: {}}}}}
      : original(path, method));
    await edit();
    cee.currentMetadata["Element"] = {"@id": null, Answer: {"@value": "Submitted"}};
    const snapshot = structuredClone(cee.currentMetadata);
    const acknowledge = vi.fn((stored) => {
      (cee.currentMetadata["Element"] as Record<string, unknown>)["@id"] = stored.Element["@id"];
      return {...snapshot, Element: stored.Element};
    });
    Object.assign(cee, {captureSave: () => ({metadata: snapshot, needsElementIds: true, acknowledge})});
    let submitted: Record<string, unknown> = {};
    api.request.mockImplementation(async (path, method = "GET", body) => {
      if (method === "PUT") {submitted = structuredClone(body); throw new Error("Lost reply");}
      if (path.endsWith("/report")) return original(path, method);
      return {data: {...submitted, Element: {"@id": "urn:minted", Answer: {"@value": "Submitted"}}}, etag: '\"confirmed\"'};
    });
    host.changed(); await host.save();
    cee.currentMetadata["Element"] = {"@id": null, Answer: {"@value": "Newer"}};
    await host.checkSaveStatus();
    expect(acknowledge).toHaveBeenCalledOnce();
    expect(cee.currentMetadata["Element"]).toEqual({"@id": "urn:minted", Answer: {"@value": "Newer"}});
    expect(host.dirty()).toBe(true); expect(host.state.reloadRequired()).toBe(false);
  });
  it("configures CEE once after permissions and starts clean", async () => {
    await host.ngAfterViewInit();
    expect(cee.config.readOnlyMode).toBe(false);
    expect(cee.templateObject).toEqual(template);
    expect(host.name).toBe("Study metadata");
    expect(host.returnTo).toBe("/dashboard?search=Study");
    expect(host.loading()).toBe(false);
    expect(host.dirty()).toBe(false);
  });
  it.each([
    ["a template", "create", "CEDAR cannot read this template, so metadata cannot be entered for it."],
    ["metadata", "edit", "CEDAR cannot read this metadata or its template, so it cannot be shown."],
  ])("says so when CEE refuses %s it cannot read, and offers no retry", async (_what, mode, message) => {
    // CEE holds no artifact after refusing one, so its metadata stays empty.
    Object.assign(cee, { currentMetadata: {} });
    if (mode === "edit") await edit();
    else await host.ngAfterViewInit();
    expect(host.state.loadFailed()).toBe(true);
    expect(host.unreadable()).toBe(true);
    expect(host.error()).toBe(message);
    expect(host.saveStatus).toBe("Metadata.LoadFailed");
  });
  it("shows a new untouched instance as unmodified until it is edited", async () => {
    await host.ngAfterViewInit();
    expect(host.saveStatus).toBe("Metadata.UnmodifiedStatus");
    expect(host.dirty()).toBe(false);
    host.name = "Changed";
    host.changed();
    expect(host.saveStatus).toBe("Metadata.ModifiedStatus");
    await host.save();
    expect(host.saveStatus).toBe("Metadata.SavedStatus");
    expect(host.dirty()).toBe(false);
  });
  it("shows an existing artifact as unmodified until it is saved here", async () => {
    await edit();
    expect(host.saveStatus).toBe("Metadata.UnmodifiedStatus");
    expect(host.dirty()).toBe(false);
    host.name = "Changed";
    host.changed();
    expect(host.saveStatus).toBe("Metadata.ModifiedStatus");
    await host.save();
    expect(host.saveStatus).toBe("Metadata.SavedStatus");
  });
  it("passes the active language to CEE with English as its fallback", async () => {
    await host.ngAfterViewInit();
    expect(cee.config.defaultLanguage).toBe("en");
    expect(cee.config.fallbackLanguage).toBe("en");
  });
  it("passes Hungarian to CEE when Workspace shows Hungarian", async () => {
    host.ngOnDestroy();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [...providers, ...provideWorkspaceTranslations("hu")],
    });
    host = TestBed.runInInjectionContext(() => new MetadataEditor());
    host.editorHost = new ElementRef(document.createElement("div"));
    host.editor = new ElementRef(cee);
    await host.ngAfterViewInit();
    expect(cee.config.defaultLanguage).toBe("hu");
    expect(cee.config.fallbackLanguage).toBe("en");
    expect(host.name).toBe("Study – metaadatok");
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
    cee.currentMetadata["schema:description"] = "";
    const input = cee.templateObject;
    api.request.mockResolvedValue({ data: { "@id": "new-id" }, etag: '"i2"' });
    await host.save();
    expect(api.request).toHaveBeenLastCalledWith(
      "/template-instances?folder_id=folder",
      "POST",
      expect.objectContaining({
        "schema:name": "Study metadata",
        "schema:isBasedOn": "template-id",
        "schema:description": "Study description",
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
      expect.objectContaining({ "@id": "new-id", "schema:description": "Study description" }),
      '"i2"',
    );
    await host.save();
    expect(api.request.mock.lastCall?.[3]).toBe('"i3"');
    expect(api.request.mock.lastCall?.[2]["schema:description"]).toBe("Study description");
    expect(cee.templateObject).toBe(input);
    expect(cee.templateAndInstanceObject).toBeUndefined();
  });
  it.each([
    ['"saved"', '"saved"'],
    ['"1--gzip--gzip"', '"1--gzip"'],
    ['"1-resource-record--gzip"', '"1"'],
  ])("adopts element IDs from the saved revision (%s / %s) and keeps newer edits dirty", async (writeTag, readTag) => {
    await host.ngAfterViewInit();
    cee.currentMetadata["Element"] = {"@id": null};
    const submitted = structuredClone(cee.currentMetadata);
    const acknowledge = vi.fn((stored) => {
      cee.currentMetadata["Element"] = stored.Element;
      return {...submitted, Element: stored.Element};
    });
    Object.assign(cee, {captureSave: () => ({metadata: submitted, needsElementIds: true, acknowledge})});
    api.request.mockImplementation(async (_path, method = "GET") => {
      if (method === "POST") {
        cee.currentMetadata["Notes"] = {"@value": "newer edit"};
        return {data: {"@id": "new-id"}, etag: writeTag};
      }
      return {data: {"@id": "new-id", Element: {"@id": "urn:element"}}, etag: readTag};
    });
    await host.save();
    expect(acknowledge).toHaveBeenCalledOnce();
    expect(cee.currentMetadata["Notes"]).toEqual({"@value": "newer edit"});
    expect(cee.currentMetadata["Element"]).toEqual({"@id": "urn:element"});
    expect(host.dirty()).toBe(true);
    expect(host.state.reloadRequired()).toBe(false);
    expect(host.error()).toBe("");
  });
  it.each(["unavailable", "different revision", "different compressed revision", "weak revision", "invalid identities"])(
    "keeps the draft and blocks another write when identity readback is %s", async (failure) => {
      await host.ngAfterViewInit();
      cee.currentMetadata["Element"] = {"@id": null};
      host.changed();
      const acknowledge = vi.fn(() => { throw new Error("Invalid identities"); });
      Object.assign(cee, {captureSave: () => ({metadata: structuredClone(cee.currentMetadata), needsElementIds: true, acknowledge})});
      api.request.mockImplementation(async (_path, method = "GET") => {
        if (method === "POST") {
          cee.currentMetadata["Notes"] = {"@value": "newer edit"};
          return {data: {"@id": "new-id"}, etag: '"1--gzip--gzip"'};
        }
        if (failure === "unavailable") throw new Error("Network error");
        const tag = failure === "different revision" ? '"2"'
          : failure === "different compressed revision" ? '"2--gzip"'
          : failure === "weak revision" ? 'W/"1"' : '"1--gzip"';
        return {data: {"@id": "new-id"}, etag: tag};
      });
      await host.save();
      expect(host.error()).toContain("Saved, but");
      expect(host.state.reloadRequired()).toBe(true);
      expect(host.state.uncertainCreation()).toBe(false);
      expect(host.dirty()).toBe(true);
      expect(cee.currentMetadata["Element"]).toEqual({"@id": null});
      expect(address).toHaveBeenCalledWith(expect.stringContaining("/instances/edit/new-id?"), {replaceUrl:true});
      if (failure !== "invalid identities") expect(acknowledge).not.toHaveBeenCalled();
      const calls = api.request.mock.calls.length;
      await host.save();
      expect(api.request.mock.calls.length).toBe(calls);
    },
  );
  it.each(["", "Imported instance description"])(
    "preserves the loaded description %j across field edits and sparse acknowledgements",
    async (description) => {
      const original = api.request.getMockImplementation()! as (
        path: string, method?: string,
      ) => Promise<{data: Record<string, unknown>; etag: string}>;
      api.request.mockImplementation(async (path, method = "GET") => {
        const reply = await original(path, method);
        if (method === "GET" && path === "/template-instances/instance-id")
          return {...reply, data: {...reply.data, "schema:description": description}};
        return reply;
      });
      await edit();
      cee.currentMetadata["schema:description"] = "";
      for (const value of ["First edit", "Second edit"]) {
        cee.currentMetadata["Notes"] = {"@value": value};
        host.changed();
        await host.save();
        expect(api.request.mock.lastCall?.[2]).toMatchObject({
          "schema:description": description, Notes: {"@value": value},
        });
      }
    },
  );
  it.each([412, 404])(
    "keeps unsaved edits and the read-time validator after %s",
    async (status) => {
      await edit();
      host.name = "Unsaved";
      host.changed();
      api.request.mockRejectedValue(new HttpError(status, "Deleted (404)"));
      await host.save();
      expect(host.error()).toBe(status === 412
        ? "This item changed since you opened it. Your edits have been kept. Cancel and reopen to review the latest version."
        : "Deleted (404)");
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
  it("does not count spaces around the name as an edit, and saves the trimmed name", async () => {
    await edit();
    const typed = host.name;
    host.name = `  ${typed} `;
    host.changed();
    expect(host.dirty()).toBe(false);
    host.name = ` ${typed} renamed `;
    host.changed();
    expect(host.dirty()).toBe(true);
    api.request.mockResolvedValue({
      data: { "@id": "instance-id" },
      etag: '"i2"',
    });
    await host.save();
    expect(api.request.mock.lastCall?.[2]?.["schema:name"]).toBe(`${typed} renamed`);
    expect(host.dirty()).toBe(false);
    host.name = `${typed} renamed`;
    host.changed();
    expect(host.dirty()).toBe(false);
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
    // Each listed problem leads to its field.
    const reveal = vi.fn().mockResolvedValue(true);
    Object.defineProperty(cee, "reveal", { value: reveal });
    host.reveal(host.validationErrors[0]);
    expect(reveal).toHaveBeenCalledWith({
      ...cee.dataQualityReport.problems[1],
      severity: "error",
    });
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

describe("metadata field labels", () => {
  it("resolves display labels through repeated elements instead of showing internal keys", () => {
    const schema = {
      _ui: { propertyLabels: { samples: "Study samples" } },
      properties: {
        samples: {
          type: "array",
          items: {
            "schema:name": "Sample",
            properties: {
              amount: {
                "schema:name": "Amount",
                "skos:prefLabel": "Sample weight",
              },
              count: { "schema:name": "Cell count" },
            },
          },
        },
      },
    };
    expect(metadataFieldLabel(schema, ["samples", "0", "amount"])).toBe(
      "Study samples · #1 · Sample weight",
    );
    expect(metadataFieldLabel(schema, ["samples", "count"])).toBe(
      "Study samples · Cell count",
    );
    expect(metadataFieldLabel(schema, ["unknown"])).toBe("unknown");
    expect(
      metadataFieldLabel(
        { properties: { "2026": { "schema:name": "Annual count" } } },
        ["2026"],
      ),
    ).toBe("Annual count");
  });
  it("numbers the entry of each repeated element or field a problem is in", () => {
    const schema = {
      properties: {
        samples: {
          type: "array",
          items: {
            "schema:name": "Sample",
            properties: {
              tags: {
                type: "array",
                items: {
                  "schema:name": "Tag",
                  _ui: { inputType: "textfield" },
                },
              },
              picks: {
                type: "array",
                items: {
                  "schema:name": "Picks",
                  _ui: { inputType: "checkbox" },
                },
              },
            },
          },
        },
      },
    };
    expect(metadataFieldLabel(schema, ["samples", "tags"], [1, 2])).toBe(
      "Sample 2 · Tag 3",
    );
    // A list of entries is named as a whole, so only the element is numbered.
    expect(metadataFieldLabel(schema, ["samples", "tags"], [1])).toBe(
      "Sample 2 · Tag",
    );
    // A checkbox group shows every selection at once and has no entries to number.
    expect(metadataFieldLabel(schema, ["samples", "picks"], [0])).toBe(
      "Sample 1 · Picks",
    );
    // A requirement any entry satisfies names no entry.
    expect(metadataFieldLabel(schema, ["samples", "tags"], [])).toBe(
      "Sample · Tag",
    );
  });
  it("passes over a parent label that only repeats the key or the field's own name", () => {
    const schema = {
      _ui: {
        propertyLabels: {
          parent_sample_id: "parent_sample_id",
          contributors_path: "contributors_path",
        },
      },
      properties: {
        parent_sample_id: {
          "schema:name": "parent_sample_id",
          "skos:prefLabel": "Parent sample ID",
        },
        contributors_path: { "schema:name": "contributors_path" },
      },
    };
    expect(metadataFieldLabel(schema, ["parent_sample_id"])).toBe(
      "Parent sample ID",
    );
    // With nothing more legible, the form shows the name, and so does the warning.
    expect(metadataFieldLabel(schema, ["contributors_path"])).toBe(
      "contributors_path",
    );
  });
});

describe("metadata warning messages", () => {
  const template = {
    properties: {
      samples: {
        type: "array",
        minItems: 2,
        items: { properties: { amount: { "schema:name": "Amount" } } },
      },
    },
  };
  const t = (key: string, params?: Record<string, unknown>) =>
    `${key}${params ? " " + JSON.stringify(params) : ""}`;
  const problem = (code: string, value: unknown, path = ["samples"]) => ({
    code,
    path,
    occurrences: [],
    field: path[path.length - 1],
    inputType: null,
    message: "CEE's English diagnostic",
    value,
  });

  it("states the warnings it presents through the translation files", () => {
    expect(metadataWarningMessage(template, problem("required", null), t)).toBe(
      "Metadata.ProblemRequired",
    );
    expect(metadataWarningMessage(template, problem("minItems", 1), t)).toBe(
      'Metadata.ProblemMinItems {"count":1,"min":2}',
    );
  });

  it("keeps CEE's text for a problem it has no wording for", () => {
    expect(
      metadataWarningMessage(template, problem("minItems", 1, ["unknown"]), t),
    ).toBe("CEE's English diagnostic");
    expect(metadataWarningMessage(template, problem("pattern", "x"), t)).toBe(
      "CEE's English diagnostic",
    );
  });
});
