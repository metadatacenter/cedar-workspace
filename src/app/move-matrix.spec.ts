import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "./workspace";
import { ResourceDialog } from "./resource-dialog";
import { ResourceMoves } from "./resource-moves";
import { Backend } from "./backend.service";
import { Config, Resource } from "./resource";

/**
 * Where an item may be moved, asked three ways: dragging it onto a folder, the Move dialog, and the
 * move itself. Dragging judges what the listing shows. A breadcrumb entry carries no capabilities, so
 * dragging onto one is allowed and the move reads the folder's capabilities before writing. The
 * dialog and the move judge the folder as the server reports it.
 */
const config = { openViewBase: "https://openview.example" } as Config;
const caps = (...capabilities: string[]) => ({ currentUserPermissions: { capabilities } });
const folder = (id: string, path: string[], ...capabilities: string[]): Resource => ({
  "@id": id,
  resourceType: "folder",
  "schema:name": id,
  pathInfo: [...path, id].map((p) => ({ "@id": p, resourceType: "folder" as const })),
  ...caps(...capabilities),
});

// The listing being shown is "current", inside "ancestor", inside "home".
const TRAIL = ["home", "ancestor", "current"];
const movable = (r: Resource): Resource => ({ ...r, ...caps("readResource", "moveResource", "deleteResource") });
const template = movable({ "@id": "template", resourceType: "template", "schema:name": "template" });
const moved = movable(folder("moved", TRAIL));
const fixed: Resource = { "@id": "fixed", resourceType: "template", "schema:name": "fixed", ...caps("readResource") };

const SOURCES: Record<string, Resource[]> = {
  "an artifact": [template],
  "a folder": [moved],
  "an artifact and a folder": [template, moved],
  "an item the user may not move": [fixed],
};
// Each target as the server reports it, and whether the drag sees it in the listing or the breadcrumb.
const TARGETS: Record<string, { target: Resource; shown: "row" | "breadcrumb" | "current" | "hidden" }> = {
  "a sibling that accepts moves": { target: folder("sibling", TRAIL, "moveIntoFolder"), shown: "row" },
  "a sibling that refuses moves": { target: folder("refusing", TRAIL), shown: "row" },
  "an ancestor that accepts moves": { target: folder("ancestor", ["home"], "moveIntoFolder"), shown: "breadcrumb" },
  "an ancestor that refuses moves": { target: folder("ancestor", ["home"]), shown: "breadcrumb" },
  "the current folder": { target: folder("current", ["home", "ancestor"], "moveIntoFolder"), shown: "current" },
  "the moved folder itself": { target: { ...folder("moved", TRAIL, "moveIntoFolder") }, shown: "row" },
  "a folder inside the moved folder": { target: folder("inside", [...TRAIL, "moved"], "moveIntoFolder"), shown: "hidden" },
};

const cases: [string, string][] = [];
for (const source of Object.keys(SOURCES)) for (const target of Object.keys(TARGETS)) cases.push([source, target]);

describe("move eligibility across dragging, the Move dialog and the move", () => {
  let api: Record<string, ReturnType<typeof vi.fn> | unknown>;
  beforeEach(() => {
    api = {
      init: vi.fn().mockResolvedValue(true),
      request: vi.fn(),
      report: vi.fn(),
      snapshot: vi.fn(),
      path: vi.fn(),
      profile: { homeFolderId: "home" },
      config,
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Backend, useValue: api }],
    });
  });

  it.each(cases)("%s into %s", async (sourceName, targetName) => {
    const sources = SOURCES[sourceName];
    const { target, shown } = TARGETS[targetName];
    const accepts = !!target.currentUserPermissions?.capabilities?.includes("moveIntoFolder");
    const intoItself = sources.some(
      (s) => s["@id"] === target["@id"] || target.pathInfo!.some((p) => p["@id"] === s["@id"] && p["@id"] !== target["@id"]),
    );
    const sourcesMovable = sources.every((s) => s.currentUserPermissions?.capabilities?.includes("moveResource"));
    const shapeAllowed = accepts && !intoItself;

    // Dragging: only what the listing shows can be a drop target.
    if (shown !== "hidden") {
      const w = TestBed.runInInjectionContext(() => TestBed.createComponent(Workspace).componentInstance);
      w.folder = "current";
      w.rows.set(shown === "row" ? [target, ...sources.filter((s) => s["@id"] !== target["@id"])] : [...sources]);
      w.path.set(TRAIL.map((id) => ({ "@id": id, resourceType: "folder" as const })));
      w.dragging.set(sources);
      const dragAllowed =
        sourcesMovable && shown !== "current" && !intoItself && (shown === "breadcrumb" || accepts);
      expect(w.validDropIds().has(target["@id"]), "drag").toBe(dragAllowed);
    }

    // The Move dialog, for one item and for a group.
    const d = TestBed.runInInjectionContext(() => new ResourceDialog());
    d.action = "move";
    d.resource = sources[0];
    d.resources = sources.length > 1 ? sources : [];
    d.target = target["@id"];
    d.targetResource = target;
    expect(d.destinationAllowed, "dialog").toBe(shapeAllowed);

    // The move reads the destination and every item afresh before writing anything.
    (api.request as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) =>
      path.startsWith("/folders/") ? { data: target } : { data: {} },
    );
    (api.report as ReturnType<typeof vi.fn>).mockImplementation(async (r: Resource) => ({ data: r }));
    (api.snapshot as ReturnType<typeof vi.fn>).mockImplementation(async (r: Resource) => ({ data: r, etag: '"1"' }));
    const moves = TestBed.inject(ResourceMoves);
    const attempt = moves.move(sources, target["@id"]);
    if (!shapeAllowed) await expect(attempt, "move").rejects.toThrow("You cannot use this folder as the destination.");
    else if (!sourcesMovable) await expect(attempt, "move").rejects.toThrow("You no longer have permission to move this item.");
    else expect((await attempt).moved, "move").toEqual(sources.map((s) => s["@id"]));
  });
});
