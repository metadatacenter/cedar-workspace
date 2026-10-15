import { afterEach, expect, it, vi } from "vitest";
import { metadataRig } from "./testing/metadata-fixture";
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
    args[1] === "POST"
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
  await next.restoreRecovery();
  await next.save();
  expect(next.name).toBe("Unsaved");
  expect(next.state.uncertainCreation()).toBe(true);
  expect(
    m.request.mock.calls.filter((call) => call[1] === "POST"),
  ).toHaveLength(1);
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
  m.access(true);
  await next.checkSaveStatus();
  expect(next.state.reloadRequired()).toBe(false);
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
