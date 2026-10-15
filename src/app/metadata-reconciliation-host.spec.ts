import { afterEach, expect, it, vi } from "vitest";
import { metadataRig } from "./testing/metadata-fixture";
import { HttpError } from "./backend.service";
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const base = {
  "@id": "instance",
  "schema:isBasedOn": "template",
  "schema:name": "Original",
  Value: { "@value": "original" },
};
it("reviews both authors, preserves unknown values, then saves against the reviewed revision", async () => {
  const m = await metadataRig("edit", true);
  m.edit();
  m.server({
    ...base,
    Value: { "@value": "other author" },
    unknown: { preserve: true },
  });
  m.revision('"new"');
  await m.host.reviewLatest();
  expect(m.host.review()?.complete).toBe(true);
  m.host.applyReview();
  expect(m.host.name).toBe("Unsaved");
  expect(m.host.editor.nativeElement.currentMetadata.Value).toEqual({
    "@value": "other author",
  });
  expect(
    m.request.mock.calls.every((call) => !call[1] || call[1] === "GET"),
  ).toBe(true);
  await m.host.save();
  const write = m.request.mock.calls.find((call) => call[1] === "PUT")!;
  expect(write[3]).toBe('"new"');
  expect(write[2]).toMatchObject({
    unknown: { preserve: true },
    "schema:name": "Unsaved",
  });
  m.host.ngOnDestroy();
});
it("requires an explicit choice for conflicting input and rejects stale review choices", async () => {
  const m = await metadataRig("edit", true);
  m.setValue(m.host.editor.nativeElement, "mine");
  m.server({ ...base, Value: { "@value": "theirs" } });
  m.revision('"new"');
  await m.host.reviewLatest();
  expect(m.host.review()?.complete).toBe(false);
  const editor = m.host.editor.nativeElement;
  m.host.applyReview();
  expect(m.host.editor.nativeElement).toBe(editor);
  const path = m.host.review()!.changes.find((change) => change.conflict)!.path;
  m.host.reviewChoice(path, "mine");
  m.setValue(editor, "newer input");
  m.host.applyReview();
  expect(m.host.editor.nativeElement).toBe(editor);
  expect(m.host.review()).toBeNull();
  expect(editor.currentMetadata.Value).toEqual({ "@value": "newer input" });
  m.host.ngOnDestroy();
});
for (const failure of [
  "read",
  "permission",
  "revision",
  "identity",
  "template",
] as const)
  it(`retains the draft when review cannot establish ${failure}`, async () => {
    const m = await metadataRig("edit", true);
    m.edit();
    const server = m.request.getMockImplementation()!;
    m.request.mockImplementation(async (...args) => {
      if (failure === "read") throw new HttpError(503, "Unavailable");
      const response = await server(...args);
      if (failure === "permission" && args[0].endsWith("/report"))
        response.data = { currentUserPermissions: { capabilities: [] } };
      if (failure === "revision") response.etag = null;
      if (failure === "identity" && args[0] === "/template-instances/instance")
        response.data = { ...response.data, "@id": "other" };
      if (failure === "template" && args[0] === "/templates/template")
        response.data = { ...response.data, "schema:name": "Changed template" };
      return response;
    });
    const editor = m.host.editor.nativeElement;
    await m.host.reviewLatest();
    expect(m.host.review()).toBeNull();
    expect(m.host.editor.nativeElement).toBe(editor);
    expect(m.host.name).toBe("Unsaved");
    m.host.ngOnDestroy();
  });
