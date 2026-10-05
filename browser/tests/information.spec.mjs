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
    browserName,
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
    await expect(info.getByRole("tab").first()).toHaveText("Details");
    const titleTop = (await info.locator("h1").boundingBox()).y;
    for (const selector of [".table-toolbar", "#button-create"]) {
      const rowTop = (await page.locator(selector).boundingBox()).y;
      expect(Math.abs(titleTop - rowTop), "Info title aligns with neighbouring top rows").toBeLessThanOrEqual(1);
    }
    await expect(
      info.getByRole("link", { name: "Source template · 1.0.0 · Draft", exact: true }),
    ).toHaveAttribute("href", /source-template/);
    const folderCopy = info.getByRole("button", {
      name: "Copy location", exact: true,
    });
    await folderCopy.hover();
    const help = info.getByRole("tooltip");
    await expect(help).toHaveText("Copy location");
    await help.hover();
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await info.locator("h1").hover();
    await page.keyboard.press("Tab");
    await folderCopy.focus();
    await expect(help).toHaveText("Copy location");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await info
      .getByRole("button", { name: "Copy location", exact: true })
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
    await info.locator("h1").hover();
    if (process.env.WORKSPACE_VISUAL && !readonly && browserName === "chromium")
      await expect(info).toHaveScreenshot("information-details.png");
    const edit = info.getByRole("textbox", {
      name: "Description",
      exact: true,
    });
    await expect(info.locator(".info-section").last().locator("cedar-description-editor")).toHaveCount(1);
    if (readonly) await expect(edit).toHaveCount(0);
    else {
      await expect(edit).toHaveCSS("resize", "vertical");
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

test("description fits its content up to eight lines and shrinks after editing", async ({page, api}) => {
  const text = Array.from({length: 5}, (_, i) => `Description line ${i + 1}`).join('\n');
  await page.route('**/templates/template', route => route.fulfill({
    json: {...resource, 'schema:description': text},
    headers: {etag: '"fixture-revision"'},
  }));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const edit = page.getByRole('textbox', {name: 'Description', exact: true});
  await expect(edit).toHaveValue(text);
  const size = () => edit.evaluate(el => {
    const style = getComputedStyle(el);
    const inset = style.boxSizing === 'content-box'
      ? ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
          .reduce((sum, key) => sum + parseFloat(style[key]), 0)
      : 0;
    return {
      height: el.getBoundingClientRect().height,
      scroll: el.scrollHeight,
      client: el.clientHeight,
      min: parseFloat(style.minHeight) + inset,
      max: parseFloat(style.maxHeight) + inset,
    };
  });
  await expect.poll(async () => (await size()).height).toBeGreaterThan((await size()).min);
  expect((await size()).scroll).toBeLessThanOrEqual((await size()).client + 1);
  await edit.fill(Array.from({length: 12}, () => 'A line').join('\n'));
  await expect.poll(async () => (await size()).height).toBeCloseTo((await size()).max, 0);
  expect((await size()).scroll).toBeGreaterThan((await size()).client);
  await edit.fill('Short description');
  await expect.poll(async () => (await size()).height).toBeCloseTo((await size()).min, 0);
  await edit.fill('Words that wrap across the description panel. '.repeat(12));
  await expect.poll(async () => (await size()).height).toBeCloseTo((await size()).max, 0);
});

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
  const published = {...resource, 'pav:version':'1.2.0', 'bibo:status':'bibo:published'};
  await page.route('**/templates/template/report', route => route.fulfill({json: {...published, numberOfInstances: 1, versions: [published]}}));
  await page.route('**/search?is_based_on=*', route => route.fulfill({json: {resources: [{...resource, '@id':'instance-id', resourceType:'instance'}], totalCount: 1}}));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.copiedId = value; }}}));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name:'Resource information'});
  await expect(info.getByText('Instances', {exact:true})).toBeVisible();
  await expect(info.locator('.no-instances')).toHaveCount(0);
  await info.getByRole('button', {name:'Copy identifier for Study metadata', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.copiedId)).toBe('instance-id');
  await info.getByRole('tab', {name:'Version', exact:true}).click();
  await expect(info.locator('.version dt')).toHaveText(['Type', 'Version', 'Status']);
  await expect(info.locator('.version dd')).toHaveText(['Template', '1.2.0', 'Published · Latest version']);
  // The latest version has no newer one to name.
  await expect(info.locator('.latest-version, .next-version')).toHaveCount(0);
  await expect(info.locator('.version a')).toHaveCount(0);
  await expect(info.locator('.version')).not.toContainText('Modified');
  // A template with no older version lists none.
  await expect(info.getByText('Previous versions', {exact:true})).toHaveCount(0);
});

test("a template with no instances says so under the Instances heading", async ({page, api}) => {
  await page.route('**/templates/template/report', route => route.fulfill({json: {...resource, numberOfInstances: 0}}));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name:'Resource information'});
  const section = info.locator('.instances-section');
  await expect(section.locator('.description-heading')).toHaveText('Instances');
  await expect(section.locator('.no-instances')).toHaveText('No instances');
  const [heading, text] = await Promise.all([section.locator('.description-heading'), section.locator('.no-instances')].map(l => l.boundingBox()));
  expect(text.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  await expect(section.locator('.instance-list, .instance-count')).toHaveCount(0);
  // It reads as the description's placeholder does.
  const look = (el, pseudo) => { const style = getComputedStyle(el, pseudo); return [style.color, style.fontWeight, style.fontSize]; };
  const placeholder = await info.getByRole('textbox', {name: 'Description', exact: true}).evaluate(el => {
    const style = getComputedStyle(el, '::placeholder'); return [style.color, style.fontWeight, style.fontSize];
  });
  expect(await section.locator('.no-instances').evaluate(look)).toEqual(placeholder);
});

test("a read-only empty description reads as the editable one's placeholder", async ({page, api}) => {
  api.readonly = true;
  await page.route('**/templates/template/report', route => route.fulfill({json: {...resource, 'schema:description': '',
    numberOfInstances: 0, currentUserPermissions: {capabilities: ['readResource']}}}));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name:'Resource information'});
  const empty = info.locator('.no-description');
  await expect(empty).toHaveText('No description');
  const look = el => { const style = getComputedStyle(el); return [style.color, style.fontWeight]; };
  expect(await empty.evaluate(look)).toEqual(await info.locator('.no-instances').evaluate(look));
});

test("a template whose instances the user cannot read says none is accessible, once the search answers", async ({page, api}) => {
  await page.route('**/templates/template/report', route => route.fulfill({json: {...resource, numberOfInstances: 3}}));
  let answer;
  const answered = new Promise(resolve => { answer = resolve; });
  await page.route('**/search?is_based_on=*', async route => {
    await answered;
    await route.fulfill({json: {resources: [], totalCount: 0}});
  });
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const section = page.getByRole('complementary', {name:'Resource information'}).locator('.instances-section');
  await expect(section.locator('.description-heading')).toHaveText('Instances');
  // Nothing is claimed while the search is still out.
  await expect(section.locator('.no-instances')).toHaveCount(0);
  answer();
  await expect(section.locator('.no-instances')).toHaveText('No accessible instances');
  await expect(section.locator('.instance-list, .instance-count')).toHaveCount(0);
});

for (const [title, report, status] of [
  ['marks the only version of a draft as latest', {versions: [{...resource}]}, 'Draft · Latest version'],
  // Without a version history, the report's own flag decides.
  ['leaves unmarked a version the report flags as not latest', {isLatestVersion: false}, 'Draft'],
]) test(`the Status line ${title}`, async ({page, api}) => {
  await page.route('**/templates/template/report', route => route.fulfill({json: {...resource, ...report}}));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name:'Resource information'});
  await info.getByRole('tab', {name:'Version', exact:true}).click();
  await expect(info.locator('.version dd')).toHaveText(['Template', '1.0.0', status]);
});

test("derived-from and previous versions link to their artifacts beside copy controls", async ({page, api}) => {
  const version = (id, number, extra = {}) => ({...resource, '@id': id, 'pav:version': number, 'bibo:status': 'bibo:published', ...extra});
  await page.route('**/templates/template/report', route => route.fulfill({json: {
    ...version('template', '2.0.0'),
    isOpen: true,
    everybodyPermission: 'read',
    derivedFrom: {...resource, '@id': 'source', 'schema:name': 'Source template'},
    // Newest first, and including the template itself.
    versions: [
      version('newer', '3.0.0'),
      version('template', '2.0.0'),
      version('older', '1.0.0', {'schema:name': 'Study metadata, first edition'}),
      {'@id': 'hidden', resourceType: 'template', 'pav:version': '0.9.0', activeUserCanRead: false},
    ],
  }}));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.copiedId = value; }}}));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name:'Resource information'});

  const source = info.getByRole('link', {name: 'Source template', exact: true});
  await expect(info.getByText('Derived from', {exact: true})).toBeVisible();
  await expect(source).toHaveAttribute('href', /\/templates\/edit\/source\?/);
  await info.getByRole('button', {name: 'Copy identifier for Source template', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.copiedId)).toBe('source');

  // The artifact is in OpenView, so its public link follows the Identifier and can be copied.
  const openView = info.locator('.open-view');
  await expect(info.locator('.identifiers + .open-view')).toHaveCount(1);
  await expect(openView.locator('.description-heading')).toHaveText('OpenView');
  const publicLink = openView.getByRole('link');
  await expect(publicLink).toHaveAttribute('href', /\/templates\/template$/);
  await expect(publicLink).toHaveAttribute('target', '_blank');
  await expect(publicLink).toHaveText(await publicLink.getAttribute('href'));
  await openView.getByRole('button', {name: 'Copy OpenView link', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.copiedId)).toMatch(/\/templates\/template$/);
  await expect(page.getByText('Link copied.', {exact: true})).toBeVisible();
  // It reads as the Identifier does.
  const look = el => { const style = getComputedStyle(el); return [style.fontSize, style.color]; };
  expect(await publicLink.evaluate(look)).toEqual(await info.locator('.identifiers a').evaluate(look));

  // The latest version is named on the Version tab, not here.
  await expect(info.locator('.latest-version')).toHaveCount(0);

  // Shared with everyone, which the user's own role does not say.
  await expect(info.locator('dd').filter({hasText: 'Owner'}).locator('small')).toHaveText('Everyone can view');

  await info.getByRole('tab', {name: 'Version', exact: true}).click();
  // The tab describes the selected version alone, which is not the latest.
  await expect(info.locator('.version')).toHaveCount(1);
  await expect(info.locator('.version dd')).toHaveText(['Template', '2.0.0', 'Published']);
  // A newer version is named with its version and status, all three linked.
  const latest = info.locator('.latest-version');
  await expect(latest.locator('.description-heading')).toHaveText('Latest version');
  // The next version is named even when it is also the latest.
  await expect(info.locator('.next-version').getByRole('link')).toHaveText('Study metadata · 3.0.0 · Published');
  await expect(latest.getByRole('link')).toHaveText('Study metadata · 3.0.0 · Published');
  await expect(latest.getByRole('link')).toHaveAttribute('href', /\/templates\/edit\/newer\?/);
  await latest.getByRole('button', {name: 'Copy identifier for Study metadata', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.copiedId)).toBe('newer');
  // Previous versions read the same way.
  const previous = info.locator('.previous-versions');
  await expect(previous.locator('.description-heading')).toHaveText('Previous versions');
  await expect(previous.locator('.detail-with-copy > :first-child')).toHaveText([
    'Study metadata, first edition · 1.0.0 · Published',
    'A version you cannot open · 0.9.0',
  ]);
  // A version the user cannot open is not linked.
  await expect(previous.getByRole('link')).toHaveText(['Study metadata, first edition · 1.0.0 · Published']);
  await expect(previous.getByRole('link')).toHaveAttribute('href', /\/templates\/edit\/older\?/);
  await previous.getByRole('button', {name: 'Copy identifier for Study metadata, first edition', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.copiedId)).toBe('older');
});

test("a version two behind the latest names its next version between the latest and the previous ones", async ({page, api}) => {
  const version = (id, number, extra = {}) => ({...resource, '@id': id, 'pav:version': number, 'bibo:status': 'bibo:published', ...extra});
  await page.route('**/templates/template/report', route => route.fulfill({json: {
    ...version('template', '2.0.0'),
    versions: [
      version('latest', '4.0.0', {'bibo:status': 'bibo:draft'}),
      version('next', '3.0.0', {'schema:name': 'Study metadata, third edition'}),
      version('template', '2.0.0'),
      version('older', '1.0.0'),
    ],
  }}));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.copiedId = value; }}}));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const info = page.getByRole('complementary', {name: 'Resource information'});
  await info.getByRole('tab', {name: 'Version', exact: true}).click();
  await expect(info.locator('.latest-version').getByRole('link')).toHaveText('Study metadata · 4.0.0 · Draft');
  const next = info.locator('.next-version');
  await expect(next.locator('.description-heading')).toHaveText('Next version');
  await expect(next.getByRole('link')).toHaveText('Study metadata, third edition · 3.0.0 · Published');
  await expect(next.getByRole('link')).toHaveAttribute('href', /\/templates\/edit\/next\?/);
  await next.getByRole('button', {name: 'Copy identifier for Study metadata, third edition', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.copiedId)).toBe('next');
  await expect(info.locator('.previous-versions').getByRole('link')).toHaveText(['Study metadata · 1.0.0 · Published']);
  // Latest, next, then previous, as the history runs.
  const order = await info.locator('.latest-version, .next-version, .previous-versions').evaluateAll(sections => sections.map(s => s.className));
  expect(order.map(name => name.split(' ').at(-1))).toEqual(['latest-version', 'next-version', 'previous-versions']);
});

test("an instance names its template with the template's version and status, all three linked", async ({page, api}) => {
  const instance = {...resource, '@id': 'instance', resourceType: 'instance', 'schema:name': 'Study record'};
  await page.route(/\/folders\/[^/]+\/contents/, route => route.fulfill({json: {resources: [resource, instance], totalCount: 2, pathInfo: []}}));
  await page.route(/\/template-instances\/instance\/report/, route => route.fulfill({json: {
    ...instance,
    isBasedOn: {...resource, 'pav:version': '0.0.1', 'bibo:status': 'bibo:draft'},
  }}));
  await dashboard(page);
  await page.locator('tbody tr', {hasText: 'Study record'}).press('Enter');
  const info = page.getByRole('complementary', {name: 'Resource information'});
  const template = info.locator('.info-section').filter({hasText: 'Template'}).locator('.detail-with-copy');
  await expect(template.getByRole('link')).toHaveText('Study metadata · 0.0.1 · Draft');
  await expect(template.getByRole('link')).toHaveAttribute('href', /\/templates\/edit\/template\?/);
  // Nothing is shared with everyone, and no newer version or OpenView link is claimed.
  await expect(info.locator('dd small')).not.toContainText(['Everyone']);
  await expect(info.locator('.latest-version, .open-view')).toHaveCount(0);
});

test("first instance copy help escapes the scrolling list and dismisses on scroll", async ({ page, api }) => {
  const instances = Array.from({ length: 12 }, (_, i) => ({
    ...resource,
    '@id': `instance-${i}`,
    resourceType: 'instance',
    'schema:name': `Long study metadata instance name that wraps onto another line ${i + 1}`,
  }));
  await page.route('**/templates/template/report', route => route.fulfill({
    json: { ...resource, numberOfInstances: instances.length },
  }));
  await page.route('**/search?is_based_on=*', route => route.fulfill({
    json: { resources: instances, totalCount: instances.length },
  }));
  await dashboard(page);
  await page.locator('tbody tr').first().press('Enter');
  const list = page.locator('.instance-list');
  const first = list.getByRole('button').first();
  await first.hover();
  const help = page.getByRole('tooltip');
  await expect(help).toHaveText('Copy instance identifier');
  expect((await help.boundingBox()).y).toBeLessThan((await list.boundingBox()).y);
  // A visible DOM box can still be clipped; hit-test its painted text above the list.
  expect(await help.evaluate(el => {
    const box = el.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
  })).toBe(true);
  await help.hover();
  await expect(help).toBeVisible();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(help).toHaveCount(0);
  await list.getByRole('button').last().hover();
  await expect(help).toHaveText('Copy instance identifier');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
});
