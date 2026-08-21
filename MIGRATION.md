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
| `a6b29576` - remove legacy artifact frontend routing | Equivalent dead routing and references are absent from Workspace |

## Current extraction checkpoint

- Independent AngularJS bootstrap and package identity on port 4201
- Workspace-owned dashboard, account, messaging, and CEE instance-shell routes
- Full-document Template Designer navigation with exact-origin `returnTo` validation
- Focused URL/auth/runtime contract suite: 7 passing tests
- Spreadsheet mode, Designer authoring, legacy renderer, obsolete broad tests, and unreachable vendors removed
- Local-source nginx image and opt-in Compose preview verified by the split frontend smoke
- Runtime build identity exposes the clean source commit and exact served-tree SHA-256 with no-store caching
- CLI repository/process registration is preview-only and excluded from release operations
- The full authenticated smoke is split-origin aware and includes exact Workspace-to-Designer return navigation
- The approved local Keycloak callbacks and exact Web Origins pass their credential-free preflight
- The authenticated split journey passes login/SSO, exact Designer return, authoring, Workspace CEE
  create/save/edit, JSON/YAML serialization, OpenView, teardown, and folder-clear verification
- Workspace owns its minimal user application state and decodes CEE route identifiers exactly once;
  these runtime fixes are recorded by `f0d59519` and `95d16928`

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
- [x] Replace internal Designer route changes with full-document navigation
- [x] Validate `returnTo` against the configured Workspace origin
- [x] Split the eager service module so only Workspace dependencies load
- [x] Remove Designer authoring and legacy instance-renderer source; retain only the CEE route shell
- [x] Separately host root-relative static assets on the Workspace origin
- [x] Serve the unpruned baseline independently on port 4201 (LiveReload 35730)
- [x] Produce a Workspace-only build after pruning
- [x] Add Workspace-focused unit and credential-free cross-application smoke tests
- [x] Build and run a local-source preview image without a published frontend tarball
- [x] Prove and record clean source identity plus the exact environment-generated served bundle
- [x] Add a split-aware authenticated browser journey without changing the production-monolith smoke
- [x] Pass local preview routing, auth, deep-link, and route-only rollback tests
- [ ] Pass staging parity before any production routing changes

## Change discipline

- Make coherent local commits as migration checkpoints; do not push until remote ownership is agreed.
- Keep the legacy production repository unchanged.
- Record every ambiguous shared file here before deleting it.
- Prefer copy-and-subtract to a framework rewrite; modernization is a later project.
