import { defineConfig } from "@playwright/test";
import { CHROMIUM_ONLY } from "./tests/browser-tags.mjs";
const port = Number(process.env.PORT || 4797);
const fullTrace = process.env.CEDAR_TEST_TRACE === "on";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: process.env.CEDAR_TEST_WORKERS
    ? Number(process.env.CEDAR_TEST_WORKERS)
    : undefined,
  // New functional/accessibility specs automatically run in every engine.
  projects: [
    {
      name: "",
      use: {
        browserName: "chromium",
        // Complete raster tiles keep the existing zero-difference pixel baselines stable.
        launchOptions: { args: ["--disable-partial-raster"] },
      },
    },
    ...["firefox", "webkit"].map((browserName) => ({
      name: browserName,
      // Chromium alone exposes CDP's continuous synthetic touch input.
      grepInvert: new RegExp(CHROMIUM_ONLY),
      use: {
        browserName,
        // An intermittent Firefox stall needs the original action/network timeline.
        // DOM snapshots also enable Playwright's network recording. Skip the
        // screenshot filmstrip by default; CEDAR_TEST_TRACE=on keeps it too.
        trace: fullTrace ? "retain-on-failure" : browserName === "firefox" ? {
          mode: "retain-on-failure",
          snapshots: true,
          screenshots: false,
          sources: false,
        } : "off",
      },
    })),
  ],
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A retry must not hide an unreliable case.
  maxFailures: process.env.CI ? 1 : 0,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 0,
      threshold: 0.02,
      animations: "disabled",
    },
  },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 1000 },
    timezoneId: "UTC",
    locale: "en-US",
    trace: fullTrace ? "retain-on-failure" : "off",
    screenshot: process.env.CI ? "only-on-failure" : "off",
  },
  webServer: {
    command: "node serve.mjs",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
