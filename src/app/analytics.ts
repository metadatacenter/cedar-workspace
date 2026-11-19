declare global {
  interface Window {
    /** The Google Analytics 4 measurement ID, which version.js sets from CEDAR_GA4_TRACKING_ID. */
    cedarGA4TrackingId?: string;
    /** The command queue gtag.js reads. */
    dataLayer?: unknown[];
  }
}

/**
 * Load Google Analytics 4 when the deployment supplies a measurement ID. Without one the ID is
 * "false" or empty, as in a development build, and nothing is loaded.
 */
export function loadAnalytics(): void {
  const id = window.cedarGA4TrackingId;
  if (!id || id === "false") return;
  const queue = (window.dataLayer ??= []);
  // gtag.js accepts a command only in the form Google's snippet queues it: the arguments
  // object of the call, not an array of the same values.
  function gtag(..._command: unknown[]) {
    queue.push(arguments);
  }
  const script = document.createElement("script");
  script.async = true;
  script.src =
    "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
  script.onload = () => {
    gtag("js", new Date());
    gtag("config", id);
  };
  document.head.append(script);
}
