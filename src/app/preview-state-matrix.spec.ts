import { TestBed } from "@angular/core/testing";
import { afterEach, expect, it, vi } from "vitest";
import { ArtifactPreview } from "./artifact-preview";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";

afterEach(() => vi.unstubAllGlobals());
for (const type of ["template", "element", "field", "instance"]) {
  for (const staleEvent of ["ready", "error"] as const) {
    it(`${type}: a removed viewer's ${staleEvent} cannot settle or destroy its replacement`, async () => {
      for (const name of ["cedar-embeddable-editor", "cedar-embeddable-field"])
        if (!customElements.get(name))
          customElements.define(name, class extends HTMLElement {});
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
        configurable: true,
        value: vi.fn(),
      });
      const artifact = {
        "@id": "artifact",
        "schema:name": "Preview",
        "schema:isBasedOn": "template",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
      );
      TestBed.configureTestingModule({
        providers: [
          {
            provide: Backend,
            useValue: {
              request: vi.fn().mockResolvedValue({ data: artifact }),
            },
          },
          {
            provide: CeeLoader,
            useValue: { load: vi.fn().mockResolvedValue(undefined) },
          },
        ],
      });
      const fixture = TestBed.createComponent(ArtifactPreview);
      fixture.componentRef.setInput("resource", {
        ...artifact,
        resourceType: type,
      });
      fixture.detectChanges();
      const preview = fixture.componentInstance;
      await vi.waitFor(() =>
        expect(preview.mount.nativeElement.firstElementChild).not.toBeNull(),
      );
      const viewer = () =>
        preview.mount.nativeElement.firstElementChild as HTMLElement & {
          eventHandler: { ready(): void; error(message: string): void };
        };
      const first = viewer();
      first.eventHandler.ready();
      preview.toggleTryOut();
      const second = viewer();
      expect(second).not.toBe(first);
      expect(preview.loading()).toBe(true);
      if (staleEvent === "error") first.eventHandler.error("obsolete error");
      else first.eventHandler.ready();
      expect(viewer()).toBe(second);
      expect(preview.error()).toBeNull();
      expect(preview.loading()).toBe(true);
      second.eventHandler.ready();
      expect(preview.loading()).toBe(false);
      preview.toggleTryOut();
      const third = viewer();
      second.eventHandler.error("old trial error");
      third.eventHandler.ready();
      expect(preview.error()).toBeNull();
      expect(preview.trying()).toBe(false);
      fixture.destroy();
      third.eventHandler.error("disposed error");
      expect(preview.error()).toBeNull();
    });
  }
}
