# Workspace visual and interaction contracts

Build the production app with `npm run build`, install this directory with `npm ci`,
then run `npm run test:browser` at the repository root for fast local checks.
`npm run test:visual` runs the full suite in Playwright 1.63.0's ARM Linux container,
matching CI. Deliberate baseline changes use `npm run test:visual -- --update-snapshots`.
Review every changed image; tolerances are zero. Never update snapshots to fix an
unexplained failure. Failure traces and image diffs are uploaded by CI.

The tests load the real built application with explicit API fixtures. Unknown API
requests fail, dates are fixed, and no live account or network API is required.
The editor-host fixture replaces only CEE's SDK boundary: host toolbar states are
covered here; CEE/CEF pixels and behavior remain covered by their own approved suite
and the real-stack `smoke:workspace:modern` journey. Neither replaces the other.

Coverage includes desktop and narrow Workspace/account pages, artifact actions,
resource dialogs, editable/read-only Permissions, and metadata-host states. Axe
checks run alongside browser assertions; keyboard flows must also be exercised
explicitly because a static accessibility scan cannot prove them.
