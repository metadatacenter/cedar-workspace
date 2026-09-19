# cedar-workspace

CEDAR's split Workspace frontend. `/` and `/dashboard` run a standalone Angular
22 application with Angular routing, signals, forms and shared CEDAR design tokens.
The initial workspace provides a table, search, folder navigation, collapsible side
panels, Info/Version tabs, and resource action dialogs. It deliberately has no
categories, latest-version filter, type filters or tile view.

Template, element and field authoring opens the configured CED/CEFD Designer host;
metadata creation/editing opens the standalone Angular CEE host at
`/instances/create/:templateId` and `/instances/edit/:id`.

The four account routes are also Angular: Profile provides account details and masked
API-key management; Settings saves the date format used by Workspace; Groups manages
details and membership with separate revision tokens; Privacy retains the existing
policy wording. No AngularJS runtime or styles load on any of these routes.
Messaging has been removed; its old URL returns to Workspace.
Logout also runs in Angular and does not depend on the profile service.
All routes now use the Angular application. The AngularJS shell, Bower vendors, old
icon fonts, RequireJS and obsolete build/test packages are removed. The retained
Keycloak adapter and bundle are plain JavaScript used by Angular.
The combined `cedar-template-editor` application is unchanged.

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
