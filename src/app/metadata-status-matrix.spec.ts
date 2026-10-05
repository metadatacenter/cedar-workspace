import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ElementRef } from "@angular/core";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import type { CedarEmbeddableEditorElement } from "cedar-embeddable-editor";
import { MetadataEditor } from "./metadata-editor";
import { Backend, HttpError } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { Confirmation } from "./confirmation";

/**
 * The metadata editor's toolbar status, Save refusal and leave guard, across creating or editing,
 * whether the user may write, what was edited, and where a save has got to. Each case asserts the
 * status the toolbar shows, whether the form counts as modified, whether Save is refused, and
 * whether leaving needs a confirmation (the user declines it here).
 */
type Mode = "create" | "edit";
type Edit = "none" | "metadata" | "name" | "spaces around the name" | "an exact revert";
type Stage =
  | "loaded"
  | "saving"
  | "saved"
  | "saved, then edited"
  | "refused with 400"
  | "refused with 409"
  | "refused with 412"
  | "created without an identifier"
  | "failed to load";

const good = { isValid: true, requiredFieldValueCount: 0, nonNullRequiredFieldValueCount: 0, problems: [] };
const template = { "@id": "template", "schema:name": "Study", properties: {} };

const cases: [Mode, boolean, Edit, Stage][] = [];
for (const mode of ["create", "edit"] as const)
  for (const writable of [true, false])
    for (const edit of ["none", "metadata", "name", "spaces around the name", "an exact revert"] as const)
      for (const stage of [
        "loaded",
        "saving",
        "saved",
        "saved, then edited",
        "refused with 400",
        "refused with 409",
        "refused with 412",
        "created without an identifier",
        "failed to load",
      ] as const) {
        // A reader cannot save or edit, so only loading means anything for one.
        if (!writable && (edit !== "none" || !["loaded", "failed to load"].includes(stage))) continue;
        if (stage === "created without an identifier" && mode !== "create") continue;
        cases.push([mode, writable, edit, stage]);
      }

describe("metadata editor status matrix", () => {
  let host: MetadataEditor, cee: CedarEmbeddableEditorElement;
  const request = vi.fn(),
    navigate = vi.fn(),
    confirm = vi.fn();
  let mode: Mode, writable: boolean, loadFails: boolean;
  beforeEach(() => {
    request.mockReset().mockImplementation(async (path: string, method = "GET") => {
      if (loadFails && path.startsWith("/templates/")) throw new HttpError(500, "Unavailable");
      return {
        data:
          method !== "GET"
            ? { "@id": "instance" }
            : path.startsWith("/templates/")
              ? template
              : path.endsWith("/report") || path.startsWith("/folders/")
                ? { currentUserPermissions: { capabilities: writable ? ["updateResource", "createInFolder"] : [] } }
                : { "@id": "instance", "schema:isBasedOn": "template", "schema:name": "Original" },
        etag: '"one"',
      };
    });
    navigate.mockReset().mockResolvedValue(true);
    confirm.mockReset().mockResolvedValue(false);
  });
  afterEach(() => {
    host?.ngOnDestroy();
    vi.unstubAllGlobals();
  });
  function start() {
    TestBed.configureTestingModule({
      providers: [
        { provide: Backend, useValue: { init: async () => true, profile: { homeFolderId: "home" }, request } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(mode === "edit" ? { mode, id: "instance" } : { mode, id: "template" }),
              queryParamMap: convertToParamMap({}),
            },
          },
        },
        { provide: Router, useValue: { navigateByUrl: navigate } },
        { provide: CeeLoader, useValue: { load: async () => {} } },
        { provide: Confirmation, useValue: { confirm } },
      ],
    });
    cee = document.createElement("cedar-embeddable-editor") as CedarEmbeddableEditorElement;
    Object.assign(cee, { currentMetadata: { Value: { "@value": "first" } }, dataQualityReport: structuredClone(good) });
    host = TestBed.runInInjectionContext(() => new MetadataEditor());
    host.editor = new ElementRef(cee);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  }
  function apply(edit: Edit) {
    const original = host.name;
    if (edit === "metadata") Object.assign(cee, { currentMetadata: { Value: { "@value": "second" } } });
    if (edit === "name") host.name = "Renamed";
    if (edit === "spaces around the name") host.name = `  ${original}  `;
    if (edit === "an exact revert") {
      Object.assign(cee, { currentMetadata: { Value: { "@value": "second" } } });
      host.name = "Renamed";
      host.changed();
      Object.assign(cee, { currentMetadata: { Value: { "@value": "first" } } });
      host.name = original;
    }
    host.changed();
  }

  it.each(cases)("%s, writable %s, %s, %s", async (m, w, edit, stage) => {
    mode = m;
    writable = w;
    loadFails = stage === "failed to load";
    start();
    await host.ngAfterViewInit();
    apply(edit);
    // Spaces around the name count as a change: the field holds what was typed, though Save trims it.
    const edited = edit !== "none" && edit !== "an exact revert";
    let pending: Promise<void> | undefined;
    let release: (() => void) | undefined;
    if (stage === "saving") {
      request.mockReturnValueOnce(new Promise((resolve) => (release = () => resolve({ data: { "@id": "instance" }, etag: '"two"' }))));
      pending = host.save();
    }
    if (stage === "saved" || stage === "saved, then edited") {
      await host.save();
      if (stage === "saved, then edited") {
        Object.assign(cee, { currentMetadata: { Value: { "@value": "after the save" } } });
        host.changed();
      }
    }
    const refusal = /refused with (\d+)/.exec(stage);
    if (refusal) {
      request.mockRejectedValueOnce(new HttpError(Number(refusal[1]), "Refused"));
      await host.save();
    }
    if (stage === "created without an identifier") {
      request.mockResolvedValueOnce({ data: {}, etag: null });
      await host.save();
    }

    const reloadRequired = ["refused with 409", "refused with 412", "created without an identifier"].includes(stage);
    const dirty = stage === "saved" ? false : stage === "saved, then edited" ? true : edited;
    const status =
      stage === "failed to load"
        ? "Metadata.LoadFailed"
        : stage === "saving"
          ? "Common.Saving"
          : reloadRequired
            ? "Metadata.ReloadRequired"
            : !writable
              ? "Metadata.ReadOnly"
              : dirty
                ? "Metadata.ModifiedStatus"
                : stage === "saved"
                  ? "Metadata.SavedStatus"
                  : "Metadata.UnmodifiedStatus";
    expect({
      status: host.saveStatus,
      dirty: host.dirty(),
      refused: host.saveRefused,
      mayLeave: await host.mayLeave(),
    }).toEqual({
      status,
      dirty: stage === "failed to load" ? false : dirty,
      refused: reloadRequired,
      mayLeave: stage !== "saving" && (stage === "failed to load" || !dirty),
    });
    release?.();
    await pending;
  });
});
