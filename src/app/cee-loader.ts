import type { CedarEmbeddableEditorElement } from "cedar-embeddable-editor";
import { Injectable, inject } from "@angular/core";
import { I18n } from "./i18n";
declare global {
  interface Window {
    cedarCacheControl?: string;
    cedarCeeHostFonts?: boolean;
  }
}

@Injectable({ providedIn: "root" })
export class CeeLoader {
  private readonly i18n = inject(I18n);
  private pending?: Promise<void>;
  /** Artifact/config inputs are set once: a recovery load needs a new element. */
  mountEditor(container: HTMLElement): CedarEmbeddableEditorElement {
    const editor = document.createElement("cedar-embeddable-editor");
    container.replaceChildren(editor);
    return editor;
  }
  load(): Promise<void> {
    if (customElements.get("cedar-embeddable-editor")) return Promise.resolve();
    return (this.pending ||= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => fail(), 30000);
      const detach = () => {
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
      };
      const fail = () => {
        detach();
        script.remove();
        this.pending = undefined;
        reject(new Error(this.i18n.t("Errors.EditorUnavailable")));
      };
      script.src =
        "/third_party_components/cedar-embeddable-editor/cedar-embeddable-editor" +
        (window.cedarCeeHostFonts ? ".host-fonts.js?v=" : ".js?v=") +
        encodeURIComponent(window.cedarCacheControl || "local");
      script.onerror = fail;
      script.onload = () => {
        if (!customElements.get("cedar-embeddable-editor")) return fail();
        detach();
        resolve();
      };
      document.head.append(script);
    }));
  }
}
