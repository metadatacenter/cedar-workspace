/**
 * The control that has focus, as its role and accessible name: `button "Next"`. The name comes from
 * Playwright's accessibility snapshot, which computes it as a screen reader does; states and values
 * are dropped, so a sequence does not change with what a field holds. Focus on the page itself,
 * outside every control, reads `(page)`, and a control removed before it could be read `(gone)`.
 */
export async function focusedControl(page) {
  // A fresh mark each time, so a mark an earlier call left is never read. The page keeps the marked
  // element itself, so the mark comes off later without the element being looked up again.
  const found = await page.evaluate(() => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement)
      element = element.shadowRoot.activeElement;
    if (
      !element ||
      element === document.body ||
      element === document.documentElement
    )
      return null;
    window.__focusMark = (window.__focusMark ?? 0) + 1;
    window.__focusMarked = element;
    element.setAttribute("data-test-focused", String(window.__focusMark));
    return {
      mark: window.__focusMark,
      summary: element.localName === "summary" ? element.getAttribute("aria-label") : null,
    };
  });
  if (found === null) return "(page)";
  let snapshot = null;
  try {
    snapshot = await page.locator(`[data-test-focused="${found.mark}"]`).ariaSnapshot({ timeout: 1000 });
  } catch {
    // Read as gone below.
  }
  // Not a locator call: one waits for its element to come back, and a control the page removes
  // while it is read, as a successful save removes Save, never does. A poll asking for focus could
  // then not ask again until it timed out, though focus had long since moved on.
  const connected = await page.evaluate(() => {
    const element = window.__focusMarked;
    window.__focusMarked = undefined;
    element?.removeAttribute("data-test-focused");
    return !!element?.isConnected;
  });
  if (snapshot === null || !connected) return "(gone)";
  const summary = found.summary;
  let line = snapshot.split("\n")[0].replace(/^- /, "");
  // Playwright gives a summary without a role none, though browsers expose it as a button. It
  // reads as `summary` and its name.
  if (!line && summary !== null) return `summary "${summary}"`;
  // A line holding a colon is quoted as YAML.
  if (line.startsWith("'"))
    line = line.slice(1, line.lastIndexOf("'")).replaceAll("''", "'");
  const [, role, name] = line.match(/^(\w+)(?: "((?:[^"\\]|\\.)*)")?/) ?? [];
  if (!role) return line;
  return name === undefined ? role : `${role} "${name}"`;
}

/** Press `key` `count` times and name each control focus lands on. */
export async function tabSequence(page, count, key = "Tab") {
  const stops = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key);
    stops.push(await focusedControl(page));
  }
  return stops;
}
