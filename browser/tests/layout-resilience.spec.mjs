import { test, expect, dashboard, action, resource } from "./fixtures.mjs";
import { openFolderDeletion } from "./folder-deletion-fixture.mjs";
import { selectionFixture, selectDeletion } from "./selection-deletion-fixture.mjs";

/**
 * Whether Workspace's screens survive the conditions WCAG sets for reflow (1.4.10), resized text
 * (1.4.4), text spacing (1.4.12) and the contrast of placeholder text (1.4.3). The four browser
 * components share this method.
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
