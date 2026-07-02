#!/usr/bin/env bash
set -euo pipefail

CURRENT_SHA="${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"
if command -v buildkite-agent >/dev/null 2>&1; then
  STAGED_SHA="${STAGED_SHA:-$(buildkite-agent meta-data get staged-sha)}"
else
  STAGED_SHA="${STAGED_SHA:-${CURRENT_SHA}}"
fi
PROJECT_NAME="$(node scripts/_project-config.mjs get production cloudflarePagesProject)"
PRODUCTION_BRANCH="$(node scripts/_project-config.mjs get production cloudflareBranch)"

pnpm exec tsx tooling/release/src/index.ts deploy-doctor production
pnpm exec tsx tooling/release/src/index.ts promote-plan "${STAGED_SHA}" "${CURRENT_SHA}"

pnpm build
pnpm smoke:web-static
pnpm dlx wrangler@latest pages deploy apps/web/dist \
  --project-name "${PROJECT_NAME}" \
  --branch "${PRODUCTION_BRANCH}" \
  --commit-dirty=true
