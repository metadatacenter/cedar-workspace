import { afterEach, describe, expect, it } from "vitest";
import { loadAnalytics } from "./analytics";

const gtagScripts = () => [
  ...document.querySelectorAll<HTMLScriptElement>(
    'script[src^="https://www.googletagmanager.com/"]',
  ),
];

describe("Google Analytics loading", () => {
  afterEach(() => {
    for (const script of gtagScripts()) script.remove();
    delete window.cedarGA4TrackingId;
    delete window.dataLayer;
  });
  for (const id of [undefined, "", "false"])
    it(`loads nothing when the measurement ID is ${JSON.stringify(id) ?? "unset"}`, () => {
      window.cedarGA4TrackingId = id;
      loadAnalytics();
      expect(gtagScripts()).toEqual([]);
      expect(window.dataLayer).toBeUndefined();
    });
  it("loads gtag.js for a measurement ID and configures it once the script has loaded", () => {
    window.cedarGA4TrackingId = "G-TEST123";
    loadAnalytics();
    const scripts = gtagScripts();
    expect(scripts.map((script) => script.src)).toEqual([
      "https://www.googletagmanager.com/gtag/js?id=G-TEST123",
    ]);
    expect(scripts[0].async).toBe(true);
    expect(window.dataLayer).toEqual([]);
    scripts[0].dispatchEvent(new Event("load"));
    const queue = window.dataLayer!;
    // gtag.js reads each command from an arguments object, as Google's snippet queues it.
    expect(
      queue.map((command) => Object.prototype.toString.call(command)),
    ).toEqual(["[object Arguments]", "[object Arguments]"]);
    expect(queue.map((command) => Array.from(command as IArguments))).toEqual([
      ["js", expect.any(Date)],
      ["config", "G-TEST123"],
    ]);
  });
});
