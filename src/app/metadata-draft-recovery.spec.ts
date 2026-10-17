import { TestBed } from "@angular/core/testing";
import { Backend } from "./backend.service";
import { afterEach, expect, it, vi } from "vitest";
import { metadataCreateRig, metadataRig } from "./testing/metadata-fixture";
import { Router } from "@angular/router";
import { HttpError } from "./backend.service";
import {
  metadataDraftScope,
  readMetadataDraft,
  MetadataDraftStore,
} from "./metadata-draft";

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("offers the draft after recreation and restores it only on explicit request", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  const next = await m.recreate();
  expect(next.name).toBe("Original");
  expect(next.recoveryDraft()?.name).toBe("Unsaved");
  await next.save();
  expect(
    m.request.mock.calls.every((call) => !call[1] || call[1] === "GET"),
  ).toBe(true);
  await next.restoreRecovery();
  expect(next.name).toBe("Unsaved");
  expect(next.dirty()).toBe(true);
  expect(next.state.reloadRequired()).toBe(false);
  await next.save();
  expect(m.request.mock.calls.find((call) => call[1] === "PUT")?.[3]).toBe(
    '"revision"',
  );
  next.ngOnDestroy();
});

for (const change of ["revision", "permission"] as const)
  it(`retains restored input and blocks a write after a ${change} change`, async () => {
    const m = await metadataRig("edit", true);
    m.edit();
    if (change === "revision") m.revision('"newer"');
    else m.access(false);
    const next = await m.recreate();
    await next.restoreRecovery();
    expect(next.name).toBe("Unsaved");
    m.request.mockClear();
    await next.save();
    expect(m.request).not.toHaveBeenCalled();
    next.ngOnDestroy();
  });

for (const status of [0, 401, 403, 503])
  it(`retains update outcome evidence through reload after ${status}`, async () => {
    const m = await metadataRig("edit", true);
    m.edit();
    const server = m.request.getMockImplementation()!;
    m.request.mockImplementation(async (...args) => {
      if (args[1] === "PUT") throw new HttpError(status, "refused");
      return server(...args);
    });
    await m.host.save();
    const next = await m.recreate();
    await next.restoreRecovery();
    expect(next.name).toBe("Unsaved");
    expect(next.state.reloadRequired()).toBe(true);
    expect(
      status === 401 || status === 403
        ? next.canRecheckAccess()
        : next.canCheckSave(),
    ).toBe(true);
    await next.checkSaveStatus();
    expect(next.state.reloadRequired()).toBe(false);
    expect(next.name).toBe("Unsaved");
    next.ngOnDestroy();
  });

it("journals a create before dispatch and blocks duplicate creation after reload", async () => {
  const m = await metadataRig("create", true);
  m.edit();
  const server = m.request.getMockImplementation()!;
  let resolve!: (value: { data: Record<string, string>; etag: string }) => void;
  m.request.mockImplementation((...args) =>
    args[1] === "PUT"
      ? new Promise((done) => {
          resolve = done;
        })
      : server(...args),
  );
  const save = m.host.save();
  m.host.changed();
  m.host.beforeUnload({
    preventDefault() {},
    returnValue: "",
  } as unknown as BeforeUnloadEvent);
  const next = await m.recreate();
  expect(next.recoveryDraft()?.uncertainCreation).toBe(true);
  // The journal written before dispatch already names the identity the create was sent under, so
  // the restored page can look that identity up.
  const sent = m.request.mock.calls.find((call) => call[1] === "PUT")!;
  const id = (sent[2] as { "@id": string })["@id"];
  expect(id).toMatch(
    /^https:\/\/repo\.example\/template-instances\/[0-9a-f-]{36}$/,
  );
  expect(next.recoveryDraft()?.creation?.id).toBe(id);
  await next.restoreRecovery();
  expect(next.canCheckSave()).toBe(true);
  await next.save();
  expect(next.name).toBe("Unsaved");
  expect(next.state.uncertainCreation()).toBe(true);
  expect(
    m.request.mock.calls.filter((call) => call[1] === "PUT"),
  ).toHaveLength(1);
  expect(next.recoveryDraft()).toBeNull();
  resolve({ data: { "@id": "created" }, etag: '"new"' });
  await save;
  next.ngOnDestroy();
});

it("does not discard the journal for an uncertain creation", async () => {
  const m = await metadataRig("create", true);
  m.edit();
  m.request.mockRejectedValueOnce(new HttpError(503, "unavailable"));
  await m.host.save();
  const next = await m.recreate();
  const draft = next.recoveryDraft();
  expect(draft?.uncertainCreation).toBe(true);
  await next.discardRecovery();
  expect(next.recoveryDraft()).toBe(draft);
  expect(m.confirm).not.toHaveBeenCalled();
  next.ngOnDestroy();
});

it("scopes recovery data by deployment, account, destination and artifact", async () => {
  const m = await metadataRig("create", true);
  m.edit();
  const scope = metadataDraftScope(
    "https://resource.example",
    "owner",
    "create",
    "template",
    "home",
  );
  const value = new MetadataDraftStore(scope, sessionStorage).read()!;
  expect(value.name).toBe("Unsaved");
  for (const other of [
    metadataDraftScope(
      "https://other.example",
      "owner",
      "create",
      "template",
      "home",
    ),
    metadataDraftScope(
      "https://resource.example",
      "someone-else",
      "create",
      "template",
      "home",
    ),
    metadataDraftScope(
      "https://resource.example",
      "owner",
      "create",
      "template",
      "elsewhere",
    ),
    metadataDraftScope(
      "https://resource.example",
      "owner",
      "edit",
      "instance",
      "home",
    ),
  ]) {
    expect(new MetadataDraftStore(other, sessionStorage).read()).toBeNull();
    expect(() => readMetadataDraft(JSON.stringify(value), other)).toThrow();
  }
  m.host.ngOnDestroy();
});

it("reports failed storage without discarding live input", async () => {
  const m = await metadataRig("edit", true);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  m.edit();
  expect(m.host.draftStorageError()).toBe(true);
  expect(m.host.name).toBe("Unsaved");
  m.host.ngOnDestroy();
});

it("restoration failure retains both current input and the offered recovery copy", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  const next = await m.recreate();
  const draft = next.recoveryDraft()!;
  (draft.draft as unknown as { drafts: unknown }).drafts = null;
  const editor = next.editor.nativeElement;
  await next.restoreRecovery();
  expect(next.editor.nativeElement).toBe(editor);
  expect(editor.parentElement).toBe(next.editorHost.nativeElement);
  expect(next.name).toBe("Original");
  expect(next.recoveryDraft()).toBe(draft);
  next.ngOnDestroy();
});

it("can recheck a restored draft after permission is granted again", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  m.access(false);
  const next = await m.recreate();
  await next.restoreRecovery();
  expect(next.canRecheckAccess()).toBe(true);
  expect(next.editor.nativeElement.config.readOnlyMode).toBe(true);
  m.access(true);
  await next.checkSaveStatus();
  expect(next.state.reloadRequired()).toBe(false);
  expect(next.editor.nativeElement.config.readOnlyMode).toBe(false);
  expect(next.name).toBe("Unsaved");
  next.ngOnDestroy();
});

it("retains work before sign-in and refuses the redirect when browser storage fails", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  m.host.signInAgain();
  expect(m.signIn).toHaveBeenCalledOnce();
  const scope = metadataDraftScope(
    "https://resource.example",
    "owner",
    "edit",
    "instance",
    "home",
  );
  expect(new MetadataDraftStore(scope, sessionStorage).read()?.name).toBe(
    "Unsaved",
  );
  m.signIn.mockClear();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Full");
  });
  m.host.signInAgain();
  expect(m.signIn).not.toHaveBeenCalled();
  expect(m.host.draftStorageError()).toBe(true);
  expect(m.host.name).toBe("Unsaved");
  m.host.ngOnDestroy();
});

it("rejects recovery evidence that names another artifact inside the correct scope", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  const scope = metadataDraftScope(
    "https://resource.example",
    "owner",
    "edit",
    "instance",
    "home",
  );
  const value = new MetadataDraftStore(scope, sessionStorage).read()!;
  const altered = {
    ...value,
    saved: { ...value.saved, "@id": "another-instance" },
  };
  expect(() => readMetadataDraft(JSON.stringify(altered), scope)).toThrow();
  m.host.ngOnDestroy();
});

for (const status of [401, 403])
  it(`restores a definitively refused create after fresh folder access (${status})`, async () => {
    const m = await metadataRig("create", true);
    m.edit();
    m.request.mockRejectedValueOnce(new HttpError(status, "Refused"));
    await m.host.save();
    expect(m.host.canSignInAgain).toBe(true);
    const next = await m.recreate();
    await next.restoreRecovery();
    expect(next.name).toBe("Unsaved");
    expect(next.state.reloadRequired()).toBe(false);
    m.request.mockClear();
    await next.save();
    expect(
      m.request.mock.calls.filter((call) => call[1] === "PUT"),
    ).toHaveLength(1);
    next.ngOnDestroy();
  });

it("does not restore while a fresh opening read is still in progress", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  const next = await m.recreate();
  const editor = next.editor.nativeElement;
  next.loading.set(true);
  await next.restoreRecovery();
  expect(next.editor.nativeElement).toBe(editor);
  expect(next.name).toBe("Original");
  expect(next.recoveryDraft()?.name).toBe("Unsaved");
  next.loading.set(false);
  await next.restoreRecovery();
  expect(next.name).toBe("Unsaved");
  next.ngOnDestroy();
});

for (const failure of [
  "profile",
  "configuration",
  "component",
  "artifact",
  "permission",
  "template",
])
  it(`retains work while retrying a failed ${failure} opening`, async () => {
    const m = await metadataRig("edit", true);
    m.edit();
    let failed = true;
    const request = m.request.getMockImplementation()!;
    if (failure === "profile")
      vi.spyOn(TestBed.inject(Backend), "init").mockImplementation(async () => {
        if (failed) throw new Error("Profile unavailable");
        return true;
      });
    else if (failure === "configuration")
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status: failed ? 503 : 200 })),
      );
    else if (failure === "component")
      vi.mocked(m.loader.load).mockImplementation(async () => {
        if (failed) throw new Error("Component unavailable");
      });
    else
      m.request.mockImplementation(async (...args) => {
        const path =
          failure === "artifact"
            ? "/template-instances/instance"
            : failure === "permission"
              ? "/template-instances/instance/report"
              : "/templates/template";
        if (failed && args[0] === path) throw new HttpError(503, "Unavailable");
        return request(...args);
      });
    const next = await m.recreate();
    expect(next.state.loadFailed()).toBe(true);
    expect(next.recoveryDraft()?.name).toBe("Unsaved");
    if (failure === "profile" || failure === "configuration")
      expect(next.recoveryReady).toBe(false);
    failed = false;
    await next.reload();
    expect(next.state.loadFailed()).toBe(false);
    expect(next.recoveryDraft()?.name).toBe("Unsaved");
    await next.restoreRecovery();
    expect(next.name).toBe("Unsaved");
    expect(next.dirty()).toBe(true);
    expect(
      m.request.mock.calls.every((call) => !call[1] || call[1] === "GET"),
    ).toBe(true);
    next.ngOnDestroy();
  });

for (const severity of ["errors", "warnings"] as const)
  it(`restores ${severity} against the rejected draft and clears them only on editing`, async () => {
    const m = await metadataRig("edit", true);
    m.edit();
    const server = m.request.getMockImplementation()!;
    m.request.mockImplementation(async (...args) => {
      if (args[1] === "PUT")
        throw new HttpError(400, "Rejected", undefined, {
          [severity]: [
            { location: "/schema:name", message: "Review the name" },
          ],
        });
      return server(...args);
    });
    await m.host.save();
    const next = await m.recreate();
    await next.restoreRecovery();
    expect(next.state.quality()?.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "server",
          message: "Review the name",
        }),
      ]),
    );
    expect(next.validationErrors.length).toBe(severity === "errors" ? 1 : 0);
    next.name = "Corrected";
    next.changed();
    expect(
      next.state.quality()?.problems.filter((p) => p.origin === "server"),
    ).toEqual([]);
    next.ngOnDestroy();
  });

const createScope = metadataDraftScope(
  "https://resource.example",
  "owner",
  "create",
  "template",
  "home",
);
const journal = () =>
  new MetadataDraftStore(createScope, sessionStorage).read();

it("journals a create's identity before dispatch and adopts the created instance after recreation", async () => {
  const m = await metadataCreateRig();
  m.edit();
  await m.host.save();
  const [id] = m.identities();
  expect(journal()?.creation?.id).toBe(id);
  expect(journal()?.uncertainCreation).toBe(true);
  const next = await m.recreate();
  // Discarding is refused until the outcome is known, and asks nothing.
  await next.discardRecovery();
  expect(m.confirm).not.toHaveBeenCalled();
  expect(next.recoveryDraft()?.creation?.id).toBe(id);
  expect(next.error()).toBe(
    "It is not yet known whether this record was created, so its draft cannot be discarded. Restore the draft and use Check save status.",
  );
  await next.restoreRecovery();
  expect(next.name).toBe("Unsaved");
  expect(next.state.uncertainCreation()).toBe(true);
  expect(next.canCheckSave()).toBe(true);
  expect(next.error()).toBe(
    "Your draft has been restored. Saving stays blocked until Check save status shows whether the record was created.",
  );
  const calls = m.request.mock.calls.length;
  await next.save();
  expect(m.request).toHaveBeenCalledTimes(calls);
  await next.checkSaveStatus();
  expect(next.state.uncertainCreation()).toBe(false);
  expect(next.state.reloadRequired()).toBe(false);
  expect(next.canCheckSave()).toBe(false);
  expect(next.dirty()).toBe(false);
  const uuid = id.split("/").at(-1)!;
  expect(
    vi.mocked(TestBed.inject(Router).navigateByUrl).mock.lastCall?.[0],
  ).toMatch(new RegExp(`^/instances/edit/${uuid}\\?`));
  // The journal has moved to the edit address, without the create's identity.
  expect(journal()).toBeNull();
  expect(m.creates()).toHaveLength(1);
  next.ngOnDestroy();
});

it("keeps the identity across reloads after a check finds nothing, and Save sends it again", async () => {
  const m = await metadataCreateRig();
  m.edit();
  m.world.commit = false;
  await m.host.save();
  await m.host.checkSaveStatus();
  expect(m.host.state.uncertainCreation()).toBe(false);
  // Nothing is left to save, but the identity stays: the first request may still commit.
  m.host.name = "Study metadata";
  m.host.changed();
  expect(m.host.dirty()).toBe(false);
  expect(journal()?.creation?.id).toBe([...m.identities()][0]);
  const next = await m.recreate();
  await next.restoreRecovery();
  expect(next.state.reloadRequired()).toBe(false);
  expect(next.canCheckSave()).toBe(false);
  m.world.commit = true;
  m.world.lost = false;
  await next.save();
  expect(m.creates()).toHaveLength(2);
  expect(m.identities().size).toBe(1);
  next.ngOnDestroy();
});

it("retains an unknown create through Sign in again after the check is refused for the session", async () => {
  const m = await metadataCreateRig();
  m.edit();
  await m.host.save();
  m.world.lookup = 401;
  await m.host.checkSaveStatus();
  expect(m.host.canSignInAgain).toBe(true);
  m.host.signInAgain();
  expect(m.signIn).toHaveBeenCalledOnce();
  expect(journal()?.uncertainCreation).toBe(true);
  m.world.lookup = null;
  const next = await m.recreate();
  await next.restoreRecovery();
  expect(next.canCheckSave()).toBe(true);
  expect(next.canSignInAgain).toBe(false);
  await next.checkSaveStatus();
  expect(next.state.uncertainCreation()).toBe(false);
  expect(m.identities().size).toBe(1);
  next.ngOnDestroy();
});

it("keeps today's guard for a journal written before creates carried an identity", async () => {
  const m = await metadataRig("create", true);
  m.edit();
  const legacy = { ...journal()!, reloadRequired: true, uncertainCreation: true };
  delete legacy.creation;
  new MetadataDraftStore(createScope, sessionStorage).write(legacy);
  const next = await m.recreate();
  await next.discardRecovery();
  expect(next.recoveryDraft()).not.toBeNull();
  expect(next.error()).toBe(
    "The create outcome is still unknown. Keep this page open and check Workspace for the created record before starting another create.",
  );
  await next.restoreRecovery();
  expect(next.state.uncertainCreation()).toBe(true);
  expect(next.state.reloadRequired()).toBe(true);
  expect(next.canCheckSave()).toBe(false);
  expect(next.canSignInAgain).toBe(false);
  expect(next.error()).toBe(
    "Your draft has been restored. Saving remains blocked until access, the current revision and any unfinished save are resolved.",
  );
  m.request.mockClear();
  await next.save();
  await next.checkSaveStatus();
  await next.reload();
  expect(m.request).not.toHaveBeenCalled();
  next.ngOnDestroy();
});

it("refuses a journal whose create identity is malformed or belongs elsewhere", async () => {
  const m = await metadataCreateRig();
  m.edit();
  await m.host.save();
  const value = journal()!;
  const id = value.creation!.id;
  const editScope = metadataDraftScope(
    "https://resource.example",
    "owner",
    "edit",
    "template",
    "",
  );
  for (const altered of [
    { ...value, creation: { ...value.creation!, id: "instance" } },
    {
      ...value,
      creation: {
        ...value.creation!,
        id: id.replace("template-instances", "templates"),
      },
    },
    {
      ...value,
      creation: {
        ...value.creation!,
        attempt: {
          ...value.creation!.attempt!,
          submitted: { ...value.creation!.attempt!.submitted, "@id": "other" },
        },
      },
    },
    { ...value, creation: { id } },
    {
      ...value,
      creation: {
        ...value.creation!,
        attempt: { ...value.creation!.attempt!, typedName: 12 },
      },
    },
  ])
    expect(() =>
      readMetadataDraft(JSON.stringify(altered), createScope),
    ).toThrow();
  // Only a create page mints an identity.
  expect(() =>
    readMetadataDraft(
      JSON.stringify({
        ...value,
        scope: editScope,
        saved: { "@id": "template" },
      }),
      editScope,
    ),
  ).toThrow();
  expect(readMetadataDraft(JSON.stringify(value), createScope)).toEqual(value);
  const legacy = { ...value };
  delete legacy.creation;
  expect(
    readMetadataDraft(JSON.stringify(legacy), createScope).creation,
  ).toBeUndefined();
  m.host.ngOnDestroy();
});
