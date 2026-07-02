#!/usr/bin/env bash
set -euo pipefail

# Hosted agents are bare: install pinned node/pnpm and run frozen install.
source "$(dirname "$0")/setup.sh"

CURRENT_SHA="${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"
if command -v buildkite-agent >/dev/null 2>&1; then
  STAGED_SHA="${STAGED_SHA:-$(buildkite-agent meta-data get staged-sha)}"
else
  STAGED_SHA="${STAGED_SHA:-${CURRENT_SHA}}"
fi
PROJECT_NAME="$(node scripts/_project-config.mjs get production cloudflarePagesProject)"
PRODUCTION_BRANCH="$(node scripts/_project-config.mjs get production cloudflareBranch)"

# Cluster secrets namespace this pipeline's Convex key so it can never
# collide with another pipeline's CONVEX_DEPLOY_KEY in the shared cluster.
CONVEX_DEPLOY_KEY="${CONVEX_DEPLOY_KEY:-${TEMPLATE_CONVEX_DEPLOY_KEY:-}}"
export CONVEX_DEPLOY_KEY

pnpm exec tsx tooling/release/src/index.ts deploy-doctor production
pnpm exec tsx tooling/release/src/index.ts promote-plan "${STAGED_SHA}" "${CURRENT_SHA}"

# Backend first: CONVEX_DEPLOY_KEY (validated by deploy-doctor) targets the
# production deployment; the seed is idempotent and only creates the fixed
# demo workspace. The frontend below is built against the same deployment.
(cd packages/convex && pnpm exec convex deploy -y)
(cd packages/convex && pnpm exec convex run demo/showcase:seed)

VITE_CONVEX_URL="${VITE_CONVEX_URL:-$(node scripts/_project-config.mjs get production convexUrl)}"
export VITE_CONVEX_URL

pnpm build
pnpm smoke:web-static
pnpm dlx wrangler@latest pages deploy apps/web/dist/client \
  --project-name "${PROJECT_NAME}" \
  --branch "${PRODUCTION_BRANCH}" \
  --commit-dirty=true
