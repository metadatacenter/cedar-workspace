/**
 * A test tagged CHROMIUM_ONLY drives input that only Chromium accepts, such as a finger drawn
 * through its DevTools protocol. The WebKit project filters it out, so it is never scheduled there,
 * rather than scheduled and skipped.
 */
export const CHROMIUM_ONLY = "@chromium-only";
