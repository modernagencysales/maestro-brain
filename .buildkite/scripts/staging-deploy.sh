#!/usr/bin/env bash
set -euo pipefail

COMMIT_SHA="${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"
PROJECT_NAME="$(node scripts/_project-config.mjs get staging cloudflarePagesProject)"
BRANCH_NAME="$(node scripts/_project-config.mjs get staging cloudflareBranch)"

pnpm exec tsx tooling/release/src/index.ts deploy-doctor staging

VITE_CONVEX_URL="${VITE_CONVEX_URL:-$(node scripts/_project-config.mjs get staging convexUrl)}"
export VITE_CONVEX_URL

pnpm build
pnpm smoke:web-static
pnpm dlx wrangler@latest pages deploy apps/web/dist/client \
  --project-name "${PROJECT_NAME}" \
  --branch "${BRANCH_NAME}" \
  --commit-dirty=true

if command -v buildkite-agent >/dev/null 2>&1; then
  buildkite-agent meta-data set staged-sha "${COMMIT_SHA}"
fi
