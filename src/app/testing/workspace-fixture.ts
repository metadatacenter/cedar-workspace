import type {} from "../settings";
import { expect, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { Backend } from "../backend.service";
import { Workspace } from "../workspace";
import { ResourceMoves } from "../resource-moves";
import type { Resource } from "../resource";
export const resource = (
  id: string,
  resourceType: Resource["resourceType"] = "element",
): Resource => ({
  "@id": id,
  resourceType,
  "schema:name": id,
  "schema:description": "original",
  currentUserPermissions: {
    capabilities: [
      "readResource",
      "updateResource",
      "moveResource",
      "moveIntoFolder",
    ],
  },
});
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function workspaceRig(
  report = vi.fn().mockResolvedValue({ data: resource("item", "template") }),
) {
  const api = {
    init: vi.fn().mockResolvedValue(true),
    profile: { homeFolderId: "home" },
    config: {
      templateDesignerFrontend: "https://designer.example",
      workspaceFrontend: "https://workspace.example",
      openViewBase: "https://openview.example",
    },
    report,
    request: vi.fn(async (path: string) => ({
      data:
        path.includes("/contents") || path.startsWith("/search")
          ? {
              resources: path.includes("/contents")
                ? [resource("item", "template")]
                : [],
              totalCount: path.includes("/contents") ? 1 : 0,
              pathInfo: [],
            }
          : resource("home", "folder"),
    })),
  };
  const move = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Backend, useValue: api },
      { provide: ResourceMoves, useValue: { move } },
    ],
  });
  const fixture = TestBed.createComponent(Workspace);
  fixture.detectChanges();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.currentFolder()).toBeDefined(),
  );
  return { fixture, host: fixture.componentInstance, api, move };
}
