import { defineConfig } from "@playwright/test";
import { CHROMIUM_ONLY } from "./tests/browser-tags.mjs";
const port = Number(process.env.PORT || 4797);
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
      use: { browserName },
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
    trace: process.env.CEDAR_TEST_TRACE === "on" ? "retain-on-failure" : "off",
    screenshot: process.env.CI ? "only-on-failure" : "off",
  },
  webServer: {
    command: "node serve.mjs",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
