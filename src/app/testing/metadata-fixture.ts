import { vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ElementRef } from "@angular/core";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import type {
  CedarEmbeddableEditorElement,
  CeeJsonObject,
  CeeRecoveryDraft,
  CeeTemplateAndInstance,
} from "cedar-embeddable-editor";
import { Backend } from "../backend.service";
import { MetadataEditor } from "../metadata-editor";
import { CeeLoader } from "../cee-loader";
import { Confirmation } from "../confirmation";
const quality = {
  isValid: true,
  requiredFieldValueCount: 0,
  nonNullRequiredFieldValueCount: 0,
  problems: [],
};
export async function metadataRig(mode = "edit", recovery = false) {
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
      _body?: unknown,
      _etag?: string | null,
    ): Promise<{ data: CeeJsonObject; etag: string | null }> => ({
      data:
        method !== "GET"
          ? { "@id": "instance" }
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
          current = {
            "schema:isBasedOn": value["@id"],
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
