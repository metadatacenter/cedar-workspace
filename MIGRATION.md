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

## Current application boundary

Workspace is a standalone Angular 22 application. All its routes, account pages and
CEE host use `src/`. Messaging has been removed; unknown and retired routes return to
`/dashboard`. The AngularJS shell, controllers, directives, services, templates,
styles and Karma harness are removed. The plain-JavaScript Keycloak adapter remains
because the modern application uses it; it has a Node test suite.

Workspace owns browsing, resource actions, Profile, Settings, Groups, Privacy, logout,
and metadata persistence through CEE. Designer owns template/element/field authoring.
See [ownership](docs/OWNERSHIP_INVENTORY.md) and
[navigation](docs/CROSS_APP_NAVIGATION.md) for current contracts.

The combined `cedar-template-editor` repository and its AngularJS smoke remain intact.
`npm test` and the full modern Workspace smoke are the current verification gates;
see the README for build and deployment commands.
