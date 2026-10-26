#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Each reactor copy owns its dependencies and its container, including cancellation.
CONTAINER="workspace-tests-$$-${RANDOM}"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker run --name "$CONTAINER" --rm --init --platform linux/arm64 --ipc=host \
  -e CEDAR_TEST_TRACE="${CEDAR_TEST_TRACE:-}" \
  -e CEDAR_TEST_WORKERS="${CEDAR_TEST_WORKERS:-}" \
  -v "$REPO":/repo -v /repo/browser/node_modules \
  -w /repo/browser -e CI=1 -e WORKSPACE_VISUAL=1 \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  bash -lc 'npm ci --no-audit --no-fund && npx playwright test "$@"' -- "$@"
