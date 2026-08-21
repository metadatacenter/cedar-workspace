# cedar-workspace

CEDAR's Workspace frontend: dashboard, folders, search, resource operations,
sharing, categories, profile/settings, and launch points into authoring tools.

This repository is being extracted from the legacy `cedar-template-editor`
AngularJS monolith. It is not in the production release path yet. See
[`MIGRATION.md`](MIGRATION.md) for the frozen source commit, current boundary,
baseline test debt, and extraction gates.

## Local development

Export `CEDAR_HOME`, source the normal CEDAR development profile, and run:

```sh
cd "$CEDAR_HOME/cedar-workspace"
npm start
```

The default development and LiveReload ports are `4201` and `35730`.
Override them with `CEDAR_FRONTEND_PORT` and `CEDAR_LIVERELOAD_PORT` when
needed. The production monolith continues to use port `4200`.

The current unit baseline is run with `npm test`. Cross-application smoke tests
live under `cedar-development/ops/e2e`.

## Publication and native server deployment

The package is published to the CEDAR Nexus npm repository through the explicit cedarcli command:

```sh
cedarcli deploy split-frontends --dry-run
cedarcli deploy split-frontends
```

Publication is not runtime deployment. A native staging or production host checks out the approved
Git commit and generates both environment-configured static trees with:

```sh
cedarcli build split-frontends --server-payload
```

That command requires `CEDAR_FRONTEND_BEHAVIOR=server` and exact
`CEDAR_WORKSPACE_FRONTEND_URL`/`CEDAR_TEMPLATE_DESIGNER_FRONTEND_URL` values. It runs `npm ci`, runs
Gulp, records `/config/build-info.json`, and exits; host nginx serves this repository's `app`
directory directly. Docker is not required on staging or production.

## Optional local preview image

The repository builds directly from its checkout; it does not require a published npm tarball.
Use the provenance-aware wrapper and image versions declared by `cedar-docker-build`:

```sh
"$CEDAR_HOME/cedar-docker-build/bin/build-split-preview-frontends.sh" workspace
```

The image requires `CEDAR_HOST` at runtime and serves port `4201`. It generates environment-specific
service, navigation, and authentication origins before nginx starts. Override
`CEDAR_WORKSPACE_FRONTEND_URL`, `CEDAR_TEMPLATE_DESIGNER_FRONTEND_URL`, or `CEDAR_AUTH_URL` for a
nonstandard preview topology. This image is preview-only until the migration acceptance gate passes.

Both native server payloads and preview images expose `/config/build-info.json` with the source
commit, clean/dirty state, and a SHA-256 over the exact environment-specific tree nginx serves. The
file is served with `Cache-Control: no-store`; staging acceptance must record it and reject dirty
payloads.

## CEE release consumption

Workspace is a required consumer of every CEE release. `package.json` and `package-lock.json` pin one
exact `cedar-embeddable-editor` version, and the Gulp build copies its bundle into
`app/third_party_components/cedar-embeddable-editor/`. CEE propagation is managed with the shared
seven-consumer gate, which also covers the production monolith and the existing auxiliary/demo hosts:

```sh
node "$CEDAR_HOME/cedar-development/ops/propagate-cee-release.mjs" --check <CEE_VERSION>
```

A manifest or lockfile update alone does not update a served Workspace. Regenerate the native server
payload (or rebuild a local preview image), then verify the served CEE sha256 and rerun the split
deployment and authenticated smokes before accepting the release in an environment.

## Migration constraints

- Do not route production traffic here until preview and staging gates pass.
- Do not copy metadata instance editing into this repository; use the canonical
  CEE host.
- Cross-application navigation follows
  [`docs/CROSS_APP_NAVIGATION.md`](docs/CROSS_APP_NAVIGATION.md).
- Framework modernization is intentionally separate from the extraction.
