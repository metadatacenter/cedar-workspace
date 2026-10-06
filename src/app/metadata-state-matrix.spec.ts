import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ElementRef } from "@angular/core";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import type {
  CedarEmbeddableEditorElement,
  CeeJsonObject,
} from "cedar-embeddable-editor";
import {
  MetadataState,
  metadataLocation,
  problemSeverity,
} from "./metadata-state";
import { MetadataEditor, metadataFieldLabel } from "./metadata-editor";
import { Backend, HttpError } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { Confirmation } from "./confirmation";

const good = {
  isValid: true,
  requiredFieldValueCount: 0,
  nonNullRequiredFieldValueCount: 0,
  problems: [],
};
function nested(depth: number, repeated: boolean, fieldType: string) {
  const leaf = "Value/~0";
  let field: CeeJsonObject = {
    "schema:name": "Value",
    _ui: { inputType: fieldType },
  };
  if (fieldType !== "textfield") field = { type: "array", items: field };
  let template: CeeJsonObject = { properties: { [leaf]: field } };
  const path = [leaf],
    occurrences: number[] = fieldType === "repeated" ? [2] : [];
  let pointer =
    "/Value~1~00" + (fieldType === "textfield" ? "" : "/2") + "/@value";
  for (let i = depth - 1; i >= 0; i--) {
    const key = `Child ${i}`;
    path.unshift(key);
    template["schema:name"] = key;
    template = {
      properties: {
        [key]: repeated ? { type: "array", items: template } : template,
      },
    };
    pointer = "/" + key + (repeated ? "/1" : "") + pointer;
    if (repeated) occurrences.unshift(1);
  }
  return { template, path, occurrences, pointer };
}

describe("metadata validation ownership matrix", () => {
  for (const depth of [0, 1, 3, 8])
    for (const repeated of [false, true])
      for (const fieldType of ["textfield", "repeated", "checkbox", "list"])
        for (const severity of ["error", "warning"] as const) {
          it(`maps depth=${depth}, repeated=${repeated}, ${fieldType}, ${severity} and retires only obsolete reports`, () => {
            const { template, path, occurrences, pointer } = nested(
              depth,
              repeated,
              fieldType,
            );
            expect(metadataLocation(template, pointer)).toEqual({
              path,
              occurrences,
            });
            const state = new MetadataState();
            state.observe(good, "original");
            state.reject(
              {
                [severity === "error" ? "errors" : "warnings"]: [
                  { message: "Review this value", location: pointer },
                ],
              },
              "original",
              template,
            );
            const problem = state.quality()!.problems[0];
            expect(problem).toMatchObject({ path, occurrences, severity });
            expect(problemSeverity(problem)).toBe(severity);
            expect(
              metadataFieldLabel(template, problem.path, problem.occurrences),
            ).toContain("Value");
            state.observe(good, "original");
            expect(state.quality()!.problems).toHaveLength(1);
            state.observe(good, "edited");
            expect(state.quality()!.problems).toEqual([]);
            state.reject(
              { errors: [{ message: "Late old failure", location: pointer }] },
              "original",
              template,
            );
            expect(state.quality()!.problems).toEqual([]);
            state.reject(
              { errors: [{ message: "Current failure", location: pointer }] },
              "edited",
              template,
            );
            expect(state.quality()!.problems).toHaveLength(1);
            state.clearServer();
            expect(state.quality()!.problems).toEqual([]);
          });
        }
  for (const code of ["required", "minItems", "iri", "unknownFutureCode"])
    for (const severity of [undefined, "warning", "error"] as const) {
      it(`honors explicit severity for ${code}/${severity}`, () => {
        const problem = {
          code,
          severity,
          path: [],
          occurrences: [],
          field: "",
          inputType: null,
          message: "",
        };
        const expected =
          severity ??
          (["required", "minItems"].includes(code) ? "warning" : "error");
        expect(problemSeverity(problem)).toBe(expected);
        const state = new MetadataState();
        state.observe({ ...good, problems: [problem] }, "current");
        expect(state.quality()!.problems[0]).toMatchObject({
          severity: expected,
        });
        expect(state.quality()!.isValid).toBe(expected === "warning");
        expect(problem.severity).toBe(severity);
      });
    }
  for (const report of [
    null,
    {},
    { isValid: true, problems: null },
    { isValid: true, problems: [null] },
    { isValid: true, problems: [{ code: "iri", path: null }] },
    {
      isValid: true,
      problems: [{ code: "iri", path: ["X"], occurrences: [-1] }],
    },
  ]) {
    it(`blocks unusable reports and recovers: ${JSON.stringify(report)}`, () => {
      const state = new MetadataState();
      state.observe(report, "same");
      expect(state.quality()!.problems[0].code).toBe("reportUnavailable");
      state.observe(good, "same");
      expect(state.quality()!.isValid).toBe(true);
    });
  }
  for (const location of [
    "/",
    "",
    "/unknown",
    "/Value~2",
    "/Child 0/Value~1~00/@value",
    "/Child 0/-1/Value~1~00/@value",
    "/Child 0/99999999999999999999/Value~1~00/@value",
  ]) {
    it(`keeps unresolvable server locations visible without false navigation: ${location}`, () => {
      const state = new MetadataState();
      state.observe(good, "draft");
      state.reject(
        { errors: [{ message: "Bad value", location }] },
        "draft",
        nested(1, true, "textfield").template,
      );
      expect(state.quality()!.problems[0]).toMatchObject({
        path: [],
        field: location,
        message: "Bad value",
      });
    });
  }
});

describe("metadata save and recovery matrix", () => {
  const template = {
    "@id": "template",
    "schema:name": "Study",
    ...nested(3, true, "repeated").template,
  };
  let host: MetadataEditor, cee: CedarEmbeddableEditorElement;
  const request = vi.fn(),
    navigate = vi.fn(),
    confirm = vi.fn();
  let route: {
    snapshot: {
      paramMap: ReturnType<typeof convertToParamMap>;
      queryParamMap: ReturnType<typeof convertToParamMap>;
    };
  };
  beforeEach(() => {
    route = {
      snapshot: {
        paramMap: convertToParamMap({ mode: "edit", id: "instance" }),
        queryParamMap: convertToParamMap({}),
      },
    };
    request
      .mockReset()
      .mockImplementation(async (path: string, method = "GET") => ({
        data:
          method !== "GET"
            ? { "@id": "instance" }
            : path === "/templates/template"
              ? template
              : path.endsWith("/report") || path.startsWith("/folders/")
                ? {
                    currentUserPermissions: {
                      capabilities: ["updateResource", "createInFolder"],
                    },
                  }
                : {
                    "@id": "instance",
                    "schema:isBasedOn": "template",
                    "schema:name": "Original",
                  },
        etag: '"one"',
      }));
    navigate.mockReset().mockResolvedValue(true);
    confirm.mockReset().mockResolvedValue(false);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Backend,
          useValue: {
            init: async () => true,
            profile: { homeFolderId: "home" },
            request,
          },
        },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigateByUrl: navigate } },
        { provide: CeeLoader, useValue: { load: async () => {}, mountEditor: () => cee } },
        { provide: Confirmation, useValue: { confirm } },
      ],
    });
    cee = document.createElement(
      "cedar-embeddable-editor",
    ) as CedarEmbeddableEditorElement;
    Object.assign(cee, {
      currentMetadata: { Value: { "@value": "first" } },
      dataQualityReport: structuredClone(good),
      reveal: vi.fn().mockResolvedValue(true),
    });
    host = TestBed.runInInjectionContext(() => new MetadataEditor());
    host.editorHost = new ElementRef(document.createElement("div"));
    host.editor = new ElementRef(cee);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
  });
  afterEach(() => {
    host.ngOnDestroy();
    vi.unstubAllGlobals();
  });

  for (const status of [400, 403, 404, 409, 412, 428, 500])
    for (const transition of ["unchanged", "edited", "destroyed"]) {
      it(`keeps edits and report ownership after ${status}/${transition}`, async () => {
        await host.ngAfterViewInit();
        host.name = "Unsaved";
        host.changed();
        let reject!: (error: unknown) => void;
        request.mockReturnValueOnce(
          new Promise((_resolve, no) => {
            reject = no;
          }),
        );
        const saving = host.save();
        if (transition === "edited") {
          host.name = "Newer edit";
          host.changed();
        }
        if (transition === "destroyed") host.ngOnDestroy();
        reject(
          new HttpError(status, "Server rejected", "invalidData", {
            errors: [
              {
                message: "Nested invalid value",
                location: nested(3, true, "repeated").pointer,
              },
            ],
          }),
        );
        await saving;
        expect(host.dirty()).toBe(true);
        expect(navigate).not.toHaveBeenCalled();
        if (transition === "destroyed") {
          expect(host.error()).toBe("");
          return;
        }
        expect(host.name).toBe(
          transition === "edited" ? "Newer edit" : "Unsaved",
        );
        expect(host.validationErrors).toHaveLength(
          transition === "edited" ? 0 : 1,
        );
        expect(host.state.reloadRequired()).toBe(status !== 400);
        const calls = request.mock.calls.length;
        await host.save();
        if (host.state.reloadRequired() || transition === "unchanged")
          expect(request).toHaveBeenCalledTimes(calls);
        if (host.state.reloadRequired()) {
          await host.reload();
          expect(host.name).toBe(
            transition === "edited" ? "Newer edit" : "Unsaved",
          );
          confirm.mockResolvedValueOnce(true);
          await host.reload();
          expect(host.state.reloadRequired()).toBe(false);
          expect(host.dirty()).toBe(false);
        }
      });
    }
  for (const data of [null, {}, { "@id": "" }, { "@id": 12 }])
    it(`cannot repeat an ambiguously confirmed create: ${JSON.stringify(data)}`, async () => {
      route.snapshot.paramMap = convertToParamMap({
        mode: "create",
        id: "template",
      });
      await host.ngAfterViewInit();
      host.name = "Draft";
      host.changed();
      request.mockResolvedValueOnce({ data, etag: '"two"' });
      await host.save();
      expect(host.state.uncertainCreation()).toBe(true);
      expect(host.dirty()).toBe(true);
      const count = request.mock.calls.length;
      await host.save();
      await host.reload();
      expect(request).toHaveBeenCalledTimes(count);
    });
  for (const failure of ["config", "template", "permission"])
    it(`recovers a failed ${failure} load without a permanent loading status`, async () => {
      if (failure === "config")
        vi.mocked(fetch).mockRejectedValueOnce(new Error("Load failed"));
      else {
        const original = request.getMockImplementation()!;
        let failed = false;
        request.mockImplementation(async (path: string, method = "GET") => {
          if (
            !failed &&
            (failure === "template"
              ? path.startsWith("/templates/")
              : path.endsWith("/report"))
          ) {
            failed = true;
            throw new Error("Load failed");
          }
          return original(path, method);
        });
      }
      await host.ngAfterViewInit();
      expect(host.state.loadFailed()).toBe(true);
      expect(host.saveStatus).toBe("Metadata.LoadFailed");
      await host.reload();
      expect(host.loading()).toBe(false);
      expect(host.state.loadFailed()).toBe(false);
      expect(host.error()).toBe("");
    });
});
