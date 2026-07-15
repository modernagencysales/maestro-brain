#!/usr/bin/env bash
set -euo pipefail

# Hosted agents are bare: install pinned node/pnpm and run frozen install.
source "$(dirname "$0")/setup.sh"

CURRENT_SHA="${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"
if command -v buildkite-agent >/dev/null 2>&1; then
  STAGED_SHA="${STAGED_SHA:-$(buildkite-agent meta-data get staged-sha)}"
  RELEASE_PACKET="${RELEASE_PACKET:-$(buildkite-agent meta-data get staged-release-packet)}"
else
  STAGED_SHA="${STAGED_SHA:-}"
  RELEASE_PACKET="${RELEASE_PACKET:-}"
fi
PROJECT_NAME="$(node scripts/_project-config.mjs get production cloudflarePagesProject)"
PRODUCTION_BRANCH="$(node scripts/_project-config.mjs get production cloudflareBranch)"

CONVEX_DEPLOY_KEY="${MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY:-}"
CLOUDFLARE_API_TOKEN="${MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_API_TOKEN:-}"
CLOUDFLARE_ACCOUNT_ID="${MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_ACCOUNT_ID:-}"
export CONVEX_DEPLOY_KEY CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

pnpm exec tsx tooling/release/src/index.ts deploy-doctor production
EXPECTED_SCHEMA_HASH="$(git ls-files packages/convex/confect/tables packages/convex/convex/schema.ts | xargs git hash-object | git hash-object --stdin)"
EXPECTED_MANIFEST_HASH="$(git hash-object project.config.json docs/template/env-manifest.json)"
: "${MAESTRO_BRAIN_RELEASE_SIGNING_KEY_ID:?MAESTRO_BRAIN_RELEASE_SIGNING_KEY_ID is required}"
: "${MAESTRO_BRAIN_RELEASE_SIGNING_SECRET:?MAESTRO_BRAIN_RELEASE_SIGNING_SECRET is required}"
pnpm exec tsx tooling/release/src/index.ts promote-plan "${STAGED_SHA}" "${CURRENT_SHA}" "${EXPECTED_SCHEMA_HASH}" "${EXPECTED_MANIFEST_HASH}" "${RELEASE_PACKET}"

# Backend first: CONVEX_DEPLOY_KEY (validated by deploy-doctor) targets only
# the production deployment. Tenant deploy paths must never seed demo/showcase.
(cd packages/convex && pnpm exec convex deploy -y)

VITE_CONVEX_URL="${VITE_CONVEX_URL:-$(node scripts/_project-config.mjs get production convexUrl)}"
export VITE_CONVEX_URL

pnpm build
pnpm smoke:web-static
pnpm dlx wrangler@latest pages deploy apps/web/dist/client \
  --project-name "${PROJECT_NAME}" \
  --branch "${PRODUCTION_BRANCH}" \
  --commit-dirty=true
