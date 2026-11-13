import { test } from "@playwright/test";

/**
 * A test tagged CHROMIUM_ONLY drives input that only Chromium accepts, such as a finger drawn
 * through its DevTools protocol. The Firefox and WebKit projects filter it out, so it is never scheduled there,
 * rather than scheduled and skipped.
 */
export const CHROMIUM_ONLY = "@chromium-only";

/** Mixed journeys retain functional checks in every engine; pixels use the pinned Chromium image. */
export function comparePixels() {
  return (
    Boolean(process.env.WORKSPACE_VISUAL) &&
    (test.info().project.use.browserName ?? "chromium") === "chromium"
  );
}
