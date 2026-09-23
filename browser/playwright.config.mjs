import { defineConfig } from "@playwright/test";
const port = Number(process.env.PORT || 4797);
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  projects: [
    { name: "", use: { browserName: "chromium" } },
    { name: "webkit", testMatch: ["sorting.spec.mjs", "permissions.spec.mjs", "group-tabs.spec.mjs"], use: { browserName: "webkit" } },
  ],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: "disabled" } },
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
