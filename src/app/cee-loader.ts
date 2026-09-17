import { Injectable } from "@angular/core";
declare global {
  interface Window {
    cedarCacheControl?: string;
  }
}

@Injectable({ providedIn: "root" })
export class CeeLoader {
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
        reject(new Error("Unable to load the metadata editor. Please reload."));
      };
      script.src =
        "/third_party_components/cedar-embeddable-editor/cedar-embeddable-editor.js?v=" +
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
