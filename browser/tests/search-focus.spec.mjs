import { comparePixels } from "./browser-tags.mjs";
import { test, expect, dashboard } from "./fixtures.mjs";

for (const width of [1440, 375]) {
  test(`search focus follows the rounded container at ${width}`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await dashboard(page);
    const search = page.locator("form.search");
    const input = page.getByRole("textbox", {
      name: "Search workspace",
      exact: true,
    });
    await input.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(search).toHaveCSS("outline-style", "solid");
    await expect(search).toHaveCSS("border-radius", "9999px");
    await expect(search.locator('input')).toHaveAttribute('autocomplete', 'off');
    await expect(search.locator('input')).toHaveAttribute('autocorrect', 'off');
    await expect(search.locator('input')).toHaveAttribute('spellcheck', 'false');
    if (comparePixels())
      await expect(page.locator(".topbar")).toHaveScreenshot(
        `search-focused-${width}.png`,
      );
    await page.keyboard.press("Tab");
    await expect(
      search.getByRole("button", { name: "Search", exact: true }),
    ).toBeFocused();
    await expect(search).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Tab");
    await expect(search).toHaveCSS("outline-style", "none");
  });
}

// Below 357 px the search takes a row of its own beneath the top bar's other controls.
test("the search holds its placeholder at 320 and shares the controls' row at 1440", async ({
  page,
  api,
}) => {
  const search = page.locator("header.topbar form.search");
  const input = search.getByRole("textbox", {
    name: "Search workspace",
    exact: true,
  });
  const menu = page.locator("header.topbar summary").first();
  const brand = page.locator("header.topbar .brand");
  await page.setViewportSize({ width: 320, height: 800 });
  await dashboard(page);
  // The placeholder's width in its own font, against the input's width inside its padding.
  const { needed, available } = await input.evaluate((box) => {
    const own = getComputedStyle(box, "::placeholder");
    const line = document.createElement("span");
    for (const property of [
      "font-family",
      "font-size",
      "font-style",
      "font-weight",
      "letter-spacing",
    ])
      line.style.setProperty(property, own.getPropertyValue(property));
    line.style.whiteSpace = "pre";
    line.style.position = "absolute";
    line.style.visibility = "hidden";
    line.textContent = box.placeholder;
    box.parentNode.appendChild(line);
    const width = line.getBoundingClientRect().width;
    line.remove();
    const frame = getComputedStyle(box);
    return {
      needed: width,
      available:
        box.clientWidth -
        parseFloat(frame.paddingLeft) -
        parseFloat(frame.paddingRight),
    };
  });
  expect(available).toBeGreaterThanOrEqual(needed);
  const above = await menu.boundingBox();
  expect((await search.boundingBox()).y).toBeGreaterThanOrEqual(
    above.y + above.height,
  );
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 800 });
  const centre = async (locator) => {
    const box = await locator.boundingBox();
    return box.y + box.height / 2;
  };
  const row = await centre(search);
  expect(Math.abs(row - (await centre(brand)))).toBeLessThanOrEqual(1);
  expect(Math.abs(row - (await centre(menu)))).toBeLessThanOrEqual(1);
});
