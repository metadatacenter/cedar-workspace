# cedar-workspace

CEDAR's split Workspace frontend. `/` and `/dashboard` run a standalone Angular
22 application with Angular routing, signals, forms and shared CEDAR design tokens.
Workspace provides list and compact grid views, search, folder navigation, collapsible
side panels, Details/Version tabs, Type and Last modified filters, version filtering,
and resource action dialogs.

Template, element and field authoring opens the configured CED/CEFD Designer host;
metadata creation/editing opens the standalone Angular CEE host at
`/instances/create/:templateId` and `/instances/edit/:id`.

The four account routes are also Angular: Profile provides account details and masked
API-key management; Settings saves the date format used by Workspace; Groups manages
details and membership with separate revision tokens. Its Delete group tab reviews
saved details and confirms deletion; Manage and Create keep group deletion out of
their editing controls. Privacy retains the existing
policy wording. No AngularJS runtime or styles load on any of these routes.
Messaging has been removed; its old URL returns to Workspace.
Logout also runs in Angular and does not depend on the profile service.
All routes now use the Angular application. The AngularJS shell, Bower vendors, old
icon fonts, RequireJS and obsolete build/test packages are removed. The retained
Keycloak adapter and bundle are plain JavaScript used by Angular.
The combined `cedar-template-editor` application is unchanged.

## Listing filters

`ResourceFilters` is a standalone, router-independent toolbar; its `value` input and
`change` output use `ListingFilters`. `FilterChip` provides the reusable selected
chip and clear action. Both use the shared design tokens and icon registry.
Type accepts any combination of Folder, Element, Template, Field and Instance.
Each popover edits a draft until Apply; Cancel, Escape and clicking outside discard it.

Workspace stores applied filters in URL query parameters and resets the page when
filters change. The date presets count local calendar days (Last 7 days includes
today and the preceding six days). Custom After and Before dates are inclusive;
either may be blank. The range controls use native date inputs and do not load CEE.

`listing-filters.ts` translates dates to `modified_after` (inclusive) and
`modified_before` (exclusive) epoch-millisecond bounds. The Resource Server applies
them together with `resource_types` before counting and paginating folder, shared,
community and indexed search results. It requires the matching server/library changes;
an older Resource Server does not implement these date parameters.

The sort menu above the row actions offers Name, Last modified and Date created,
with ascending/descending order and optional folders on top. Its state is shared
with the column headers and stored in the URL; changing it resets pagination.
Folders remain mixed by default. Folder grouping uses the server's compound
`sort=foldersFirst,<field>` order before pagination, including search and shared
views, and requires the corresponding microservice-library support.

## Grid selection and moves

The result toolbar switches between the existing list and 106px-high grid cards.
Both views use the same server-sorted, filtered page and keep selection when switching.
Click selects; Shift-click and Shift+arrows extend a range; Cmd/Ctrl-click toggles;
Cmd/Ctrl+A selects the current page. Dragging blank space selects a rectangle.
Grid cards select on click and open on double-click or Enter, including when the
double-click lands on the icon, version, date or blank card space. Embedded action
buttons retain their own behavior. List links retain single-click navigation and
row Enter retains selection.

Drag selected items onto a folder or breadcrumb, use Move to choose a destination,
or Cut and Paste (also Cmd/Ctrl+X and Cmd/Ctrl+V). Moves recheck server permissions
and obtain each resource's ETag before writing. The server remains authoritative.
Group moves are individual conditional requests: partial failures are named, successful
items are refreshed, and failed items can be explicitly retried. Selected descendants
travel with selected ancestors; cycles are rejected. Selection clears when the listing
changes, so operations cannot accidentally include a hidden page.

Angular CDK 22.2.0 and Selecto 1.26.3 are MIT licensed. CDK provides dragging and
Selecto supplies marquee geometry; no commercial file-manager dependency is used.
The isolated `experiments/` prototype is not part of the production build.

## Languages

Workspace is available in English and Hungarian. It shows the first language in
the browser's `navigator.languages` whose primary subtag is `en` or `hu`, and
English otherwise; English is also the fallback for any missing string. Every
user-visible string lives in `src/assets/i18n/en.json` and `hu.json`, which
`@ngx-translate/core` reads from the bundle, so no language map is fetched at run
time. The metadata editor passes the active language to CEE as its
`defaultLanguage`, with English as `fallbackLanguage`. Dates use `hu-HU` in
Hungarian; in English each date keeps the locale it used before localization.

`npm test` enforces this. `translations.spec.ts` checks that both maps declare the
same keys and parameters, that keys are ASCII, and that no Hungarian value repeats
the English unless it is listed as legitimately identical.
`tools/i18n-guard.test.mjs` fails when a template or a user-facing TypeScript call
states literal text instead of a translation key; its deliberate exceptions, each
with a reason, are in `tools/i18n-allowlist.json`.

## Local development

Use Node 24.19.0. Start the managed app with `cedarcli native start frontend workspace`.
For direct npm commands, export `CEDAR_HOME` and `CEDAR_PROFILE=develop`, then source
`cedar-development/bin/templates/cedar-profile-native.sh`:

```sh
cd "$CEDAR_HOME/cedar-workspace"
npm ci
npm run build
npm test
```

Gulp finishes configuration, CEE staging and the Angular build before starting the
port-4201 server or completing a server payload. After editing `src/`, run `npm run build` and reload. Assets are built outside
the served tree, copied first, and the generated index is replaced last; a failed
build preserves the last working app. Shared Keycloak/configuration files remain at
their existing URLs. The root entry loads Angular for every route. Unknown and retired routes return to
`/dashboard`; no RequireJS or AngularJS bootstrap remains.

The metadata host loads the staged CEE bundle on demand, configures permissions
before rendering, and keeps the same editor mounted across create/update saves.
Content ETags protect updates; conflicts and deleted resources retain local edits.
Validation remains advisory. Dirty tracking recognizes exact reverts, guards
navigation and includes changes made while a save is pending. Return links are
restricted to the same-origin workspace. The former AngularJS controllers, services, dialogs, filters and templates are removed.

`npm test` covers the modern Angular components, navigation, permission decisions,
REST authentication and conditional writes, plus the retained plain-JavaScript Keycloak
adapter. Node checks also verify generated deployment configuration, atomic asset
staging and the npm package contents. With the native stack running and profile sourced, run
`npm run smoke:workspace:modern:full` in `cedar-development/ops/e2e` for the modern
Workspace journey, CED host conflict/versioning scenarios, all four account pages,
and logout/retired-route checks.
Run account journeys separately with `npm run smoke:account:all`, or one page with
`npm run smoke:account -- profile` (also `settings`, `groups`, `privacy`). The existing
AngularJS `npm run smoke` remains unchanged for `cedar.metadatacenter.*`.

Resource reports supply lifecycle actions missing from listing summaries. Template
reports are fetched in bounded batches; other reports are fetched when their menus
or information panels open. Rename, move, delete, open-state and permission updates
use read-time ETags and preserve the dialog input on conflict. The New menu offers
Folder, Field, Element and Template; Workspace does not provide an import flow.

## Publication and native server deployment

The package is published to the CEDAR Nexus npm repository through the explicit cedarcli command:

```sh
cedarcli deploy split-frontends --dry-run
cedarcli deploy split-frontends
```

Because npm package versions are immutable, the command stages a unique version derived from the
commit timestamp and ID (for example `2.9.2-dev.20260822003012.gabcdef123456`) without changing this
working tree. Publication is not runtime deployment. A native staging or production host checks out the approved
Git commit and generates both environment-configured static trees with:

```sh
cedarcli build split-frontends --server-payload
```

That command requires `CEDAR_FRONTEND_BEHAVIOR=server` and exact
`CEDAR_WORKSPACE_FRONTEND_URL`/`CEDAR_TEMPLATE_DESIGNER_FRONTEND_URL` values. It runs `npm ci`, runs
Gulp, records `/config/build-info.json`, and exits; host nginx serves this repository's `app`
directory directly. Docker is not required on staging or production.

## Docker deployment

Docker construction is deliberately outside this application repository. `cedar-docker-build`
owns the image recipe, nginx configuration, and entrypoint; it consumes one exact immutable npm
version from Nexus. `cedar-docker-deploy` owns the service, network, health check, and runtime
environment. This repository contains no Docker-specific files.

Both native server payloads and Docker images expose `/config/build-info.json` with the source
commit and a SHA-256 over the exact environment-specific tree served. Docker payloads additionally
record the immutable npm version and tarball digest. The file is served with `Cache-Control:
no-store`; deployment acceptance must record it and reject provenance-unknown payloads.

## CEE release consumption

Workspace is a required consumer of every CEE release. `package.json` and `package-lock.json` pin one
exact `cedar-embeddable-editor` version, and the Gulp build copies its bundle into
`app/third_party_components/cedar-embeddable-editor/`. CEE propagation is managed with the shared
seven-consumer gate, which also covers the production monolith and the existing auxiliary/demo hosts:

```sh
node "$CEDAR_HOME/cedar-development/ops/propagate-cee-release.mjs" --check <CEE_VERSION>
```

A manifest or lockfile update alone does not update a served Workspace. Regenerate the native server
payload (or publish a new immutable npm artifact and rebuild its image), then verify the served CEE sha256 and rerun the split
deployment and authenticated smokes before accepting the release in an environment.

## Migration constraints

- Do not route production traffic here until preview and staging gates pass.
- CEE owns metadata field rendering; the Angular host owns persistence, permissions
  and navigation. Do not reimplement CEE widgets in the host.
- Cross-application navigation follows
  [`docs/CROSS_APP_NAVIGATION.md`](docs/CROSS_APP_NAVIGATION.md).
- New workspace development belongs in `src/`; do not add AngularJS UI.

## Confirmations and success feedback

Use `WorkspaceReturn` for the Workspace back control on instance, Groups and
account pages. It owns the localized label, arrow, typography and spacing; editors
use its guarded button mode to retain unsaved-change confirmation and disable it
while saving. Instance save status uses an outlined yellow circle for Saved and a
filled circle for Modified, with localized text as well as the visual indicator.

Workspace overlay spacing is owned by `src/_overlay-spacing.scss`. Action,
deletion and confirmation dialogs use its `.dialog-stack` layout: 12px between
sections (`--cedar-space-3`), 4px within a
destination picker (`--cedar-space-1`), and no vertical margins on direct children.
Use nested stacks for forms and scrollable bodies; do not add paragraph, label or
footer margins on top. Vertical outer padding is 16px (`--cedar-space-4`), with
the shared 24px horizontal padding. Picker breadcrumbs use 24px navigation targets
without form-button padding; form controls and table rows keep their normal sizes.
All dismissible dialog headings use `.dialog-heading` and `.dialog-close` from
the same recipe. The close icon aligns with the title's vertical center and the
content's right edge; its square hit target extends into the outer padding.
Do not position close buttons independently or give them text-button padding.
Form label text uses `.field-label` and the shared medium-weight label recipe;
keep it separate from the input so entered values retain regular weight.
The reusable destination folder list sizes its date column to its content, leaving
the remaining width for folder names rather than reserving a percentage at the right.
Action dialogs keep native modality and a loading status while preparing their
initial data, then reveal the complete form and focus its first control after render.
The shared `.is-preparing` presentation rule prevents intermediate disabled forms
and partial folder lists from flashing onscreen. Escape can cancel this initial read;
saving still blocks dismissal, and later folder browsing retains the visible dialog.
Artifact previews use the same presentation rule until CEE/CEF signals readiness:
the viewer lays out while unpainted, then its content and the resource title appear
together. The loading status retains a close control and Escape cancellation.
Permissions, Preview and filter popovers consume dedicated recipes from that same
file; their compact divided sections do not need form-dialog spacing. Tooltips and
toasts share its feedback recipe. Menus and suggestion rows use the design-token
package's menu sizing. Component styles own positioning, scrolling and responsive
structure, not independent section padding or paragraph margins.

The browser surface suite checks every registered dialog and menu at desktop and
narrow widths: padding, actual gaps, accumulated margins, close-button alignment,
label weight and menu-row sizing. A
new dialog must choose a tested spacing recipe. Copy also has a total-height budget
for an empty destination, and deliberately injected overrides prove the guards
fail. Tooltip, toast and suggestion-list tests cover their spacing too. These
checks supplement the shared surface contract, which checks color and radius.

Use the shared `Confirmation` service for in-app confirmation, awaiting its result
before writing and rechecking the target and permissions afterward. The root outlet
provides a styled, labelled modal with Cancel focused, Escape cancellation, focus
containment and focus restoration; it supports a confirmation above an existing dialog.
Do not add browser `confirm()` or `alert()` calls. The native `beforeunload` warning
is retained for browser navigation and tab closing, where custom dialogs are unavailable.

Use `Toast` for successful modifications and copy feedback. It announces politely,
can be dismissed, expires after six seconds and pauses on hover or focus. Render it
inside the owning dialog when one is open, so it remains accessible in the modal's
layer. Errors, stale-write conflicts and actionable recovery messages stay inline.
