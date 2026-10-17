import { onTestFinished, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ElementRef } from "@angular/core";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import type {
  CedarEmbeddableEditorElement,
  CeeJsonObject,
  CeeRecoveryDraft,
  CeeTemplateAndInstance,
} from "cedar-embeddable-editor";
import { Backend, HttpError } from "../backend.service";
import { MetadataEditor } from "../metadata-editor";
import { CeeLoader } from "../cee-loader";
import { Confirmation } from "../confirmation";
import { useDeploymentDomain } from "../resource-address";
const quality = {
  isValid: true,
  requiredFieldValueCount: 0,
  nonNullRequiredFieldValueCount: 0,
  problems: [],
};
export async function metadataRig(mode = "edit", recovery = false) {
  // Creates mint their identity on the deployment's base, as Workspace learns it from the resource API.
  // The base is module state that outlives a test, so it is forgotten when the test finishes.
  useDeploymentDomain("example");
  onTestFinished(() => useDeploymentDomain(null));
  let server: CeeJsonObject = {
    "@id": "instance",
    "schema:isBasedOn": "template",
    "schema:name": "Original",
    Value: { "@value": "original" },
  };
  let writable = true;
  let revision = '"revision"';
  const signIn = vi.fn();
  const confirm = vi.fn().mockResolvedValue(true);
  const request = vi.fn(
    async (
      path: string,
      method = "GET",
      body?: unknown,
      _etag?: string | null,
    ): Promise<{ data: CeeJsonObject; etag: string | null }> => ({
      // A write answers with the identity it was sent under: a create's own, or the instance's.
      data:
        method !== "GET"
          ? { "@id": (body as CeeJsonObject | undefined)?.["@id"] ?? "instance" }
          : path === "/templates/template"
            ? { "@id": "template", "schema:name": "Study" }
            : path.endsWith("/report") || path.startsWith("/folders/")
              ? {
                  currentUserPermissions: {
                    capabilities: writable
                      ? ["updateResource", "createInFolder"]
                      : [],
                  },
                }
              : structuredClone(server),
      etag: revision,
    }),
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Backend,
        useValue: {
          init: async () => true,
          signIn,
          profile: { homeFolderId: "home" },
          ...(recovery
            ? {
                config: { resourceRestAPI: "https://resource.example" },
                userId: "owner",
              }
            : {}),
          request,
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({
              mode,
              id: mode === "edit" ? "instance" : "template",
            }),
            queryParamMap: convertToParamMap({}),
          },
        },
      },
      {
        provide: Router,
        useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) },
      },
      { provide: Confirmation, useValue: { confirm } },
    ],
  });
  const loader = TestBed.inject(CeeLoader);
  vi.spyOn(loader, "load").mockResolvedValue();
  const mount = loader.mountEditor.bind(loader);
  const editors: CedarEmbeddableEditorElement[] = [];
  const setValues = new WeakMap<
    CedarEmbeddableEditorElement,
    (value: string | null) => void
  >();
  vi.spyOn(loader, "mountEditor").mockImplementation((container) => {
    const cee = mount(container);
    let accepted = false;
    let current: CeeJsonObject = {};
    let template: CeeJsonObject = {};
    let drafts: CeeRecoveryDraft["drafts"] = [];
    setValues.set(cee, (value) => {
      current.Value = { "@value": value };
      cee.dispatchEvent(new Event("change"));
    });
    Object.defineProperties(cee, {
      captureDraft: {
        value: () => ({
          format: "cedar-cee-draft",
          version: 1,
          template: structuredClone(template),
          metadata: structuredClone(current),
          drafts: structuredClone(drafts),
        }),
      },
      restoreDraft: {
        value: (value: CeeRecoveryDraft) => {
          if (
            accepted ||
            value.format !== "cedar-cee-draft" ||
            !Array.isArray(value.drafts)
          )
            return false;
          accepted = true;
          current = structuredClone(value.metadata);
          template = structuredClone(value.template);
          drafts = structuredClone(value.drafts);
          return true;
        },
      },
      captureSave: {
        value: () => ({
          metadata: structuredClone(current),
          needsElementIds: false,
          acknowledge: () => {
            throw new Error("Unexpected acknowledgement");
          },
        }),
      },
      currentMetadata: { get: () => structuredClone(current) },
      dataQualityReport: { get: () => structuredClone(quality) },
      templateAndInstanceObject: {
        set: (value: CeeTemplateAndInstance) => {
          if (accepted) throw new Error("CEE artifact inputs are set once");
          accepted = true;
          template = structuredClone(value.templateObject);
          current = structuredClone(value.instanceObject);
        },
      },
      templateObject: {
        set: (value: CeeJsonObject) => {
          if (accepted) throw new Error("CEE artifact inputs are set once");
          accepted = true;
          template = structuredClone(value);
          // CEE writes the provenance of an instance that was never saved as null.
          current = {
            "schema:isBasedOn": value["@id"],
            "pav:createdOn": null,
            "pav:createdBy": null,
            "pav:lastUpdatedOn": null,
            "oslc:modifiedBy": null,
            Value: { "@value": null },
          };
        },
      },
    });
    editors.push(cee);
    return cee;
  });
  const host = TestBed.runInInjectionContext(() => new MetadataEditor());
  host.editorHost = new ElementRef(document.createElement("div"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  await host.ngAfterViewInit();
  return {
    host,
    signIn,
    editors,
    request,
    loader,
    confirm,
    setValue: (editor: CedarEmbeddableEditorElement, value: string | null) =>
      setValues.get(editor)!(value),
    access: (value: boolean) => {
      writable = value;
    },
    revision: (value: string) => {
      revision = value;
    },
    recreate: async () => {
      host.ngOnDestroy();
      const replacement = TestBed.runInInjectionContext(
        () => new MetadataEditor(),
      );
      replacement.editorHost = new ElementRef(document.createElement("div"));
      await replacement.ngAfterViewInit();
      return replacement;
    },
    server: (value: CeeJsonObject) => {
      server = value;
    },
    edit: () => {
      host.name = "Unsaved";
      host.changed();
    },
  };
}

/**
 * A metadata create is sent under an identity minted before the first attempt, and every later
 * attempt and every check of its outcome uses that identity. The server here holds at most what
 * was created under it. `lost` drops the reply of the next create after the server has decided.
 */
export async function metadataCreateRig() {
  const m = await metadataRig("create", true);
  const server = m.request.getMockImplementation()!;
  const world = {
    stored: null as Record<string, unknown> | null,
    lookup: null as number | null,
    lost: true,
    commit: true,
    refuse: null as number | null,
  };
  m.request.mockImplementation(async (path, method = "GET", body, etag) => {
    if (method === "PUT" && String(path).includes("?folder_id=")) {
      // The server refuses a second create under an identity it already holds.
      if (world.stored) throw new HttpError(world.refuse ?? 412, "Taken");
      // The server stamps the provenance of what it creates.
      if (world.commit)
        world.stored = {
          ...structuredClone(body as Record<string, unknown>),
          "pav:createdOn": "2026-10-16T12:00:00-07:00",
          "pav:createdBy": "https://metadatacenter.org/users/owner",
          "pav:lastUpdatedOn": "2026-10-16T12:00:00-07:00",
          "oslc:modifiedBy": "https://metadatacenter.org/users/owner",
        };
      if (world.lost) throw new HttpError(0, "No reply");
      return { data: { "@id": (body as { "@id": string })["@id"] }, etag: '"1"' };
    }
    if (method === "GET" && /^\/template-instances\/[0-9a-f-]{36}/.test(path)) {
      if (world.lookup) throw new HttpError(world.lookup, "Refused");
      if (!world.stored) throw new HttpError(404, "Not found");
      return path.endsWith("/report")
        ? {
            data: { currentUserPermissions: { capabilities: ["updateResource"] } },
            etag: '"1"',
          }
        : { data: structuredClone(world.stored) as never, etag: '"1"' };
    }
    return server(path, method, body, etag);
  });
  const creates = () =>
    m.request.mock.calls.filter(
      (call) => call[1] === "PUT" && String(call[0]).includes("?folder_id="),
    );
  const identities = () =>
    new Set(creates().map((call) => (call[2] as { "@id": string })["@id"]));
  return { ...m, world, creates, identities };
}
