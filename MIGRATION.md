# CEDAR Workspace extraction ledger

This repository is being extracted from `cedar-template-editor`. The production
`cedar-template-editor` application remains the release and rollback target until
the new applications pass preview and staging gates.

## Frozen baseline

- Source repository: `cedar-template-editor`
- Source branch: `develop`
- Source commit: `d3330ef7c04e2ea2f0f25c8e55d7931af82d38f0`
- Source commit date: 2026-08-20
- Source subject: `Track CEE dirty state against saved metadata`
- Local extraction date: 2026-08-20
- History: preserved with a local clone; the inherited remote is named `source`
  and has no usable push URL

## Baseline verification

- Source worktree: clean before cloning
- Local service smoke: blocked because all 21 CEDAR services were down
- Karma under Chrome 151: 40 passed, 4 skipped, 14 failed
- Known test-infrastructure failures: missing locale/config fixtures, unexpected
  resource-service requests in finder tests, and unresolved locale promises in
  modal tests
- Known designer-side failures: two checkbox default-choice assertions

These failures pre-date extraction. Do not conceal them by weakening tests. Track
them as baseline debt, and require every newly introduced or migrated test to pass.

## Post-baseline source audit

| Source commit | Disposition |
| --- | --- |
| `fc083f78` - take CEE `2.0.0-dev.20260820.a8cc4cc` | Ported into the extraction worktree on 2026-08-20 |

## Product boundary

Workspace owns:

- `/` and `/dashboard`
- folders, browsing, search, breadcrumbs, categories, and pagination
- resource actions: create folder, copy, move, rename, share, publish, import,
  inclusion, submission, and deletion where currently exposed
- profile, settings, privacy, logout, and messaging
- cross-application launches into Template Designer and the canonical CEE host

Workspace does not own:

- template, element, or field authoring
- controlled-term authoring UI except where a Workspace-owned action proves it is
  genuinely needed
- metadata instance create/edit UI

## Initial ownership map

| Area | Disposition |
| --- | --- |
| `dashboard/`, `search-browse/`, `category-tree/` | Keep |
| Workspace resource-operation directives in `modal/` | Keep |
| `profile/`, `messaging/` | Keep |
| shared `core/`, `layout/`, `service/`, `widget/` | Classify and retain only used files |
| `template/`, `template-element/`, `template-field/` | Remove after external navigation is live |
| `controlled-term/`, designer `form/` code | Remove unless dependency evidence says otherwise |
| `template-instance/` | Remove after canonical CEE routes are live |

## Extraction gates

The current inter-application boundary is documented in
[`docs/CROSS_APP_NAVIGATION.md`](docs/CROSS_APP_NAVIGATION.md).

- [x] Clone from the frozen source commit without modifying the source worktree
- [x] Give the package a distinct repository identity
- [x] Draft versioned cross-app URL, authentication, and `returnTo` contracts
- [ ] Ratify contract decisions and production origins
- [ ] Replace internal Designer and CEE route changes with full-document navigation
- [ ] Validate `returnTo` against configured CEDAR origins
- [ ] Split the eager service module so only Workspace dependencies load
- [ ] Remove Designer and instance routes and source
- [ ] Namespace or separately host root-relative static assets
- [ ] Build and serve independently
- [ ] Add Workspace-focused unit and browser smoke tests
- [ ] Pass preview routing, auth, deep-link, and rollback tests
- [ ] Pass staging parity before any production routing changes

## Change discipline

- Do not commit or push migration changes unless explicitly requested.
- Keep the legacy production repository unchanged.
- Record every ambiguous shared file here before deleting it.
- Prefer copy-and-subtract to a framework rewrite; modernization is a later project.
