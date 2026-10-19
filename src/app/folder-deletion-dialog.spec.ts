import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { FolderDeletionDialog, DeletionPlan } from "./folder-deletion-dialog";
import { provideWorkspaceTranslations, translations } from "./i18n";
import { Config } from "./resource";

const counts = { folder: 0, template: 0, element: 0, field: 0, instance: 0 };
const plan: DeletionPlan = {
  token: "a".repeat(64),
  allowed: true,
  counts: { ...counts, folder: 1, instance: 4 },
  items: Array.from({ length: 5 }, (_, i) => ({
    id: i ? `instance-${i}` : "folder",
    name: "Item",
    type: i ? ("instance" as const) : ("folder" as const),
    parentId: i ? "folder" : null,
    depth: i ? 1 : 0,
    deletable: true,
    protectedFolder: false,
    instancesInside: 0,
    instancesOutside: 0,
  })),
  restrictedItems: 0,
  protectedFolders: 0,
  templatesWithInstances: 0,
  templatesWithOutsideInstances: 0,
  instancesOutside: 0,
};
function setup(language: "en" | "hu") {
  const request = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      ...provideWorkspaceTranslations(language),
      {
        provide: Backend,
        useValue: { request, path: () => "/folders/folder" },
      },
    ],
  });
  const host = TestBed.runInInjectionContext(() => new FolderDeletionDialog());
  host.resource = { "@id": "folder", resourceType: "folder" };
  return { host, request };
}
/** The shared error body the resource server answers a refusal with. */
const cedarError = (
  statusCode: number,
  status: string,
  fields: Record<string, unknown> = {},
) => ({
  status,
  statusCode,
  errorKey: null,
  errorReasonKey: null,
  errorType: null,
  message: null,
  parameters: {},
  objects: {},
  entities: {},
  suggestedAction: "none",
  operation: null,
  errorId: null,
  ...fields,
});
const notOwner = cedarError(403, "FORBIDDEN", {
  errorKey: "folderCanNotBeDeleted",
  message: "Only the owner of this folder can delete it and its contents.",
});
const protectedFolder = (reason: string) =>
  cedarError(400, "BAD_REQUEST", {
    errorKey: "folderCanNotBeDeleted",
    errorReasonKey: reason,
    message: "Home and system folders cannot be deleted.",
  });
const refusedOutcome = (status: "changed" | "blocked") => {
  const outcome = {
    status,
    deleted: { ...counts },
    remaining: 5,
    message:
      status === "changed"
        ? "The folder changed. Review a new inventory before deleting."
        : "The folder cannot be deleted. Review the blockers.",
    code:
      status === "changed" ? "FOLDER_DELETE_CHANGED" : "FOLDER_DELETE_BLOCKED",
  };
  return cedarError(409, "CONFLICT", {
    errorKey: status === "blocked" ? "folderCanNotBeDeleted" : null,
    message: outcome.message,
    objects: { outcome },
  });
};
/** The error a real Backend raises for an answer, so each case reads the body the server sends. */
async function answer(status: number, body: unknown): Promise<HttpError> {
  const api = TestBed.runInInjectionContext(() => new Backend());
  api.config = {
    resourceRestAPI: "https://resource.example",
    userRestAPI: "https://user.example",
    groupRestAPI: "https://group.example",
  } as Config;
  Object.assign(api, {
    auth: {
      refreshToken: (_seconds: number, ok: () => void) => ok(),
      getToken: () => "test-token",
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
  const error = await api.request("/folders/folder/deletion").then(
    () => undefined,
    (e: unknown) => e,
  );
  vi.unstubAllGlobals();
  if (!(error instanceof HttpError))
    throw new Error(`${status} was not refused`);
  return error;
}
type Message = keyof (typeof translations)["en"]["FolderDeletion"];
/** Every answer an inventory can be refused with, and what the dialog says to it. */
const inventoryRefusals: [string, number, unknown, Message][] = [
  ["a home folder", 400, protectedFolder("userHomeFolder"), "ProtectedRoot"],
  ["a system folder", 400, protectedFolder("systemFolder"), "ProtectedRoot"],
  ["a caller who is not the owner", 403, notOwner, "NotOwner"],
  [
    "a caller who cannot read the folder",
    403,
    cedarError(403, "FORBIDDEN", { errorKey: "noReadAccessToFolder" }),
    "AccessDenied",
  ],
  [
    "a caller without the folder deletion permission",
    403,
    cedarError(403, "FORBIDDEN", { errorKey: "permissionNotOwned" }),
    "AccessDenied",
  ],
  ["an ended session", 401, cedarError(401, "UNAUTHORIZED"), "SessionExpired"],
  [
    "a folder that does not exist",
    404,
    cedarError(404, "NOT_FOUND", { errorKey: "folderNotFound" }),
    "Missing",
  ],
  [
    "an unacceptable response type",
    406,
    cedarError(406, "NOT_ACCEPTABLE"),
    "InventoryUnavailable",
  ],
  [
    "a folder that could not be fully checked",
    409,
    cedarError(409, "CONFLICT", {
      message:
        "The complete inventory could not be checked. Refresh and try again.",
    }),
    "InventoryUnavailable",
  ],
  [
    "a request rate over the limit",
    429,
    cedarError(429, "TOO_MANY_REQUESTS", { errorKey: "rateLimitExceeded" }),
    "InventoryUnavailable",
  ],
  [
    "an internal error",
    500,
    cedarError(500, "INTERNAL_SERVER_ERROR"),
    "InventoryUnavailable",
  ],
  [
    "an unavailable artifact server",
    503,
    cedarError(503, "SERVICE_UNAVAILABLE"),
    "InventoryUnavailable",
  ],
];
/** Every answer a confirmation can be refused with, and what the dialog says to it. */
const confirmationRefusals: [string, number, unknown, Message][] = [
  [
    "a token in no inventory's form",
    400,
    cedarError(400, "BAD_REQUEST", {
      errorKey: "invalidInput",
      message: "A current deletion inventory token is required.",
    }),
    "Changed",
  ],
  [
    "a body that holds more than a token",
    400,
    cedarError(400, "BAD_REQUEST", { errorKey: "malformedJsonRequestBody" }),
    "Changed",
  ],
  ["a home folder", 400, protectedFolder("userHomeFolder"), "ProtectedRoot"],
  ["a caller who is not the owner", 403, notOwner, "NotOwner"],
  [
    "a caller who cannot read the folder",
    403,
    cedarError(403, "FORBIDDEN", { errorKey: "noReadAccessToFolder" }),
    "AccessDenied",
  ],
  ["an ended session", 401, cedarError(401, "UNAUTHORIZED"), "SessionExpired"],
  [
    "a folder that no longer exists",
    404,
    cedarError(404, "NOT_FOUND", { errorKey: "folderNotFound" }),
    "Missing",
  ],
  [
    "an unacceptable response type",
    406,
    cedarError(406, "NOT_ACCEPTABLE"),
    "Uncertain",
  ],
  ["a folder that changed", 409, refusedOutcome("changed"), "Changed"],
  ["a blocked folder", 409, refusedOutcome("blocked"), "Refused"],
  [
    "an outcome whose code is unknown",
    409,
    cedarError(409, "CONFLICT", {
      objects: {
        outcome: {
          status: "changed",
          deleted: { ...counts },
          remaining: 5,
          code: "FOLDER_DELETE_FUTURE",
        },
      },
    }),
    "Changed",
  ],
  [
    "an inventory that could not be repeated in full",
    409,
    cedarError(409, "CONFLICT", {
      message:
        "The complete inventory could not be checked. Refresh and try again.",
    }),
    "InventoryUnavailable",
  ],
  [
    "a body that is not JSON",
    415,
    cedarError(415, "UNSUPPORTED_MEDIA_TYPE"),
    "Uncertain",
  ],
  [
    "a request rate over the limit",
    429,
    cedarError(429, "TOO_MANY_REQUESTS", { errorKey: "rateLimitExceeded" }),
    "Uncertain",
  ],
  [
    "an internal error",
    500,
    cedarError(500, "INTERNAL_SERVER_ERROR"),
    "Uncertain",
  ],
  [
    "an unavailable artifact server",
    503,
    cedarError(503, "SERVICE_UNAVAILABLE"),
    "Uncertain",
  ],
];
for (const language of ["en", "hu"] as const) {
  describe(`Folder deletion messages in ${language}`, () => {
    for (const [refusal, status, body, message] of inventoryRefusals)
      it(`says what refused the inventory of ${refusal} (${status})`, async () => {
        const { host, request } = setup(language);
        request.mockRejectedValue(await answer(status, body));
        await host.load();
        expect(host.error()).toBe(
          translations[language].FolderDeletion[message],
        );
        expect(host.plan()).toBeNull();
        expect(host.busy()).toBe(false);
        await host.confirm();
        expect(request).toHaveBeenCalledTimes(1);
      });
    for (const [refusal, status, body, message] of confirmationRefusals)
      it(`says what refused the confirmation of ${refusal} (${status})`, async () => {
        const { host, request } = setup(language);
        const changed = vi.fn();
        host.changed.subscribe(changed);
        host.plan.set(plan);
        request.mockRejectedValue(await answer(status, body));
        await host.confirm();
        expect(host.error()).toBe(
          translations[language].FolderDeletion[message],
        );
        expect(host.plan()).toBeNull();
        expect(host.outcome()).toBeNull();
        expect(host.deleting()).toBe(false);
        expect(changed).toHaveBeenCalledOnce();
        await host.confirm();
        expect(request).toHaveBeenCalledTimes(1);
      });
    it("names the folder whose inventory a selection could not obtain", async () => {
      const { host, request } = setup(language);
      host.resources = [
        { "@id": "folder", resourceType: "folder", "schema:name": "Projects" },
      ];
      request.mockRejectedValue(await answer(403, notOwner));
      await host.load();
      expect(host.error()).toBe(
        "Projects: " + translations[language].FolderDeletion.NotOwner,
      );
      expect(host.plan()).toBeNull();
    });
    it("uses localised fallbacks for unknown and network errors", async () => {
      const { host, request } = setup(language);
      request.mockRejectedValue(new Error("Failed to fetch"));
      await host.load();
      expect(host.error()).toBe(
        translations[language].FolderDeletion.InventoryUnavailable,
      );
      host.plan.set(plan);
      request.mockRejectedValue(
        new HttpError(500, "Private diagnostic", "FUTURE_CODE"),
      );
      await host.confirm();
      expect(host.error()).toBe(
        translations[language].FolderDeletion.Uncertain,
      );
    });
    it("localises partial completion while preserving confirmed counts", async () => {
      const { host, request } = setup(language);
      host.plan.set(plan);
      request.mockResolvedValue({
        data: {
          status: "stopped",
          deleted: { ...counts, instance: 2 },
          remaining: 3,
          code: "FOLDER_DELETE_CLEANUP_PENDING",
          message: "Untranslated server text",
        },
      });
      await host.confirm();
      expect(host.outcome()!.deleted.instance).toBe(2);
      expect(host.outcomeMessage(host.outcome()!)).toBe(
        translations[language].FolderDeletion.CleanupPending,
      );
      expect(
        host.outcomeMessage({ ...host.outcome()!, code: "constructor" }),
      ).toBe(translations[language].FolderDeletion.Stopped);
    });
  });
}

it("closes a completed deletion without rendering a stopped outcome", async () => {
  const { host, request } = setup("en");
  const close = vi.fn();
  host.dialog = { nativeElement: { close } } as unknown as typeof host.dialog;
  host.plan.set(plan);
  request.mockResolvedValue({
    data: { status: "completed", deleted: plan.counts, remaining: 0 },
  });
  const saved = vi.fn(() => {
    expect(close).toHaveBeenCalledOnce();
    expect(host.outcome()).toBeNull();
    expect(host.plan()).toBe(plan);
  });
  host.saved.subscribe(saved);
  await host.confirm();
  expect(saved).toHaveBeenCalledOnce();
});
