import {
  test,
  expect,
  dashboard,
  resource,
  capabilities,
} from "./fixtures.mjs";

for (const readonly of [false, true]) {
  test(`information copy controls and description ${readonly ? "readonly" : "editable"}`, async ({
    page,
    api,
  }) => {
    api.readonly = readonly;
    const selected = {
      ...resource,
      pathInfo: [{ "@id": "home", "schema:name": "Home" }, resource],
      isBasedOn: {
        ...resource,
        "@id": "source-template",
        "schema:name": "Source template",
      },
      currentUserPermissions: {
        capabilities: readonly ? ["readResource"] : capabilities,
      },
    };
    await page.route("**/templates/template/report", (route) =>
      route.fulfill({ json: selected }),
    );
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (value) => {
            window.copiedId = value;
          },
        },
      });
    });
    await dashboard(page);
    await expect(
      page.getByText("Select an item to see its details", { exact: true }),
    ).toBeVisible();
    await page.locator("tbody tr").first().press("Enter");
    const info = page.getByRole("complementary", {
      name: "Resource information",
    });
    await expect(
      info.getByRole("link", { name: "Source template", exact: true }),
    ).toHaveAttribute("href", /source-template/);
    await info
      .getByRole("button", { name: "Copy folder location", exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => window.copiedId)).toBe("home");
    await info
      .getByRole("button", { name: "Copy template identifier", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.copiedId))
      .toBe("source-template");
    await expect(
      info.locator(".identifiers details, .identifiers summary"),
    ).toHaveCount(0);
    await info
      .getByRole("button", { name: "Copy identifier", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.copiedId))
      .toBe("template");
    const locationCenters = await info.evaluate((panel) => {
      const label = panel.querySelector(".location-label");
      const value = label.nextElementSibling.querySelector("span");
      return [label, value].map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const bounds = range.getBoundingClientRect();
        return bounds.y + bounds.height / 2;
      });
    });
    expect(Math.abs(locationCenters[0] - locationCenters[1])).toBeLessThan(2);
    if (process.env.WORKSPACE_VISUAL && !readonly)
      await expect(info).toHaveScreenshot("information-details.png");
    const edit = info.getByRole("button", {
      name: "Edit description",
      exact: true,
    });
    if (readonly) await expect(edit).toHaveCount(0);
    else {
      await edit.click();
      await page
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Updated description");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(() =>
          api.requests.find((r) => r.path.endsWith("/command/rename-resource")),
        )
        .toMatchObject({
          method: "POST",
          revision: '"fixture-revision"',
          body: {
            "@id": "template",
            "schema:name": "Study metadata",
            "schema:description": "Updated description",
          },
        });
    }
  });
}
