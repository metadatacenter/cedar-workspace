import { afterEach, expect, it, vi } from "vitest";
import { metadataRig } from "./testing/metadata-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reload recreates CEE and establishes its baseline from the new server contents", async () => {
  const m = await metadataRig();
  try {
    m.edit();
    const old = m.host.editor.nativeElement;
    m.server({
      "@id": "instance",
      "schema:isBasedOn": "template",
      "schema:name": "New server revision",
      Value: { "@value": "server" },
    });
    await m.host.reload();
    expect(m.host.error()).toBe("");
    expect(m.host.dirty()).toBe(false);
    expect(m.host.editor.nativeElement).not.toBe(old);
    expect(m.host.editorHost.nativeElement.children).toHaveLength(1);
    expect(m.host.editor.nativeElement.currentMetadata["Value"]).toEqual({
      "@value": "server",
    });
    m.host.name = "Unobserved name edit";
    old.dispatchEvent(new Event("change"));
    expect(m.host.dirty()).toBe(false);
    m.host.editor.nativeElement.dispatchEvent(new Event("change"));
    expect(m.host.dirty()).toBe(true);
  } finally {
    m.host.ngOnDestroy();
  }
});
