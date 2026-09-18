import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CeeLoader } from "./cee-loader";

describe("CEE bundle loading", () => {
  let registered: boolean;
  let loader: CeeLoader;
  beforeEach(() => {
    registered = false;
    loader = new CeeLoader();
    vi.spyOn(customElements, "get").mockImplementation(() =>
      registered ? HTMLElement : undefined,
    );
    window.cedarCacheControl = "release 42";
  });
  afterEach(() => {
    document
      .querySelectorAll('script[src*="/cedar-embeddable-editor/"]')
      .forEach((s) => s.remove());
    delete window.cedarCacheControl;
    delete window.cedarCeeHostFonts;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("shares concurrent loads and uses the deployed cache version", async () => {
    const first = loader.load();
    expect(loader.load()).toBe(first);
    const script = document.querySelector(
      'script[src*="cedar-embeddable-editor.js"]',
    ) as HTMLScriptElement;
    expect(script.src).toContain("?v=release%2042");
    registered = true;
    script.dispatchEvent(new Event("load"));
    await first;
    await loader.load();
    expect(
      document.querySelectorAll('script[src*="/cedar-embeddable-editor/"]')
        .length,
    ).toBe(1);
  });
  it("uses the host-font bundle when deployment supplies it", async () => {
    window.cedarCeeHostFonts = true;
    const loaded = loader.load();
    const script = document.querySelector(
      'script[src*="cedar-embeddable-editor.host-fonts.js"]',
    ) as HTMLScriptElement;
    expect(script.src).toContain("?v=release%2042");
    registered = true;
    script.dispatchEvent(new Event("load"));
    await loaded;
  });
  it("fails when a successful script does not register CEE, and permits retry", async () => {
    const first = loader.load();
    const rejected = expect(first).rejects.toThrow("Unable to load");
    document
      .querySelector('script[src*="cedar-embeddable-editor.js"]')!
      .dispatchEvent(new Event("load"));
    await rejected;
    const second = loader.load();
    expect(second).not.toBe(first);
    const retryRejected = expect(second).rejects.toThrow("Unable to load");
    document
      .querySelector('script[src*="cedar-embeddable-editor.js"]')!
      .dispatchEvent(new Event("error"));
    await retryRejected;
  });
  it("bounds a stalled download and removes the failed script", async () => {
    vi.useFakeTimers();
    const rejected = expect(loader.load()).rejects.toThrow("Unable to load");
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(
      document.querySelector('script[src*="cedar-embeddable-editor.js"]'),
    ).toBeNull();
  });
});
