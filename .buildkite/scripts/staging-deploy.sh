#!/usr/bin/env bash
set -euo pipefail

# Hosted agents are bare: install pinned node/pnpm and run frozen install.
source "$(dirname "$0")/setup.sh"

COMMIT_SHA="${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"
PROJECT_NAME="$(node scripts/_project-config.mjs get staging cloudflarePagesProject)"
BRANCH_NAME="$(node scripts/_project-config.mjs get staging cloudflareBranch)"

# Cluster secrets namespace this pipeline's Convex key so it can never
# collide with another pipeline's CONVEX_DEPLOY_KEY in the shared cluster.
CONVEX_DEPLOY_KEY="${CONVEX_DEPLOY_KEY:-${TEMPLATE_CONVEX_DEPLOY_KEY:-}}"
export CONVEX_DEPLOY_KEY

pnpm exec tsx tooling/release/src/index.ts deploy-doctor staging

# Backend first: CONVEX_DEPLOY_KEY (validated by deploy-doctor) targets the
# environment's deployment; the seed is idempotent and only creates the fixed
# demo workspace. The frontend below is built against the same deployment.
(cd packages/convex && pnpm exec convex deploy -y)
(cd packages/convex && pnpm exec convex run demo/showcase:seed)

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
