import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { FolderDeletionDialog, DeletionPlan } from "./folder-deletion-dialog";
import { provideWorkspaceTranslations, translations } from "./i18n";

const plan = {
  token: "a".repeat(64),
  allowed: true,
  items: [],
} as unknown as DeletionPlan;
const counts = { folder: 0, template: 0, element: 0, field: 0, instance: 0 };
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
for (const language of ["en", "hu"] as const) {
  describe(`Folder deletion messages in ${language}`, () => {
    it("localises owner refusal and leaves deletion disabled", async () => {
      const { host, request } = setup(language);
      request.mockRejectedValue(
        new HttpError(
          403,
          "Untranslated server text",
          "FOLDER_DELETE_NOT_OWNER",
        ),
      );
      await host.load();
      expect(host.error()).toBe(translations[language].FolderDeletion.NotOwner);
      expect(host.plan()).toBeNull();
      await host.confirm();
      expect(request).toHaveBeenCalledTimes(1);
    });
    it("revokes a loaded confirmation when ownership has changed", async () => {
      const { host, request } = setup(language);
      host.plan.set(plan);
      request.mockRejectedValue(
        new HttpError(
          403,
          "Untranslated server text",
          "FOLDER_DELETE_NOT_OWNER",
        ),
      );
      await host.confirm();
      expect(host.error()).toBe(translations[language].FolderDeletion.NotOwner);
      expect(host.plan()).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
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
