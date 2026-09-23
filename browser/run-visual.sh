#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec docker run --rm --init --platform linux/arm64 --ipc=host \
  -v "$REPO":/repo -v workspace-browser-modules:/repo/browser/node_modules \
  -w /repo/browser -e CI=1 -e WORKSPACE_VISUAL=1 \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -lc 'npm ci --no-audit --no-fund && npx playwright test "$@"' -- "$@"
