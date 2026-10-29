import { test, expect, dashboard, action, resource } from "./fixtures.mjs";
import { openFolderDeletion } from "./folder-deletion-fixture.mjs";
import { selectionFixture, selectDeletion } from "./selection-deletion-fixture.mjs";

/**
 * Whether Workspace's screens survive the conditions WCAG sets for reflow (1.4.10), resized text
 * (1.4.4), text spacing (1.4.12), the contrast of placeholder text (1.4.3) and the contrast of a
 * field's boundary (1.4.11). The four browser components share this method.
 *
 * - Reflow: a window 320 CSS px wide. The page and its own scroll containers must not scroll
 *   sideways, no text may overlap other text, and every control must be reachable. A data table
 *   that needs scrolling in two dimensions may scroll inside its own container, and `tables`
 *   names each one.
 * - Resize: a window of 640 by 400 CSS px, which is a 1280 by 800 window at 200% zoom. No text may
 *   be clipped or overlap other text, and every control must be reachable.
 * - Text spacing: WCAG's line height, letter, word and paragraph spacing, set in the document and
 *   every shadow root of a window 1280 px wide. No text may be clipped or overlap other text.
 * - Placeholders: every placeholder must meet 4.5:1 against the background it is drawn on.
 * - Boundaries: every text-entry or selection control that draws a boundary must draw it at 3:1
 *   against what lies outside it. The token test measures the token's value; this measures what
 *   the browser draws, so a framework default or a local override that replaces the token fails.
 * - Indicators: every icon that alone identifies a control, every focus indicator and every
 *   selection mark must measure 3:1 against what it is drawn on, as the browser draws it.
 *
 * A finding the spec does not name in `exceptions` fails, and so does an exception no screen
 * produces, so the list says exactly what remains.
 */

/** Each screen the checks open, and the shadow roots they leave out. */
const screens = {
  "dashboard list": async (page) => {
    await dashboard(page);
    await select(page);
  },
  "dashboard grid": async (page) => {
    await page.goto("/dashboard");
    await expect(page.locator(".table-scroll")).toHaveAttribute("aria-busy", "false");
    await select(page);
  },
  "filter popover": async (page) => {
    await dashboard(page);
    await page.locator("cedar-filter-chip").first().getByRole("button").first().click();
    await expect(page.getByRole("dialog", { name: "Filter by type" })).toBeVisible();
  },
  groups: async (page) => {
    await page.goto("/groups");
    const find = page.getByRole("combobox", { name: "Find a group", exact: true });
    await find.fill("Research");
    await find.press("Enter");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Research team");
  },
  profile: (page) => account(page, "/profile"),
  settings: (page) => account(page, "/settings"),
  privacy: (page) => account(page, "/privacy"),
  // CEE renders the form in its own shadow root, and its own suite checks it.
  "metadata editor": async (page) => {
    await page.goto("/instances/edit/instance");
    await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
    return ["cedar-embeddable-editor"];
  },
  // The dialogs Workspace opens itself, each over the page it acts on and with its content shown.
  Permissions: async (page) => {
    await dashboard(page);
    await action(page, "Permissions…");
    await expect(page.getByRole("combobox", { name: "User or group" })).toBeEnabled();
  },
  "ownership confirmation": async (page) => {
    await screens.Permissions(page);
    await page.getByRole("checkbox", { name: "Make Sam Curator the owner", exact: true }).click();
    await expect(page.locator("dialog.confirmation-dialog")).toBeVisible();
  },
  Move: (page) => picker(page, "Move"),
  Copy: (page) => picker(page, "Copy"),
  Publish: async (page) => {
    await dashboard(page);
    await action(page, "Publish");
    await expect(page.locator("dialog[open]").getByRole("textbox", { name: "Patch", exact: true })).toBeVisible();
  },
  "Create Draft": async (page) => {
    await page.route("**/templates/template/report", (route) =>
      route.fulfill({ json: { ...resource, "bibo:status": "bibo:published" } }),
    );
    await folders(page);
    await dashboard(page);
    await page.getByRole("button", { name: "Actions for Study metadata", exact: true }).click();
    await page.locator(".resource-menu").getByRole("button", { name: "Create Draft", exact: true }).click();
    await expect(page.locator("dialog .folder-scroll")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("dialog .folder-scroll tbody tr")).toHaveCount(2);
    await expect(page.locator("dialog[open]").getByRole("textbox", { name: "Patch", exact: true })).toHaveValue("1");
  },
  "New folder": async (page) => {
    await dashboard(page);
    await page.locator("#button-create").click();
    await page.locator(".new-menu").getByRole("button", { name: "Folder", exact: true }).click();
    await expect(page.locator("dialog[open]").getByLabel("Name", { exact: true })).toBeVisible();
  },
  rename: async (page) => {
    await dashboard(page);
    await action(page, "Rename");
    await expect(page.locator("dialog[open]").getByLabel("Name", { exact: true })).toHaveValue("Study metadata");
  },
  "discard confirmation": async (page) => {
    await screens.rename(page);
    await page.locator("dialog[open]").getByLabel("Name", { exact: true }).fill("Changed");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.confirmation-dialog")).toBeVisible();
  },
  "deletion confirmation": async (page) => {
    await dashboard(page);
    await action(page, "Delete");
  },
  "folder deletion": async (page) => {
    await openFolderDeletion(page);
  },
  "selection deletion": async (page) => {
    await selectionFixture(page);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await selectDeletion(page);
  },
  "OpenView confirmation": async (page) => {
    await dashboard(page);
    await action(page, "Enable Openview");
  },
  // The preview shows the artifact in CEE, which its own suite checks.
  preview: async (page) => {
    await dashboard(page);
    await page.getByRole("button", { name: "Preview Study metadata", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[aria-busy]")).toHaveAttribute("aria-busy", "false");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Study metadata");
    return ["cedar-embeddable-editor"];
  },
  "group deletion confirmation": async (page) => {
    await page.goto("/groups");
    await page.getByRole("tab", { name: "Delete group", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Delete group", exact: true });
    const find = panel.getByRole("combobox", { name: "Group name", exact: true });
    await find.fill("Research");
    await find.press("Enter");
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue("Research team");
    await panel.getByRole("button", { name: "Delete group", exact: true }).click();
    await expect(page.locator("dialog.confirmation-dialog")).toBeVisible();
  },
};
/** A home folder holding a folder that takes items and one that does not, as Move and Copy list them. */
async function folders(page) {
  const folder = (id, name, allowed = true) => ({
    "@id": id,
    resourceType: "folder",
    "schema:name": name,
    "pav:lastUpdatedOn": "2026-01-02T12:00:00Z",
    currentUserPermissions: { capabilities: allowed ? ["copyIntoFolder", "moveIntoFolder"] : [] },
  });
  const home = folder("home", "My workspace");
  const children = [folder("archive", "Archive"), folder("restricted", "Read only", false)];
  await page.route("**/folders/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("resource_types") && url.pathname.endsWith("/contents")) return route.fallback();
    const id = decodeURIComponent(url.pathname.split("/folders/")[1].split("/")[0]);
    if (url.pathname.endsWith("/contents"))
      return route.fulfill({
        json: {
          resources: id === "home" ? children : [],
          totalCount: id === "home" ? children.length : 0,
          pathInfo: [home],
        },
      });
    return route.fulfill({ json: [home, ...children].find((f) => f["@id"] === id) ?? home });
  });
}
/** The Move or Copy dialog, its folders listed. */
async function picker(page, label) {
  await folders(page);
  await dashboard(page);
  await action(page, label);
  await expect(page.locator("dialog .folder-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("dialog .folder-scroll tbody tr")).toHaveCount(2);
}
/** Select the listing's artifact, which opens it in the Information panel. */
async function select(page) {
  await page.locator('[data-resource-id="template"] .resource-icon').click();
  await expect(page.locator(".information h1")).toHaveText(resource["schema:name"]);
}
async function account(page, address) {
  await page.goto(address);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
}

const conditions = {
  reflow: { width: 320, height: 800 },
  resize: { width: 640, height: 400 },
  "text spacing": { width: 1280, height: 800 },
};
const spacing = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;

/**
 * What a condition breaks on the page, as findings: `kind`, the element as `target` and its text.
 * Runs in the page. `reflow` and `resize` look for sideways scrolling or unreachable controls,
 * `resize` and `text spacing` for clipped text, and all three for overlapping text.
 */
function inspect({ condition, excluded }) {
  const roots = [document];
  for (let i = 0; i < roots.length; i++)
    for (const node of roots[i].querySelectorAll("*"))
      if (node.shadowRoot && !excluded.some((selector) => node.matches(selector)))
        roots.push(node.shadowRoot);
  const elements = roots.flatMap((root) => [...root.querySelectorAll("*")]);
  // An id the CDK generates says nothing about the element.
  const part = (node) =>
    node.localName +
    (node.id && !node.id.startsWith("cdk-") ? "#" + node.id : "") +
    [...node.classList]
      .filter((name) => !/^(ng-|cdk-)/.test(name))
      .slice(0, 2)
      .map((name) => "." + name)
      .join("");
  /** The element and its two nearest ancestors that carry an id or a class. */
  const describe = (node) => {
    const parts = [part(node)];
    for (let up = node.parentElement; up && parts.length < 3; up = up.parentElement)
      if (up.id || up.classList.length) parts.unshift(part(up));
    return parts.join(" ");
  };
  const hidden = (node) =>
    !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
    node.closest(".sr-only, [hidden]") !== null;
  const text = (node) => (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const popups = 'dialog[open], [role="dialog"], [role="menu"], .popover, .resource-menu, details[open] > nav';
  const findings = [];
  const add = (kind, node, detail) =>
    findings.push({ kind, target: describe(node), text: text(node), detail });

  const scrolls = [document.scrollingElement, ...elements].map((node) => [
    node,
    node.scrollLeft,
    node.scrollTop,
  ]);
  if (condition !== "text spacing") {
    const page = document.documentElement;
    if (page.scrollWidth > page.clientWidth + 1)
      add("page scrolls sideways", page, `${page.scrollWidth} px in ${page.clientWidth} px`);
    for (const node of elements) {
      const style = getComputedStyle(node);
      if (
        ["auto", "scroll"].includes(style.overflowX) &&
        node.scrollWidth > node.clientWidth + 1 &&
        !hidden(node)
      )
        add("scrolls sideways", node, `${node.scrollWidth} px in ${node.clientWidth} px`);
    }
    const controls = elements.filter(
      (node) =>
        node.matches(
          'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ) && !hidden(node),
    );
    for (const control of controls) {
      control.scrollIntoView({ block: "center", inline: "center" });
      const box = control.getBoundingClientRect();
      const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
        add("unreachable control", control, "outside the window when scrolled to");
        continue;
      }
      const root = control.getRootNode();
      const hit = root
        .elementsFromPoint(x, y)
        .find((node) => !node.closest('[role="tooltip"]'));
      const label = hit?.closest("label");
      // An open popup covers what lies beneath it until Escape or a click outside closes it.
      const popup = hit?.closest(popups);
      if (
        hit &&
        hit !== control &&
        !control.contains(hit) &&
        !(label && (label.contains(control) || label.htmlFor === control.id)) &&
        !(popup && !popup.contains(control))
      )
        add("unreachable control", control, `covered by ${describe(hit)}`);
    }
  }
  const runs = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (!node.textContent.trim() || !owner || hidden(owner)) continue;
      if (owner.closest("select, option, script, style, textarea")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const boxes = [...range.getClientRects()].filter((box) => box.width > 1 && box.height > 1);
      if (boxes.length) runs.push({ node, owner, boxes });
    }
  }
  // Text something clips: a box with overflow hidden or clip whose content is larger than it, and
  // which text runs past. An ellipsis hides text past the content box, padding and all.
  if (condition !== "reflow")
    for (const box of elements) {
      const style = getComputedStyle(box);
      const clipsX = ["hidden", "clip"].includes(style.overflowX);
      const clipsY = ["hidden", "clip"].includes(style.overflowY);
      const overX = clipsX && box.scrollWidth > box.clientWidth + 1;
      const overY = clipsY && box.scrollHeight > box.clientHeight + 1;
      if ((!overX && !overY) || hidden(box)) continue;
      const inside = runs.filter((run) => box.contains(run.owner));
      if (!inside.length) continue;
      const ellipsis = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
      const area = box.getBoundingClientRect();
      const left = area.left + box.clientLeft;
      const top = area.top + box.clientTop;
      const right = left + box.clientWidth - (ellipsis ? parseFloat(style.paddingRight) : 0);
      const bottom = top + box.clientHeight;
      const past = inside.some(({ boxes }) =>
        boxes.some(
          (run) =>
            (overX && (run.left < left - 1 || run.right > right + 1)) ||
            (overY && (run.top < top - 1 || run.bottom > bottom + 1)),
        ),
      );
      if (!past) continue;
      // An ellipsis may stand for text the element also offers in full, as its help or name.
      const full = text(box);
      const offered = [box, box.closest("[data-cedar-help]")].some((node) =>
        [node?.getAttribute("data-cedar-help"), node?.getAttribute("title"), node?.getAttribute("aria-label")].some(
          (value) => value && value.replace(/\s+/g, " ").trim().startsWith(full),
        ),
      );
      if (!(ellipsis && offered))
        add(
          "clipped text",
          box,
          ellipsis ? "an ellipsis hides text offered nowhere else" : `${box.scrollWidth}×${box.scrollHeight} px in ${box.clientWidth}×${box.clientHeight} px`,
        );
    }
  // Text that overlaps other text where both show. A text's boxes are cut to what the boxes that
  // clip it leave showing, and text an open popup lies over does not show.
  const open = elements.filter((node) => node.matches(popups) && !hidden(node));
  const cut = (owner, run) => {
    let [left, top, right, bottom] = [run.left, run.top, run.right, run.bottom];
    for (let box = owner.parentElement; box; box = box.parentElement) {
      if (getComputedStyle(box).overflow === "visible") continue;
      const area = box.getBoundingClientRect();
      [left, top] = [Math.max(left, area.left), Math.max(top, area.top)];
      [right, bottom] = [Math.min(right, area.right), Math.min(bottom, area.bottom)];
    }
    if (right - left <= 2 || bottom - top <= 2) return null;
    const under = open.some((popup) => {
      if (popup.contains(owner)) return false;
      const area = popup.getBoundingClientRect();
      return left < area.right && right > area.left && top < area.bottom && bottom > area.top;
    });
    return under ? null : { left, top, right, bottom };
  };
  const shown = runs
    .map((run) => ({ ...run, boxes: run.boxes.map((box) => cut(run.owner, box)).filter(Boolean) }))
    .filter((run) => run.boxes.length);
  const reported = new Set();
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      const [a, b] = [shown[i], shown[j]];
      const overlap = a.boxes.some((p) =>
        b.boxes.some(
          (q) =>
            Math.min(p.right, q.right) - Math.max(p.left, q.left) > 2 &&
            Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 2,
        ),
      );
      const key = describe(a.owner) + "|" + describe(b.owner);
      if (overlap && !reported.has(key)) {
        reported.add(key);
        add("overlapping text", a.owner, `overlaps ${describe(b.owner)} “${text(b.owner)}”`);
      }
    }
  for (const [node, left, top] of scrolls) [node.scrollLeft, node.scrollTop] = [left, top];
  return findings;
}

/** Each placeholder's contrast against what it is drawn on. Runs in the page. */
function placeholders({ excluded }) {
  const roots = [document];
  for (let i = 0; i < roots.length; i++)
    for (const node of roots[i].querySelectorAll("*"))
      if (node.shadowRoot && !excluded.some((selector) => node.matches(selector)))
        roots.push(node.shadowRoot);
  const canvas = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const rgba = (color) => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = color;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
  const luminance = (channels) =>
    channels
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const results = [];
  for (const root of roots)
    for (const field of root.querySelectorAll("input[placeholder], textarea[placeholder]")) {
      if (!field.placeholder || !field.checkVisibility()) continue;
      // The field's own background, laid over each ancestor's in turn down to the page's white.
      const layers = [];
      for (let node = field; node; node = node.parentElement ?? node.getRootNode().host)
        layers.push(rgba(getComputedStyle(node).backgroundColor));
      let background = [255, 255, 255];
      for (const layer of layers.reverse()) background = over(layer, background);
      const foreground = over(rgba(getComputedStyle(field, "::placeholder").color), background);
      const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
      results.push({
        target: field.id || field.getAttribute("aria-label") || field.name,
        placeholder: field.placeholder,
        ratio: Math.floor(((light + 0.05) / (dark + 0.05)) * 100) / 100,
      });
    }
  return results;
}

/**
 * The boundary of each text-entry or selection control that draws one, measured against what lies
 * outside it. Runs in the page.
 *
 * A control's boundary is drawn by the border of the control itself, of an ancestor at most three
 * levels up whose box is at most 48px larger each way, or of an element in an absolutely positioned
 * layer within such an ancestor. The strongest side of any of them is the one measured, against the
 * colour outside the box that holds it. A control that draws no boundary is not measured, because
 * 1.4.11 asks for contrast in what identifies a control rather than for a boundary; a disabled
 * control is exempt, as 1.4.11 exempts inactive components.
 */
function boundaries({ excluded }) {
  const roots = [document];
  for (let i = 0; i < roots.length; i++)
    for (const node of roots[i].querySelectorAll("*"))
      if (node.shadowRoot && !excluded.some((selector) => node.matches(selector)))
        roots.push(node.shadowRoot);
  const canvas = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const rgba = (color) => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = color;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
  const luminance = (channels) =>
    channels
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const parent = (node) => node.assignedSlot ?? node.parentElement ?? node.getRootNode().host ?? null;
  const contains = (outer, inner) => {
    for (let node = inner; node; node = parent(node)) if (node === outer) return true;
    return false;
  };
  // The element's own background, laid over each ancestor's in turn down to the page's white.
  const behind = (element) => {
    const layers = [];
    for (let node = element; node; node = parent(node)) layers.push(rgba(getComputedStyle(node).backgroundColor));
    let background = [255, 255, 255];
    for (const layer of layers.reverse()) background = over(layer, background);
    return background;
  };
  const borders = (element) => {
    const own = getComputedStyle(element);
    return ["Top", "Right", "Bottom", "Left"].flatMap((side) => {
      const colour = rgba(own[`border${side}Color`]);
      const drawn =
        parseFloat(own[`border${side}Width`]) >= 1 &&
        !["none", "hidden"].includes(own[`border${side}Style`]) &&
        colour[3] > 0;
      return drawn ? [colour] : [];
    });
  };
  const controls =
    'input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="range"], [type="color"], ' +
    '[type="file"], [type="button"], [type="submit"], [type="reset"], [type="image"]), textarea, select, ' +
    '[role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"]';
  const results = [];
  for (const root of roots)
    for (const field of root.querySelectorAll(controls)) {
      if (!field.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (field.disabled || field.getAttribute("aria-disabled") === "true") continue;
      const own = field.getBoundingClientRect();
      if (own.width <= 1 || own.height <= 1) continue;
      const drawers = [];
      let box = field;
      for (let level = 0; box && level <= 3; level++, box = parent(box)) {
        const rect = box.getBoundingClientRect();
        if (rect.width > own.width + 48 || rect.height > own.height + 48) break;
        drawers.push({ element: box, holder: box });
        if (box === field) continue;
        for (const layer of box.querySelectorAll("*")) {
          if (contains(field, layer) || contains(layer, field) || getComputedStyle(layer).position !== "absolute") continue;
          for (const element of [layer, ...layer.querySelectorAll("*")])
            if (element.checkVisibility({ visibilityProperty: true })) drawers.push({ element, holder: box });
        }
      }
      let strongest;
      for (const { element, holder } of drawers) {
        const container = parent(holder);
        const outside = container ? behind(container) : [255, 255, 255];
        for (const colour of borders(element)) {
          const boundary = over(colour, behind(element));
          const [light, dark] = [luminance(boundary), luminance(outside)].sort((x, y) => y - x);
          const ratio = (light + 0.05) / (dark + 0.05);
          if (!strongest || ratio > strongest.ratio) strongest = { ratio, boundary, outside };
        }
      }
      if (!strongest) continue;
      results.push({
        target: field.id || field.getAttribute("aria-label") || field.name || field.localName,
        ratio: Math.floor(strongest.ratio * 100) / 100,
        boundary: `rgb(${strongest.boundary.map(Math.round).join(", ")})`,
        outside: `rgb(${strongest.outside.map(Math.round).join(", ")})`,
      });
    }
  return results;
}

/**
 * Icons, focus indicators and selection marks below 3:1 against what they are drawn on, and how many
 * of each were measured. Runs in the page.
 *
 * - Icons. An SVG icon is measured when it is all that identifies the control holding it, because
 *   the control shows no text, or when it carries a name of its own. Its stroke, or its fill where
 *   it has no stroke, is laid over what lies behind it, with the opacity of every ancestor.
 * - Focus. Each enabled control in scope is focused as a keyboard would focus it, and read two
 *   frames later, once a framework has marked it focused. Whatever its focus changes in the
 *   outlines, borders and shadows of the control, of the six boxes around it and of their indicator
 *   layers is the indicator, since only the focus can have changed them. A small input inside a
 *   wider field, such as a time's hour, shows its focus on the field. An outline drawn outside a box
 *   is measured against what lies outside the box, and one drawn inside it, like an inset shadow,
 *   against the box's own fill. A control whose focus changes none of these fails, because a change
 *   of fill alone measures about 1.2:1.
 * - Selection. A selected, pressed or current item is compared with an unselected item of the same
 *   kind in the same group, such as another chip in its chip set. Whatever it draws that the other
 *   does not is its mark, measured the same way: a line, a changed fill against what surrounds the
 *   item, or an icon the other lacks, on the item or on the element around it that draws its state.
 *   A heavier or underlined text counts as a mark of text, which 1.4.3 already measures. An item
 *   whose only difference is a tint fails, because a tint measures about 1.2:1. The current item at
 *   the end of a trail, such as a breadcrumb's last folder, is identified by its position and is not
 *   measured.
 *
 * A disabled control is exempt, as 1.4.11 exempts inactive components.
 */
async function findFaintIndicators({ scope, exclude, selected, exceptions }) {
  const elements = [];
  const roots = [];
  const collect = (root) => {
    roots.push(root);
    for (const element of root.querySelectorAll("*")) {
      elements.push(element);
      if (element.shadowRoot) collect(element.shadowRoot);
    }
  };
  collect(document);
  // A transition would leave a focused control's computed style at its resting value when it is read.
  const still = new CSSStyleSheet();
  still.replaceSync(
    "*, *::before, *::after { transition: none !important; animation: none !important; }",
  );
  for (const root of roots)
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, still];
  const parent = (element) =>
    element.assignedSlot ??
    element.parentElement ??
    (element.getRootNode().host || null);
  const contains = (outer, inner) => {
    for (let node = inner; node; node = parent(node))
      if (node === outer) return true;
    return false;
  };
  const surfaces = scope
    ? elements.filter((element) => element.matches(scope))
    : [];
  const excluded = elements.filter((element) =>
    exclude.some((selector) => element.matches(selector)),
  );
  const within = (element) =>
    (!scope || surfaces.some((outer) => contains(outer, element))) &&
    !excluded.some((outer) => outer !== element && contains(outer, element));
  const style = (element, pseudo) => getComputedStyle(element, pseudo);
  const parse = (colour) => (colour.match(/[\d.]+/g) ?? []).map(Number);
  const over = ([r, g, b, a = 1], [br, bg, bb]) => [
    r * a + br * (1 - a),
    g * a + bg * (1 - a),
    b * a + bb * (1 - a),
  ];
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const rgb = (colour) =>
    `rgb(${colour.slice(0, 3).map(Math.round).join(", ")})`;
  /** The colour behind `element`: its own and its ancestors' fills, laid over white. */
  const behind = (element) => {
    const fills = [];
    for (let node = element; node; node = parent(node)) {
      const fill = parse(style(node).backgroundColor);
      if ((fill[3] ?? 1) > 0) fills.push(fill);
      if ((fill[3] ?? 1) === 1) break;
    }
    return fills.reduceRight((base, fill) => over(fill, base), [255, 255, 255]);
  };
  const outside = (element) => {
    const container = parent(element);
    return container ? behind(container) : [255, 255, 255];
  };
  const shown = (element) =>
    element.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    }) && element.getClientRects().length > 0;
  const visuallyHidden = (element) => {
    for (let node = element; node; node = parent(node)) {
      const box = node.getBoundingClientRect();
      if (
        (box.width <= 1 || box.height <= 1) &&
        (/hidden|clip/.test(style(node).overflowX) ||
          style(node).clipPath !== "none")
      )
        return true;
    }
    return false;
  };
  const disabled = (element) => {
    for (let node = element; node; node = parent(node))
      if (node.disabled || node.getAttribute("aria-disabled") === "true")
        return true;
    return false;
  };
  const describe = (element) => {
    const id = element.id ? `#${element.id}` : "";
    const classes = [...element.classList]
      .filter((name) => !name.startsWith("ng-") && !name.startsWith("cdk-"))
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    const name =
      element.getAttribute("aria-label") ??
      (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return `${element.localName}${id}${classes}${name ? ` "${name.slice(0, 40)}"` : ""}`;
  };
  const findings = [];
  const measured = { icon: 0, focus: 0, selection: 0 };
  const report = (kind, element, message) => {
    findings.push({
      kind,
      message: `${kind}: ${describe(element)} ${message}`,
      excepted: exceptions.flatMap((exception, index) =>
        exception.kind === kind && element.matches(exception.target)
          ? [index]
          : [],
      ),
    });
  };
  const SIDES = ["Top", "Right", "Bottom", "Left"];
  /** What `element`, or one of its pseudo-elements, draws in outline, shadow and border. */
  const drawingsOf = (element, pseudo, label = "") => {
    const own = style(element, pseudo);
    if (pseudo && (own.content === "none" || own.content === "normal"))
      return [];
    const fill = over(parse(own.backgroundColor), behind(element));
    const out = outside(element);
    const drawings = [];
    const name = `${label}${pseudo ?? ""}`;
    if (own.outlineStyle !== "none" && parseFloat(own.outlineWidth) >= 1) {
      const colour = parse(own.outlineColor);
      if ((colour[3] ?? 1) > 0) {
        const against =
          parseFloat(own.outlineOffset) + parseFloat(own.outlineWidth) <= 0
            ? fill
            : out;
        const raw = `${own.outlineStyle} ${own.outlineWidth} ${own.outlineColor} ${own.outlineOffset}`;
        drawings.push({
          what: `${name}outline`,
          raw,
          colour: over(colour, against),
          against,
        });
      }
    }
    for (const [, colour, rest] of own.boxShadow.matchAll(
      /(rgba?\([^)]*\))([^,]*)/g,
    )) {
      const parsed = parse(colour);
      if ((parsed[3] ?? 1) === 0) continue;
      const against = /inset/.test(rest) ? fill : out;
      drawings.push({
        what: `${name}shadow`,
        raw: `${colour}${rest}`,
        colour: over(parsed, against),
        against,
      });
    }
    for (const side of SIDES) {
      const colour = parse(own[`border${side}Color`]);
      if (
        parseFloat(own[`border${side}Width`]) < 1 ||
        ["none", "hidden"].includes(own[`border${side}Style`])
      )
        continue;
      if ((colour[3] ?? 1) === 0) continue;
      const raw = `${own[`border${side}Style`]} ${own[`border${side}Width`]} ${own[`border${side}Color`]}`;
      drawings.push({
        what: `${name}border-${side.toLowerCase()}`,
        raw,
        colour: over(colour, fill),
        against: out,
      });
    }
    if (pseudo) {
      const colour = parse(own.backgroundColor);
      if ((colour[3] ?? 1) > 0) {
        const against = behind(element);
        drawings.push({
          what: `${name}fill`,
          raw: own.backgroundColor,
          colour: over(colour, against),
          against,
        });
      }
    }
    return drawings;
  };
  /**
   * What a box draws, with the boxes around it up to `levels` above, and the absolutely positioned
   * layers inside each. A box more than 48px larger each way stops the climb unless `anySize`.
   */
  const drawingsAround = (element, levels, anySize = false) => {
    const own = element.getBoundingClientRect();
    const drawings = [];
    let box = element;
    for (let level = 0; box && level <= levels; level++, box = parent(box)) {
      const rect = box.getBoundingClientRect();
      if (
        !anySize &&
        (rect.width > own.width + 48 || rect.height > own.height + 48)
      )
        break;
      const label = level ? `ancestor ${level} ` : "";
      drawings.push(
        ...drawingsOf(box, undefined, label),
        ...drawingsOf(box, "::before", label),
        ...drawingsOf(box, "::after", label),
      );
      for (const layer of box.querySelectorAll("*")) {
        if (style(layer).position !== "absolute" || !shown(layer)) continue;
        if (level && contains(layer, element)) continue;
        // A layer's pieces are drawn in flow inside it, as an outlined field's outline is.
        [layer, ...layer.querySelectorAll("*")].forEach((piece, index) =>
          drawings.push(
            ...drawingsOf(piece, undefined, `${label}layer ${index} `),
            ...drawingsOf(piece, "::before", `${label}layer ${index} `),
          ),
        );
      }
    }
    return drawings;
  };
  const strongest = (drawings) =>
    drawings
      .map((drawing) => ({
        ...drawing,
        ratio: contrast(drawing.colour, drawing.against),
      }))
      .sort((a, b) => b.ratio - a.ratio)[0];
  const signature = (drawing) => `${drawing.what}|${drawing.raw}`;
  // Icons.
  const CONTROLS =
    'button, a[href], summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"]';
  const shownText = (element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const holder = node.parentElement;
      if (!holder || !node.textContent?.trim() || holder.closest("svg"))
        continue;
      if (shown(holder) && !visuallyHidden(holder)) return true;
    }
    return false;
  };
  /** An icon's stroke, or its fill where it has no stroke, with the opacity of every ancestor. */
  const iconColour = (svg) => {
    let colour;
    for (const shape of svg.querySelectorAll(
      "path, line, polyline, polygon, circle, rect, ellipse",
    )) {
      const own = style(shape);
      if (own.stroke !== "none" && parseFloat(own.strokeWidth) > 0) {
        colour = parse(own.stroke);
        colour[3] = (colour[3] ?? 1) * Number(own.strokeOpacity);
        break;
      }
      if (own.fill !== "none") {
        colour = parse(own.fill);
        colour[3] = (colour[3] ?? 1) * Number(own.fillOpacity);
        break;
      }
    }
    if (!colour) return undefined;
    for (let node = svg; node; node = parent(node))
      colour[3] = (colour[3] ?? 1) * Number(style(node).opacity);
    return colour;
  };
  for (const svg of elements) {
    if (
      svg.localName !== "svg" ||
      parent(svg)?.closest("svg") ||
      !within(svg) ||
      !shown(svg) ||
      visuallyHidden(svg)
    )
      continue;
    const box = svg.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) continue;
    let control = null;
    for (let node = svg; node && !control; node = parent(node))
      if (node.matches(CONTROLS)) control = node;
    if (control && disabled(control)) continue;
    const host = parent(svg);
    const named =
      svg.getAttribute("role") === "img" ||
      svg.hasAttribute("aria-label") ||
      !!svg.querySelector("title") ||
      (!!host &&
        (host.getAttribute("role") === "img" ||
          host.hasAttribute("aria-label")) &&
        host !== control);
    if (!named && !(control && !shownText(control))) continue;
    const colour = iconColour(svg);
    if (!colour) continue;
    const ground = behind(svg);
    const drawn = over(colour, ground);
    measured.icon++;
    const ratio = contrast(drawn, ground);
    if (ratio < 3)
      report(
        "icon",
        control ?? svg,
        `is ${rgb(drawn)} on ${rgb(ground)}, ${ratio.toFixed(2)}:1`,
      );
  }
  // Selection.
  const SELECTED = [
    '[aria-selected="true"]',
    '[aria-pressed="true"]',
    '[aria-current]:not([aria-current="false"])',
    ...selected,
  ].join(", ");
  const textMarks = (element, sibling) => {
    if (!sibling) return [];
    const mine = style(element);
    const theirs = style(sibling);
    const heavier = parseFloat(mine.fontWeight) > parseFloat(theirs.fontWeight);
    const underlined =
      /underline/.test(mine.textDecorationLine) &&
      !/underline/.test(theirs.textDecorationLine);
    if (!heavier && !underlined) return [];
    // Text is held to 4.5:1 by 1.4.3, which axe measures, so a text mark is taken as passing here.
    return [
      {
        what: heavier ? "heavier text" : "underline",
        raw: "text",
        colour: [0, 0, 0],
        against: [255, 255, 255],
      },
    ];
  };
  /** A changed fill, seen against what surrounds the item, and the icons the sibling lacks. */
  const fillAndIconMarks = (element, sibling) => {
    const marks = [];
    const fill = parse(style(element).backgroundColor);
    // With nothing to compare, the item's own fill is its mark if it has one.
    if (
      sibling
        ? style(element).backgroundColor !== style(sibling).backgroundColor
        : (fill[3] ?? 1) > 0
    )
      marks.push({
        what: "fill",
        raw: "fill",
        colour: behind(element),
        against: outside(element),
      });
    if (!sibling) return marks;
    const icons = (node) =>
      [...node.querySelectorAll("svg")].filter((svg) => shown(svg));
    if (icons(element).length > icons(sibling).length)
      for (const svg of icons(element)) {
        const colour = iconColour(svg);
        if (colour)
          marks.push({
            what: "icon",
            raw: "icon",
            colour: over(colour, behind(svg)),
            against: behind(svg),
          });
      }
    return marks;
  };
  for (const item of elements) {
    if (
      !item.matches(SELECTED) ||
      item.localName === "input" ||
      !within(item) ||
      !shown(item) ||
      visuallyHidden(item)
    )
      continue;
    const trailEnd =
      item.hasAttribute("aria-current") &&
      ![...(item.parentElement?.children ?? [])]
        .slice([...(item.parentElement?.children ?? [])].indexOf(item) + 1)
        .some((other) => other.localName === item.localName && shown(other));
    if (trailEnd) continue;
    // The nearest unselected item of the same kind: a sibling, or failing that one in the same group.
    const kind = (other) =>
      other !== item &&
      other.localName === item.localName &&
      other.classList[0] === item.classList[0] &&
      !other.matches(SELECTED) &&
      shown(other);
    let sibling = [...(item.parentElement?.children ?? [])].find(kind);
    for (
      let group = parent(item), level = 0;
      !sibling && group && level < 3;
      group = parent(group), level++
    )
      sibling = [...group.querySelectorAll(item.localName)].find(kind);
    const theirs = new Set(
      sibling ? drawingsAround(sibling, 0).map(signature) : [],
    );
    const marks = [
      ...drawingsAround(item, 0).filter(
        (drawing) => !theirs.has(signature(drawing)),
      ),
      ...textMarks(item, sibling),
      ...fillAndIconMarks(item, sibling),
    ];
    // A state set on an inner control may be drawn by the element around it, as a chip's is.
    for (
      let mine = parent(item),
        other = sibling ? parent(sibling) : null,
        level = 0;
      mine && other && mine !== other && level < 2;
      mine = parent(mine), other = parent(other), level++
    ) {
      const others = new Set(drawingsAround(other, 0).map(signature));
      marks.push(
        ...drawingsAround(mine, 0).filter(
          (drawing) => !others.has(signature(drawing)),
        ),
        ...textMarks(mine, other),
        ...fillAndIconMarks(mine, other),
      );
    }
    measured.selection++;
    const best = strongest(marks);
    if (!best)
      report(
        "selection",
        item,
        sibling ? "looks the same as an unselected sibling" : "draws no mark",
      );
    else if (best.ratio < 3)
      report(
        "selection",
        item,
        `${best.what} is ${rgb(best.colour)} on ${rgb(best.against)}, ${best.ratio.toFixed(2)}:1`,
      );
  }
  // Focus, last, because it moves focus. Each control is restored to unfocused afterwards.
  const FOCUSABLE =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const deepActive = () => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement)
      active = active.shadowRoot.activeElement;
    return active;
  };
  const before = deepActive();
  for (const control of elements) {
    if (
      !control.matches(FOCUSABLE) ||
      !within(control) ||
      !shown(control) ||
      visuallyHidden(control) ||
      disabled(control)
    )
      continue;
    deepActive()?.blur();
    const resting = new Set(drawingsAround(control, 6, true).map(signature));
    control.focus({ preventScroll: true, focusVisible: true });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (deepActive() !== control || !control.matches(":focus-visible"))
      continue;
    const changed = drawingsAround(control, 6, true).filter(
      (drawing) => !resting.has(signature(drawing)),
    );
    measured.focus++;
    const best = strongest(changed);
    if (!best)
      report(
        "focus",
        control,
        "changes no outline, border or shadow when focused",
      );
    else if (best.ratio < 3)
      report(
        "focus",
        control,
        `${best.what} is ${rgb(best.colour)} on ${rgb(best.against)}, ${best.ratio.toFixed(2)}:1`,
      );
    control.blur();
  }
  before?.focus({ preventScroll: true });
  for (const root of roots)
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
      (sheet) => sheet !== still,
    );
  return { measured, findings };
}

/**
 * Data tables that need scrolling in two dimensions, which may scroll sideways inside their own
 * container at 320 px rather than reflow.
 */
const tables = [
  {
    // A dialog opened over the listing leaves it as it is.
    screens: [
      "dashboard list",
      "filter popover",
      "Permissions",
      "ownership confirmation",
      "Move",
      "Copy",
      "Publish",
      "Create Draft",
      "New folder",
      "rename",
      "discard confirmation",
      "deletion confirmation",
      "selection deletion",
      "OpenView confirmation",
      "preview",
    ],
    target: "cedar-workspace.cedar-native-choices div.workspace div.table-scroll",
    reason:
      "The listing is a table of each item's name, last change, version and actions, which a narrow window scrolls inside its container.",
  },
];

/**
 * What the checks find that is left as it is, each with the visible change that would remove it.
 * Fixes that keep every captured width pixel-identical are made instead of listed here.
 */
const exceptions = [
  // The card's size comes from the design-token package's resource-card recipe, and its type and
  // date share one line that ends in an ellipsis when it runs out of room.
  {
    screens: ["dashboard grid"],
    conditions: ["text spacing"],
    kind: "clipped text",
    target: "div.table-scroll.explorer-grid tr.explorer-item.explorer-schema span.explorer-modified",
    text: "Template · ",
    change:
      "Under WCAG text spacing a card's type and date, “Template · 1 day ago”, ends in an ellipsis. Keeping it whole needs the line to wrap and the card to grow with it, which also changes a card whose line is cut today, and a change to the recipe's card size.",
  },
];

const named = (entry, finding) =>
  entry.kind === finding.kind &&
  entry.target === finding.target &&
  finding.text.startsWith(entry.text ?? "");

for (const [screen, open] of Object.entries(screens)) {
  for (const [condition, viewport] of Object.entries(conditions))
    test(`${screen} survives ${condition}`, async ({ page, api }) => {
      await page.setViewportSize(viewport);
      const excluded = (await open(page)) ?? [];
      await page.mouse.move(0, 0);
      if (condition === "text spacing") {
        await page.evaluate(
          ({ css, excluded }) => {
            const roots = [document];
            for (let i = 0; i < roots.length; i++)
              for (const node of roots[i].querySelectorAll("*"))
                if (node.shadowRoot && !excluded.some((selector) => node.matches(selector)))
                  roots.push(node.shadowRoot);
            for (const root of roots) {
              const sheet = new CSSStyleSheet();
              sheet.replaceSync(css);
              root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
            }
          },
          { css: spacing, excluded },
        );
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      }
      const findings = await page.evaluate(inspect, { condition, excluded });
      const allowed = (finding) =>
        finding.kind === "scrolls sideways" &&
        condition === "reflow" &&
        tables.some((table) => table.screens.includes(screen) && table.target === finding.target);
      const expected = exceptions.filter(
        (entry) => entry.screens.includes(screen) && entry.conditions.includes(condition),
      );
      const unlisted = findings
        .filter((finding) => !allowed(finding) && !expected.some((entry) => named(entry, finding)))
        .map((finding) => `${finding.kind}: ${finding.target} “${finding.text}” (${finding.detail})`);
      expect(unlisted, "findings the exceptions do not name").toEqual([]);
      const unproduced = expected
        .filter((entry) => !findings.some((finding) => named(entry, finding)))
        .map((entry) => `${entry.kind}: ${entry.target}`);
      expect(unproduced, `exceptions ${screen} no longer produces under ${condition}`).toEqual([]);
      if (condition === "reflow")
        expect(
          tables
            .filter((table) => table.screens.includes(screen))
            .filter(
              (table) =>
                !findings.some((finding) => finding.kind === "scrolls sideways" && finding.target === table.target),
            )
            .map((table) => table.target),
          `tables ${screen} no longer scrolls`,
        ).toEqual([]);
    });
}

/** Each screen with placeholders, the dialogs and tabs that hold the rest among them, and what each shows. */
const fields = {
  "dashboard list": [screens["dashboard list"], ["Search", "No description"]],
  "filter popover": [screens["filter popover"], ["Search"]],
  groups: [screens.groups, ["Search", "Search for a group", "Optional description", "Search for a user"]],
  "Create group": [
    async (page) => {
      await page.goto("/groups");
      await page.getByRole("tab", { name: "Create group", exact: true }).click();
      await expect(page.getByLabel("Group name", { exact: true })).toBeVisible();
    },
    ["Search", "Enter a group name"],
  ],
  "Delete group": [
    async (page) => {
      await page.goto("/groups");
      await page.getByRole("tab", { name: "Delete group", exact: true }).click();
      await expect(page.locator("#delete-group-picker input")).toBeVisible();
    },
    ["Search", "Search for a group"],
  ],
  // Permissions holds the only placeholder in a dialog. Each other dialog shows only those of the
  // page behind it, which are measured again with the dialog over them.
  Permissions: [screens.Permissions, ["Search", "Search by name"]],
  "ownership confirmation": [screens["ownership confirmation"], ["Search", "Search by name"]],
  ...Object.fromEntries(
    [
      "Move",
      "Copy",
      "Publish",
      "Create Draft",
      "New folder",
      "rename",
      "discard confirmation",
      "deletion confirmation",
      "folder deletion",
      "selection deletion",
      "OpenView confirmation",
      "preview",
    ].map((name) => [name, [screens[name], ["Search"]]]),
  ),
  "group deletion confirmation": [screens["group deletion confirmation"], ["Search", "Search for a group"]],
};
for (const [screen, [open, shown]] of Object.entries(fields))
  test(`${screen} draws its placeholders at 4.5:1`, async ({ page, api }) => {
    const excluded = (await open(page)) ?? [];
    const measured = await page.evaluate(placeholders, { excluded });
    expect(measured.map((field) => field.placeholder)).toEqual(shown);
    expect(
      measured.filter((field) => field.ratio < 4.5),
      "placeholders under 4.5:1",
    ).toEqual([]);
  });

for (const [screen, open] of Object.entries(screens))
  test(`${screen} draws its field boundaries at 3:1`, async ({ page, api }) => {
    const excluded = (await open(page)) ?? [];
    await page.mouse.move(0, 0);
    const measured = await page.evaluate(boundaries, { excluded });
    // A selector that stops matching would let the check pass by measuring nothing.
    if (screen === "dashboard list") expect(measured.length, "controls that draw a boundary").toBeGreaterThan(0);
    expect(
      measured.filter((field) => field.ratio < 3),
      "field boundaries under 3:1",
    ).toEqual([]);
  });

for (const [screen, open] of Object.entries(screens))
  test(`${screen} draws its icons, focus indicators and selection marks at 3:1`, async ({ page, api }) => {
    const excluded = (await open(page)) ?? [];
    await page.mouse.move(0, 0);
    const { measured, findings } = await page.evaluate(findFaintIndicators, {
      scope: null,
      exclude: excluded,
      // A listing row is selected by class, because a plain table's rows take no aria-selected.
      selected: ["tr.selected"],
      exceptions: [],
    });
    // A selector that stops matching would let the check pass by measuring nothing.
    if (screen === "dashboard list") {
      expect(measured.icon, "icons").toBeGreaterThan(0);
      expect(measured.focus, "focus indicators").toBeGreaterThan(0);
      expect(measured.selection, "selection marks").toBeGreaterThan(0);
    }
    expect(
      findings.map((finding) => finding.message),
      "icons, focus indicators and selection marks under 3:1",
    ).toEqual([]);
  });
