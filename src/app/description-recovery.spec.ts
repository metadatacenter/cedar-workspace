import { TestBed } from "@angular/core/testing";
import { expect, it, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { DescriptionEditor } from "./description-editor";
import { Resource } from "./resource";

for (const status of [0, 200, 403, 409, 412, 428, 500]) {
  it(`description recovery after ${status} keeps the draft and replaces the rejected revision`, async () => {
    const resource: Resource = {
      "@id": "item",
      resourceType: "element",
      "schema:name": "Item",
      "schema:description": "original",
      currentUserPermissions: { capabilities: ["updateResource"] },
    };
    const api = {
      snapshot: vi.fn().mockResolvedValue({ data: resource, etag: '"old"' }),
      request: vi.fn().mockRejectedValue(new HttpError(status, "Refused")),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: Backend, useValue: api }],
    });
    const fixture = TestBed.createComponent(DescriptionEditor);
    fixture.componentRef.setInput("resource", resource);
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    await vi.waitFor(() => expect(editor.snapshot()).not.toBeNull());
    editor.draft.set("my draft");
    await editor.save();
    await editor.save();
    expect(api.request).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("button.primary").disabled).toBe(
      true,
    );
    expect(fixture.nativeElement.textContent).toContain("Retry");
    api.snapshot.mockRejectedValueOnce(new Error("Offline"));
    await editor.load(true);
    await editor.save();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(editor.draft()).toBe("my draft");
    api.snapshot.mockResolvedValue({
      data: { ...resource, "schema:description": "someone else's edit" },
      etag: '"new"',
    });
    await editor.load(true);
    expect(editor.draft()).toBe("my draft");
    expect(editor.dirty).toBe(true);
    api.request.mockResolvedValue({ data: resource, etag: '"saved"' });
    await editor.save();
    expect(api.request.mock.calls[1][3]).toBe('"new"');
    fixture.destroy();
  });
}
