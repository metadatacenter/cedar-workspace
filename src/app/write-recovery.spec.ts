import { afterEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { HttpError } from "./backend.service";
import { RevisionCoordinator } from "./revision-coordinator";
import { useDeploymentDomain } from "./resource-address";
import { metadataCreateRig, metadataRig } from "./testing/metadata-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const status of [
  0, 200, 201, 400, 401, 403, 404, 408, 409, 412, 422, 428, 429, 500, 503,
]) {
  const recovery = ![400, 422, 429].includes(status);
  const uncertain = [0, 200, 201, 408, 500, 503].includes(status);
  // A create refused because its identity is taken may be an earlier attempt that committed.
  const uncertainCreate = uncertain || [412, 428].includes(status);
  it(`revision recovery after HTTP ${status} requires a successful read`, () => {
    const state = new RevisionCoordinator();
    state.write()!.fail(new HttpError(status, "Write failed"));
    expect(state.reloadRequired()).toBe(recovery);
    if (recovery) {
      expect(state.write()).toBeNull();
      state.read()!.fail(new Error("Read failed"));
      expect(state.write()).toBeNull();
      state.read()!.finish();
      expect(state.write()).not.toBeNull();
    }
    state.dispose();
  });
  for (const mode of ["create", "edit"]) {
    it(`${mode} does not repeat an uncertain mutation after HTTP ${status}`, async () => {
      const m = await metadataRig(mode);
      try {
        m.edit();
        m.request.mockRejectedValueOnce(new HttpError(status, "Write failed"));
        await m.host.save();
        expect(m.host.state.reloadRequired()).toBe(recovery);
        expect(m.host.state.uncertainCreation()).toBe(
          mode === "create" && uncertainCreate,
        );
        expect(m.host.dirty()).toBe(true);
        const calls = m.request.mock.calls.length;
        if (recovery) {
          await m.host.save();
          expect(m.request).toHaveBeenCalledTimes(calls);
          await m.host.reload();
          if (mode === "create" && uncertainCreate) {
            expect(m.request).toHaveBeenCalledTimes(calls);
            expect(m.host.state.reloadRequired()).toBe(true);
          } else expect(m.host.state.reloadRequired()).toBe(false);
        }
      } finally {
        m.host.ngOnDestroy();
      }
    });
  }
}

describe("a metadata create under a minted identity", () => {
  afterEach(() => sessionStorage.clear());

  it("offers no outcome check on a fresh create page or after a definitive refusal", async () => {
    const m = await metadataCreateRig();
    try {
      expect(m.host.canCheckSave()).toBe(false);
      expect(m.host.canSignInAgain).toBe(false);
      m.edit();
      m.world.lost = false;
      m.request.mockRejectedValueOnce(new HttpError(400, "Invalid"));
      await m.host.save();
      expect(m.host.state.uncertainCreation()).toBe(false);
      expect(m.host.canCheckSave()).toBe(false);
      await m.host.save();
      // The refused attempt created nothing, and the next one still uses its identity.
      expect(m.identities().size).toBe(1);
      expect(m.host.canCheckSave()).toBe(false);
      expect(m.host.error()).toBe("");
      expect(m.host.notice()).toBe("Saved.");
    } finally {
      m.host.ngOnDestroy();
    }
  });

  // No identity can be minted until Workspace knows the deployment's base, so the server mints one
  // as before, and an unknown outcome keeps today's guard with nothing to look up.
  it("lets the server mint the identity while the deployment's base is unknown", async () => {
    const m = await metadataCreateRig();
    try {
      useDeploymentDomain(null);
      m.edit();
      m.request.mockClear();
      m.request.mockRejectedValueOnce(new HttpError(0, "No reply"));
      await m.host.save();
      const [path, method, body, etag] = m.request.mock.lastCall!;
      expect([path, method, etag]).toEqual([
        "/template-instances?folder_id=home",
        "POST",
        null,
      ]);
      expect(body).not.toHaveProperty("@id");
      expect(m.host.state.uncertainCreation()).toBe(true);
      expect(m.host.state.reloadRequired()).toBe(true);
      expect(m.host.canCheckSave()).toBe(false);
      expect(m.host.canSignInAgain).toBe(false);
      expect(m.host.error()).toBe(
        "We could not confirm whether your changes were saved. Your changes remain in the editor. Check Workspace before saving again.",
      );
      const calls = m.request.mock.calls.length;
      await m.host.save();
      await m.host.checkSaveStatus();
      expect(m.request).toHaveBeenCalledTimes(calls);
    } finally {
      m.host.ngOnDestroy();
    }
  });

  for (const later of [false, true])
    it(`adopts a create that committed, ${later ? "keeping later edits as unsaved" : "matching the submission"}`, async () => {
      const m = await metadataCreateRig();
      try {
        m.edit();
        await m.host.save();
        expect(m.host.state.uncertainCreation()).toBe(true);
        expect(m.host.canCheckSave()).toBe(true);
        expect(m.host.canSignInAgain).toBe(false);
        expect(m.host.error()).toContain("Use Check save status");
        // Save and Reload stay refused while the outcome is unknown.
        const calls = m.request.mock.calls.length;
        await m.host.save();
        await m.host.reload();
        expect(m.request).toHaveBeenCalledTimes(calls);
        if (later) {
          m.host.name = "Later";
          m.host.changed();
        }
        await m.host.checkSaveStatus();
        const id = [...m.identities()][0];
        expect(m.host.state.uncertainCreation()).toBe(false);
        expect(m.host.state.reloadRequired()).toBe(false);
        expect(m.host.canCheckSave()).toBe(false);
        expect(m.host.name).toBe(later ? "Later" : "Unsaved");
        expect(m.host.dirty()).toBe(later);
        expect(m.host.notice()).toBe(
          later
            ? "Saved. You have further unsaved changes."
            : "The stored version matches your submitted changes. Your current edits have been kept.",
        );
        expect(
          vi.mocked(TestBed.inject(Router).navigateByUrl).mock.lastCall?.[0],
        ).toMatch(new RegExp(`^/instances/edit/${id.split("/").at(-1)}\\?`));
        // Save is now an update of the adopted instance, never another create.
        await m.host.save();
        expect(m.creates()).toHaveLength(1);
        expect(m.request.mock.lastCall?.slice(0, 2)).toEqual([
          "/template-instances/" + id.split("/").at(-1),
          "PUT",
        ]);
        expect(m.request.mock.lastCall?.[3]).toBe('"1"');
      } finally {
        m.host.ngOnDestroy();
      }
    });

  it("re-enables Save with the same identity when nothing was created", async () => {
    const m = await metadataCreateRig();
    try {
      m.edit();
      m.world.commit = false;
      await m.host.save();
      await m.host.checkSaveStatus();
      expect(m.host.state.uncertainCreation()).toBe(false);
      expect(m.host.state.reloadRequired()).toBe(false);
      expect(m.host.canCheckSave()).toBe(false);
      expect(m.host.error()).toBe(
        "The record was not created. Your edits remain in the editor. Save to create it.",
      );
      expect(m.host.name).toBe("Unsaved");
      m.world.commit = true;
      m.world.lost = false;
      await m.host.save();
      expect(m.creates()).toHaveLength(2);
      expect(m.identities().size).toBe(1);
      expect(m.host.notice()).toBe("Saved.");
    } finally {
      m.host.ngOnDestroy();
    }
  });

  for (const status of [412, 428])
    it(`treats an occupied identity (${status}) as unknown, then adopts what the earlier attempt created`, async () => {
      const m = await metadataCreateRig();
      try {
        m.edit();
        m.world.commit = false;
        await m.host.save();
        await m.host.checkSaveStatus();
        // The first attempt commits after the check found nothing.
        const first = m.creates()[0][2] as Record<string, unknown>;
        m.world.stored = structuredClone(first);
        m.world.refuse = status;
        m.host.name = "Newer";
        m.host.changed();
        await m.host.save();
        expect(m.host.state.uncertainCreation()).toBe(true);
        expect(m.host.state.reloadRequired()).toBe(true);
        expect(m.host.canCheckSave()).toBe(true);
        expect(m.host.error()).toContain("Use Check save status");
        await m.host.checkSaveStatus();
        expect(m.identities().size).toBe(1);
        expect(m.host.state.uncertainCreation()).toBe(false);
        expect(m.host.name).toBe("Newer");
        // The stored instance holds the earlier values, so the newer name is an unsaved change.
        expect(m.host.dirty()).toBe(true);
        expect(m.host.canCheckSave()).toBe(false);
      } finally {
        m.host.ngOnDestroy();
      }
    });

  for (const status of [401, 403, 503])
    it(`keeps Save blocked when the check is refused or unavailable (${status})`, async () => {
      const m = await metadataCreateRig();
      try {
        m.edit();
        await m.host.save();
        m.world.lookup = status;
        await m.host.checkSaveStatus();
        expect(m.host.state.uncertainCreation()).toBe(true);
        expect(m.host.state.reloadRequired()).toBe(true);
        expect(m.host.canCheckSave()).toBe(true);
        expect(m.host.error()).toBe(
          "Save status could not be checked. Your edits have been kept. Check your connection and access, then try again.",
        );
        // Only a refusal of the session offers Sign in again.
        expect(m.host.canSignInAgain).toBe(status === 401);
        const calls = m.creates().length;
        await m.host.save();
        expect(m.creates()).toHaveLength(calls);
        if (status === 401) {
          m.host.signInAgain();
          expect(m.signIn).toHaveBeenCalledOnce();
        }
        // The check can be repeated, and settles once the identity can be read.
        m.world.lookup = null;
        await m.host.checkSaveStatus();
        expect(m.host.state.uncertainCreation()).toBe(false);
        expect(m.host.canSignInAgain).toBe(false);
        expect(m.identities().size).toBe(1);
      } finally {
        m.host.ngOnDestroy();
      }
    });

  it("leaves an instance of another template unresolved", async () => {
    const m = await metadataCreateRig();
    try {
      m.edit();
      await m.host.save();
      m.world.stored = {
        ...m.world.stored,
        "schema:isBasedOn": "another-template",
      };
      await m.host.checkSaveStatus();
      expect(m.host.state.uncertainCreation()).toBe(true);
      expect(m.host.canCheckSave()).toBe(true);
      expect(m.host.error()).toBe(
        "The stored version could not be reconciled with your save. Your edits have been kept; saving remains blocked.",
      );
    } finally {
      m.host.ngOnDestroy();
    }
  });
});
