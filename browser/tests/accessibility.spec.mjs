import AxeBuilder from "@axe-core/playwright";
import { test, expect, dashboard, action } from "./fixtures.mjs";

/**
 * axe's verdict on the page: the rules that fail, and the results it could not decide.
 *
 * The rules are every rule axe-core tags for WCAG 2.0, 2.1 and 2.2 at levels A and AA, and Label
 * in Name. Label in Name, WCAG 2.1's criterion 2.5.3, needs a control's accessible name to contain
 * the text it shows. axe-core's rule for it is experimental, and a tag selection leaves experimental
 * rules out, so it runs by name, as in the designer's, the term picker's and CEE's gates.
 */
async function audit(page, exclude = []) {
  const builders = [
    new AxeBuilder({ page }).withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
    ]),
    new AxeBuilder({ page }).withRules(["label-content-name-mismatch"]),
  ];
  const verdicts = [];
  // axe runs one analysis at a time in a page.
  for (const builder of builders) {
    for (const selector of exclude) builder.exclude(selector);
    verdicts.push(await builder.analyze());
  }
  return {
    violations: verdicts.flatMap((verdict) => verdict.violations),
    undecided: verdicts.flatMap((verdict) =>
      verdict.incomplete.flatMap((result) =>
        result.nodes.map((node) => ({ rule: result.id, node })),
      ),
    ),
  };
}

async function route(page, address) {
  await page.goto(address);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}
async function selected(page) {
  await dashboard(page);
  await page.getByRole("row", { name: /^Study metadata/ }).click();
  await expect(page.locator(".information h1")).toHaveText("Study metadata");
}
async function typeFilter(page) {
  await dashboard(page);
  await page
    .locator("cedar-filter-chip")
    .first()
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Filter by type" }),
  ).toBeVisible();
}
async function sortMenu(page) {
  await dashboard(page);
  await page.getByRole("button", { name: "Sort options", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Sort options" })).toBeVisible();
}

/**
 * One control of each kind, found in the state that shows it. Each is scanned once with the pointer
 * resting on it and once focused from the keyboard, since both change how it is drawn and both can
 * open its help.
 */
const controls = {
  button: [
    dashboard,
    (page) =>
      page.getByRole("button", { name: "Refresh workspace", exact: true }),
  ],
  link: [
    dashboard,
    (page) => page.getByRole("link", { name: "Shared with Me", exact: true }),
  ],
  "text box": [
    dashboard,
    (page) =>
      page.getByRole("textbox", { name: "Search workspace", exact: true }),
  ],
  select: [
    dashboard,
    (page) => page.getByRole("combobox", { name: "Version", exact: true }),
  ],
  tab: [
    selected,
    (page) => page.getByRole("tab", { name: "Version", exact: true }),
  ],
  checkbox: [
    typeFilter,
    (page) => page.getByRole("checkbox", { name: "Folder", exact: true }),
  ],
  "menu item": [
    sortMenu,
    (page) =>
      page.getByRole("menuitemradio", { name: "Last modified", exact: true }),
  ],
  "list row": [
    dashboard,
    (page) => page.getByRole("row", { name: /^Study metadata/ }),
  ],
};

/** Each state the gate scans, and what it leaves out of the scan. */
const states = {
  dashboard: (page) => route(page, "/dashboard"),
  "dashboard list": (page) => dashboard(page),
  groups: (page) => route(page, "/groups"),
  "selected group": async (page) => {
    await route(page, "/groups");
    const find = page.getByRole("combobox", {
      name: "Find a group",
      exact: true,
    });
    await find.fill("Research");
    await find.press("Enter");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Research team",
    );
  },
  profile: (page) => route(page, "/profile"),
  settings: (page) => route(page, "/settings"),
  privacy: (page) => route(page, "/privacy"),
  permissions: async (page) => {
    await dashboard(page);
    await action(page, "Permissions…");
  },
  "active filter chips": (page) =>
    route(
      page,
      "/dashboard?view=list&resource_types=folder,template&modified=week",
    ),
  "type filter": typeFilter,
  "date filter": async (page) => {
    await dashboard(page);
    await page
      .locator("cedar-filter-chip")
      .nth(1)
      .getByRole("button")
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Filter by last modified" }),
    ).toBeVisible();
  },
  "resource menu": async (page) => {
    await dashboard(page);
    await page
      .getByRole("button", { name: "Actions for Study metadata", exact: true })
      .click();
    await expect(page.locator(".resource-menu button").first()).toBeFocused();
  },
  "user menu": async (page) => {
    await dashboard(page);
    await page.locator('summary[aria-label="User menu"]').click();
    await expect(
      page.getByRole("link", { name: "Profile", exact: true }),
    ).toBeVisible();
  },
  "actions menu": async (page) => {
    await dashboard(page);
    await page.locator('summary[aria-label="Actions menu"]').click();
    await expect(
      page.getByRole("link", { name: "Groups", exact: true }),
    ).toBeVisible();
  },
  "new menu": async (page) => {
    await dashboard(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(page.locator(".new-menu nav")).toBeVisible();
  },
  "sort menu": sortMenu,
  "information panel": selected,
  "version tab": async (page) => {
    await selected(page);
    await page.getByRole("tab", { name: "Version", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "Version", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  },
  // CEE renders the form, and its own gate assesses it.
  "metadata editor": async (page) => {
    await page.goto("/instances/edit/instance");
    await expect(page.getByLabel("Instance name")).toHaveValue("Study record");
    return ["cedar-embeddable-editor"];
  },
  notification: async (page) => {
    await dashboard(page);
    await action(page, "Rename");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(page.locator(".toast")).toContainText("Saved.");
  },
  error: async (page) => {
    await dashboard(page);
    await page.route("**/api/resource/folders/home/contents?**", (route) =>
      route.fulfill({ status: 503, json: { message: "Listing unavailable" } }),
    );
    await page
      .getByRole("button", { name: "Refresh workspace", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Listing unavailable");
  },
};
for (const [kind, [open, find]] of Object.entries(controls)) {
  states[`hovered ${kind}`] = async (page) => {
    await open(page);
    const control = find(page);
    await control.hover();
    await expect
      .poll(() => control.evaluate((element) => element.matches(":hover")))
      .toBe(true);
    if (await control.getAttribute("data-cedar-help"))
      await expect(page.getByRole("tooltip")).toBeVisible();
  };
  states[`focused ${kind}`] = async (page) => {
    await open(page);
    const control = find(page);
    // A key press first, so focus is drawn as it is for someone using the keyboard.
    await page.keyboard.press("Shift");
    await control.focus();
    await expect
      .poll(() =>
        control.evaluate((element) => element.matches(":focus-visible")),
      )
      .toBe(true);
    if (await control.getAttribute("data-cedar-help"))
      await expect(page.getByRole("tooltip")).toBeVisible();
  };
}

/** An axe target without the attributes Angular names after a build's components. */
const normalized = (node) =>
  node.target.join(" ").replace(/\[_ng(content|host)-[^\]]*\]/g, "");
const element = (page, node) =>
  page.locator("css=" + node.target.join(" ")).first();

/**
 * The lowest contrast between a text's colour and what is painted under the parts of it that show,
 * as WCAG computes it, or null when none of it shows. Two screenshots of the element, with its text
 * and with its text transparent, give where the glyphs are and the background at each. A pixel
 * counts as a glyph's only when the text changes it markedly. Repainting can shift what is drawn over
 * the text by a level or two, and an edge the glyph barely covers says nothing its core does not.
 * Glyphs something opaque covers are drawn in neither screenshot, so they do not count.
 */
async function textContrast(page, node) {
  const text = element(page, node);
  const box = await text.boundingBox();
  const clip = {
    x: Math.floor(box.x),
    y: Math.floor(box.y),
    width: Math.ceil(box.x + box.width) - Math.floor(box.x),
    height: Math.ceil(box.y + box.height) - Math.floor(box.y),
  };
  const shot = () =>
    page.screenshot({
      clip,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
  const color = await text.evaluate(
    (element) => getComputedStyle(element).color,
  );
  const shown = await shot();
  await text.evaluate((element) => {
    element.dataset.contrastProbe = element.style.cssText;
    element.style.setProperty("color", "transparent", "important");
    element.style.setProperty(
      "-webkit-text-fill-color",
      "transparent",
      "important",
    );
  });
  const hidden = await shot();
  await text.evaluate((element) => {
    element.style.cssText = element.dataset.contrastProbe;
    delete element.dataset.contrastProbe;
  });
  return page.evaluate(
    async ({ shown, hidden, color }) => {
      const pixels = async (png) => {
        const image = new Image();
        image.src = "data:image/png;base64," + png;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const canvas = new OffscreenCanvas(1, 1).getContext("2d");
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
      const luminance = (channels) =>
        channels
          .map((value) => value / 255)
          .map((value) =>
            value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
          )
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const [withText, without] = await Promise.all([
        pixels(shown),
        pixels(hidden),
      ]);
      let lowest = Infinity;
      for (let i = 0; i < withText.length; i += 4) {
        if (
          [0, 1, 2].every(
            (channel) =>
              Math.abs(withText[i + channel] - without[i + channel]) < 32,
          )
        )
          continue;
        const background = [without[i], without[i + 1], without[i + 2]];
        const foreground = [r, g, b].map(
          (value, channel) =>
            (value * a + background[channel] * (255 - a)) / 255,
        );
        const [light, dark] = [
          luminance(foreground),
          luminance(background),
        ].sort((x, y) => y - x);
        lowest = Math.min(lowest, (light + 0.05) / (dark + 0.05));
      }
      return lowest === Infinity ? null : Math.floor(lowest * 100) / 100;
    },
    {
      shown: shown.toString("base64"),
      hidden: hidden.toString("base64"),
      color,
    },
  );
}

/** How each rule's undecided result is measured, as the settled list records it. */
const measures = {
  "color-contrast": async (page, node) => {
    const ratio = await textContrast(page, node);
    if (ratio === null) return "covered";
    const required = parseFloat(node.any[0].data.expectedContrastRatio);
    expect(
      ratio,
      `${normalized(node)} measures below ${required}:1`,
    ).toBeGreaterThanOrEqual(required);
    return `${ratio.toFixed(2)}:1`;
  },
  // A target is measured by its size. One under 24 px would need its spacing measured instead.
  "target-size": async (page, node) => {
    const box = await element(page, node).boundingBox();
    expect(
      Math.min(box.width, box.height),
      `${normalized(node)} is under 24 px`,
    ).toBeGreaterThanOrEqual(24);
    return `${Math.round(box.width)} × ${Math.round(box.height)} px`;
  },
  "aria-valid-attr-value": (page, node) =>
    element(page, node).evaluate((control) =>
      control
        .getAttribute("aria-controls")
        .split(/\s+/)
        .map((id) => {
          const target = document.getElementById(id);
          return target
            ? `${target.getAttribute("role") ?? target.localName} #${id}`
            : `missing #${id}`;
        })
        .join(", "),
    ),
};

/** Text a popup lies over entirely, so that none of it shows and no contrast can be seen. */
const covered = (target, text, states, popup) => ({
  rule: "color-contrast",
  target,
  text,
  states,
  measured: "covered",
  reason: `${popup} lies over all of it, and the popup is opaque.`,
});
const typeFilterStates = [
  "type filter",
  "hovered checkbox",
  "focused checkbox",
];
const filters = [...typeFilterStates, "date filter"];
const newMenu = "The open New menu";
const datePopover = "The open date filter";
/** A popup button's `aria-controls`, which axe asks to have checked against the popup. */
const popupButton = (label, popup, states) => ({
  rule: "aria-valid-attr-value",
  target: `button[aria-label="${label}"]`,
  text: label,
  states,
  measured: `dialog #resource-filters-0-${popup}`,
  reason: `axe cannot tell whether a popup button's aria-controls names its popup. The ${label} chip names its open dialog.`,
});

/**
 * Results axe could not decide, each settled by a measurement this spec repeats. axe gives up on
 * text an open menu or popover lies over, on text it cannot see whole behind its background, and on
 * a control whose background draws its icon, and it asks for review of a popup button that names
 * its popup. A state that leaves a result undecided which is not listed here fails, and so does an
 * entry none of its states produces, so the list says exactly what the gate has settled.
 */
const settled = [
  // Text an open menu or popover lies over. Each popup is opaque, so only what shows is measured.
  {
    rule: "color-contrast",
    target: "p",
    text: "Select an item to see its details",
    states: ["user menu", "actions menu"],
    measured: "6.54:1",
    reason:
      "An open header menu lies over part of the Information panel's empty-state line. What shows meets 4.5:1 against the panel.",
  },
  covered(".active", "Home", ["new menu"], newMenu),
  covered(
    '.destinations > a[routerlink="/dashboard"]:nth-child(2)',
    "Shared with Me",
    ["new menu"],
    newMenu,
  ),
  covered(
    'a[routerlink="/dashboard"]:nth-child(3)',
    "Shared with Everyone",
    ["new menu"],
    newMenu,
  ),
  covered(
    'a[routerlink="/dashboard"]:nth-child(4)',
    "Community Folders",
    ["new menu"],
    newMenu,
  ),
  covered(
    'th[aria-sort="ascending"] > button',
    "Name",
    filters,
    "An open filter popover",
  ),
  covered(
    "#resource-name-0",
    "Study metadata",
    filters,
    "An open filter popover",
  ),
  covered(
    'th[aria-sort="none"] > button',
    "Last modified",
    ["date filter"],
    datePopover,
  ),
  covered(".column-label", "Version", ["date filter"], datePopover),
  covered("time", "1 day ago", ["date filter"], datePopover),
  covered("td:nth-child(3) > span", "·", ["date filter"], datePopover),
  covered(
    ".paging > span:nth-child(2)",
    "Displaying 1–1 of 1",
    ["date filter"],
    datePopover,
  ),
  {
    rule: "color-contrast",
    target: "td:nth-child(3)",
    text: "1.0.0 · Draft",
    states: ["date filter"],
    measured: "14.45:1",
    reason:
      "The open date filter lies over part of the row's version. What shows meets 4.5:1 against the row.",
  },
  // Text axe cannot see whole behind its background.
  {
    rule: "color-contrast",
    target: "section:nth-child(2) > p",
    text: "Choose one user or group",
    states: ["permissions"],
    measured: "7.45:1",
    reason:
      "The Permissions dialog's body can scroll, and axe cannot tell whether the dialog's surface lies under all of this paragraph. Nothing lies over it, and it meets 4.5:1 against the dialog.",
  },
  {
    rule: "color-contrast",
    target: "span",
    text: "Make Sam Curator the owner",
    states: ["owner confirmation"],
    measured: "16.10:1",
    reason:
      "The ownership confirmation can scroll, and axe cannot tell whether its surface lies under all of its question. Nothing lies over it, and it meets 4.5:1 against the confirmation.",
  },
  // A control whose background draws its icon.
  {
    rule: "color-contrast",
    target: 'select[aria-label="Role for Sam Curator"]',
    text: "Viewer",
    states: ["permissions"],
    measured: "16.10:1",
    reason:
      "The role select draws its chevron with gradients in its right padding. Measured where its glyphs are, its text meets 4.5:1 against the select.",
  },
  // A popup button that names its popup.
  popupButton("Type", "type", typeFilterStates),
  popupButton("Last modified", "date", ["date filter"]),
];

/** Fail on any undecided result `state` leaves that the settled list does not name, and measure the rest. */
async function settle(page, state, undecided) {
  const found = [];
  for (const { rule, node } of undecided)
    found.push({
      rule,
      node,
      target: normalized(node),
      text: ((await element(page, node).textContent()) ?? "").trim(),
    });
  const named = (entry, result) =>
    entry.rule === result.rule &&
    entry.target === result.target &&
    result.text.startsWith(entry.text);
  const expected = settled.filter((entry) => entry.states.includes(state));
  const unlisted = [];
  for (const result of found) {
    const entry = expected.find((entry) => named(entry, result));
    const measured = measures[result.rule]
      ? await measures[result.rule](page, result.node)
      : "no measure";
    if (entry)
      expect(measured, `${entry.target} “${entry.text}”`).toBe(entry.measured);
    else
      unlisted.push(
        `${result.rule} ${result.target} “${result.text.slice(0, 40)}” measures ${measured}`,
      );
  }
  expect(unlisted, "undecided results the settled list does not name").toEqual(
    [],
  );
  const unproduced = expected.filter(
    (entry) => !found.some((result) => named(entry, result)),
  );
  expect(
    unproduced.map((entry) => `${entry.rule} ${entry.target} “${entry.text}”`),
    `settled entries ${state} no longer produces`,
  ).toEqual([]);
}

for (const [name, state] of Object.entries(states))
  test(`accessible ${name}`, async ({ page, api }) => {
    const exclude = (await state(page)) ?? [];
    const { violations, undecided } = await audit(page, exclude);
    expect(violations).toEqual([]);
    await settle(page, name, undecided);
  });

test("nested confirmation and permission toast remain accessible and operable", async ({
  page,
  api,
}) => {
  await dashboard(page);
  await action(page, "Permissions…");
  const owner = page.getByRole("checkbox", {
    name: "Make Sam Curator the owner",
  });
  await owner.click();
  await expect(page.locator(".confirmation-dialog")).toBeVisible();
  const { violations, undecided } = await audit(page);
  expect(violations).toEqual([]);
  await settle(page, "owner confirmation", undecided);
  await page.keyboard.press("Escape");
  await expect(page.locator(".confirmation-dialog")).toHaveCount(0);
  await expect(owner).toBeFocused();
  await page
    .getByRole("combobox", { name: "Role for Sam Curator" })
    .selectOption("editor");
  await expect(page.locator("dialog[open] .toast")).toContainText(
    "Permissions saved.",
  );
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeEnabled();
});
