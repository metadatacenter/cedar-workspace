import { defineConfig } from "@playwright/test";
const port = Number(process.env.PORT || 4797);
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: process.env.CEDAR_TEST_WORKERS ? Number(process.env.CEDAR_TEST_WORKERS) : undefined,
  projects: [
    { name: "", use: { browserName: "chromium" } },
    { name: "webkit", testMatch: ["api-key-state.spec.mjs", "state-coordination.spec.mjs", "workspace-return.spec.mjs", "folder-deletion.spec.mjs", "selection-deletion.spec.mjs", "bulk-delete-recovery.spec.mjs", "folder-list.spec.mjs", "explorer.spec.mjs", "bulk-move-recovery.spec.mjs", "sorting.spec.mjs", "permissions.spec.mjs", "group-tabs.spec.mjs", "information.spec.mjs", "refresh.spec.mjs", "tooltip.spec.mjs", "native-choices.spec.mjs", "preview.spec.mjs", "return-matrix.spec.mjs"], use: { browserName: "webkit" } },
  ],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  expect: { toHaveScreenshot: { maxDiffPixels: 0, threshold: 0.02, animations: "disabled" } },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 1000 },
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node serve.mjs",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
