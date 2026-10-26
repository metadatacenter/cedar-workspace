# Workspace visual and interaction contracts

Build the production app with `npm run build`, install this directory with `npm ci`,
then run `npm run test:browser` at the repository root for fast local checks.
`npm run test:visual` runs the full suite in Playwright 1.64.1's ARM Linux container,
matching CI. Deliberate baseline changes use `npm run test:visual -- --update-snapshots`.
Review every changed image; the allowed differing-pixel count is zero and the
per-pixel colour threshold is 0.02, matching CEE. The container honors
`CEDAR_TEST_WORKERS` and owns a private dependency volume for each run.
Never update snapshots to fix an
unexplained failure. Failure traces and image diffs are uploaded by CI.

The tests load the real built application with explicit API fixtures. Unknown API
requests fail, dates are fixed, and no live account or network API is required.
A spec that routes API requests itself answers only the requests it is about and
passes the rest on with `route.fallback()`, so the shared fixture answers them or
fails the test. A route that answers every request hides one nobody mocked, and can
hand the application a resource other than the one it asked for.
The editor-host fixture replaces only CEE's SDK boundary: host toolbar states are
covered here; CEE/CEF pixels and behavior remain covered by their own approved suite
and the real-stack `smoke:workspace:modern` journey. Neither replaces the other.

Coverage includes desktop and narrow Workspace/account pages, artifact actions,
resource dialogs, editable/read-only Permissions, and metadata-host states. Axe
checks run alongside browser assertions; keyboard flows must also be exercised
explicitly because a static accessibility scan cannot prove them.

The axe gate, `accessibility.spec.mjs`, scans each page and the states a person
can open on it: menus, filter popovers, the Information panel, the Permissions,
Move, Copy and Publish dialogs, the metadata editor without CEE, and one control of
each kind hovered and focused. It scans the states a narrow window rearranges again
at 375 px. A result axe leaves
undecided fails the gate unless the spec's settled list names it. Each entry
records the measurement that settles it, which the spec takes again on every run,
so an entry that no longer holds fails as well. Text a popup's shadow falls across
measures a little differently in each browser build, so its entry records the least
contrast it must meet instead.

`layout-resilience.spec.mjs` opens each page and each dialog Workspace opens itself at
320 px, at 640 by 400 px (200% zoom) and with WCAG's text spacing, and fails on sideways
scrolling, unreachable controls, clipped or overlapping text and placeholders under 4.5:1.
A data table may scroll inside its own container, and the spec names each one. What it
finds and leaves in place is listed in its exceptions, each with the visible change it
needs.
