/**
 * The control that has focus, as its role and accessible name: `button "Next"`. The name comes from
 * Playwright's accessibility snapshot, which computes it as a screen reader does; states and values
 * are dropped, so a sequence does not change with what a field holds. Focus on the page itself,
 * outside every control, reads `(page)`, and a control removed before it could be read `(gone)`.
 */
export async function focusedControl(page) {
  // A fresh mark each time, so a mark an earlier call left is never read.
  const mark = await page.evaluate(() => {
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
    element.setAttribute("data-test-focused", String(window.__focusMark));
    return window.__focusMark;
  });
  if (mark === null) return "(page)";
  const marked = page.locator(`[data-test-focused="${mark}"]`);
  let snapshot;
  try {
    snapshot = await marked.ariaSnapshot({ timeout: 1000 });
  } catch {
    return "(gone)";
  }
  const summary = await marked.evaluate((element) => {
    element.removeAttribute("data-test-focused");
    return element.localName === "summary"
      ? element.getAttribute("aria-label")
      : null;
  });
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
