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
    await expect(info.locator('.identifiers a')).toHaveAttribute('href', /templates\/edit\/template/);
    await expect(info.locator('.identifiers a')).toHaveText('template');
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
    const edit = info.getByRole("textbox", {
      name: "Description",
      exact: true,
    });
    if (readonly) await expect(edit).toHaveCount(0);
    else {
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

test("inline description keeps edits on conflict and cancel reloads the current revision", async ({page, api}) => {
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name: 'Resource information'});
  const description = info.getByRole('textbox', {name: 'Description', exact: true});
  await expect(description).toBeEnabled();
  await description.fill('Unsaved description');
  await page.route('**/command/rename-resource', route => route.fulfill({status: 412, json: {message: 'Changed'}}));
  await info.getByRole('button', {name:'Save', exact:true}).click();
  await expect(info.getByRole('alert')).toContainText('changed since you opened');
  await expect(description).toHaveValue('Unsaved description');
  await info.getByRole('button', {name:'Cancel', exact:true}).click();
  await expect(description).toHaveValue(resource['schema:description'] || '');
  await expect(info.getByRole('alert')).toHaveCount(0);
});

test("version details and instances have concise labels and identifier copy controls", async ({page, api}) => {
  await page.route('**/templates/template/report', route => route.fulfill({json: {...resource, numberOfInstances: 1, versions: [{...resource, 'pav:version':'1.2.0', 'bibo:status':'bibo:published'}]}}));
  await page.route('**/search?is_based_on=*', route => route.fulfill({json: {resources: [{...resource, '@id':'instance-id', resourceType:'instance'}], totalCount: 1}}));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.copiedId = value; }}}));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name:'Resource information'});
  await expect(info.getByText('Instances', {exact:true})).toBeVisible();
  await info.getByRole('button', {name:'Copy identifier for Study metadata', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.copiedId)).toBe('instance-id');
  await info.getByRole('tab', {name:'Version', exact:true}).click();
  await expect(info.locator('.version dd')).toHaveText(['1.2.0', 'Published']);
  await expect(info.locator('.version')).not.toContainText('Modified');
});
