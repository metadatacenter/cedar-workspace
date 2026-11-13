import { defineConfig } from "@playwright/test";
import { CHROMIUM_ONLY } from "./tests/browser-tags.mjs";
const port = Number(process.env.PORT || 4797);
// Functional browser contracts share the existing worker budget; pixel baselines keep their own projects.
const functionalSpecs = [
  "metadata-recovery.spec.mjs",
  "metadata-draft-recovery.spec.mjs",
  "metadata-conflict.spec.mjs",
  "permissions.spec.mjs",
  "publish.spec.mjs",
  "lazy-routes.spec.mjs",
  "state-coordination.spec.mjs",
  "bulk-delete-recovery.spec.mjs",
  "bulk-move-recovery.spec.mjs",
  "workspace-return.spec.mjs",
  "api-key-state.spec.mjs",
  "native-choices.spec.mjs",
  "metadata-clarity.spec.mjs",
];

const existingWebkitSpecs = [
  "api-key-state.spec.mjs",
  "state-coordination.spec.mjs",
  "workspace-return.spec.mjs",
  "folder-deletion.spec.mjs",
  "selection-deletion.spec.mjs",
  "bulk-delete-recovery.spec.mjs",
  "folder-list.spec.mjs",
  "explorer.spec.mjs",
  "bulk-move-recovery.spec.mjs",
  "sorting.spec.mjs",
  "permissions.spec.mjs",
  "group-tabs.spec.mjs",
  "information.spec.mjs",
  "refresh.spec.mjs",
  "tooltip.spec.mjs",
  "native-choices.spec.mjs",
  "preview.spec.mjs",
  "return-matrix.spec.mjs",
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: process.env.CEDAR_TEST_WORKERS
    ? Number(process.env.CEDAR_TEST_WORKERS)
    : undefined,
  projects: [
    ...["firefox", "webkit"].map((browserName) => ({
      name: `${browserName}-functional`,
      testMatch:
        browserName === "webkit"
          ? functionalSpecs.filter(
              (spec) => !existingWebkitSpecs.includes(spec),
            )
          : functionalSpecs,
      use: { browserName },
    })),
    ...["firefox", "webkit"].map((browserName) => ({
      name: `${browserName}-accessibility`,
      testMatch:
        /(?:accessibility|layout-resilience|focus-order|announcements)\.spec\.mjs/,
      use: { browserName },
    })),
    {
      name: "",
      use: {
        browserName: "chromium",
        // Repaint complete tiles after selection clears the information panel. Reusing
        // partial raster tiles can leave stray pixels in otherwise empty screenshot areas.
        launchOptions: { args: ["--disable-partial-raster"] },
      },
    },
    {
      name: "webkit",
      testMatch: existingWebkitSpecs,
      grepInvert: new RegExp(CHROMIUM_ONLY),
      use: { browserName: "webkit" },
    },
  ],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Stop a known-red CI/reactor run after a test exhausts its retry.
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
    trace:
      process.env.CEDAR_TEST_TRACE === "on"
        ? "retain-on-failure"
        : "on-first-retry",
  },
  webServer: {
    command: "node serve.mjs",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
