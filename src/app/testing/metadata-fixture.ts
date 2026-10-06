import { vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ElementRef } from "@angular/core";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import type { CedarEmbeddableEditorElement, CeeJsonObject, CeeTemplateAndInstance } from "cedar-embeddable-editor";
import { Backend } from "../backend.service";
import { MetadataEditor } from "../metadata-editor";
import { CeeLoader } from "../cee-loader";
import { Confirmation } from "../confirmation";
const quality = { isValid: true, requiredFieldValueCount: 0, nonNullRequiredFieldValueCount: 0, problems: [] };
export async function metadataRig(mode = 'edit') {
  let server: CeeJsonObject = { '@id': 'instance', 'schema:isBasedOn': 'template', 'schema:name': 'Original', Value: { '@value': 'original' } };
  const request = vi.fn(async (path: string, method = 'GET') => ({
    data: method !== 'GET' ? { '@id': 'instance' }
      : path === '/templates/template' ? { '@id': 'template', 'schema:name': 'Study' }
      : path.endsWith('/report') || path.startsWith('/folders/')
        ? { currentUserPermissions: { capabilities: ['updateResource', 'createInFolder'] } }
        : structuredClone(server),
    etag: '"revision"',
  }));
  TestBed.configureTestingModule({ providers: [
    { provide: Backend, useValue: { init: async () => true, profile: { homeFolderId: 'home' }, request } },
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ mode, id: mode === 'edit' ? 'instance' : 'template' }), queryParamMap: convertToParamMap({}) } } },
    { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
    { provide: Confirmation, useValue: { confirm: async () => true } },
  ] });
  const loader = TestBed.inject(CeeLoader);
  vi.spyOn(loader, "load").mockResolvedValue();
  const mount = loader.mountEditor.bind(loader);
  const editors: CedarEmbeddableEditorElement[] = [];
  vi.spyOn(loader, "mountEditor").mockImplementation((container) => {
    const cee = mount(container);
    let accepted = false;
    let current: CeeJsonObject = {};
    Object.defineProperties(cee, {
      currentMetadata: { get: () => structuredClone(current) },
      dataQualityReport: { get: () => structuredClone(quality) },
      templateAndInstanceObject: { set: (value: CeeTemplateAndInstance) => {
        if (accepted) throw new Error("CEE artifact inputs are set once");
        accepted = true; current = structuredClone(value.instanceObject);
      } },
      templateObject: { set: (value: CeeJsonObject) => {
        if (accepted) throw new Error("CEE artifact inputs are set once");
        accepted = true; current = { "schema:isBasedOn": value["@id"], Value: { "@value": null } };
      } },
    });
    editors.push(cee);
    return cee;
  });
  const host = TestBed.runInInjectionContext(() => new MetadataEditor());
  host.editorHost = new ElementRef(document.createElement("div"));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  await host.ngAfterViewInit();
  return { host, editors, request, loader, server: (value: CeeJsonObject) => { server = value; },
    edit: () => { host.name = "Unsaved"; host.changed(); } };

}
