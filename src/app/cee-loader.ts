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
  load(): Promise<void> {
    if (customElements.get("cedar-embeddable-editor")) return Promise.resolve();
    return (this.pending ||= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => fail(), 30000);
      const fail = () => {
        clearTimeout(timer);
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
        clearTimeout(timer);
        resolve();
      };
      document.head.append(script);
    }));
  }
}
