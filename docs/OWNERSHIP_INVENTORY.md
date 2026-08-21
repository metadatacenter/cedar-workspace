# Workspace ownership inventory

This repository is the extracted CEDAR Workspace frontend. The production
`cedar-template-editor` monolith remains authoritative until the preview and staging
gates pass; this inventory defines the intended boundary of the extracted application.

## Owned routes

- `/` and `/dashboard`
- `/profile`, `/settings`, `/privacy`, `/messaging`, and `/logout`
- `/instances/create/:templateId` and `/instances/edit/:instanceId`

The instance routes are a thin authenticated host for the independently released
`cedar-embeddable-editor` Web Component. Workspace loads templates and instances,
supplies CEE configuration, persists the component's output, and owns dirty-state and
return navigation. CEE source code does not live here.

## Retained application areas

- Workspace search, browsing, folders, sharing, publication, import, and download flows
- Account, settings, privacy, messaging, monitoring, and logout surfaces
- Resource and category-tree widgets used by the Workspace
- The minimal CEE host shell and its template-instance REST service
- Shared authentication, backend HTTP, URL, user, tracking, and UI infrastructure needed
  by those surfaces

## Explicitly excluded

- Template, element, and field authoring; those routes belong to
  `cedar-template-designer`
- The legacy AngularJS metadata form renderer; instance editing uses CEE only
- Spreadsheet mode, Handsontable, ngHandsontable, and their adapters and styles
- Controlled-term authoring UI and rich-text authoring machinery
- Archived legacy artifact frontends. The separate `cedar-openview` application is
  active and remains a valid Workspace destination.
- The inherited Protractor/Selenium harness and broad legacy unit suite

## Cross-application boundary

Workspace performs full-page navigation to Designer for template, element, and field
create/edit actions. It passes an absolute `returnTo` URL and opaque encoded artifact
identifiers. Instance routes remain on the Workspace origin. See
[`CROSS_APP_NAVIGATION.md`](CROSS_APP_NAVIGATION.md).

## Verification floor

- `npm test` runs the focused URL-contract tests.
- `npm start` serves Workspace on port 4201 and LiveReload on 35730 by default.
- `/dashboard` and `/instances/create/:templateId` must both return the application shell.
- The pinned CEE bundle must be served at
  `/third_party_components/cedar-embeddable-editor/cedar-embeddable-editor.js`.
- A repository-wide case-insensitive search for `handsontable`, `nghandsontable`, or
  `spreadsheet` must return no matches.
- Before every parity gate, audit commits added to the frozen monolith baseline and port
  applicable fixes deliberately rather than merging the monolith wholesale.
