import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "./backend.service";
import { metadataRig } from "./testing/metadata-fixture";

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
for (const mode of ["edit", "create"]) {
  it(`${mode}: a read-only opening rechecks content and permissions before allowing a write`, async () => {
    const m = await metadataRig(mode, true);
    m.access(false);
    const next = await m.recreate();
    expect(next.canRecheckOpeningAccess).toBe(true);
    await next.recheckOpeningAccess();
    expect(next.writable()).toBe(false);
    m.access(true);
    m.revision('"newer"');
    m.server({
      "@id": "instance",
      "schema:isBasedOn": "template",
      "schema:name": "Newer saved content",
      Value: { "@value": "newer" },
    });
    m.request.mockClear();
    await next.recheckOpeningAccess();
    expect(next.writable()).toBe(true);
    expect(next.canRecheckOpeningAccess).toBe(false);
    expect(
      m.request.mock.calls.every((call) => !call[1] || call[1] === "GET"),
    ).toBe(true);
    if (mode === "edit") expect(next.name).toBe("Newer saved content");
    next.name = "Now editable";
    next.changed();
    await next.save();
    const write = m.request.mock.calls.find(
      (call) => call[1] === (mode === "edit" ? "PUT" : "POST"),
    );
    expect(write).toBeDefined();
    if (mode === "edit") expect(write?.[3]).toBe('"newer"');
    next.ngOnDestroy();
  });
}
it("read-only sign-in redirects without inventing retained work", async () => {
  const m = await metadataRig("edit", true);
  m.access(false);
  const next = await m.recreate();
  next.signInAgain();
  expect(m.signIn).toHaveBeenCalledOnce();
  expect(sessionStorage.length).toBe(0);
  next.ngOnDestroy();
});
it("opening recheck cannot replace a retained working draft", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  m.access(false);
  const next = await m.recreate();
  m.request.mockClear();
  await next.recheckOpeningAccess();
  expect(m.request).not.toHaveBeenCalled();
  expect(next.recoveryDraft()?.name).toBe("Unsaved");
  next.ngOnDestroy();
});

for (const mode of ["edit", "create"])
  for (const status of [401, 403]) {
    it(`${mode}: retries an initial access refusal (${status}) without writing`, async () => {
      const m = await metadataRig(mode, true);
      const request = m.request.getMockImplementation()!;
      let refused = true;
      m.request.mockImplementation(async (...args) => {
        if (
          refused &&
          args[0] ===
            (mode === "edit" ? "/template-instances/instance" : "/folders/home")
        )
          throw new HttpError(status, "Refused");
        return request(...args);
      });
      const next = await m.recreate();
      expect(next.state.loadFailed()).toBe(true);
      expect(next.canRecheckOpeningAccess).toBe(true);
      next.signInAgain();
      expect(m.signIn).toHaveBeenCalledOnce();
      expect(sessionStorage.length).toBe(0);
      await next.recheckOpeningAccess();
      expect(next.state.loadFailed()).toBe(true);
      refused = false;
      await next.recheckOpeningAccess();
      expect(next.state.loadFailed()).toBe(false);
      expect(next.writable()).toBe(true);
      expect(
        m.request.mock.calls.every((call) => !call[1] || call[1] === "GET"),
      ).toBe(true);
      next.ngOnDestroy();
    });
  }
